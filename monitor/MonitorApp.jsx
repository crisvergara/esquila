import "./MonitorApp.css";
import useCounts from "../hooks/useCounts";
import useCurrentTime from "../hooks/useCurrentTime";
import useShearers from "../hooks/useShearers";
import useTimeSince from "../hooks/useTimeSince";
import useTagColors from '../hooks/useTagColors';
import { monitorStations } from '../shared/ranch-configuration.js';

const EMPTY_COUNT = { lastTag: "", lastTagColor: "none", counted: 0 };

function EsquiladorRow({ shearer, count }) {
  const colorStyle = useTagColors();
  const timeSince = useTimeSince(count.lastScanTime);
  return (
    <div className="Esquilador-row">
      <div className="Esquilador-header">
        <p>{shearer.name}{shearer.active === false ? ' (inactivo)' : ''}</p> <p>{count.counted}</p>
      </div>
      <div className="Esquilador-Tag-Display-none" style={colorStyle(count)}>
        {count.lastTag}
      </div>
      <div className={`Esquilador-Tag-Display-none`}>{timeSince}</div>
    </div>
  );
}

function MonitorApp() {
  const { counts, error: connectionError } = useCounts();
  const { shearers } = useShearers();
  const currentTime = useCurrentTime();
  const stations = monitorStations(shearers, counts);
  const rowCount = Math.max(stations.length, 1);
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
      {connectionError && <p role="alert">{connectionError}</p>}
      <section className="Esquilador-monitor">
        {stations.map(({ shearer, station }) => (
          <EsquiladorRow
            key={station}
            shearer={shearer}
            count={counts[station] ?? EMPTY_COUNT}
          />
        ))}
      </section>
    </div>
  );
}

export default MonitorApp;
