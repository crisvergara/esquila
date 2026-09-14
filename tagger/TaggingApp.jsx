import { useState, useEffect, useReducer } from "react";

import "./Tagger.css";
import StationSelect from "./StationSelect";
import useCounts from "../hooks/useCounts";
import useShearers from "../hooks/useShearers";
import useTagEditor from "../hooks/useTagEditor";
import useTaggingMode from "../hooks/useTaggingMode";

const createSubmissionId = () => {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-tagger`;
};

function TagColorSelect({ tagSchema, onCancel, setColor }) {
  const colors = tagSchema.colors;
  return (
    <>
      <header className="App-header">
        <button onClick={onCancel} className="Cancel-button">
          Cambiar esquilador
        </button>
        <p>Elija un color</p>
      </header>
      <section className="Tag-color-buttons">
        {colors.map((color) => (
          <button
            key={color.value}
            style={{ backgroundColor: color.color, color: color.text }}
            onClick={() => setColor(color)}
          >
            {color.name}
          </button>
        ))}
      </section>
    </>
  );
}

function CodeSelect({ codeSchema, onCancel, setCode }) {
  return (
    <>
      <header className="App-header">
        <button onClick={onCancel} className="Cancel-button">
          Cancela
        </button>
        <p>Elija la primera letra</p>
      </header>
      <section className="Tag-buttons">
        {codeSchema.options.map((option) => {
          return (
            <button key={option.value} onClick={() => setCode(option.value)}>
              {option.name}
            </button>
          );
        })}
      </section>
    </>
  );
}

function SurveySelect({ surveySchema, onCancel, setSurvey }) {
  return (
    <>
      <header className="App-header">
        <button onClick={onCancel} className="Cancel-button">
          Cancelar
        </button>
      </header>
      <section className="Tag-buttons">
        {surveySchema.options.map((option) => (
          <button key={option.value} onClick={() => setSurvey(option.value)}>
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
    if (!disableDigits) {
      addDigit(digit);
    }
  };
  const onClickSubmit = () => {
    if (canSubmit) {
      onSubmit();
    }
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

function QuantityConfirmScreen({ quantity, station, shearers, onCancel, onSubmit }) {
  const name = shearers[station - 1]?.name ?? `Estación ${station}`;

  return (
    <>
      <header className="App-header">
        <button onClick={onCancel} className="Cancel-button">
          Cancelar
        </button>
        <p>Confirmar</p>
      </header>
      <section className="Tag-display">
        <p>Esqilador: {name}</p>
        <p style={{}}>Qty: {quantity}</p>
      </section>
      <section className="Tag-buttons">
        <button onClick={(ev) => onSubmit(ev)}>OK</button>
        <button onClick={() => onCancel()}>Cancelar</button>
      </section>
    </>
  );
}

function ConfirmScreen({
  tag,
  station,
  shearers,
  color,
  surveyResponses,
  surveySchema,
  onCancel,
  onSubmit,
}) {
  const name = shearers[station - 1]?.name ?? `Estación ${station}`;

  const displaySurveyResponses = Object.entries(surveyResponses).map(
    ([field, response]) => {
      const schema = (surveySchema ?? []).find((schema) => schema.field === field);
      const fieldDisplay = schema?.display ?? field;
      const optionName = schema?.options.find(
        (option) => option.value === response
      )?.name;
      return {
        display: fieldDisplay,
        optionName,
      };
    }
  );
  return (
    <>
      <header className="App-header">
        <button onClick={onCancel} className="Cancel-button">
          Cancelar
        </button>
        <p>Confirmar</p>
      </header>
      <section className="Tag-display">
        <p>Esqilador: {name}</p>
        <p
          style={{
            backgroundColor: color.color,
            color: color.text,
          }}
        >
          {tag}
        </p>
        <>
          {displaySurveyResponses.map((response) => (
            <p key={response.display}>
              {response.display}: {response.optionName}
            </p>
          ))}
        </>
      </section>
      <section className="Tag-buttons">
        <button onClick={(ev) => onSubmit(ev)}>OK</button>
        <button onClick={() => onCancel()}>Cancelar</button>
      </section>
    </>
  );
}

function SuccessScreen() {
  return (
    <section className="Submission-screen" role="status" aria-live="polite">
      <div className="Submission-card Submission-card-success">
        <span className="Submission-icon" aria-hidden="true">✓</span>
        <h1>Conteo registrado</h1>
        <p>El conteo fue guardado y el monitor se actualizará automáticamente.</p>
      </div>
    </section>
  );
}

function FailedScreen({ message, onRetry, onDiscard }) {
  return (
    <section className="Submission-screen" role="alert">
      <div className="Submission-card Submission-card-failed">
        <span className="Submission-icon" aria-hidden="true">!</span>
        <h1>No se pudo guardar</h1>
        <p>{message}</p>
        <div className="Submission-actions">
          <button type="button" onClick={onRetry}>Reintentar</button>
          <button type="button" className="Secondary-button" onClick={onDiscard}>
            Descartar
          </button>
        </div>
      </div>
    </section>
  );
}

function SendingScreen() {
  return (
    <section className="Submission-screen" role="status" aria-live="polite">
      <div className="Submission-card Submission-card-sending">
        <span className="Submission-spinner" aria-hidden="true" />
        <h1>Guardando…</h1>
        <p>No cierres esta pantalla.</p>
      </div>
    </section>
  );
}

/*
 Yellow - this year
 White - Last 2 years
 Purple -
 Blue - 
 Orange - Old
 Pink - 
 Other

 Letters
 A - Las Aguilas
 B - San Rafael
 C - Cabereria
*/

function TaggingApp() {
  const { shearers, loaded: shearersLoaded } = useShearers();
  const [station, setStation] = useState(() => {
    const saved = Number.parseInt(localStorage.getItem("esquila-tagger-station") ?? "", 10);
    return Number.isInteger(saved) && saved > 0 ? saved : 0;
  });
  const [quantity, setQuantity] = useState("");
  const [quantitySubmitted, setQuantitySubmitted] = useState(false);

  const onSubmitQuantity = () => {
    setQuantitySubmitted(true);
  };
  const addDigit = (x) => {
    setQuantity(quantity + x);
  };

  const removeDigit = () => {
    setQuantity(quantity.slice(0, -1));
  };

  const [showMessage, setShowMessage] = useState(null);
  const [submissionId, setSubmissionId] = useState(null);
  const [submissionError, setSubmissionError] = useState("");
  const mode = useTaggingMode();

  const {
    color,
    setColor,
    replaceTagComponent,
    addDigitToTagComponent,
    removeDigitFromTagComponent,
    setDigitsValid,
    resetTag,
    tag,
    needsColor,
    nextTagStepIndex,
    currentTagComponentValue,
    tagCompleted,
  } = useTagEditor(mode.tagSchema);

  const [surveyState, surveyDispatch] = useReducer((prevState, action) => {
    switch (action.type) {
      case "reset":
        return [];
      case "respondToSurvey":
        return [
          ...prevState,
          {
            field: action.field,
            value: action.value,
          },
        ];
      default:
        return prevState;
    }
  }, []);

  const nextSurveyStepIndex = surveyState.length;
  const surveyFullfilled =
    surveyState.length === (mode.surveySchema?.length || 0);
  const surveyResponses = surveyState.reduce(
    (acc, response) => ({
      ...acc,
      [response.field]: response.value,
    }),
    {}
  );

  const respondToSurvey = (field, value) => {
    surveyDispatch({ type: "respondToSurvey", field, value });
  };
  const resetSurvey = () => {
    surveyDispatch({ type: "reset" });
  };

  const { counts, refreshCounts } = useCounts();

  const resetEntry = () => {
    resetTag();
    resetSurvey();
    setQuantity("");
    setQuantitySubmitted(false);
    setShowMessage(null);
    setSubmissionId(null);
    setSubmissionError("");
  };

  const selectStation = (nextStation) => {
    localStorage.setItem("esquila-tagger-station", String(nextStation));
    setStation(nextStation);
  };

  const onCancel = () => {
    localStorage.removeItem("esquila-tagger-station");
    setStation(0);
    resetEntry();
  };

  const postSubmission = async (path, payload) => {
    const currentSubmissionId = submissionId ?? createSubmissionId();
    if (!submissionId) setSubmissionId(currentSubmissionId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, submissionId: currentSubmissionId }),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status >= 500) {
          throw new Error("El servidor del galpón tuvo un problema. Intenta nuevamente.");
        }
        throw new Error("Los datos no fueron aceptados. Revisa la información e intenta nuevamente.");
      }
      const result = await response.json();
      if (result?.ok !== true) throw new Error("El servidor no confirmó el conteo.");
      return result;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("El servidor tardó demasiado en responder. Puedes reintentar sin duplicar el conteo.");
      }
      if (error instanceof TypeError) {
        throw new Error("No se pudo comunicar con el servidor del galpón. Revisa el WiFi y vuelve a intentar.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  const submit = async (path, payload) => {
    setSubmissionError("");
    setShowMessage("sending");
    try {
      await postSubmission(path, payload);
      setShowMessage("success");
      refreshCounts().catch((error) => console.error(error));
    } catch (error) {
      setSubmissionError(error.message || "Ocurrió un error inesperado.");
      setShowMessage("failed");
    }
  };

  const onSubmit = (event) => {
    event?.preventDefault();
    return submit("/count", {
      type: mode.type,
      station,
      tag,
      color: color.value,
      ...surveyResponses,
    });
  };

  const onBulkSubmit = (event) => {
    event?.preventDefault();
    return submit("/bulk", { quantity, station });
  };

  useEffect(() => {
    resetEntry();
  }, [mode]);

  useEffect(() => {
    if (shearersLoaded && station > shearers.length) onCancel();
  }, [shearersLoaded, shearers.length, station]);

  useEffect(() => {
    if (showMessage !== "success") return undefined;
    const timeout = setTimeout(resetEntry, 1600);
    return () => clearTimeout(timeout);
  }, [showMessage]);

  let screen = null;

  if (station === 0) {
    screen = (
      <StationSelect
        setStation={selectStation}
        counts={counts}
        shearers={shearers}
      />
    );
  } else if (showMessage === "success") {
    screen = <SuccessScreen />;
  } else if (showMessage === "failed") {
    screen = (
      <FailedScreen
        message={submissionError}
        onRetry={mode.bulk ? onBulkSubmit : onSubmit}
        onDiscard={resetEntry}
      />
    );
  } else if (showMessage === "sending") {
    screen = <SendingScreen />;
  } else if (mode.tagSchema && (needsColor || !tagCompleted)) {
    if (needsColor && !color) {
      screen = (
        <TagColorSelect
          tagSchema={mode.tagSchema}
          onCancel={onCancel}
          setColor={setColor}
        />
      );
    } else if (!tagCompleted) {
      const textSchema = mode.tagSchema.textSchema[nextTagStepIndex];
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
            headerText={"Elija los números"}
            canSubmit={currentTagComponentValue.length >= textSchema.min}
            disableDigits={currentTagComponentValue.length >= textSchema.max}
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
  } else if (mode.bulk && !quantitySubmitted) {
    screen = (
      <DigitSelect
        display={quantity}
        headerText={"¿Cuantos cordilleros hay?"}
        canSubmit={quantity.length >= 1}
        disableDigits={false}
        onCancel={onCancel}
        addDigit={addDigit}
        removeDigit={removeDigit}
        onSubmit={onSubmitQuantity}
      />
    );
  } else if (!surveyFullfilled) {
    const surveySchema = mode.surveySchema[nextSurveyStepIndex];
    screen = (
      <SurveySelect
        surveySchema={surveySchema}
        onCancel={onCancel}
        setSurvey={(value) => respondToSurvey(surveySchema.field, value)}
      />
    );
  } else if (mode.bulk) {
    screen = (
      <QuantityConfirmScreen
        quantity={quantity}
        station={station}
        shearers={shearers}
        onCancel={onCancel}
        onSubmit={onBulkSubmit}
      />
    );
  } else {
    screen = (
      <ConfirmScreen
        tag={tag}
        station={station}
        shearers={shearers}
        color={color}
        mode={mode}
        quantity={quantity}
        tagSchema={mode.tagSchema}
        surveySchema={mode.surveySchema}
        surveyResponses={surveyResponses}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    );
  }

  return <div className="App">{screen}</div>;
}

export default TaggingApp;
