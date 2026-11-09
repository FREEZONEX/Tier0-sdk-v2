import { CloudTransport, CloudTransportError, DEFAULT_CLOUD_TRANSPORT_TIMEOUT_MS, type CloudTransportConfig } from '../cloud-transport.js';

export type StreamTransportConfig = Pick<CloudTransportConfig, 'transportTimeoutMs'>;
export const DEFAULT_STREAM_TRANSPORT_TIMEOUT_MS = DEFAULT_CLOUD_TRANSPORT_TIMEOUT_MS;
export { CloudTransport as StreamTransport, CloudTransportError as StreamTransportError };
