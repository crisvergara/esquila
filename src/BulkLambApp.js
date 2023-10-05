import { useState } from "react";

import "./App.css";

function StationSelect({ setStation }) {
  return (
    <>
      <header className="App-header">
        <p>Elija un esquilador</p>
      </header>
      <section className="Station-buttons">
        <button onClick={() => setStation(1)}>Angel</button>
        <button onClick={() => setStation(2)}>Pacheco</button>
        <button onClick={() => setStation(3)}>Jesus</button>
      </section>
    </>
  );
}

function DigitSelect({ quantity, onCancel, addDigit, removeDigit, onSubmit }) {
  const digitsDisabled = false;
  const canSubmit = quantity.length >= 1;
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
          Cancelar
        </button>
        <p>¿Cuantos cordilleros hay?</p>
      </header>
      <section className="Tag-display">
        <p>{quantity}</p>
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

function ConfirmScreen({ quantity, station, onCancel, onSubmit }) {
  const name = (() => {
    if (station == 1) {
      return "Angel";
    } else if (station == 2) {
      return "Pacheco";
    } else {
      return "Jesus";
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
        <p className={`Tag-button-white`}>Qty: {quantity}</p>
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

function BulkLambApp() {
  const [station, setStation] = useState(0);
  const [quantity, setQuantity] = useState("");
  const [showMessage, setShowMessage] = useState(null);
  const [digitsSubmitted, setDigitsSubmitted] = useState(false);

  const onCancel = () => {
    setStation(0);
    setQuantity("");
    setShowMessage(null);
    setDigitsSubmitted(false);
  };

  const onSubmitDigits = () => {
    setDigitsSubmitted(true);
  };

  const addDigit = (x) => {
    setQuantity(quantity + x);
  };

  const removeDigit = () => {
    setQuantity(quantity.slice(0, -1));
  };

  const onSubmit = async (ev) => {
    ev.preventDefault();
    try {
      setShowMessage("sending");
      await fetch("/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          quantity,
          station,
        }),
      });
      setShowMessage("success");
    } catch (err) {
      setShowMessage("failed");
    }
    setTimeout(() => {
      onCancel();
    }, 1000);
  };

  let screen = null;

  if (station === 0) {
    screen = <StationSelect setStation={setStation} />;
  } else if (!digitsSubmitted) {
    screen = (
      <DigitSelect
        quantity={quantity}
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
        quantity={quantity}
        station={station}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    );
  }

  return <div className="App">{screen}</div>;
}

export default BulkLambApp;
