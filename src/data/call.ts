/**
 * One UNS call of the data layer. The SDK's UNS client resolves host and key,
 * sends the request and checks the envelope; this binds the employee data
 * subject of the current call and turns every failure into a `DataError`.
 */
import { HttpClient, type ClientConfig } from '../openapi/client.js';
import { UnsV2ClientCore, UnsV2Error } from '../uns-v2/client.js';
import type { UnsV2OperationName, UnsV2Request } from '../uns-v2/generated.js';
import { DataError, toDataError } from './error.js';

/** UNS statements time out at 15 s, so a data call waits no longer by default. */
export const DEFAULT_DATA_TIMEOUT_MS = 15_000;

export interface CallOptions {
  /** Employee assertion forwarded from the current business request. */
  dataSubject?: string;
}

/** Sends one operation and resolves with the envelope's `data`. */
export type DataCall = <T>(operation: UnsV2OperationName, request: Record<string, unknown>, options?: CallOptions) => Promise<T>;

export function createDataCall(config: ClientConfig): DataCall {
  const http = new HttpClient(config);
  const resolve = () => http;
  const transport = { transportTimeoutMs: config.transportTimeoutMs ?? DEFAULT_DATA_TIMEOUT_MS };
  const app = new UnsV2ClientCore(resolve, transport);

  function assertConfigured() {
    let problem: string | undefined;
    try {
      http.getBaseURL();
      if (!http.getApiKey()?.trim()) problem = 'TIER0_API_KEY is not set';
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
    if (problem) {
      throw new DataError({
        message: `${problem}. The platform injects TIER0_API_HOST and TIER0_API_KEY in Preview and deployments; for local development set them before starting the App.`,
        status: 503,
        code: 'DATA_NOT_CONFIGURED',
      });
    }
  }

  return async function call<T>(operation: UnsV2OperationName, request: Record<string, unknown>, options: CallOptions = {}): Promise<T> {
    assertConfigured();
    // The SDK binds a data subject to one client; App-level calls use the shared one without it.
    const core = options.dataSubject ? new UnsV2ClientCore(resolve, { ...transport, unsV2AppDataSubject: options.dataSubject }) : app;
    try {
      const response = await core.call(operation, request as UnsV2Request<typeof operation>);
      return response.data as T;
    } catch (error) {
      throw error instanceof UnsV2Error ? toDataError(error) : error;
    }
  };
}
