/**
 * Serve dist/ exactly as a static host would, so the built tree can be checked in a browser
 * before it goes anywhere: the landing page at /, the app at /app.
 *
 * `vite preview` only serves the app's own outDir, so it can't show the two together.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT ?? 4180);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

async function resolveFile(urlPath) {
  // normalize() collapses any ../ before it can climb out of dist.
  const candidate = join(dist, normalize(urlPath));
  if (!candidate.startsWith(dist)) return null;

  try {
    const info = await stat(candidate);
    if (info.isDirectory()) return resolveFile(join(urlPath, 'index.html'));
    return candidate;
  } catch {
    return null;
  }
}

createServer(async (request, response) => {
  const urlPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = await resolveFile(urlPath);

  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`404 — nothing at ${urlPath}\n`);
    console.log(`  404  ${urlPath}`);
    return;
  }

  response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
}).listen(port, () => {
  console.log(`\n  dist/ is being served as a host would:\n`);
  console.log(`    landing page   http://localhost:${port}/`);
  console.log(`    app            http://localhost:${port}/app\n`);
});
