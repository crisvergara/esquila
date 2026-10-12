import { validateManifest, UUID } from '../shared/ranch-configuration.js';
import { cloudNetworkError } from './cloud-errors.js';

function serverToken(token) {
  if (typeof token !== 'string' || !token.trim() || token.length > 512 || /[\r\n]/.test(token)) throw new Error('Ingresa el token del servidor.');
  // Copied invisible/Unicode characters can make fetch throw before any request.
  if (!/^[A-Za-z0-9._~+\/=-]+$/.test(token.trim())) throw new Error('El token contiene caracteres inválidos. Vuelve a copiar el token completo. [TOKEN_FORMAT]');
  return token.trim();
}
async function request(origin, route, token, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${origin}${route}`, {
      headers: { 'Cache-Control': 'no-cache', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
  } catch (error) { throw cloudNetworkError(error); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (token && (response.status === 401 || response.status === 403)) throw new Error('El token no corresponde a un servidor autorizado. Revisa el token en la administración remota.');
    if (route === '/api/server/configuration' && response.status === 409) throw new Error('Primero publica la configuración de este galpón en la administración remota.');
    throw new Error(`La nube devolvió HTTP ${response.status}. Reintenta o revisa el servicio.`);
  }
  return response;
}
async function readJson(response, limit, invalidMessage) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error(invalidMessage);
  const chunks = []; let length = 0;
  try {
    while (true) {
      let chunk;
      try { chunk = await reader.read(); } catch (error) { throw cloudNetworkError(error); }
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > limit) throw new Error(invalidMessage);
      chunks.push(chunk.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error(invalidMessage); }
  } finally { await reader.cancel().catch(() => {}); }
}

export function cloudOrigin(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('Ingresa una dirección HTTPS válida para la nube.'); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) ||
      url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('Usa una dirección HTTPS sin rutas, credenciales ni parámetros.');
  return url.origin;
}
export function ranchAdminUrl(origin, deviceId) {
  if (typeof deviceId !== 'string' || !UUID.test(deviceId)) throw new Error('La nube devolvió una identificación inválida para este servidor.');
  return `${cloudOrigin(origin)}/admin/configuration?server=${encodeURIComponent(deviceId)}`;
}
export async function resolveRanchAdminUrl(origin, token, readLocalConfiguration, fetchImpl = fetch) {
  const base = cloudOrigin(origin);
  let local;
  try { local = await readLocalConfiguration(); } catch { /* Resolve using the saved server credential. */ }
  if (typeof local?.deviceId === 'string' && UUID.test(local.deviceId)) return ranchAdminUrl(base, local.deviceId);
  return ranchAdminUrl(base, await fetchRanchIdentity(base, token, fetchImpl));
}
export async function fetchRanchIdentity(origin, token, fetchImpl = fetch) {
  const base = cloudOrigin(origin);
  const response = await request(base, '/api/server/identity', serverToken(token), fetchImpl);
  const invalid = 'La nube devolvió una identificación inválida para este servidor.';
  const identity = await readJson(response, 1024, invalid);
  if (typeof identity?.deviceId !== 'string' || !UUID.test(identity.deviceId)) throw new Error(invalid);
  return identity.deviceId;
}
export async function fetchRanchManifest(origin, token, fetchImpl = fetch) {
  const base = cloudOrigin(origin);
  const response = await request(base, '/api/server/configuration', serverToken(token), fetchImpl);
  const value = await readJson(response, 96 * 1024, 'La nube devolvió una configuración inválida o demasiado grande.');
  return validateManifest(value);
}

// Read-only checks use exactly the same stack/origin/token as settings. No
// manifest is saved, acknowledged or substituted for the local offline cache.
export async function diagnoseRanchConnection(origin, token, fetchImpl = fetch) {
  const base = cloudOrigin(origin);
  async function check(step, run) {
    const start = Date.now();
    try { await run(); return { step, ok: true, milliseconds: Date.now() - start }; }
    catch (error) { return { step, ok: false, milliseconds: Date.now() - start, message: error.message }; }
  }
  const publicCheck = check('health', async () => {
    const response = await request(base, '/healthz', null, fetchImpl);
    const message = 'La dirección no devolvió una respuesta válida de Esquila. Revisa la dirección del servicio.';
    if ((await readJson(response, 1024, message))?.ok !== true) throw new Error(message);
  });
  const identity = await check('identity', () => fetchRanchIdentity(base, token, fetchImpl));
  const configuration = identity.ok
    ? await check('configuration', () => fetchRanchManifest(base, token, fetchImpl))
    : { step: 'configuration', skipped: true };
  return [await publicCheck, identity, configuration];
}
