import { useState, useEffect } from "react";

import "./EsquilaDB.css";
import shearers from "../shearers.json";

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("es-MX", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function SheepTable({
  sheep,
  filter,
  highlightedId,
  onHighlight,
  treatmentCounts,
}) {
  const query = filter.toUpperCase();
  const filtered = query
    ? sheep.filter((s) => s.tag.includes(query))
    : sheep;

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
              const isHighlighted = highlightedId === s.rowid;
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
                  key={s.rowid}
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

function TreatmentForm({ tag, onSave, onCancel }) {
  const [type, setType] = useState("vaccination");
  const [medication, setMedication] = useState("");
  const [dose, setDose] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sending, setSending] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!medication.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/treatments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tag,
          type,
          medication: medication.trim(),
          dose: dose.trim(),
          date: new Date(date + "T12:00:00").toISOString(),
        }),
      });
      if (!res.ok) throw new Error("save failed");
      onSave();
    } catch {
      setSending(false);
    }
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
          disabled={!medication.trim() || sending}
        >
          {sending ? "Guardando..." : "Guardar"}
        </button>
        <button type="button" className="Treatment-cancel-btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function SheepDetailView({ sheep, onBack }) {
  const [shearingHistory, setShearingHistory] = useState([]);
  const [treatments, setTreatments] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const loadData = () => {
    fetch(`/sheep?tag=${encodeURIComponent(sheep.tag)}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setShearingHistory)
      .catch(() => setShearingHistory([]));

    fetch(`/treatments?tag=${encodeURIComponent(sheep.tag)}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setTreatments)
      .catch(() => setTreatments([]));
  };

  useEffect(() => {
    loadData();
  }, [sheep.tag]);

  const onDeleteTreatment = async (id) => {
    if (!window.confirm("¿Eliminar este tratamiento?")) return;
    setDeleting(id);
    try {
      await fetch(`/treatments/${id}`, { method: "DELETE" });
      loadData();
    } catch {
      // ignore
    }
    setDeleting(null);
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
            <span className="Detail-field-value">{sheep.woolQuality ?? "—"}</span>
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
              <div key={s.rowid} className="Detail-list-item Detail-list-item--shearing">
                <div className="Detail-list-left">
                  <span className="Detail-list-primary">
                    Esquilador: {shearers[s.station - 1]?.name || `Estación ${s.station}`}
                  </span>
                  <span className="Detail-list-secondary">
                    Lana: {s.woolQuality ?? "—"} · Lact: {s.lactation ?? "—"}
                  </span>
                </div>
                <span className="Detail-list-secondary">
                  {formatDate(s.date)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="Detail-section">
        <div className="Detail-section-header">
          <h3 className="Detail-section-title">Tratamientos</h3>
          {!showForm && (
            <button
              className="Detail-add-btn"
              onClick={() => setShowForm(true)}
            >
              + Agregar
            </button>
          )}
        </div>

        {showForm && (
          <TreatmentForm
            tag={sheep.tag}
            onSave={() => {
              setShowForm(false);
              loadData();
            }}
            onCancel={() => setShowForm(false)}
          />
        )}

        {treatments.length === 0 && !showForm ? (
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
                </div>
                <div className="Detail-list-right">
                  <span className="Detail-list-secondary">
                    {formatDate(t.date)}
                  </span>
                  <button
                    className="Detail-delete-btn"
                    onClick={() => onDeleteTreatment(t.id)}
                    disabled={deleting === t.id}
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

function EsquilaDBApp() {
  const [allSheep, setAllSheep] = useState([]);
  const [treatmentCounts, setTreatmentCounts] = useState({});
  const [filter, setFilter] = useState("");
  const [selectedSheep, setSelectedSheep] = useState(null);
  const [highlightedSheep, setHighlightedSheep] = useState(null);

  const loadSheep = () => {
    fetch("/sheep")
      .then((res) => res.json())
      .then((data) => setAllSheep(data))
      .catch(() => setAllSheep([]));
  };

  const loadTreatmentCounts = () => {
    fetch("/treatment-counts")
      .then((res) => res.json())
      .then((data) => setTreatmentCounts(data))
      .catch(() => setTreatmentCounts({}));
  };

  useEffect(() => {
    loadSheep();
    loadTreatmentCounts();
  }, []);

  const onBack = () => {
    setSelectedSheep(null);
    setHighlightedSheep(null);
    loadSheep();
    loadTreatmentCounts();
  };

  let screen = null;

  if (selectedSheep) {
    screen = <SheepDetailView sheep={selectedSheep} onBack={onBack} />;
  } else {
    screen = (
      <>
        <header className="App-header">
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
              setHighlightedSheep(null);
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
            disabled={!highlightedSheep}
            onClick={() => {
              if (highlightedSheep) setSelectedSheep(highlightedSheep);
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
          sheep={allSheep}
          filter={filter}
          highlightedId={highlightedSheep?.rowid ?? null}
          onHighlight={setHighlightedSheep}
          treatmentCounts={treatmentCounts}
        />
      </>
    );
  }

  return <div className="App">{screen}</div>;
}

export default EsquilaDBApp;
