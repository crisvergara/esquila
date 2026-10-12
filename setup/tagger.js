import '../shared/page-language.js';
import { t } from '../shared/browser-language.js';
const urlElement = document.getElementById('tagger-url');
const alternativeElement = document.getElementById('alternative');
const statusElement = document.getElementById('status');
const qrElement = document.getElementById('tagger-qr');
const monitorUrlElement = document.getElementById('monitor-url');
const monitorQrElement = document.getElementById('monitor-qr');
const monitorAlternativeElement = document.getElementById('monitor-alternative');
const networkElement = document.getElementById('network');
let selectedAddress = '';
let refreshing = false;
let refreshAgain = false;
let lastUrl;

function clearConnection(message) {
  for (const image of [qrElement, monitorQrElement]) { image.hidden = true; image.removeAttribute('src'); }
  for (const link of [urlElement, monitorUrlElement]) { link.removeAttribute('href'); link.textContent = t('Dirección no disponible'); }
  alternativeElement.textContent = '';
  monitorAlternativeElement.textContent = '';
  statusElement.textContent = message;
}

async function refreshConnection() {
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try {
    const response = await fetch(`/tagger-info?${new URLSearchParams({ address: selectedAddress })}`, {
      cache: 'no-store', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(t('No se pudo obtener la dirección del tagger.'));
    const { url, friendlyUrl, qrDataUrl, addresses, mobileMonitorUrl, mobileMonitorQrDataUrl, friendlyMobileMonitorUrl } = await response.json();
    networkElement.replaceChildren(new Option(t('Automática'), ''));
    for (const entry of addresses || []) networkElement.add(new Option(`${entry.address} (${entry.interface})`, entry.address));
    if (!(addresses || []).some(entry => entry.address === selectedAddress)) selectedAddress = '';
    networkElement.value = selectedAddress;
    networkElement.disabled = !addresses?.length;
    if (!url || !qrDataUrl || !mobileMonitorUrl || !mobileMonitorQrDataUrl) {
      clearConnection(t('No hay una dirección de red local. Conecta este Mac al WiFi del galpón, aunque esa red no tenga internet. Una VPN no reemplaza esa conexión.'));
      return;
    }
    if (qrElement.src !== qrDataUrl) qrElement.src = qrDataUrl;
    qrElement.hidden = false;
    urlElement.textContent = url;
    urlElement.href = url;
    if (monitorQrElement.src !== mobileMonitorQrDataUrl) monitorQrElement.src = mobileMonitorQrDataUrl;
    monitorQrElement.hidden = false;
    monitorUrlElement.textContent = mobileMonitorUrl;
    monitorUrlElement.href = mobileMonitorUrl;
    monitorAlternativeElement.textContent = friendlyMobileMonitorUrl ? t`Dirección alternativa: ${friendlyMobileMonitorUrl}` : '';
    alternativeElement.textContent = friendlyUrl && friendlyUrl !== url ? t`Dirección alternativa: ${friendlyUrl}` : '';
    statusElement.textContent = lastUrl && lastUrl !== url
      ? t('La dirección cambió. Escanea el código que necesitas nuevamente; un acceso guardado con la dirección anterior puede dejar de funcionar.')
      : t('Códigos listos para la red local. Escanea uno y comprueba que aparezcan los esquiladores.');
    lastUrl = url;
  } catch (error) {
    clearConnection(t`No se pudo contactar al servidor local de Esquila. ${error.message} No necesitas internet. Se reintentará automáticamente; también puedes pulsar Actualizar conexión.`);
  } finally {
    refreshing = false;
    if (refreshAgain) { refreshAgain = false; refreshConnection(); }
  }
}
networkElement.addEventListener('change', () => {
  selectedAddress = networkElement.value;
  clearConnection(t('Actualizando conexión…'));
  refreshConnection();
});
document.getElementById('refresh').addEventListener('click', refreshConnection);
window.addEventListener('focus', refreshConnection);
window.addEventListener('online', refreshConnection);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshConnection(); });
setInterval(() => { if (!document.hidden) refreshConnection(); }, 5000);
refreshConnection();
