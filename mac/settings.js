const namesContainer = document.getElementById("names");
const status = document.getElementById("status");

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
  document.getElementById("sync-url").value = settings.cloudSyncUrl;
  document.getElementById("app-url").value = settings.cloudAppUrl;
  document.getElementById("login").checked = settings.configured ? settings.openAtLogin : true;
  document.getElementById("token-hint").textContent = settings.hasCloudSyncToken
    ? "Ya hay un token guardado. Déjalo vacío para conservarlo."
    : "Copia aquí el token de tipo servidor creado en la nube.";
  const names = settings.shearers.length ? settings.shearers.map((s) => s.name) : ["", "", ""];
  names.forEach(addName);
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
    });
  } catch (error) {
    status.textContent = error.message;
    document.getElementById("save").disabled = false;
  }
};
