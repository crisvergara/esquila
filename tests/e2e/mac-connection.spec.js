import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));

test('Mac connection checks show progress and translated failures near the button without changing enrollment', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 650 });
  await page.route('http://settings.test/**', async route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (!['mac/settings.html', 'mac/settings.js', 'shared/i18n.js', 'shared/browser-language.js', 'shared/page-language.js', 'shared/locales/en.js', 'shared/locales/es.js'].includes(name)) return route.abort();
    await route.fulfill({ body: await readFile(path.join(root, name)), contentType: name.endsWith('.js') ? 'text/javascript' : 'text/html' });
  });
  await page.addInitScript(() => {
    window.diagnosticCalls = []; window.saved = [];
    window.esquila = {
      loadSettings: async () => ({ configured: true, cloudSyncUrl: 'https://cloud.example.test', cloudAppUrl: '', hasCloudSyncToken: true, shearers: [], manifest: null }),
      loadModes: async () => ({ mode: 'oveja', modes: [{ type: 'oveja', name: 'Ovejas' }] }),
      diagnoseConnection: values => { window.diagnosticCalls.push(values); return new Promise(resolve => { window.finishDiagnostic = resolve; }); },
      previewConfiguration: async () => { throw new Error("Error invoking remote method 'settings:preview': Error: No se pudo resolver la dirección de la nube. Revisa el DNS o prueba otra red. [CLOUD_DNS]"); },
      saveSettings: async values => window.saved.push(values),
    };
  });
  const results = [
    { step: 'health', ok: true, milliseconds: 40 },
    { step: 'identity', ok: false, milliseconds: 100, message: 'El token no corresponde a un servidor autorizado. Revisa el token en la administración remota.' },
    { step: 'configuration', skipped: true },
  ];
  for (const language of ['es', 'en']) {
    await page.goto(`http://settings.test/mac/settings.html?lang=${language}`);
    const status = page.locator('#connection-status');
    await page.locator('#test-connection').click();
    await expect(status).toContainText(language === 'es' ? 'Probando conexión' : 'Checking connection');
    await expect(page.locator('#test-connection')).toBeDisabled();
    await expect(page.locator('#load-configuration')).toBeDisabled();
    await expect(page.locator('#save')).toBeDisabled();
    await expect(page.locator('#save-mode')).toBeEnabled();
    await page.evaluate(results => window.finishDiagnostic(results), results);
    await expect(status).toBeInViewport();
    await expect(status).toBeFocused();
    await expect(page.locator('#connection-results li')).toHaveCount(3);
    await expect(page.locator('#connection-results li').last()).toBeInViewport();
    await expect(page.locator('#connection-results')).toContainText(language === 'es' ? 'token no corresponde a un servidor autorizado.' : 'The token does not belong to an authorized server.');
    await expect(page.locator('#connection-results')).toContainText(language === 'es' ? 'Pendiente de autorización.' : 'Waiting for authorization.');
    await expect(page.locator('#save')).toBeEnabled();
    expect(await page.evaluate(() => window.diagnosticCalls)).toEqual([{ cloudSyncUrl: 'https://cloud.example.test', cloudSyncToken: '' }]);
    expect(await page.evaluate(() => window.saved)).toEqual([]);
    await expect(page.locator('#configuration-preview')).toBeEmpty();
    if (language === 'en') await page.screenshot({ path: test.info().outputPath('cloud-connection-diagnostics.png') });
    await page.locator('#load-configuration').click();
    await expect(status).toContainText('CLOUD_DNS');
    await expect(status).toContainText(language === 'es' ? 'No se pudo resolver' : 'Could not resolve');
    await expect(status).toBeInViewport();

    // Changing connection fields invalidates an in-flight result, including
    // failures: old diagnostics must not be attributed to the new enrollment.
    await page.locator('#test-connection').click();
    await page.locator('#sync-url').fill('https://different.example.test');
    await page.evaluate(results => window.finishDiagnostic(results), results);
    await expect(page.locator('#test-connection')).toBeEnabled();
    await expect(status).toBeEmpty();
    await expect(page.locator('#connection-results')).toBeHidden();
    await expect(page.locator('#save')).toBeDisabled();
    await page.locator('#test-connection').click();
    await page.evaluate(() => window.finishDiagnostic(['health', 'identity', 'configuration'].map(step => ({ step, ok: true, milliseconds: 10 }))));
    await expect(status).toContainText(language === 'es' ? 'no guarda ni aplica' : 'does not save or apply');
    await expect(page.locator('#save')).toBeDisabled();
  }
});
