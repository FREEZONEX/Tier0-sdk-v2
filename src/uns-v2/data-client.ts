import { HttpClient, snapshotClientConfig, type ClientConfig } from '../openapi/client.js';
import type { CloudTransportConfig } from '../cloud-transport.js';
import { createUnsV2Client, type UnsV2Client } from './client.js';
import { UNS_V2_OPERATIONS, type UnsV2Operations, type UnsV2OperationName } from './generated.js';

/** Fleet inventory is center-only and belongs to no application facade; only the raw operation table carries it. */
const FLEET_OPERATIONS = ['edgeNodesList'] as const;
export type UnsDataOperationName = Exclude<UnsV2OperationName, `source${string}` | `stream${string}` | `control${string}` | typeof FLEET_OPERATIONS[number]>;
export type UnsDataClient = Readonly<Pick<UnsV2Operations, UnsDataOperationName>>;
/** Excludes Source, Stream and Control management and Fleet inventory from the application data facade. */
export function bindUnsDataClient(raw: UnsV2Client): UnsDataClient {
  return Object.freeze(Object.fromEntries(
    Object.keys(UNS_V2_OPERATIONS)
      .filter(name => !/^(source|stream|control)/.test(name) && !(FLEET_OPERATIONS as readonly string[]).includes(name))
      .map(name => [name, raw[name as UnsV2OperationName]]),
  )) as UnsDataClient;
}
export type UnsDataClientConfig = ClientConfig & CloudTransportConfig;
export function createUnsDataClient(config: UnsDataClientConfig = {}): UnsDataClient {
  const snapshot = snapshotClientConfig(config, ['transportTimeoutMs', 'unsV2MaxResponseBytes']);
  const http = new HttpClient(snapshot);
  return bindUnsDataClient(createUnsV2Client(() => http, snapshot));
}
