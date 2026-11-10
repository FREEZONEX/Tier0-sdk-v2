import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function markdown(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? markdown(path) : path.endsWith('.md') ? [path] : [];
  });
}

const files = ['README.md', ...markdown('skills')];

test('guidance never tells an App that members.listApp is unavailable', () => {
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!/listApp|access-members\/list/.test(line)) continue;
      assert.doesNotMatch(line, /当前不可用|不转发 `\/openapi\/v2\/apps\/access-members\/list`/, `${file}: ${line}`);
    }
  }
});

test('every allowlist sentence that names platform/getMembers also names apps/access-members/list', () => {
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!/只转发/.test(line) || !line.includes('platform/getMembers')) continue;
      assert.match(line, /apps\/access-members\/list/, `${file}: ${line}`);
    }
  }
});
