import { platformProxyMode, PROXY_HEADER, PROXY_NOT_FORWARDED, SDK_HEADER } from '../platform-proxy.js';
import { assertCompactToken, currentDelegation, DELEGATION_HEADER } from '../request-context.js';
import { getEnvVar } from '../runtime-env.js';
import { decodeUnsV2JSON, encodeUnsV2JSON } from '../uns-v2/codec.js';

export interface ClientConfig {
  apiHost?: string;
  apiKey?: string;
  getApiHost?: () => string | undefined;
  getApiKey?: () => string | undefined;
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
/** `sbx_proxy_*` of an answer the node proxy produced itself (design 21.28). */
const proxyCode = (value: unknown) =>
  record(value) && typeof value.code === 'string' && /^sbx_proxy_[a-z_]+$/.test(value.code) ? value.code : undefined;
export function responseError(status: number, value: unknown, fallback = 'Request failed'): ApiError {
  return new ApiError(status, record(value) && typeof value.code === 'number' ? value.code : 0,
    record(value) && typeof value.message === 'string' ? value.message : record(value) && typeof value.msg === 'string' ? value.msg : fallback,
    { errorCode: record(value) && typeof value.errorCode === 'string' ? value.errorCode : proxyCode(value) });
}

/** Design 21.28: retries of an answer the node proxy produced itself. */
const PROXY_MAX_RETRIES = 3;
const PROXY_DEFAULT_RETRY_MS = [250, 500, 1_000];
const PROXY_MAX_RETRY_MS = 10_000;

function proxyRetryable(response: Response): boolean {
  return (response.status === 503 || response.status === 429) && response.headers.get(PROXY_HEADER) === PROXY_NOT_FORWARDED;
}

/** `retry_after_ms` of the proxy's body `{code, message, retry_after_ms?}`, else a short backoff. */
async function proxyRetryDelay(response: Response, retry: number): Promise<number> {
  let value: unknown;
  try { value = JSON.parse(await response.text()); } catch { value = undefined; }
  const ms = record(value) ? value.retry_after_ms : undefined;
  if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) return Math.min(ms, PROXY_MAX_RETRY_MS);
  return PROXY_DEFAULT_RETRY_MS[Math.min(retry, PROXY_DEFAULT_RETRY_MS.length - 1)];
}

function sleep(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const abort = () => { clearTimeout(timer); reject(signal!.reason); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** An immutable configuration snapshot. Each request resolves optional credential callbacks once. */
export class HttpClient {
  private readonly config: Readonly<ClientConfig>;
  readonly timeoutMs: number;
  constructor(config: ClientConfig = {}) {
    this.config = Object.freeze({ ...config });
    this.timeoutMs = config.transportTimeoutMs ?? 60_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 2_147_483_647) throw new TypeError('Invalid transportTimeoutMs');
  }
  getBaseURL(): string {
    // An invalid TIER0_RUNTIME throws here, before any transport catch can turn it into a network failure.
    this.usesAppCredential();
    const host = this.config.apiHost ?? this.config.getApiHost?.() ?? getEnvVar('TIER0_API_HOST');
    if (!host?.trim()) throw new Error('Tier0 SDK v2: apiHost or TIER0_API_HOST is required.');
    const base = host.trim().replace(/\/+$/, '');
    const url = new URL(/^https?:\/\//i.test(base) ? base : `https://${base}`);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new TypeError('Invalid apiHost');
    return url.href.replace(/\/+$/, '');
  }
  /**
   * True in platform proxy mode: the node proxy injects the App's key, so
   * this client sends no credential of its own. A client given
   * `apiKey` or `getApiKey` never is.
   */
  usesAppCredential(): boolean {
    return this.config.apiKey === undefined && this.config.getApiKey === undefined && platformProxyMode();
  }
  /** The API key to send; always undefined in platform proxy mode. */
  getApiKey(): string | undefined {
    const configured = this.config.apiKey ?? this.config.getApiKey?.();
    if (configured !== undefined) return configured;
    return this.usesAppCredential() ? undefined : getEnvVar('TIER0_API_KEY');
  }
  getFetch(): typeof globalThis.fetch { return this.config.fetch ?? globalThis.fetch; }

  private authorize(headers: Headers | Record<string, string>, delegation: string | undefined): void {
    const set = (name: string, value: string) => {
      if (headers instanceof Headers) headers.set(name, value);
      else headers[name] = value;
    };
    if (this.usesAppCredential()) {
      set(SDK_HEADER, '1');
    } else {
      const key = this.getApiKey();
      if (key) {
        set('Authorization', `Bearer ${key}`);
        set('X-API-Key', key);
      }
    }
    if (delegation !== undefined) {
      assertCompactToken(delegation, DELEGATION_HEADER);
      set(DELEGATION_HEADER, delegation);
    }
  }

  /**
   * One platform request (design 21.7). Redirects are never followed.
   *
   * In platform proxy mode an answer the node proxy produced itself
   * (`X-Tier0-Proxy: not-forwarded`) never reached the platform, so a `503`
   * (proxy not ready, key pending) or `429` (proxy limit) is sent again after
   * `retry_after_ms`, at most 3 times; writes repeat safely. Anything else,
   * a platform `5xx` included, is returned as is.
   */
  async authorizedFetch(url: string, init: RequestInit & { headers: Headers | Record<string, string> }, delegation: string | undefined = currentDelegation()): Promise<Response> {
    const { headers } = init;
    this.authorize(headers, delegation);
    const send = () => this.getFetch()(url, { ...init, headers, redirect: 'manual' });
    if (!this.usesAppCredential()) return send();
    for (let retry = 0; ; retry += 1) {
      const response = await send();
      if (retry >= PROXY_MAX_RETRIES || !proxyRetryable(response)) return response;
      await sleep(await proxyRetryDelay(response, retry), init.signal);
    }
  }

  private async exchange(path: string, init: RequestInit, options: RequestOptions, mutation: boolean): Promise<{ text: string; status: number; ok: boolean }> {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new TypeError('A relative API path is required');
    const url = this.getBaseURL() + path;
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
        started = true;
        try { response = await this.authorizedFetch(url, { ...init, headers, redirect: 'manual', signal: controller.signal }); }
        catch (error) {
          if (error instanceof TypeError && /X-Tier0-Delegation/.test(error.message)) throw error;
          throw new TransportError(expired ? 'TIMEOUT' : controller.signal.aborted ? 'ABORTED' : 'NETWORK', mutation, response?.status);
        }
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
      if (!response.ok) throw new ApiError(response.status, 0, 'Non-JSON API error');
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
    catch { throw new ApiError(response.status, 0, 'Invalid API response'); }
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
