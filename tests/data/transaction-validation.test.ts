import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCollection, type CollectionTarget } from '../../src/data/define.js';
import { createStepDataValidator, validateStepData } from '../../src/data/schema.js';

const events = defineCollection({ alias: 'events', name: 'Events', schema: z.object({
  code: z.string(), count: z.number().int().min(1), createdAt: z.number().int(), updatedAt: z.number().int(),
  details: z.object({ label: z.string(), readings: z.array(z.object({ value: z.number() })) }),
}) });
const timestamps = ['createdAt', 'updatedAt'];
const valid = () => ({ code: 'example', count: 2, details: { label: 'reading', readings: [{ value: 3 }] } });

function outcome(validate: typeof validateStepData, definition: CollectionTarget, data: Record<string, unknown>, fields: readonly string[]) {
  try { return { value: validate(definition, data, fields) }; }
  catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    return { issues: error.issues };
  }
}

describe('transaction-scoped Zod schema reuse', () => {
  it.each([
    { name: 'omitted bound timestamps', data: valid(), fields: timestamps, accepted: true },
    { name: 'bound scalar placeholders', data: { ...valid(), createdAt: null, updatedAt: null }, fields: timestamps, accepted: true },
    { name: 'duplicate/reordered bound fields', data: valid(), fields: ['updatedAt', 'createdAt', 'updatedAt'], accepted: true },
    { name: 'missing required literal', data: { ...valid(), code: undefined }, fields: timestamps, accepted: false },
    { name: 'unknown root literal', data: { ...valid(), surprise: true }, fields: timestamps, accepted: false },
    { name: 'unknown nested literal', data: { ...valid(), details: { ...valid().details, surprise: true } }, fields: timestamps, accepted: false },
    { name: 'unknown array-item literal', data: { ...valid(), details: { label: 'reading', readings: [{ value: 3, surprise: true }] } }, fields: timestamps, accepted: false },
    { name: 'fractional integer', data: { ...valid(), count: 1.5 }, fields: timestamps, accepted: false },
    { name: 'out-of-range integer', data: { ...valid(), count: 0 }, fields: timestamps, accepted: false },
    { name: 'unsafe integer', data: { ...valid(), count: Number.MAX_SAFE_INTEGER + 1 }, fields: timestamps, accepted: false },
    { name: 'undeclared binding', data: valid(), fields: [...timestamps, 'missing'], accepted: false },
    { name: 'reserved id', data: { ...valid(), _id: 'forbidden' }, fields: timestamps, accepted: false },
    { name: 'reserved metadata', data: { ...valid(), _meta: {} }, fields: timestamps, accepted: false },
    { name: 'bound values become required when unbound', data: valid(), fields: [], accepted: false },
    { name: 'only one timestamp bound', data: valid(), fields: ['createdAt'], accepted: false },
  ])('preserves acceptance and complete issue paths: $name', ({ data, fields, accepted }) => {
    const validate = createStepDataValidator();
    validate(events, valid(), timestamps);
    const expected = outcome(validateStepData, events, data, fields), actual = outcome(validate, events, data, fields);
    expect(actual).toEqual(expected);
    expect('value' in actual).toBe(accepted);
  });

  it('separates binding variants and declarations sharing the same alias', () => {
    const validate = createStepDataValidator();
    validate(events, valid(), timestamps);
    const alternate = defineCollection({ alias: events.alias, name: 'Alternate', schema: z.object({ code: z.number(), createdAt: z.number() }) });
    expect(() => validate(alternate, { code: 'wrong' }, ['createdAt'])).toThrow(z.ZodError);
    expect(validate(alternate, { code: 7 }, ['createdAt'])).toEqual({ code: 7 });
    expect(() => validate(events, valid(), ['createdAt'])).toThrow(z.ZodError);
    expect(validate(events, { ...valid(), updatedAt: 42 }, ['createdAt'])).toEqual({ ...valid(), updatedAt: 42 });
    expect(validate(events, valid(), timestamps)).toEqual(valid());
  });

  it('revalidates changed data and returns independent parsed literal objects', () => {
    const validate = createStepDataValidator(), data = valid();
    const first = validate(events, data, timestamps), second = validate(events, data, timestamps);
    expect(first).toEqual(second);
    expect(first.details).not.toBe(second.details);
    expect(first.details).not.toBe(data.details);
    data.count = -1;
    expect(() => validate(events, data, timestamps)).toThrow(z.ZodError);
    expect(first.count).toBe(2);
  });

  it('retains schema validation for existing-ID references and schema-free behavior', () => {
    const validate = createStepDataValidator(), reference = { collectionId: 'existing', schema: events.schema };
    expect(validate(reference, valid(), timestamps)).toEqual(valid());
    expect(() => validate(reference, { ...valid(), count: -1 }, timestamps)).toThrow(z.ZodError);
    const withoutSchema = { collectionId: 'external' }, data = { arbitrary: { payload: null } };
    expect(validate(withoutSchema, data, [])).toBe(data);
    expect(() => validate(withoutSchema, { _meta: {} }, [])).toThrow(z.ZodError);
  });
});
