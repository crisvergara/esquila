import { useState, useEffect } from "react";

import "./EsquilaDB.css";
import shearers from "../shearers.json";

function SheepTable({ sheep, filter, highlightedId, onHighlight }) {
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
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const shearer =
                shearers[s.station - 1]?.name || `Estación ${s.station}`;
              const isVaccinated = s.vaccinated === 1;
              const isHighlighted = highlightedId === s.rowid;
              const rowClass = [
                "Sheep-row",
                isHighlighted && "Sheep-row--selected",
                isVaccinated && "Sheep-row--vaccinated",
              ]
                .filter(Boolean)
                .join(" ");

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
                  <td>{isVaccinated ? "✅" : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ConfirmScreen({ sheep, onCancel, onConfirm }) {
  const shearer =
    shearers[sheep.station - 1]?.name || `Estación ${sheep.station}`;
  return (
    <>
      <header className="App-header">
        <button onClick={onCancel} className="Cancel-button">
          Cancelar
        </button>
        <p>Confirmar Vacuna</p>
      </header>
      <section className="Tag-display">
        <p className={`Tag-Display-${sheep.color}`}>{sheep.tag}</p>
        <p>Tipo: {sheep.type}</p>
        <p>Esquilador: {shearer}</p>
      </section>
      <section className="Tag-buttons">
        <button onClick={onConfirm}>Vacunar ✔</button>
        <button onClick={onCancel}>Cancelar</button>
      </section>
    </>
  );
}

function SuccessScreen() {
  return (
    <>
      <header className="App-header">
        <p>Vacunado</p>
      </header>
      <section className="Tag-display">
        <p className={`Tag-button-green`}>¡Vacunado!</p>
      </section>
    </>
  );
}

function FailedScreen() {
  return (
    <>
      <header className="App-header">
        <p>Error</p>
      </header>
      <section className="Tag-display">
        <p className={`Tag-button-red`}>Error al vacunar</p>
      </section>
    </>
  );
}

function SendingScreen() {
  return (
    <>
      <header className="App-header">
        <p>Enviando...</p>
      </header>
      <section className="Tag-display">
        <p className={`Tag-button-white`}>Enviando...</p>
      </section>
    </>
  );
}

function EsquilaDBApp() {
  const [allSheep, setAllSheep] = useState([]);
  const [filter, setFilter] = useState("");
  const [selectedSheep, setSelectedSheep] = useState(null);
  const [highlightedSheep, setHighlightedSheep] = useState(null);
  const [message, setMessage] = useState(null);

  const loadSheep = () => {
    fetch("/sheep")
      .then((res) => res.json())
      .then((data) => setAllSheep(data))
      .catch(() => setAllSheep([]));
  };

  useEffect(() => {
    loadSheep();
  }, []);

  const onCancel = () => {
    setSelectedSheep(null);
    setHighlightedSheep(null);
    setMessage(null);
  };

  const onConfirmVaccinate = async () => {
    try {
      setMessage("sending");
      await fetch("/vaccinate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ rowid: selectedSheep.rowid }),
      });
      setMessage("success");
    } catch (err) {
      setMessage("failed");
    }
    setTimeout(() => {
      loadSheep();
      onCancel();
    }, 1500);
  };

  let screen = null;

  if (message === "success") {
    screen = <SuccessScreen />;
  } else if (message === "failed") {
    screen = <FailedScreen />;
  } else if (message === "sending") {
    screen = <SendingScreen />;
  } else if (selectedSheep) {
    screen = (
      <ConfirmScreen
        sheep={selectedSheep}
        onCancel={onCancel}
        onConfirm={onConfirmVaccinate}
      />
    );
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
            Editar
          </button>
        </div>
        <SheepTable
          sheep={allSheep}
          filter={filter}
          highlightedId={highlightedSheep?.rowid ?? null}
          onHighlight={setHighlightedSheep}
        />
      </>
    );
  }

  return <div className="App">{screen}</div>;
}

export default EsquilaDBApp;
