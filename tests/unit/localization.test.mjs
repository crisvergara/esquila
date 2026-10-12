import { test } from 'node:test';
import assert from 'node:assert/strict';
import english from '../../shared/locales/en.js';
import spanish from '../../shared/locales/es.js';
import { normalizeLanguage, translate, translateError, dateLocale } from '../../shared/i18n.js';
import { answerText, surveyText, legacySurvey } from '../../shared/surveys.js';

test('both catalogs preserve every interpolation slot and language fallback', () => {
  const slots = text => [...text.matchAll(/\{(\d+)\}/g)].map(m => m[1]).sort();
  for (const catalog of [english, spanish]) for (const [key, text] of Object.entries(catalog)) {
    assert.ok(text.trim(), key); assert.deepEqual(slots(text), slots(key), key);
  }
  for (const value of ['fr', '__proto__', '', null, undefined, ['en'], {}, 0]) assert.equal(normalizeLanguage(value), 'es');
  assert.equal(translate('en', 'Guardar'), 'Save');
  assert.equal(translateError('en', "Error invoking remote method 'settings:preview': Error: Ingresa el token del servidor."), 'Enter the server token.');
  assert.equal(translate('es', 'Esqilador:'), 'Esquilador:');
  assert.equal(translate('es', 'Elija la primera letra'), 'Elige el prefijo');
  assert.equal(translate('en', ' Modo actual: '), ' Current mode: ');
  for (const key of ['constructor', '__proto__', 'toString']) { assert.equal(translate('en', key), key); assert.equal(translateError('en', key), key); }
  assert.equal(dateLocale('en'), 'en-GB'); assert.equal(dateLocale('es'), 'es-CL');
});
test('system errors translate but interpolation values stay literal and historical surveys stay unchanged', () => {
  const label = 'Guardar {1} <img src=x onerror=alert(1)>';
  assert.equal(translateError('en', `Falta responder: ${label}.`), `Answer required: ${label}.`);
  assert.equal(translate('en', ['Pregunta ', ' de ', ''], '{1}', 2), 'Question {1} of 2');
  const survey = legacySurvey({type:'oveja',woolQuality:'GOOD',lactation:'OK'});
  const original = structuredClone(survey);
  assert.match(surveyText(survey, s => translate('en', s)), /Calidad: Bueno/);
  assert.deepEqual(survey, original);
  assert.equal(answerText({type:'text'}, 'Guardar'), 'Guardar');
  assert.equal(answerText({}, null, s => translate('en', s)), 'No answer');
  assert.equal(surveyText(null, s => translate('en', s)), 'No survey');
});
