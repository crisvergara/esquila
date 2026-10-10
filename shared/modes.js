// Stable mode identity is independent of its editable display name.
export const MAX_MODES = 24;
export const LEGACY_MODE_NAMES = { oveja: 'Ovejas', carnero: 'Carneros', carnillero: 'Corderos' };
export const validModeId = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(value) && !['__proto__', 'constructor', 'prototype', 'borrega'].includes(value);
export const modeIdForType = type => type === 'borrega' ? 'carnillero' : type;
export const recordTypeForMode = mode => mode.type === 'carnillero' ? 'borrega' : mode.type;
const legacyName = id => Object.hasOwn(LEGACY_MODE_NAMES, id) ? LEGACY_MODE_NAMES[id] : null;
export const modeName = mode => mode?.name || legacyName(mode?.type) || mode?.type || 'Sin modo registrado';
export const findMode = (modes, type) => modes.find(m => m.type === modeIdForType(type));
export const modeChoices = (modes, old) => {
  const choices = modes.filter(m => m.active !== false || recordTypeForMode(m) === old?.type)
    .map(m => ({ value: recordTypeForMode(m), name: modeName(m) + (m.active === false ? ' (retirado)' : '') }));
  if (old?.type && !choices.some(c => c.value === old.type)) choices.push({ value: old.type, name: old.mode?.name || old.type });
  return choices;
};
export function legacyMode(row) {
  const id = modeIdForType(row?.type);
  return { id: validModeId(id) ? id : 'unknown', name: legacyName(id) || 'Sin modo registrado', bulk: id === 'carnillero', legacy: true };
}
export function validateRecordedMode(value) {
  const fail = () => { throw new Error('Modo guardado inválido.'); };
  if (!value || !validModeId(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80 || /[\u0000-\u001f]/.test(value.name) || typeof value.bulk !== 'boolean' || (value.legacy !== undefined && typeof value.legacy !== 'boolean')) fail();
  const result = { id: value.id, name: value.name.trim(), bulk: value.bulk, ...(value.legacy ? { legacy: true } : {}) };
  if (!value.bulk && !value.legacy) {
    const r = value.tagRules;
    if (!r || !Number.isInteger(r.min) || !Number.isInteger(r.max) || r.min < 1 || r.max > 10 || r.min > r.max) fail();
    for (const [key, pattern] of [['colors', /^[A-Za-z0-9_-]{1,40}$/], ['prefixes', /^[A-Z]{1,4}$/]]) {
      if (!Array.isArray(r[key]) || !r[key].length || r[key].length > 64 || r[key].some(v => typeof v !== 'string' || !pattern.test(v)) || new Set(r[key]).size !== r[key].length) fail();
    }
    result.tagRules = { colors: [...r.colors], prefixes: [...r.prefixes], min: r.min, max: r.max };
  }
  return result;
}
export function captureMode(mode) {
  return validateRecordedMode({ id: mode.type, name: modeName(mode), bulk: !!mode.bulk,
    ...(!mode.bulk ? { tagRules: {
      colors: mode.tagSchema.colors.filter(c => c.active !== false).map(c => c.value),
      prefixes: mode.tagSchema.textSchema[0].options.filter(p => p.active !== false).map(p => p.value),
      min: mode.tagSchema.textSchema[1].min, max: mode.tagSchema.textSchema[1].max,
    } } : {}) });
}
export function recordedMode(row) {
  return row.mode || (row.mode_json ? JSON.parse(row.mode_json) : legacyMode(row));
}
export function modeForRecord(modes, type, old) {
  if (old?.type === type) return recordedMode(old);
  const mode = findMode(modes, type);
  if (!mode || mode.active === false) throw new Error('Modo de conteo inválido o retirado.');
  return captureMode(mode);
}
export function reconcileRecordedMode(incoming, old, row) {
  const prior = old ? recordedMode(old) : null;
  return !incoming || (incoming.legacy && prior && !prior.legacy) ? prior || legacyMode(row) : validateRecordedMode(incoming);
}
export function editableMode(modes, record) {
  const current = findMode(modes, record?.type);
  if (current) return current;
  if (!record) return null;
  const saved = recordedMode(record), r = saved.tagRules;
  return { type: modeIdForType(record.type), name: saved.name, bulk: saved.bulk, active: false,
    ...(r ? { tagSchema: { colors: r.colors.map(value => ({ value, name: value })), textSchema: [
      { type: 'code', options: r.prefixes.map(value => ({ value, name: value })) }, { type: 'digits', min: r.min, max: r.max },
    ] } } : {}) };
}
