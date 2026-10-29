import { describe, expect, it, vi } from 'vitest';
import { createClient, createUnsV2Client, UNS_V2_CODEC_SCHEMAS, UNS_V2_OPERATIONS } from '../src/index.js';
import { createStreamClient } from '../src/stream.js';
import { HttpClient } from '../src/openapi/client.js';

describe('retired Stream readiness probe', () => {
  it('exposes neither the facade nor its raw method or dedicated codecs', async () => {
    const fetch = vi.fn();
    const config = { apiHost: 'https://fixture.invalid', apiKey: 'fixture', fetch };
    const raw = createUnsV2Client(() => new HttpClient(config), config);
    expect(createClient(config).stream).not.toHaveProperty('runtime');
    expect(createStreamClient(config)).not.toHaveProperty('runtime');
    expect(raw).not.toHaveProperty('streamRuntimeCapabilitiesGet');
    expect(UNS_V2_OPERATIONS).not.toHaveProperty('streamRuntimeCapabilitiesGet');
    for (const name of ['CloudStreamRuntimeCapabilitiesGetReq', 'CloudStreamRuntimeCapabilitiesGetResponse']) {
      expect(UNS_V2_CODEC_SCHEMAS).not.toHaveProperty(name);
    }
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const dispatch = raw as unknown as { call(name: string, input: unknown): Promise<unknown> };
    await expect(dispatch.call('streamRuntimeCapabilitiesGet', circular)).rejects.toThrow('unknown UNS v2 operation');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves Stream management methods without a readiness preflight', () => {
    const stream = createStreamClient();
    for (const method of [stream.documents.create, stream.documents.update, stream.documents.get,
      stream.documents.validate, stream.documents.disable, stream.programs.deploy, stream.programs.rollback,
      stream.programs.delete, stream.programs.versions.list, stream.observations.get, stream.runs.list, stream.sampleTest]) {
      expect(method).toBeTypeOf('function');
    }
    expect(createClient()).not.toHaveProperty('controls');
  });
});
