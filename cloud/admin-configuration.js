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
const modeName = { oveja: 'Ovejas', carnero: 'Carneros', carnillero: 'Corderos' };

export function mountRanchConfiguration({ api, onPublished }) {
  const select = document.getElementById('configuration-server');
  const form = document.getElementById('configuration-form');
  const fields = document.getElementById('configuration-fields');
  const status = document.getElementById('configuration-status');
  const error = document.getElementById('configuration-error');
  const retry = document.getElementById('configuration-retry');
  const save = document.getElementById('configuration-save');
  let id, draft, revision = 0, dirty = false, busy = false, generation = 0;
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
      line.append(field('Nombre', row.name, value => change(() => { row.name = value; })));
      if (kind === 'color') {
        line.append(field('Color de fondo', row.color, value => change(() => { row.color = value; preview.style.backgroundColor = value; }), 'color'));
        line.append(field('Color del texto', row.text, value => change(() => { row.text = value; preview.style.color = value; }), 'color'));
        const preview = el('span', 'A12345', 'config-swatch');
        preview.style.backgroundColor = row.color; preview.style.color = row.text;
        line.append(preview);
      }
      if (kind === 'prefix') line.append(el('span', `Prefijo: ${row.value}`, 'muted'));
      line.append(action(row.active === false ? 'Restaurar' : 'Quitar', () => {
        if (row.active !== false && rows.filter(r => r.active !== false).length <= 1) { error.textContent = 'Conserva al menos una opción activa.'; return; }
        change(() => { row.active = row.active === false; }); render();
      }));
      list.append(line);
    }
    group.append(list);
    if (kind === 'prefix') {
      let code = '';
      const newPrefix = field('Nuevo prefijo (letras)', code, value => { code = value.trim().toUpperCase(); });
      newPrefix.querySelector('input').required = false;
      group.append(newPrefix);
      group.append(action('Agregar prefijo', () => {
        if (!/^[A-Z]{1,4}$/.test(code) || rows.some(r => r.value === code)) { error.textContent = 'Usa entre 1 y 4 letras, sin repetir un prefijo existente.'; return; }
        change(() => rows.push({ name: code, value: code, active: true })); render();
      }));
    } else {
      group.append(action(kind === 'color' ? 'Agregar color' : 'Agregar respuesta', () => {
        if (rows.length >= 64) { error.textContent = 'Máximo 64 opciones; puedes restaurar una opción anterior.'; return; }
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
    group.setAttribute('aria-label', `Encuesta ${modeName[mode.type]}`);
    group.append(el('h3', 'Preguntas de la encuesta'), el('p', 'Las preguntas se guardan con cada esquila. Retirarlas o cambiar su nombre no modifica encuestas anteriores. Para cambiar el tipo, retira la pregunta y crea otra.', 'muted'));
    if (mode.bulk) group.append(el('p', 'Las respuestas del lote se guardan en cada cordero. Puedes corregirlas individualmente en Registros.'));
    questions.forEach((q, index) => {
      const item = el('section', '', `config-question${q.active === false ? ' retired' : ''}`);
      item.setAttribute('aria-label', `Pregunta ${index + 1}`);
      const title = field('Pregunta', q.display, value => change(() => { q.display = value; }));
      title.querySelector('input').maxLength = 160;
      item.append(title, el('p', `Tipo: ${{ choice: 'Opciones', text: 'Texto', number: 'Número' }[q.type]}`, 'muted'));
      const required = el('label', 'Respuesta obligatoria'), checkbox = el('input');
      checkbox.type = 'checkbox'; checkbox.checked = q.required;
      checkbox.onchange = () => change(() => { q.required = checkbox.checked; }); required.append(checkbox); item.append(required);
      if (q.type === 'choice') choices(item, q.options, 'Respuestas');
      if (q.type === 'text') {
        const limit = field('Máximo de caracteres', q.maxLength, value => change(() => { q.maxLength = value; }), 'number');
        limit.querySelector('input').max = 500; item.append(limit);
      }
      if (q.type === 'number') for (const [key, label] of [['min', 'Valor mínimo (opcional)'], ['max', 'Valor máximo (opcional)']]) {
        const limit = field(label, q[key] ?? '', () => {}, 'number'), input = limit.querySelector('input');
        input.required = false; input.min = -1e9; input.max = 1e9; input.step = 'any';
        input.oninput = () => change(() => { if (input.value === '') delete q[key]; else q[key] = Number(input.value); });
        item.append(limit);
      }
      const controls = el('div', '', 'row');
      controls.append(action(q.active ? 'Retirar pregunta' : 'Restaurar pregunta', () => { change(() => { q.active = !q.active; }); render(); }));
      for (const [offset, label] of [[-1, 'Subir pregunta'], [1, 'Bajar pregunta']]) {
        const move = action(label, () => { change(() => { [questions[index], questions[index + offset]] = [questions[index + offset], questions[index]]; }); render(); });
        move.disabled = index + offset < 0 || index + offset >= questions.length; controls.append(move);
      }
      item.append(controls); group.append(item);
    });
    const typeLabel = el('label', 'Tipo de nueva pregunta'), type = el('select');
    for (const [value, name] of [['choice', 'Opciones (incluye sí/no)'], ['text', 'Texto'], ['number', 'Número']]) {
      const option = el('option', name); option.value = value; type.append(option);
    }
    typeLabel.append(type);
    const add = action('Agregar pregunta', () => {
      if (questions.length >= MAX_QUESTIONS) { error.textContent = 'Máximo 24 preguntas; restaura una pregunta anterior.'; return; }
      change(() => questions.push({ field: `q_${crypto.randomUUID().replaceAll('-', '')}`, display: 'Nueva pregunta', type: type.value, active: true, required: true,
        ...(type.value === 'choice' ? { options: [{ value: 'yes', name: 'Sí', active: true }, { value: 'no', name: 'No', active: true }] } : type.value === 'text' ? { maxLength: 500 } : {}) }));
      render();
    });
    group.append(typeLabel, add); parent.append(group);
  }
  function render() {
    fields.replaceChildren();
    fields.append(field('Nombre del galpón', draft.name, value => change(() => { draft.name = value; })));
    const stations = el('section');
    stations.append(el('h3', `Esquiladores · ${draft.shearers.filter(s => s.active).length} estaciones activas`),
      el('p', 'Cada número identifica una mesa. Quitar una estación la deja inactiva, sin renumerar las demás ni borrar registros.', 'muted'));
    draft.shearers.forEach((s, index) => {
      const row = el('div', '', `config-choice${s.active === false ? ' retired' : ''}`);
      row.append(field(`Estación ${index + 1}`, s.name, value => change(() => { s.name = value; })), action(s.active === false ? 'Restaurar estación' : 'Quitar estación', () => {
        if (s.active !== false && draft.shearers.filter(s => s.active !== false).length <= 1) { error.textContent = 'Conserva al menos una estación activa.'; return; }
        change(() => { s.active = s.active === false; }); render();
      }));
      stations.append(row);
    });
    const add = action('Agregar estación', () => { change(() => draft.shearers.push({ name: `Estación ${draft.shearers.length + 1}`, active: true })); render(); });
    add.disabled = draft.shearers.length >= MAX_STATIONS;
    stations.append(add); fields.append(stations);
    for (const mode of draft.modes) {
      const section = el('details'); section.open = mode.type === 'oveja';
      section.append(el('summary', modeName[mode.type]));
      if (mode.bulk) section.append(el('p', 'Conteo por cantidad. Los códigos L se asignan automáticamente y conservan su secuencia.'));
      else {
        choices(section, mode.tagSchema.colors, 'Colores de caravana', 'color');
        choices(section, mode.tagSchema.textSchema[0].options, 'Prefijos del código', 'prefix');
        const digits = mode.tagSchema.textSchema[1];
        const row = el('div', '', 'row');
        row.append(field('Mínimo de dígitos', digits.min, v => change(() => { digits.min = v; }), 'number'), field('Máximo de dígitos', digits.max, v => change(() => { digits.max = v; }), 'number'));
        section.append(row);
      }
      surveys(section, mode);
      fields.append(section);
    }
    disable(Boolean(pending()) || busy);
  }
  async function refreshStatus() {
    if (!id) return;
    const selected = id;
    try {
      const data = await api('GET', `/api/admin/ranches/${id}/configuration`);
      if (id !== selected) return;
      status.textContent = !data.revision ? 'Borrador: publica la configuración antes de conectar un Mac nuevo.' :
        `Publicada: revisión ${data.revision}. ${data.appliedRevision === data.revision ? 'Recibida por el galpón.' : `Pendiente en el galpón (recibida: ${data.appliedRevision}). Se aplicará cuando tenga internet.`}`;
      if (data.revision !== revision && dirty) status.textContent += ' Hay una versión más reciente; conserva o copia tus cambios antes de recargar.';
    } catch (e) { status.textContent = `No se pudo comprobar la recepción: ${e.message}`; }
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
      draft = structuredClone(data.configuration); revision = data.revision; dirty = false;
      const attempt = pending();
      if (attempt) { draft = attempt.configuration; revision = attempt.revision; showRetry(attempt); }
      busy = false; render(); await refreshStatus();
    } catch (e) { error.textContent = e.message; }
    finally { if (ticket === generation) { busy = false; select.disabled = false; } }
  }
  function showRetry(body) {
    retry.replaceChildren(el('p', 'Hay una publicación sin confirmar. Reintenta el mismo cambio para comprobar si se guardó.'), action('Reintentar publicación', () => publish(body)));
  }
  async function publish(body) {
    if (busy) return;
    busy = true; disable(true); error.textContent = '';
    try {
      localStorage.setItem(key(), JSON.stringify(body));
      const result = await api('PUT', `/api/admin/ranches/${id}/configuration`, body);
      localStorage.removeItem(key()); retry.replaceChildren();
      revision = result.manifest.revision; draft = result.manifest.configuration; dirty = false;
      await onPublished(id); await refreshStatus();
    } catch (e) {
      error.textContent = e.message;
      if (e.status >= 400 && e.status < 500) { localStorage.removeItem(key()); retry.replaceChildren(); }
      else showRetry(body);
    } finally { busy = false; render(); }
  }
  form.onsubmit = event => {
    event.preventDefault();
    try { publish({ revision, configuration: validateConfiguration({ ...draft, schemaVersion: 2 }), submissionId: crypto.randomUUID() }); }
    catch (e) { error.textContent = e.message; }
  };
  select.onchange = () => {
    if (dirty && !confirm('¿Descartar los cambios sin publicar?')) { select.value = id; return; }
    const url = new URL(location.href); url.searchParams.set('server', select.value); url.hash = 'configuration';
    history.replaceState(null, '', url); load(select.value); onPublished(select.value);
  };
  document.getElementById('configuration-reload').onclick = () => {
    if (busy || (dirty && !confirm('¿Descartar los cambios sin publicar y recargar?'))) return;
    load(id);
  };
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  setInterval(() => { if (!document.hidden && !busy) refreshStatus(); }, 10000);
  return { setServers(servers) {
    const selected = id || new URL(location.href).searchParams.get('server') || servers[0]?.id || '';
    select.replaceChildren(...servers.map(s => { const o = el('option', s.name); o.value = s.id; return o; }));
    if (!servers.some(s => s.id === selected)) { form.hidden = true; status.textContent = 'Selecciona o crea un servidor del galpón.'; return; }
    select.value = selected;
    if (!id) load(selected);
  } };
}
