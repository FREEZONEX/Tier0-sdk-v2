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
	"testing"

	"github.com/FREEZONEX/Tier0-Backend/service/syssvr/pb/sys"
	"github.com/FREEZONEX/Tier0-Backend/share/rpcauth"
	"github.com/zeromicro/go-zero/rest"
	"github.com/zeromicro/go-zero/rest/router"
	"google.golang.org/grpc"
)

type sdkSingleAuthFake struct {
	*requestAuthFake
	whoamiKey string
}

func (f *sdkSingleAuthFake) ApiKeyWhoami(_ context.Context, req *sys.ApiKeyWhoamiReq, _ ...grpc.CallOption) (*sys.ApiKeyWhoamiResp, error) {
	f.whoamiKey = req.GetApiKey()
	return &sys.ApiKeyWhoamiResp{UserID: 7, WorkspaceID: 10001, KeyType: "service"}, nil
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
		if route.Path == "/openapi/v2/auth/whoami" || strings.HasPrefix(route.Path, "/openapi/v2/stream-requests/") {
			if err := mux.Handle(route.Method, route.Path, route.Handler); err != nil {
				t.Fatal(err)
			}
			count++
		}
	}
	if count != 4 {
		t.Fatalf("registered routes = %d, want 4", count)
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
			fake.whoamiKey = ""
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
			if fake.whoamiKey != tc.whoamiKey {
				t.Fatalf("whoami key=%q, want %q", fake.whoamiKey, tc.whoamiKey)
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
`
		cmd := exec.Command("node", "--input-type=module", "-e", program, sdk, server.URL)
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("SDK call: %v\n%s", err, output)
		}
	})

}
