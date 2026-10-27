import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UNS_V2_CONTRACT_PROVENANCE, UNS_V2_OPERATIONS } from '../../src/uns-v2/generated.js';

const read = (path: string) => readFileSync(new URL('../../contracts/' + path, import.meta.url), 'utf8');
const contract = JSON.parse(read('uns-v2/contract.json'));
const manifest = JSON.parse(read('uns-v2/manifest.json'));
const catalogText = read('uns-v2/source-protocols.json');
const catalog = JSON.parse(catalogText);
const lock = JSON.parse(read('upstream.json'));
const http = catalog.list.find((item: { protocol: string }) => item.protocol === 'http-api');

describe('Cloud HTTP Source management contract', () => {
  it('pins the protocol catalog with the same committed provenance as the generated management API', () => {
    expect(lock.revision).toBe(UNS_V2_CONTRACT_PROVENANCE.revision);
    expect(lock.inputs['contracts/uns-v2/source-protocols.json']).toEqual({
      path: 'share/unscontract/source-protocols.json',
      sha256: createHash('sha256').update(catalogText).digest('hex'),
    });
  });

  it('uses http-api for native documents, list filters and credential creation', () => {
    for (const schemas of [contract.schemas, manifest.schemas]) {
      for (const name of ['CloudSourceDocument', 'CloudSourceDocumentListReq']) {
        const protocols = schemas[name].properties.protocol.enum;
        expect(protocols).toContain('http-api');
        expect(protocols).toContain('http_push');
        expect(protocols).not.toContain('http');
      }
      expect(schemas.CloudSourceDocumentCreateReq.allOf[0].oneOf[1]
        .properties.document.properties.protocol.enum).toEqual(['http-api']);
    }
    expect(catalog.list.some((item: { protocol: string }) => item.protocol === 'http')).toBe(false);
  });

  it('keeps roles inside Cloud config and separates managed Server from outbound Client options', () => {
    expect(contract.schemas.CloudSourceDocument.properties).not.toHaveProperty('role');
    expect(contract.schemas.CloudSourceConfig.oneOf[0].properties.role.enum).toEqual(['client', 'server']);
    const schema = http.configSchema;
    expect(schema.properties.role).toMatchObject({ default: 'client', enum: ['client', 'server'] });
    expect(schema['x-tier0-roles']).toEqual(['client', 'server']);
    expect(schema.properties.options.properties).toHaveProperty('headers');
    expect(schema.properties.options.properties).toHaveProperty('parameters');
    expect(schema.properties.options.properties).not.toHaveProperty('requestRules');
    expect(schema.allOf[0].then.properties).toEqual({
      auth: false, endpoint: { const: 'http://managed' }, options: { const: {} }, tls: false,
    });
    expect(schema['x-tier0-http-in']).toMatchObject({
      authentication: 'bearer', endpoint: 'http://managed', mode: 'synchronous',
    });
  });

  it('retains the independent asynchronous Push configuration without adding an SDK ingress API', () => {
    const push = catalog.list.find((item: { protocol: string }) => item.protocol === 'http_push');
    expect(push.operations).toEqual(['receive']);
    expect(push.configSchema.properties.endpoint.const).toBe('');
    expect(push.configSchema).not.toHaveProperty('x-tier0-http-in');
    expect(push.configSchema.properties).not.toHaveProperty('role');
    for (const name of ['sourceIngressGet', 'sourceIngressRotate', 'sourceCredentialCreate']) {
      expect(UNS_V2_OPERATIONS).not.toHaveProperty(name);
    }
  });
});
