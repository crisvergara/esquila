import { t, errorText } from '/shared/browser-language.js';
import { api, busy, el } from './admin-common.js';
let legacy = false;
try {
  const state = await api('auth-status');
  legacy = state.legacyAvailable && !state.personalAccounts;
  el('email-field').hidden = legacy; el('email').required = !legacy;
  el('password-label').textContent = legacy ? t('Contraseña de administración') : t('Contraseña');
  el('bootstrap-note').hidden = !legacy;
  el('fresh-note').hidden = state.personalAccounts || legacy;
  el('submit').disabled = !state.personalAccounts && !legacy;
  if (!state.emailEnabled) el('reset-status').textContent = t('El operador debe configurar el correo antes de poder recuperar contraseñas.');
} catch { el('load-error').textContent = t('No se pudo conectar. Recarga la página para reintentar.'); }
el('login-form').addEventListener('submit', event => {
  event.preventDefault();
  void busy(el('submit'), el('error'), async () => {
    const password = el('password').value; el('password').value = '';
    await api('login', { email: legacy ? undefined : el('email').value, password });
    location.reload();
  });
});
el('forgot-form').addEventListener('submit', event => {
  event.preventDefault();
  void busy(event.submitter, el('reset-status'), async () => {
    el('reset-status').textContent = errorText((await api('password/forgot', { email: el('reset-email').value })).message);
  });
});
