import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CollectionSchemaError, compileCollection, createDataClient, defineCollection, type IndexSpec } from '../../src/data/index.js';

const schema = z.object({ lineId: z.string(), state: z.string(), expiresAt: z.number().int().optional() });
const declaration = (index: IndexSpec) => defineCollection({ alias: 'reviews', name: 'Reviews', schema, indexes: [index] });

describe('index options preserve declared constraint semantics', () => {
  it.each(['where', 'partialFilterExpression', 'sparse', 'nullsNotDistinct', 'uniqe'])('rejects unsupported %s instead of discarding it', key => {
    // JavaScript/JSON and structurally typed variables can carry extra fields.
    const index = { path: 'lineId', unique: true, [key]: { state: 'In Review' } };
    expect(() => compileCollection(declaration(index))).toThrow(CollectionSchemaError);
    expect(() => compileCollection(declaration(index))).toThrow(`indexes[0].${key}`);
  });

  it.each(['false', 0, null])('rejects non-boolean unique=%s instead of using truthiness', unique => {
    expect(() => compileCollection(declaration({ path: 'lineId', unique } as unknown as IndexSpec))).toThrow(CollectionSchemaError);
  });

  it('rejects partial uniqueness before any ensure or seed network request', async () => {
    const fetch = vi.fn(async () => { throw new Error('Unexpected platform request'); });
    const review = declaration({ path: 'lineId', unique: true, where: { state: 'In Review' } } as IndexSpec);
    await expect(async () => {
      const data = createDataClient({ collections: [review], apiHost: 'https://isolated.invalid', apiKey: 'local-test-only', fetch });
      await data.ensure();
    }).rejects.toBeInstanceOf(CollectionSchemaError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves supported uniqueness and TTL options', () => {
    expect(compileCollection(declaration({ path: 'lineId', unique: false })).indexes).toEqual([{ path: 'lineId' }]);
    expect(compileCollection(declaration({ paths: ['lineId', 'state'], unique: true })).indexes).toEqual([{ paths: ['lineId', 'state'], unique: true }]);
    expect(compileCollection(declaration({ path: 'expiresAt', expireAfterSeconds: 3600 })).indexes).toEqual([{ path: 'expiresAt', expireAfterSeconds: 3600 }]);
  });
});
