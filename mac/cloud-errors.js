// Only fixed messages cross IPC. Never expose fetch messages, URLs, response
// bodies, headers or nested causes: those can contain credentials.
const messages = {
  timeout: 'Se agotó el tiempo de espera de la conexión con la nube. Reintenta. [CLOUD_TIMEOUT]',
  dns: 'No se pudo resolver la dirección de la nube. Revisa el DNS o prueba otra red. [CLOUD_DNS]',
  tls: 'No se pudo verificar la conexión segura. Revisa la fecha del Mac y los certificados de la red. [CLOUD_TLS]',
  refused: 'La conexión con la nube fue rechazada. Revisa el servicio y la red. [CLOUD_REFUSED]',
  unreachable: 'No hay una ruta disponible hacia la nube. Revisa la red o la VPN. [CLOUD_UNREACHABLE]',
  reset: 'La conexión con la nube se interrumpió. Reintenta. [CLOUD_INTERRUPTED]',
  redirect: 'La nube redirigió la solicitud. Revisa la dirección del servicio. [CLOUD_REDIRECT]',
  unknown: 'No se pudo conectar con la nube. Revisa internet e inténtalo de nuevo. [CLOUD_NETWORK]',
};

export function cloudNetworkError(error) {
  const pending = [error], seen = new Set(), codes = new Set();
  while (pending.length && seen.size < 16) {
    const next = pending.shift();
    if (!next || seen.has(next)) continue;
    seen.add(next); codes.add(next.code); codes.add(next.name);
    // Undici does not give redirects a code. Compare exactly; never display it.
    if (next.message === 'unexpected redirect') codes.add('CLOUD_REDIRECT');
    pending.push(next.cause, ...(Array.isArray(next.errors) ? next.errors.slice(0, 8) : []));
  }
  const has = (...values) => values.some(value => codes.has(value));
  const category = has('TimeoutError', 'AbortError', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT') ? 'timeout'
    : has('ENOTFOUND', 'EAI_AGAIN') ? 'dns'
    : has('CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_SSL_WRONG_VERSION_NUMBER') ? 'tls'
    : has('CLOUD_REDIRECT') ? 'redirect'
    : has('ECONNREFUSED') ? 'refused'
    : has('ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN') ? 'unreachable'
    : has('ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET') ? 'reset' : 'unknown';
  return new Error(messages[category]);
}
