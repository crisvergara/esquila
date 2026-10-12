import english from './locales/en.js';
import spanish from './locales/es.js';
export const languages = Object.freeze({ es: 'Español', en: 'English' });
export const normalizeLanguage = value => typeof value === 'string' && Object.hasOwn(languages, value) ? value : 'es';
export const dateLocale = language => normalizeLanguage(language) === 'en' ? 'en-GB' : 'es-CL';
const keyOf = value => value.trim().replace(/[ \t\r\n]+/g, ' ');
const catalogs = Object.fromEntries(Object.entries({ en: english, es: spanish }).map(([language, messages]) => [language,
  Object.fromEntries(Object.entries(messages).map(([key, value]) => [keyOf(key), value]))]));
// Interpolate once: a value containing {0}, markup, or another language's text
// remains data. Callers render as text (or through React), never as HTML.
export function translate(language, source, ...values) {
  const template = Array.isArray(source) ? source.map((s, i) => s + (i < values.length ? `{${i}}` : '')).join('') : String(source);
  const catalog = catalogs[normalizeLanguage(language)], key = keyOf(template);
  const translated = Object.hasOwn(catalog, key) ? catalog[key] : undefined;
  const text = translated === undefined ? template : (template.match(/^\s*/)?.[0] || '') + translated.trim() + (template.match(/\s*$/)?.[0] || '');
  return text.replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index]) : match);
}
const patterns = Object.keys(english).filter(key => /\{\d+\}/.test(key)).map(key => {
  const slots = [];
  const pattern = key.split(/(\{\d+\})/).map(part => /^\{\d+\}$/.test(part)
    ? (slots.push(Number(part.slice(1, -1))), '(.+?)') : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  return { key, slots, expression: new RegExp(`^${pattern}$`, 's') };
});
// Only for system errors crossing API/IPC boundaries, never for ranch data.
export function translateError(language, message) {
  if (typeof message !== 'string' || message.length > 2000) return translate(language, 'No se pudo completar la solicitud. Reintenta.');
  const ipc = /^Error invoking remote method '[^']+': (?:Error: )?([\s\S]+)$/.exec(message);
  if (ipc) return translateError(language, ipc[1]);
  if (Object.hasOwn(catalogs.en, keyOf(message)) || Object.hasOwn(catalogs.es, keyOf(message))) return translate(language, message);
  for (const { key, slots, expression } of patterns) {
    const match = expression.exec(message);
    if (match) { const values = []; slots.forEach((slot, i) => { values[slot] = match[i + 1]; }); return translate(language, key, ...values); }
  }
  return message;
}
