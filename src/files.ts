import { HttpClient, ApiError, TransportError, type ClientConfig, type RequestOptions } from './openapi/client.js';
import { createOpenAPI } from './openapi/api.generated.js';
import type { components } from './openapi/types.generated.js';

type Schemas = components['schemas'];
export type UploadOptions = Omit<Schemas['AssetFileUploadReq'], 'fileName' | 'contentType' | 'size'> & RequestOptions & { multipart?: MultipartSettings };
export type UploadResult = Schemas['AssetFileUploadResp'];
export type MultipartResult = Schemas['AssetFileMultipartCompleteResp'];
export interface MultipartProgress {
  uploadedBytes: number;
  totalBytes: number;
  doneParts: number;
  totalParts: number;
  percent: number;
}
export interface ResumeMultipartOptions extends RequestOptions {
  concurrency?: number;
  maxRetries?: number;
  onProgress?: (progress: MultipartProgress) => void;
}
export interface MultipartSettings extends Omit<ResumeMultipartOptions, 'signal'> {
  partSize?: number;
}
export interface MultipartOptions extends Omit<UploadOptions, 'multipart'>, MultipartSettings {}
export interface MultipartSession {
  fileKey: string;
  uploadId: string;
  parts: Schemas['AssetFileMultipartPart'][];
  completionAttempted: boolean;
  // 可选字段保留旧会话类型兼容；续传时必须有完整的文件与切片信息。
  partSize?: number;
  fileName?: string;
  fileSize?: number;
}
export class MultipartUploadError extends Error {
  constructor(readonly session: MultipartSession, readonly cause: unknown) {
    super('Multipart upload interrupted. The session is retained; reconcile completion before retrying or aborting.');
    this.name = 'MultipartUploadError';
  }
}
export const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024;
export const DEFAULT_MULTIPART_PART_SIZE = 8 * 1024 * 1024;
export const DEFAULT_MULTIPART_CONCURRENCY = 4;
export const DEFAULT_MULTIPART_MAX_RETRIES = 3;

function positiveSafe(value: number | bigint, name: string): number {
  const n = Number(value);
  if (!['number', 'bigint'].includes(typeof value) || !Number.isSafeInteger(n) || n <= 0) throw new TypeError(`Invalid ${name}`);
  return n;
}
function validateFile(file: File): void {
  if (!file || typeof file.name !== 'string' || !file.name || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.slice !== 'function') throw new TypeError('A File is required');
}
function storageURL(value: string): string {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Invalid signed storage URL');
  return url.href;
}
function transferOptions(options: ResumeMultipartOptions) {
  const { concurrency = DEFAULT_MULTIPART_CONCURRENCY, maxRetries = DEFAULT_MULTIPART_MAX_RETRIES } = options;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new TypeError('concurrency must be a positive safe integer');
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) throw new TypeError('maxRetries must be a non-negative safe integer');
  if (options.onProgress !== undefined && typeof options.onProgress !== 'function') throw new TypeError('onProgress must be a function');
  return { concurrency, maxRetries };
}
function retryablePart(error: unknown): boolean {
  if (error instanceof TransportError) return error.errorCode === 'SDK_TIMEOUT';
  if (error instanceof ApiError) return [408, 429, 500, 502, 503, 504].includes(error.status);
  return error instanceof TypeError || (error instanceof Error && error.name === 'AbortError');
}
function retryDelay(attempt: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, Math.min(100 * 2 ** Math.min(attempt, 5), 3000));
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** All platform requests are scoped to this instance; storage requests never carry its API key. */
export class FilesClient {
  private readonly api;
  readonly multipart;
  constructor(private readonly http: HttpClient) {
    this.api = createOpenAPI(http).assets.files;
    this.multipart = this.api.multipart;
  }

  private async storage(urlString: string, init: RequestInit, options: RequestOptions = {}): Promise<Response> {
    const url = storageURL(urlString);
    options.signal?.throwIfAborted();
    const controller = new AbortController();
    let expired = false;
    let started = false;
    let rejectStopped: (error: Error) => void = () => undefined;
    const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
    const failure = () => new TransportError(expired ? 'TIMEOUT' : 'ABORTED', started && init.method !== 'GET');
    const abort = () => { rejectStopped(failure()); controller.abort(options.signal?.reason); };
    const timer = setTimeout(() => { expired = true; abort(); }, this.http.timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    const exchange = async () => {
      if (controller.signal.aborted) throw failure();
      started = true;
      const response = await this.http.getFetch()(url, { ...init, signal: controller.signal, credentials: 'omit', redirect: 'error' });
      // 忽略 AbortSignal 的自定义 fetch 晚返回也不能改变已交还的分片会话。
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => undefined);
        throw failure();
      }
      if (!response.ok) throw new ApiError(response.status, 0, 'Object storage request failed');
      return response;
    };
    try {
      if (options.signal?.aborted) abort();
      return await Promise.race([exchange(), stopped]);
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }

  async upload(file: File, options: UploadOptions = {}): Promise<UploadResult | MultipartResult> {
    validateFile(file);
    const { signal, multipart, ...metadata } = options;
    if (file.size > MULTIPART_THRESHOLD_BYTES || multipart !== undefined) return this.uploadMultipart(file, { ...metadata, ...multipart, signal });
    const prepared = await this.api.prepareUpload({ ...metadata, fileName: file.name, size: file.size, contentType: file.type || 'application/octet-stream' }, { signal });
    if (!prepared.postUrl || !prepared.filePath || !prepared.postFields) throw new ApiError(200, 0, 'Invalid upload preparation response');
    const form = new FormData();
    for (const [name, value] of Object.entries(prepared.postFields)) form.append(name, value);
    form.append('file', file);
    await this.storage(prepared.postUrl, { method: 'POST', body: form }, { signal });
    return prepared;
  }

  async uploadMultipart(file: File, options: MultipartOptions = {}): Promise<MultipartResult> {
    validateFile(file);
    if (file.size === 0) throw new TypeError('Multipart upload requires a non-empty file');
    const { signal, partSize = DEFAULT_MULTIPART_PART_SIZE, onProgress, concurrency, maxRetries, ...metadata } = options;
    transferOptions(options);
    if (!Number.isSafeInteger(partSize) || partSize < 5 * 1024 * 1024) throw new TypeError('partSize must be at least 5 MiB');
    signal?.throwIfAborted();
    const start = await this.multipart.init({ ...metadata, fileName: file.name, contentType: file.type || 'application/octet-stream', size: file.size, partSize }, { signal });
    const session: MultipartSession = { fileKey: start.fileKey, uploadId: start.uploadId, parts: [], completionAttempted: false, fileName: file.name, fileSize: file.size };
    try {
      const size = positiveSafe(start.partSize, 'server partSize');
      const count = positiveSafe(start.partCount, 'server partCount');
      if (!start.fileKey || !start.uploadId || count !== Math.ceil(file.size / size) || size < 5 * 1024 * 1024 || count > 10_000) throw new TypeError('Invalid multipart preparation response');
      session.partSize = size;
    } catch (error) { throw new MultipartUploadError(session, error); }
    return this.transferMultipart(file, session, { signal, onProgress, concurrency, maxRetries });
  }

  async resumeMultipart(file: File, previous: MultipartSession, options: ResumeMultipartOptions = {}): Promise<MultipartResult> {
    validateFile(file);
    transferOptions(options);
    if (!previous || previous.completionAttempted !== false) throw new TypeError('Reconcile the previous completion before resuming');
    if (!previous.partSize || previous.fileSize !== file.size || previous.fileName !== file.name || file.size === 0) throw new TypeError('Resume requires the original file name, size and server partSize');
    const size = positiveSafe(previous.partSize, 'session partSize');
    const count = Math.ceil(file.size / size);
    if (size < 5 * 1024 * 1024 || count > 10_000 || typeof previous.fileKey !== 'string' || !previous.fileKey || typeof previous.uploadId !== 'string' || !previous.uploadId || !Array.isArray(previous.parts)) throw new TypeError('Invalid multipart session');
    const seen = new Set<number>();
    const parts = previous.parts.map(part => {
      const partNumber = positiveSafe(part.partNumber, 'session partNumber');
      if (partNumber > count || seen.has(partNumber) || typeof part.etag !== 'string' || !part.etag.trim()) throw new TypeError('Invalid or duplicate completed part');
      seen.add(partNumber);
      return { partNumber, etag: part.etag };
    });
    return this.transferMultipart(file, { ...previous, partSize: size, parts }, options);
  }

  // 只重传同一签名地址的同一片内容；平台的 init/partUrls/complete 不自动重放。
  private async putPart(url: string, body: Blob, options: ResumeMultipartOptions, maxRetries: number): Promise<Response> {
    const signed = storageURL(url);
    for (let attempt = 0; ; attempt++) {
      options.signal?.throwIfAborted();
      try { return await this.storage(signed, { method: 'PUT', body }, options); }
      catch (error) {
        if (options.signal?.aborted || attempt >= maxRetries || !retryablePart(error)) throw error;
        await retryDelay(attempt, options.signal);
      }
    }
  }

  private async transferMultipart(file: File, session: MultipartSession, options: ResumeMultipartOptions): Promise<MultipartResult> {
    const { concurrency, maxRetries } = transferOptions(options);
    const { signal, onProgress } = options;
    const size = session.partSize!;
    const count = Math.ceil(file.size / size);
    const completed = new Set(session.parts.map(part => Number(part.partNumber)));
    const pending = Array.from({ length: count }, (_, i) => i + 1).filter(number => !completed.has(number));
    let uploadedBytes = session.parts.reduce((sum, part) => sum + Math.min(size, file.size - (Number(part.partNumber) - 1) * size), 0);
    let cursor = 0, failed = false, failure: unknown;
    const worker = async () => {
      while (!failed && cursor < pending.length) {
        const partNumber = pending[cursor++];
        try {
          signal?.throwIfAborted();
          const result = await this.multipart.partUrls({ fileKey: session.fileKey, uploadId: session.uploadId, partNumbers: [partNumber] }, { signal });
          const signed = result.partUrls.find(part => Number(part.partNumber) === partNumber);
          if (!signed?.url) throw new ApiError(200, 0, 'Missing signed part URL');
          const part = file.slice((partNumber - 1) * size, Math.min(partNumber * size, file.size));
          const response = await this.putPart(signed.url, part, options, maxRetries);
          const etag = response.headers.get('etag');
          if (!etag?.trim()) throw new ApiError(response.status, 0, 'Storage response is missing ETag');
          session.parts.push({ partNumber, etag });
          uploadedBytes += part.size;
          onProgress?.({ uploadedBytes, totalBytes: file.size, doneParts: session.parts.length, totalParts: count, percent: uploadedBytes / file.size * 100 });
        } catch (error) { if (!failed) { failed = true; failure = error; } }
      }
    };
    // 必须等在途分片收敛再交出会话，失败后不再领取新分片，也不隐式取消远端上传。
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
    session.parts.sort((a, b) => Number(a.partNumber) - Number(b.partNumber));
    try {
      if (failed) throw failure;
      signal?.throwIfAborted();
      session.completionAttempted = true;
      return await this.multipart.complete({ fileKey: session.fileKey, uploadId: session.uploadId, parts: session.parts }, { signal });
    } catch (error) { throw new MultipartUploadError(session, error); }
  }

  url(query: Parameters<typeof this.api.url>[0], options?: RequestOptions) { return this.api.url(query, options); }
  delete(body: Schemas['AssetFileDeleteReq'], options?: RequestOptions) { return this.api.delete(body, options); }
  async download(query: Parameters<typeof this.api.url>[0], options: RequestOptions = {}): Promise<Response> {
    const { fileUrl } = await this.api.url(query, options);
    return this.storage(fileUrl, { method: 'GET' }, options);
  }
}
export function createFilesClient(config: ClientConfig = {}): FilesClient { return new FilesClient(new HttpClient(config)); }
