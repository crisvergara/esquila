import { modeIdForType } from './modes.js';
// Portable, bounded survey data shared by the cloud, barn, and browser.
export const MAX_QUESTIONS = 24;
const fail = message => { throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const text = (value, max) => typeof value === 'string' && !!value.trim() && value.length <= max && !/[\u0000-\u001f]/.test(value);
const size = value => new TextEncoder().encode(JSON.stringify(value)).length;
export function validateQuestions(rows = []) {
  if (!Array.isArray(rows) || rows.length > MAX_QUESTIONS) fail(`Configura hasta ${MAX_QUESTIONS} preguntas (incluidas las retiradas).`);
  const result = rows.map(q => {
    if (!object(q) || !identifier(q.field) || !text(q.display, 160) ||
        (q.active !== undefined && typeof q.active !== 'boolean') ||
        (q.required !== undefined && typeof q.required !== 'boolean')) fail('Pregunta inválida.');
    const type = q.type || 'choice';
    const question = { field: q.field, display: q.display.trim(), type, required: q.required !== false, active: q.active !== false };
    if (type === 'choice') {
      if (!Array.isArray(q.options) || !q.options.length || q.options.length > 64) fail('Configura entre 1 y 64 respuestas por pregunta.');
      question.options = q.options.map(o => {
        if (!object(o) || typeof o.value !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(o.value) || !text(o.name, 80) || (o.active !== undefined && typeof o.active !== 'boolean')) fail('Respuesta inválida.');
        return { value: o.value, name: o.name.trim(), active: o.active !== false };
      });
      if (new Set(question.options.map(o => o.value)).size !== question.options.length || !question.options.some(o => o.active)) fail('Las respuestas deben ser únicas y conservar una opción activa.');
    } else if (type === 'number') {
      for (const key of ['min', 'max']) if (q[key] != null) {
        if (typeof q[key] !== 'number' || !Number.isFinite(q[key]) || Math.abs(q[key]) > 1e9) fail('Límite numérico inválido.');
        question[key] = q[key];
      }
      if (question.min > question.max) fail('El mínimo debe ser menor o igual al máximo.');
    } else if (type === 'text') {
      question.maxLength = q.maxLength ?? 500;
      if (!Number.isInteger(question.maxLength) || question.maxLength < 1 || question.maxLength > 500) fail('El texto admite entre 1 y 500 caracteres.');
    } else fail('Tipo de pregunta desconocido.');
    // These identifiers are permanent compatibility projections, not new fields.
    if (['woolQuality', 'lactation'].includes(q.field) && type !== 'choice') fail('Conserva el tipo de las preguntas históricas; crea otra pregunta para cambiarlo.');
    return question;
  });
  if (new Set(result.map(q => q.field)).size !== result.length) fail('Hay identificadores de pregunta repetidos.');
  if (size(result) > 24000) fail('La encuesta es demasiado grande. Reduce las preguntas o respuestas.');
  return result;
}
export function questionsFor(modes, type) {
  return validateQuestions(modes.find(m => m.type === modeIdForType(type))?.surveySchema || [])
    .filter(q => q.active).map(q => ({ ...q, ...(q.options ? { options: q.options.filter(o => o.active) } : {}) }));
}
export function validateResponses(questions, input, { historical = false } = {}) {
  if (!object(input) || Object.keys(input).some(key => !questions.some(q => q.field === key))) fail('La encuesta contiene respuestas desconocidas.');
  const result = {};
  for (const q of questions) {
    const value = input[q.field] ?? null;
    if (value === null || value === '') {
      if (q.required && !historical) fail(`Falta responder: ${q.display}.`);
      result[q.field] = null;
    } else if (q.type === 'choice') {
      if (typeof value !== 'string' || !q.options.some(o => o.value === value)) fail(`Respuesta inválida: ${q.display}.`);
      result[q.field] = value;
    } else if (q.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9 || (q.min != null && value < q.min) || (q.max != null && value > q.max)) fail(`Número fuera de rango: ${q.display}.`);
      result[q.field] = value;
    } else {
      if (typeof value !== 'string' || value.length > q.maxLength || /[\u0000-\u0008\u000b-\u001f]/.test(value)) fail(`Texto inválido: ${q.display}.`);
      result[q.field] = value.trim() || null;
      if (!result[q.field] && q.required && !historical) fail(`Falta responder: ${q.display}.`);
    }
  }
  return result;
}
export function validateSurvey(value) {
  if (!object(value) || value.schemaVersion !== 1 || (value.legacy !== undefined && typeof value.legacy !== 'boolean') || size(value) > 32768) fail('Encuesta guardada inválida.');
  const questions = validateQuestions(value.questions);
  const responses = validateResponses(questions, value.responses, { historical: value.legacy === true });
  return { schemaVersion: 1, ...(value.legacy ? { legacy: true } : {}), questions, responses };
}
export function createSurvey(modes, type, body, old = null) {
  // Corrections always use the questions collected at occurrence time, even if
  // the animal type or the current manifest has since changed.
  const original = old?.survey || (old?.survey_json ? JSON.parse(old.survey_json) : old ? legacySurvey(old) : null);
  const questions = original?.questions || questionsFor(modes, type);
  const responses = body.surveyResponses === undefined
    ? Object.fromEntries(questions.map(q => [q.field, ['woolQuality', 'lactation'].includes(q.field) && Object.hasOwn(body, q.field) ? body[q.field] : original?.responses[q.field] ?? null]))
    : body.surveyResponses;
  return validateSurvey({ schemaVersion: 1, ...(original?.legacy ? { legacy: true } : {}), questions, responses });
}
const legacyQuestions = [
  { field: 'woolQuality', display: 'Calidad', options: [{ name: 'Malo', value: 'BAD' }, { name: 'Bueno', value: 'GOOD' }, { name: 'Excelente', value: 'EXCELLENT' }, { name: 'No sé', value: 'IDK' }] },
  { field: 'lactation', display: 'Lactante', options: [{ name: 'OK', value: 'OK' }, { name: 'Seca', value: 'dry' }, { name: 'No sé', value: 'idk' }] },
];
export function legacySurvey(row, prior = null) {
  const survey = prior ? structuredClone(prior) : { schemaVersion: 1, legacy: true, questions: row.type === 'oveja' || row.type == null ? validateQuestions(legacyQuestions) : [], responses: {} };
  for (const q of survey.questions) {
    if (!['woolQuality', 'lactation'].includes(q.field)) continue;
    const value = (q.field === 'woolQuality' ? row.woolQuality ?? row.wool_quality : row.lactation) ?? null;
    // Historical unknown values must survive migration byte for byte. Their
    // labels cannot be reconstructed; show the stored value explicitly.
    if (value != null && !q.options.some(o => o.value === value)) q.options.push({ value, name: String(value), active: true });
    survey.responses[q.field] = value;
  }
  return survey;
}
export function legacyFields(survey) {
  return { woolQuality: Object.hasOwn(survey.responses, 'woolQuality') ? survey.responses.woolQuality : 'IDK', lactation: Object.hasOwn(survey.responses, 'lactation') ? survey.responses.lactation : 'idk' };
}
export function answerText(q, value, translate = text => text) {
  return value == null ? translate('Sin respuesta') : (q.type || 'choice') === 'choice' ? q.options.find(o => o.value === value)?.name || String(value) : String(value);
}
export function surveyText(survey, translate = text => text) {
  return survey?.questions.map(q => `${q.display}: ${answerText(q, survey.responses[q.field], translate)}`).join('\n') || translate('Sin encuesta');
}
export function defaultResponses(questions) {
  return Object.fromEntries(questions.map(q => [q.field, q.type === 'choice' && q.required ? q.options[0]?.value ?? null : null]));
}
