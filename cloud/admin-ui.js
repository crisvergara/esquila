export const $ = id => document.getElementById(id);
export const dateText = value => value ? new Date(value).toLocaleString('es-CL', { timeZone: 'America/Santiago' }) : 'Sin registro';
export const node = (tag, text, className) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; };
export const cell = text => node('td', text);
export function button(text, action, className = 'quiet') { const el = node('button', text, className); el.type = 'button'; el.onclick = action; return el; }
export function options(id, values, selected) { $(id).replaceChildren(...values.map(value => { const el = node('option', value.name); el.value = value.value; el.selected = String(value.value) === String(selected); return el; })); }
export async function api(method, path, body) {
  const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  if (response.status === 401) { location.reload(); throw new Error('Sesión vencida'); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error ?? `Error ${response.status}`), { status: response.status });
  return result;
}
