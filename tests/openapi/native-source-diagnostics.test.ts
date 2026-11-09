import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '../../src/index.js';

// Replay actual backend run evidence through the real SDK HTTP decoder; no remote call occurs.
const paths = (process.env.STREAM_ERROR_FIXTURES ?? '').split(delimiter).filter(Boolean);
if (!paths.length) paths.push(fileURLToPath(new URL('../fixtures/native-source-run.json', import.meta.url)));
const fixtures = paths.map(path => {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  // The backend exporter returns the real public data payload; only the HTTP envelope is test-owned.
  const envelope = Array.isArray(value.items)
    ? { code: 200, msg: '', requestId: 'local-replay-envelope', data: value }
    : value;
  return { path, raw: JSON.stringify(envelope) };
});
// Consumer control only: this is not evidence from an actual backend or driver failure.
fixtures.push({
  path: 'consumer-control-native-error',
  raw: JSON.stringify({ code: 200, msg: '', requestId: 'consumer-control-envelope', data: { items: [{
    id: 'control:9001', release: '1', entryId: 'collect', createdAt: 1100, status: 'unknown',
    error: { code: 'RESULT_UNKNOWN', stage: 'unknown', message: 'The outcome is unknown.', repair: '' },
    diagnostics: { hostError: {
      code: 'VendorFutureStatus_47', stage: 'source_query', repair: '',
      message: 'native driver failure\nSQL: SELECT ' + '"温度明细", '.repeat(700)
        + '"final_column" FROM sensor_history\nDETAIL: original line breaks and Unicode must survive.\nPOSITION: 4182',
    } },
  }] } }),
});
let response = '';
const received: string[] = [];
const server = createServer(async (req, res) => {
  for await (const _ of req) { /* Drain the SDK request. */ }
  received.push(req.url ?? '');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(response);
});
let apiHost = '';
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  apiHost = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe('actual backend Stream failures over local SDK HTTP', () => {
  it.each(fixtures)('$path preserves every public run field without retrying or claiming success', async ({ path, raw }) => {
    response = raw;
    const expected = JSON.parse(raw);
    expect(expected.data.items.length).toBeGreaterThan(0);
    const start = received.length;
    const client = createClient({ apiHost, apiKey: 'local-replay-only', transportTimeoutMs: 2000 });
    try {
      const actual = await client.stream.runs.list({ id: '42', size: 50 });
      expect(actual.data).toEqual(expected.data);
      if (expected.requestId !== undefined) expect(actual.requestId).toBe(expected.requestId);
      expect(received.slice(start)).toEqual(['/openapi/v2/uns/streams/runs/list']);
      for (const run of actual.data.items) {
        expect(['completed', 'succeeded', 'failed', 'unknown', 'partial-failure', 'result-unknown']).toContain(run.status);
        if (run.status !== 'completed' && run.status !== 'succeeded') {
          expect(run.error?.code).toBeTruthy();
          expect(run.error?.stage).toBeTruthy();
          expect(run.error?.message).toBeTruthy();
        }
      }
      console.info(JSON.stringify({ evidence: basename(path), requests: 1, runs: actual.data.items.map(run => ({ id: run.id, status: run.status, error: run.error, diagnostics: run.diagnostics })) }));
    } finally {
      await client.dispose();
    }
  });
});
