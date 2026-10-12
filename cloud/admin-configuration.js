import { t, errorText } from '/shared/browser-language.js';
import { MAX_MODES, modeName } from '/modes.js';
import { MAX_QUESTIONS } from '/surveys.js';
import { MAX_STATIONS, validateConfiguration } from '/configuration-schema.js';

const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const action = (text, fn) => { const b = el('button', text); b.type = 'button'; b.onclick = fn; return b; };
function field(label, value, change, type = 'text') {
  const wrap = el('label', label), input = el('input');
  input.type = type; input.value = value; input.required = true; input.maxLength = 80;
  if (type === 'number') { input.min = 1; input.max = 10; }
  input.oninput = () => change(type === 'number' ? Number(input.value) : input.value);
  wrap.append(input); return wrap;
}
const editableConfiguration = c => ({ ...structuredClone(c), schemaVersion: 3, modes: c.modes.map(m => ({ ...structuredClone(m), name: modeName(m), active: m.active !== false, bulk: !!m.bulk })) });

export function mountRanchConfiguration({ api, onPublished }) {
  const select = document.getElementById('configuration-server');
  const form = document.getElementById('configuration-form');
  const fields = document.getElementById('configuration-fields');
  const status = document.getElementById('configuration-status');
  const error = document.getElementById('configuration-error');
  const retry = document.getElementById('configuration-retry');
  const save = document.getElementById('configuration-save');
  let id, draft, revision = 0, dirty = false, busy = false, generation = 0;
  const openModes = new Set(['oveja']);
  const key = () => `esquila-admin-configuration-${id}`;
  function pending() { return JSON.parse(localStorage.getItem(key()) || 'null'); }
  function change(fn) { fn(); dirty = true; }
  function disable(value) { fields.disabled = value; save.disabled = value; select.disabled = busy; }
  function choices(parent, rows, label, kind = 'option') {
    const group = el('section', '', 'config-options');
    group.append(el('h4', label));
    const list = el('div');
    for (const row of rows) {
      const line = el('div', '', `config-choice${row.active === false ? ' retired' : ''}`);
      line.append(field(t('Nombre'), row.name, value => change(() => { row.name = value; })));
      if (kind === 'color') {
        line.append(field(t('Color de fondo'), row.color, value => change(() => { row.color = value; preview.style.backgroundColor = value; }), 'color'));
        line.append(field(t('Color del texto'), row.text, value => change(() => { row.text = value; preview.style.color = value; }), 'color'));
        const preview = el('span', 'A12345', 'config-swatch');
        preview.style.backgroundColor = row.color; preview.style.color = row.text;
        line.append(preview);
      }
      if (kind === 'prefix') line.append(el('span', t`Prefijo: ${row.value}`, 'muted'));
      line.append(action(row.active === false ? t('Restaurar') : t('Quitar'), () => {
        if (row.active !== false && rows.filter(r => r.active !== false).length <= 1) { error.textContent = t('Conserva al menos una opción activa.'); return; }
        change(() => { row.active = row.active === false; }); render();
      }));
      list.append(line);
    }
    group.append(list);
    if (kind === 'prefix') {
      let code = '';
      const newPrefix = field(t('Nuevo prefijo (letras)'), code, value => { code = value.trim().toUpperCase(); });
      newPrefix.querySelector('input').required = false;
      group.append(newPrefix);
      group.append(action(t('Agregar prefijo'), () => {
        if (!/^[A-Z]{1,4}$/.test(code) || rows.some(r => r.value === code)) { error.textContent = t('Usa entre 1 y 4 letras, sin repetir un prefijo existente.'); return; }
        change(() => rows.push({ name: code, value: code, active: true })); render();
      }));
    } else {
      group.append(action(kind === 'color' ? t('Agregar color') : t('Agregar respuesta'), () => {
        if (rows.length >= 64) { error.textContent = t('Máximo 64 opciones; puedes restaurar una opción anterior.'); return; }
        change(() => rows.push({ name: kind === 'color' ? 'Nuevo color' : 'Nueva respuesta', value: `custom_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`, active: true,
          ...(kind === 'color' ? { color: '#25834b', text: '#ffffff' } : {}) })); render();
      }));
    }
    parent.append(group);
  }
  function surveys(parent, mode) {
    mode.surveySchema ||= [];
    for (const q of mode.surveySchema) { q.type ||= 'choice'; q.required ??= true; q.active ??= true; }
    const questions = mode.surveySchema;
    const group = el('section', '', 'config-surveys');
    group.setAttribute('aria-label', t`Encuesta ${modeName(mode)}`);
    group.append(el('h3', t('Preguntas de la encuesta')), el('p', t('Las preguntas se guardan con cada esquila. Retirarlas o cambiar su nombre no modifica encuestas anteriores. Para cambiar el tipo, retira la pregunta y crea otra.'), 'muted'));
    if (mode.bulk) group.append(el('p', t('Las respuestas del lote se guardan en cada animal. Puedes corregirlas individualmente en Registros.')));
    questions.forEach((q, index) => {
      const item = el('section', '', `config-question${q.active === false ? ' retired' : ''}`);
      item.setAttribute('aria-label', t`Pregunta ${index + 1}`);
      const title = field(t('Pregunta'), q.display, value => change(() => { q.display = value; }));
      title.querySelector('input').maxLength = 160;
      item.append(title, el('p', t`Tipo: ${{ choice: t('Opciones'), text: t('Texto'), number: t('Número') }[q.type]}`, 'muted'));
      const required = el('label', t('Respuesta obligatoria')), checkbox = el('input');
      checkbox.type = 'checkbox'; checkbox.checked = q.required;
      checkbox.onchange = () => change(() => { q.required = checkbox.checked; }); required.append(checkbox); item.append(required);
      if (q.type === 'choice') choices(item, q.options, t('Respuestas'));
      if (q.type === 'text') {
        const limit = field(t('Máximo de caracteres'), q.maxLength, value => change(() => { q.maxLength = value; }), 'number');
        limit.querySelector('input').max = 500; item.append(limit);
      }
      if (q.type === 'number') for (const [key, label] of [['min', t('Valor mínimo (opcional)')], ['max', t('Valor máximo (opcional)')]]) {
        const limit = field(label, q[key] ?? '', () => {}, 'number'), input = limit.querySelector('input');
        input.required = false; input.min = -1e9; input.max = 1e9; input.step = 'any';
        input.oninput = () => change(() => { if (input.value === '') delete q[key]; else q[key] = Number(input.value); });
        item.append(limit);
      }
      const controls = el('div', '', 'row');
      controls.append(action(q.active ? t('Retirar pregunta') : t('Restaurar pregunta'), () => { change(() => { q.active = !q.active; }); render(); }));
      for (const [offset, label] of [[-1, t('Subir pregunta')], [1, t('Bajar pregunta')]]) {
        const move = action(label, () => { change(() => { [questions[index], questions[index + offset]] = [questions[index + offset], questions[index]]; }); render(); });
        move.disabled = index + offset < 0 || index + offset >= questions.length; controls.append(move);
      }
      item.append(controls); group.append(item);
    });
    const typeLabel = el('label', t('Tipo de nueva pregunta')), type = el('select');
    for (const [value, name] of [['choice', t('Opciones (incluye sí/no)')], ['text', t('Texto')], ['number', t('Número')]]) {
      const option = el('option', name); option.value = value; type.append(option);
    }
    typeLabel.append(type);
    const add = action(t('Agregar pregunta'), () => {
      if (questions.length >= MAX_QUESTIONS) { error.textContent = t('Máximo 24 preguntas; restaura una pregunta anterior.'); return; }
      change(() => questions.push({ field: `q_${crypto.randomUUID().replaceAll('-', '')}`, display: 'Nueva pregunta', type: type.value, active: true, required: true,
        ...(type.value === 'choice' ? { options: [{ value: 'yes', name: 'Sí', active: true }, { value: 'no', name: 'No', active: true }] } : type.value === 'text' ? { maxLength: 500 } : {}) }));
      render();
    });
    group.append(typeLabel, add); parent.append(group);
  }
  function render() {
    fields.replaceChildren();
    fields.append(field(t('Nombre del galpón'), draft.name, value => change(() => { draft.name = value; })));
    const stations = el('section');
    stations.append(el('h3', t`Esquiladores · ${draft.shearers.filter(s => s.active).length} estaciones activas`),
      el('p', t('Cada número identifica una mesa. Quitar una estación la deja inactiva, sin renumerar las demás ni borrar registros.'), 'muted'));
    draft.shearers.forEach((s, index) => {
      const row = el('div', '', `config-choice${s.active === false ? ' retired' : ''}`);
      row.append(field(t`Estación ${index + 1}`, s.name, value => change(() => { s.name = value; })), action(s.active === false ? t('Restaurar estación') : t('Quitar estación'), () => {
        if (s.active !== false && draft.shearers.filter(s => s.active !== false).length <= 1) { error.textContent = t('Conserva al menos una estación activa.'); return; }
        change(() => { s.active = s.active === false; }); render();
      }));
      stations.append(row);
    });
    const add = action(t('Agregar estación'), () => { change(() => draft.shearers.push({ name: `Estación ${draft.shearers.length + 1}`, active: true })); render(); });
    add.disabled = draft.shearers.length >= MAX_STATIONS;
    stations.append(add); fields.append(stations);
    fields.append(el('h3', t('Modos de conteo')), el('p', t('Crea los modos del galpón y elige el modo activo en la configuración del Mac. Retirar un modo conserva sus registros. El tipo de conteo no cambia después de publicarlo.'), 'muted'));
    const sourceLabel = el('label', t('Copiar configuración de')), source = el('select');
    for (const m of draft.modes) { const option = el('option', `${modeName(m)} · ${m.bulk ? t('Por cantidad') : t('Caravana individual')}`); option.value = m.type; source.append(option); }
    sourceLabel.append(source); fields.append(sourceLabel);
    const addMode = action(t('Agregar modo'), () => {
      change(() => { const copy = structuredClone(draft.modes.find(m => m.type === source.value)); copy.type = `mode_${crypto.randomUUID().replaceAll('-', '')}`; copy.name = 'Nuevo modo'; copy.active = true; draft.modes.push(copy); openModes.add(copy.type); }); render();
    });
    addMode.disabled = draft.modes.length >= MAX_MODES; fields.append(addMode);
    draft.modes.forEach((mode, index) => {
      const section = el('details', '', mode.active === false ? 'retired' : ''); section.open = openModes.has(mode.type);
      section.ontoggle = () => { if (!section.isConnected) return; if (section.open) openModes.add(mode.type); else openModes.delete(mode.type); };
      const heading = el('summary', modeName(mode) + (mode.active === false ? t(' (retirado)') : ''));
      section.append(heading, field(t('Nombre del modo'), mode.name, value => change(() => { mode.name = value; heading.textContent = value + (mode.active === false ? t(' (retirado)') : ''); })));
      const controls = el('div', '', 'row');
      controls.append(action(mode.active === false ? t('Restaurar modo') : t('Retirar modo'), () => {
        if (mode.active !== false && draft.modes.filter(m => m.active !== false).length === 1) { error.textContent = t('Conserva al menos un modo activo.'); return; }
        change(() => { mode.active = mode.active === false; }); render();
      }));
      for (const [offset, label] of [[-1, t('Subir modo')], [1, t('Bajar modo')]]) {
        const move = action(label, () => { change(() => { [draft.modes[index], draft.modes[index + offset]] = [draft.modes[index + offset], draft.modes[index]]; }); render(); });
        move.disabled = index + offset < 0 || index + offset >= draft.modes.length; controls.append(move);
      }
      section.append(controls, el('p', mode.bulk ? t('Por cantidad') : t('Caravana individual'), 'muted'));
      if (mode.bulk) section.append(el('p', t('Conteo por cantidad. Los códigos L se asignan automáticamente y conservan su secuencia.')));
      else {
        choices(section, mode.tagSchema.colors, t('Colores de caravana'), 'color');
        choices(section, mode.tagSchema.textSchema[0].options, t('Prefijos del código'), 'prefix');
        const digits = mode.tagSchema.textSchema[1];
        const row = el('div', '', 'row');
        row.append(field(t('Mínimo de dígitos'), digits.min, v => change(() => { digits.min = v; }), 'number'), field(t('Máximo de dígitos'), digits.max, v => change(() => { digits.max = v; }), 'number'));
        section.append(row);
      }
      surveys(section, mode);
      fields.append(section);
    });
    disable(Boolean(pending()) || busy);
  }
  async function refreshStatus() {
    if (!id) return;
    const selected = id;
    try {
      const data = await api('GET', `/api/admin/ranches/${id}/configuration`);
      if (id !== selected) return;
      status.textContent = !data.revision ? t('Borrador: publica la configuración antes de conectar un Mac nuevo.') :
        t`Publicada: revisión ${data.revision}. ${data.appliedRevision === data.revision ? t('Recibida por el galpón.') : t`Pendiente en el galpón (recibida: ${data.appliedRevision}). Se aplicará cuando tenga internet.`}`;
      if (data.revision !== revision && dirty) status.textContent += t(' Hay una versión más reciente; conserva o copia tus cambios antes de recargar.');
    } catch (e) { status.textContent = t`No se pudo comprobar la recepción: ${errorText(e.message)}`; }
  }
  async function load(nextId) {
    const ticket = ++generation;
    id = nextId; select.value = id;
    if (id) { const url = new URL(location.href); url.searchParams.set('server', id); history.replaceState(null, '', url); }
    form.hidden = !id; error.textContent = ''; retry.replaceChildren();
    if (!id) return;
    busy = true; disable(true);
    try {
      const data = await api('GET', `/api/admin/ranches/${id}/configuration`);
      if (ticket !== generation) return;
      draft = editableConfiguration(data.configuration); revision = data.revision; dirty = false;
      const attempt = pending();
      if (attempt) { draft = editableConfiguration(attempt.configuration); revision = attempt.revision; showRetry(attempt); }
      busy = false; render(); await refreshStatus();
    } catch (e) { error.textContent = errorText(e.message); }
    finally { if (ticket === generation) { busy = false; select.disabled = false; } }
  }
  function showRetry(body) {
    retry.replaceChildren(el('p', t('Hay una publicación sin confirmar. Reintenta el mismo cambio para comprobar si se guardó.')), action(t('Reintentar publicación'), () => publish(body)));
  }
  async function publish(body) {
    if (busy) return;
    busy = true; disable(true); error.textContent = '';
    try {
      localStorage.setItem(key(), JSON.stringify(body));
      const result = await api('PUT', `/api/admin/ranches/${id}/configuration`, body);
      localStorage.removeItem(key()); retry.replaceChildren();
      revision = result.manifest.revision; draft = editableConfiguration(result.manifest.configuration); dirty = false;
      await onPublished(id); await refreshStatus();
    } catch (e) {
      error.textContent = errorText(e.message);
      if (e.status >= 400 && e.status < 500) { localStorage.removeItem(key()); retry.replaceChildren(); }
      else showRetry(body);
    } finally { busy = false; render(); }
  }
  form.onsubmit = event => {
    event.preventDefault();
    try { publish({ revision, configuration: validateConfiguration({ ...draft, schemaVersion: 3 }), submissionId: crypto.randomUUID() }); }
    catch (e) { error.textContent = errorText(e.message); }
  };
  select.onchange = () => {
    if (dirty && !confirm(t('¿Descartar los cambios sin publicar?'))) { select.value = id; return; }
    const url = new URL(location.href); url.searchParams.set('server', select.value); url.hash = 'configuration';
    history.replaceState(null, '', url); load(select.value); onPublished(select.value);
  };
  document.getElementById('configuration-reload').onclick = () => {
    if (busy || (dirty && !confirm(t('¿Descartar los cambios sin publicar y recargar?')))) return;
    load(id);
  };
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  setInterval(() => { if (!document.hidden && !busy) refreshStatus(); }, 10000);
  return { setServers(servers) {
    const selected = id || new URL(location.href).searchParams.get('server') || servers[0]?.id || '';
    select.replaceChildren(...servers.map(s => { const o = el('option', s.name); o.value = s.id; return o; }));
    if (!servers.some(s => s.id === selected)) { form.hidden = true; status.textContent = t('Selecciona o crea un servidor del galpón.'); return; }
    select.value = selected;
    if (!id) load(selected);
  } };
}
