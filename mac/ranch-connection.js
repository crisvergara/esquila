import { validateManifest, UUID } from '../shared/ranch-configuration.js';

export function cloudOrigin(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('Ingresa una dirección HTTPS válida para la nube.'); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) ||
      url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('Usa una dirección HTTPS sin rutas, credenciales ni parámetros.');
  return url.origin;
}
export function ranchAdminUrl(origin, deviceId) {
  if (!UUID.test(deviceId || '')) throw new Error('El galpón aún no ha recibido su configuración. Revisa la conexión y vuelve a intentar.');
  return `${cloudOrigin(origin)}/admin?server=${encodeURIComponent(deviceId)}#configuration`;
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
