import { HttpClient, type ClientConfig } from './openapi/client.js';
import { createUnsV2Client, type UnsV2Client } from './uns-v2/client.js';
import type { CloudTransportConfig } from './cloud-transport.js';

/** Documents are canonical for new edits. Existing program shortcuts retain their routes and receipts. */
export function bindStreamClient(raw: UnsV2Client) {
  return Object.freeze({
    programs: Object.freeze({
      list: raw.streamProgramList,
      /** @deprecated New reads use documents.get with view summary/full. */
      get: raw.streamProgramGet,
      /** @deprecated New requests use documents.create with document or program. Original retries stay here. */
      create: raw.streamProgramCreate,
      /** @deprecated New requests use documents.update with document or program. */
      update: raw.streamProgramUpdate,
      delete: raw.streamProgramDelete,
      /** @deprecated New validation uses documents.validate with document or program. */
      validate: raw.streamProgramValidate,
      deploy: raw.streamProgramDeploy,
      /** @deprecated New requests use documents.disable. */
      disable: raw.streamProgramDisable,
      rollback: raw.streamProgramRollback,
      versions: Object.freeze({ list: raw.streamProgramVersionsList }),
    }),
    /** Canonical native documents and runtime program input, exactly as declared by generated types. */
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
