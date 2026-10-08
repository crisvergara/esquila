const server = new URL(location.href).searchParams.get('server');
export function updateNavigation(id) {
  for (const link of document.querySelectorAll('[data-nav]')) {
    const url = new URL(link.href);
    if (id && id !== 'unknown') url.searchParams.set('server', id); else url.searchParams.delete('server');
    link.href = url.pathname + url.search;
  }
}
updateNavigation(server);
document.getElementById('logout').onclick = async () => {
  const button = document.getElementById('logout'); button.disabled = true;
  try {
    const response = await fetch('/api/admin/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('No se pudo cerrar la sesión. Reintenta.');
    location.replace('/admin');
  } catch (error) { document.getElementById('session-error').textContent = error.message; button.disabled = false; }
};
