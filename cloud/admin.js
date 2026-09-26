import { mountRanchConfiguration } from '/admin-configuration.js';
const $ = (id) => document.getElementById(id);

async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 401) {
    location.reload();
    throw new Error("Sesión vencida");
  }
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw Object.assign(new Error(result.error ?? `Error ${response.status}`), { status: response.status });
  }
  return response.json();
}

function cell(text) {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

async function loadDevices() {
  try {
    const devices = await api("GET", "/api/admin/devices");
    const tbody = $("devices");
    tbody.replaceChildren();
    for (const device of devices) {
      const row = document.createElement("tr");
      row.append(cell(device.name), cell(device.role));
      row.append(cell(device.last_seen_at
        ? new Date(device.last_seen_at).toLocaleString("es-CL")
        : "nunca"));
      const action = document.createElement("td");
      const remove = document.createElement("button");
      remove.className = "danger";
      remove.textContent = "Eliminar";
      remove.addEventListener("click", () => revoke(device.id));
      action.append(remove);
      row.append(action);
      tbody.append(row);
    }
  } catch (err) {
    $("error").textContent = err.message;
  }
}

async function createDevice() {
  $("error").textContent = "";
  try {
    const device = await api("POST", "/api/admin/devices", {
      name: $("name").value,
      role: $("role").value,
    });
    const qr = $("qr");
    qr.replaceChildren();
    const explanation = document.createElement("p");
    const value = document.createElement("p");
    value.className = "token";
    if (device.role === "server") {
      explanation.textContent = 'Primero publica la configuración de este galpón. Luego copia este token en la configuración de Esquila para descargarla:';
      value.textContent = device.token;
      const link = document.createElement('a'); link.href = `/admin?server=${device.id}#configuration`; link.textContent = 'Configurar este galpón';
      // Keep the one-time credential visible while configuring the new server.
      link.onclick = event => { event.preventDefault(); location.hash = 'configuration'; $('configuration-server').value = device.id; $('configuration-server').dispatchEvent(new Event('change')); };
      qr.append(explanation, value, link);
    } else {
      explanation.textContent = `Escanéalo con el teléfono de ${device.name}:`;
      const image = document.createElement("img");
      image.src = device.qrDataUrl;
      image.alt = "Código QR de inscripción";
      value.textContent = device.enrollUrl;
      qr.append(explanation, image, value);
    }
    $("name").value = "";
    await loadDevices();
    await loadRanch();
  } catch (err) {
    $("error").textContent = err.message;
  }
}

async function revoke(id) {
  $("error").textContent = "";
  try {
    await api("DELETE", `/api/admin/devices/${encodeURIComponent(id)}`);
    if (new URL(location.href).searchParams.get('server') === id) {
      location.replace('/admin#configuration');
      return;
    }
    await loadDevices();
    await loadRanch();
  } catch (err) {
    $("error").textContent = err.message;
  }
}

$("create").addEventListener("click", createDevice);
$("logout").addEventListener("click", async () => {
  await api("POST", "/api/admin/logout");
  location.replace("/admin");
});

loadDevices();

let ranchInfo;
let recordOffset = 0;
let editing;
let loadingRanch = false;
let refreshRequested = false;
let savingRecord = false;
const attemptKey = 'esquila-admin-record-attempt';
const dateText = value => value ? new Date(value).toLocaleString('es-CL', { timeZone: 'America/Santiago' }) : 'Sin contacto';
const selectedShearers = () => ranchInfo?.configuration?.shearers || ranchInfo?.servers.find(s => s.id === ranchInfo.selectedId)?.information?.shearers || [];
const stationName = station => `${station}: ${selectedShearers()[station - 1]?.name || 'Sin nombre'}`;
const configurationUI = mountRanchConfiguration({ api, onPublished: async () => { await loadDevices(); await loadRanch(); } });
function button(text, action) {
  const element = document.createElement('button');
  element.type = 'button'; element.textContent = text; element.addEventListener('click', action);
  return element;
}
function options(id, values, selected) {
  $(id).replaceChildren(...values.map(value => {
    const option = document.createElement('option'); option.value = value.value; option.textContent = value.name;
    option.selected = value.value === selected; return option;
  }));
}
function recordFields(row = {}) {
  const mode = ranchInfo.modes.find(m => m.type === $('record-type').value);
  const available = values => {
    const active = values.filter(v => v.active !== false || v.value === row.color || v.value === row.woolQuality || v.value === row.lactation);
    return active;
  };
  const colors = available(mode?.tagSchema?.colors || [{ value: 'none', name: 'No hay' }]);
  if (row.color && !colors.some(c => c.value === row.color)) colors.push({ value: row.color, name: `${row.color} (histórico)` });
  options('record-color', colors, row.color);
  for (const [field, fallback] of [['woolQuality', 'IDK'], ['lactation', 'idk']]) {
    const choices = available(mode?.surveySchema?.find(s => s.field === field)?.options || [{ value: fallback, name: 'No corresponde' }]);
    if (row[field] && !choices.some(c => c.value === row[field])) choices.push({ value: row[field], name: `${row[field]} (histórico)` });
    options(`record-${field}`, choices, row[field]);
  }
}
function openRecord(action, row = {}) {
  editing = { action, ...(ranchInfo.selectedId ? { serverId: ranchInfo.selectedId } : {}), ...(row.id ? { id: row.id, updated_at: row.updated_at } : {}) };
  $('editor-title').textContent = action === 'delete' ? `Eliminar ${row.tag}` : action === 'add' ? 'Agregar registro' : `Editar ${row.tag}`;
  $('editor-note').textContent = action === 'delete' ? 'El registro se eliminará de los conteos. El cambio llegará al galpón cuando vuelva a conectarse.' : 'Los cambios se guardan en la nube y llegan al galpón al sincronizar. Al editar se conserva la fecha original.';
  const stations = Array.from({ length: Math.max(selectedShearers().length || 6, row.station || 0) }, (_, i) => ({ value: String(i + 1), name: stationName(i + 1) })).filter(s => selectedShearers()[Number(s.value) - 1]?.active !== false || Number(s.value) === row.station);
  options('record-station', stations, String(row.station || 1));
  $('record-tag').value = row.tag || ''; $('record-type').value = row.type || 'oveja'; recordFields(row);
  for (const el of $('record-form').querySelectorAll('input, select')) el.disabled = action === 'delete';
  $('record-save').textContent = action === 'delete' ? 'Confirmar eliminación' : 'Guardar';
  $('editor-error').textContent = ''; $('ranch-editor').showModal();
}
async function history(id) {
  $('history-rows').replaceChildren(); $('ranch-history').showModal();
  try {
    const rows = await api('GET', `/api/admin/shearing/${id}/history`);
    for (const row of rows) {
      const title = document.createElement('h3');
      title.textContent = `${dateText(row.recorded_at)} — ${row.source === 'stale-push' ? 'Corrección local descartada (versión más antigua)' : row.source === 'admin' ? 'Administrador' : 'Galpón'}`;
      const data = document.createElement('pre'); data.textContent = JSON.stringify({ antes: row.before_row, despues: row.after_row }, null, 2);
      $('history-rows').append(title, data);
    }
  } catch (error) { $('history-rows').textContent = error.message; }
}
async function loadRanch(initial = false) {
  if (loadingRanch) { refreshRequested = true; return; }
  loadingRanch = true;
  try {
    const server = new URL(location.href).searchParams.get('server');
    ranchInfo = await api('GET', `/api/admin/ranch${server ? `?server=${encodeURIComponent(server)}` : ''}`);
    configurationUI.setServers(ranchInfo.servers);
    if (initial) $('ranch-day').value = ranchInfo.day;
    $('ranch-servers').replaceChildren();
    for (const server of ranchInfo.servers) {
      const item = document.createElement('li');
      const info = server.information;
      const stale = !server.received_at || Date.parse(ranchInfo.serverTime) - Date.parse(server.received_at) > 180000;
      item.textContent = `${server.name} — ${server.pending_to_ranch} cambios de nube pendientes en este galpón (incluye eliminaciones) — ${stale ? 'Sin contacto reciente / datos posiblemente atrasados' : 'Contacto reciente'} — ${dateText(server.received_at || server.last_seen_at)}. ` +
        (info ? `${info.hostname} · ${info.platform} · v${info.version} · modo ${info.mode} · encendido ${Math.floor(info.uptime / 60)} min · ${info.pending} cambios locales pendientes.` : 'Actualiza la aplicación del galpón para informar su estado y recibir cambios.');
      $('ranch-servers').append(item);
    }
    if (!ranchInfo.servers.length) $('ranch-servers').textContent = 'No hay un servidor del galpón inscrito. Los cambios quedarán pendientes.';
    const query = new URLSearchParams({ day: $('ranch-day').value, tag: $('ranch-tag').value, offset: recordOffset, deleted: $('ranch-deleted').checked ? '1' : '0' });
    const data = await api('GET', `/api/admin/shearing?${query}`);
    $('ranch-rows').replaceChildren();
    for (const record of data.rows) {
      const row = document.createElement('tr');
      const pending = !ranchInfo.servers.length || ranchInfo.servers.some(s => !s.applied_revision || BigInt(s.applied_revision) < BigInt(record.revision));
      row.append(...[dateText(record.date), record.tag, stationName(record.station), record.type, record.color, record.woolQuality, record.lactation,
        `${record.deleted_at ? 'Eliminado · ' : ''}${pending ? 'Pendiente en galpón' : 'Recibido en galpón'}`].map(cell));
      const actions = cell('');
      if (!record.deleted_at) actions.append(button('Editar', () => openRecord('edit', record)), button('Eliminar', () => openRecord('delete', record)));
      actions.append(button('Historial', () => history(record.id)));
      row.append(actions); $('ranch-rows').append(row);
    }
    const stations = new Map();
    for (let i = 1; i <= selectedShearers().length; i++) if (selectedShearers()[i - 1].active !== false) stations.set(i, {});
    for (const total of data.totals) { if (!stations.has(total.station)) stations.set(total.station, {}); stations.get(total.station)[total.type] = total.count; }
    $('ranch-totals').replaceChildren();
    let sum = 0;
    for (const [station, counts] of [...stations].sort((a, b) => a[0] - b[0])) {
      const total = Object.values(counts).reduce((a, b) => a + b, 0); sum += total;
      const row = document.createElement('tr'); row.append(...[stationName(station), counts.oveja || 0, counts.carnero || 0, counts.borrega || 0, total].map(cell)); $('ranch-totals').append(row);
    }
    $('ranch-summary').textContent = `Total del monitor: ${sum}. Registros encontrados: ${data.total}. Mostrando ${data.rows.length ? recordOffset + 1 : 0}–${recordOffset + data.rows.length}.`;
    $('ranch-prev').disabled = recordOffset === 0; $('ranch-next').disabled = recordOffset + data.rows.length >= data.total;
    $('ranch-error').textContent = '';
  } catch (error) { $('ranch-error').textContent = `No se pudo actualizar. Los datos visibles pueden estar atrasados. ${error.message}`; }
  finally { loadingRanch = false; if (refreshRequested) { refreshRequested = false; loadRanch(); } }
}
async function sendRecord(body) {
  if (savingRecord) return;
  savingRecord = true; $('record-save').disabled = true;
  try {
    // Persist the exact intent before sending; reloading can safely retry a lost response.
    localStorage.setItem(attemptKey, JSON.stringify(body));
    const result = await api('POST', '/api/admin/shearing', body);
    localStorage.removeItem(attemptKey);
    $('ranch-editor').close();
    $('ranch-result').replaceChildren(document.createTextNode('Guardado en la nube. Pendiente de confirmación del galpón en la próxima sincronización. '), button('Ver historial del cambio', () => history(result.id)));
    await loadRanch();
  } catch (error) {
    $('editor-error').textContent = error.message;
    $('ranch-result').replaceChildren(document.createTextNode(`No se confirmó el cambio: ${error.message}. `), button('Reintentar mismo cambio', () => sendRecord(body)));
  } finally { savingRecord = false; $('record-save').disabled = false; }
}
$('record-form').addEventListener('submit', event => {
  event.preventDefault();
  const fields = {};
  if (editing.action !== 'delete') for (const key of ['tag','station','type','color','woolQuality','lactation']) fields[key] = $(`record-${key}`).value;
  const intent = { ...editing, ...fields };
  const prior = JSON.parse(localStorage.getItem(attemptKey) || 'null');
  const same = prior && JSON.stringify({ ...prior, submissionId: undefined }) === JSON.stringify(intent);
  sendRecord({ ...intent, submissionId: same ? prior.submissionId : crypto.randomUUID() });
});
$('record-type').addEventListener('change', () => recordFields());
$('record-cancel').addEventListener('click', () => $('ranch-editor').close());
$('history-close').addEventListener('click', () => $('ranch-history').close());
$('ranch-add').addEventListener('click', () => ranchInfo && openRecord('add'));
$('ranch-filters').addEventListener('submit', event => { event.preventDefault(); recordOffset = 0; loadRanch(); });
$('ranch-prev').addEventListener('click', () => { recordOffset = Math.max(0, recordOffset - 100); loadRanch(); });
$('ranch-next').addEventListener('click', () => { recordOffset += 100; loadRanch(); });
loadRanch(true);
try {
  const pending = JSON.parse(localStorage.getItem(attemptKey) || 'null');
  if (pending) $('ranch-result').append(document.createTextNode('Hay un cambio sin confirmación. '), button('Reintentar mismo cambio', () => sendRecord(pending)));
} catch { $('ranch-error').textContent = 'No se pudo leer el intento guardado en este navegador.'; }
setInterval(() => { if (!document.hidden && !$('ranch-editor').open) loadRanch(); }, 10000);
