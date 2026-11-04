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

test('guidance never tells an App that members.listApp is unavailable through the node proxy', () => {
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!/listApp|access-members\/list/.test(line)) continue;
      assert.doesNotMatch(line, /当前不可用|不转发 `\/openapi\/v2\/apps\/access-members\/list`/, `${file}: ${line}`);
    }
  }
});

test('the proxy path list names apps/access-members/list as forwarded, not refused', () => {
  for (const file of ['README.md', 'skills/tier0-sdk-v2/SKILL.md']) {
    const line = readFileSync(file, 'utf8').split('\n').find(text => text.startsWith('代理只转发'));
    assert.ok(line, file);
    const [forwarded, refused] = line.split('白名单外的接口');
    assert.match(forwarded, /apps\/access-members\/list/, file);
    assert.doesNotMatch(refused, /members\.listApp/, file);
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
