import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const base = 'http://tagger.test';
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
test('phone setup refreshes stale addresses, chooses a network, and hides unverifiable QR codes', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  let address = '192.168.1.10';
  let fail = false;
  await page.route(`${base}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/tagger-setup') return route.fulfill({ contentType: 'text/html', body: await readFile(new URL('../../setup/tagger.html', import.meta.url), 'utf8') });
    if (url.pathname === '/tagger-setup.js') return route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL('../../setup/tagger.js', import.meta.url), 'utf8') });
    if (['/shared/i18n.js', '/shared/browser-language.js', '/shared/page-language.js', '/shared/locales/en.js', '/shared/locales/es.js'].includes(url.pathname)) return route.fulfill({ contentType: 'text/javascript', body: await readFile('.' + url.pathname) });
    if (url.pathname === '/tagger-info') {
      if (fail) return route.abort();
      const addresses = address ? [address, '192.168.2.20'].map((ip, i) => ({ address: ip, interface: `en${i}`, url: `http://${ip}:3001/tagger/`, mobileMonitorUrl: `http://${ip}:3001/mobilemonitor/` })) : [];
      const chosen = addresses.find(item => item.address === url.searchParams.get('address')) || addresses[0];
      return route.fulfill({ json: { url: chosen?.url || null, friendlyUrl: null, addresses, qrDataUrl: chosen ? pixel : null, mobileMonitorUrl: chosen?.mobileMonitorUrl || null, mobileMonitorQrDataUrl: chosen ? pixel : null } });
    }
    return route.abort();
  });
  await page.goto(`${base}/tagger-setup`);
  await expect(page.locator('#tagger-url')).toHaveAttribute('href', 'http://192.168.1.10:3001/tagger/');
  await expect(page.locator('#monitor-url')).toHaveAttribute('href', 'http://192.168.1.10:3001/mobilemonitor/');
  address = '192.168.1.11';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#tagger-url')).toHaveAttribute('href', 'http://192.168.1.11:3001/tagger/');
  await page.getByLabel('Red del teléfono').selectOption('192.168.2.20');
  await expect(page.locator('#tagger-url')).toHaveAttribute('href', 'http://192.168.2.20:3001/tagger/');
  await expect(page.locator('#monitor-url')).toHaveAttribute('href', 'http://192.168.2.20:3001/mobilemonitor/');
  fail = true;
  await page.getByRole('button', { name: 'Actualizar conexión' }).click();
  await expect(page.locator('#tagger-qr')).toBeHidden();
  await expect(page.locator('#monitor-qr')).toBeHidden();
  await expect(page.locator('#monitor-url')).not.toHaveAttribute('href');
  await expect(page.locator('#tagger-url')).not.toHaveAttribute('href');
  fail = false; address = null;
  await page.getByRole('button', { name: 'Actualizar conexión' }).click();
  await expect(page.getByRole('status')).toContainText('No hay una dirección de red local');
  address = '192.168.3.30';
  await page.getByRole('button', { name: 'Actualizar conexión' }).click();
  await expect(page.locator('#tagger-qr')).toBeVisible();
  await expect(page.locator('#monitor-qr')).toBeVisible();
  await expect(page.locator('#monitor-url')).toHaveAttribute('href', 'http://192.168.3.30:3001/mobilemonitor/');
  await expect(page.locator('#tagger-url')).toHaveAttribute('href', 'http://192.168.3.30:3001/tagger/');
});
