import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CollectionSchemaError, compileCollection, defineCollection } from '../../src/data/declarations.js';

const declaration = { alias: 'orders', name: '生产工单', schema: z.object({ code: z.string() }) };

describe('collection business directory paths', () => {
  it('keeps the actual scope without filling unknown ISA-95 levels', () => {
    for (const directoryPath of [['苏州工厂'], ['苏州工厂', '装配一线'], ['苏州工厂', '装配一线', 'MES'], ['Acme', 'Plant A', 'Area 2', 'Line 1', 'Unit 4']]) {
      const defined = defineCollection({ ...declaration, directoryPath });
      expect(compileCollection(defined).directoryPath).toEqual(directoryPath);
    }
  });

  it('copies and freezes both the declared path and compiled payload path', () => {
    const directoryPath = ['苏州工厂', '装配一线'];
    const defined = defineCollection({ ...declaration, directoryPath });
    directoryPath[1] = '篡改';
    directoryPath.push('不存在的设备');
    const compiled = compileCollection(defined);
    expect(defined.directoryPath).toEqual(['苏州工厂', '装配一线']);
    expect(compiled.directoryPath).toEqual(['苏州工厂', '装配一线']);
    expect(Object.isFrozen(defined.directoryPath)).toBe(true);
    expect(Object.isFrozen(compiled.directoryPath)).toBe(true);
    expect(compiled.directoryPath).not.toBe(defined.directoryPath);
  });

  it('retains omitted paths for existing aliases instead of fabricating an App folder', () => {
    const defined = defineCollection(declaration);
    expect(defined).not.toHaveProperty('directoryPath');
    expect(compileCollection(defined)).not.toHaveProperty('directoryPath');
  });

  it.each([
    { directoryPath: [] }, { directoryPath: [''] }, { directoryPath: [' '] }, { directoryPath: [' 工厂'] },
    { directoryPath: ['工厂 '] }, { directoryPath: ['Plant/Line'] }, { directoryPath: ['Plant\0Line'] },
    { directoryPath: ['厂'.repeat(64)] }, { directoryPath: Array(17).fill('工厂') as string[] },
  ])('rejects an invalid path $directoryPath', ({ directoryPath }) => {
    expect(() => defineCollection({ ...declaration, directoryPath })).toThrow(/directoryPath/);
  });

  it('counts Unicode characters and accepts the supported maximum depth', () => {
    const directoryPath = Array.from({ length: 16 }, (_, index) => `${index}${'🏭'.repeat(61)}`);
    expect(compileCollection(defineCollection({ ...declaration, directoryPath })).directoryPath).toEqual(directoryPath);
  });

  it('also rejects a malformed hand-authored declaration during compilation', () => {
    const defined = { ...declaration, indexes: [], directoryPath: ['Plant/Line'] };
    try {
      compileCollection(defined);
      throw new Error('expected compilation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(CollectionSchemaError);
      expect((error as CollectionSchemaError).issues[0].path).toBe('directoryPath');
    }
  });
});
