// frontend/ klasörünü yerel geliştirme için sunar (bağımlılıksız). Kullanım: npm run serve
// TEST arayüzü (npm run serve:test, :5174): önce frontend-test/, bulunamayan dosya frontend/'ten
// (ui.js, api.js… ortak; config.js, app.js, index.html teste özel). Canlı arayüz değişmez.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './lib/env.mjs';

const TEST = process.argv.includes('--test');
const PUBLIC_DIRS = (TEST ? ['frontend-test', 'frontend'] : ['frontend']).map((dir) => path.join(ROOT_DIR, dir));
const PORT = Number(process.env.PORT ?? (TEST ? 5174 : 5173));
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
  const candidates = PUBLIC_DIRS.map((dir) => ({ dir, file: path.normalize(path.join(dir, requested)) }));

  // Dizin dışına çıkmayı (../) engelle.
  if (candidates.some(({ dir, file }) => !file.startsWith(dir + path.sep))) {
    res.writeHead(403).end();
    return;
  }

  const filePath = candidates.map(({ file }) => file).find((file) => {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  });
  if (!filePath) {
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
  console.log(`${TEST ? 'TEST arayüzü' : 'Frontend'}: http://localhost:${PORT}`);
});
