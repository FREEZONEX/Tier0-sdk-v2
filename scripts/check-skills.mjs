import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url)));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const rootSkill = 'tier0-sdk-v2';
const registered = new Set();
const allowed = new Set(['name', 'description', 'metadata', 'license', 'allowed-tools', 'compatibility']);
function checkLinks(file) {
  const body = readFileSync(file, 'utf8');
  for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:\/\//i.test(target)) continue;
    if (!existsSync(resolve(dirname(file), target))) throw new Error(`Broken Skill link in ${file}: ${target}`);
  }
}
// A nested Skill directory is checked as its own Skill.
function checkResources(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = resolve(dir, entry.name);
    if (entry.isDirectory()) { if (!existsSync(resolve(file, 'SKILL.md'))) checkResources(file); }
    else if (entry.name.endsWith('.md')) checkLinks(file);
  }
}
for (const skill of pkg.agents.skills) {
  const file = resolve(root, skill.path, 'SKILL.md');
  const expected = skill.name === rootSkill ? `./skills/${rootSkill}` : `./skills/${rootSkill}/${skill.name}`;
  if (registered.has(skill.name) || skill.path !== expected) throw new Error(`Skill must be independently registered: ${skill.name}`);
  registered.add(skill.name);
  const body = readFileSync(file, 'utf8');
  const frontmatter = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) throw new Error(`Missing frontmatter: ${file}`);
  const data = parse(frontmatter[1]);
  if (data.name !== skill.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.name) || data.name.length > 64 || typeof data.description !== 'string' || !data.description.trim() || Object.keys(data).some(key => !allowed.has(key))) throw new Error(`Invalid Skill metadata: ${file}`);
  checkResources(dirname(file));
}
for (const dir of readdirSync(resolve(root, 'skills'), { withFileTypes: true }).filter(e => e.isDirectory())) {
  if (dir.name !== rootSkill) throw new Error(`Skills must be nested under ${rootSkill}: ${dir.name}`);
}
for (const dir of readdirSync(resolve(root, 'skills', rootSkill), { withFileTypes: true }).filter(e => e.isDirectory())) {
  if (existsSync(resolve(root, 'skills', rootSkill, dir.name, 'SKILL.md')) && !registered.has(dir.name)) throw new Error(`Unregistered Skill: ${dir.name}`);
}
console.log(`Validated ${registered.size} independent Skills and their local links.`);
