import "./MobileMonitorApp.css";
import "../tagger/Tagger.css";
import useCounts from "../hooks/useCounts";
import useShearers from "../hooks/useShearers";
import useTimeSince from "../hooks/useTimeSince";

const EMPTY_COUNT = { lastTag: "", lastTagColor: "none", counted: 0 };

function MobileStationRow({ index, shearer, count }) {
  const timeSince = useTimeSince(count.lastScanTime);
  return (
    <div>
      <div className="Esquilador-mobile-header">
        {index + 1}: {shearer.name} -- {count.counted}
      </div>
      <div className={`Tag-Display-none`}>Tiempo: {timeSince}</div>
      <div className={`Tag-Display-${count.lastTagColor}`}>
        {count.lastTag}
      </div>
    </div>
  );
}

function MobileMonitorApp() {
  const { counts, error: connectionError } = useCounts();
  const { shearers } = useShearers();
  return (
    <>
      <header className="App-header">
        <p>Shearing Monitor</p>
      </header>
      {connectionError && <p role="alert">{connectionError}</p>}
      <section className="Esquilador-mobile-monitor">
        {shearers.map((shearer, index) => (
          <MobileStationRow
            key={index}
            index={index}
            shearer={shearer}
            count={counts[index + 1] ?? EMPTY_COUNT}
          />
        ))}
      </section>
    </>
  );
}

export default MobileMonitorApp;
