import { localizeStaticPage, languagePicker } from './browser-language.js';
localizeStaticPage();
languagePicker(document.querySelector('.sidebar') || document.querySelector('main') || document.body);
if (document.body.dataset.screen) document.title = document.querySelector('h1').textContent + ' — Esquila';
