import shearers from "../shearers.json";

import "./MonitorApp.css";
import useCounts from "../hooks/useCounts";
import useCurrentTime from "../hooks/useCurrentTime";
import useTimeSince from "../hooks/useTimeSince";

function EsquiladorRow({ shearer, counts }) {
  const timeSince = useTimeSince(counts[shearer.station].lastScanTime);
  return (
    <div className="Esquilador-row">
      <div className="Esquilador-header">
        <p>{shearer.name}</p> <p>{counts[shearer.station].counted}</p>
      </div>
      <div
        className={`Esquilador-Tag-Display-${
          counts[shearer.station].lastTagColor
        }`}
      >
        {counts[shearer.station].lastTag}
      </div>
      <div className={`Esquilador-Tag-Display-none`}>{timeSince}</div>
    </div>
  );
}

function MonitorApp() {
  const { counts } = useCounts();
  const currentTime = useCurrentTime();
  return (
    <div className="Monitor-app">
      <header className="Monitor-app-header">
        {/*<img src="/qr.png" alt="QR Code" />*/}
        <p>{currentTime}</p>
      </header>
      <section className="Esquilador-monitor">
        {shearers.map((shearer, index) => (
          <EsquiladorRow key={index} shearer={shearer} counts={counts} />
        ))}
      </section>
    </div>
  );
}

export default MonitorApp;
