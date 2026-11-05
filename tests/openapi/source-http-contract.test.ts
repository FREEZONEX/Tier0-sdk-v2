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
      for (const name of ['SourceDefinition', 'CloudSourceDocumentListReq']) {
        const protocols = schemas[name].properties.protocol.enum;
        expect(protocols).toContain('http-api');
        expect(protocols).not.toContain('http_push');
        expect(protocols).not.toContain('http');
      }
      expect(schemas.CloudSourceDocumentCreateReq.properties.document.$ref).toBe('#/components/schemas/SourceDefinition');
    }
    expect(catalog.list.some((item: { protocol: string }) => item.protocol === 'http')).toBe(false);
    expect(catalog.list.some((item: { protocol: string }) => item.protocol === 'http_push')).toBe(false);
  });

  it('shares top-level native connection fields and write-only credential material', () => {
    for (const schemas of [contract.schemas, manifest.schemas]) {
      const source = schemas.SourceDefinition;
      expect(source.properties.role).toMatchObject({ default: 'client', enum: ['client', 'server'] });
      expect(source.properties).not.toHaveProperty('config');
      expect(source.properties.http.$ref).toBe('#/components/schemas/HTTPConnection');
      expect(schemas.HTTPConnection.properties).toHaveProperty('parameters');
      const credentials = schemas.SourceCredentials;
      expect(credentials.required).toEqual(['kind']);
      expect(credentials.properties.kind.enum).toEqual(expect.arrayContaining(['basic', 'bearer', 'oauth2', 'custom']));
      expect(credentials.properties.secret.writeOnly).toBe(true);
      expect(credentials.properties.values.writeOnly).toBe(true);
      expect(credentials.properties).not.toHaveProperty('material');
      expect(credentials.properties).not.toHaveProperty('method');
    }
    expect(UNS_V2_OPERATIONS.sourceNativeCredentialsUpdate.path).toBe('/openapi/v2/uns/sources/documents/credentials/update');
    expect(UNS_V2_OPERATIONS.sourceDocumentDelete.path).toBe('/openapi/v2/uns/sources/documents/delete');
    expect(UNS_V2_OPERATIONS).not.toHaveProperty('sourceDelete');
  });

  it('removes Push schemas and aliases without adding an SDK ingress or reply API', () => {
    for (const input of [contract, manifest, JSON.parse(read('openapi-v2.source.json')), catalog]) {
      expect(JSON.stringify(input)).not.toContain('http_push');
      expect(JSON.stringify(input)).not.toContain('/ingest/v1/messages');
    }
    for (const name of ['sourceIngressGet', 'sourceIngressRotate', 'sourceCredentialCreate']) {
      expect(UNS_V2_OPERATIONS).not.toHaveProperty(name);
    }
    expect(Object.keys(UNS_V2_OPERATIONS).some(name => /reply|push/i.test(name))).toBe(false);
  });

  it('uses the current single-model document shapes without restoring generation selectors', () => {
    for (const schemas of [contract.schemas, manifest.schemas]) {
      expect(schemas.SourceDefinition.properties).not.toHaveProperty('configVersion');
      for (const name of ['RuntimeStreamDefinition', 'StreamScript']) {
        expect(schemas[name].properties).not.toHaveProperty('sdkVersion');
        expect(schemas[name].required).not.toContain('sdkVersion');
      }
      expect(schemas.RuntimeStreamDefinition.properties.script.$ref).toBe('#/components/schemas/StreamScript');
      expect(schemas.StreamScript.properties.code.type).toBe('string');
    }
  });
});
