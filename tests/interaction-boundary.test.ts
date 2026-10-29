import { describe, expect, it, vi } from 'vitest';
import * as sdk from '../src/index.js';
import { HttpClient } from '../src/openapi/client.js';

// Frozen legacy names from the released 0.6.2 public surface.
const retiredControlOperations = [
  'controlDiscover', 'controlDescribe', 'controlInvoke',
  'hostedAppControlPolicyGet', 'hostedAppControlPolicyUpdate', 'controlGrantGet', 'controlGrantSet',
  'controlAppCapabilities', 'controlAppList', 'controlAppGet', 'controlAppCreate', 'controlAppUpdate', 'controlAppPermissionsUpdate',
];

const retiredControlSchemas = [
  'CloudControlDefinition', 'CloudControlDiscoverReq', 'CloudControlDiscoverResponse',
  'CloudControlDescribeReq', 'CloudControlDescribeResponse', 'CloudControlInvokeReq', 'CloudControlInvokeResponse',
  'CloudHostedAppControlPolicyGetReq', 'CloudHostedAppControlPolicyUpdateReq', 'CloudHostedAppControlPolicy',
  'CloudHostedAppControlPolicyGetResponse', 'CloudHostedAppControlPolicyMutationResponse',
  'CloudControlGrantGetReq', 'CloudControlGrantTargetRevision', 'CloudControlGrantSetReq',
  'CloudControlGrantTargetInfo', 'CloudControlGrantInfo', 'CloudControlGrantMutation',
  'CloudControlGrantGetResponse', 'CloudControlGrantSetResponse',
];

describe('data SDK interaction boundary', () => {
  it('does not export the retired convenience API or duplicate the canonical Stream SDK', () => {
    const fetch = vi.fn();
    const client = sdk.createClient({ apiHost: 'https://fixture.invalid', fetch });
    for (const name of ['controls', 'ControlsClient', 'ControlHandle', 'ControlError',
      'ControlResultUnknownError', 'DEFAULT_CONTROL_TRANSPORT_TIMEOUT_MS']) {
      expect(sdk, name).not.toHaveProperty(name);
    }
    expect(client).not.toHaveProperty('controls');
    expect(client).not.toHaveProperty('streams');
    expect(client.stream).not.toHaveProperty('requests');
    expect(client.stream).not.toHaveProperty('messages');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects retired generated calls before encoding or fetching and removes their DTO codecs', async () => {
    const fetch = vi.fn();
    const config = { apiHost: 'https://fixture.invalid', fetch };
    const raw = sdk.createUnsV2Client(() => new HttpClient(config), config);
    const dispatch = raw as unknown as { call(name: string, request: unknown): Promise<unknown> };
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const name of retiredControlOperations) {
      expect(raw, name).not.toHaveProperty(name);
      expect(sdk.UNS_V2_OPERATIONS, name).not.toHaveProperty(name);
      await expect(dispatch.call(name, circular)).rejects.toThrow('unknown UNS v2 operation');
    }
    for (const name of retiredControlSchemas) expect(sdk.UNS_V2_CODEC_SCHEMAS, name).not.toHaveProperty(name);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not preflight capability discovery for a direct Namespace read', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 200, msg: '', requestId: 'namespace-read', data: {},
    })));
    const client = sdk.createClient({ apiHost: 'https://fixture.invalid', fetch });
    await client.uns.recordFind({ collectionId: 'orders' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://fixture.invalid/openapi/v2/uns/collections/orders/records:find');
  });

  it('preserves a typed pre-dispatch conflict without declaring an unknown outcome or retrying', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 409, msg: 'intent input conflict', requestId: 'conflict-request', data: null,
      error: { code: 'IDEMPOTENCY_CONFLICT', details: [], execution: 'notStarted', retry: { safe: false } },
    }), { status: 409 }));
    const client = sdk.createClient({ apiHost: 'https://fixture.invalid', fetch });
    const error = await client.uns.recordInsertOne({ collectionId: 'orders', data: { total: 2 }, idempotencyKey: 'existing-intent' })
      .catch(value => value);
    expect(error).toBeInstanceOf(sdk.UnsV2Error);
    expect(error).not.toBeInstanceOf(sdk.UnsV2OutcomeUnknownError);
    expect(error).toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT', requestId: 'conflict-request',
      execution: 'notStarted', retry: { safe: false }, outcomeUnknown: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps an interrupted mutation unknown with one fetch and no automatic replay', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
      const client = sdk.createClient({ apiHost: 'https://fixture.invalid', fetch, transportTimeoutMs: 20 });
      const settled = client.uns.recordInsertOne({ collectionId: 'orders', data: { total: 1 }, idempotencyKey: 'owned-intent' })
        .catch(value => value);
      await vi.advanceTimersByTimeAsync(20);
      const error = await settled;
      expect(error).toBeInstanceOf(sdk.UnsV2OutcomeUnknownError);
      expect(error).toMatchObject({ code: 'UNS_V2_TRANSPORT_TIMEOUT', execution: 'unknown', retry: { safe: false }, outcomeUnknown: true });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
