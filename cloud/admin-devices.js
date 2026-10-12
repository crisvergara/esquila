import { t, errorText, locale } from '/shared/browser-language.js';
import { updateNavigation } from '/admin-shell.js';
import { $, api, cell } from '/admin-ui.js';
async function loadDevices() {
  try {
    const devices = await api("GET", "/api/admin/devices");
    const tbody = $("devices");
    tbody.replaceChildren();
    for (const device of devices) {
      const row = document.createElement("tr");
      row.append(cell(device.name), cell(t(device.role === 'server' ? 'servidor' : 'teléfono')));
      row.append(cell(device.last_seen_at
        ? new Date(device.last_seen_at).toLocaleString(locale, { timeZone: 'America/Santiago' })
        : t("nunca")));
      const action = document.createElement("td");
      const remove = document.createElement("button");
      remove.className = "danger";
      remove.textContent = t("Eliminar");
      remove.addEventListener("click", () => revoke(device.id));
      action.append(remove);
      row.append(action);
      tbody.append(row);
    }
  } catch (err) {
    $("error").textContent = errorText(err.message);
  }
}

async function createDevice() {
  if ($("create").disabled) return;
  $("error").textContent = "";
  $("create").disabled = true;
  try {
    const device = await api("POST", "/api/admin/devices", {
      name: $("name").value,
      role: $("role").value,
    });
    const qr = $("qr");
    qr.replaceChildren();
    const explanation = document.createElement("p");
    const value = document.createElement("p");
    value.className = "token";
    if (device.role === "server") {
      explanation.textContent = t('Primero publica la configuración de este galpón. Luego copia este token en la configuración de Esquila para descargarla:');
      value.textContent = device.token;
      const link = document.createElement('a'); link.href = `/admin/configuration?server=${device.id}`; link.textContent = t('Configurar este galpón');
      link.target = '_blank'; link.rel = 'noopener';
      explanation.textContent += t(' La configuración se abre en otra pestaña para conservar este token visible.');
      qr.append(explanation, value, link);
    } else {
      explanation.textContent = t`Escanéalo con el teléfono de ${device.name}:`;
      const image = document.createElement("img");
      image.src = device.qrDataUrl;
      image.alt = t("Código QR de inscripción");
      value.textContent = device.enrollUrl;
      qr.append(explanation, image, value);
    }
    $("name").value = "";
    await loadDevices();

  } catch (err) {
    $("error").textContent = errorText(err.message);
  } finally { $("create").disabled = false; }
}

async function revoke(id) {
  if (!confirm(t("¿Revocar este dispositivo? Perderá acceso a la nube. Los registros se conservan."))) return;
  $("error").textContent = "";
  try {
    await api("DELETE", `/api/admin/devices/${encodeURIComponent(id)}`);
    const url = new URL(location.href);
    if (url.searchParams.get('server') === id) { url.searchParams.delete('server'); window.history.replaceState(null,'',url); updateNavigation(null); }
    await loadDevices();

  } catch (err) {
    $("error").textContent = errorText(err.message);
  }
}


$("create").onclick = createDevice;
loadDevices();
