import React from "react";
import useTagColors from '../hooks/useTagColors';

function StationSelect({ setStation, counts, shearers }) {
  const colorStyle = useTagColors();
  return (
    <>
      <header className="App-header">
        <p>Elija un esquilador</p>
      </header>
      <section className="Station-buttons">
        {shearers.map((shearer, index) => {
          if (shearer.active === false) return null;
          const count = counts[index + 1] ?? {
            lastTag: "",
            lastTagColor: "none",
          };
          return (
            <React.Fragment key={index}>
              <div className="Tag-Display-none" style={colorStyle(count)}>
                {count.lastTag}
              </div>
              <button onClick={() => setStation(index + 1)}>
                {shearer.name}
              </button>
            </React.Fragment>
          );
        })}
      </section>
    </>
  );
}

export default StationSelect;
