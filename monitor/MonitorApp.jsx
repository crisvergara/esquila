import shearers from "../shearers.json";

import "./MonitorApp.css";
import useCounts from "../hooks/useCounts";
import useCurrentTime from "../hooks/useCurrentTime";
import useTimeSince from "../hooks/useTimeSince";

function EsquiladorRow({ shearer, count }) {
  const timeSince = useTimeSince(count.lastScanTime);
  return (
    <div className="Esquilador-row">
      <div className="Esquilador-header">
        <p>{shearer.name}</p> <p>{count.counted}</p>
      </div>
      <div className={`Esquilador-Tag-Display-${count.lastTagColor}`}>
        {count.lastTag}
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
          <EsquiladorRow
            key={index}
            shearer={shearer}
            count={counts[index + 1]}
          />
        ))}
      </section>
    </div>
  );
}

export default MonitorApp;
