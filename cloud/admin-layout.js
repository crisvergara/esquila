import { readFile } from 'node:fs/promises';
const sections = {
  overview: ['/admin', 'Resumen', 'Estado de los galpones y conteos recibidos'],
  records: ['/admin/records', 'Registros', 'Revisa las esquilas y corrige sus respuestas'],
  configuration: ['/admin/configuration', 'Configuración', 'Estaciones, colores y encuestas de cada galpón'],
  devices: ['/admin/devices', 'Dispositivos', 'Conecta servidores y teléfonos al rancho'],
  accounts: ['/admin/accounts', 'Mi cuenta y accesos', 'Tu cuenta y las personas que administran el rancho'],
};
const pages = Object.fromEntries(await Promise.all(Object.keys(sections).map(async key => [key,
  await readFile(new URL(key === 'overview' ? './admin.html' : `./admin-${key}.html`, import.meta.url), 'utf8')])));
export const adminPaths = Object.fromEntries(Object.entries(sections).map(([key, [path]]) => [path, key]));
export function renderAdminPage(key) {
  const [, title, description] = sections[key];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title} — Esquila</title><link rel="stylesheet" href="/admin.css"></head>
    <body data-screen="${key}"><a class="skip-link" href="#main">Saltar al contenido</a>
    <aside class="sidebar"><a class="brand" href="/admin"><span class="brand-mark">E</span><span>Esquila<small>Administración del rancho</small></span></a>
      <nav aria-label="Administración">${Object.entries(sections).map(([id, [url, name]], i) => `<a href="${url}" data-nav="${id}"${id === key ? ' aria-current="page"' : ''}><span aria-hidden="true">0${i + 1}</span>${name}</a>`).join('')}</nav>
      <p class="sidebar-note">El galpón sigue contando sin internet. Aquí ves los datos que ya llegaron a la nube.</p>
      <button id="logout" class="quiet">Cerrar sesión</button><p id="session-error" class="error" role="alert"></p></aside>
    <main id="main" tabindex="-1"><header class="page-header"><div><p class="eyebrow">ESQUILA / NUBE</p><h1>${title}</h1><p class="muted">${description}</p></div>${key === 'records' ? '' : '<a class="help-link" href="/admin/records">Revisar esquilas →</a>'}</header>
    ${pages[key]}</main><script type="module" src="/admin-shell.js"></script><script type="module" src="/${key === 'accounts' ? 'admin-accounts' : 'admin'}.js"></script></body></html>`;
}
