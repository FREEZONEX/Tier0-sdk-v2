import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Script, runInNewContext } from 'node:vm';
import ts from 'typescript';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const contract = JSON.parse(read('contracts/uns-v2/contract.json'));
const schema = contract.schemas.RuntimeStreamDefinition;

// Inspect the real request fixtures without importing either live script or performing I/O.
function programFixture(path) {
  const file = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const programs = [];
  const literal = node => {
    if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(property => {
      assert.ok(ts.isPropertyAssignment(property));
      return [property.name.getText(file).replace(/^['"]|['"]$/g, ''), literal(property.initializer)];
    }));
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (ts.isIdentifier(node) && ['name', 'prefix'].includes(node.text)) return 'sdk-contract-fixture';
    throw new Error('Live program fixture must use inspectable literal fields');
  };
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'document' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      const program = {};
      for (const property of node.initializer.properties) {
        if (ts.isShorthandPropertyAssignment(property)) program[property.name.text] = literal(property.name);
        else {
          assert.ok(ts.isPropertyAssignment(property));
          const name = property.name.getText(file).replace(/^['"]|['"]$/g, '');
          assert.ok(!Object.hasOwn(program, name), 'Duplicate fixture field');
          program[name] = literal(property.initializer);
        }
      }
      programs.push(program);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.equal(programs.length, 1, 'Each live script must have exactly one standalone program fixture');
  return programs[0];
}

for (const path of ['scripts/check-live-stream-runtime.mjs', 'scripts/check-live-workflows.mjs']) {
  test(path + ' sends the current closed Runtime program contract', () => {
    const program = programFixture(path);
    assert.equal(schema.additionalProperties, false);
    for (const required of schema.required) assert.ok(Object.hasOwn(program, required), required);
    for (const [name, value] of Object.entries(program)) {
      assert.ok(Object.hasOwn(schema.properties, name), 'Retired or unknown program field: ' + name);
      const field = schema.properties[name];
      const type = field.$ref ? contract.schemas[field.$ref.split('/').at(-1)].type : field.type;
      if (type === 'integer') assert.ok(Number.isSafeInteger(value));
      else assert.equal(typeof value, type);
    }
    assert.equal(typeof program.script.code, 'string');
    assert.ok(Number.isSafeInteger(program.script.timeoutMs));
    assert.doesNotThrow(() => new Script(program.script.code));
    assert.match(program.script.code, /module\.exports\s*=/);
    const module = { exports: undefined };
    let registrations = 0;
    runInNewContext(program.script.code, { module });
    module.exports({ stream: { every(options, handler) {
      assert.ok(options.intervalMs > 0);
      assert.equal(typeof handler, 'function');
      registrations++;
    } } });
    assert.equal(registrations, 1, 'Program must use the supported timer entrypoint');
    assert.equal(Object.hasOwn(program, 'sdkVersion'), false);
    assert.equal(Object.hasOwn(schema.properties, 'sdkVersion'), false);
  });
}
