// frontend/ klasörünü yerel geliştirme için sunar (bağımlılıksız). Kullanım: npm run serve
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './lib/env.mjs';

const PUBLIC_DIR = path.join(ROOT_DIR, 'frontend');
const PORT = Number(process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? '127.0.0.1';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  let requested;
  try {
    requested = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));

  // Dizin dışına çıkmayı (../) engelle.
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }

  try {
    if (!statSync(filePath).isFile()) throw new Error('not a file');
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Bulunamadı');
    return;
  }

  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(filePath).pipe(res);
}).listen(PORT, HOST, () => {
  console.log(`Frontend: http://localhost:${PORT}`);
});
