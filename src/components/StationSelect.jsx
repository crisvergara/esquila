import "./StationSelect.css";
import React from "react";

function StationSelect({ setStation, counts, shearers }) {
  return (
    <>
      <header className="App-header">
        <p>Elija un esquilador</p>
      </header>
      <section className="Station-buttons">
        {shearers.map((shearer, index) => (
          <React.Fragment key={index}>
            <div
              className={`Tag-Display-${counts[shearer.station].lastTagColor}`}
            >
              {counts[shearer.station].lastTag}
            </div>
            <button onClick={() => setStation(shearer.station)}>
              {shearer.name}
            </button>
          </React.Fragment>
        ))}
      </section>
    </>
  );
}

export default StationSelect;
