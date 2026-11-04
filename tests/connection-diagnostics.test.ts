import { describe, expect, it, vi } from 'vitest';
import { ApiError, createClient, createUnsV2Client, UnsV2Error, UnsV2OutcomeUnknownError } from '../src/index.js';
import { HttpClient } from '../src/openapi/client.js';

const apiHost = 'https://private-gateway.invalid/custom-prefix';
const apiKey = 'credential-must-not-appear';
const responseBody = '<html>private proxy diagnostic</html>';
const fixture = (status: number) => {
  const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(responseBody, { status, headers: { 'content-type': 'text/html' } }));
  const config = { apiHost, apiKey, fetch };
  return { client: createClient(config), raw: createUnsV2Client(() => new HttpClient(config)), fetch };
};

const calls: { name: string; call: (context: ReturnType<typeof fixture>) => Promise<unknown>; error: typeof Error }[] = [
  { name: 'whoami', call: ({ client }) => client.system.whoami(), error: ApiError },
  { name: 'collection records', call: ({ client }) => client.uns.recordFind({ collectionId: 'existing', limit: 1 }), error: UnsV2Error },
  { name: 'record subscription', call: ({ raw }) => raw.subscribeRecords({ collectionIds: ['existing'] }).next(), error: UnsV2Error },
];

describe.each(calls)('$name connection diagnostics', ({ call, error }) => {
  it.each([
    [404, 'OpenAPI gateway base URL'],
    [405, 'OpenAPI gateway base URL'],
    [401, 'API key is present, valid'],
    [403, 'permissions for this operation'],
    [502, 'temporarily unavailable'],
    [503, 'temporarily unavailable'],
    [504, 'temporarily unavailable'],
  ] as const)('explains non-JSON HTTP %i without exposing secrets or changing the destination', async (status, hint) => {
    const context = fixture(status);
    const { fetch } = context;
    let caught: unknown;
    try { await call(context); } catch (value) { caught = value; }
    expect(caught).toBeInstanceOf(error);
    expect(caught).toMatchObject({ status, message: expect.stringContaining(hint) });
    const message = (caught as Error).message;
    for (const secret of [apiHost, apiKey, responseBody, 'private proxy diagnostic']) expect(message).not.toContain(secret);
    if (status === 404) {
      expect(message).toContain('apiHost / TIER0_API_HOST');
      expect(message).toContain('deployment guide or administrator');
      expect(message).not.toContain('API key is');
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toEqual(expect.stringMatching(/^https:\/\/private-gateway\.invalid\/custom-prefix\/openapi\/v2\//));
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
    if (caught instanceof UnsV2Error) {
      expect(caught.code).toBe('UNS_V2_PROTOCOL_ERROR');
      expect(caught.execution).toBe(status < 500 ? 'notStarted' : 'rolledBack');
      expect(caught.retry.safe).toBe(status >= 500);
    } else {
      expect(caught).toMatchObject({ code: 0 });
    }
  });
});

it('keeps a write outcome unknown when an unavailable service returns HTML', async () => {
  const { client, fetch } = fixture(503);
  await expect(client.uns.recordInsertOne({ collectionId: 'existing', data: { name: 'test' } }))
    .rejects.toMatchObject({
      name: UnsV2OutcomeUnknownError.name,
      message: expect.stringContaining('Before repeating a write, check whether it committed'),
      status: 503, code: 'UNS_V2_PROTOCOL_ERROR', execution: 'unknown', retry: { safe: false },
    });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('preserves a JSON resource-not-found error instead of suggesting a different gateway', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ code: 404, msg: 'Collection not found', requestId: 'req-existing',
    error: { code: 'NOT_FOUND', details: [], execution: 'notStarted', retry: { safe: false } } }), { status: 404 }));
  const client = createClient({ apiHost, apiKey, fetch });
  await expect(client.uns.recordFind({ collectionId: 'missing', limit: 1 })).rejects.toMatchObject({
    message: 'Collection not found', status: 404, code: 'NOT_FOUND', requestId: 'req-existing',
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('preserves a JSON platform permission error', async () => {
  const client = createClient({ apiHost, apiKey, fetch: async () => new Response(JSON.stringify({
    code: 40301, msg: 'No access to this operation', errorCode: 'FORBIDDEN',
  }), { status: 403 }) });
  await expect(client.system.whoami()).rejects.toMatchObject({
    status: 403, code: 40301, errorCode: 'FORBIDDEN', message: 'HTTP 403: No access to this operation',
  });
});

it('also explains malformed responses from the raw HTTP client', async () => {
  const http = new HttpClient({ apiHost, apiKey, fetch: async () => new Response(responseBody, { status: 404 }) });
  await expect(http.post('/openapi/v2/auth/whoami', {})).rejects.toMatchObject({
    status: 404, message: expect.stringContaining('apiHost / TIER0_API_HOST'),
  });
});
