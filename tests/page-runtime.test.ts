import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getPlatformLanguage, getPlatformTextSize, onPlatformLanguage, onPlatformTextSize,
  type PlatformTextSize, type Tier0PageRuntimeV1,
} from '../src/page-runtime.js';

const RUNTIME_KEY = Symbol.for('tier0.page-runtime.v1');

/** A runtime built like the front door's: listeners on an EventTarget, so unknown event names are accepted and never fire. */
function installRuntime(version: string, withLanguage: boolean, withTextSize = false) {
  const events = new EventTarget();
  let language: string | undefined;
  let textSize: PlatformTextSize | undefined;
  const runtime: Tier0PageRuntimeV1 = Object.freeze({
    version, appId: 'a', policy: 'visible' as const,
    getState: () => 'running' as const,
    getSleepAt: () => null,
    on(name: string, listener: (detail: any) => void) {
      const wrapped = (event: Event) => listener((event as CustomEvent).detail);
      events.addEventListener(name, wrapped);
      return () => events.removeEventListener(name, wrapped);
    },
    reportAuthError: vi.fn(),
    keepAwake: vi.fn(),
    ...(withLanguage ? { getPlatformLanguage: () => language } : {}),
    ...(withTextSize ? { getPlatformTextSize: () => textSize } : {}),
  });
  (globalThis as Record<symbol, unknown>)[RUNTIME_KEY] = runtime;
  return {
    receive(value: string) {
      language = value;
      events.dispatchEvent(new CustomEvent('language', { detail: value }));
    },
    receiveTextSize(value: PlatformTextSize) {
      textSize = value;
      events.dispatchEvent(new CustomEvent('text-size', { detail: value }));
    },
  };
}

afterEach(() => { delete (globalThis as Record<symbol, unknown>)[RUNTIME_KEY]; });

describe('platform language', () => {
  it('is undefined without the runtime, and subscribing is a no-op', () => {
    expect(getPlatformLanguage()).toBeUndefined();
    const off = onPlatformLanguage(() => { throw new Error('never called'); });
    expect(off).toBeTypeOf('function');
    expect(() => off()).not.toThrow();
  });

  it('is undefined on a runtime older than 2.2.0, which never emits it', () => {
    installRuntime('2.1.0', false);
    const listener = vi.fn();
    const off = onPlatformLanguage(listener);
    expect(getPlatformLanguage()).toBeUndefined();
    off();
    expect(listener).not.toHaveBeenCalled();
  });

  it('is undefined on 2.2.0 until the host sends a language (top-level page, older host, message in flight)', () => {
    installRuntime('2.2.0', true);
    expect(getPlatformLanguage()).toBeUndefined();
  });

  it('returns the raw tag and notifies each change without replaying on subscribe', () => {
    const host = installRuntime('2.2.0', true);
    host.receive('zh-cn');
    const listener = vi.fn();
    const off = onPlatformLanguage(listener);
    expect(listener).not.toHaveBeenCalled();
    expect(getPlatformLanguage()).toBe('zh-cn');

    host.receive('ja');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith('ja');
    expect(getPlatformLanguage()).toBe('ja');

    off();
    host.receive('en');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getPlatformLanguage()).toBe('en');
  });
});

describe('platform text size', () => {
  it('reads undefined and safely unsubscribes without a capable runtime', () => {
    const listener = vi.fn();
    expect(getPlatformTextSize()).toBeUndefined();
    expect(() => onPlatformTextSize(listener)()).not.toThrow();
    const oldRuntime = installRuntime('2.2.0', true);
    const off = onPlatformTextSize(listener);
    oldRuntime.receiveTextSize('l');
    expect(getPlatformTextSize()).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it('reads before or after subscribing and removes listeners when an App unmounts', () => {
    const host = installRuntime('2.3.0', true, true);
    expect(getPlatformTextSize()).toBeUndefined();
    host.receiveTextSize('m');
    const listener = vi.fn();
    const firstOff = onPlatformTextSize(listener);
    expect(getPlatformTextSize()).toBe('m');
    expect(listener).not.toHaveBeenCalled();
    firstOff();

    const secondOff = onPlatformTextSize(listener);
    host.receive('ja');
    host.receiveTextSize('l');
    expect(listener).toHaveBeenCalledExactlyOnceWith('l');
    expect(getPlatformTextSize()).toBe('l');
    expect(getPlatformLanguage()).toBe('ja');
    secondOff();
    host.receiveTextSize('s');
    expect(getPlatformTextSize()).toBe('s');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
