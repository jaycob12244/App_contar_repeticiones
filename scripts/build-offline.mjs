import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = pathToFileURL(resolve(process.argv[2] || 'dist') + sep);
const paths = (await readdir(directory, { recursive: true }))
  .map(path => path.replaceAll('\\', '/'))
  .filter(path => /\.(html|js|css|webmanifest|png)$/.test(path) && !['sw.js', 'actualizar.html'].includes(path))
  .sort();
if (!paths.includes('index.html')) throw new Error('No se encontró la salida de Vite.');

const hash = createHash('sha256');
for (const path of paths) hash.update(path).update(await readFile(new URL(path, directory)));
const cache = `entreno-shell-${hash.digest('hex').slice(0, 16)}`;
await writeFile(new URL('sw.js', directory), `
const CACHE = ${JSON.stringify(cache)};
const FILES = ${JSON.stringify(paths.map(path => '/' + path))};
const APP_PAGES = ['/', '/index.html', '/historial'];

async function openApp(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  let response;
  try {
    response = await fetch(request, { cache: 'no-cache', signal: controller.signal });
    if (response.ok) return response;
  } catch {
    // The installed shell is still available offline.
  } finally {
    clearTimeout(timeout);
  }
  return await caches.match('/index.html', { cacheName: CACHE }) || response || Response.error();
}

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
  if (event.request.mode === 'navigate' && APP_PAGES.includes(url.pathname)) {
    event.respondWith(openApp(event.request));
    return;
  }
  if (!FILES.includes(url.pathname)) return;
  event.respondWith(caches.match(url.pathname, { cacheName: CACHE }).then(response => response || fetch(event.request)));
});
`.trimStart());
