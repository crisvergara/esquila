const urlElement = document.getElementById('tagger-url');
const alternativeElement = document.getElementById('alternative');
const statusElement = document.getElementById('status');
const qrElement = document.getElementById('tagger-qr');
const networkElement = document.getElementById('network');
let selectedAddress = '';
let refreshing = false;
let refreshAgain = false;
let lastUrl;

function clearConnection(message) {
  qrElement.hidden = true;
  qrElement.removeAttribute('src');
  urlElement.removeAttribute('href');
  urlElement.textContent = 'Dirección no disponible';
  alternativeElement.textContent = '';
  statusElement.textContent = message;
}

async function refreshConnection() {
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try {
    const response = await fetch(`/tagger-info?${new URLSearchParams({ address: selectedAddress })}`, {
      cache: 'no-store', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('No se pudo obtener la dirección del tagger.');
    const { url, friendlyUrl, qrDataUrl, addresses } = await response.json();
    networkElement.replaceChildren(new Option('Automática', ''));
    for (const entry of addresses || []) networkElement.add(new Option(`${entry.address} (${entry.interface})`, entry.address));
    if (!(addresses || []).some(entry => entry.address === selectedAddress)) selectedAddress = '';
    networkElement.value = selectedAddress;
    networkElement.disabled = !addresses?.length;
    if (!url || !qrDataUrl) {
      clearConnection('No hay una dirección de red local. Conecta este Mac al WiFi del galpón; una VPN no reemplaza esa conexión.');
      return;
    }
    if (qrElement.src !== qrDataUrl) qrElement.src = qrDataUrl;
    qrElement.hidden = false;
    urlElement.textContent = url;
    urlElement.href = url;
    alternativeElement.textContent = friendlyUrl && friendlyUrl !== url ? `Dirección alternativa: ${friendlyUrl}` : '';
    statusElement.textContent = lastUrl && lastUrl !== url
      ? 'La dirección cambió. Escanea este código nuevamente; un acceso guardado con la dirección anterior puede dejar de funcionar.'
      : 'Dirección actualizada. La conexión desde el teléfono se confirma cuando aparecen los esquiladores.';
    lastUrl = url;
  } catch (error) {
    clearConnection(`No se pudo verificar la dirección actual. ${error.message} Pulsa Actualizar conexión.`);
  } finally {
    refreshing = false;
    if (refreshAgain) { refreshAgain = false; refreshConnection(); }
  }
}
networkElement.addEventListener('change', () => {
  selectedAddress = networkElement.value;
  clearConnection('Actualizando conexión…');
  refreshConnection();
});
document.getElementById('refresh').addEventListener('click', refreshConnection);
window.addEventListener('focus', refreshConnection);
window.addEventListener('online', refreshConnection);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshConnection(); });
setInterval(() => { if (!document.hidden) refreshConnection(); }, 5000);
refreshConnection();
