import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = pathToFileURL(resolve(process.argv[2] || 'dist') + sep);
const paths = (await readdir(directory, { recursive: true }))
  .map(path => path.replaceAll('\\', '/'))
  .filter(path => /\.(html|js|css|webmanifest|png)$/.test(path) && path !== 'sw.js')
  .sort();
if (!paths.includes('index.html')) throw new Error('No se encontró la salida de Vite.');

const hash = createHash('sha256');
for (const path of paths) hash.update(path).update(await readFile(new URL(path, directory)));
const cache = `entreno-shell-${hash.digest('hex').slice(0, 16)}`;
await writeFile(new URL('sw.js', directory), `
const CACHE = ${JSON.stringify(cache)};
const FILES = ${JSON.stringify(paths.map(path => '/' + path))};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('entreno-shell-') && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const path = event.request.mode === 'navigate' && url.pathname === '/' ? '/index.html' : url.pathname;
  if (!FILES.includes(path)) return;
  event.respondWith(caches.open(CACHE).then(cache => cache.match(path)).then(response => response || fetch(event.request)));
});
`.trimStart());
