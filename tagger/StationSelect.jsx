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
            <div className={`Tag-Display-${counts[index + 1].lastTagColor}`}>
              {counts[index + 1].lastTag}
            </div>
            <button onClick={() => setStation(index + 1)}>
              {shearer.name}
            </button>
          </React.Fragment>
        ))}
      </section>
    </>
  );
}

export default StationSelect;
