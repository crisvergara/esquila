import { api, busy, el } from './admin-common.js';
// The fragment never reaches the server. Remove it before making any request;
// keep it only in this document's memory, never browser persistent storage.
let token = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
  el('access-form').hidden = true;
  el('access-status').textContent = 'Falta el enlace de invitación o recuperación. Abre el enlace completo del correo o solicita uno nuevo.';
}
el('access-form').addEventListener('submit', event => {
  event.preventDefault();
  void busy(event.submitter, el('access-status'), async () => {
    const password = el('new-password').value;
    if (password !== el('confirm-password').value) throw new Error('Las contraseñas no coinciden.');
    await api('password/complete', { token, password });
    token = ''; el('access-form').reset(); el('access-form').hidden = true;
    el('access-status').textContent = 'Contraseña guardada. Las sesiones anteriores se cerraron. Ahora inicia sesión con tu correo y esta contraseña.';
  });
});
