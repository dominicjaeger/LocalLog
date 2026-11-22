// LocalLog release check. Run with: node tools/check.mjs
// No dependencies. Exits with 1 when something is wrong:
//   - APP_VERSION (js/version.js) differs from VERSION (sw.js)
//   - a file in js/ or css/ is missing from ASSETS_TO_CACHE in sw.js
//   - an entry in ASSETS_TO_CACHE does not exist

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

const read = (file) => readFileSync(join(root, file), 'utf8');

// ---- version ----
const appVersion = /APP_VERSION\s*=\s*'([^']+)'/.exec(read('js/version.js'))?.[1];
const swSource = read('sw.js');
const swVersion = /const VERSION\s*=\s*'([^']+)'/.exec(swSource)?.[1];
if (!appVersion) problems.push('APP_VERSION was not found in js/version.js.');
if (!swVersion) problems.push('VERSION was not found in sw.js.');
if (appVersion && swVersion && appVersion !== swVersion) {
  problems.push(`Version mismatch: APP_VERSION is ${appVersion} but sw.js VERSION is ${swVersion}.`);
}

// ---- cached files ----
const listMatch = /ASSETS_TO_CACHE\s*=\s*\[([\s\S]*?)\]/.exec(swSource);
const cached = listMatch ? [...listMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
if (!listMatch) problems.push('ASSETS_TO_CACHE was not found in sw.js.');

const cachedPaths = new Set(cached.map((entry) => (entry === './' ? './index.html' : entry)));

function walk(dir) {
  const files = [];
  for (const name of readdirSync(join(root, dir))) {
    const full = join(dir, name);
    if (statSync(join(root, full)).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

for (const dir of ['js', 'css']) {
  for (const file of walk(dir)) {
    const asset = './' + relative('.', file).split('\\').join('/');
    if (!cachedPaths.has(asset)) problems.push(`Not in ASSETS_TO_CACHE: ${asset}`);
  }
}
for (const entry of cached) {
  const file = entry === './' ? 'index.html' : entry.replace(/^\.\//, '');
  if (!existsSync(join(root, file))) problems.push(`In ASSETS_TO_CACHE but missing on disk: ${entry}`);
}

if (problems.length) {
  console.error('Check failed:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`OK: version ${appVersion}, ${cached.length} cached files.`);
