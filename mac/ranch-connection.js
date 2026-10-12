import { validateManifest, UUID } from '../shared/ranch-configuration.js';

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
  if (typeof token !== 'string' || !token.trim() || token.length > 512 || /[\r\n]/.test(token)) throw new Error('Ingresa el token del servidor.');
  let response;
  try {
    response = await fetchImpl(`${base}/api/server/identity`, {
      headers: { Authorization: `Bearer ${token.trim()}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
  } catch { throw new Error('No se pudo conectar con la nube. Revisa internet e inténtalo de nuevo.'); }
  if (response.status === 401 || response.status === 403) throw new Error('El token no corresponde a un servidor autorizado. Revisa el token en la administración remota.');
  if (!response.ok) throw new Error('La nube no pudo identificar este servidor. Reintenta más tarde.');
  const reader = response.body?.getReader();
  const chunks = []; let length = 0;
  try {
    if (!reader) throw new Error('Empty identity');
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 1024) throw new Error('Oversized identity');
      chunks.push(value);
    }
    const identity = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof identity?.deviceId !== 'string' || !UUID.test(identity.deviceId)) throw new Error('Invalid identity');
    return identity.deviceId;
  } catch { throw new Error('La nube devolvió una identificación inválida para este servidor.'); }
  finally { await reader?.cancel().catch(() => {}); }
}
export async function fetchRanchManifest(origin, token, fetchImpl = fetch) {
  const base = cloudOrigin(origin);
  if (typeof token !== 'string' || !token.trim() || token.length > 512 || /[\r\n]/.test(token)) throw new Error('Ingresa el token del servidor.');
  let response;
  try {
    response = await fetchImpl(`${base}/api/server/configuration`, {
      headers: { Authorization: `Bearer ${token.trim()}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
  } catch { throw new Error('No se pudo conectar con la nube. Revisa internet y vuelve a cargar la configuración.'); }
  if (response.status === 401 || response.status === 403) throw new Error('El token no corresponde a un servidor autorizado. Revisa el token en la administración remota.');
  if (response.status === 409) throw new Error('Primero publica la configuración de este galpón en la administración remota.');
  if (!response.ok) throw new Error('La nube no pudo entregar la configuración. Reintenta más tarde.');
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 96 * 1024) throw new Error('La configuración remota supera el tamaño permitido.');
      chunks.push(value);
    }
    return validateManifest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } finally { await reader.cancel().catch(() => {}); }
}
