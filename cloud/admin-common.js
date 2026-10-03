export const el = id => document.getElementById(id);
export async function api(path, data) {
  const response = await fetch(`/api/admin/${path}`, { credentials: 'same-origin', cache: 'no-store',
    ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 401 ? 'La sesión venció o los datos son incorrectos. Vuelve a iniciar sesión.' : result.error || 'No se pudo completar la solicitud. Reintenta.');
  return result;
}
export async function busy(button, status, action) {
  button.disabled = true; status.textContent = '';
  try { await action(); } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
}
