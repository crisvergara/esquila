const namesContainer = document.getElementById("names");
const status = document.getElementById("status");
const urlInput = document.getElementById('sync-url');
const tokenInput = document.getElementById('sync-token');
const preview = document.getElementById('configuration-preview');
let settingsLoaded = false;
let savedConnection = '';
let confirmedConnection = '';
let confirmedDeviceId = null;
let configured = false;
let loading = false;
const connection = () => JSON.stringify([urlInput.value.trim(), tokenInput.value.trim()]);

function updateForm() {
  const remote = Boolean(urlInput.value.trim());
  document.getElementById('local-stations').hidden = remote;
  for (const input of namesContainer.querySelectorAll('input')) input.disabled = remote;
  document.getElementById('load-configuration').disabled = !settingsLoaded || !remote || loading;
  document.getElementById('save').disabled = !settingsLoaded || loading || (remote && !(configured && connection() === savedConnection) && connection() !== confirmedConnection);
  document.getElementById('open-admin').hidden = !configured || connection() !== savedConnection;
}
function showManifest(manifest) {
  preview.replaceChildren();
  const title = document.createElement('h3'); title.textContent = manifest.configuration.name;
  const summary = document.createElement('p');
  summary.textContent = `Revisión ${manifest.revision} · ${manifest.configuration.shearers.filter(s => s.active !== false).length} estaciones activas. Esta configuración queda guardada para trabajar sin internet.`;
  const list = document.createElement('ul');
  manifest.configuration.shearers.forEach((s, index) => { if (s.active !== false) { const item = document.createElement('li'); item.textContent = `${index + 1}. ${s.name}`; list.append(item); } });
  preview.append(title, summary, list);
}
for (const input of [urlInput, tokenInput]) input.addEventListener('input', () => {
  confirmedConnection = ''; confirmedDeviceId = null; preview.replaceChildren(); updateForm();
});
document.getElementById('load-configuration').onclick = async () => {
  const requestedConnection = connection();
  loading = true; updateForm(); status.textContent = 'Cargando desde la nube…';
  try {
    const result = await window.esquila.previewConfiguration({ cloudSyncUrl: urlInput.value, cloudSyncToken: tokenInput.value });
    if (requestedConnection !== connection()) return;
    confirmedConnection = requestedConnection; confirmedDeviceId = result.manifest.deviceId;
    showManifest(result.manifest); status.textContent = 'Revisa el galpón y sus estaciones antes de guardar.';
  } catch (error) { status.textContent = error.message; }
  finally { loading = false; updateForm(); }
};
document.getElementById('open-admin').onclick = () => window.esquila.openAdmin().catch(error => { status.textContent = error.message; });

function addName(value = "") {
  if (namesContainer.children.length >= 6) return;
  const row = document.createElement("div");
  row.className = "name";
  row.innerHTML = `<span class="num"></span><input class="name-input" maxlength="80" required /><button type="button" class="danger" title="Eliminar">−</button>`;
  row.querySelector("input").value = value;
  row.querySelector("button").onclick = () => {
    if (namesContainer.children.length > 1) row.remove();
    renumber();
  };
  namesContainer.appendChild(row);
  renumber();
}

function renumber() {
  [...namesContainer.children].forEach((row, index) => { row.querySelector(".num").textContent = `${index + 1}.`; });
  document.getElementById("add").disabled = namesContainer.children.length >= 6;
}

document.getElementById("add").onclick = () => addName();

window.esquila.loadSettings().then((settings) => {
  document.getElementById("sync-url").value = settings.cloudSyncUrl || (settings.configured ? '' : 'https://esquila-cloud.fly.dev');
  document.getElementById("app-url").value = settings.cloudAppUrl;
  document.getElementById("login").checked = settings.configured ? settings.openAtLogin : true;
  document.getElementById("token-hint").textContent = settings.hasCloudSyncToken
    ? "Ya hay un token guardado. Déjalo vacío para conservarlo."
    : "Copia aquí el token de tipo servidor creado en la nube.";
  const names = settings.shearers.length ? settings.shearers.map((s) => s.name) : ["", "", ""];
  names.forEach(addName);
  configured = settings.configured;
  savedConnection = connection();
  settingsLoaded = true;
  if (settings.manifest) showManifest(settings.manifest);
  updateForm();
}).catch((error) => { status.textContent = error.message; });

document.getElementById("form").onsubmit = async (event) => {
  event.preventDefault();
  status.textContent = "Guardando…";
  document.getElementById("save").disabled = true;
  try {
    await window.esquila.saveSettings({
      names: [...document.querySelectorAll(".name-input")].map((input) => input.value),
      cloudSyncUrl: document.getElementById("sync-url").value,
      cloudSyncToken: document.getElementById("sync-token").value,
      cloudAppUrl: document.getElementById("app-url").value,
      openAtLogin: document.getElementById("login").checked,
      confirmedDeviceId,
    });
  } catch (error) {
    status.textContent = error.message;
    document.getElementById("save").disabled = false;
  }
};
updateForm();
