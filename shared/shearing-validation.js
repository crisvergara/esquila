import { readFileSync } from 'node:fs';
export const shearingModes = JSON.parse(readFileSync(new URL('../tagger/modeschema.json', import.meta.url), 'utf8'));
export function validateShearingFields(body, stationCount) {
  if (!body || !Number.isInteger(Number(body.station)) || Number(body.station) < 1 || Number(body.station) > stationCount) return 'Estación inválida.';
  if (typeof body.tag !== 'string') return 'Código inválido.';
  if (body.type === 'borrega') {
    return /^L\d{4,10}$/.test(body.tag) && body.color === 'none' && body.woolQuality === 'IDK' && body.lactation === 'idk'
      ? null : 'Datos de cordero inválidos.';
  }
  const mode = shearingModes.find(m => m.type === body.type && !m.bulk);
  if (!mode || !mode.tagSchema.colors.some(c => c.value === body.color)) return 'Tipo o color inválido.';
  const [prefixes, digits] = mode.tagSchema.textSchema;
  const prefix = [...prefixes.options].sort((a, b) => b.value.length - a.value.length).find(p => body.tag.startsWith(p.value));
  const number = prefix ? body.tag.slice(prefix.value.length) : '';
  if (!/^\d+$/.test(number) || number.length < digits.min || number.length > digits.max) return 'Usa un prefijo válido y 5–6 dígitos.';
  for (const survey of mode.surveySchema || []) {
    if (!survey.options.some(o => o.value === body[survey.field])) return `Respuesta inválida: ${survey.display}.`;
  }
  if (body.type === 'carnero' && (body.woolQuality !== 'IDK' || body.lactation !== 'idk')) return 'El carnero no requiere respuestas de lana ni lactancia.';
  return null;
}
