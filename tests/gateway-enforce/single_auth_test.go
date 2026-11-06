package handler

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"

	"github.com/FREEZONEX/Tier0-Backend/service/syssvr/pb/sys"
	"github.com/FREEZONEX/Tier0-Backend/share/rpcauth"
	"github.com/zeromicro/go-zero/rest"
	"github.com/zeromicro/go-zero/rest/router"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

type sdkSingleAuthFake struct {
	*requestAuthFake
	mu        sync.Mutex
	whoamiKey string
}

func (f *sdkSingleAuthFake) ApiKeyWhoami(_ context.Context, req *sys.ApiKeyWhoamiReq, _ ...grpc.CallOption) (*sys.ApiKeyWhoamiResp, error) {
	f.mu.Lock()
	f.whoamiKey = req.GetApiKey()
	f.mu.Unlock()
	keyType := "service"
	if strings.HasPrefix(req.GetApiKey(), "sk-app-") {
		keyType = "app"
	}
	return &sys.ApiKeyWhoamiResp{UserID: 7, UserName: req.GetApiKey(), WorkspaceID: 10001, KeyType: keyType}, nil
}

func (f *sdkSingleAuthFake) ApiKeyCheck(ctx context.Context, req *sys.ApiKeyCheckReq, opts ...grpc.CallOption) (*sys.ApiKeyCheckResp, error) {
	f.mu.Lock()
	result, err := f.requestAuthFake.ApiKeyCheck(ctx, req, opts...)
	if result != nil {
		result = proto.Clone(result).(*sys.ApiKeyCheckResp)
	}
	f.mu.Unlock()
	if err != nil || result == nil {
		return result, err
	}
	if strings.HasPrefix(req.GetApiKey(), "sk-app-") {
		result.KeyType = "app"
	}
	return result, nil
}

func (f *sdkSingleAuthFake) FileUrlGet(_ context.Context, req *sys.SysFileUrlGetReq, _ ...grpc.CallOption) (*sys.SysFileUrlGetResp, error) {
	return &sys.SysFileUrlGetResp{FileUrl: "https://storage.example/" + req.GetFilePath()}, nil
}

// 真实 Gateway 路由和 enforce 中间件；SYS / Stream RPC 为隔离测试替身。
func TestSDKSingleAuthGatewayEnforce(t *testing.T) {
	svcCtx, base, _ := requestFixture(t)
	fake := &sdkSingleAuthFake{requestAuthFake: base}
	svcCtx.SysCommon = fake
	svcCtx.NotificationApi = notificationAPIStub{}
	svcCtx.Config.SysRPCCaller.Mode = rpcauth.Enforce
	registered, err := rest.NewServer(rest.RestConf{})
	if err != nil {
		t.Fatal(err)
	}
	RegisterHandlers(registered, svcCtx)
	mux := router.NewRouter()
	count := 0
	for _, route := range registered.Routes() {
		if route.Path == "/openapi/v2/auth/whoami" || route.Path == "/openapi/v2/assets/files/url" || strings.HasPrefix(route.Path, "/openapi/v2/stream-requests/") {
			if err := mux.Handle(route.Method, route.Path, route.Handler); err != nil {
				t.Fatal(err)
			}
			count++
		}
	}
	if count != 5 {
		t.Fatalf("registered routes = %d, want 5", count)
	}
	server := httptest.NewServer(mux)
	defer server.Close()
	const key = "sk-svc-ws7pt_token"
	tests := []struct {
		name, path, auth, xkey string
		status, businessCode   int
		whoamiKey              string
	}{
		{"ordinary bearer only", "/openapi/v2/stream-requests/discover", "Bearer " + key, "", 200, 0, ""},
		{"ordinary X only", "/openapi/v2/stream-requests/discover", "", key, 200, 0, ""},
		{"ordinary double refused", "/openapi/v2/stream-requests/discover", "Bearer " + key, key, 401, 0, ""},
		{"whoami X only", "/openapi/v2/auth/whoami", "", key, 200, 200, key},
		{"whoami ApiKey only", "/openapi/v2/auth/whoami", "ApiKey " + key, "", 200, 200, key},
		{"whoami bearer rejected by handler", "/openapi/v2/auth/whoami", "Bearer " + key, "", 200, 100005, ""},
		{"whoami double refused", "/openapi/v2/auth/whoami", "Bearer " + key, key, 401, 0, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			fake.mu.Lock()
			fake.whoamiKey = ""
			fake.mu.Unlock()
			r, err := http.NewRequest(http.MethodPost, server.URL+tc.path, strings.NewReader("{}"))
			if err != nil {
				t.Fatal(err)
			}
			r.Header.Set("Content-Type", "application/json")
			if tc.auth != "" {
				r.Header.Set("Authorization", tc.auth)
			}
			if tc.xkey != "" {
				r.Header.Set("X-API-Key", tc.xkey)
			}
			resp, err := server.Client().Do(r)
			if err != nil {
				t.Fatal(err)
			}
			body, err := io.ReadAll(resp.Body)
			resp.Body.Close()
			if err != nil {
				t.Fatal(err)
			}
			if resp.StatusCode != tc.status {
				t.Fatalf("status=%d body=%s, want %d", resp.StatusCode, body, tc.status)
			}
			if tc.businessCode != 0 {
				var result struct {
					Code int `json:"code"`
				}
				if err := json.Unmarshal(body, &result); err != nil {
					t.Fatal(err)
				}
				if result.Code != tc.businessCode {
					t.Fatalf("business code=%d body=%s, want %d", result.Code, body, tc.businessCode)
				}
			}
			fake.mu.Lock()
			gotKey := fake.whoamiKey
			fake.mu.Unlock()
			if gotKey != tc.whoamiKey {
				t.Fatalf("whoami key=%q, want %q", gotKey, tc.whoamiKey)
			}
		})
	}
	t.Run("actual SDK talks to Gateway", func(t *testing.T) {
		sdk := os.Getenv("TIER0_SDK_GATEWAY_TEST_ENTRY")
		if sdk == "" {
			t.Fatal("TIER0_SDK_GATEWAY_TEST_ENTRY is required")
		}
		program := `
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { createClient } = await import(pathToFileURL(process.argv[1]).href);
const client = createClient({ apiHost: process.argv[2], apiKey: 'sk-svc-ws7pt_token' });
const whoami = await client.system.whoami();
assert.equal(whoami.userID, 7);
const discovery = await client.streams.requests.discover();
assert.equal(discovery.list[0].code, 'device.start');
const one = createClient({ apiHost: process.argv[2], apiKey: 'sk-svc-ws7pt_wrong', apiKeyProvider: async () => { await new Promise(r => setTimeout(r, 20)); return 'sk-svc-ws7pt_a'; } });
const two = createClient({ apiHost: process.argv[2], apiKeyProvider: async () => 'sk-svc-ws7pt_b' });
const [a, b] = await Promise.all([one.system.whoami(), two.system.whoami()]);
assert.equal(a.userName, 'sk-svc-ws7pt_a');
assert.equal(b.userName, 'sk-svc-ws7pt_b');
process.env.TIER0_API_KEY = 'sk-svc-ws7pt_environment';
const absent = createClient({ apiHost: process.argv[2], getApiKey: () => undefined });
const explicitUndefined = createClient({ apiHost: process.argv[2], apiKey: undefined });
const [missingA, missingB, active] = await Promise.allSettled([
  absent.system.whoami(), explicitUndefined.system.whoami(), two.system.whoami(),
]);
assert.equal(missingA.status, 'rejected');
assert.equal(missingA.reason.status, 401);
assert.equal(missingB.status, 'rejected');
assert.equal(missingB.reason.status, 401);
assert.equal(active.status, 'fulfilled');
assert.equal(active.value.userName, 'sk-svc-ws7pt_b');
const fromEnvironment = await createClient({ apiHost: process.argv[2] }).system.whoami();
assert.equal(fromEnvironment.userName, 'sk-svc-ws7pt_environment');
if (process.env.TIER0_SCAFFOLD_HELPER_ENTRY) {
  process.env.TIER0_API_HOST = process.argv[2];
  process.env.TIER0_API_KEY = 'sk-app-ws7pt_fixture';
  const { getTier0AppClient } = await import(pathToFileURL(process.env.TIER0_SCAFFOLD_HELPER_ENTRY).href);
  const app = await getTier0AppClient();
  const identity = await app.system.whoami();
  assert.equal(identity.userName, 'sk-app-ws7pt_fixture');
  assert.equal(identity.keyType, 'app');
  const file = await app.files.url({ filePath: 'report.txt' });
  assert.equal(file.fileUrl, 'https://storage.example/report.txt');
}


`
		cmd := exec.Command("node", "--input-type=module", "-e", program, sdk, server.URL)
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("SDK call: %v\n%s", err, output)
		}
		if os.Getenv("TIER0_SCAFFOLD_HELPER_ENTRY") != "" {
			t.Log("Scaffold App helper verified against the Gateway")
		}
	})

}
