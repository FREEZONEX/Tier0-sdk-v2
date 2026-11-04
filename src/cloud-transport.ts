import type { AppRuntime } from './runtime.js';
import { getClient, type HttpClient, type RequestOptions } from './openapi/client.js';
import { UNS_V2_OPERATIONS, UNS_V2_STREAM_OPERATIONS, type UnsV2OperationName, type UnsV2StreamOperationName } from './uns-v2/generated.js';

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
  constructor(readonly kind: Failure, readonly status?: number, readonly notStarted = false) {
    super(kind);
    this.name = 'CloudTransportError';
  }
}

/** Single fetch, no redirects/retries; one deadline covers both headers and body. */
export class CloudTransport {
  private readonly configuredTimeoutMs: number | undefined;
  private readonly unsV2MaxResponseBytes: number;
  readonly #unsV2AppDataSubject: string | undefined;

  constructor(private readonly resolveClient: () => HttpClient = getClient, config: CloudTransportConfig = {}) {
    const timeout = config.transportTimeoutMs ?? DEFAULT_CLOUD_TRANSPORT_TIMEOUT_MS;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) {
      throw new TypeError('Tier0 SDK: transportTimeoutMs must be an integer between 1 and 2147483647.');
    }
    this.configuredTimeoutMs = config.transportTimeoutMs;
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
  async postText(path: string, body: string, options: RequestOptions = {}, operation?: UnsV2OperationName): Promise<{ text: string; status: number; ok: boolean; retryAfter?: string }> {
    options.signal?.throwIfAborted();
    const client = this.resolveClient();
    const url = `${client.getBaseURL()}${path}`;
    const fetch = client.getFetch();
    const timeoutMs = this.configuredTimeoutMs ?? client.timeoutMs;
    const staticKey = client.hasApiKeyProvider() ? undefined : client.getApiKey();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // The registered operation determines data delegation, never a route blacklist.
    if (operation !== undefined && Object.hasOwn(UNS_V2_OPERATIONS, operation) &&
        UNS_V2_OPERATIONS[operation].scope.startsWith('uns:') &&
        this.#unsV2AppDataSubject !== undefined) {
      headers[UNS_V2_APP_DATA_SUBJECT_HEADER] = this.#unsV2AppDataSubject;
    }
    const controller = new AbortController();
    let response: Response | undefined;
    let dispatched = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (error: Error) => void = () => undefined;
    const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const onAbort = () => {
      controller.abort();
      void reader?.cancel().catch(() => undefined);
      rejectAbort(new CloudTransportError('TRANSPORT_ABORTED', response?.status, !dispatched));
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    const exchange = async () => {
      let key = staticKey;
      if (client.hasApiKeyProvider()) {
        try { key = await client.resolveApiKey(controller.signal); }
        catch { throw new CloudTransportError('TRANSPORT_ERROR', undefined, true); }
      }
      if (controller.signal.aborted) throw new CloudTransportError('TRANSPORT_ABORTED', undefined, !dispatched);
      if (key) {
        headers.Authorization = `Bearer ${key}`;
        headers['X-API-Key'] = key;
      }
      try {
        dispatched = true;
        response = await fetch(url, { method: 'POST', headers, body, redirect: 'manual', signal: controller.signal });
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
          reject(new CloudTransportError('TRANSPORT_TIMEOUT', response?.status, !dispatched));
        }, timeoutMs);
      });
      // Also bounds custom transports which ignore AbortSignal.
      return await Promise.race([exchange(), deadline, cancelled]);
    } catch (error) {
      if (controller.signal.aborted) throw new CloudTransportError(options.signal?.aborted ? 'TRANSPORT_ABORTED' : 'TRANSPORT_TIMEOUT', response?.status, !dispatched);
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
  async getEventStream(path: string, options: { lastEventId?: string; signal?: AbortSignal } = {}, operation?: UnsV2StreamOperationName):
    Promise<{ status: number; stream: ReadableStream<Uint8Array>; close(): void } | { status: number; text: string }> {
    options.signal?.throwIfAborted();
    const client = this.resolveClient();
    const url = `${client.getBaseURL()}${path}`;
    const fetch = client.getFetch();
    const timeoutMs = this.configuredTimeoutMs ?? client.timeoutMs;
    const staticKey = client.hasApiKeyProvider() ? undefined : client.getApiKey();
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (operation !== undefined && Object.hasOwn(UNS_V2_STREAM_OPERATIONS, operation) &&
        UNS_V2_STREAM_OPERATIONS[operation].scope.startsWith('uns:') && this.#unsV2AppDataSubject !== undefined) {
      headers[UNS_V2_APP_DATA_SUBJECT_HEADER] = this.#unsV2AppDataSubject;
    }
    if (options.lastEventId !== undefined) headers['Last-Event-ID'] = options.lastEventId;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    const close = () => {
      options.signal?.removeEventListener('abort', onAbort);
      controller.abort();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    let expired = false;
    const timer = setTimeout(() => { expired = true; controller.abort(); }, timeoutMs);
    const failure = (kind: Failure, status?: number) =>
      new CloudTransportError(expired ? 'TRANSPORT_TIMEOUT' : controller.signal.aborted ? 'TRANSPORT_ABORTED' : kind, status);
    let response: Response;
    try {
      const key = client.hasApiKeyProvider() ? await client.resolveApiKey(controller.signal) : staticKey;
      if (controller.signal.aborted) throw failure('TRANSPORT_ABORTED');
      if (key) {
        headers.Authorization = `Bearer ${key}`;
        headers['X-API-Key'] = key;
      }
    } catch (error) {
      clearTimeout(timer);
      close();
      if (expired || options.signal?.aborted) throw failure('TRANSPORT_ABORTED');
      throw error;
    }
    try {
      response = await fetch(url, { method: 'GET', headers, redirect: 'manual', signal: controller.signal });
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

  async post(path: string, body: unknown, signal?: AbortSignal, runtime?: AppRuntime): Promise<{ value: unknown; status: number; ok: boolean }> {
    const serialized = JSON.stringify(body);
    const client = this.resolveClient();
    const timeoutMs = this.configuredTimeoutMs ?? client.timeoutMs;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    let response: Response | undefined;
    let dispatched = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const exchange = async () => {
      try {
        if (runtime) {
          if (controller.signal.aborted) throw new CloudTransportError('TRANSPORT_ABORTED', undefined, true);
          dispatched = true;
          response = await runtime.request(path, body, { signal: controller.signal });
        }
        else {
          const url = `${client.getBaseURL()}${path}`;
          const fetch = client.getFetch();
          const key = client.hasApiKeyProvider() ? await client.resolveApiKey(controller.signal) : client.getApiKey();
          if (controller.signal.aborted) throw new CloudTransportError('TRANSPORT_ABORTED');
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (key) {
            headers.Authorization = `Bearer ${key}`;
            headers['X-API-Key'] = key;
          }
          dispatched = true;
          response = await fetch(url, { method: 'POST', headers, body: serialized, redirect: 'manual', signal: controller.signal });
        }
      } catch {
        throw new CloudTransportError('TRANSPORT_ERROR', undefined, !dispatched);
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
        const stopped = () => reject(new CloudTransportError('TRANSPORT_ERROR', response?.status, !dispatched));
        controller.signal.addEventListener('abort', stopped, { once: true });
        if (controller.signal.aborted) stopped();
        timer = setTimeout(() => {
          reject(new CloudTransportError('TRANSPORT_TIMEOUT', response?.status, !dispatched));
          controller.abort();
        }, timeoutMs);
      });
      // Also bounds custom transports which ignore AbortSignal.
      return await Promise.race([exchange(), deadline]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
}
