import { HttpClient, type ClientConfig } from './openapi/client.js';
import { createUnsV2Client, type UnsV2Client } from './uns-v2/client.js';
import type { CloudTransportConfig } from './cloud-transport.js';

/** Source configuration and observations. Wire contracts and envelopes remain unchanged. */
export function bindSourceClient(raw: UnsV2Client) {
  return Object.freeze({
    list: raw.sourceList, get: raw.sourceGet, create: raw.sourceCreate,
    update: raw.sourceUpdate, delete: raw.sourceDelete,
    validate: raw.sourceValidate, probe: raw.sourceProbe,
    impact: raw.sourceImpact, history: raw.sourceHistory,
    protocols: Object.freeze({ list: raw.sourceProtocolsList }),
    connection: Object.freeze({ update: raw.sourceConnectionUpdate }),
    state: Object.freeze({ update: raw.sourceStateUpdate }),
    runtime: Object.freeze({ get: raw.sourceRuntimeGet }),
    observations: Object.freeze({ get: raw.sourceObservationsGet }),
    documents: Object.freeze({
      list: raw.sourceDocumentList, get: raw.sourceDocumentGet,
      create: raw.sourceDocumentCreate, update: raw.sourceDocumentUpdate,
    }),
  });
}
export type SourceClient = ReturnType<typeof bindSourceClient>;
export type SourceClientConfig = ClientConfig & CloudTransportConfig;
export function createSourceClient(config: SourceClientConfig = {}): SourceClient {
  const http = new HttpClient(config);
  return bindSourceClient(createUnsV2Client(() => http, config));
}
