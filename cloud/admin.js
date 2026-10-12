import { t, errorText } from '/shared/browser-language.js';
import { recordTypeForMode, modeName } from '/modes.js';
import { $, api, cell, node, dateText, options } from '/admin-ui.js';
import { updateNavigation } from '/admin-shell.js';
const screen = document.body.dataset.screen;
if (screen === 'overview' && location.hash === '#configuration') {
  location.replace(`/admin/configuration${location.search}`);
} else if (screen === 'records') await import('/admin-records.js');
else if (screen === 'devices') await import('/admin-devices.js');
else if (screen === 'configuration') {
  const { mountRanchConfiguration } = await import('/admin-configuration.js');
  const refresh = async () => {
    const id = new URL(location.href).searchParams.get('server');
    const info = await api('GET', `/api/admin/ranch${id ? `?server=${encodeURIComponent(id)}` : ''}`);
    ui.setServers(info.servers); updateNavigation(id || info.selectedId);
  };
  const ui = mountRanchConfiguration({ api, onPublished: refresh });
  try { await refresh(); } catch (e) { $('configuration-error').textContent = errorText(e.message); }
} else if (screen === 'overview') {
  let busy = false, initialized = false;
  async function refresh() {
    if (busy) return; busy = true;
    try {
      const requested = new URL(location.href).searchParams.get('server');
      const info = await api('GET', `/api/admin/ranch${requested ? `?server=${encodeURIComponent(requested)}` : ''}`);
      if (!initialized) { $('ranch-day').value = info.day; initialized = true; }
      options('overview-server', info.servers.map(s => ({ value: s.id, name: s.name })), info.selectedId);
      updateNavigation(requested);
      $('overview-records').href = `/admin/records${info.selectedId ? `?server=${info.selectedId}` : ''}`;
      const data = await api('GET', `/api/admin/shearing?${new URLSearchParams({ day: $('ranch-day').value, limit: '25' })}`);
      const names = info.configuration?.shearers || info.servers.find(s => s.id === info.selectedId)?.information?.shearers || [];
      const stations = new Map();
      names.forEach((s, i) => { if (s.active !== false) stations.set(i + 1, Object.create(null)); });
      for (const total of data.totals) { if (!stations.has(total.station)) stations.set(total.station, Object.create(null)); stations.get(total.station)[total.type] = total.count; }
      const types = new Map(info.modes.filter(m => m.active !== false || data.totals.some(t => t.type === recordTypeForMode(m))).map(m => [recordTypeForMode(m), modeName(m)]));
      for (const t of data.types) if (!types.has(t.value) && data.totals.some(total => total.type === t.value)) types.set(t.value, t.name || t.value);
      $('ranch-total-head').replaceChildren(...[t('Estación'), ...types.values(), t('Total')].map(t => node('th', t)));
      $('ranch-totals').replaceChildren(); let sum = 0;
      for (const [station, counts] of [...stations].sort((a,b) => a[0] - b[0])) {
        const total = Object.values(counts).reduce((a,b) => a + b, 0); sum += total;
        const row = node('tr'); row.append(...[`${station}: ${names[station - 1]?.name || t('Sin nombre')}`, ...[...types.keys()].map(type => counts[type] || 0), total].map(cell)); $('ranch-totals').append(row);
      }
      $('ranch-summary').textContent = t`${sum} animales registrados. Actualizado: ${dateText(info.serverTime)}.`;
      const fresh = info.servers.filter(s => s.received_at && Date.parse(info.serverTime) - Date.parse(s.received_at) <= 180000);
      $('overview-metrics').replaceChildren(...[[sum, t('Animales en la fecha elegida')], [`${fresh.length} / ${info.servers.length}`, t('Servidores con contacto reciente')], [info.servers.find(s => s.id === info.selectedId)?.pending_to_ranch ?? '—', t('Cambios pendientes en el galpón de referencia')]].map(([value, label]) => { const card = node('div', null, 'metric'); card.append(node('strong', value), node('span', label)); return card; }));
      $('ranch-servers').replaceChildren();
      for (const server of info.servers) {
        const card = node('article', null, 'server-card');
        card.append(node('h3', server.name), node('span', fresh.includes(server) ? t('Contacto reciente') : t('Sin contacto reciente'), `badge ${fresh.includes(server) ? 'received' : 'pending'}`), node('p', t`Último contacto: ${dateText(server.received_at || server.last_seen_at)}`, 'muted'), node('p', t`${server.pending_to_ranch} cambios de nube pendientes en este galpón (incluye eliminaciones).`));
        if (server.information) card.append(node('p', t`${server.information.hostname} · Modo: ${server.information.modeName || server.information.mode} · v${server.information.version} · ${server.information.pending} cambios locales pendientes`, 'muted'));
        else card.append(node('p', t('Este servidor aún no ha informado su estado.'), 'muted'));
        const links = node('div', null, 'row');
        for (const [path, label] of [['records',t('Ver registros')],['configuration',t('Configurar')]]) { const a = node('a', label); a.href = `/admin/${path}?server=${server.id}`; links.append(a); }
        card.append(links); $('ranch-servers').append(card);
      }
      if (!info.servers.length) { const empty = node('p', t('No hay servidores inscritos.')); const link = node('a',t('Inscribir un servidor')); link.href='/admin/devices'; empty.append(' ',link); $('ranch-servers').append(empty); }
      $('ranch-error').textContent = '';
    } catch (error) { $('ranch-error').textContent = t`No se pudo actualizar. Los datos visibles pueden estar atrasados. ${errorText(error.message)}`; }
    finally { busy = false; }
  }
  $('overview-server').onchange = () => { const url = new URL(location.href); url.searchParams.set('server', $('overview-server').value); history.replaceState(null, '', url); refresh(); };
  $('overview-refresh').onclick = refresh; $('ranch-day').onchange = refresh;
  await refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 10000);
}
