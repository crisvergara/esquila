import { editableMode, findMode } from './modes.js';
import { createSurvey } from './surveys.js';
import { readFileSync } from 'node:fs';
export const shearingModes = JSON.parse(readFileSync(new URL('../tagger/modeschema.json', import.meta.url), 'utf8'));
export function validateShearingFields(body, stationCount, modes = shearingModes, old = null, shearers = []) {
  const station = Number(body?.station);
  if (!body || !Number.isInteger(station) || station < 1 || (station > stationCount && station !== old?.station) ||
    (shearers[station - 1]?.active === false && station !== old?.station)) return 'Estación inválida.';
  if (typeof body.tag !== 'string') return 'Código inválido.';
  try { createSurvey(modes, body.type, body, old); } catch (error) { return error.message; }
  const sameType = old?.type === body.type;
  const mode = sameType ? editableMode(modes, old) : findMode(modes, body.type);
  if (!mode || (!sameType && mode.active === false)) return 'Modo de conteo inválido o retirado.';
  if (mode.bulk) return /^L\d{4,10}$/.test(body.tag) && body.color === 'none' ? null : 'Datos de conteo por cantidad inválidos.';
  if (!mode.tagSchema) return sameType && body.tag === old.tag && body.color === old.color ? null : 'El modo original no tiene reglas de caravana. Selecciona un modo vigente.';
  if (!mode.tagSchema.colors.some(c => c.value === body.color && c.active !== false) && !(sameType && body.color === old.color)) return 'Tipo o color inválido.';
  const [prefixes, digits] = mode.tagSchema.textSchema;
  const prefix = [...prefixes.options].filter(p => p.active !== false).sort((a, b) => b.value.length - a.value.length).find(p => body.tag.startsWith(p.value));
  const number = prefix ? body.tag.slice(prefix.value.length) : '';
  if (!(sameType && body.tag === old.tag) && (!/^\d+$/.test(number) || number.length < digits.min || number.length > digits.max)) return `Usa un prefijo válido y ${digits.min}–${digits.max} dígitos.`;
  return null;
}
