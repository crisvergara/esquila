import { languages, normalizeLanguage, translate, translateError, dateLocale } from './i18n.js';
// Preferences belong to the operator's browser, independently of ranch manifests.
// Mac windows receive the saved native preference through the local URL only.
const path = globalThis.location?.pathname || '';
export const surface = /\/tagger(?:\/|$)/.test(path) ? 'tagger' : /\/admin(?:[/-]|$)|\/login/.test(path) ? 'admin' : 'server';
const storageKey = `esquila-language-${surface}`;
function readLanguage() {
  const query = new URLSearchParams(globalThis.location?.search || '').get('lang');
  if (Object.hasOwn(languages, query)) return query;
  try { return normalizeLanguage(localStorage.getItem(storageKey)); } catch { return 'es'; }
}
export const language = readLanguage();
export const t = (source, ...values) => translate(language, source, ...values);
export const errorText = message => translateError(language, message);
export const locale = dateLocale(language);
export function saveLanguage(value) {
  if (!Object.hasOwn(languages, value)) throw new Error('Unsupported language');
  // A denied write is shown to the operator; never pretend the setting persisted.
  localStorage.setItem(storageKey, value);
}
export function changeLanguage(value) {
  saveLanguage(value);
  const url = new URL(location.href); url.searchParams.delete('lang');
  location.assign(url.href);
}
export function languagePicker(container = document.querySelector('main') || document.body) {
  const label = document.createElement('label'); label.className = 'language-picker';
  label.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;font:16px system-ui;margin:12px 0;';
  const title = document.createElement('span'); title.textContent = window.esquila?.setLanguage ? 'Idioma del Mac / Mac language' : 'Idioma / Language';
  const select = document.createElement('select'); select.setAttribute('aria-label', title.textContent);
  select.style.cssText = 'font:inherit;min-height:44px;width:auto;max-width:100%;padding:8px;color:#161b22;background:#fff;border:1px solid #8495a4;border-radius:6px;';
  for (const [value, name] of Object.entries(languages)) select.add(new Option(name, value));
  select.value = language;
  const status = document.createElement('span'); status.setAttribute('role', 'alert'); status.hidden = true;
  select.onchange = async () => {
    if (!confirm(t('Cambiar el idioma recarga esta pantalla. Guarda o termina los cambios en curso antes de continuar. ¿Cambiar idioma?'))) { select.value = language; return; }
    select.disabled = true;
    const controls = [...document.querySelectorAll('form button, form input, form select')].filter(node => !node.disabled && node !== select);
    controls.forEach(node => { node.disabled = true; });
    try {
      if (window.esquila?.setLanguage) { await window.esquila.setLanguage(select.value); const url = new URL(location.href); url.searchParams.set('lang', select.value); location.assign(url.href); }
      else changeLanguage(select.value);
    } catch { status.hidden = false; status.textContent = t('No se pudo guardar el idioma. Revisa los permisos de almacenamiento e inténtalo de nuevo.'); select.value = language; }
    finally { select.disabled = false; controls.forEach(node => { node.disabled = false; }); }
  };
  label.append(title, select, status);
  const note = document.createElement('small'); note.style.cssText = 'flex-basis:100%;font-size:13px;line-height:1.4;';
  note.textContent = window.esquila?.setLanguage
    ? t('El idioma del Mac se aplica al menú y a las ventanas que abras después. El registro de animales tiene su propio idioma.')
    : t('Este idioma se guarda solo en este navegador. Las preguntas y los nombres se muestran tal como fueron configurados.');
  if (window.esquila?.setLanguage) label.append(note);
  container.prepend(label);
  return label;
}
// Run once, before any server/ranch content is rendered. No observer or fuzzy
// matching: user names, survey labels, codes, and snapshots are never translated.
export function localizeStaticPage() {
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.parentElement.closest('script,style,textarea,code,pre')) node.nodeValue = t(node.nodeValue);
  }
  for (const element of document.querySelectorAll('[aria-label],[title],[placeholder],[alt]')) {
    for (const attribute of ['aria-label', 'title', 'placeholder', 'alt']) if (element.hasAttribute(attribute)) element.setAttribute(attribute, t(element.getAttribute(attribute)));
  }
  document.documentElement.lang = language;
}
if (globalThis.document) document.documentElement.lang = language;
