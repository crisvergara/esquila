import { useEffect, useState } from "react";

import "./App.css";
import StationSelect from "./components/StationSelect";

function TagColorSelect({ onCancel, setColor }) {
  return (
    <>
      <header className="App-header">
        <button onClick={onCancel} className="Cancel-button">
          Cancela
        </button>
        <p>Elija un color</p>
      </header>
      <section className="Tag-color-buttons">
        <button
          className="Tag-button-yellow"
          onClick={() => setColor("yellow")}
        >
          Amarillo
        </button>
        <button className="Tag-button-white" onClick={() => setColor("white")}>
          Blanco
        </button>
        <button
          className="Tag-button-purple"
          onClick={() => setColor("purple")}
        >
          Morado
        </button>
        <button className="Tag-button-red" onClick={() => setColor("red")}>
          Rojo
        </button>
        <button className="Tag-button-blue" onClick={() => setColor("blue")}>
          Azúl
        </button>
        <button className="Tag-button-green" onClick={() => setColor("green")}>
          Verde
        </button>
        <button
          className="Tag-button-orange"
          onClick={() => setColor("orange")}
        >
          Naranjo
        </button>
        <button className="Tag-button-pink" onClick={() => setColor("pink")}>
          Rosa
        </button>
        <button className="Tag-button-none" onClick={() => setColor("none")}>
          No Hay
        </button>
      </section>
    </>
  );
}

function BirthLocationSelect({ onCancel, setLocation }) {
  return (
    <>
      <header className="App-header">
        <button onClick={onCancel} className="Cancel-button">
          Cancela
        </button>
        <p>Elija los primeras letres</p>
      </header>
      <section className="Tag-buttons">
        <button onClick={() => setLocation("A")}>A</button>
        <button onClick={() => setLocation("B")}>B</button>
        <button onClick={() => setLocation("C")}>C</button>
        <button onClick={() => setLocation("S")}>S</button>
        <button onClick={() => setLocation("AC")}>AC</button>
        <button onClick={() => setLocation("BC")}>BC</button>
        <button onClick={() => setLocation("CB")}>CB</button>
        <button onClick={() => setLocation("SC")}>SC</button>
        <button onClick={() => setLocation("X")}>X</button>
      </section>
    </>
  );
}

function DigitSelect({ tag, onCancel, addDigit, removeDigit, onSubmit }) {
  const digitsDisabled = tag.length >= 6;
  const canSubmit = tag.length >= 5;
  const onAddDigit = (digit) => {
    if (!digitsDisabled) {
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
          <button disabled={digitsDisabled} onClick={() => onAddDigit("1")}>
            1
          </button>
          <button disabled={digitsDisabled} onClick={() => onAddDigit("2")}>
            2
          </button>
          <button disabled={digitsDisabled} onClick={() => onAddDigit("3")}>
            3
          </button>
        </section>
        <section className="Tag-button-row">
          <button disabled={digitsDisabled} onClick={() => onAddDigit("4")}>
            4
          </button>
          <button disabled={digitsDisabled} onClick={() => onAddDigit("5")}>
            5
          </button>
          <button disabled={digitsDisabled} onClick={() => onAddDigit("6")}>
            6
          </button>
        </section>
        <section className="Tag-button-row">
          <button disabled={digitsDisabled} onClick={() => onAddDigit("7")}>
            7
          </button>
          <button disabled={digitsDisabled} onClick={() => onAddDigit("8")}>
            8
          </button>
          <button disabled={digitsDisabled} onClick={() => onAddDigit("9")}>
            9
          </button>
        </section>
        <section className="Tag-button-row">
          <button onClick={() => removeDigit()}>&lt;</button>
          <button disabled={digitsDisabled} onClick={() => onAddDigit("0")}>
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

function ConfirmScreen({ tag, station, color, lactation, onCancel, onSubmit }) {
  const name = (() => {
    if (station == 1) {
      return "Bastian";
    } else if (station == 2) {
      return "Carlos";
    } else {
      return "Salvador";
    }
  })();

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
        <p className={`Tag-button-${color}`}>{tag}</p>
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

function RamApp({ counts, shearers, refreshCounts }) {
  const [station, setStation] = useState(0);
  const [color, setColor] = useState(null);
  const [location, setLocation] = useState(null);
  const [digits, setDigits] = useState("");
  const [showMessage, setShowMessage] = useState(null);
  const [digitsSubmitted, setDigitsSubmitted] = useState(false);

  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);

  const onCancel = () => {
    setStation(0);
    setColor(null);
    setLocation(null);
    setDigits("");
    setShowMessage(null);
    setDigitsSubmitted(false);
  };

  const onSubmitDigits = () => {
    setDigitsSubmitted(true);
  };

  const addDigit = (x) => {
    setDigits(digits + x);
  };

  const removeDigit = () => {
    setDigits(digits.slice(0, -1));
  };

  const tag = location + digits;

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
          tag,
          color,
          station,
          lactation: "OK",
          type: "carnero",
        }),
      });
      setShowMessage("success");
    } catch (err) {
      setShowMessage("failed");
    }
    setTimeout(async () => {
      try {
        await refreshCounts();
      } catch (err) {
        console.error(err);
      }
      onCancel();
    }, 1000);
  };

  let screen = null;

  if (station === 0) {
    screen = (
      <StationSelect
        setStation={setStation}
        shearers={shearers}
        counts={counts}
      />
    );
  } else if (!color) {
    screen = <TagColorSelect onCancel={onCancel} setColor={setColor} />;
  } else if (!location) {
    screen = (
      <BirthLocationSelect onCancel={onCancel} setLocation={setLocation} />
    );
  } else if (!digitsSubmitted) {
    screen = (
      <DigitSelect
        tag={tag}
        onCancel={onCancel}
        addDigit={addDigit}
        removeDigit={removeDigit}
        onSubmit={onSubmitDigits}
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
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    );
  }

  return <div className="App">{screen}</div>;
}

export default RamApp;
