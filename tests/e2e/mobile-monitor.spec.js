import { test, expect } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { startNodeService, stopService, waitForHealth, waitFor } from './helpers.mjs';

const base = 'http://127.0.0.1:3197';
const lan = 'http://192.168.88.22:3197';
let server, directory;
function start() {
  return startNodeService('offline monitor barn', path.resolve('countserver.js'), { cwd: directory, env: {
    PORT: '3197', CLOUD_SYNC_URL: 'https://unreachable.example.test', CLOUD_SYNC_TOKEN: 'offline-test-only', CLOUD_SYNC_INTERVAL_MS: '100',
    AWS_ACCESS_KEY_ID: 'offline-test-only', AWS_SECRET_ACCESS_KEY: 'offline-test-only', NODE_ENV: 'test',
    NODE_OPTIONS: `--import=${new URL('../fixtures/no-internet.mjs', import.meta.url).href}`,
  } });
}
function decode(buffer) {
  const { data, width, height } = PNG.sync.read(buffer);
  const result = jsQR(new Uint8ClampedArray(data), width, height);
  expect(result, 'QR must decode as a real scannable PNG').not.toBeNull();
  return result.data;
}
const decodeDataUrl = value => decode(Buffer.from(value.split(',')[1], 'base64'));
test.beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'esquila-mobile-monitor-'));
  await writeFile(path.join(directory, 'shearers.json'), JSON.stringify([
    { name: 'Ana María de los Ángeles — estación norte' }, { name: 'Luis' }, { name: 'Carmen' }, { name: 'José' },
  ]));
  server = start(); await waitForHealth(base, server);
});
test.afterAll(async () => { await stopService(server); if (directory) await rm(directory, { recursive: true, force: true }); });
test.describe.configure({ mode: 'serial' });

test('cold startup generates both real QR images without internet, even when cloud and email fail', async ({ page, request }) => {
  const external = [];
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === base) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  const response = await request.get(`${base}/tagger-info`, { timeout: 5000 });
  expect(response.headers()['cache-control']).toContain('no-store');
  const info = await response.json();
  expect(decodeDataUrl(info.qrDataUrl)).toBe(`${lan}/tagger/`);
  expect(decodeDataUrl(info.mobileMonitorQrDataUrl)).toBe(`${lan}/mobilemonitor/`);
  const alternate = await (await request.get(`${base}/tagger-info?address=192.168.99.22`)).json();
  expect(decodeDataUrl(alternate.qrDataUrl)).toBe('http://192.168.99.22:3197/tagger/');
  expect(decodeDataUrl(alternate.mobileMonitorQrDataUrl)).toBe('http://192.168.99.22:3197/mobilemonitor/');
  expect(decode(await (await request.get(`${base}/qr.png`)).body())).toBe(`${lan}/tagger/`);
  expect(decode(await (await request.get(`${base}/mobile-monitor-qr.png`)).body())).toBe(`${lan}/mobilemonitor/`);
  await page.goto(`${base}/tagger-setup`);
  await expect(page.locator('#tagger-qr')).toBeVisible(); await expect(page.locator('#monitor-qr')).toBeVisible();
  expect(await page.locator('#monitor-qr').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.locator('#monitor-url')).toHaveAttribute('href', `${lan}/mobilemonitor/`);
  for (const width of [320, 980]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath('phone-qr-codes.png'), fullPage: true });
  await waitFor(() => server.logs.some(line => line.includes('No se pudo enviar el correo')));
  await waitFor(() => server.logs.some(line => line.includes('Cloud sync failed')));
  await page.getByRole('button', { name: 'Actualizar conexión' }).click();
  await expect(page.locator('#monitor-qr')).toBeVisible();
  expect(external).toEqual([]);
});

test('scanned mobile monitor fits phones, keeps its own shortcut and recovers after a local restart', async ({ page, request }) => {
  const external = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Emulate the test LAN over loopback. Every other browser destination is denied.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === lan) return route.fulfill({ response: await route.fetch({ url: `${base}${url.pathname}${url.search}` }) });
    external.push(url.origin); return route.abort();
  });
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  const info = await (await request.get(`${base}/tagger-info`)).json();
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(decodeDataUrl(info.mobileMonitorQrDataUrl));
  await expect(page).toHaveTitle('Esquila — Monitor móvil');
  await expect(page.getByRole('heading', { name: 'Ana María de los Ángeles — estación norte', exact: true })).toBeVisible();
  await expect(page.getByText('Sin registros', { exact: true })).toHaveCount(4);
  const added = await request.post(`${base}/bulk`, { data: { station: 1, quantity: 3, submissionId: crypto.randomUUID() } });
  expect(added.ok()).toBe(true);
  await expect(page.locator('.Mobile-monitor-total strong')).toHaveText('3');
  const station = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Ana María de los Ángeles — estación norte' }) });
  await expect(station.locator('.Mobile-monitor-count strong')).toHaveText('3');
  await expect(station.locator('.Mobile-monitor-tag strong')).toHaveText('L0003');
  for (const [stationNumber, color, background, foreground] of [[2, 'green', 'rgb(37, 211, 66)', 'rgb(40, 44, 52)'], [3, 'black', 'rgb(22, 22, 22)', 'rgb(255, 255, 255)']]) {
    const response = await request.post(`${base}/count`, { data: {
      station: stationNumber, type: 'oveja', color, tag: `X1234${stationNumber}`,
      woolQuality: 'EXCELLENT', lactation: 'idk', submissionId: crypto.randomUUID(),
    } });
    expect(response.ok()).toBe(true);
    const tag = page.locator('.Mobile-monitor-tag').filter({ hasText: `X1234${stationNumber}` });
    await expect(tag).toHaveCSS('background-color', background);
    await expect(tag).toHaveCSS('color', foreground);
  }
  await expect(page.locator('.Mobile-monitor-total strong')).toHaveText('5');
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
  expect(manifest.start_url).toBe('/mobilemonitor/'); expect(manifest.scope).toBe('/mobilemonitor/');
  for (const width of [320, 390, 640, 800]) {
    await page.setViewportSize({ width, height: 780 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath('mobile-monitor.png'), fullPage: true });
  // Recreate a dropped local WiFi link without treating absent internet as LAN loss.
  await page.route('**/api/live*', route => route.abort());
  await expect(page.getByRole('alert')).toContainText('Sin conexión con el galpón');
  await expect(station.locator('.Mobile-monitor-tag strong')).toHaveText('L0003');
  await stopService(server); server = start(); await waitForHealth(base, server);
  await page.unroute('**/api/live*'); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.Mobile-monitor-total strong')).toHaveText('5');
  expect(external).toEqual([]); expect(errors).toEqual([]);
});
