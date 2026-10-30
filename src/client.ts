import { StreamRequestsClient } from './streams/requests.js';
import { StreamMessagesClient } from './streams/messages.js';
import { StreamTransport } from './streams/transport.js';
import { StreamCapabilitiesClient } from './streams/capabilities.js';
import { getClient, HttpClient, type ClientConfig } from './openapi/client.js';
import { createOpenAPI } from './openapi/api.generated.js';
import { createUnsV2Client } from './uns-v2/client.js';
import { bindUnsDataClient } from './uns-v2/data-client.js';
import { bindSourceClient } from './source.js';
import { bindStreamClient } from './stream.js';
import { CapabilitiesClient } from './capabilities.js';
import { FilesClient } from './files.js';
import type { CloudTransportConfig } from './cloud-transport.js';

export interface Tier0ClientConfig extends ClientConfig, CloudTransportConfig {}
/** Use a fresh instance per incoming request when supplying employee data delegation. */
function assemble(resolve: () => HttpClient, snapshot: Tier0ClientConfig) {
  const http = resolve();
  const api = createOpenAPI(http);
  const transport = new StreamTransport(resolve, snapshot);
  const messages = new StreamMessagesClient(transport);
  const raw = createUnsV2Client(resolve, snapshot);
  return Object.freeze({
    streams: { requests: new StreamRequestsClient(transport), messages, capabilities: new StreamCapabilitiesClient(resolve, snapshot) },
    dispose: () => messages.dispose(),
    system: api.system,
    members: api.members,
    notifications: api.notifications,
    mqttAuth: api.mqttAuth,
    agent: api.agent,
    files: new FilesClient(http),
    capabilities: new CapabilitiesClient(resolve, snapshot),
    source: bindSourceClient(raw),
    stream: bindStreamClient(raw),
    uns: bindUnsDataClient(raw),
    api,
  });
}
export type Tier0Client = ReturnType<typeof createClient>;

/** 现役服务端和数据客户端保留独立配置；浏览器交互仅使用受信宿主。 */
export function createClient(config: Tier0ClientConfig = {}) {
  const snapshot = Object.freeze({ ...config });
  const http = new HttpClient(snapshot);
  return assemble(() => http, snapshot);
}

// 全局兼容入口也在调用时读取 configureClient，不固化模块导入时的配置。
const defaultHttp = new Proxy(new HttpClient(), {
  get(_target, key) {
    const current = getClient();
    const value: unknown = Reflect.get(current, key);
    return typeof value === 'function' ? value.bind(current) : value;
  },
});
/** App 默认交互客户端在调用时解析宿主，无需在浏览器配置密钥。 */
export const client = assemble(() => defaultHttp, {});
