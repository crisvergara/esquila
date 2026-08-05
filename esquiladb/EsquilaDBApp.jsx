import { useState, useEffect, useMemo, useCallback } from "react";

import "./EsquilaDB.css";
import shearers from "../shearers.json";
import { uuidv7 } from "../shared/uuidv7.js";
import { ranchDay } from "../shared/ranchdate.js";
import {
  AuthError,
  enqueue,
  loadPending,
  loadSnapshot,
  drainOutbox,
  refreshSnapshot,
  getEnrollment,
  saveEnrollment,
  clearEnrollment,
} from "./sync.js";

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("es-CL", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// occurred_on is a plain YYYY-MM-DD ranch-local day; pin it to noon so the
// browser's timezone can't shift it to a neighboring day.
function formatDay(day) {
  if (!day) return "—";
  return formatDate(day + "T12:00:00");
}

function timeAgo(iso) {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} días`;
}

// Overlay pending (not-yet-synced) rows onto the server snapshot: pending
// tombstones hide rows, pending inserts appear flagged with `pending: true`.
function mergeRows(baseRows, pending, table) {
  const byId = new Map(baseRows.map((r) => [r.id, r]));
  for (const entry of pending) {
    if (entry.table !== table) continue;
    if (entry.row.deleted_at) {
      byId.delete(entry.row.id);
    } else {
      byId.set(entry.row.id, { ...entry.row, pending: true });
    }
  }
  return [...byId.values()];
}

function SyncStatusBar({ online, pendingCount, fetchedAt, syncing, onSync }) {
  let dotClass, label;
  if (!online) {
    dotClass = "offline";
    label = fetchedAt ? `Sin conexión · datos ${timeAgo(fetchedAt)}` : "Sin conexión";
  } else if (pendingCount > 0) {
    dotClass = "pending";
    label = `${pendingCount} por sincronizar`;
  } else {
    dotClass = "ok";
    label = syncing ? "Sincronizando..." : "Sincronizado";
  }
  return (
    <button className="Sync-bar" onClick={onSync} title="Sincronizar ahora">
      <span className={`Sync-dot Sync-dot--${dotClass}`} />
      <span className="Sync-label">{label}</span>
    </button>
  );
}

function EnrollScreen({ onEnroll }) {
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  return (
    <>
      <header className="App-header">
        <p>EsquilaDB</p>
      </header>
      <section className="Detail-section Enroll-screen">
        <h3 className="Detail-section-title">Vincular este teléfono</h3>
        <p className="Enroll-help">
          Escanea el código QR de invitación con la cámara, o pega el token aquí:
        </p>
        <input
          className="Treatment-input"
          type="text"
          placeholder="Token de invitación..."
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
        />
        <input
          className="Treatment-input"
          type="text"
          placeholder="Nombre del dispositivo (ej. Teléfono de Papá)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="Treatment-save-btn"
          disabled={!token.trim()}
          onClick={() => onEnroll(token.trim(), name.trim() || "phone")}
        >
          Vincular
        </button>
      </section>
    </>
  );
}

function SheepTable({ sheep, filter, highlightedTag, onHighlight, treatmentCounts }) {
  const query = filter.toUpperCase();
  const filtered = query ? sheep.filter((s) => s.tag.includes(query)) : sheep;

  return (
    <section className="Sheep-list">
      {filtered.length === 0 ? (
        <p style={{ color: "#fff" }}>No se encontró</p>
      ) : (
        <table className="Sheep-table">
          <colgroup>
            <col className="col-dot" />
            <col className="col-tag" />
            <col className="col-tipo" />
            <col className="col-esquilador" />
            <col className="col-estado" />
          </colgroup>
          <thead>
            <tr>
              <th></th>
              <th>Tag</th>
              <th>Tipo</th>
              <th>Esquilador</th>
              <th>Tratam.</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const shearer =
                shearers[s.station - 1]?.name || `Estación ${s.station}`;
              const counts = treatmentCounts[s.tag];
              const hasTreatments = counts && (counts.vaccinations > 0 || counts.dewormings > 0);
              const isHighlighted = highlightedTag === s.tag;
              const rowClass = [
                "Sheep-row",
                isHighlighted && "Sheep-row--selected",
              ]
                .filter(Boolean)
                .join(" ");

              let estadoLabel = "—";
              if (hasTreatments) {
                const parts = [];
                if (counts.vaccinations > 0) parts.push(`${counts.vaccinations}V`);
                if (counts.dewormings > 0) parts.push(`${counts.dewormings}D`);
                estadoLabel = parts.join(" ");
              }

              return (
                <tr
                  key={s.tag}
                  className={rowClass}
                  onClick={() => onHighlight(s)}
                >
                  <td>
                    <span className={`Color-dot Color-dot--${s.color}`} />
                  </td>
                  <td>{s.tag}</td>
                  <td>{s.type}</td>
                  <td>{shearer}</td>
                  <td>
                    <span className={hasTreatments ? "Estado-badge" : "Estado-empty"}>
                      {estadoLabel}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function TreatmentForm({ onSave, onCancel }) {
  const [type, setType] = useState("vaccination");
  const [medication, setMedication] = useState("");
  const [dose, setDose] = useState("");
  const [date, setDate] = useState(() => ranchDay());

  const onSubmit = (e) => {
    e.preventDefault();
    if (!medication.trim()) return;
    onSave({
      type,
      medication: medication.trim(),
      dose: dose.trim(),
      occurredOn: date,
    });
  };

  return (
    <form className="Treatment-form" onSubmit={onSubmit}>
      <h3>Agregar Tratamiento</h3>

      <div className="Treatment-type-toggle">
        <button
          type="button"
          className={`Type-btn ${type === "vaccination" ? "Type-btn--active" : ""}`}
          onClick={() => setType("vaccination")}
        >
          Vacuna
        </button>
        <button
          type="button"
          className={`Type-btn ${type === "deworming" ? "Type-btn--active" : ""}`}
          onClick={() => setType("deworming")}
        >
          Desparasitante
        </button>
      </div>

      <input
        className="Treatment-input"
        type="text"
        placeholder="Nombre del medicamento..."
        value={medication}
        onChange={(e) => setMedication(e.target.value)}
        autoFocus
        autoComplete="off"
        autoCorrect="off"
        spellCheck="false"
      />

      <input
        className="Treatment-input"
        type="text"
        placeholder="Dosis (ej. 2ml, 1 pastilla)..."
        value={dose}
        onChange={(e) => setDose(e.target.value)}
        autoComplete="off"
        autoCorrect="off"
        spellCheck="false"
      />

      <input
        className="Treatment-input"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />

      <div className="Treatment-form-actions">
        <button
          type="submit"
          className="Treatment-save-btn"
          disabled={!medication.trim()}
        >
          Guardar
        </button>
        <button type="button" className="Treatment-cancel-btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function SheepDetailView({ sheep, shearingHistory, treatments, presets, actions, onBack }) {
  const [showForm, setShowForm] = useState(false);

  const onDeleteTreatment = (t) => {
    if (!window.confirm("¿Eliminar este tratamiento?")) return;
    actions.deleteTreatment(t);
  };

  const onApplyPreset = (preset) => {
    actions.addTreatment({
      tag: sheep.tag,
      type: preset.type,
      medication: preset.medication,
      dose: preset.dose ?? "",
      occurredOn: ranchDay(),
    });
  };

  const shearer =
    shearers[sheep.station - 1]?.name || `Estación ${sheep.station}`;

  return (
    <>
      <header className="App-header">
        <button onClick={onBack} className="Cancel-button">
          ← Volver
        </button>
        <p>Detalle</p>
      </header>

      <section className="Detail-info">
        <div className="Detail-tag-row">
          <span className={`Color-dot Color-dot--${sheep.color} Color-dot--lg`} />
          <span className="Detail-tag">{sheep.tag}</span>
        </div>
        <p className="Detail-meta">
          {sheep.type} · Esquilador: {shearer}
        </p>
        <div className="Detail-fields">
          <div className="Detail-field">
            <span className="Detail-field-label">Lana</span>
            <span className="Detail-field-value">{sheep.wool_quality ?? "—"}</span>
          </div>
          <div className="Detail-field">
            <span className="Detail-field-label">Lactancia</span>
            <span className="Detail-field-value">{sheep.lactation ?? "—"}</span>
          </div>
        </div>
      </section>

      <section className="Detail-section">
        <h3 className="Detail-section-title">Esquilas</h3>
        {shearingHistory.length === 0 ? (
          <p className="Detail-empty">Sin registros</p>
        ) : (
          <div className="Detail-list">
            {shearingHistory.map((s) => (
              <div key={s.id} className="Detail-list-item Detail-list-item--shearing">
                <div className="Detail-list-left">
                  <span className="Detail-list-primary">
                    Esquilador: {shearers[s.station - 1]?.name || `Estación ${s.station}`}
                  </span>
                  <span className="Detail-list-secondary">
                    Lana: {s.wool_quality ?? "—"} · Lact: {s.lactation ?? "—"}
                  </span>
                </div>
                <span className="Detail-list-secondary">
                  {formatDate(s.occurred_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="Detail-section">
        <div className="Detail-section-header">
          <h3 className="Detail-section-title">Tratamientos</h3>
          <button className="Detail-add-btn" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cerrar" : "+ Manual"}
          </button>
        </div>

        {showForm && (
          <TreatmentForm
            onSave={(t) => {
              actions.addTreatment({ tag: sheep.tag, ...t });
              setShowForm(false);
            }}
            onCancel={() => setShowForm(false)}
          />
        )}

        {presets.length > 0 && (
          <div className="Quick-apply-row">
            {presets.map((p) => (
              <button
                key={p.id}
                className={`Quick-apply-btn Quick-apply-btn--${p.type}`}
                onClick={() => onApplyPreset(p)}
              >
                {p.medication + (p.dose ? ` ${p.dose}` : "")}
              </button>
            ))}
          </div>
        )}

        {treatments.length === 0 ? (
          <p className="Detail-empty">Sin tratamientos</p>
        ) : (
          <div className="Detail-list">
            {treatments.map((t) => (
              <div key={t.id} className="Detail-list-item Detail-list-item--treatment">
                <div className="Detail-list-left">
                  <span
                    className={`Treatment-badge Treatment-badge--${t.type}`}
                  >
                    {t.type === "vaccination" ? "Vacuna" : "Desparasitante"}
                  </span>
                  <span className="Detail-list-primary">
                    {t.medication}{t.dose ? ` · ${t.dose}` : ""}
                  </span>
                  {t.pending && <span className="Pending-badge">pendiente</span>}
                </div>
                <div className="Detail-list-right">
                  <span className="Detail-list-secondary">
                    {formatDay(t.occurred_on)}
                  </span>
                  <button
                    className="Detail-delete-btn"
                    onClick={() => onDeleteTreatment(t)}
                    title="Eliminar"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function mondayOfWeek() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return ranchDay(new Date(d.getFullYear(), d.getMonth(), diff));
}

function VaccinationReport({ treatments, presets, actions, onBack }) {
  const [start, setStart] = useState(() => ranchDay());
  const [end, setEnd] = useState(() => ranchDay());

  const [showPresetForm, setShowPresetForm] = useState(false);
  const [presetType, setPresetType] = useState("vaccination");
  const [medication, setMedication] = useState("");
  const [dose, setDose] = useState("");

  // Report is computed from local data, so it works fully offline.
  const summary = useMemo(() => {
    const byDay = new Map();
    for (const t of treatments) {
      if (t.type !== "vaccination") continue;
      if (t.occurred_on < start || t.occurred_on > end) continue;
      byDay.set(t.occurred_on, (byDay.get(t.occurred_on) ?? 0) + 1);
    }
    const days = [...byDay.entries()]
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => b.day.localeCompare(a.day));
    return { days, total: days.reduce((sum, d) => sum + d.count, 0) };
  }, [treatments, start, end]);

  const setToday = () => { setStart(ranchDay()); setEnd(ranchDay()); };
  const setThisWeek = () => { setStart(mondayOfWeek()); setEnd(ranchDay()); };

  const onSubmitPreset = (e) => {
    e.preventDefault();
    if (!medication.trim()) return;
    actions.addPreset({
      type: presetType,
      medication: medication.trim(),
      dose: dose.trim(),
    });
    setMedication("");
    setDose("");
    setShowPresetForm(false);
  };

  const onDeletePreset = (p) => {
    if (!window.confirm("¿Eliminar este preset?")) return;
    actions.deletePreset(p);
  };

  const vaccinations = presets.filter((p) => p.type === "vaccination");
  const dewormings = presets.filter((p) => p.type === "deworming");

  return (
    <>
      <header className="App-header">
        <button onClick={onBack} className="Cancel-button">
          ← Volver
        </button>
        <p>Vacunaciones</p>
      </header>

      <section className="Detail-section">
        <div className="Quick-filter-row">
          <button className="Quick-filter-btn" onClick={setToday}>Hoy</button>
          <button className="Quick-filter-btn" onClick={setThisWeek}>Esta semana</button>
          <button
            className="Header-add-btn"
            onClick={() => setShowPresetForm(!showPresetForm)}
            title="Administrar presets"
          >
            {showPresetForm ? "✕" : "+"}
          </button>
        </div>
      </section>

      {showPresetForm ? (
        <>
          <section className="Detail-section">
            <form className="Treatment-form" onSubmit={onSubmitPreset}>
              <h3>Nuevo Preset</h3>

              <div className="Treatment-type-toggle">
                <button
                  type="button"
                  className={`Type-btn ${presetType === "vaccination" ? "Type-btn--active" : ""}`}
                  onClick={() => setPresetType("vaccination")}
                >
                  Vacuna
                </button>
                <button
                  type="button"
                  className={`Type-btn ${presetType === "deworming" ? "Type-btn--active" : ""}`}
                  onClick={() => setPresetType("deworming")}
                >
                  Desparasitante
                </button>
              </div>

              <input
                className="Treatment-input"
                type="text"
                placeholder="Marca / medicamento..."
                value={medication}
                onChange={(e) => setMedication(e.target.value)}
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
              />

              <input
                className="Treatment-input"
                type="text"
                placeholder="Dosis (ej. 2ml, 1 pastilla)..."
                value={dose}
                onChange={(e) => setDose(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
              />

              <button
                type="submit"
                className="Treatment-save-btn"
                disabled={!medication.trim()}
              >
                Guardar Preset
              </button>
            </form>
          </section>

          <section className="Detail-section">
            <h3 className="Detail-section-title">Vacunas</h3>
            {vaccinations.length === 0 ? (
              <p className="Detail-empty">Sin presets de vacuna</p>
            ) : (
              <div className="Detail-list">
                {vaccinations.map((p) => (
                  <div key={p.id} className="Detail-list-item Detail-list-item--treatment">
                    <div className="Detail-list-left">
                      <span className="Treatment-badge Treatment-badge--vaccination">Vacuna</span>
                      <span className="Detail-list-primary">
                        {p.medication}{p.dose ? ` · ${p.dose}` : ""}
                      </span>
                      {p.pending && <span className="Pending-badge">pendiente</span>}
                    </div>
                    <button
                      className="Detail-delete-btn"
                      onClick={() => onDeletePreset(p)}
                      title="Eliminar"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="Detail-section">
            <h3 className="Detail-section-title">Desparasitantes</h3>
            {dewormings.length === 0 ? (
              <p className="Detail-empty">Sin presets de desparasitante</p>
            ) : (
              <div className="Detail-list">
                {dewormings.map((p) => (
                  <div key={p.id} className="Detail-list-item Detail-list-item--treatment">
                    <div className="Detail-list-left">
                      <span className="Treatment-badge Treatment-badge--deworming">Desparasitante</span>
                      <span className="Detail-list-primary">
                        {p.medication}{p.dose ? ` · ${p.dose}` : ""}
                      </span>
                      {p.pending && <span className="Pending-badge">pendiente</span>}
                    </div>
                    <button
                      className="Detail-delete-btn"
                      onClick={() => onDeletePreset(p)}
                      title="Eliminar"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          <section className="Detail-section">
            <div className="Vaccination-date-picker">
              <label className="Vaccination-date-label">
                Desde
                <input type="date" className="Treatment-input" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label className="Vaccination-date-label">
                Hasta
                <input type="date" className="Treatment-input" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </div>
          </section>

          <section className="Vaccination-summary">
            <span className="Vaccination-summary-count">{summary.total}</span>
            <span className="Vaccination-summary-label">vacunaciones</span>
          </section>

          <section className="Detail-section" style={{ flex: 1, overflowY: "auto" }}>
            <h3 className="Detail-section-title">Desglose por día</h3>
            {summary.days.length === 0 ? (
              <p className="Detail-empty">Sin vacunaciones en este rango</p>
            ) : (
              <div className="Detail-list">
                {summary.days.map((d) => (
                  <div key={d.day} className="Vaccination-day-row">
                    <span className="Vaccination-day-date">{formatDay(d.day)}</span>
                    <span className="Vaccination-day-count">{d.count}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function EsquilaDBApp() {
  const [enrollment, setEnrollment] = useState(undefined); // undefined=loading, null=not enrolled
  const [snapshot, setSnapshot] = useState(null);
  const [pending, setPending] = useState([]);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [syncing, setSyncing] = useState(false);

  const [filter, setFilter] = useState("");
  const [selectedTag, setSelectedTag] = useState(null);
  const [highlightedTag, setHighlightedTag] = useState(null);
  const [showVaccinationReport, setShowVaccinationReport] = useState(false);

  const syncNow = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    try {
      await drainOutbox();
      setPending(await loadPending());
      setSnapshot(await refreshSnapshot());
    } catch (err) {
      if (err instanceof AuthError && err.message === "token rejected") {
        await clearEnrollment();
        setEnrollment(null);
      }
      // Anything else (offline, server hiccup): outbox is intact, retry later.
    } finally {
      setSyncing(false);
    }
  }, []);

  // Boot: pick up an enrollment token from the QR link hash, then load
  // everything from IndexedDB so the app renders instantly, even offline.
  useEffect(() => {
    (async () => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      if (hash.get("token")) {
        await saveEnrollment(hash.get("token"), hash.get("name"));
        window.history.replaceState(null, "", window.location.pathname);
      }
      setSnapshot((await loadSnapshot()) ?? null);
      setPending(await loadPending());
      setEnrollment((await getEnrollment()) ?? null);
    })();
  }, []);

  // Background sync: on enroll, on reconnect, on app focus, every 60s.
  useEffect(() => {
    if (!enrollment) return;
    syncNow();
    const onOnline = () => { setOnline(true); syncNow(); };
    const onOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") syncNow();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(syncNow, 60 * 1000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [enrollment, syncNow]);

  const applyLocal = useCallback(async (table, row) => {
    await enqueue(table, row);
    setPending(await loadPending());
    syncNow();
  }, [syncNow]);

  const actions = useMemo(() => ({
    addTreatment: ({ tag, type, medication, dose, occurredOn }) => {
      const now = new Date().toISOString();
      return applyLocal("treatments", {
        id: uuidv7(),
        tag,
        type,
        medication,
        dose: dose ?? "",
        occurred_on: occurredOn ?? ranchDay(),
        recorded_at: now,
        updated_at: now,
        deleted_at: null,
        origin: enrollment?.deviceName ?? "phone",
      });
    },
    deleteTreatment: (t) => {
      const now = new Date().toISOString();
      const { pending: _pending, ...row } = t;
      return applyLocal("treatments", { ...row, deleted_at: now, updated_at: now });
    },
    addPreset: ({ type, medication, dose }) => {
      const now = new Date().toISOString();
      return applyLocal("treatment_presets", {
        id: uuidv7(),
        type,
        medication,
        dose: dose ?? "",
        updated_at: now,
        deleted_at: null,
      });
    },
    deletePreset: (p) => {
      const now = new Date().toISOString();
      const { pending: _pending, ...row } = p;
      return applyLocal("treatment_presets", { ...row, deleted_at: now, updated_at: now });
    },
  }), [applyLocal, enrollment]);

  // Derived, offline-capable views over snapshot + pending outbox.
  const events = snapshot?.shearing_events ?? [];

  const sheep = useMemo(() => {
    // Events arrive sorted by occurred_at DESC, so the first per tag is the
    // sheep's latest status.
    const latest = new Map();
    for (const e of events) {
      if (!latest.has(e.tag)) latest.set(e.tag, e);
    }
    return [...latest.values()];
  }, [events]);

  const treatments = useMemo(
    () => mergeRows(snapshot?.treatments ?? [], pending, "treatments"),
    [snapshot, pending]
  );

  const presets = useMemo(
    () =>
      mergeRows(snapshot?.presets ?? [], pending, "treatment_presets").sort(
        (a, b) => a.type.localeCompare(b.type) || a.medication.localeCompare(b.medication)
      ),
    [snapshot, pending]
  );

  const treatmentCounts = useMemo(() => {
    const counts = {};
    for (const t of treatments) {
      const c = (counts[t.tag] ??= { vaccinations: 0, dewormings: 0 });
      if (t.type === "vaccination") c.vaccinations += 1;
      else c.dewormings += 1;
    }
    return counts;
  }, [treatments]);

  if (enrollment === undefined) {
    return <div className="App" />;
  }

  if (enrollment === null) {
    return (
      <div className="App">
        <EnrollScreen
          onEnroll={async (token, name) => {
            await saveEnrollment(token, name);
            setEnrollment({ deviceName: name });
          }}
        />
      </div>
    );
  }

  const selectedSheep = selectedTag
    ? sheep.find((s) => s.tag === selectedTag)
    : null;

  let screen = null;

  if (showVaccinationReport) {
    screen = (
      <VaccinationReport
        treatments={treatments}
        presets={presets}
        actions={actions}
        onBack={() => setShowVaccinationReport(false)}
      />
    );
  } else if (selectedSheep) {
    screen = (
      <SheepDetailView
        sheep={selectedSheep}
        shearingHistory={events.filter((e) => e.tag === selectedSheep.tag)}
        treatments={treatments
          .filter((t) => t.tag === selectedSheep.tag)
          .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))}
        presets={presets}
        actions={actions}
        onBack={() => {
          setSelectedTag(null);
          setHighlightedTag(null);
        }}
      />
    );
  } else {
    screen = (
      <>
        <header className="App-header">
          <button
            className="Header-vacc-btn"
            onClick={() => setShowVaccinationReport(true)}
            title="Reporte de vacunaciones"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="Header-vacc-icon">
              <path d="m18 2 4 4" />
              <path d="m17 7 3-3" />
              <path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5" />
              <path d="m9 11 4 4" />
              <path d="m5 19-3 3" />
              <path d="m14 4 6 6" />
            </svg>
          </button>
          <p>EsquilaDB</p>
        </header>
        <div className="Search-bar">
          <input
            className="Search-input"
            type="text"
            autoFocus
            placeholder="Filtrar por código..."
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setHighlightedTag(null);
            }}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
          />
        </div>
        <div className="Edit-bar">
          <button
            className="Edit-button"
            disabled={!highlightedTag}
            onClick={() => {
              if (highlightedTag) setSelectedTag(highlightedTag);
            }}
          >
            <svg
              className="Edit-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
            Ver Detalle
          </button>
        </div>
        <SheepTable
          sheep={sheep}
          filter={filter}
          highlightedTag={highlightedTag}
          onHighlight={(s) => setHighlightedTag(s.tag)}
          treatmentCounts={treatmentCounts}
        />
      </>
    );
  }

  return (
    <div className="App">
      <SyncStatusBar
        online={online}
        pendingCount={pending.length}
        fetchedAt={snapshot?.fetchedAt}
        syncing={syncing}
        onSync={syncNow}
      />
      {screen}
    </div>
  );
}

export default EsquilaDBApp;
