const element = id => document.getElementById(id);
const busy = state => ['checking', 'downloading', 'installing'].includes(state.phase);
function render(state) {
  const labels = { idle: 'Busca una nueva versión.', checking: 'Buscando actualizaciones…', current: 'Ya tienes la versión más reciente.', available: 'Hay una actualización disponible.', downloading: 'Descargando actualización…', ready: 'Actualización descargada y verificada.', installing: 'Preparando instalación. Esquila se reiniciará…', error: state.error };
  element('status').textContent = labels[state.phase];
  const percent = state.total ? Math.floor(state.received / state.total * 100) : 0;
  element('progress').value = percent;
  element('progress').hidden = !['downloading', 'error'].includes(state.phase) || !state.total;
  element('detail').textContent = state.total ? `${percent}% · ${(state.received / 1048576).toFixed(1)} de ${(state.total / 1048576).toFixed(1)} MB` : state.release ? `Versión ${state.release.version} (${state.release.build})` : '';
  element('download').hidden = !state.release || busy(state) || state.phase === 'ready';
  element('download').textContent = state.phase === 'error' ? 'Reintentar / continuar descarga' : 'Descargar actualización';
  element('pause').hidden = state.phase !== 'downloading';
  element('install').hidden = state.phase !== 'ready';
  element('install').textContent = state.automatic ? 'Instalar y reiniciar' : 'Abrir instalador…';
  element('check').disabled = busy(state) || state.phase === 'ready';
}
window.updates.subscribe(render);
window.updates.state().then(render);
for (const action of ['download', 'pause', 'install', 'check']) element(action).onclick = () => window.updates.action(action).catch(() => { element('status').textContent = 'No se pudo completar la acción. Reabre esta ventana e intenta nuevamente.'; });
