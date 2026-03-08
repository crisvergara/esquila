import { useState, useEffect } from "react";

import "./Vaccinator.css";
import shearers from "../shearers.json";

function SheepList({ sheep, filter, onSelect }) {
  const query = filter.toUpperCase();
  const filtered = query
    ? sheep.filter((s) => s.tag.includes(query))
    : sheep;

  return (
    <section className="Sheep-list">
      {filtered.length === 0 && (
        <p style={{ color: "#fff" }}>No se encontró</p>
      )}
      {filtered.map((s) => {
        const shearer =
          shearers[s.station - 1]?.name || `Estación ${s.station}`;
        return (
          <button
            key={s.rowid}
            className={`Tag-button-${s.color}`}
            onClick={() => onSelect(s)}
            disabled={s.vaccinated === 1}
          >
            {s.tag} — {s.type} — {shearer}
            {s.vaccinated === 1 ? " ✅" : ""}
          </button>
        );
      })}
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

function VaccinatorApp() {
  const [allSheep, setAllSheep] = useState([]);
  const [filter, setFilter] = useState("");
  const [selectedSheep, setSelectedSheep] = useState(null);
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
          <p>Vacunador</p>
        </header>
        <div className="Search-bar">
          <input
            className="Search-input"
            type="text"
            autoFocus
            placeholder="Filtrar por código..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
          />
        </div>
        <SheepList
          sheep={allSheep}
          filter={filter}
          onSelect={(s) => setSelectedSheep(s)}
        />
      </>
    );
  }

  return <div className="App">{screen}</div>;
}

export default VaccinatorApp;
