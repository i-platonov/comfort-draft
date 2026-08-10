/**
 * Stage the landing page into dist/, ready for Vite to build the app into dist/app.
 *
 * Runs *before* `vite build` in the `build` script: it wipes dist/ wholesale, which is the
 * only way to be sure a page or image deleted from site/ doesn't linger in a deploy. Vite
 * then creates dist/app underneath. Doing it the other way round would delete the app.
 */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'site');
const target = join(root, 'dist');

async function totalBytes(dir) {
  let bytes = 0;

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    bytes += entry.isDirectory() ? await totalBytes(path) : (await stat(path)).size;
  }

  return bytes;
}

const placeholder = 'YOUR-DOMAIN.example';
const files = await readdir(source, { recursive: true, withFileTypes: true });
const unresolved = [];

for (const entry of files) {
  if (entry.isDirectory()) continue;
  const path = join(entry.parentPath ?? entry.path, entry.name);
  if (!/\.(html|xml|txt|json|md)$/.test(entry.name)) continue;
  const text = await (await import('node:fs/promises')).readFile(path, 'utf8');
  if (text.includes(placeholder)) unresolved.push(relative(root, path));
}

if (unresolved.length > 0) {
  console.error(
    `\n  The landing page still has the ${placeholder} placeholder in:\n` +
      unresolved.map(f => `    ${f}`).join('\n') +
      `\n\n  Replace it with the real domain before building — a deployed page with a\n` +
      `  placeholder canonical URL will be indexed against a domain that doesn't exist.\n`,
  );
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
// The README documents hosting; it is not part of the deployed site.
await cp(source, target, {
  recursive: true,
  filter: path => !path.endsWith('README.md'),
});

const copied = (await readdir(target)).sort();
console.log(`  site  → dist/            ${copied.join(', ')}`);
console.log(`          ${(await totalBytes(target) / 1024).toFixed(0)} kB`);
