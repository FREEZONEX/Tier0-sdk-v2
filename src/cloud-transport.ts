import { getClient, type HttpClient, type RequestOptions } from './openapi/client.js';

export interface CloudTransportConfig {
  /** Whole HTTP exchange including the response body, in milliseconds; default 60,000. */
  transportTimeoutMs?: number;
  /** UNS v2 response body limit; may only tighten the 20 MiB contract/RPC ceiling. */
  unsV2MaxResponseBytes?: number;
  /**
   * Opaque proof from the trusted App Gateway only: tier0.app-data-subject/v1,
   * X-Tier0-App-Data-Subject, aud tier0-uns-data. Proof alone is not authentication;
   * the SDK checks only compact syntax, never parses or trusts claims.
   * Create a new client per incoming request; never reuse a token across users.
   * Do not automatically forward the runtime App request assertion: its audience differs.
   */
  unsV2AppDataSubject?: string;
}

export const DEFAULT_CLOUD_TRANSPORT_TIMEOUT_MS = 60_000;
/** Header carrying `unsV2AppDataSubject`; the trusted App Gateway sets it on each business request. */
export const UNS_V2_APP_DATA_SUBJECT_HEADER = 'X-Tier0-App-Data-Subject';
export const UNS_V2_MAX_REQUEST_BYTES = 16 << 20;
export const UNS_V2_MAX_RESPONSE_BYTES = 20 << 20;

type Failure = 'TRANSPORT_ERROR' | 'PROTOCOL_ERROR' | 'TRANSPORT_TIMEOUT' | 'TRANSPORT_ABORTED';

/** Internal redacted failure, translated by each public contract client. */
export class CloudTransportError extends Error {
  constructor(readonly kind: Failure, readonly status?: number) {
    super(kind);
    this.name = 'CloudTransportError';
  }
}

/** Single fetch, no redirects/retries; one deadline covers both headers and body. */
export class CloudTransport {
  private readonly timeoutMs: number;
  private readonly unsV2MaxResponseBytes: number;
  readonly #unsV2AppDataSubject: string | undefined;

  constructor(private readonly resolveClient: () => HttpClient = getClient, config: CloudTransportConfig = {}) {
    const timeout = config.transportTimeoutMs ?? DEFAULT_CLOUD_TRANSPORT_TIMEOUT_MS;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) {
      throw new TypeError('Tier0 SDK: transportTimeoutMs must be an integer between 1 and 2147483647.');
    }
    this.timeoutMs = timeout;
    const maxResponseBytes = config.unsV2MaxResponseBytes ?? UNS_V2_MAX_RESPONSE_BYTES;
    if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > UNS_V2_MAX_RESPONSE_BYTES) {
      throw new TypeError('Tier0 SDK: unsV2MaxResponseBytes must be an integer between 1 and 20971520.');
    }
    this.unsV2MaxResponseBytes = maxResponseBytes;
    const subject = config.unsV2AppDataSubject;
    // ASCII-only syntax makes string length equal byte length. Do not trim or decode.
    if (subject !== undefined && (typeof subject !== 'string' || subject.length > 8192 || /[^A-Za-z0-9_.-]/.test(subject) ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(subject))) {
      throw new TypeError('Tier0 SDK: unsV2AppDataSubject must be a compact three-segment base64url token of at most 8192 ASCII bytes.');
    }
    this.#unsV2AppDataSubject = subject;
  }

  /** `retryAfter`: the raw `Retry-After` header, for answers without a UNS error body. */
  async postText(path: string, body: string, options: RequestOptions = {}): Promise<{ text: string; status: number; ok: boolean; retryAfter?: string }> {
    options.signal?.throwIfAborted();
    const client = this.resolveClient();
    const url = `${client.getBaseURL()}${path}`;
    const key = client.getApiKey();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Control routes also live under UNS v2, but must never receive data delegation.
    // Keep this per-client proof out of shared HTTP headers and Control requests.
    if (path.startsWith('/openapi/v2/uns/') &&
        !path.startsWith('/openapi/v2/uns/controls/') &&
        this.#unsV2AppDataSubject !== undefined) {
      headers[UNS_V2_APP_DATA_SUBJECT_HEADER] = this.#unsV2AppDataSubject;
    }
    if (key) {
      headers.Authorization = `Bearer ${key}`;
      headers['X-API-Key'] = key;
    }
    const controller = new AbortController();
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (error: Error) => void = () => undefined;
    const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const onAbort = () => {
      controller.abort();
      void reader?.cancel().catch(() => undefined);
      rejectAbort(new CloudTransportError('TRANSPORT_ABORTED', response?.status));
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const exchange = async () => {
      try {
        response = await client.getFetch()(url, { method: 'POST', headers, body, redirect: 'manual', signal: controller.signal });
      } catch {
        throw new CloudTransportError('TRANSPORT_ERROR');
      }
      const declaredLength = response.headers.get('content-length');
      if (declaredLength !== null && /^\d+$/.test(declaredLength) && Number(declaredLength) > this.unsV2MaxResponseBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new CloudTransportError('PROTOCOL_ERROR', response.status);
      }
      if (!response.body) throw new CloudTransportError('PROTOCOL_ERROR', response.status);
      try { reader = response.body.getReader(); }
      catch { throw new CloudTransportError('PROTOCOL_ERROR', response.status); }
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const chunks: string[] = [];
      let receivedBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          receivedBytes += value.byteLength;
          if (receivedBytes > this.unsV2MaxResponseBytes) {
            await reader.cancel().catch(() => undefined);
            throw new CloudTransportError('PROTOCOL_ERROR', response.status);
          }
          chunks.push(decoder.decode(value, { stream: true }));
        }
        chunks.push(decoder.decode());
      } catch (error) {
        if (error instanceof CloudTransportError) throw error;
        throw new CloudTransportError('PROTOCOL_ERROR', response.status);
      } finally {
        reader.releaseLock();
        reader = undefined;
      }
      const retryAfter = response.headers.get('retry-after') ?? undefined;
      return { text: chunks.join(''), status: response.status, ok: response.ok, ...(retryAfter === undefined ? {} : { retryAfter }) };
    };
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          void reader?.cancel().catch(() => undefined);
          reject(new CloudTransportError('TRANSPORT_TIMEOUT', response?.status));
        }, this.timeoutMs);
      });
      // Also bounds custom transports which ignore AbortSignal.
      return await Promise.race([exchange(), deadline, cancelled]);
    } catch (error) {
      if (controller.signal.aborted) throw new CloudTransportError(options.signal?.aborted ? 'TRANSPORT_ABORTED' : 'TRANSPORT_TIMEOUT', response?.status);
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Opens a server-sent event stream (GET, `Accept: text/event-stream`
   * exactly, as the gateway requires). The deadline covers the response
   * headers, and a non-stream body; a response that is not an event stream
   * is read whole (bounded like any UNS v2 response) and returned as `text`.
   * An open stream belongs to the caller: `close()` ends it and drops the
   * link to `signal`, which also ends it.
   */
  async getEventStream(path: string, options: { lastEventId?: string; signal?: AbortSignal } = {}):
    Promise<{ status: number; stream: ReadableStream<Uint8Array>; close(): void } | { status: number; text: string }> {
    options.signal?.throwIfAborted();
    const client = this.resolveClient();
    const url = `${client.getBaseURL()}${path}`;
    const key = client.getApiKey();
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (path.startsWith('/openapi/v2/uns/') && this.#unsV2AppDataSubject !== undefined) {
      headers[UNS_V2_APP_DATA_SUBJECT_HEADER] = this.#unsV2AppDataSubject;
    }
    if (options.lastEventId !== undefined) headers['Last-Event-ID'] = options.lastEventId;
    if (key) {
      headers.Authorization = `Bearer ${key}`;
      headers['X-API-Key'] = key;
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    const close = () => {
      options.signal?.removeEventListener('abort', onAbort);
      controller.abort();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    let expired = false;
    const timer = setTimeout(() => { expired = true; controller.abort(); }, this.timeoutMs);
    const failure = (kind: Failure, status?: number) =>
      new CloudTransportError(expired ? 'TRANSPORT_TIMEOUT' : controller.signal.aborted ? 'TRANSPORT_ABORTED' : kind, status);
    let response: Response;
    try {
      response = await client.getFetch()(url, { method: 'GET', headers, redirect: 'manual', signal: controller.signal });
    } catch {
      clearTimeout(timer);
      close();
      throw failure('TRANSPORT_ERROR');
    }
    const type = response.headers.get('content-type') ?? '';
    if (response.status === 200 && /^text\/event-stream\b/i.test(type) && response.body) {
      clearTimeout(timer);
      return { status: response.status, stream: response.body, close };
    }
    try {
      if (!response.body) return { status: response.status, text: '' };
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const chunks: string[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > this.unsV2MaxResponseBytes) {
          await reader.cancel().catch(() => undefined);
          throw new CloudTransportError('PROTOCOL_ERROR', response.status);
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
      chunks.push(decoder.decode());
      return { status: response.status, text: chunks.join('') };
    } catch (error) {
      if (error instanceof CloudTransportError) throw error;
      throw failure('PROTOCOL_ERROR', response.status);
    } finally {
      clearTimeout(timer);
      close();
    }
  }

  async post(path: string, body: unknown): Promise<{ value: unknown; status: number; ok: boolean }> {
    const client = this.resolveClient();
    const url = `${client.getBaseURL()}${path}`;
    const key = client.getApiKey();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) {
      headers.Authorization = `Bearer ${key}`;
      headers['X-API-Key'] = key;
    }
    const serialized = JSON.stringify(body);
    const controller = new AbortController();
    let response: Response | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const exchange = async () => {
      try {
        response = await client.getFetch()(url, { method: 'POST', headers, body: serialized, redirect: 'manual', signal: controller.signal });
      } catch {
        throw new CloudTransportError('TRANSPORT_ERROR');
      }
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw new CloudTransportError('PROTOCOL_ERROR', response.status);
      }
      return { value, status: response.status, ok: response.ok };
    };
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new CloudTransportError('TRANSPORT_TIMEOUT', response?.status));
        }, this.timeoutMs);
      });
      // Also bounds custom transports which ignore AbortSignal.
      return await Promise.race([exchange(), deadline]);
    } catch (error) {
      if (controller.signal.aborted) throw new CloudTransportError('TRANSPORT_TIMEOUT', response?.status);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
