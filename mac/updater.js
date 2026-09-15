import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { UPDATE_FEED_URL, validateRelease, isNewerRelease } from '../shared/mac-release.js';

async function readBounded(response, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('La respuesta de actualización es demasiado grande.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function assetResponse(url, fetchImpl, signal) {
  for (let redirects = 0; redirects <= 5; redirects++) {
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.username || target.password || target.port ||
        !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(target.hostname)) {
      throw new Error('La descarga fue redirigida a una dirección no permitida.');
    }
    const response = await fetchImpl(target.href, { redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('La descarga no tiene una dirección válida.');
      url = new URL(location, target).href;
    } else {
      if (!response.ok) throw new Error('No se pudo descargar el instalador. Reintenta cuando vuelva internet.');
      return response;
    }
  }
  throw new Error('La descarga tiene demasiadas redirecciones.');
}

export async function verifyInstaller(filename, release) {
  const info = await stat(filename);
  if (info.size !== release.size) throw new Error('El tamaño del instalador no coincide.');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  if (hash.digest('hex') !== release.sha256) throw new Error('El instalador no pasó la verificación. Vuelve a descargarlo.');
}

export function createUpdater({ installed, directory, fetchImpl = fetch, onChange = () => {} }) {
  let state = { phase: 'idle', release: null, filename: null, error: null };
  let busy = false;
  const change = values => { state = { ...state, ...values }; onChange(state); };
  const errorMessage = error => error instanceof SyntaxError
    ? 'El servidor envió información de actualización inválida. Reintenta más tarde.'
    : error.name === 'TimeoutError' || error instanceof TypeError
    ? 'Sin conexión con las actualizaciones. El conteo sigue funcionando; reintenta más tarde.'
    : error.message;
  return {
    get state() { return state; },
    async check() {
      if (busy) return;
      busy = true; change({ phase: 'checking', error: null });
      try {
        const response = await fetchImpl(UPDATE_FEED_URL, { redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'Cache-Control': 'no-cache' } });
        if (!response.ok) throw new Error('El servidor no tiene información de actualización disponible. Reintenta más tarde.');
        const release = validateRelease(JSON.parse(await readBounded(response, 16_384)));
        change({ phase: isNewerRelease(release, installed) ? 'available' : 'current',
          release: isNewerRelease(release, installed) ? release : null, filename: null });
      } catch (error) { change({ phase: 'error', error: errorMessage(error) }); }
      finally { busy = false; }
      return state;
    },
    async download() {
      if (busy || !state.release) return;
      busy = true;
      const release = state.release;
      const filename = path.join(directory, `Esquila-${release.version}-${release.build}-${release.sha256.slice(0, 12)}.dmg`);
      const partial = `${filename}.part`;
      change({ phase: 'downloading', error: null, filename: null });
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        try {
          await verifyInstaller(filename, release);
          change({ phase: 'ready', filename });
          return state;
        } catch { /* Missing or corrupt cached download: fetch a fresh copy. */ }
        await rm(partial, { force: true });
        const response = await assetResponse(release.url, fetchImpl, AbortSignal.timeout(30 * 60_000));
        const file = await open(partial, 'wx', 0o600);
        let size = 0;
        const hash = createHash('sha256');
        try {
          for await (const chunk of response.body) {
            size += chunk.length;
            if (size > release.size) throw new Error('El instalador supera el tamaño esperado.');
            hash.update(chunk);
            await file.writeFile(chunk);
          }
          if (size !== release.size || hash.digest('hex') !== release.sha256) {
            throw new Error('La descarga está incompleta o no pasó la verificación. Reintenta.');
          }
          await file.sync();
        } finally { await file.close(); }
        await rename(partial, filename);
        change({ phase: 'ready', filename });
      } catch (error) {
        await rm(partial, { force: true }).catch(() => {});
        change({ phase: 'error', error: errorMessage(error) });
      } finally { busy = false; }
      return state;
    },
  };
}
