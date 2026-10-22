import { describe, expect, it } from 'vitest';
import * as declarations from '../../src/data/declarations.js';
import * as data from '../../src/data/index.js';

describe('@tier0/sdk-v2/data/define', () => {
  it('is the same implementation the server entry re-exports', () => {
    expect(Object.keys(declarations).sort()).toEqual(['CollectionSchemaError', 'MAX_COLLECTIONS', 'compileCollection', 'defineCollection', 'validateDocument']);
    for (const [name, value] of Object.entries(declarations)) expect(data[name as keyof typeof data]).toBe(value);
  });
});
