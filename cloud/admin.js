const $ = (id) => document.getElementById(id);

async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) {
    location.replace("/admin");
    throw new Error("Sesión vencida");
  }
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error ?? `Error ${response.status}`);
  }
  return response.json();
}

function cell(text) {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

async function loadDevices() {
  try {
    const devices = await api("GET", "/api/admin/devices");
    const tbody = $("devices");
    tbody.replaceChildren();
    for (const device of devices) {
      const row = document.createElement("tr");
      row.append(cell(device.name), cell(device.role));
      row.append(cell(device.last_seen_at
        ? new Date(device.last_seen_at).toLocaleString("es-CL")
        : "nunca"));
      const action = document.createElement("td");
      const remove = document.createElement("button");
      remove.className = "danger";
      remove.textContent = "Eliminar";
      remove.addEventListener("click", () => revoke(device.id));
      action.append(remove);
      row.append(action);
      tbody.append(row);
    }
  } catch (err) {
    $("error").textContent = err.message;
  }
}

async function createDevice() {
  $("error").textContent = "";
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
      explanation.textContent = "Token para el servidor (CLOUD_SYNC_TOKEN):";
      value.textContent = device.token;
      qr.append(explanation, value);
    } else {
      explanation.textContent = `Escanéalo con el teléfono de ${device.name}:`;
      const image = document.createElement("img");
      image.src = device.qrDataUrl;
      image.alt = "Código QR de inscripción";
      value.textContent = device.enrollUrl;
      qr.append(explanation, image, value);
    }
    $("name").value = "";
    await loadDevices();
  } catch (err) {
    $("error").textContent = err.message;
  }
}

async function revoke(id) {
  $("error").textContent = "";
  try {
    await api("DELETE", `/api/admin/devices/${encodeURIComponent(id)}`);
    await loadDevices();
  } catch (err) {
    $("error").textContent = err.message;
  }
}

$("create").addEventListener("click", createDevice);
$("logout").addEventListener("click", async () => {
  await api("POST", "/api/admin/logout");
  location.replace("/admin");
});

loadDevices();
