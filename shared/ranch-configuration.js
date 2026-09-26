// This schema is shared by the cloud, barn, and browser. It contains no secrets.
export const MAX_STATIONS = 24;
export const MODE_TYPES = ['oveja', 'carnero', 'carnillero'];
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail = message => { throw new Error(message); };
const text = (value, label, max = 80) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) fail(`${label}: texto inválido.`);
  return value.trim();
};
const active = value => {
  if (value !== undefined && typeof value !== 'boolean') fail('Estado activo inválido.');
  return value !== false;
};
function options(rows, label, color = false, prefix = false) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 64) fail(`${label}: ingresa entre 1 y 64 opciones.`);
  const result = rows.map(row => {
    if (!row || typeof row !== 'object') fail(`${label}: opción inválida.`);
    const value = text(row.value, label, 40);
    if (!(prefix ? /^[A-Z]{1,4}$/ : /^[A-Za-z0-9_-]+$/).test(value)) fail(`${label}: identificador inválido.`);
    const option = { name: text(row.name, label), value, active: active(row.active) };
    if (color) {
      if (![row.color, row.text].every(v => typeof v === 'string' && /^#[a-f0-9]{6}$/i.test(v))) fail('Usa colores hexadecimales de seis dígitos.');
      Object.assign(option, { color: row.color.toLowerCase(), text: row.text.toLowerCase() });
    }
    return option;
  });
  if (new Set(result.map(row => row.value)).size !== result.length) fail(`${label}: hay identificadores repetidos.`);
  if (!result.some(row => row.active)) fail(`${label}: conserva al menos una opción activa.`);
  return result;
}

export function validateConfiguration(input) {
  if (!input || input.schemaVersion !== 1) fail('Versión de configuración no compatible. Actualiza Esquila.');
  if (!Array.isArray(input.shearers) || !input.shearers.length || input.shearers.length > MAX_STATIONS) fail(`Configura entre 1 y ${MAX_STATIONS} estaciones.`);
  const shearers = input.shearers.map(s => ({ name: text(s?.name, 'Esquilador'), active: active(s?.active) }));
  if (!shearers.some(s => s.active)) fail('Conserva al menos una estación activa.');
  if (!Array.isArray(input.modes) || input.modes.length !== 3 || new Set(input.modes.map(m => m?.type)).size !== 3) fail('Se requieren los tres modos de esquila.');
  const modes = MODE_TYPES.map(type => {
    const mode = input.modes.find(m => m?.type === type);
    if (!mode) fail('Modo desconocido.');
    if (type === 'carnillero') {
      if (mode.bulk !== true || mode.tagSchema || mode.surveySchema) fail('El modo corderos debe usar conteo por cantidad.');
      return { type, bulk: true };
    }
    if (mode.bulk) fail('Ovejas y carneros requieren un código individual.');
    const schema = mode.tagSchema;
    if (!Array.isArray(schema?.textSchema) || schema.textSchema.length !== 2 || schema.textSchema[0]?.type !== 'code' || schema.textSchema[1]?.type !== 'digits') fail('Formato de código inválido.');
    const digits = schema.textSchema[1];
    if (!Number.isInteger(digits.min) || !Number.isInteger(digits.max) || digits.min < 1 || digits.max > 10 || digits.min > digits.max) fail('El código debe tener entre 1 y 10 dígitos.');
    const result = { type, tagSchema: {
      colors: options(schema.colors, 'Colores', true),
      textSchema: [{ type: 'code', options: options(schema.textSchema[0].options, 'Prefijos', false, true) }, { type: 'digits', min: digits.min, max: digits.max }],
    } };
    if (type === 'oveja') {
      if (!Array.isArray(mode.surveySchema) || mode.surveySchema.length !== 2) fail('Configura calidad de lana y lactancia para las ovejas.');
      result.surveySchema = ['woolQuality', 'lactation'].map(field => {
        const survey = mode.surveySchema.find(s => s?.field === field);
        if (!survey) fail('Pregunta de esquila inválida.');
        return { field, display: text(survey.display, 'Pregunta'), options: options(survey.options, 'Respuestas') };
      });
    } else if (mode.surveySchema?.length) fail('Los carneros no llevan encuesta.');
    return result;
  });
  return { schemaVersion: 1, name: text(input.name, 'Nombre del galpón'), shearers, modes };
}

// Removing a choice retires it; its stable identifier remains available to history.
export function retainRetiredConfiguration(next, previous) {
  const result = structuredClone(next);
  const retain = (rows, old) => [...rows, ...old.filter(o => !rows.some(n => n.value === o.value)).map(o => ({ ...o, active: false }))];
  for (let i = result.shearers.length; i < previous.shearers.length; i++) result.shearers.push({ ...previous.shearers[i], active: false });
  for (const mode of result.modes.filter(m => m.tagSchema)) {
    const old = previous.modes.find(m => m.type === mode.type);
    mode.tagSchema.colors = retain(mode.tagSchema.colors, old.tagSchema.colors);
    mode.tagSchema.textSchema[0].options = retain(mode.tagSchema.textSchema[0].options, old.tagSchema.textSchema[0].options);
    for (const survey of mode.surveySchema || []) survey.options = retain(survey.options, old.surveySchema.find(s => s.field === survey.field).options);
  }
  return validateConfiguration(result);
}

export function activeModes(modes) {
  return modes.map(mode => mode.bulk ? mode : ({ ...mode, tagSchema: {
    colors: mode.tagSchema.colors.filter(c => c.active !== false),
    textSchema: [{ ...mode.tagSchema.textSchema[0], options: mode.tagSchema.textSchema[0].options.filter(o => o.active !== false) }, mode.tagSchema.textSchema[1]],
  }, ...(mode.surveySchema ? { surveySchema: mode.surveySchema.map(s => ({ ...s, options: s.options.filter(o => o.active !== false) })) } : {}) }));
}

export function validateManifest(value) {
  if (!value || !UUID.test(value.deviceId || '') || !Number.isSafeInteger(value.revision) || value.revision < 1 || !Number.isFinite(Date.parse(value.updatedAt))) fail('Manifiesto inválido.');
  return { deviceId: value.deviceId, revision: value.revision, updatedAt: new Date(value.updatedAt).toISOString(), configuration: validateConfiguration(value.configuration) };
}

export function tagColorStyle(modes, value, type) {
  const color = (modes.find(m => m.type === type)?.tagSchema?.colors || modes.flatMap(m => m.tagSchema?.colors || [])).find(c => c.value === value);
  return color ? { backgroundColor: color.color, color: color.text } : {};
}

// A first enrollment may adopt fewer stations than an older local database.
// Keep those historical counts visible without making their stations selectable.
export function monitorStations(shearers, counts) {
  const rows = new Map(shearers.map((shearer, index) => [index + 1, shearer]));
  for (const station of Object.keys(counts).map(Number)) {
    if (!rows.has(station) && counts[station]?.counted) rows.set(station, { name: `Estación ${station} (histórica)`, active: false });
  }
  return [...rows].filter(([station, shearer]) => shearer.active !== false || counts[station]?.counted)
    .sort(([a], [b]) => a - b).map(([station, shearer]) => ({ station, shearer }));
}
