import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const base = 'http://tagger.test';
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
test('phone setup refreshes stale addresses, chooses a network, and hides unverifiable QR codes', async ({ page }) => {
  let address = '192.168.1.10';
  let fail = false;
  await page.route(`${base}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/tagger-setup') return route.fulfill({ contentType: 'text/html', body: await readFile(new URL('../../setup/tagger.html', import.meta.url), 'utf8') });
    if (url.pathname === '/tagger-setup.js') return route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL('../../setup/tagger.js', import.meta.url), 'utf8') });
    if (url.pathname === '/tagger-info') {
      if (fail) return route.abort();
      const addresses = address ? [address, '192.168.2.20'].map((ip, i) => ({ address: ip, interface: `en${i}`, url: `http://${ip}:3001/tagger/` })) : [];
      const chosen = addresses.find(item => item.address === url.searchParams.get('address')) || addresses[0];
      return route.fulfill({ json: { url: chosen?.url || null, friendlyUrl: null, addresses, qrDataUrl: chosen ? pixel : null } });
    }
    return route.abort();
  });
  await page.goto(`${base}/tagger-setup`);
  await expect(page.locator('#tagger-url')).toHaveAttribute('href', 'http://192.168.1.10:3001/tagger/');
  address = '192.168.1.11';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#tagger-url')).toHaveAttribute('href', 'http://192.168.1.11:3001/tagger/');
  await page.getByLabel('Red del teléfono').selectOption('192.168.2.20');
  await expect(page.locator('#tagger-url')).toHaveAttribute('href', 'http://192.168.2.20:3001/tagger/');
  fail = true;
  await page.getByRole('button', { name: 'Actualizar conexión' }).click();
  await expect(page.locator('#tagger-qr')).toBeHidden();
  await expect(page.locator('#tagger-url')).not.toHaveAttribute('href');
  fail = false; address = null;
  await page.getByRole('button', { name: 'Actualizar conexión' }).click();
  await expect(page.getByRole('status')).toContainText('No hay una dirección de red local');
  address = '192.168.3.30';
  await page.getByRole('button', { name: 'Actualizar conexión' }).click();
  await expect(page.locator('#tagger-qr')).toBeVisible();
  await expect(page.locator('#tagger-url')).toHaveAttribute('href', 'http://192.168.3.30:3001/tagger/');
});
