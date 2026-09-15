import { readFile } from 'node:fs/promises';
import { validateRelease } from '../shared/mac-release.js';

export function registerMacUpdates(app, filename = new URL('./mac-update.json', import.meta.url)) {
  // Metadata is baked into the deployment after CI publishes the verified asset.
  // Missing/bad metadata disables updates without taking counting or cloud APIs down.
  app.get('/api/updates/mac', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json(validateRelease(JSON.parse(await readFile(filename, 'utf8'))));
    } catch {
      res.status(503).json({ error: 'No hay una actualización publicada disponible.' });
    }
  });
}
