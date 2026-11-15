import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium, expect } from '@playwright/test';

const exercise = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Jalón al pecho', muscle: 'Espalda' };
const share = '33333333-3333-4333-8333-333333333333';
const profiles = {
  'ana@example.com': { id: '11111111-1111-4111-8111-111111111111', user_metadata: { display_name: 'Ana' } },
  'lucas@example.com': { id: '22222222-2222-4222-8222-222222222222', user_metadata: { display_name: 'Lucas' } },
};
const routines = new Map();
const workouts = new Map();
let shared;
let authUnavailable = false;
let refreshes = 0;
let updatedShell = false;

function json(response, value, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
}

const root = resolve('.browser-dist');
const { rewrites = [] } = JSON.parse(await readFile('vercel.json', 'utf8'));
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const { pathname } = url;
  try {
    if (pathname === '/legacy-install') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<script>navigator.serviceWorker.register("/sw.js")</script>');
      return;
    }
    if (pathname === '/sw.js' && request.headers.cookie?.includes('legacy_worker=1')) {
      response.writeHead(200, { 'content-type': 'application/javascript' });
      response.end(`
        self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
        self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
        self.addEventListener('fetch', event => {
          if (event.request.mode !== 'navigate' || new URL(event.request.url).pathname !== '/') return;
          event.respondWith(new Response('<title>Entreno anterior</title>', { headers: { 'content-type': 'text/html' } }));
        });
      `);
      return;
    }
    if (pathname === '/auth/v1/token') {
      const { email, refresh_token } = await readBody(request);
      const refreshing = url.searchParams.get('grant_type') === 'refresh_token';
      if (refreshing && authUnavailable) return json(response, { message: 'Temporary Auth outage' }, 503);
      const user = refreshing ? Object.values(profiles).find(profile => profile.id === refresh_token) : profiles[email];
      if (!user) return json(response, { message: 'invalid_credentials' }, 400);
      if (refreshing) refreshes += 1;
      const claims = { sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 };
      const access_token = ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'fake'].join('.');
      return json(response, { access_token, refresh_token: user.id, expires_in: 3600, token_type: 'bearer', user });
    }
    if (pathname === '/auth/v1/logout') return json(response, {});
    if (pathname === '/rest/v1/rpc/app_allowed') return json(response, true);
    if (pathname === '/rest/v1/exercises') return json(response, [exercise]);
    if (pathname === '/rest/v1/rpc/share_routine') {
      const { p_routine_id } = await readBody(request);
      shared = routines.get(p_routine_id);
      return shared ? json(response, share) : json(response, { code: 'P0002' }, 404);
    }
    const claims = request.headers.authorization?.split('.')[1];
    const owner = claims && JSON.parse(Buffer.from(claims, 'base64url').toString()).sub;
    if (pathname === '/rest/v1/rpc/import_routine') {
      const { p_token } = await readBody(request);
      if (!owner || !shared || p_token !== share) return json(response, { code: 'P0002' }, 404);
      const existing = [...routines.values()].find(row => row.owner_id === owner && row.imported_from === share);
      if (existing) return json(response, existing);
      const imported = { ...shared, id: crypto.randomUUID(), owner_id: owner, imported_from: share };
      routines.set(imported.id, imported);
      return json(response, imported);
    }
    const table = pathname === '/rest/v1/workouts' ? workouts : pathname === '/rest/v1/routines' ? routines : null;
    if (table && request.method === 'POST') {
      const record = await readBody(request);
      if (table.has(record.id)) return json(response, { code: '23505' }, 409);
      table.set(record.id, record);
      return json(response, null, 201);
    }
    if (table && request.method === 'DELETE') {
      const id = url.searchParams.get('id')?.replace(/^eq\./, '');
      if (table.get(id)?.owner_id === owner) table.delete(id);
      response.writeHead(204).end();
      return;
    }
    if (table) return json(response, [...table.values()].filter(row => row.owner_id === owner));
    const destination = rewrites.find(rewrite => rewrite.source === pathname)?.destination || pathname;
    const path = resolve(root, '.', destination === '/' ? 'index.html' : '.' + destination);
    if (!path.startsWith(root + sep)) return json(response, null, 404);
    const contents = await readFile(path);
    const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
    response.writeHead(200, { 'content-type': type[path.slice(path.lastIndexOf('.'))] || 'text/plain' });
    response.end(updatedShell && pathname === '/'
      ? contents.toString().replace('<title>Entreno</title>', '<title>Entreno actualizado</title>')
      : contents);
  } catch (error) {
    json(response, { error: error.message }, 500);
  }
});

await new Promise((done, fail) => server.once('error', fail).listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;

async function signIn(page, email, url = base) {
  await page.goto(url);
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill('example-test-password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
  await expect(page.getByText('Sincronizado', { exact: true })).toBeVisible();
}

async function addSeries(page, reps, intensifiers = false) {
  await page.getByRole('button', { name: 'Agregar serie' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Repeticiones', { exact: true }).fill(String(reps));
  await dialog.getByLabel('RIR').fill('0');
  await dialog.getByRole('combobox').first().selectOption('plates');
  await dialog.getByLabel('Carga', { exact: true }).fill('10');
  if (intensifiers) {
    for (const extra of [3, 2]) {
      await dialog.getByRole('button', { name: 'Rest-pause' }).click();
      await dialog.getByLabel('Repeticiones', { exact: true }).last().fill(String(extra));
    }
    await dialog.getByRole('button', { name: 'Drop set' }).click();
    await dialog.getByLabel('Repeticiones', { exact: true }).last().fill('5');
    await dialog.getByLabel('Carga', { exact: true }).last().fill('7');
  }
  await dialog.getByRole('button', { name: 'Guardar serie' }).click();
}

try {
  const vite = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', root], {
    env: { ...process.env, VITE_SUPABASE_URL: base, VITE_SUPABASE_PUBLISHABLE_KEY: 'browser-test-key' },
    stdio: 'inherit',
  });
  const offline = vite.status === 0 && spawnSync(process.execPath, ['scripts/build-offline.mjs', root], { stdio: 'inherit' });
  if (!offline || offline.status !== 0) throw new Error('Failed to build browser fixture');
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  let page = await context.newPage();
  await signIn(page, 'ana@example.com');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect.poll(async () => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  updatedShell = true;
  await page.reload();
  await expect(page).toHaveTitle('Entreno actualizado');
  updatedShell = false;
  await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Nuevo entrenamiento' }).click();
  await page.getByRole('button', { name: 'Espalda', exact: true }).click();
  await page.getByRole('button', { name: 'Elegir ejercicios' }).click();
  await page.getByRole('button', { name: /Jalón al pecho/ }).click();
  await addSeries(page, 10, true);
  await addSeries(page, 9);
  await addSeries(page, 8);
  await page.getByRole('button', { name: 'Finalizar entrenamiento' }).click();
  await expect(page.getByRole('heading', { name: 'Historial' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Eliminar entrenamiento de Espalda/ })).toBeVisible();
  await page.getByRole('button', { name: /Espalda.*3 series/ }).first().click();
  await expect(page.getByText('Rest-pause · 2 rep')).toBeVisible();
  await expect.poll(() => workouts.size).toBe(1);

  const legacy = await browser.newContext({ storageState: await context.storageState() });
  await legacy.addCookies([{ name: 'legacy_worker', value: '1', url: base }]);
  const legacyPage = await legacy.newPage();
  await legacyPage.goto(base + '/legacy-install');
  await expect.poll(() => legacyPage.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await legacyPage.goto(base);
  await expect(legacyPage).toHaveTitle('Entreno anterior');
  await legacy.clearCookies({ name: 'legacy_worker' });
  await legacyPage.addInitScript(() => {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      document.documentElement.dataset.workerUpdated = 'true';
    });
  });
  await legacyPage.goto(base + '/actualizar');
  await expect(legacyPage.getByRole('heading', { name: 'Actualizar Entreno' })).toBeVisible();
  await legacyPage.getByRole('button', { name: 'Actualizar y abrir Historial' }).click();
  await expect(legacyPage).toHaveURL(base + '/historial');
  await expect(legacyPage.getByRole('heading', { name: 'Historial' })).toBeVisible();
  await expect(legacyPage.getByRole('button', { name: /^Eliminar entrenamiento de Espalda/ })).toBeVisible();
  await expect(legacyPage.locator('html')).toHaveAttribute('data-worker-updated', 'true', { timeout: 10000 });
  await legacyPage.goto(base);
  await expect(legacyPage).toHaveTitle('Entreno');
  await legacy.close();

  await page.close();
  await context.setOffline(true);
  page = await context.newPage();
  await page.goto(base);
  await expect(page.getByText('Sin conexión')).toBeVisible();
  await page.getByRole('button', { name: 'Repetir último entrenamiento' }).click();
  await addSeries(page, 11);
  await addSeries(page, 10);
  await addSeries(page, 9);
  await page.getByRole('button', { name: 'Finalizar entrenamiento' }).click();
  await expect(page.getByText('1 por sincronizar · guardado en este teléfono')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Sin conexión')).toBeVisible();
  await page.getByRole('button', { name: 'Progreso', exact: true }).click();
  await expect(page.getByText('+3', { exact: true })).toBeVisible();
  expect(workouts.size).toBe(1);
  await context.setOffline(false);
  await expect.poll(() => workouts.size).toBe(2);
  await expect(page.getByText('Sincronizado', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Entrenar', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo entrenamiento' }).click();
  await page.getByRole('button', { name: 'Espalda', exact: true }).click();
  await page.getByRole('button', { name: 'Elegir ejercicios' }).click();
  await page.getByRole('button', { name: /Jalón al pecho/ }).click();
  await addSeries(page, 12);
  await page.getByRole('button', { name: 'Finalizar entrenamiento' }).click();
  await expect.poll(() => workouts.size).toBe(3);
  expect(routines.size).toBe(0);
  await page.getByRole('article').filter({ hasText: '1 series' }).getByRole('button', { name: /^Eliminar entrenamiento de Espalda/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar entrenamiento' }).click();
  await expect.poll(() => workouts.size).toBe(2);
  await expect(page.getByRole('article').filter({ hasText: '1 series' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Historial', exact: true }).click();
  await page.getByRole('button', { name: /Espalda.*3 series/ }).first().click();
  await page.getByRole('button', { name: 'Guardar como rutina' }).click();
  await page.getByLabel('Nombre de la rutina').fill('Espalda de Ana');
  await page.getByRole('button', { name: 'Guardar rutina', exact: true }).click();
  await page.getByRole('button', { name: 'Compartir', exact: true }).click();
  const url = await page.getByLabel('Enlace de la rutina').inputValue();
  const receiver = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(receiver, 'lucas@example.com', url);
  await receiver.getByRole('button', { name: 'Guardar en mis rutinas' }).click();
  await expect(receiver.getByRole('heading', { name: 'Espalda de Ana' })).toBeVisible();
  await receiver.getByRole('button', { name: 'Historial', exact: true }).click();
  await expect(receiver.getByText('Aquí aparecerán tus entrenamientos finalizados.')).toBeVisible();
  await receiver.close();

  await context.setOffline(true);
  await page.goto(base + '/historial');
  await expect(page.getByRole('heading', { name: 'Historial' })).toBeVisible();
  await page.getByRole('button', { name: /Espalda.*3 series/ }).first().click();
  await page.getByRole('button', { name: 'Eliminar entrenamiento' }).click();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('heading', { name: 'Jalón al pecho' })).toBeVisible();
  await page.getByRole('button', { name: 'Volver al historial' }).click();
  await page.getByRole('button', { name: /^Eliminar entrenamiento de Espalda/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar entrenamiento' }).click();
  await page.getByRole('button', { name: 'Rutinas', exact: true }).click();
  await page.getByRole('button', { name: 'Eliminar Espalda de Ana' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar rutina' }).click();
  await page.reload();
  await expect(page.getByText('2 por sincronizar · guardado en este teléfono')).toBeVisible();
  await page.getByRole('button', { name: 'Progreso', exact: true }).click();
  await expect(page.getByText('Todavía no hay un entrenamiento anterior.')).toBeVisible();
  await page.getByRole('button', { name: 'Rutinas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Espalda de Ana' })).toHaveCount(0);
  expect(workouts.size).toBe(2);
  expect(routines.size).toBe(2);
  await context.setOffline(false);
  await expect.poll(() => workouts.size).toBe(1);
  await expect.poll(() => routines.size).toBe(1);
  expect([...routines.values()][0].owner_id).toBe(profiles['lucas@example.com'].id);
  await expect(page.getByText('Sincronizado', { exact: true })).toBeVisible();

  const saved = await context.storageState();
  const session = saved.origins.flatMap(origin => origin.localStorage).find(entry => /^sb-.*-auth-token$/.test(entry.name));
  const expired = { ...JSON.parse(session.value), expires_at: Math.floor(Date.now() / 1000) - 60 };
  session.value = JSON.stringify(expired);
  const restarted = await browser.newContext({ storageState: saved });
  const restored = await restarted.newPage();
  authUnavailable = true;
  const refreshFailed = restored.waitForEvent('console', {
    predicate: message => message.type() === 'warning' && message.text().includes('AuthRetryableFetchError'),
    timeout: 45000,
  });
  await restored.goto(base);
  await refreshFailed;
  // Wait for React to apply the initial auth result before verifying the cached view.
  await expect(restored.getByText('Sesión guardada · esperando conexión')).toBeVisible();
  await expect(restored.getByRole('navigation')).toBeVisible();
  await restored.close();
  authUnavailable = false;
  const reopened = await restarted.newPage();
  await reopened.goto(base);
  await expect(reopened.getByText('Sincronizado', { exact: true })).toBeVisible();
  expect(refreshes).toBeGreaterThan(0);
  await reopened.getByRole('button', { name: 'Ana', exact: true }).click();
  await reopened.getByRole('button', { name: 'Cerrar sesión' }).click();
  await reopened.reload();
  await expect(reopened.getByRole('heading', { name: 'Inicia sesión' })).toBeVisible();
  console.log('OK: registro, modo sin conexión, rutinas compartidas, eliminación y recuperación de sesión.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  server.close();
}
