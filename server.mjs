import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const publicRoot = fileURLToPath(new URL('./public/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
export function resolvePublicPath(rawPath, root = publicRoot) {
  let pathname;
  try { pathname = decodeURIComponent(rawPath.split('?')[0]); } catch { return null; }
  if (pathname.includes('\0') || pathname.includes('\\')) return null;
  const path = resolve(root, '.' + (pathname.startsWith('/') ? pathname : '/' + pathname));
  if (path !== resolve(root) && !path.startsWith(resolve(root) + sep)) return null;
  return path;
}
export function createServer() {
  return http.createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
    let path = resolvePublicPath(request.url);
    if (!path) { response.writeHead(400); response.end('Invalid path'); return; }
    try {
      let info = await stat(path);
      if (info.isDirectory()) { path = resolve(path, 'index.html'); info = await stat(path); }
      if (!info.isFile()) throw new Error('Not a file');
      response.writeHead(200, {
        'Content-Type': types[extname(path)] || 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(path).on('error', () => response.destroy()).pipe(response);
    } catch { response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Not found'); }
  });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const server = createServer();
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Port ' + port + ' is in use. Stop the other server or set PORT to another number.' : error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    console.log('\nTraceback is ready: http://localhost:' + port + '\nPress Ctrl+C to stop.\n');
  });
}
