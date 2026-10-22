import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toRecordSchema, validateUpdate, zodJsonSchema } from '../../src/data/schema.js';
import { CollectionSchemaError, compileCollection, defineCollection, toSortPairs, validateDocument } from '../../src/data/index.js';

const SAFE = Number.MAX_SAFE_INTEGER;

const workOrderSchema = z.object({
  code: z.string().describe('Work order code'),
  qty: z.number().int().min(1),
  price: z.number().min(0).max(1000),
  status: z.enum(['DRAFT', 'DONE', 'DRAFT']),
  line: z.object({ id: z.string(), name: z.string() }),
  lines: z.array(z.object({ sku: z.string(), count: z.number().int() })),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

function schemaError(schema: z.ZodType): CollectionSchemaError {
  try {
    toRecordSchema('probe', schema);
  } catch (error) {
    expect(error, String(error)).toBeInstanceOf(CollectionSchemaError);
    return error as CollectionSchemaError;
  }
  throw new Error('expected the schema to be rejected');
}

describe('zod 4 toJSONSchema output (snapshot)', () => {
  // Pins what zod actually emits; the normalizer below depends on this shape.
  it('emits closed objects, safe-integer bounds and output-mode required lists', () => {
    expect(zodJsonSchema(workOrderSchema)).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Work order code' },
        qty: { type: 'integer', minimum: 1, maximum: SAFE },
        price: { type: 'number', minimum: 0, maximum: 1000 },
        // z.enum already de-duplicates its values.
        status: { type: 'string', enum: ['DRAFT', 'DONE'] },
        line: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' } },
          required: ['id', 'name'],
          additionalProperties: false,
        },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: { sku: { type: 'string' }, count: { type: 'integer', minimum: -SAFE, maximum: SAFE } },
            required: ['sku', 'count'],
            additionalProperties: false,
          },
        },
        tags: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
      required: ['code', 'qty', 'price', 'status', 'line', 'lines'],
      additionalProperties: false,
    });
  });

  it('emits the keywords the normalizer must reject', () => {
    const raw = (schema: z.ZodType) => zodJsonSchema(z.object({ field: schema })).properties as Record<string, unknown>;
    // zod before 4.6 emitted anyOf here; both shapes are rejected (z.union covers anyOf).
    expect(raw(z.string().nullable()).field).toEqual({ type: ['string', 'null'] });
    expect(raw(z.string().default('x')).field).toEqual({ default: 'x', type: 'string' });
    expect(raw(z.string().min(1)).field).toEqual({ type: 'string', minLength: 1 });
    expect(raw(z.literal('k')).field).toEqual({ type: 'string', const: 'k' });
    expect(raw(z.number().positive()).field).toEqual({ type: 'number', exclusiveMinimum: 0 });
    expect(raw(z.record(z.string(), z.number())).field).toEqual({
      type: 'object',
      propertyNames: { type: 'string' },
      additionalProperties: { type: 'number' },
    });
    const email = raw(z.email()).field as Record<string, unknown>;
    expect(email.format).toBe('email');
    expect(typeof email.pattern).toBe('string');
  });
});

describe('toRecordSchema', () => {
  it('normalizes to the UNS subset', () => {
    expect(toRecordSchema('work_orders', workOrderSchema)).toEqual({
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Work order code' },
        qty: { type: 'integer', minimum: 1 },
        price: { type: 'number', minimum: 0, maximum: 1000 },
        status: { type: 'string', enum: ['DRAFT', 'DONE'] },
        line: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' } },
          required: ['id', 'name'],
          additionalProperties: false,
        },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: { sku: { type: 'string' }, count: { type: 'integer' } },
            required: ['count', 'sku'],
            additionalProperties: false,
          },
        },
        tags: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
      required: ['code', 'line', 'lines', 'price', 'qty', 'status'],
      additionalProperties: false,
    });
  });

  it('closes objects even when zod leaves them open in input mode', () => {
    const schema = toRecordSchema('x', z.object({ nested: z.strictObject({ a: z.boolean() }) }));
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties?.nested.additionalProperties).toBe(false);
  });

  it('rejects unstorable constructs with a concrete replacement', () => {
    const cases: [z.ZodType, RegExp][] = [
      [z.object({ a: z.string().nullable() }), /\.optional\(\)/],
      [z.object({ a: z.union([z.string(), z.number()]) }), /z\.union\(\)/],
      [z.object({ a: z.string().default('x') }), /Apply defaults in the service/],
      [z.object({ a: z.email() }), /toISOString|API input schema/],
      [z.object({ a: z.string().regex(/x/) }), /pattern/],
      [z.object({ a: z.string().min(1) }), /API input schema/],
      [z.object({ a: z.literal('k') }), /z\.enum/],
      [z.object({ a: z.number().positive() }), /inclusive `\.min\(\)`/],
      [z.object({ a: z.record(z.string(), z.number()) }), /closed/],
      [z.looseObject({ a: z.string() }), /closed/],
      [z.object({ a: z.array(z.string()).min(1) }), /Array length/],
      [z.object({ a: z.any() }), /concrete type/],
      [z.object({ a: z.tuple([z.string(), z.number()]) }), /z\.tuple\(\)/],
      [z.object({ _id: z.string() }), /system field/],
      [z.object({ 'a.b': z.string() }), /must not contain/],
      [z.object({ '[]': z.string() }), /reserved/],
    ];
    for (const [schema, hint] of cases) {
      const error = schemaError(schema);
      expect(error.message, error.message).toMatch(hint);
    }
  });

  it('explains unrepresentable zod types', () => {
    expect(schemaError(z.object({ at: z.date() })).message).toMatch(/toISOString/);
    expect(schemaError(z.object({ n: z.string().transform((value) => value.length) })).message).toMatch(/transforms/);
  });

  it('measures title and description in UTF-8 bytes like UNS', () => {
    expect(toRecordSchema('x', z.object({ a: z.string().describe('a'.repeat(2048)) })).properties?.a.description?.length).toBe(2048);
    // 683 CJK characters are 2049 bytes.
    expect(schemaError(z.object({ a: z.string().describe('中'.repeat(683)) })).message).toMatch(/2048 UTF-8 bytes/);
  });

  it('enforces UNS limits', () => {
    let deep: z.ZodType = z.string();
    for (let level = 0; level < 9; level += 1) deep = z.object({ next: deep });
    expect(schemaError(deep as z.ZodObject).message).toMatch(/deeper than 8/);
    const wide = Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`f${index}`, z.string()]));
    expect(schemaError(z.object(wide)).message).toMatch(/128 properties/);
  });
});

describe('compileCollection', () => {
  it('normalizes indexes and validates paths', () => {
    const compiled = compileCollection(
      defineCollection({
        alias: 'orders',
        schema: workOrderSchema,
        indexes: [{ path: 'code', unique: true }, { paths: ['status', 'line.id'] }, { path: 'tags', kind: 'gin' }, { path: 'code', unique: true }],
      }),
    );
    expect(compiled.indexes).toEqual([{ path: 'code', unique: true }, { paths: ['status', 'line.id'] }, { path: 'tags', kind: 'gin' }]);
  });

  it('rejects invalid indexes', () => {
    const bad = (indexes: Parameters<typeof defineCollection>[0]['indexes']) =>
      expect(() => compileCollection(defineCollection({ alias: 'orders', schema: workOrderSchema, indexes }))).toThrow(CollectionSchemaError);
    bad([{ path: 'missing' }]);
    bad([{ path: 'tags', kind: 'gin', unique: true }]);
    bad([{ path: 'line' }]);
    bad([{ path: 'code', paths: ['qty'] }]);
    bad([{ paths: ['code', 'qty', 'price', 'status'] }]);
    bad([{ paths: ['code', 'code'] }]);
    bad([{ path: 'code', kind: 'gin' }]);
  });

  it('compiles one TTL index on an integer millisecond field', () => {
    const sessions = z.object({ user: z.string(), expiresAt: z.number().int(), note: z.string(), at: z.object({ ms: z.number().int() }) });
    const compiled = compileCollection(
      defineCollection({ alias: 'sessions', schema: sessions, indexes: [{ path: 'user' }, { path: 'expiresAt', expireAfterSeconds: 3600 }] }),
    );
    expect(compiled.indexes).toEqual([{ path: 'user' }, { path: 'expiresAt', expireAfterSeconds: 3600 }]);
    const ttl = (indexes: Parameters<typeof defineCollection>[0]['indexes']) => () =>
      compileCollection(defineCollection({ alias: 'sessions', schema: sessions, indexes }));
    expect(ttl([{ path: 'expiresAt', expireAfterSeconds: 59 }])).toThrow(/60 to 31536000/);
    expect(ttl([{ path: 'expiresAt', expireAfterSeconds: 31_536_001 }])).toThrow(/60 to 31536000/);
    expect(ttl([{ path: 'expiresAt', expireAfterSeconds: 90.5 }])).toThrow(/integer/);
    expect(ttl([{ path: 'note', expireAfterSeconds: 3600 }])).toThrow(/Unix milliseconds/);
    expect(ttl([{ paths: ['expiresAt', 'user'], expireAfterSeconds: 3600 }])).toThrow(/single `path`/);
    expect(ttl([{ path: 'expiresAt', unique: true, expireAfterSeconds: 3600 }])).toThrow(/neither unique/);
    expect(ttl([{ path: 'expiresAt', expireAfterSeconds: 3600 }, { path: 'at.ms', expireAfterSeconds: 60 }])).toThrow(/at most one TTL index/);
    expect(ttl([{ path: 'at.ms', expireAfterSeconds: 60 }])).not.toThrow();
    // A plain index on the TTL path is the same B-tree: it is folded into the TTL index.
    expect(ttl([{ path: 'expiresAt' }, { path: 'expiresAt', expireAfterSeconds: 3600 }, { paths: ['expiresAt', 'user'] }])().indexes).toEqual([
      { path: 'expiresAt', expireAfterSeconds: 3600 },
      { paths: ['expiresAt', 'user'] },
    ]);
  });

  it('explains index paths that reach into array items', () => {
    expect(() => compileCollection(defineCollection({ alias: 'orders', schema: workOrderSchema, indexes: [{ path: 'lines.sku' }] }))).toThrow(
      /reaches into the items of array "lines"/,
    );
    expect(() => compileCollection(defineCollection({ alias: 'orders', schema: workOrderSchema, indexes: [{ path: 'lines.0.sku' }] }))).toThrow(CollectionSchemaError);
  });

  it('validates aliases, description length and seed size', () => {
    expect(() => defineCollection({ alias: '9orders', schema: workOrderSchema })).toThrow(/must match/);
    defineCollection({ alias: 'ok', schema: z.object({ a: z.string() }), description: '中'.repeat(512) });
    expect(() => defineCollection({ alias: 'long', schema: z.object({ a: z.string() }), description: 'a'.repeat(513) })).toThrow(/512 characters/);
    const seed = Array.from({ length: 1001 }, (_, n) => ({ _id: `s${n}`, a: 'x' }));
    expect(() => defineCollection({ alias: 'seeded', schema: z.object({ a: z.string() }), seed })).toThrow(/at most 1000 seed documents/);
  });
});

describe('write validation', () => {
  const orders = defineCollection({ alias: 'orders', schema: workOrderSchema });
  const doc = {
    code: 'WO-1',
    qty: 2,
    price: 10,
    status: 'DRAFT' as const,
    line: { id: 'l1', name: 'Line 1' },
    lines: [{ sku: 'A', count: 1 }],
  };

  it('splits _id, drops _meta and strictly validates the body', () => {
    expect(validateDocument(orders, { ...doc, _id: 'wo-1', _meta: { revision: 3 } })).toEqual({ id: 'wo-1', data: doc });
    expect(() => validateDocument(orders, { ...doc, extra: 1 })).toThrow(z.ZodError);
    expect(() => validateDocument(orders, { ...doc, extra: 1 })).toThrow(/extra/);
    const nested = (() => {
      try {
        validateDocument(orders, { ...doc, lines: [{ sku: 'A', count: 1, colour: 'red' }] });
      } catch (error) {
        return error;
      }
    })();
    expect(nested).toBeInstanceOf(z.ZodError);
    expect((nested as z.ZodError).issues[0].path.join('.')).toBe('lines.0');
    expect(() => validateDocument(orders, { ...doc, qty: 0 })).toThrow(z.ZodError);
    expect(() => validateDocument(orders, { ...doc, _id: '' })).toThrow(z.ZodError);
  });

  it('validates update operator paths and values', () => {
    expect(validateUpdate(orders, { $set: { status: 'DONE', 'line.name': 'L' }, $inc: { qty: 1 } })).toEqual({
      $set: { status: 'DONE', 'line.name': 'L' },
      $inc: { qty: 1 },
    });
    expect(validateUpdate(orders, { $push: { lines: { $each: [{ sku: 'B', count: 2 }] } } })).toEqual({
      $push: { lines: { $each: [{ sku: 'B', count: 2 }] } },
    });
    expect(validateUpdate(orders, { $set: { 'lines.$.count': 3, notes: undefined } })).toEqual({ $set: { 'lines.$.count': 3 } });
    expect(() => validateUpdate(orders, { $set: { missing: 1 } })).toThrow(/not a declared field/);
    expect(() => validateUpdate(orders, { $set: { status: 'LOST' } })).toThrow(z.ZodError);
    expect(() => validateUpdate(orders, { $set: { line: { id: 'x', name: 'y', z: 1 } } })).toThrow(/Unknown field/);
    expect(() => validateUpdate(orders, { $push: { lines: { sku: 'B' } } })).toThrow(z.ZodError);
    expect(() => validateUpdate(orders, { $inc: { code: 1 } })).toThrow(/numeric field/);
    expect(() => validateUpdate(orders, { $set: { '_meta.revision': 1 } })).toThrow(/read-only/);
    expect(() => validateUpdate(orders, { status: 'DONE' })).toThrow(/use replaceOne/);
    expect(() => validateUpdate(orders, { $set: { notes: undefined } })).toThrow(/\$unset/);
  });
});

describe('sort specs', () => {
  it('converts Mongo sort specs to UNS pairs', () => {
    expect(toSortPairs({ status: 1, '_meta.createdAt': 'desc' })).toEqual([['status', 1], ['_meta.createdAt', -1]]);
    expect(toSortPairs([['code', -1]])).toEqual([['code', -1]]);
    expect(toSortPairs({})).toBe(undefined);
    expect(() => toSortPairs({ a: 1, b: 1, c: 1, d: 1, e: 1 })).toThrow(/4 fields/);
  });

});
