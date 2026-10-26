import { getClient, type HttpClient, type ClientConfig } from './openapi/client.js';
import { DEFAULT_CLOUD_TRANSPORT_TIMEOUT_MS, type CloudTransportConfig } from './cloud-transport.js';
import { UnsV2ClientCore, UnsV2Error, type UnsV2Execution, type UnsV2Retry } from './uns-v2/client.js';
import { UnsV2RawNumber } from './uns-v2/codec.js';
import type { UnsV2JSONValue, UnsV2Request } from './uns-v2/generated.js';

/** Control convenience API over the canonical UNS v2 routes. Exact numbers are preserved. */
export type ControlJSON = UnsV2JSONValue;

export interface PublicControl {
  code: string;
  name: string;
  description: string;
  contractVersion: string;
  inputSchema: Record<string, ControlJSON>;
  outputSchema: Record<string, ControlJSON>;
  sideEffect: 'read' | 'write';
  idempotency: 'none' | 'optional' | 'required';
  timeoutMs: number;
  status: string;
}

export interface ControlDiscoverOptions {
  page?: number;
  size?: number;
  search?: string;
}

export interface ControlDiscoverResponse {
  total: number;
  list: PublicControl[];
}

/** Shared HTTP settings. The server still resolves the Control binding and authorization. */
export interface ControlTransportConfig extends CloudTransportConfig {}

export interface CloudClientConfig extends ClientConfig, ControlTransportConfig {}

export const DEFAULT_CONTROL_TRANSPORT_TIMEOUT_MS = DEFAULT_CLOUD_TRANSPORT_TIMEOUT_MS;

export interface ControlInvokeOptions {
  /** Stable caller-owned key for one business intent, at most 128 UTF-8 bytes. Never generated or retried by the SDK. */
  idempotencyKey?: string;
}

export interface ControlInvokeResponse<Result = ControlJSON> {
  code: string;
  contractVersion: string;
  result: Result;
  runID: string;
  status: string;
  /** True only when the server explicitly reports an idempotent replay. */
  replayed: boolean;
}

export interface ControlErrorInfo {
  /** HTTP status, absent when no HTTP response was received. */
  status?: number;
  /** Canonical UNS error.code, or an SDK-local CONTROL_* transport/protocol code. */
  errorCode: string;
  runID?: string;
  contractVersion?: string;
  runStatus?: string;
  replayed?: boolean;
  requestId?: string;
  execution?: UnsV2Execution;
  retry?: UnsV2Retry;
  reason?: string;
  details?: Record<string, unknown>[];
  data?: unknown;
}

/** No Control error is automatically retried, including authentication failures. */
export class ControlError extends Error {
  readonly status?: number;
  readonly errorCode: string;
  readonly runID?: string;
  readonly contractVersion?: string;
  readonly runStatus?: string;
  readonly replayed?: boolean;
  readonly requestId?: string;
  readonly execution?: UnsV2Execution;
  readonly retry?: UnsV2Retry;
  readonly reason?: string;
  readonly details?: Record<string, unknown>[];
  readonly data?: unknown;
  readonly retryable = false;

  constructor(message: string, info: ControlErrorInfo) {
    super(message);
    this.name = 'ControlError';
    this.status = info.status;
    this.errorCode = info.errorCode;
    this.runID = info.runID;
    this.contractVersion = info.contractVersion;
    this.runStatus = info.runStatus;
    this.replayed = info.replayed;
    this.requestId = info.requestId;
    this.execution = info.execution;
    this.retry = info.retry;
    this.reason = info.reason;
    this.details = info.details;
    this.data = info.data;
  }
}

/** Execution may have happened. Reconcile run information; any deliberate replay must reuse the same key. */
export class ControlResultUnknownError extends ControlError {
  readonly outcomeUnknown = true;

  constructor(info: ControlErrorInfo) {
    super('Control result is unknown; execution may have occurred. Do not automatically retry.', info);
    this.name = 'ControlResultUnknownError';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keys(value: unknown, allowed: string[]): void {
  if (!record(value) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key))) {
    throw new TypeError('Tier0 SDK: unsupported Control option.');
  }
}

function json(value: unknown, seen = new Set<unknown>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || value instanceof UnsV2RawNumber) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return false;
  }
  seen.add(value);
  const valid = (Array.isArray(value) ? Array.from(value) : Object.values(value)).every(item => json(item, seen));
  seen.delete(value);
  return valid;
}

function definition(value: unknown): value is PublicControl {
  if (!record(value)) return false;
  return ['code', 'name', 'description', 'contractVersion', 'status'].every(key => typeof value[key] === 'string') &&
    value.code !== '' && value.contractVersion !== '' && record(value.inputSchema) && record(value.outputSchema) &&
    ['read', 'write'].includes(value.sideEffect as string) &&
    ['none', 'optional', 'required'].includes(value.idempotency as string) &&
    typeof value.timeoutMs === 'number' && Number.isSafeInteger(value.timeoutMs) && value.timeoutMs > 0;
}

function runInfo(value: unknown): Partial<ControlErrorInfo> {
  if (!record(value)) return {};
  return {
    runID: typeof value.runId === 'string' ? value.runId : undefined,
    contractVersion: typeof value.contractVersion === 'string' ? value.contractVersion : undefined,
    runStatus: typeof value.status === 'string' ? value.status : undefined,
    replayed: typeof value.replayed === 'boolean' ? value.replayed : undefined,
  };
}

export interface ControlHandle<Input = ControlJSON, Result = ControlJSON> {
  describe(): Promise<PublicControl>;
  /**
   * One POST only. Input is opaque business JSON, including fields named streamId,
   * entryId, deploymentVersion or timeoutMs. Only the server chooses binding/version/timeout.
   * Generic types are caller assertions; the server validates the contract schemas.
   */
  invoke(input: Input, options?: ControlInvokeOptions): Promise<ControlInvokeResponse<Result>>;
}

export class ControlsClient {
  private readonly uns: UnsV2ClientCore;

  constructor(resolveClient: () => HttpClient = getClient, config: ControlTransportConfig = {}) {
    this.uns = new UnsV2ClientCore(resolveClient, config);
  }

  private async post<Name extends 'controlDiscover' | 'controlDescribe' | 'controlInvoke'>(
    operation: Name, body: UnsV2Request<Name>,
  ): Promise<{ value: unknown; status: number }> {
    try {
      const response = await this.uns.call(operation, body);
      return { value: response.data, status: 200 };
    } catch (error) {
      if (!(error instanceof UnsV2Error)) throw error;
      const info: ControlErrorInfo = {
        ...runInfo(error.data), status: error.status,
        errorCode: error.code.replace(/^UNS_V2_/, 'CONTROL_'),
        requestId: error.requestId, execution: error.execution, retry: error.retry,
        reason: error.reason, details: error.details, data: error.data,
      };
      if (error.outcomeUnknown) throw new ControlResultUnknownError(info);
      throw new ControlError(error.message, info);
    }
  }

  /** Discover visible contracts; defaults and authorization are resolved by the server. */
  async discover(options: ControlDiscoverOptions = {}): Promise<ControlDiscoverResponse> {
    keys(options, ['page', 'size', 'search']);
    if ((options.page !== undefined && (!Number.isSafeInteger(options.page) || options.page < 1)) ||
        (options.size !== undefined && (!Number.isSafeInteger(options.size) || options.size < 1 || options.size > 200)) ||
        (options.search !== undefined && typeof options.search !== 'string')) {
      throw new TypeError('Tier0 SDK: invalid Control discovery options.');
    }
    const { value, status } = await this.post('controlDiscover', options);
    if (!record(value) || !Number.isSafeInteger(value.total) || (value.total as number) < 0 ||
        !Array.isArray(value.list) || !value.list.every(definition)) {
      throw new ControlError('Invalid Control discovery response.', { status, errorCode: 'CONTROL_PROTOCOL_ERROR' });
    }
    return { total: value.total as number, list: value.list as PublicControl[] };
  }

  use<Input = ControlJSON, Result = ControlJSON>(selector: { code: string }): ControlHandle<Input, Result> {
    keys(selector, ['code']);
    const code = selector.code;
    if (typeof code !== 'string' || code.length > 128 || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(code)) {
      throw new TypeError('Tier0 SDK: invalid Control code.');
    }
    return {
      describe: async () => {
        const { value, status } = await this.post('controlDescribe', { code });
        if (!definition(value) || value.code !== code) {
          throw new ControlError('Invalid Control description.', { status, errorCode: 'CONTROL_PROTOCOL_ERROR' });
        }
        return value;
      },
      invoke: async (input, options = {}) => {
        keys(options, ['idempotencyKey']);
        const key = options.idempotencyKey;
        if (key !== undefined && (typeof key !== 'string' || !key || key.trim() !== key || new TextEncoder().encode(key).length > 128)) {
          throw new TypeError('Tier0 SDK: invalid Control idempotency key.');
        }
        if (!json(input)) throw new TypeError('Tier0 SDK: Control input must be JSON.');
        const { value, status } = await this.post('controlInvoke', {
          code, input: input as ControlJSON, ...(key === undefined ? {} : { idempotencyKey: key }),
        });
        if (!record(value) || value.code !== code || typeof value.contractVersion !== 'string' || !value.contractVersion ||
            !Object.prototype.hasOwnProperty.call(value, 'result') || typeof value.runId !== 'string' || !value.runId ||
            typeof value.status !== 'string' || !value.status || ['accepted', 'queued', 'pending', 'running'].includes(value.status) ||
            typeof value.replayed !== 'boolean') {
          throw new ControlResultUnknownError({ ...runInfo(value), status, errorCode: 'CONTROL_PROTOCOL_ERROR' });
        }
        return { code: value.code, contractVersion: value.contractVersion, result: value.result as Result,
          runID: value.runId, status: value.status, replayed: value.replayed };
      },
    };
  }
}

/** Uses configureClient()/TIER0_API_HOST/TIER0_API_KEY, resolved for every call. */
export const controls = new ControlsClient();
