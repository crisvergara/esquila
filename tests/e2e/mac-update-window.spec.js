import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('update window displays progress, pause/retry and explicit install without installing on close', async ({ page }) => {
  await page.route('http://updates.test/**', async route => {
    const name = new URL(route.request().url()).pathname.slice(1) || 'update.html';
    if (!['update.html', 'update.css', 'update-window.js'].includes(name)) return route.abort();
    await route.fulfill({ body: await readFile(`mac/${name}`), contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  await page.addInitScript(() => {
    window.actions = [];
    window.updates = {
      state: async () => ({ phase: 'available', release: { version: '0.1.7', build: 21 } }),
      subscribe: callback => { window.updateState = callback; },
      action: async action => { window.actions.push(action); },
    };
  });
  await page.goto('http://updates.test/');
  await page.getByRole('button', { name: 'Descargar actualización', exact: true }).click();
  await page.evaluate(() => window.updateState({ phase: 'downloading', received: 5 * 1048576, total: 10 * 1048576 }));
  await expect(page.getByText('50% · 5.0 de 10.0 MB')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Instalar y reiniciar' })).toBeHidden();
  await page.getByRole('button', { name: 'Pausar descarga' }).click();
  await page.evaluate(() => window.updateState({ phase: 'error', error: 'Descarga pausada.', release: { version: '0.1.7', build: 21 }, received: 5, total: 10 }));
  await page.getByRole('button', { name: 'Reintentar / continuar descarga' }).click();
  await page.evaluate(() => window.updateState({ phase: 'ready', automatic: true }));
  await expect(page.getByRole('button', { name: 'Instalar y reiniciar' })).toBeVisible();
  expect(await page.evaluate(() => window.actions)).toEqual(['download', 'pause', 'download']);
  await page.getByRole('button', { name: 'Instalar y reiniciar' }).click();
  expect(await page.evaluate(() => window.actions)).toEqual(['download', 'pause', 'download', 'install']);
});
