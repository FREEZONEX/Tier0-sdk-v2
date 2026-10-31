import { afterEach, describe, expect, it, vi } from 'vitest';
import { openEventStream, type EventStreamError } from '../src/event-stream.js';
import { getPageRuntime, readPlatformError, reportAuthError, type Tier0Event, type Tier0PageRuntimeV1 } from '../src/page-runtime.js';

const RUNTIME_KEY = Symbol.for('tier0.page-runtime.v1');

function fakeRuntime(state: ReturnType<Tier0PageRuntimeV1['getState']> = 'running') {
  const listeners = new Map<Tier0Event, Set<(detail: unknown) => void>>();
  const runtime = {
    version: 'test', appId: 'a', policy: 'visible', state,
    getState() { return this.state; },
    getSleepAt: () => null,
    on(event: Tier0Event, listener: (detail: unknown) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return () => listeners.get(event)!.delete(listener);
    },
    getMqttToken: vi.fn(),
    reportAuthError: vi.fn(),
    keepAwake: vi.fn(),
  };
  (globalThis as Record<symbol, unknown>)[RUNTIME_KEY] = runtime;
  return { runtime, emit: (event: Tier0Event) => { for (const listener of [...(listeners.get(event) ?? [])]) listener({}); } };
}

const platform = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ code, message: 'm', retryable: false, ...extra }), { status, headers: { 'x-sbx-error': code, 'content-type': 'application/json' } });

/** An open stream the test writes to; `end()` closes it, like a dropped connection. */
function stream(signal?: AbortSignal | null) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const end = () => { try { controller.close(); } catch { /* closed */ } };
  signal?.addEventListener('abort', () => { try { controller.error(new DOMException('aborted', 'AbortError')); } catch { /* closed */ } });
  return {
    response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    write: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
    end,
  };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 400 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(check()).toBe(true);
};

describe('openEventStream', () => {
  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[RUNTIME_KEY];
    vi.restoreAllMocks();
  });

  it('stops on sbx_sleeping without retrying, and reconnects on resumed', async () => {
    const { emit } = fakeRuntime();
    const live = stream();
    const fetch = vi.fn(async () => (fetch.mock.calls.length === 1 ? platform(503, 'sbx_sleeping') : live.response));
    const onResume = vi.fn();
    const events: string[] = [];
    const handle = openEventStream({ url: '/s', fetch, onEvent: (event) => events.push(event.data), onResume });
    await until(() => fetch.mock.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fetch).toHaveBeenCalledTimes(1);
    emit('resumed');
    await until(() => fetch.mock.calls.length === 2);
    live.write('data: back\n\n');
    await until(() => events.length === 1);
    expect(onResume).toHaveBeenCalledTimes(1);
    handle.close();
  });

  it('does not wait for a resumed that fired while the refusal was in flight', async () => {
    const { emit } = fakeRuntime();
    const live = stream();
    const fetch = vi.fn(async () => {
      if (fetch.mock.calls.length > 1) return live.response;
      emit('resumed');
      return platform(503, 'sbx_sleeping');
    });
    const handle = openEventStream({ url: '/s', fetch, onEvent: () => undefined });
    await until(() => fetch.mock.calls.length === 2);
    handle.close();
  });

  it('sends nothing while the App already sleeps', async () => {
    const { runtime, emit } = fakeRuntime('sleeping');
    const live = stream();
    const fetch = vi.fn(async () => live.response);
    const handle = openEventStream({ url: '/s', fetch, onEvent: () => undefined });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetch).not.toHaveBeenCalled();
    runtime.state = 'running';
    emit('resumed');
    await until(() => fetch.mock.calls.length === 1);
    handle.close();
  });

  it('drops the open connection on the sleeping event', async () => {
    const { emit } = fakeRuntime();
    const opens: AbortSignal[] = [];
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      opens.push(init!.signal!);
      return stream(init!.signal).response;
    });
    const handle = openEventStream({ url: '/s', fetch: fetch as typeof globalThis.fetch, onEvent: () => undefined });
    await until(() => opens.length === 1);
    emit('sleeping');
    await until(() => opens[0].aborted);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetch).toHaveBeenCalledTimes(1);
    handle.close();
  });

  it('reconnects through node_restarting with Last-Event-ID, including an id-only frame', async () => {
    fakeRuntime();
    const first = stream();
    const second = stream();
    const responses = [first.response, platform(503, 'node_restarting', { retryable: true, retry_after_ms: 10 }), second.response];
    const heads: Headers[] = [];
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      heads.push(new Headers(init?.headers));
      return responses.shift()!;
    });
    const handle = openEventStream({ url: '/s', fetch: fetch as typeof globalThis.fetch, onEvent: () => undefined });
    await until(() => heads.length === 1);
    first.write('id: e.1\n\n');
    await new Promise((resolve) => setTimeout(resolve, 10));
    first.end();
    await until(() => heads.length === 3);
    expect(heads[2].get('last-event-id')).toBe('e.1');
    expect(heads[2].get('accept')).toBe('text/event-stream');
    handle.close();
  });

  it('reports an authorization failure and waits for resumed', async () => {
    const { runtime, emit } = fakeRuntime();
    const live = stream();
    const fetch = vi.fn(async () => (fetch.mock.calls.length === 1 ? platform(401, 'grant_expired') : live.response));
    const handle = openEventStream({ url: '/s', fetch, onEvent: () => undefined });
    await until(() => runtime.reportAuthError.mock.calls.length === 1);
    expect(runtime.reportAuthError).toHaveBeenCalledWith('grant_expired');
    emit('resumed');
    await until(() => fetch.mock.calls.length === 2);
    handle.close();
  });

  it('ends on sbx_sleeping without a runtime, and hands the error to the caller', async () => {
    const onClose = vi.fn();
    const fetch = vi.fn(async () => platform(503, 'sbx_sleeping'));
    openEventStream({ url: '/s', fetch, onEvent: () => undefined, onClose });
    await until(() => onClose.mock.calls.length === 1);
    expect((onClose.mock.calls[0][0] as EventStreamError).code).toBe('sbx_sleeping');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries sbx_starting after retry_after_ms without a runtime', async () => {
    const live = stream();
    const fetch = vi.fn(async () => (fetch.mock.calls.length === 1 ? platform(503, 'sbx_starting', { retryable: true, retry_after_ms: 5 }) : live.response));
    const handle = openEventStream({ url: '/s', fetch, onEvent: () => undefined });
    await until(() => fetch.mock.calls.length === 2);
    handle.close();
  });

  it("treats an App's own 503 body without the header as an ordinary failure", async () => {
    const live = stream();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const forged = () => new Response(JSON.stringify({ code: 'sbx_sleeping' }), { status: 503 });
    const fetch = vi.fn(async () => (fetch.mock.calls.length === 1 ? forged() : live.response));
    const onClose = vi.fn();
    const handle = openEventStream({ url: '/s', fetch, onEvent: () => undefined, onClose });
    await until(() => fetch.mock.calls.length === 2);
    expect(onClose).not.toHaveBeenCalled();
    handle.close();
  });

  it('ends on a route 404', async () => {
    const onClose = vi.fn();
    openEventStream({ url: '/s', fetch: vi.fn(async () => new Response('', { status: 404 })), onEvent: () => undefined, onClose });
    await until(() => onClose.mock.calls.length === 1);
  });

  it('close() stops reconnecting', async () => {
    const live = stream();
    const fetch = vi.fn(async () => live.response);
    const handle = openEventStream({ url: '/s', fetch, onEvent: () => undefined });
    await until(() => fetch.mock.calls.length === 1);
    handle.close();
    live.end();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('platform errors', () => {
  afterEach(() => { delete (globalThis as Record<symbol, unknown>)[RUNTIME_KEY]; });

  it('parses the 21.1 body and leaves the response readable', async () => {
    const response = platform(503, 'sbx_starting', { retryable: true, retry_after_ms: 3000, state: 'starting' });
    expect(await readPlatformError(response)).toEqual({ status: 503, code: 'sbx_starting', retryable: true, retryAfterMs: 3000, state: 'starting' });
    expect((await response.json()).code).toBe('sbx_starting');
  });

  it('classifies an unknown code by its body', async () => {
    expect(await readPlatformError(platform(503, 'new_code', { retryable: true }))).toMatchObject({ code: 'new_code', retryable: true });
  });

  it('sees no platform error without x-sbx-error', async () => {
    expect(await readPlatformError(new Response('{"code":"sbx_sleeping"}', { status: 503 }))).toBeUndefined();
  });

  it('reports only authorization codes, and does nothing without a runtime', () => {
    expect(getPageRuntime()).toBeUndefined();
    expect(reportAuthError('grant_expired')).toBe(true);
    const { runtime } = fakeRuntime();
    expect(reportAuthError('sbx_sleeping')).toBe(false);
    expect(reportAuthError('need_role')).toBe(true);
    expect(runtime.reportAuthError.mock.calls).toEqual([['need_role']]);
  });
});
