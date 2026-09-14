import "./MonitorApp.css";
import useCounts from "../hooks/useCounts";
import useCurrentTime from "../hooks/useCurrentTime";
import useShearers from "../hooks/useShearers";
import useTimeSince from "../hooks/useTimeSince";

const EMPTY_COUNT = { lastTag: "", lastTagColor: "none", counted: 0 };

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
  const { shearers } = useShearers();
  const currentTime = useCurrentTime();
  const rowCount = Math.max(shearers.length, 1);
  const rowFontHeight = Math.min(18, 62 / rowCount);
  return (
    <div
      className="Monitor-app"
      style={{ "--row-font-vh": `${rowFontHeight}vh` }}
    >
      <header className="Monitor-app-header">
        {/*<img src="/qr.png" alt="QR Code" />*/}
        <p>{currentTime}</p>
      </header>
      <section className="Esquilador-monitor">
        {shearers.map((shearer, index) => (
          <EsquiladorRow
            key={index}
            shearer={shearer}
            count={counts[index + 1] ?? EMPTY_COUNT}
          />
        ))}
      </section>
    </div>
  );
}

export default MonitorApp;
