import { readFileSync } from 'node:fs';
export const shearingModes = JSON.parse(readFileSync(new URL('../tagger/modeschema.json', import.meta.url), 'utf8'));
export function validateShearingFields(body, stationCount, modes = shearingModes, old = null, shearers = []) {
  const station = Number(body?.station);
  if (!body || !Number.isInteger(station) || station < 1 || (station > stationCount && station !== old?.station) ||
    (shearers[station - 1]?.active === false && station !== old?.station)) return 'Estación inválida.';
  if (typeof body.tag !== 'string') return 'Código inválido.';
  if (body.type === 'borrega') {
    return /^L\d{4,10}$/.test(body.tag) && body.color === 'none' && body.woolQuality === 'IDK' && body.lactation === 'idk'
      ? null : 'Datos de cordero inválidos.';
  }
  const mode = modes.find(m => m.type === body.type && !m.bulk);
  const sameType = old?.type === body.type;
  if (!mode || (!mode.tagSchema.colors.some(c => c.value === body.color && c.active !== false) && !(sameType && body.color === old.color))) return 'Tipo o color inválido.';
  const [prefixes, digits] = mode.tagSchema.textSchema;
  const prefix = [...prefixes.options].filter(p => p.active !== false).sort((a, b) => b.value.length - a.value.length).find(p => body.tag.startsWith(p.value));
  const number = prefix ? body.tag.slice(prefix.value.length) : '';
  if (!(sameType && body.tag === old.tag) && (!/^\d+$/.test(number) || number.length < digits.min || number.length > digits.max)) return `Usa un prefijo válido y ${digits.min}–${digits.max} dígitos.`;
  for (const survey of mode.surveySchema || []) {
    if (!survey.options.some(o => o.value === body[survey.field] && o.active !== false) && !(sameType && body[survey.field] === old[survey.field])) return `Respuesta inválida: ${survey.display}.`;
  }
  if (body.type === 'carnero' && (body.woolQuality !== 'IDK' || body.lactation !== 'idk')) return 'El carnero no requiere respuestas de lana ni lactancia.';
  return null;
}
