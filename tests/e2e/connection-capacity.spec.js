import { test, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startNodeService, stopService, waitForHealth } from './helpers.mjs';

const base = 'http://127.0.0.1:3186';
let server;
test.beforeAll(async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'esquila-connections-'));
  server = startNodeService('connection regression ranch', path.resolve('countserver.js'), {
    cwd, env: { PORT: '3186', CLOUD_SYNC_URL: '', CLOUD_SYNC_TOKEN: '', AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '' },
  });
  await waitForHealth(base, server);
});
test.afterAll(async () => { await stopService(server); });

test('repeated tagger tabs do not block navigation or counting requests', async ({ browser, request }) => {
  const context = await browser.newContext();
  try {
    const pages = [];
    for (let i = 0; i < 8; i++) {
      const page = await context.newPage(); pages.push(page);
      await page.goto(`${base}/tagger/`, { timeout: 8000, waitUntil: 'domcontentloaded' });
      // The station choice persists across tabs in this shared browser context.
      if (i === 0) await page.getByRole('button', { name: 'Ramiro', exact: true }).click();
      await expect(page.getByText('Elija un color')).toBeVisible();
    }
    expect((await request.get(`${base}/healthz`)).ok()).toBe(true);
    expect(await pages[7].evaluate(async () => (await fetch('/bulk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(3000),
      body: JSON.stringify({ station: 1, quantity: 1, submissionId: crypto.randomUUID() }),
    })).ok)).toBe(true);
    const monitor = await context.newPage();
    await monitor.goto(`${base}/monitor/`, { timeout: 8000 });
    await expect(monitor.getByText('L0001', { exact: true })).toBeVisible();
    await request.post(`${base}/mode`, { data: { mode: 'carnillero' } });
    for (const page of pages) await expect(page.getByText('¿Cuantos cordilleros hay?')).toBeVisible();
    await context.setOffline(true);
    await expect(monitor.getByRole('alert')).toContainText('Sin conexión con el galpón');
    await context.setOffline(false);
    await expect(monitor.getByRole('alert')).toHaveCount(0);
    await expect(monitor.getByText('L0001', { exact: true })).toBeVisible();
  } finally { await context.close(); }
});
