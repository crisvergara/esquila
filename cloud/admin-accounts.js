import { api, busy, el } from './admin-common.js';
let user;
function password() {
  const currentPassword = el('current-password').value;
  el('current-password').value = '';
  if (!currentPassword) throw new Error('Escribe tu contraseña actual para confirmar esta acción.');
  return currentPassword;
}
const statuses = { active: 'Activa', invited: 'Invitación pendiente', disabled: 'Desactivada' };
const deliveries = { queued: 'En cola; se reintentará automáticamente', sending: 'Enviando', sent: 'Aceptado por el proveedor de correo (revisa spam)', failed: 'Falló; revisa el correo del servidor y reenvía', cancelled: 'Enlace cancelado o utilizado' };
async function loadAccounts() {
  const data = await api('accounts');
  el('accounts').replaceChildren();
  for (const account of data.users) {
    const card = document.createElement('article'); card.className = 'account';
    const title = document.createElement('strong'); title.textContent = `${account.name} · ${account.email}`; card.append(title);
    const detail = document.createElement('p'); detail.textContent = `${account.role === 'owner' ? 'Propietario' : 'Administrador'} · ${statuses[account.status]}`; card.append(detail);
    const mail = document.createElement('p'); mail.textContent = `Último correo: ${deliveries[account.delivery_status] || 'Sin envíos'}`; card.append(mail);
    function action(label, path, data, dangerous = false) {
      const button = document.createElement('button'); button.textContent = label; if (dangerous) button.className = 'danger';
      button.addEventListener('click', () => {
        if (dangerous && !confirm(`¿Desactivar el acceso de ${account.email}? Sus sesiones se cerrarán. Los datos del rancho se conservarán.`)) return;
        void busy(button, el('message'), async () => {
          await api(path, { ...data, currentPassword: password() });
          el('message').textContent = dangerous ? 'Acceso desactivado.' : 'Invitación en cola. Usa el enlace del correo más reciente.';
          await loadAccounts();
        });
      }); card.append(button);
    }
    if (account.status === 'invited') action('Reenviar invitación', 'accounts/invite', { email: account.email, name: account.name, role: account.role });
    if (account.status === 'disabled') action('Invitar de nuevo', `accounts/${account.id}/restore`, {});
    else action(user.legacy ? 'Cancelar invitación' : 'Desactivar acceso', `accounts/${account.id}/disable`, {}, true);
    el('accounts').append(card);
  }
}
try {
  const data = await api('me'); user = data.user;
  el('profile').textContent = user.legacy ? 'Configuración inicial del propietario' : `${user.name} · ${user.email} · ${user.role === 'owner' ? 'Propietario' : 'Administrador'}`;
  el('mail-warning').hidden = data.emailEnabled;
  el('own-reset').hidden = user.legacy;
  el('owner').hidden = user.role !== 'owner';
  el('bootstrap').hidden = !user.legacy; el('role-field').hidden = user.legacy;
  if (user.legacy) el('invite-title').textContent = 'Crear mi primera cuenta';
  if (user.role === 'owner') await loadAccounts();
} catch (error) { el('message').textContent = error.message; }
el('invite-form').addEventListener('submit', event => {
  event.preventDefault();
  void busy(event.submitter, el('message'), async () => {
    await api('accounts/invite', { name: el('invite-name').value, email: el('invite-email').value, role: user.legacy ? 'owner' : el('invite-role').value, currentPassword: password() });
    el('invite-form').reset(); el('message').textContent = 'Invitación en cola. El destinatario recibirá un enlace para crear su contraseña. Revisa también spam.';
    await loadAccounts();
  });
});
el('refresh').addEventListener('click', event => void busy(event.currentTarget, el('message'), loadAccounts));
el('own-reset').addEventListener('click', event => void busy(event.currentTarget, el('message'), async () => { el('message').textContent = (await api('password/forgot', { email: user.email })).message; }));
el('logout').addEventListener('click', event => void busy(event.currentTarget, el('message'), async () => { await api('logout', {}); location.href = '/admin'; }));
