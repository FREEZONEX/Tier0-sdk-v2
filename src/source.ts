import { HttpClient, type ClientConfig } from './openapi/client.js';
import { createUnsV2Client, type UnsV2Client } from './uns-v2/client.js';
import type { CloudTransportConfig } from './cloud-transport.js';

/** Documents are canonical. Compatibility shortcuts keep their original routes and receipts. */
export function bindSourceClient(raw: UnsV2Client) {
  return Object.freeze({
    /** @deprecated New requests use documents.list. */
    list: raw.sourceList,
    /** @deprecated New requests use documents.get with view summary/full. */
    get: raw.sourceGet,
    /** @deprecated New requests use documents.create. Pending retries must keep the original operation. */
    create: raw.sourceCreate,
    /** @deprecated New requests use documents.update with document, patch or items as its generated type permits. */
    update: raw.sourceUpdate,
    delete: raw.sourceDelete,
    validate: raw.sourceValidate, probe: raw.sourceProbe,
    impact: raw.sourceImpact, history: raw.sourceHistory,
    protocols: Object.freeze({ list: raw.sourceProtocolsList }),
    /** @deprecated New connection edits use documents.update. This method retains its original wire contract. */
    connection: Object.freeze({ update: raw.sourceConnectionUpdate }),
    state: Object.freeze({ update: raw.sourceStateUpdate }),
    runtime: Object.freeze({ get: raw.sourceRuntimeGet }),
    observations: Object.freeze({ get: raw.sourceObservationsGet }),
    /** Canonical Source reads and writes; request alternatives come from the pinned generated contract. */
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
