import { HttpClient, type ClientConfig } from './openapi/client.js';
import { createOpenAPI } from './openapi/api.generated.js';
import { createUnsV2Client } from './uns-v2/client.js';
import { ControlsClient } from './controls.js';
import { CapabilitiesClient } from './capabilities.js';
import { FilesClient } from './files.js';
import type { CloudTransportConfig } from './cloud-transport.js';

export interface Tier0ClientConfig extends ClientConfig, CloudTransportConfig {}
/** Use a fresh instance per incoming request when supplying employee data delegation. */
export function createClient(config: Tier0ClientConfig = {}) {
  const snapshot = Object.freeze({ ...config });
  const http = new HttpClient(snapshot);
  const api = createOpenAPI(http);
  const resolve = () => http;
  return Object.freeze({
    system: api.system,
    members: api.members,
    notifications: api.notifications,
    mqttAuth: api.mqttAuth,
    agent: api.agent,
    files: new FilesClient(http),
    capabilities: new CapabilitiesClient(resolve, snapshot),
    controls: new ControlsClient(resolve, snapshot),
    uns: createUnsV2Client(resolve, snapshot),
    api,
  });
}
export type Tier0Client = ReturnType<typeof createClient>;
