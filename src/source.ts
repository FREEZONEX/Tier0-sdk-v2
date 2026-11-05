import { HttpClient, snapshotClientConfig, type ClientConfig } from './openapi/client.js';
import { createUnsV2Client, type UnsV2Client } from './uns-v2/client.js';
import type { CloudTransportConfig } from './cloud-transport.js';

/** Source configuration and observations. Wire contracts and envelopes remain unchanged. */
export function bindSourceClient(raw: UnsV2Client) {
  return Object.freeze({
    delete: raw.sourceDelete,
    validate: raw.sourceValidate, probe: raw.sourceProbe,
    discover: raw.sourceDiscover,
    impact: raw.sourceImpact, history: raw.sourceHistory,
    protocols: Object.freeze({ list: raw.sourceProtocolsList }),
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
  const snapshot = snapshotClientConfig(config, ['transportTimeoutMs', 'unsV2MaxResponseBytes', 'unsV2AppDataSubject']);
  const http = new HttpClient(snapshot);
  return bindSourceClient(createUnsV2Client(() => http, snapshot));
}
