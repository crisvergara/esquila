import "./MobileMonitorApp.css";
import "../tagger/Tagger.css";
import useCounts from "../hooks/useCounts";
import useShearers from "../hooks/useShearers";
import useTimeSince from "../hooks/useTimeSince";
import useTagColors from '../hooks/useTagColors';
import { monitorStations } from '../shared/ranch-configuration.js';

const EMPTY_COUNT = { lastTag: "", lastTagColor: "none", counted: 0 };

function MobileStationRow({ index, shearer, count }) {
  const colorStyle = useTagColors();
  const timeSince = useTimeSince(count.lastScanTime);
  return (
    <div>
      <div className="Esquilador-mobile-header">
        {index + 1}: {shearer.name}{shearer.active === false ? ' (inactivo)' : ''} -- {count.counted}
      </div>
      <div className={`Tag-Display-none`}>Tiempo: {timeSince}</div>
      <div className="Tag-Display-none" style={colorStyle(count)}>
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
        {monitorStations(shearers, counts).map(({ shearer, station }) => (
          <MobileStationRow
            key={station}
            index={station - 1}
            shearer={shearer}
            count={counts[station] ?? EMPTY_COUNT}
          />
        ))}
      </section>
    </>
  );
}

export default MobileMonitorApp;
