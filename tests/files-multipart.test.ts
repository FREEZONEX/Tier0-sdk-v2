import { afterEach, expect, it, vi } from 'vitest';
import { createFilesClient, MultipartUploadError, type MultipartProgress, type MultipartSession } from '../src/files.js';

const PART_SIZE = 5 * 1024 * 1024;
const makeFile = (size = 1, name = 'report.bin') => new File([new Uint8Array(size)], name);
const partResponse = (part: number) => new Response(null, { headers: { etag: `etag-${part}` } });
const envelope = (data: unknown) => Response.json({ code: 200, msg: '', data });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
type PlatformCall = { operation: string; body: Record<string, any> };
afterEach(() => vi.useRealTimers());
function fixture(file: File, serverPartSize = PART_SIZE, transportTimeoutMs = 60_000) {
  const platform: PlatformCall[] = [];
  const puts: { part: number; init: RequestInit; url: string }[] = [];
  const handlers = {
    put: async (part: number, _init: RequestInit): Promise<Response> => partResponse(part),
    platform: async (_call: PlatformCall): Promise<Response | undefined> => undefined,
  };
  const client = createFilesClient({
    apiHost: 'https://platform.fixture.invalid', apiKey: 'platform-only-key', transportTimeoutMs,
    fetch: async (input, init = {}) => {
      const url = new URL(String(input));
      const headers = new Headers(init.headers);
      if (url.hostname === 'storage.fixture.invalid') {
        expect(headers.has('authorization')).toBe(false);
        expect(headers.has('x-api-key')).toBe(false);
        expect(init.credentials).toBe('omit');
        expect(init.redirect).toBe('error');
        expect(init.method).toBe('PUT');
        const part = Number(url.pathname.slice(1));
        puts.push({ part, init, url: url.href });
        return handlers.put(part, init);
      }
      expect(headers.get('x-api-key')).toBe('platform-only-key');
      const call = { operation: url.pathname.split('/').at(-1)!, body: JSON.parse(String(init.body)) };
      platform.push(call);
      const overridden = await handlers.platform(call);
      if (overridden) return overridden;
      if (call.operation === 'init') return envelope({ fileKey: 'key', filePath: 'saved/report.bin', uploadId: 'upload', partSize: serverPartSize, partCount: Math.ceil(file.size / serverPartSize), expiresAt: 1 });
      if (call.operation === 'part-urls') return envelope({ partUrls: call.body.partNumbers.map((partNumber: number) => ({ partNumber, url: `https://storage.fixture.invalid/${partNumber}`, expiresAt: 1 })) });
      if (call.operation === 'complete') return envelope({ filePath: 'saved/report.bin', sizeBytes: file.size });
      throw new Error(`Unexpected operation: ${call.operation}`);
    },
  });
  return { client, handlers, platform, puts, calls: (operation: string) => platform.filter(call => call.operation === operation) };
}
function resumable(file: File): MultipartSession {
  return { fileKey: 'key', uploadId: 'upload', parts: [], completionAttempted: false, partSize: PART_SIZE, fileName: file.name, fileSize: file.size };
}

it.each(['timeout', 'cancel'] as const)('bounds an uncooperative PUT on %s and ignores its late success', async failure => {
  vi.useFakeTimers();
  const file = makeFile();
  const f = fixture(file, PART_SIZE, 10);
  const late = deferred<Response>();
  f.handlers.put = () => late.promise;
  const controller = new AbortController();
  const result = f.client.uploadMultipart(file, { maxRetries: 0, signal: controller.signal }).catch(error => error as MultipartUploadError);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.puts).toHaveLength(1);
  if (failure === 'cancel') controller.abort();
  else await vi.advanceTimersByTimeAsync(10);
  const error = await result as MultipartUploadError;
  expect(error).toBeInstanceOf(MultipartUploadError);
  expect(error.cause).toMatchObject({ errorCode: failure === 'cancel' ? 'SDK_ABORTED' : 'SDK_TIMEOUT' });
  expect(error.session.parts).toEqual([]);
  expect(error.session.completionAttempted).toBe(false);
  expect(f.puts[0].init.signal?.aborted).toBe(true);
  late.resolve(partResponse(1));
  await vi.advanceTimersByTimeAsync(1000);
  expect(error.session.parts).toEqual([]);
  expect(f.puts).toHaveLength(1);
  expect(f.calls('complete')).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('retries a timed-out PUT with the identical part and commits only the successful attempt', async () => {
  vi.useFakeTimers();
  const file = makeFile();
  const f = fixture(file, PART_SIZE, 10);
  f.handlers.put = part => f.puts.length === 1 ? new Promise<Response>(() => {}) : Promise.resolve(partResponse(part));
  const result = f.client.uploadMultipart(file, { maxRetries: 1 });
  await vi.advanceTimersByTimeAsync(110);
  await expect(result).resolves.toMatchObject({ filePath: 'saved/report.bin' });
  expect(f.puts).toHaveLength(2);
  expect(f.puts[0].url).toBe(f.puts[1].url);
  expect(f.puts[0].init.body).toBe(f.puts[1].init.body);
  expect(f.calls('complete')[0].body.parts).toEqual([{ partNumber: 1, etag: 'etag-1' }]);
  expect(vi.getTimerCount()).toBe(0);
});

it('explicitly uploads a small file in parts without putting transfer options into metadata', async () => {
  const file = makeFile();
  const f = fixture(file);
  const progress: MultipartProgress[] = [];
  await f.client.upload(file, { business: 'reports', visibility: 'private', multipart: { partSize: PART_SIZE, concurrency: 2, maxRetries: 0, onProgress: value => progress.push(value) } });
  expect(f.calls('init')[0].body).toEqual({ business: 'reports', visibility: 'private', fileName: file.name, size: file.size, contentType: 'application/octet-stream', partSize: PART_SIZE });
  expect(f.calls('files')).toHaveLength(0);
  expect(progress).toEqual([{ uploadedBytes: 1, totalBytes: 1, doneParts: 1, totalParts: 1, percent: 100 }]);
  expect(f.calls('complete')).toHaveLength(1);
});

it('limits default concurrency to four and completes sorted parts after all uploads finish', async () => {
  const file = makeFile(PART_SIZE * 5 + 1);
  const f = fixture(file);
  const releases = Array.from({ length: 6 }, () => deferred<Response>());
  let active = 0, maximum = 0;
  f.handlers.put = async part => {
    maximum = Math.max(maximum, ++active);
    const response = await releases[part - 1].promise;
    active--;
    return response;
  };
  const progress: MultipartProgress[] = [];
  const upload = f.client.uploadMultipart(file, { partSize: PART_SIZE, onProgress: value => progress.push(value) });
  await vi.waitFor(() => expect(f.puts).toHaveLength(4));
  expect(f.calls('complete')).toHaveLength(0);
  releases[3].resolve(partResponse(4));
  await vi.waitFor(() => expect(f.puts).toHaveLength(5));
  releases[4].resolve(partResponse(5));
  await vi.waitFor(() => expect(f.puts).toHaveLength(6));
  for (const part of [6, 3, 2, 1]) releases[part - 1].resolve(partResponse(part));
  await expect(upload).resolves.toMatchObject({ filePath: 'saved/report.bin' });
  expect(maximum).toBe(4);
  expect(progress[0]).toEqual({ uploadedBytes: PART_SIZE, totalBytes: file.size, doneParts: 1, totalParts: 6, percent: PART_SIZE / file.size * 100 });
  expect(progress.at(-1)).toEqual({ uploadedBytes: file.size, totalBytes: file.size, doneParts: 6, totalParts: 6, percent: 100 });
  expect(f.calls('complete')).toHaveLength(1);
  expect(f.calls('complete')[0].body.parts).toEqual(Array.from({ length: 6 }, (_, i) => ({ partNumber: i + 1, etag: `etag-${i + 1}` })));
});

it('drains in-flight parts before returning a stable session and resumes only missing parts', async () => {
  const file = makeFile(PART_SIZE * 3 + 1);
  const f = fixture(file);
  const failedPart = deferred<Response>();
  const secondPart = deferred<Response>();
  f.handlers.put = part => part === 1 ? failedPart.promise : secondPart.promise;
  let settled = false;
  const interrupted = f.client.uploadMultipart(file, { partSize: PART_SIZE, concurrency: 2 }).catch(error => { settled = true; return error as MultipartUploadError; });
  await vi.waitFor(() => expect(f.puts).toHaveLength(2));
  failedPart.resolve(new Response(null, { status: 403 }));
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(settled).toBe(false);
  expect(f.puts.map(part => part.part)).toEqual([1, 2]);
  secondPart.resolve(partResponse(2));
  const error = await interrupted as MultipartUploadError;
  expect(error).toBeInstanceOf(MultipartUploadError);
  expect(error.session).toEqual({ ...resumable(file), parts: [{ partNumber: 2, etag: 'etag-2' }] });
  expect(f.calls('complete')).toHaveLength(0);
  expect(f.calls('abort')).toHaveLength(0);

  f.handlers.put = async part => partResponse(part);
  const progress: MultipartProgress[] = [];
  await f.client.resumeMultipart(file, error.session, { concurrency: 1, onProgress: value => progress.push(value) });
  expect(f.calls('init')).toHaveLength(1);
  expect(f.puts.map(part => part.part)).toEqual([1, 2, 1, 3, 4]);
  expect(progress[0]).toMatchObject({ uploadedBytes: PART_SIZE * 2, doneParts: 2, totalParts: 4 });
  expect(progress.at(-1)).toMatchObject({ uploadedBytes: file.size, doneParts: 4, percent: 100 });
  expect(f.calls('complete')).toHaveLength(1);
  expect(error.session).toEqual({ ...resumable(file), parts: [{ partNumber: 2, etag: 'etag-2' }] });
});

it('retains server part size for resume even when it differs from the requested size', async () => {
  const serverSize = PART_SIZE + 1024 * 1024;
  const file = makeFile(serverSize + 1);
  const f = fixture(file, serverSize);
  f.handlers.put = async part => part === 2 ? new Response(null, { status: 401 }) : partResponse(part);
  const error = await f.client.uploadMultipart(file, { partSize: PART_SIZE, concurrency: 1 }).catch(error => error) as MultipartUploadError;
  expect(error.session.partSize).toBe(serverSize);
  f.handlers.put = async part => partResponse(part);
  await f.client.resumeMultipart(file, error.session);
  expect(f.puts.map(part => (part.init.body as Blob).size)).toEqual([serverSize, 1, 1]);
  expect(f.calls('init')).toHaveLength(1);
  expect(f.calls('complete')).toHaveLength(1);
});

it('never replays a completion with an unknown outcome, including through resume', async () => {
  const file = makeFile();
  const f = fixture(file);
  f.handlers.platform = async call => {
    if (call.operation === 'complete') throw new TypeError('response lost');
    return undefined;
  };
  const error = await f.client.uploadMultipart(file, { maxRetries: 3 }).catch(error => error) as MultipartUploadError;
  expect(error).toBeInstanceOf(MultipartUploadError);
  expect(error.session.completionAttempted).toBe(true);
  expect(f.calls('complete')).toHaveLength(1);
  const requests = f.platform.length;
  await expect(f.client.resumeMultipart(file, error.session)).rejects.toThrow('Reconcile');
  expect(f.platform).toHaveLength(requests);
  expect(f.calls('abort')).toHaveLength(0);
});

it.each([401, 403, 400, 404])('does not retry a permanent storage HTTP %s failure', async status => {
  const file = makeFile();
  const f = fixture(file);
  f.handlers.put = async () => new Response(null, { status });
  await expect(f.client.uploadMultipart(file, { maxRetries: 3 })).rejects.toBeInstanceOf(MultipartUploadError);
  expect(f.puts).toHaveLength(1);
  expect(f.calls('complete')).toHaveLength(0);
});

it.each(['network', 429, 503] as const)('retries only the same storage PUT on transient %s failure', async failure => {
  const file = makeFile();
  const f = fixture(file);
  f.handlers.put = async part => {
    if (f.puts.length === 1) {
      if (failure === 'network') throw new TypeError('connection interrupted');
      return new Response(null, { status: failure });
    }
    return partResponse(part);
  };
  await f.client.uploadMultipart(file, { maxRetries: 1 });
  expect(f.puts).toHaveLength(2);
  expect(f.puts[0].url).toBe(f.puts[1].url);
  expect(f.puts[0].init.body).toBe(f.puts[1].init.body);
  for (const operation of ['init', 'part-urls', 'complete']) expect(f.calls(operation)).toHaveLength(1);
});

it.each(['init', 'part-urls'])('never automatically replays platform %s calls', async operation => {
  const file = makeFile();
  const f = fixture(file);
  f.handlers.platform = async call => call.operation === operation ? new Response(null, { status: 503 }) : undefined;
  await expect(f.client.uploadMultipart(file, { maxRetries: 3 })).rejects.toThrow();
  expect(f.calls(operation)).toHaveLength(1);
  expect(f.puts).toHaveLength(0);
  expect(f.calls('complete')).toHaveLength(0);
});

it('honors cancellation before initialization and while uploading without retry or completion', async () => {
  const file = makeFile();
  const f = fixture(file);
  const aborted = AbortSignal.abort();
  await expect(f.client.uploadMultipart(file, { signal: aborted })).rejects.toThrow();
  expect(f.platform).toHaveLength(0);
  const controller = new AbortController();
  f.handlers.put = async (_part, init) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    controller.abort();
  });
  await expect(f.client.uploadMultipart(file, { signal: controller.signal, maxRetries: 3 })).rejects.toBeInstanceOf(MultipartUploadError);
  expect(f.puts).toHaveLength(1);
  expect(f.calls('complete')).toHaveLength(0);
});

it('cancels a retry delay without another PUT', async () => {
  const file = makeFile();
  const f = fixture(file);
  const controller = new AbortController();
  f.handlers.put = async () => new Response(null, { status: 503 });
  const upload = f.client.uploadMultipart(file, { signal: controller.signal, maxRetries: 3 });
  const rejected = expect(upload).rejects.toBeInstanceOf(MultipartUploadError);
  await vi.waitFor(() => expect(f.puts).toHaveLength(1));
  controller.abort();
  await rejected;
  expect(f.puts).toHaveLength(1);
  expect(f.calls('complete')).toHaveLength(0);
});

it('rejects incomplete or incompatible resume sessions locally', async () => {
  const file = makeFile();
  const f = fixture(file);
  const original = resumable(file);
  const invalid: MultipartSession[] = [
    { ...original, partSize: undefined }, { ...original, fileSize: undefined },
    { ...original, fileName: undefined }, { ...original, fileName: 'different.bin' },
    { ...original, fileSize: 2 }, { ...original, completionAttempted: true },
    { ...original, parts: [{ partNumber: 1, etag: '' }] },
    { ...original, parts: [{ partNumber: 0, etag: 'etag' }] },
    { ...original, parts: [{ partNumber: 2, etag: 'etag' }] },
    { ...original, parts: [{ partNumber: 1, etag: 'etag' }, { partNumber: 1, etag: 'etag' }] },
  ];
  for (const session of invalid) await expect(f.client.resumeMultipart(file, session)).rejects.toBeInstanceOf(TypeError);
  expect(f.platform).toHaveLength(0);
  expect(f.puts).toHaveLength(0);
});

it('resumes an uploaded session directly to one completion without reinitialization', async () => {
  const file = makeFile();
  const f = fixture(file);
  await f.client.resumeMultipart(file, { ...resumable(file), parts: [{ partNumber: 1, etag: 'etag-1' }] });
  expect(f.platform.map(call => call.operation)).toEqual(['complete']);
  expect(f.puts).toHaveLength(0);
});
