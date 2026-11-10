import { PROXY_HEADER, PROXY_NOT_FORWARDED } from './platform-proxy.js';
import { getClient, type HttpClient, type RequestOptions } from './openapi/client.js';

export interface CloudTransportConfig {
  /** Whole HTTP exchange including the response body, in milliseconds; default 60,000. */
  transportTimeoutMs?: number;
  /** UNS v2 response body limit; may only tighten the 20 MiB contract/RPC ceiling. */
  unsV2MaxResponseBytes?: number;
}

export const DEFAULT_CLOUD_TRANSPORT_TIMEOUT_MS = 60_000;
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

const notForwarded = (response: Response) => response.headers.get(PROXY_HEADER) === PROXY_NOT_FORWARDED;

/**
 * No redirects; one deadline covers both headers and body. The only retries are
 * the HTTP client's, of answers the node proxy produced itself.
 */
export class CloudTransport {
  private readonly configuredTimeoutMs: number | undefined;
  private readonly unsV2MaxResponseBytes: number;

  constructor(private readonly resolveClient: () => HttpClient = getClient, config: CloudTransportConfig = {}) {
    const configuredTimeout = config.transportTimeoutMs;
    const timeout = configuredTimeout ?? DEFAULT_CLOUD_TRANSPORT_TIMEOUT_MS;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) {
      throw new TypeError('Tier0 SDK: transportTimeoutMs must be an integer between 1 and 2147483647.');
    }
    this.configuredTimeoutMs = configuredTimeout;
    const maxResponseBytes = config.unsV2MaxResponseBytes ?? UNS_V2_MAX_RESPONSE_BYTES;
    if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > UNS_V2_MAX_RESPONSE_BYTES) {
      throw new TypeError('Tier0 SDK: unsV2MaxResponseBytes must be an integer between 1 and 20971520.');
    }
    this.unsV2MaxResponseBytes = maxResponseBytes;
  }

  /**
   * `retryAfter`: the raw `Retry-After` header, for answers without a UNS error body.
   * `notForwarded`: the node proxy answered itself (`X-Tier0-Proxy: not-forwarded`), the platform never saw the request.
   */
  async postText(path: string, body: string, options: RequestOptions = {}): Promise<{ text: string; status: number; ok: boolean; retryAfter?: string; notForwarded?: true }> {
    options.signal?.throwIfAborted();
    const client = this.resolveClient();
    const url = `${client.getBaseURL()}${path}`;
    const send = client.sender();
    const timeoutMs = this.configuredTimeoutMs ?? client.timeoutMs;
    const staticKey = client.hasApiKeyProvider() ? undefined : client.getApiKey();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
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
      try {
        dispatched = true;
        response = await send(url, { method: 'POST', headers, body, redirect: 'manual', signal: controller.signal }, key);
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
      return {
        text: chunks.join(''), status: response.status, ok: response.ok,
        ...(retryAfter === undefined ? {} : { retryAfter }),
        ...(notForwarded(response) ? { notForwarded: true as const } : {}),
      };
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
  async getEventStream(path: string, options: { lastEventId?: string; signal?: AbortSignal } = {}):
    Promise<{ status: number; stream: ReadableStream<Uint8Array>; close(): void } | { status: number; text: string; notForwarded?: true }> {
    options.signal?.throwIfAborted();
    const client = this.resolveClient();
    const url = `${client.getBaseURL()}${path}`;
    const send = client.sender();
    const timeoutMs = this.configuredTimeoutMs ?? client.timeoutMs;
    const staticKey = client.hasApiKeyProvider() ? undefined : client.getApiKey();
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
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
    let key: string | undefined;
    try {
      key = client.hasApiKeyProvider() ? await client.resolveApiKey(controller.signal) : staticKey;
      if (controller.signal.aborted) throw failure('TRANSPORT_ABORTED');
    } catch (error) {
      clearTimeout(timer);
      close();
      if (expired || options.signal?.aborted) throw failure('TRANSPORT_ABORTED');
      throw error;
    }
    try {
      response = await send(url, { method: 'GET', headers, redirect: 'manual', signal: controller.signal }, key);
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
      const proxied = notForwarded(response) ? { notForwarded: true as const } : {};
      if (!response.body) return { status: response.status, text: '', ...proxied };
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
      return { status: response.status, text: chunks.join(''), ...proxied };
    } catch (error) {
      if (error instanceof CloudTransportError) throw error;
      throw failure('PROTOCOL_ERROR', response.status);
    } finally {
      clearTimeout(timer);
      close();
    }
  }

  async post(path: string, body: unknown, signal?: AbortSignal): Promise<{ value: unknown; status: number; ok: boolean }> {
    const serialized = JSON.stringify(body);
    // Outside the transport catch: a configuration error (host, TIER0_RUNTIME) must surface as itself.
    const client = this.resolveClient();
    const timeoutMs = this.configuredTimeoutMs ?? client.timeoutMs;
    const url = `${client.getBaseURL()}${path}`;
    const send = client.sender();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    let response: Response | undefined;
    let dispatched = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const exchange = async () => {
      try {
        const key = client.hasApiKeyProvider() ? await client.resolveApiKey(controller.signal) : client.getApiKey();
        if (controller.signal.aborted) throw new CloudTransportError('TRANSPORT_ABORTED');
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        dispatched = true;
        response = await send(url, { method: 'POST', headers, body: serialized, redirect: 'manual', signal: controller.signal }, key);
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
