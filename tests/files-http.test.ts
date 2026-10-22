import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { createClient, MultipartUploadError } from '../src/index.js';

let platformReply: (url: string, body: string) => unknown;
let storageReply: (res: ServerResponse) => void;
const storageRequests: { headers: IncomingMessage['headers']; body: string; url: string }[] = [];
const platformRequests: { headers: IncomingMessage['headers']; body: string; url: string }[] = [];
const platform = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  platformRequests.push({ headers: req.headers, body, url: req.url! });
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ code: 200, msg: '', data: platformReply(req.url!, body) }));
});
const storage = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  storageRequests.push({ headers: req.headers, body, url: req.url! }); storageReply(res);
});
let apiHost: string, storageHost: string;
const listen = async (s: ReturnType<typeof createServer>) => {
  await new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
};
beforeAll(async () => { apiHost = await listen(platform); storageHost = await listen(storage); });
afterAll(async () => { for (const s of [platform, storage]) { s.closeAllConnections(); await new Promise<void>(resolve => s.close(() => resolve())); } });
beforeEach(() => { storageRequests.length = 0; platformRequests.length = 0; storageReply = res => { res.writeHead(204); res.end(); }; });
const sdk = () => createClient({ apiHost, apiKey: 'platform-only-key' });
it('uploads signed form fields before the file without leaking platform credentials', async () => {
  platformReply = () => ({ filePath: 'saved/report.txt', postUrl: storageHost + '/upload', postFields: { policy: 'fixture-policy', key: 'saved/report.txt' } });
  const saved = await sdk().files.upload(new File(['report-data'], 'report.txt', { type: 'text/plain' }));
  expect(saved.filePath).toBe('saved/report.txt');
  expect(platformRequests[0].headers['x-api-key']).toBe('platform-only-key');
  expect(storageRequests[0].headers['x-api-key']).toBeUndefined();
  expect(storageRequests[0].headers.authorization).toBeUndefined();
  expect(storageRequests[0].body.indexOf('name="policy"')).toBeLessThan(storageRequests[0].body.indexOf('name="file"'));
  expect(storageRequests[0].body).toContain('report-data');
});
it('downloads via a signed URL without following an authenticated gateway redirect', async () => {
  platformReply = () => ({ fileUrl: storageHost + '/download' });
  storageReply = res => { res.setHeader('content-type', 'text/plain'); res.end('download-content'); };
  const response = await sdk().files.download({ filePath: 'saved/report.txt' });
  expect(await response.text()).toBe('download-content');
  expect(platformRequests[0].url).toContain('/files/url?');
  expect(storageRequests[0].headers.authorization).toBeUndefined();
  expect(storageRequests[0].headers['x-api-key']).toBeUndefined();
});
it('returns the actual deletion result', async () => {
  platformReply = () => ({ deleted: false });
  expect(await sdk().files.delete({ filePath: 'missing.txt' })).toEqual({ deleted: false });
});
it('performs multipart upload once, passes ETags and preserves completion uncertainty', async () => {
  const size = 5 * 1024 * 1024;
  platformReply = (url, body) => {
    if (url.endsWith('/init')) return { fileKey: 'key', filePath: 'file', uploadId: 'upload', partSize: size, partCount: 1, expiresAt: 1 };
    if (url.endsWith('/part-urls')) return { partUrls: [{ partNumber: 1, url: storageHost + '/part', expiresAt: 1 }] };
    if (url.endsWith('/complete')) { expect(JSON.parse(body).parts).toEqual([{ partNumber: 1, etag: 'part-etag' }]); return { filePath: 'saved', sizeBytes: 1 }; }
    throw new Error('Unexpected path');
  };
  storageReply = res => { res.setHeader('etag', 'part-etag'); res.end(); };
  const result = await sdk().files.uploadMultipart(new File(['x'], 'data.bin'), { partSize: size });
  expect(result.filePath).toBe('saved');
  expect(platformRequests).toHaveLength(3);
  expect(storageRequests).toHaveLength(1);
  platformReply = url => url.endsWith('/init') ? { fileKey: 'key', filePath: 'file', uploadId: 'upload', partSize: size, partCount: 1 } : { partUrls: [] };
  const failure = await sdk().files.uploadMultipart(new File(['x'], 'data.bin'), { partSize: size }).catch(e => e);
  expect(failure).toBeInstanceOf(MultipartUploadError);
  expect(failure.session).toMatchObject({ uploadId: 'upload', completionAttempted: false });
  expect(platformRequests.filter(r => r.url.endsWith('/abort'))).toHaveLength(0);
});
