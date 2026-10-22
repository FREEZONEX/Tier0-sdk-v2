import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, TransportError, createClient } from '../src/index.js';
import { OPENAPI_OPERATIONS } from '../src/openapi/api.generated.js';

const received: { url: string; method: string; body: string; headers: IncomingMessage['headers'] }[] = [];
let respond: (res: ServerResponse, req: IncomingMessage) => void;
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  received.push({ url: req.url!, method: req.method!, body, headers: req.headers });
  respond(res, req);
});
let apiHost: string;
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  apiHost = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => { received.length = 0; respond = res => res.end('{"code":200,"msg":"ok","data":{}}'); });
const sdk = () => createClient({ apiHost, apiKey: 'test-only-key', transportTimeoutMs: 500 });
const json = (res: ServerResponse, value: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };

describe('new architecture v1 on a real HTTP fixture', () => {
  it('unwraps the runtime envelope and preserves large identity integers', async () => {
    respond = res => res.end('{"code":200,"msg":"ok","data":{"userID":9007199254740993,"workspaceID":12,"userName":"Operator"}}');
    const user = await sdk().system.whoami();
    expect(user.userID).toBe(9007199254740993n);
    expect(user.workspaceID).toBe(12);
    expect(received[0]).toMatchObject({ method: 'POST', url: '/openapi/v1/auth/whoami', body: '{}' });
    expect(received[0].headers['x-api-key']).toBe('test-only-key');
  });
  it('serializes signed 64-bit request IDs as exact JSON numbers', async () => {
    respond = res => json(res, { code: 200, msg: '', data: { success: true } });
    await sdk().mqttAuth.delete({ id: 9007199254740993n });
    expect(received[0].body).toBe('{"id":9007199254740993}');
    await expect(sdk().mqttAuth.delete({ id: Number.MAX_SAFE_INTEGER + 1 })).rejects.toThrow();
    expect(received).toHaveLength(1);
  });
  it('rejects HTTP 200 business errors instead of resolving success', async () => {
    respond = res => json(res, { code: 40301, msg: 'permission denied' });
    await expect(sdk().system.whoami()).rejects.toMatchObject({ status: 200, code: 40301, msg: 'permission denied' });
  });
  it('preserves direct notification error codes', async () => {
    respond = res => json(res, { errorCode: 'NOTIFICATION_NOT_ALLOWED', message: 'not allowed' }, 403);
    await expect(sdk().notifications.get({ messageId: '1' })).rejects.toMatchObject({ status: 403, errorCode: 'NOTIFICATION_NOT_ALLOWED' });
  });
  it.each([[undefined, ['web', 'mobile']], [[], []], [['web'], ['web']], [['mobile', 'mobile'], ['mobile']]])('normalizes notification channels %j', async (channels, expected) => {
    respond = res => json(res, { messageId: '1', status: 'queued', createdAt: 'now' });
    const body = { recipientUserId: '1', title: 'Task', content: 'Hello', type: 'business', idempotencyKey: 'intent-1', channels };
    const response = await sdk().notifications.send(body as Parameters<ReturnType<typeof sdk>['notifications']['send']>[0]);
    expect(response.messageId).toBe('1');
    expect(JSON.parse(received[0].body).channels).toEqual(expected);
    expect(body.channels).toEqual(channels);
  });
  it('rejects Desktop-only channels before network access', async () => {
    await expect(sdk().notifications.send({ channels: ['desktop'] } as never)).rejects.toThrow('channels');
    expect(received).toHaveLength(0);
  });
  it('routes agent and workspace members through generated contracts', async () => {
    await sdk().agent.jobs.list({ page: 1, size: 10 });
    await sdk().members.listWorkspace();
    expect(received.map(x => x.url)).toEqual(['/openapi/v1/agent/jobs/list', '/openapi/v1/platform/getMembers']);
    expect('launchpad' in sdk().api).toBe(false);
    expect('flow' in sdk()).toBe(false);
  });
  it('lists App access members by explicit appId and rejects undetermined lists as 503', async () => {
    const source = { type: 'group', groupId: 'g-1', groupName: 'Line A' };
    respond = res => json(res, { code: 200, msg: '', data: {
      appId: 'app-1', published: 1, productionVersionId: 'v-1', allActiveMembers: 2,
      roles: [{ roleId: 'r-1', roleKey: 'operator', roleName: 'Operator', status: 'active', memberCount: 1 }],
      list: [{ userId: '42', userName: 'alice', grantedAt: 1700000050000, roles: [{ roleId: 'r-1', roleKey: 'operator', roleName: 'Operator', sources: [source] }] }],
      total: 1, page: 1, size: 20,
    } });
    const request = { appId: 'app-1', roleKeys: ['operator'], grantedAtStart: 1700000000000, page: 1, size: 20 };
    const page = await sdk().members.listApp(request);
    expect(received[0]).toMatchObject({ method: 'POST', url: '/openapi/v1/apps/access-members/list' });
    expect(JSON.parse(received[0].body)).toEqual(request);
    expect(page.list[0]).toMatchObject({ userId: '42', grantedAt: 1700000050000 });
    expect(page.list[0].roles[0].sources).toEqual([source]);
    expect('apps' in sdk().api).toBe(false);
    for (const code of [3003016, 3003017]) {
      respond = res => json(res, { code, msg: 'App access list is unavailable' }, 503);
      await expect(sdk().members.listApp({ appId: 'app-1' })).rejects.toMatchObject({ status: 503, code });
    }
  });
  it('encodes path and query values once', async () => {
    respond = res => json(res, { code: 200, msg: '', data: { fileUrl: 'https://storage.invalid/f' } });
    await sdk().files.url({ filePath: 'folder/a & #%2F.pdf', expiredSec: 30 });
    expect(received[0].url).toBe('/openapi/v1/assets/files/url?filePath=folder%2Fa+%26+%23%252F.pdf&expiredSec=30');
  });
  it('keeps credentials isolated across concurrent instances and snapshots configuration', async () => {
    const config = { apiHost, apiKey: 'first-key' };
    const first = createClient(config);
    config.apiKey = 'second-key';
    await Promise.all([first.system.whoami(), createClient(config).system.whoami()]);
    expect(received.map(x => x.headers['x-api-key']).sort()).toEqual(['first-key', 'second-key']);
  });
  it('does not follow redirects with API credentials', async () => {
    respond = res => { res.writeHead(302, { location: apiHost + '/credential-trap' }); res.end(); };
    await expect(sdk().system.whoami()).rejects.toMatchObject({ status: 302 });
    expect(received).toHaveLength(1);
  });
  it('marks a malformed mutation response as an unknown outcome without replay', async () => {
    respond = res => res.end('broken JSON');
    await expect(sdk().mqttAuth.create({ name: 'fixture' })).rejects.toMatchObject({ outcomeUnknown: true, errorCode: 'SDK_PROTOCOL' });
    expect(received).toHaveLength(1);
  });
  it('rejects malformed envelopes without returning undefined', async () => {
    respond = res => json(res, { code: 200, msg: '' });
    await expect(sdk().system.whoami()).rejects.toBeInstanceOf(TransportError);
  });
  it('does not send requests cancelled before execution', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(sdk().system.whoami({ signal: controller.signal })).rejects.toMatchObject({ errorCode: 'SDK_ABORTED', outcomeUnknown: false });
    await expect(sdk().uns.recordFind({ collectionId: 'orders' }, { signal: controller.signal })).rejects.toThrow();
    expect(received).toHaveLength(0);
  });
  it('bounds custom fetch implementations that ignore AbortSignal', async () => {
    let calls = 0;
    const client = createClient({ apiHost, transportTimeoutMs: 30, fetch: async () => { calls++; return new Promise<Response>(() => undefined); } });
    await expect(client.mqttAuth.create({ name: 'fixture' })).rejects.toMatchObject({ errorCode: 'SDK_TIMEOUT', outcomeUnknown: true });
    expect(calls).toBe(1);
  });
  it('allows cancellation of an in-flight UNS write and never retries it', async () => {
    let calls = 0;
    const client = createClient({ apiHost, fetch: async () => { calls++; return new Promise<Response>(() => undefined); } });
    const controller = new AbortController();
    const promise = client.uns.recordInsertOne({ collectionId: 'orders', data: {} }, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'UNS_V2_TRANSPORT_ABORTED', outcomeUnknown: true });
    expect(calls).toBe(1);
  });
  it('keeps retired and internal routes outside the generated SDK', () => {
    expect(Object.values(OPENAPI_OPERATIONS)).toHaveLength(51);
    for (const op of Object.values(OPENAPI_OPERATIONS)) {
      expect(op.path).not.toMatch(/\/gw\/|\/uns\/|\/flow\/|\/launchpad\//);
    }
  });
});
