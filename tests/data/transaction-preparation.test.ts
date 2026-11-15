import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDataClient, defineCollection } from '../../src/data/index.js';

const resources = defineCollection({ alias: 'resources', name: 'Resources', schema: z.object({ code: z.string() }), indexes: [{ path: 'code', unique: true }] });
const lines = defineCollection({ alias: 'lines', name: 'Lines', schema: z.object({ number: z.number().int() }), indexes: [{ path: 'number', unique: true }] });
const declarations = [resources, lines];

describe('transaction preparation', () => {
  it('rebuilds every target after recovery while retaining order and checking current indexes', async () => {
    let generation = 1, ensured = 0;
    const writes: { items: { opId: string; collectionId: string; data: unknown }[] }[] = [];
    const contexts: number[] = [];
    const response = (data: unknown) => Response.json({ code: 200, msg: 'ok', requestId: 'fixture', data });
    const data = createDataClient({ collections: declarations, apiHost: 'https://isolated.invalid', apiKey: 'fixture-only',
      logger: { info() {}, warn() {}, error() {} }, fetch: async (url, init) => {
        const path = new URL(String(url)).pathname;
        if (path.endsWith('/ensure')) {
          ensured++;
          return response({ appId: 'fixture', results: declarations.map(d => ({ alias: d.alias, collectionId: `${d.alias}-${generation}`, status: 'unchanged', revision: 1 })) });
        }
        if (path.endsWith('/context')) {
          contexts.push(generation);
          return response({ appId: 'fixture', collections: declarations.map(d => ({ alias: d.alias, collectionId: `${d.alias}-${generation}`,
            indexStatus: d.indexes!.map(spec => ({ spec, state: 'ready', name: 'fixture' })) })) });
        }
        if (path.endsWith('/records:transact')) {
          writes.push(JSON.parse(String(init?.body)));
          if (generation === 1) {
            generation++;
            return Response.json({ code: 403, msg: 'Recreated', requestId: 'fixture', data: { reason: 'COLLECTION_NOT_FOUND', collectionId: 'resources-1' },
              error: { code: 'FORBIDDEN', execution: 'notStarted', retry: { safe: false }, details: [] } }, { status: 403 });
          }
          return response({ status: 'committed', results: [] });
        }
        throw new Error('Unexpected fixture request');
      } });
    const steps = Array.from({ length: 40 }, (_, index) => index % 2 === 0
      ? { opId: `op-${index}`, action: 'record.create' as const, collection: resources, id: `r-${index}`, data: { code: `R${index}` } }
      : { opId: `op-${index}`, action: 'record.create' as const, collection: 'lines', id: `l-${index}`, data: { number: index } });
    await data.transact(steps, { requireIndexesReady: true });
    expect(ensured).toBe(2);
    expect(contexts).toEqual([1, 2]);
    expect(writes).toHaveLength(2);
    for (const [attempt, body] of writes.entries()) {
      expect(body.items.map(item => item.opId)).toEqual(steps.map(step => step.opId));
      expect(body.items.map(item => item.collectionId)).toEqual(steps.map((_, index) => `${index % 2 === 0 ? 'resources' : 'lines'}-${attempt + 1}`));
      expect(body.items.map(item => item.data)).toEqual(steps.map(step => step.data));
    }
  });
});
