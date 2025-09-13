import { useState, useReducer } from "react";

import "./Tagger.css";
import StationSelect from "../src/components/StationSelect";
import shearers from "../shearers.json";
import modes from "./modeschema.json";
import useCounts from "../hooks/useCounts";
import useTagEditor from "../hooks/useTagEditor";

const mode = modes[1];

function TagColorSelect({ tagSchema, onCancel, setColor }) {
  const colors = tagSchema.colors;
  return (
    <>
      <header className="App-header">
        <button onClick={onCancel} className="Cancel-button">
          Cancela
        </button>
        <p>Elija un color</p>
      </header>
      <section className="Tag-color-buttons">
        {colors.map((color) => (
          <button
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
        <p>Elija el primer letre</p>
      </header>
      <section className="Tag-buttons">
        {codeSchema.options.map((option) => {
          return (
            <button onClick={() => setCode(option.value)}>{option.name}</button>
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
          <button onClick={() => setSurvey(option.value)}>{option.name}</button>
        ))}
      </section>
    </>
  );
}

function DigitSelect({
  tag,
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
        <p>Elija los numeros</p>
      </header>
      <section className="Tag-display">
        <p>{tag}</p>
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

function ConfirmScreen({
  tag,
  station,
  color,
  surveyResponses,
  surveySchema,
  onCancel,
  onSubmit,
}) {
  const name = shearers[station - 1].name;

  const displaySurveyResponses = Object.entries(surveyResponses).map(
    ([field, response]) => {
      const schema = surveySchema.find((schema) => schema.field === field);
      const fieldDisplay = schema.display;
      const optionName = schema.options.find(
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
            <p>
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
    <>
      <header className="App-header">
        <p>Success</p>
      </header>
      <section className="Tag-display">
        <p className={`Tag-button-yellow`}>Success</p>
      </section>
    </>
  );
}

function FailedScreen() {
  return (
    <>
      <header className="App-header">
        <p>Failed</p>
      </header>
      <section className="Tag-display">
        <p className={`Tag-button-pink`}>Failed</p>
      </section>
    </>
  );
}
function SendingScreen() {
  return (
    <>
      <header className="App-header">
        <p>Sending</p>
      </header>
      <section className="Tag-display">
        <p className={`Tag-button-white`}>Sending</p>
      </section>
    </>
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
  const [station, setStation] = useState(0);

  const [showMessage, setShowMessage] = useState(null);

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

  const onCancel = () => {
    setStation(0);
    resetTag();
    resetSurvey();
    setShowMessage(null);
  };

  const onSubmit = async (ev) => {
    ev.preventDefault();
    try {
      setShowMessage("sending");
      await fetch("/count", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: mode.type,
          tag,
          color: color.value,
          station,
          ...surveyResponses,
        }),
      });
      setShowMessage("success");
    } catch (err) {
      setShowMessage("failed");
    }
    setTimeout(async () => {
      try {
        await refreshCounts();
      } catch (error) {
        console.error(error);
      }
      onCancel();
    }, 1000);
  };

  let screen = null;

  if (station === 0) {
    screen = (
      <StationSelect
        setStation={setStation}
        counts={counts}
        shearers={shearers}
      />
    );
  } else if (needsColor && !color) {
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
            replaceTagComponent(nextTagStepIndex, { value: code, valid: true })
          }
        />
      );
    } else if (textSchema.type === "digits") {
      screen = (
        <DigitSelect
          tag={tag}
          canSubmit={tag.length >= textSchema.min}
          disableDigits={tag.length >= textSchema.max}
          onCancel={onCancel}
          addDigit={(digit) => addDigitToTagComponent(nextTagStepIndex, digit)}
          removeDigit={() => removeDigitFromTagComponent(nextTagStepIndex)}
          onSubmit={() => setDigitsValid(nextTagStepIndex)}
        />
      );
    }
  } else if (!surveyFullfilled) {
    const surveySchema = mode.surveySchema[nextSurveyStepIndex];
    screen = (
      <SurveySelect
        surveySchema={surveySchema}
        onCancel={onCancel}
        setSurvey={(value) => respondToSurvey(surveySchema.field, value)}
      />
    );
  } else if (showMessage === "success") {
    screen = <SuccessScreen />;
  } else if (showMessage === "failed") {
    screen = <FailedScreen />;
  } else if (showMessage === "sending") {
    screen = <SendingScreen />;
  } else {
    screen = (
      <ConfirmScreen
        tag={tag}
        station={station}
        color={color}
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
