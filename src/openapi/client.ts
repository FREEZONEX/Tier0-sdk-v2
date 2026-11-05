import { getEnvVar } from '../runtime-env.js';
import { invalidResponseHint } from '../connection-diagnostics.js';
import { decodeUnsV2JSON, encodeUnsV2JSON } from '../uns-v2/codec.js';

export interface ClientConfig {
  apiHost?: string;
  /** Explicit credential sources are selected by property presence; no environment fallback. */
  apiKey?: string;
  getApiHost?: () => string | undefined;
  /** Evaluated per request; an absent result does not use another credential. */
  getApiKey?: () => string | undefined;
  /** Resolve an API key for each HTTP attempt. Failure never falls back to other credentials. */
  apiKeyProvider?: (options: { signal: AbortSignal }) => Promise<string>;
  fetch?: typeof globalThis.fetch;
  transportTimeoutMs?: number;
}
export interface RequestOptions { signal?: AbortSignal }
export interface Operation {
  method: string;
  path: string;
  readonly pathParams: readonly string[];
  mode: 'envelope' | 'direct' | 'download';
  readonly: boolean;
  requestSchema?: string;
  responseSchema: string;
}
export interface OperationInput {
  params?: Record<string, string>;
  query?: object;
  body?: unknown;
}
export class ApiError extends Error {
  readonly errorCode?: string;
  readonly outcomeUnknown: boolean;
  constructor(readonly status: number, readonly code: number, readonly msg: string,
    details: { errorCode?: string; outcomeUnknown?: boolean } = {}) {
    super(`HTTP ${status}: ${msg}`);
    this.name = 'ApiError';
    this.errorCode = details.errorCode;
    this.outcomeUnknown = details.outcomeUnknown ?? false;
  }
}
export class TransportError extends ApiError {
  constructor(kind: 'TIMEOUT' | 'ABORTED' | 'NETWORK' | 'PROTOCOL', outcomeUnknown: boolean, status = 0) {
    super(status, 0, `Tier0 SDK v2 ${kind.toLowerCase()} error`, { errorCode: `SDK_${kind}`, outcomeUnknown });
    this.name = 'TransportError';
  }
}
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Snapshot all own properties once, including non-enumerable credential and delegation fields. */
export function snapshotClientConfig<T extends ClientConfig>(config: T): T {
  const snapshot = { ...config };
  for (const field of Reflect.ownKeys(config)) {
    if (!Object.hasOwn(snapshot, field)) {
      Object.defineProperty(snapshot, field, { value: Reflect.get(config, field), writable: true, enumerable: true, configurable: true });
    }
  }
  return snapshot;
}
export function responseError(status: number, value: unknown, fallback = 'Request failed'): ApiError {
  return new ApiError(status, record(value) && typeof value.code === 'number' ? value.code : 0,
    record(value) && typeof value.message === 'string' ? value.message : record(value) && typeof value.msg === 'string' ? value.msg : fallback,
    { errorCode: record(value) && typeof value.errorCode === 'string' ? value.errorCode : undefined });
}

/** An immutable configuration snapshot. Each request resolves optional credential callbacks once. */
export class HttpClient {
  private readonly config: Readonly<ClientConfig>;
  readonly timeoutMs: number;
  constructor(config: ClientConfig = {}) {
    this.config = Object.freeze(snapshotClientConfig(config));
    this.timeoutMs = config.transportTimeoutMs ?? 60_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 2_147_483_647) throw new TypeError('Invalid transportTimeoutMs');
  }
  getBaseURL(): string {
    const host = this.config.apiHost ?? this.config.getApiHost?.() ?? getEnvVar('TIER0_API_HOST');
    if (!host?.trim()) throw new Error('Tier0 SDK v2: apiHost or TIER0_API_HOST is required.');
    const base = host.trim().replace(/\/+$/, '');
    const url = new URL(/^https?:\/\//i.test(base) ? base : `https://${base}`);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new TypeError('Invalid apiHost');
    return url.href.replace(/\/+$/, '');
  }
  getApiKey(): string | undefined {
    // An explicitly selected source must never fall through to a shared identity.
    if (this.hasApiKeyProvider()) return undefined;
    if (Object.hasOwn(this.config, 'apiKey')) return this.config.apiKey;
    if (Object.hasOwn(this.config, 'getApiKey')) return this.config.getApiKey?.();
    return getEnvVar('TIER0_API_KEY');
  }
  hasApiKeyProvider(): boolean { return Object.hasOwn(this.config, 'apiKeyProvider'); }
  async resolveApiKey(signal: AbortSignal): Promise<string | undefined> {
    const provider = this.config.apiKeyProvider;
    if (provider === undefined) return this.hasApiKeyProvider() ? undefined : this.getApiKey();
    if (signal.aborted) throw new Error('Tier0 SDK: credential resolution aborted.');
    return new Promise((resolve, reject) => {
      const aborted = () => {
        signal.removeEventListener('abort', aborted);
        reject(new Error('Tier0 SDK: credential resolution aborted.'));
      };
      signal.addEventListener('abort', aborted, { once: true });
      Promise.resolve().then(() => provider({ signal })).then(key => {
        if (signal.aborted) return aborted();
        if (typeof key !== 'string' || !/^[\x21-\x7e]+$/.test(key)) throw new Error();
        resolve(key);
      }).catch(() => reject(new Error('Tier0 SDK: credential provider failed.')))
        .finally(() => signal.removeEventListener('abort', aborted));
    });
  }
  getFetch(): typeof globalThis.fetch { return this.config.fetch ?? globalThis.fetch; }

  private async exchange(path: string, init: RequestInit, options: RequestOptions, mutation: boolean): Promise<{ text: string; status: number; ok: boolean }> {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new TypeError('A relative API path is required');
    const url = this.getBaseURL() + path;
    const staticKey = this.hasApiKeyProvider() ? undefined : this.getApiKey();
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json');
    const controller = new AbortController();
    let expired = false;
    let started = false;
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let rejectAbort: (error: Error) => void = () => undefined;
    const fail = () => {
      controller.abort();
      void reader?.cancel().catch(() => undefined);
      rejectAbort(new TransportError(expired ? 'TIMEOUT' : 'ABORTED', mutation && started, response?.status));
    };
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const timer = setTimeout(() => { expired = true; fail(); }, this.timeoutMs);
    options.signal?.addEventListener('abort', fail, { once: true });
    try {
      if (options.signal?.aborted) throw new TransportError('ABORTED', false);
      const request = async () => {
        const key = this.hasApiKeyProvider() ? await this.resolveApiKey(controller.signal) : staticKey;
        if (controller.signal.aborted) throw new TransportError(expired ? 'TIMEOUT' : 'ABORTED', false);
        // Gateway enforce mode rejects multiple credential sources; whoami accepts this header.
        if (key) headers.set('X-API-Key', key);
        started = true;
        try { response = await this.getFetch()(url, { ...init, headers, redirect: 'manual', signal: controller.signal }); }
        catch { throw new TransportError(expired ? 'TIMEOUT' : controller.signal.aborted ? 'ABORTED' : 'NETWORK', mutation, response?.status); }
        const maxBytes = 20 * 1024 * 1024;
        if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new TransportError('PROTOCOL', mutation, response.status); }
        if (!response.body) return { text: '', status: response.status, ok: response.ok };
        reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: true });
        const chunks: string[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) { await reader.cancel(); throw new Error('Response too large'); }
            chunks.push(decoder.decode(value, { stream: true }));
          }
          chunks.push(decoder.decode());
        } catch { throw new TransportError('PROTOCOL', mutation, response.status); }
        finally { reader.releaseLock(); reader = undefined; }
        return { text: chunks.join(''), status: response.status, ok: response.ok };
      };
      return await Promise.race([request(), aborted]);
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', fail); }
  }

  async operation<T>(operation: Operation, input: OperationInput = {}, options: RequestOptions = {}): Promise<T> {
    let path = operation.path;
    for (const name of operation.pathParams) {
      const value = input.params?.[name];
      if (!value || value === '.' || value === '..' || /[/\\\u0000-\u001f\u007f]/.test(value)) throw new TypeError(`Invalid path parameter: ${name}`);
      path = path.replace(`{${name}}`, encodeURIComponent(value));
    }
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(input.query ?? {})) {
      if (value !== undefined) query.set(name, String(value));
    }
    if (query.size) path += `?${query}`;
    if (operation.mode === 'download') {
      // Resolve the signed URL through the JSON endpoint, then fetch without platform credentials.
      const urlPath = path.replace('/files/download', '/files/url');
      const result = await this.get<{ code: number; data?: { fileUrl?: string } }>(urlPath, options);
      if (result.code !== 200 || !result.data?.fileUrl) throw responseError(200, result, 'Invalid download URL response');
      const url = new URL(result.data.fileUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Invalid download URL');
      const response = await this.getFetch()(url, { signal: options.signal, credentials: 'omit' });
      if (!response.ok) throw new ApiError(response.status, 0, 'File download failed');
      return response as T;
    }
    let body = input.body ?? {};
    if (path === '/openapi/v2/notifications/send') {
      if (!record(body)) throw new TypeError('Notification body must be an object');
      const channels = body.channels ?? ['web', 'mobile'];
      if (!Array.isArray(channels) || channels.some(c => c !== 'web' && c !== 'mobile')) throw new TypeError('Notification channels must be web or mobile');
      body = { ...body, channels: [...new Set(channels)] };
    }
    if (path === '/openapi/v2/apps/access-members/list' && record(body) && body.scope === undefined) {
      // The platform injects TIER0_RUNTIME: a Builder preview lists the draft roles, a deployment the production version.
      const runtime = getEnvVar('TIER0_RUNTIME');
      const scope = runtime === 'preview' ? 'draft' : runtime === 'deployed' ? 'production' : undefined;
      if (scope) body = { ...body, scope };
    }
    const serialized = operation.method === 'GET' ? undefined : encodeUnsV2JSON(body, operation.requestSchema ?? 'V1_Empty');
    const response = await this.exchange(path, { method: operation.method, body: serialized }, options, !operation.readonly);
    let value: unknown;
    try { value = decodeUnsV2JSON(response.text, operation.responseSchema); }
    catch {
      if (!response.ok) throw new ApiError(response.status, 0, `Non-JSON API error. ${invalidResponseHint(response.status)}`);
      throw new TransportError('PROTOCOL', !operation.readonly, response.status);
    }
    if (!response.ok) throw responseError(response.status, value);
    if (operation.mode === 'envelope') {
      if (!record(value) || typeof value.code !== 'number') throw new TransportError('PROTOCOL', !operation.readonly, response.status);
      if (value.code !== 200) throw responseError(response.status, value);
      if (!Object.hasOwn(value, 'data')) throw new TransportError('PROTOCOL', !operation.readonly, response.status);
      return value.data as T;
    }
    return value as T;
  }

  private async raw<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    const response = await this.exchange(path, { method, body: body === undefined ? undefined : encodeUnsV2JSON(body, 'V1_Empty') }, options, method !== 'GET');
    let value: unknown;
    try { value = decodeUnsV2JSON(response.text, 'V1_Empty'); }
    catch { throw new ApiError(response.status, 0, `Invalid API response. ${invalidResponseHint(response.status)}`); }
    if (!response.ok || (record(value) && typeof value.code === 'number' && value.code !== 200)) throw responseError(response.status, value);
    return value as T;
  }
  get<T>(path: string, options?: RequestOptions): Promise<T> { return this.raw('GET', path, undefined, options); }
  post<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> { return this.raw('POST', path, body, options); }
}

// Used by standalone domain clients. createClient() never reads or changes this default.
let defaultClient = new HttpClient();
export function configureClient(config: ClientConfig): void { defaultClient = new HttpClient(config); }
export function getClient(): HttpClient { return defaultClient; }
