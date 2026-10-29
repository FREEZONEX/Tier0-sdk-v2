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
      const type = schema.properties[name].type;
      if (type === 'integer') assert.ok(Number.isSafeInteger(value));
      else assert.equal(typeof value, type);
    }
    assert.equal(typeof program.script, 'string', 'Runtime programs retain their complete module.exports string');
    assert.doesNotThrow(() => new Script(program.script));
    assert.match(program.script, /module\.exports\s*=/);
    const module = { exports: undefined };
    let registrations = 0;
    runInNewContext(program.script, { module });
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

test('README installation selects the published package rather than an obsolete release', () => {
  const version = JSON.parse(read('package.json')).version;
  const commands = [...read('README.md').matchAll(/^npm install(?: --save-exact)? @tier0\/sdk-v2(?:@([^\s]+))?\s*$/gm)];
  assert.ok(commands.length > 0);
  for (const command of commands) assert.ok(command[1] === undefined || command[1] === version, 'Installation example pins a different SDK release');
});
