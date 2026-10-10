import { localizeStaticPage } from '../shared/browser-language.js';
localizeStaticPage();
import { t, errorText } from '../shared/browser-language.js';
const element = id => document.getElementById(id);
const busy = state => ['checking', 'downloading', 'installing'].includes(state.phase);
function render(state) {
  const labels = { idle: t('Busca una nueva versión.'), checking: t('Buscando actualizaciones…'), current: t('Ya tienes la versión más reciente.'), available: t('Hay una actualización disponible.'), downloading: t('Descargando actualización…'), ready: t('Actualización descargada y verificada.'), installing: t('Preparando instalación. Esquila se reiniciará…'), error: errorText(state.error) };
  element('status').textContent = labels[state.phase];
  const percent = state.total ? Math.floor(state.received / state.total * 100) : 0;
  element('progress').value = percent;
  element('progress').hidden = !['downloading', 'error'].includes(state.phase) || !state.total;
  element('detail').textContent = state.total ? t`${percent}% · ${(state.received / 1048576).toFixed(1)} de ${(state.total / 1048576).toFixed(1)} MB` : state.release ? t`Versión ${state.release.version} (${state.release.build})` : '';
  element('download').hidden = !state.release || busy(state) || state.phase === 'ready';
  element('download').textContent = state.phase === 'error' ? t('Reintentar / continuar descarga') : t('Descargar actualización');
  element('pause').hidden = state.phase !== 'downloading';
  element('install').hidden = state.phase !== 'ready';
  element('install').textContent = state.automatic ? t('Instalar y reiniciar') : t('Abrir instalador…');
  element('check').disabled = busy(state) || state.phase === 'ready';
}
window.updates.subscribe(render);
window.updates.state().then(render);
for (const action of ['download', 'pause', 'install', 'check']) element(action).onclick = () => window.updates.action(action).catch(() => { element('status').textContent = t('No se pudo completar la acción. Reabre esta ventana e intenta nuevamente.'); });
