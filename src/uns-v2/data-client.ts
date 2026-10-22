import { HttpClient, type ClientConfig } from '../openapi/client.js';
import type { CloudTransportConfig } from '../cloud-transport.js';
import { createUnsV2Client, type UnsV2Client } from './client.js';
import { UNS_V2_OPERATIONS, type UnsV2Operations, type UnsV2OperationName } from './generated.js';

export type UnsDataOperationName = Exclude<UnsV2OperationName, `source${string}` | `stream${string}` | `control${string}`>;
export type UnsDataClient = Readonly<Pick<UnsV2Operations, UnsDataOperationName>>;
/** Excludes Source, Stream and Control management from the application data facade. */
export function bindUnsDataClient(raw: UnsV2Client): UnsDataClient {
  return Object.freeze(Object.fromEntries(
    Object.keys(UNS_V2_OPERATIONS)
      .filter(name => !/^(source|stream|control)/.test(name))
      .map(name => [name, raw[name as UnsV2OperationName]]),
  )) as UnsDataClient;
}
export type UnsDataClientConfig = ClientConfig & CloudTransportConfig;
export function createUnsDataClient(config: UnsDataClientConfig = {}): UnsDataClient {
  const http = new HttpClient(config);
  return bindUnsDataClient(createUnsV2Client(() => http, config));
}
