import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', '.git', 'test-results', 'playwright-report'].includes(entry.name)) continue;
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (/\.(mjs|js)$/.test(entry.name)) result.push(path);
  }
  return result;
}
const files = await walk(root);
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', fileURLToPath(file)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate HTML IDs');
for (const file of files.filter(file => file.pathname.includes('/public/js/'))) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(/\$\('([^']+)'\)/g)) if (!ids.includes(match[1])) throw new Error(file.pathname + ': missing HTML ID ' + match[1]);
}
const sw = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
for (const match of sw.matchAll(/'(\.\/[^']*)'/g)) {
  if (match[1] === './') continue;
  await readFile(resolve(fileURLToPath(root), 'public', match[1]));
}
console.log('Checked syntax in ' + files.length + ' JavaScript files, DOM references, and offline assets.');
