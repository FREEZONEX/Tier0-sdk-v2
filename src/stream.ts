import { HttpClient, type ClientConfig } from './openapi/client.js';
import { createUnsV2Client, type UnsV2Client } from './uns-v2/client.js';
import type { CloudTransportConfig } from './cloud-transport.js';

/** Runtime programs and native editor documents have distinct contracts. */
export function bindStreamClient(raw: UnsV2Client) {
  return Object.freeze({
    programs: Object.freeze({
      list: raw.streamProgramList,
      delete: raw.streamProgramDelete,
      deploy: raw.streamProgramDeploy,
      rollback: raw.streamProgramRollback,
      versions: Object.freeze({ list: raw.streamProgramVersionsList }),
    }),
    documents: Object.freeze({
      get: raw.streamDocumentGet, create: raw.streamDocumentCreate,
      update: raw.streamDocumentUpdate, validate: raw.streamDocumentValidate,
      disable: raw.streamDocumentDisable,
    }),
    runtime: Object.freeze({ capabilities: raw.streamRuntimeCapabilitiesGet }),
    observations: Object.freeze({ get: raw.streamObservationGet }),
    runs: Object.freeze({ list: raw.streamRunsList }),
    sampleTest: raw.streamSampleTest,
  });
}
export type StreamClient = ReturnType<typeof bindStreamClient>;
export type StreamClientConfig = ClientConfig & CloudTransportConfig;
export function createStreamClient(config: StreamClientConfig = {}): StreamClient {
  const http = new HttpClient(config);
  return bindStreamClient(createUnsV2Client(() => http, config));
}
