import { HttpClient, ApiError, type ClientConfig, type RequestOptions } from './openapi/client.js';
import { createOpenAPI } from './openapi/api.generated.js';
import type { components } from './openapi/types.generated.js';

type Schemas = components['schemas'];
export type UploadOptions = Omit<Schemas['AssetFileUploadReq'], 'fileName' | 'contentType' | 'size'> & RequestOptions;
export type UploadResult = Schemas['AssetFileUploadResp'];
export type MultipartResult = Schemas['AssetFileMultipartCompleteResp'];
export interface MultipartOptions extends UploadOptions {
  partSize?: number;
  onProgress?: (progress: { uploadedBytes: number; totalBytes: number }) => void;
}
export interface MultipartSession {
  fileKey: string;
  uploadId: string;
  parts: Schemas['AssetFileMultipartPart'][];
  completionAttempted: boolean;
}
export class MultipartUploadError extends Error {
  constructor(readonly session: MultipartSession, readonly cause: unknown) {
    super('Multipart upload interrupted. The session is retained; reconcile completion before retrying or aborting.');
    this.name = 'MultipartUploadError';
  }
}
export const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024;
export const DEFAULT_MULTIPART_PART_SIZE = 8 * 1024 * 1024;

function positiveSafe(value: number | bigint, name: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new TypeError(`Invalid ${name}`);
  return n;
}
function validateFile(file: File): void {
  if (!file || typeof file.name !== 'string' || !file.name || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.slice !== 'function') throw new TypeError('A File is required');
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
    const url = new URL(urlString);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Invalid signed storage URL');
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    const timer = setTimeout(() => controller.abort(), this.http.timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      if (options.signal?.aborted) abort();
      const response = await this.http.getFetch()(url.href, { ...init, signal: controller.signal, credentials: 'omit', redirect: 'error' });
      if (!response.ok) throw new ApiError(response.status, 0, 'Object storage request failed');
      return response;
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }

  async upload(file: File, options: UploadOptions = {}): Promise<UploadResult | MultipartResult> {
    validateFile(file);
    if (file.size > MULTIPART_THRESHOLD_BYTES) return this.uploadMultipart(file, options);
    const { signal, ...metadata } = options;
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
    const { signal, partSize = DEFAULT_MULTIPART_PART_SIZE, onProgress, ...metadata } = options;
    if (!Number.isSafeInteger(partSize) || partSize < 5 * 1024 * 1024) throw new TypeError('partSize must be at least 5 MiB');
    const start = await this.multipart.init({ ...metadata, fileName: file.name, contentType: file.type || 'application/octet-stream', size: file.size, partSize }, { signal });
    const session: MultipartSession = { fileKey: start.fileKey, uploadId: start.uploadId, parts: [], completionAttempted: false };
    try {
      const size = positiveSafe(start.partSize, 'server partSize');
      const count = positiveSafe(start.partCount, 'server partCount');
      if (!start.fileKey || !start.uploadId || count !== Math.ceil(file.size / size) || size < 5 * 1024 * 1024 || count > 10_000) throw new TypeError('Invalid multipart preparation response');
      for (let partNumber = 1; partNumber <= count; partNumber++) {
        const result = await this.multipart.partUrls({ fileKey: start.fileKey, uploadId: start.uploadId, partNumbers: [partNumber] }, { signal });
        const signed = result.partUrls.find(p => Number(p.partNumber) === partNumber);
        if (!signed?.url) throw new ApiError(200, 0, 'Missing signed part URL');
        const end = Math.min(partNumber * size, file.size);
        const response = await this.storage(signed.url, { method: 'PUT', body: file.slice((partNumber - 1) * size, end) }, { signal });
        const etag = response.headers.get('etag');
        if (!etag) throw new ApiError(response.status, 0, 'Storage response is missing ETag');
        session.parts.push({ partNumber, etag });
        onProgress?.({ uploadedBytes: end, totalBytes: file.size });
      }
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
