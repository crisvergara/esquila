import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { verifyInstaller } from './updater.js';

// Invoke only after the operator confirms installation. Squirrel stages updates
// for the next exit, so even checkForUpdates must not run before that consent.
export async function stageNativeUpdate({ autoUpdater, filename, release, timeoutMs = 120_000 }) {
  await verifyInstaller(filename, release.automatic);
  const token = randomBytes(32).toString('hex');
  let origin;
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.headers.host !== new URL(origin).host) {
      response.writeHead(403).end(); return;
    }
    if (request.url === `/${token}/feed`) {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ url: `${origin}/${token}/update.zip`,
        name: `${release.version} (${release.build})`, pub_date: release.publishedAt }));
    } else if (request.url === `/${token}/update.zip`) {
      response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': release.automatic.size });
      const stream = createReadStream(filename);
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } else response.writeHead(404).end();
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        autoUpdater.removeListener('error', failed);
        autoUpdater.removeListener('update-downloaded', ready);
        autoUpdater.removeListener('update-not-available', unavailable);
      };
      const failed = error => { cleanup(); reject(error); };
      const ready = () => { cleanup(); resolve(); };
      const unavailable = () => failed(new Error('macOS no pudo preparar la actualización.'));
      const timer = setTimeout(() => failed(new Error('macOS tardó demasiado en preparar la actualización. Reintenta.')), timeoutMs);
      autoUpdater.once('error', failed);
      autoUpdater.once('update-downloaded', ready);
      autoUpdater.once('update-not-available', unavailable);
      try {
        autoUpdater.setFeedURL({ url: `${origin}/${token}/feed`, serverType: 'default' });
        autoUpdater.checkForUpdates();
      } catch (error) { failed(error); }
    });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
