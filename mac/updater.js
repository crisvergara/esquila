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

async function assetResponse(url, fetchImpl, signal, offset = 0) {
  for (let redirects = 0; redirects <= 5; redirects++) {
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.username || target.password || target.port ||
        !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(target.hostname)) {
      throw new Error('La descarga fue redirigida a una dirección no permitida.');
    }
    const response = await fetchImpl(target.href, { redirect: 'manual', signal, headers: offset ? { Range: `bytes=${offset}-` } : {} });
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

export function createUpdater({ installed, directory, fetchImpl = fetch, onChange = () => {}, teamId = null }) {
  let state = { phase: 'idle', release: null, filename: null, error: null, received: 0, total: 0, automatic: false };
  let controller;
  let busy = false;
  const change = values => { state = { ...state, ...values }; onChange(state); };
  const errorMessage = error => error instanceof SyntaxError
    ? 'El servidor envió información de actualización inválida. Reintenta más tarde.'
    : error.name === 'TimeoutError' || error instanceof TypeError
    ? 'Sin conexión con las actualizaciones. El conteo sigue funcionando; reintenta más tarde.'
    : error.message;
  return {
    get state() { return state; },
    pause() { controller?.abort(new Error('Descarga pausada. Puedes continuar cuando quieras.')); },
    async check() {
      if (busy) return;
      if (state.phase === 'ready') return state;
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
      const automatic = Boolean(teamId && state.release.automatic?.teamId === teamId);
      const release = automatic ? state.release.automatic : state.release;
      const filename = path.join(directory, `Esquila-${state.release.version}-${state.release.build}-${release.sha256.slice(0, 12)}.${automatic ? 'zip' : 'dmg'}`);
      const partial = `${filename}.part`;
      controller = new AbortController();
      change({ phase: 'downloading', error: null, filename: null, automatic, received: 0, total: release.size });
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        try {
          await verifyInstaller(filename, release);
          change({ phase: 'ready', filename, received: release.size });
          return state;
        } catch { /* Missing or corrupt cached download: fetch a fresh copy. */ }
        let offset = (await stat(partial).catch(() => ({ size: 0 }))).size;
        if (offset >= release.size) {
          await rm(partial, { force: true });
          offset = 0;
        }
        // No total deadline: a slow but healthy connection can finish. Bound each
        // wait for headers/body data instead, and preserve bytes on interruption.
        let idleTimer;
        const resetIdle = () => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => controller.abort(new Error('La conexión se detuvo. Reintenta para continuar la descarga.')), 120_000);
        };
        resetIdle();
        try {
          const response = await assetResponse(release.url, fetchImpl, controller.signal, offset);
          if (response.status === 206) {
            if (response.headers.get('content-range') !== `bytes ${offset}-${release.size - 1}/${release.size}`) {
              await response.body?.cancel();
              throw new Error('El servidor devolvió un rango de descarga inválido.');
            }
          } else if (response.status === 200) offset = 0;
          else throw new Error('Respuesta de descarga inesperada.');
          const file = await open(partial, offset ? 'a' : 'w', 0o600);
          let size = offset;
          change({ received: size });
          let lastProgress = 0;
          try {
            for await (const chunk of response.body) {
              resetIdle();
              size += chunk.length;
              if (size > release.size) {
                await file.close();
                await rm(partial, { force: true });
                throw new Error('El instalador supera el tamaño esperado.');
              }
              await file.writeFile(chunk);
              if (Date.now() - lastProgress > 200 || size === release.size) {
                change({ received: size });
                lastProgress = Date.now();
              }
            }
            await file.sync();
          } finally { await file.close(); }
          if (size !== release.size) throw new Error('La descarga está incompleta. Reintenta para continuar.');
        } finally { clearTimeout(idleTimer); }
        try { await verifyInstaller(partial, release); }
        catch (error) { await rm(partial, { force: true }); throw error; }
        await rename(partial, filename);
        change({ phase: 'ready', filename, received: release.size });
      } catch (error) {
        change({ phase: 'error', error: errorMessage(error) });
      } finally { busy = false; controller = null; }
      return state;
    },
  };
}
