import { questionsFor, defaultResponses, surveyText } from '/surveys.js';
import { $, api, cell, node, button, options, dateText } from '/admin-ui.js';
import { updateNavigation } from '/admin-shell.js';
let ranchInfo, editing, recordSurvey, savingRecord = false, loading = false;
let currentRows = [];
let loadGeneration = 0;
const attemptKey = 'esquila-admin-record-attempt';
const selectedShearers = () => ranchInfo?.configuration?.shearers || ranchInfo?.servers.find(s => s.id === ranchInfo.selectedId)?.information?.shearers || [];
const stationName = station => `${station}: ${selectedShearers()[station - 1]?.name || 'Sin nombre'}`;
const keys = ['server','tag','sort','from','to','station','type','color','sync','limit'];
let filters = { day: '', server: '', tag: '', sort: 'newest', from: '', to: '', station: '', type: '', color: '', sync: '', deleted: '0', limit: '50', offset: '0' };
function restoreFilters() {
  const query = new URL(location.href).searchParams;
  for (const key of Object.keys(filters)) if (query.has(key)) filters[key] = query.get(key);
  if (filters.day) { filters.from = filters.day; filters.to = filters.day; filters.day = ''; }
  for (const key of keys) {
    const input = $(`ranch-${key}`);
    if (input.tagName === 'SELECT' && filters[key] && ![...input.options].some(o => o.value === filters[key])) input.add(new Option(filters[key], filters[key]));
    input.value = filters[key];
  }
  $('ranch-deleted').checked = filters.deleted === '1';
  $('record-filter-details').open = ['from','to','station','type','color','sync'].some(k => filters[k]) || filters.deleted === '1';
}
function saveUrl(push = false) {
  const query = new URLSearchParams(Object.entries(filters).filter(([key, value]) => value && key !== 'day' && !(key === 'offset' && value === '0') && !(key === 'deleted' && value === '0')));
  window.history[push ? 'pushState' : 'replaceState'](null, '', `/admin/records${query.size ? `?${query}` : ''}`);
  updateNavigation(filters.server);
}
function readFilters() { for (const key of keys) filters[key] = $(`ranch-${key}`).value; filters.deleted = $('ranch-deleted').checked ? '1' : '0'; filters.offset = '0'; }
function renderRows() {
  $('ranch-rows').replaceChildren();
  for (const record of currentRows) {
    const row = node('tr'); row.dataset.id = record.id;
    const date = cell(dateText(record.date)); date.append(node('small', record.last_uploaded_at ? `Carga: ${dateText(record.last_uploaded_at)}` : record.origin === 'cloud-admin' ? 'Agregado en la nube' : 'Carga histórica no registrada'));
    const code = cell(''); code.append(node('span', record.tag, 'record-code'));
    const kind = cell({ oveja:'Oveja',carnero:'Carnero',borrega:'Cordero' }[record.type] || record.type);
    const color = ranchInfo.modes.flatMap(m => m.tagSchema?.colors || []).find(c => c.value === record.color);
    kind.append(node('small', color?.name || record.color));
    const source = cell(record.servers.length ? record.servers.map(s => s.name + (s.revoked ? ' (revocado)' : '')).join(', ') : 'Sin servidor identificado');
    if (record.origin === 'cloud-admin') source.append(node('small', 'Agregado en la nube'));
    const status = cell(''); status.append(node('span', record.pending_to_ranch ? 'Pendiente en galpón' : 'Recibido en galpón', `badge ${record.pending_to_ranch ? 'pending' : 'received'}`));
    if (record.deleted_at) status.append(node('small','Eliminado', 'badge deleted'));
    const actions = cell(''); const controls = node('div', null, 'record-actions');
    if (!record.deleted_at) controls.append(button('Editar', () => prepareRecord('edit', record)), button('Eliminar', () => prepareRecord('delete', record)));
    controls.append(button('Historial', () => history(record.id))); actions.append(controls);
    row.append(date, code, cell(filters.server === ranchInfo.selectedId ? stationName(record.station) : `Estación ${record.station}`), kind, source, status, actions);
    ['Esquila / carga (Chile)', 'Código', 'Estación', 'Tipo / color', 'Servidor', 'Sincronización', 'Acciones'].forEach((label, i) => { row.children[i].dataset.label = label; });
    $('ranch-rows').append(row);
  }
}
async function loadRecords() {
  const generation = ++loadGeneration;
  const requested = { ...filters };
  loading = true;
  const controls = [...$('ranch-filters').querySelectorAll('input,select,button'), ...$('ranch-rows').querySelectorAll('button'), $('ranch-limit'), $('ranch-add'), $('ranch-prev'), $('ranch-next')];
  controls.forEach(c => { c.disabled = true; }); $('ranch-rows').setAttribute('aria-busy', 'true');
  try {
    const data = await api('GET', `/api/admin/shearing?${new URLSearchParams(requested)}`);
    if (generation !== loadGeneration) return;
    const selected = data.servers.find(s => s.id === requested.server && !s.revoked)?.id;
    const info = await api('GET', `/api/admin/ranch${selected ? `?server=${selected}` : ''}`);
    if (generation !== loadGeneration) return;
    ranchInfo = info;
    currentRows = data.rows; filters.offset = String(data.offset); saveUrl(); updateNavigation(selected);
    options('ranch-server', [{ value:'',name:'Todos los servidores e históricos' },{value:'unknown',name:'Históricos sin servidor identificado'}, ...data.servers.map(s => ({value:s.id,name:s.name + (s.revoked ? ' (revocado)' : '')}))], filters.server);
    const stations = Array.from({ length: Math.min(24, Math.max(selectedShearers().length, ...currentRows.map(r => r.station), 6)) }, (_,i) => ({value:String(i+1),name: selected ? stationName(i+1) : `Estación ${i+1}`}));
    options('ranch-station', [{value:'',name:'Todas las estaciones'}, ...stations], filters.station);
    const colors = new Map(ranchInfo.modes.flatMap(m => m.tagSchema?.colors || []).map(c => [c.value,c.name]));
    data.colors.forEach(c => { if (!colors.has(c)) colors.set(c,c); }); if (filters.color && !colors.has(filters.color)) colors.set(filters.color, filters.color);
    options('ranch-color', [{value:'',name:'Todos los colores'}, ...[...colors].map(([value,name])=>({value,name}))], filters.color);
    renderRows();
    $('ranch-summary').textContent = `${data.total} registros · Mostrando ${data.rows.length ? data.offset + 1 : 0}–${data.offset + data.rows.length}.`;
    $('ranch-page').textContent = `Página ${Math.floor(data.offset / data.limit) + 1} de ${Math.max(1, Math.ceil(data.total / data.limit))}`;
    $('ranch-empty').hidden = data.rows.length > 0;
    $('ranch-scope').textContent = filters.server && filters.server !== 'unknown' ? 'Registros enviados por este servidor o agregados para él desde la nube. Los históricos sin identificación siguen disponibles en «Todos los servidores e históricos». El rancho sigue compartiendo y sincronizando todos sus registros.' : 'Los registros antiguos no siempre identifican su servidor. Se conservan aquí sin atribuirlos a un galpón por suposición.';
    $('ranch-filter-summary').textContent = filters.from || filters.to ? `${filters.from || 'Inicio'} → ${filters.to || 'Hoy'}` : 'Todas las fechas';
    $('ranch-error').textContent = '';
    controls.forEach(c => { c.disabled = false; });
    $('ranch-prev').disabled = data.offset === 0; $('ranch-next').disabled = data.offset + data.rows.length >= data.total;
  } catch (error) {
    if (generation !== loadGeneration) return;
    $('ranch-error').textContent = `No se pudo actualizar. Los datos visibles pueden estar atrasados. ${error.message}`;
    controls.forEach(c => { c.disabled = false; }); $('ranch-prev').disabled = true; $('ranch-next').disabled = true; $('ranch-add').disabled = !ranchInfo;
  } finally { if (generation === loadGeneration) { loading = false; $('ranch-rows').removeAttribute('aria-busy'); } }
}
async function prepareRecord(action, row = {}) {
  if (loading) return;
  try {
    if (localStorage.getItem(attemptKey)) throw new Error('Primero reintenta el cambio sin confirmación. Así evitamos perder una corrección.');
    const selected = row.servers?.find(s => s.id === filters.server && !s.revoked) || row.servers?.find(s => !s.revoked);
    if (selected) ranchInfo = await api('GET', `/api/admin/ranch?server=${selected.id}`);
    openRecord(action, row);
  } catch (error) { $('ranch-error').textContent = error.message; }
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
  const questions = row.survey?.questions || questionsFor(ranchInfo.modes, $('record-type').value);
  recordSurvey = row.survey ? structuredClone(row.survey) : { schemaVersion: 1, questions, responses: defaultResponses(questions) };
  $('record-survey').replaceChildren();
  for (const q of questions) {
    const label = document.createElement('label'); label.append(document.createTextNode(q.display));
    const input = document.createElement(q.type === 'choice' ? 'select' : 'input');
    input.setAttribute('aria-label', q.display); input.required = q.required && !recordSurvey.legacy;
    if (q.type === 'choice') {
      for (const o of [{ value: '', name: 'Sin respuesta' }, ...q.options]) {
        const option = document.createElement('option'); option.value = o.value; option.textContent = o.name; input.append(option);
      }
    } else {
      input.type = q.type === 'number' ? 'number' : 'text'; input.step = 'any'; input.maxLength = q.maxLength || 500;
      if (q.min != null) input.min = q.min; if (q.max != null) input.max = q.max;
    }
    input.value = recordSurvey.responses[q.field] ?? '';
    input.oninput = () => { recordSurvey.responses[q.field] = input.value === '' ? null : q.type === 'number' ? Number(input.value) : input.value; };
    label.append(input); $('record-survey').append(label);
  }
  if (editing.action === 'edit') {
    const note = document.createElement('p'); note.textContent = recordSurvey.legacy ? 'Encuesta histórica importada. Los valores se conservaron; los nombres personalizados de esa fecha no estaban guardados.' : 'Estas preguntas corresponden a la esquila original, aunque la configuración haya cambiado.'; $('record-survey').append(note);
  }

}
function openRecord(action, row = {}) {
  editing = { action, ...(action === 'add' ? { configurationRevision: ranchInfo.configurationRevision } : {}), ...(ranchInfo.selectedId ? { serverId: ranchInfo.selectedId } : {}), ...(row.id ? { id: row.id, updated_at: row.updated_at } : {}) };
  if (localStorage.getItem(attemptKey)) { $('ranch-error').textContent = 'Primero reintenta el cambio sin confirmación.'; return; }
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
      const entry = node('article', null, 'history-entry'), comparison = node('div', null, 'history-comparison');
      for (const [label, value] of [['Antes', row.before_row], ['Después', row.after_row]]) {
        const panel = node('div'); panel.append(node('strong', label));
        panel.append(node('p', value ? `${value.tag} · Estación ${value.station} · ${value.type} · ${value.color}\n${value.deleted_at ? 'Eliminado' : 'Vigente'} · Esquila: ${dateText(value.occurred_at)}\n${surveyText(value.survey)}` : 'No existía este registro.'));
        comparison.append(panel);
      }
      entry.append(title, comparison); $('history-rows').append(entry);
    }
  } catch (error) { $('history-rows').textContent = error.message; }
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
    await loadRecords();
  } catch (error) {
    $('editor-error').textContent = error.message;
    if (error.status >= 400 && error.status < 500) {
      localStorage.removeItem(attemptKey);
      $('ranch-result').textContent = `No se guardó el cambio: ${error.message}`;
      if (error.status === 409 || error.status === 404) await loadRecords();
    } else {
      $('ranch-result').replaceChildren(document.createTextNode(`No se confirmó el cambio: ${error.message}. `), button('Reintentar mismo cambio', () => sendRecord(body)));
      $('ranch-editor').close();
      for (const field of $('record-form').querySelectorAll('input,select')) field.disabled = true;
      $('record-save').textContent = 'Reintentar mismo cambio';
    }
  } finally { savingRecord = false; $('record-save').disabled = false; }
}
$('record-form').addEventListener('submit', event => {
  event.preventDefault();
  const pending = JSON.parse(localStorage.getItem(attemptKey) || 'null');
  if (pending) { sendRecord(pending); return; }
  const fields = {};
  if (editing.action !== 'delete') for (const key of ['tag','station','type','color']) fields[key] = $(`record-${key}`).value;
  if (editing.action !== 'delete') fields.surveyResponses = { ...recordSurvey.responses };
  const intent = { ...editing, ...fields };
  const prior = JSON.parse(localStorage.getItem(attemptKey) || 'null');
  const same = prior && JSON.stringify({ ...prior, submissionId: undefined }) === JSON.stringify(intent);
  sendRecord({ ...intent, submissionId: same ? prior.submissionId : crypto.randomUUID() });
});
$('record-type').addEventListener('change', () => recordFields(editing.action === 'edit' ? { survey: recordSurvey } : {}));
$('record-cancel').addEventListener('click', () => $('ranch-editor').close());
$('history-close').addEventListener('click', () => $('ranch-history').close());
$('ranch-add').addEventListener('click', () => ranchInfo && openRecord('add'));
$('ranch-filters').onsubmit = event => { event.preventDefault(); readFilters(); saveUrl(true); loadRecords(); };
$('ranch-limit').onchange = () => { readFilters(); saveUrl(true); loadRecords(); };
$('ranch-prev').onclick = () => { filters.offset = String(Math.max(0, Number(filters.offset) - Number(filters.limit))); saveUrl(true); loadRecords(); };
$('ranch-next').onclick = () => { filters.offset = String(Number(filters.offset) + Number(filters.limit)); saveUrl(true); loadRecords(); };
$('ranch-reset').onclick = () => { for (const key of Object.keys(filters)) filters[key] = key === 'sort' ? 'newest' : key === 'limit' ? '50' : key === 'offset' || key === 'deleted' ? '0' : ''; window.history.pushState(null, '', '/admin/records'); restoreFilters(); loadRecords(); };
$('ranch-today').onclick = () => { $('ranch-from').value = ranchInfo.day; $('ranch-to').value = ranchInfo.day; $('record-filter-details').open = true; readFilters(); saveUrl(true); loadRecords(); };
window.addEventListener('popstate', () => { for (const key of Object.keys(filters)) filters[key] = key === 'sort' ? 'newest' : key === 'limit' ? '50' : key === 'offset' || key === 'deleted' ? '0' : ''; restoreFilters(); loadRecords(); });
restoreFilters(); await loadRecords();
try {
  const pending = JSON.parse(localStorage.getItem(attemptKey) || 'null');
  if (pending) $('ranch-result').append(document.createTextNode('Hay un cambio sin confirmación. '), button('Reintentar mismo cambio', () => sendRecord(pending)));
} catch { $('ranch-error').textContent = 'No se pudo leer el intento guardado en este navegador.'; }
