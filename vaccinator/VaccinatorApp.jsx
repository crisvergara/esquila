import { useState, useEffect } from "react";

import "./Vaccinator.css";
import shearers from "../shearers.json";
import useTagEditor from "../hooks/useTagEditor";
import modeSchema from "../tagger/modeschema.json";

const ovejaMode = modeSchema.find((m) => m.type === "oveja");
// Use only the textSchema (no colors needed for vaccination lookup)
const vaccinatorTagSchema = { textSchema: ovejaMode.tagSchema.textSchema };

function CodeSelect({ codeSchema, onCancel, setCode }) {
  return (
    <>
      <header className="App-header">
        <button onClick={onCancel} className="Cancel-button">
          Cancela
        </button>
        <p>Elija la letra</p>
      </header>
      <section className="Tag-buttons">
        {codeSchema.options.map((option) => (
          <button key={option.value} onClick={() => setCode(option.value)}>
            {option.name}
          </button>
        ))}
      </section>
    </>
  );
}

function DigitSelect({
  display,
  headerText,
  canSubmit,
  disableDigits,
  onCancel,
  addDigit,
  removeDigit,
  onSubmit,
}) {
  const onAddDigit = (digit) => {
    if (!disableDigits) addDigit(digit);
  };
  const onClickSubmit = () => {
    if (canSubmit) onSubmit();
  };
  return (
    <>
      <header className="App-header">
        <button onClick={onCancel} className="Cancel-button">
          Cancela
        </button>
        <p>{headerText}</p>
      </header>
      <section className="Tag-display">
        <p>{display}</p>
      </section>
      <section className="Tag-buttons">
        <section className="Tag-button-row">
          <button disabled={disableDigits} onClick={() => onAddDigit("1")}>
            1
          </button>
          <button disabled={disableDigits} onClick={() => onAddDigit("2")}>
            2
          </button>
          <button disabled={disableDigits} onClick={() => onAddDigit("3")}>
            3
          </button>
        </section>
        <section className="Tag-button-row">
          <button disabled={disableDigits} onClick={() => onAddDigit("4")}>
            4
          </button>
          <button disabled={disableDigits} onClick={() => onAddDigit("5")}>
            5
          </button>
          <button disabled={disableDigits} onClick={() => onAddDigit("6")}>
            6
          </button>
        </section>
        <section className="Tag-button-row">
          <button disabled={disableDigits} onClick={() => onAddDigit("7")}>
            7
          </button>
          <button disabled={disableDigits} onClick={() => onAddDigit("8")}>
            8
          </button>
          <button disabled={disableDigits} onClick={() => onAddDigit("9")}>
            9
          </button>
        </section>
        <section className="Tag-button-row">
          <button onClick={() => removeDigit()}>&lt;</button>
          <button disabled={disableDigits} onClick={() => onAddDigit("0")}>
            0
          </button>
          <button disabled={!canSubmit} onClick={() => onClickSubmit()}>
            ✔
          </button>
        </section>
      </section>
    </>
  );
}

function ResultsScreen({ results, onCancel, onSelect }) {
  return (
    <>
      <header className="App-header">
        <button onClick={onCancel} className="Cancel-button">
          Cancela
        </button>
        <p>Resultados</p>
      </header>
      <section className="Station-buttons">
        {results.length === 0 && (
          <p style={{ color: "#fff" }}>No se encontró</p>
        )}
        {results.map((sheep) => {
          const shearer =
            shearers[sheep.station - 1]?.name || `Estación ${sheep.station}`;
          return (
            <button
              key={sheep.rowid}
              className={`Tag-button-${sheep.color}`}
              onClick={() => onSelect(sheep)}
              disabled={sheep.vaccinated === 1}
            >
              {sheep.tag} — {sheep.type} — {shearer}
              {sheep.vaccinated === 1 ? " ✅" : ""}
            </button>
          );
        })}
      </section>
    </>
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
        <p className="Tag-button-green">¡Vacunado!</p>
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
        <p className="Tag-button-red">Error al vacunar</p>
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
        <p className="Tag-button-white">Enviando...</p>
      </section>
    </>
  );
}

function VaccinatorApp() {
  const {
    replaceTagComponent,
    addDigitToTagComponent,
    removeDigitFromTagComponent,
    setDigitsValid,
    resetTag,
    tag,
    nextTagStepIndex,
    tagCompleted,
  } = useTagEditor(vaccinatorTagSchema);

  const [results, setResults] = useState(null);
  const [selectedSheep, setSelectedSheep] = useState(null);
  const [message, setMessage] = useState(null);

  // Auto-search when tag entry is complete
  useEffect(() => {
    if (tagCompleted && tag) {
      fetch(`/sheep?tag=${encodeURIComponent(tag)}`)
        .then((res) => res.json())
        .then((data) => setResults(data))
        .catch(() => setResults([]));
    }
  }, [tagCompleted, tag]);

  const onCancel = () => {
    resetTag();
    setResults(null);
    setSelectedSheep(null);
    setMessage(null);
  };

  const onConfirmVaccinate = async () => {
    try {
      setMessage("sending");
      await fetch("/vaccinate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowid: selectedSheep.rowid }),
      });
      setMessage("success");
    } catch {
      setMessage("failed");
    }
    setTimeout(() => onCancel(), 1500);
  };

  let screen;

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
  } else if (results !== null) {
    screen = (
      <ResultsScreen
        results={results}
        onCancel={onCancel}
        onSelect={(sheep) => setSelectedSheep(sheep)}
      />
    );
  } else if (!tagCompleted) {
    const textSchema = vaccinatorTagSchema.textSchema[nextTagStepIndex];
    if (textSchema.type === "code") {
      screen = (
        <CodeSelect
          codeSchema={textSchema}
          onCancel={onCancel}
          setCode={(code) =>
            replaceTagComponent(nextTagStepIndex, {
              value: code,
              valid: true,
            })
          }
        />
      );
    } else if (textSchema.type === "digits") {
      screen = (
        <DigitSelect
          display={tag}
          headerText="Elija los números"
          canSubmit={tag.length >= textSchema.min}
          disableDigits={tag.length >= textSchema.max}
          onCancel={onCancel}
          addDigit={(digit) =>
            addDigitToTagComponent(nextTagStepIndex, digit)
          }
          removeDigit={() => removeDigitFromTagComponent(nextTagStepIndex)}
          onSubmit={() => setDigitsValid(nextTagStepIndex)}
        />
      );
    }
  }

  return <div className="App">{screen}</div>;
}

export default VaccinatorApp;
