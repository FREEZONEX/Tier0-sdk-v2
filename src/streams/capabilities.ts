import { CapabilitiesClient, type CapabilityCode } from '../capabilities.js';
import { getClient, type HttpClient } from '../openapi/client.js';
import { StreamTransport, type StreamTransportConfig } from './transport.js';

/** App 交互能力独立验证，避免其契约升级阻断 Source/UNS 管理。 */
export class StreamCapabilitiesClient extends CapabilitiesClient {
  protected override readonly contracts: Partial<Record<CapabilityCode, string[]>> = {
    'stream.requests.v1': ['openapi/v2', 'stream-requests/v1'],
    'stream.requests.invoke.v1': ['openapi/v2', 'stream-requests/v1'],
  };

  constructor(resolveClient: () => HttpClient = getClient, config: StreamTransportConfig = {}) {
    super(resolveClient, config);
    this.transport = new StreamTransport(resolveClient, config);
  }
}
