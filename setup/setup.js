import '../shared/page-language.js';
import { t, errorText } from '../shared/browser-language.js';

  const $ = (id) => document.getElementById(id);
  let selectedSsid = null;
  let selectedSecured = true;

  function show(stepId) {
    document.querySelectorAll(".step").forEach((s) => s.classList.remove("active"));
    $(stepId).classList.add("active");
  }

  async function api(method, path, body) {
    const res = await fetch(path, {
      method, signal: AbortSignal.timeout(10000),
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && errorText(data.error)) || ("Error " + res.status));
    return data;
  }

  async function loadModes() {
    $('local-mode').disabled = $('save-mode').disabled = $('refresh-modes').disabled = true;
    try {
      const state = await api('GET', '/mode');
      $('local-mode').replaceChildren(...state.modes.map(mode => { const option = document.createElement('option'); option.value = mode.type; option.textContent = mode.name; return option; }));
      $('local-mode').value = state.mode;
      $('local-mode').disabled = $('save-mode').disabled = false;
      $('mode-status').textContent = t('Modo actual: ') + $('local-mode').selectedOptions[0].textContent;
    } catch { $('mode-status').textContent = t('No se pudo leer el modo. Reintenta con Actualizar lista.'); }
    finally { $('refresh-modes').disabled = false; }
  }
  $('refresh-modes').onclick = loadModes;
  $('save-mode').onclick = async () => {
    $('local-mode').disabled = $('save-mode').disabled = $('refresh-modes').disabled = true;
    try {
      await api('POST', '/mode', { mode: $('local-mode').value });
      $('mode-status').textContent = t('Modo guardado. Se usará con el próximo animal, sin reiniciar.');
    } catch (e) { $('mode-status').textContent = t('No se confirmó el cambio. Actualiza la lista para comprobarlo. ') + errorText(e.message); }
    finally { $('local-mode').disabled = $('save-mode').disabled = $('refresh-modes').disabled = false; }
  };
  loadModes();

  // ---- Paso 1: WiFi ----
  async function refreshState() {
    try {
      const state = await api("GET", "/setup/state");
      const pill = (text, connected = false) => { const node = document.createElement('span'); node.className = connected ? 'pill ok' : 'pill'; node.textContent = text; return node; };
      if (!state.wifiAvailable) {
        $("wifi-controls").style.display = "none";
        $("wifi-unavailable").style.display = "block";
        $("wifi-current").replaceChildren(pill(state.online === true ? t('Conectado a Internet') : t('Estado de red desconocido'), state.online === true));
      } else if (state.currentSsid) {
        $("wifi-current").replaceChildren(pill(t('Conectado a: ') + state.currentSsid, true));
        if (state.online === false) $("wifi-current").append(pill(t('sin salida a Internet')));
      } else $("wifi-current").replaceChildren(pill(t('Sin conexión WiFi')));
      renderShearers(state.shearers.map((s) => s.name));
      if (state.configurationManaged) {
        $('shearer-status').textContent = t('Los esquiladores se administran en la nube. La copia local funciona sin internet.');
        for (const input of $('shearer-list').querySelectorAll('input, button')) input.disabled = true;
        $('btn-add-shearer').disabled = true;
        $('btn-save-shearers').textContent = t('Continuar →');
        $('btn-save-shearers').onclick = () => show('step-done');
      }
    } catch (e) {
      $("wifi-current").textContent = t("No se pudo leer el estado");
      renderShearers(["", "", ""]);
    }
  }

  $("btn-scan").onclick = async () => {
    const st = $("wifi-status");
    st.className = "status busy";
    st.textContent = t("Buscando redes (puede tardar unos segundos)...");
    $("btn-scan").disabled = true;
    try {
      const { networks } = await api("POST", "/setup/wifi/scan");
      const list = $("net-list");
      list.innerHTML = "";
      if (networks.length === 0) {
        st.className = "status err";
        st.textContent = t("No se encontraron redes. Intenta de nuevo.");
      } else {
        st.textContent = "";
        for (const n of networks) {
          const b = document.createElement("button");
          b.className = "net";
          const name = document.createElement('span'), signal = document.createElement('span');
          name.textContent = (n.secured ? '🔒 ' : '') + n.ssid;
          signal.className = 'signal'; signal.textContent = n.signal + '%';
          b.append(name, signal);
          b.onclick = () => {
            document.querySelectorAll(".net").forEach((x) => x.classList.remove("selected"));
            b.classList.add("selected");
            selectedSsid = n.ssid;
            selectedSecured = n.secured;
            $("password-row").style.display = "flex";
            $("wifi-password").style.display = n.secured ? "block" : "none";
            if (n.secured) $("wifi-password").focus();
          };
          list.appendChild(b);
        }
      }
    } catch (e) {
      st.className = "status err";
      st.textContent = t("Error al buscar: ") + errorText(e.message);
    }
    $("btn-scan").disabled = false;
  };

  $("btn-connect").onclick = async () => {
    if (!selectedSsid) return;
    const st = $("wifi-status");
    st.className = "status busy";
    st.textContent = t("Conectando a ") + selectedSsid + "...";
    $("btn-connect").disabled = true;
    try {
      await api("POST", "/setup/wifi/connect", {
        ssid: selectedSsid,
        password: selectedSecured ? $("wifi-password").value : "",
      });
      st.className = "status ok";
      st.textContent = t("✓ Conectado a ") + selectedSsid;
      $("btn-wifi-next").className = "";
      refreshState();
    } catch (e) {
      st.className = "status err";
      st.textContent = t("No se pudo conectar. Revisa la contraseña e intenta de nuevo.");
    }
    $("btn-connect").disabled = false;
  };

  // ---- Paso 2: Esquiladores ----
  function renderShearers(names) {
    const list = $("shearer-list");
    list.innerHTML = "";
    names.forEach((name, i) => {
      const row = document.createElement("div");
      row.className = "shearer-row";
      row.innerHTML = '<span class="num">' + (i + 1) + "</span>";
      const input = document.createElement("input");
      input.value = name;
      input.placeholder = t("Nombre del esquilador...");
      row.appendChild(input);
      const del = document.createElement("button");
      del.className = "small secondary";
      del.textContent = "✕";
      del.onclick = () => {
        if (list.children.length > 1) row.remove();
        renumber();
      };
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  function renumber() {
    [...$("shearer-list").children].forEach((row, i) => {
      row.querySelector(".num").textContent = i + 1;
    });
  }

  $("btn-add-shearer").onclick = () => {
    if ($("shearer-list").children.length >= 6) return;
    const names = currentNames();
    names.push("");
    renderShearers(names);
    const inputs = $("shearer-list").querySelectorAll("input");
    inputs[inputs.length - 1].focus();
  };

  function currentNames() {
    return [...$("shearer-list").querySelectorAll("input")].map((i) => i.value);
  }

  $("btn-save-shearers").onclick = async () => {
    const names = currentNames().map((n) => n.trim()).filter(Boolean);
    const st = $("shearer-status");
    if (names.length === 0) {
      st.className = "status err";
      st.textContent = t("Escribe al menos un nombre.");
      return;
    }
    try {
      await api("POST", "/setup/shearers", { names });
      $("summary").textContent =
        t("Estaciones: ") + names.join(", ") + t(". El monitor aparecerá en esta pantalla.");
      show("step-done");
    } catch (e) {
      st.className = "status err";
      st.textContent = t("Error al guardar: ") + errorText(e.message);
    }
  };

  // ---- Navegación ----
  $("btn-wifi-next").onclick = () => show("step-shearers");
  $("btn-back-wifi").onclick = () => show("step-wifi");
  $("btn-back-shearers").onclick = () => show("step-shearers");

  $("btn-finish").onclick = async () => {
    try { await api("POST", "/setup/complete"); } catch (e) {}
    location.href = "/monitor";
  };

  refreshState();
