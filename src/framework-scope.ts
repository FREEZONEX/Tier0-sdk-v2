const scopes = new WeakMap<object, number>();
let nextScope = 0;
export function clientScope(client: object): number {
  let scope = scopes.get(client);
  if (scope === undefined) { scope = ++nextScope; scopes.set(client, scope); }
  return scope;
}
