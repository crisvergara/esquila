import "./StationSelect.css";

function StationSelect({ setStation, counts }) {
  return (
    <>
      <header className="App-header">
        <p>Elija un esquilador</p>
      </header>
      <section className="Station-buttons">
        <div className={`Tag-Display-${counts[1].lastTagColor}`}>
          {counts[1].lastTag}
        </div>
        <button onClick={() => setStation(1)}>Angel</button>
        <div className={`Tag-Display-${counts[2].lastTagColor}`}>
          {counts[2].lastTag}
        </div>
        <button onClick={() => setStation(2)}>Pacheco</button>
        <div className={`Tag-Display-${counts[3].lastTagColor}`}>
          {counts[3].lastTag}
        </div>
        <button onClick={() => setStation(3)}>Jesus</button>
      </section>
    </>
  );
}

export default StationSelect;
