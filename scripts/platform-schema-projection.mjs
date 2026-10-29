const schemaPrefix = '#/components/schemas/';

export function platformSchemaProjection(sourceSchemas, paths) {
  const reachable = new Set();
  function collect(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.$ref === 'string' && value.$ref.startsWith(schemaPrefix)) {
      const name = value.$ref.slice(schemaPrefix.length);
      if (name.includes('/') || !Object.hasOwn(sourceSchemas, name)) {
        throw new Error(`Unknown schema: ${name}`);
      }
      if (!reachable.has(name)) {
        reachable.add(name);
        collect(sourceSchemas[name]);
      }
    }
    for (const child of Object.values(value)) collect(child);
  }
  collect(paths);

  const names = new Map();
  return Object.fromEntries([...reachable].map(name => {
    const normalized = name.startsWith('Platform') ? name.slice('Platform'.length) : name;
    if (!normalized || names.has(normalized)) {
      throw new Error(`Platform schema name collision: ${names.get(normalized)} / ${name}`);
    }
    names.set(normalized, name);
    return [normalized, sourceSchemas[name]];
  }));
}
