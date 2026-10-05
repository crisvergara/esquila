import './MobileMonitorApp.css';
import useRanchState from '../hooks/useRanchState';
import useTimeSince from '../hooks/useTimeSince';
import { monitorStations, tagColorStyle } from '../shared/ranch-configuration.js';

const EMPTY_COUNT = { lastTag: '', counted: 0 };

function MobileStationRow({ station, shearer, count, modes }) {
  const timeSince = useTimeSince(count.lastScanTime);
  return (
    <article className="Mobile-monitor-card" aria-labelledby={`station-${station}`}>
      <header className="Mobile-monitor-station">
        <div className="Mobile-monitor-name">
          <p className="Mobile-monitor-label">Estación {station}{shearer.active === false ? ' · Inactiva' : ''}</p>
          <h2 id={`station-${station}`}>{shearer.name}</h2>
        </div>
        <p className="Mobile-monitor-count"><strong>{count.counted}</strong><span>hoy</span></p>
      </header>
      <div className="Mobile-monitor-tag" style={count.lastTag ? tagColorStyle(modes, count.lastTagColor, count.lastTagType) : undefined}>
        <span className="Mobile-monitor-label">Última caravana</span>
        <strong>{count.lastTag || 'Sin registros'}</strong>
      </div>
      <p className="Mobile-monitor-time">{count.lastScanTime ? <>Hace <time>{timeSince}</time></> : 'Aún no se ha registrado una oveja hoy.'}</p>
    </article>
  );
}

export default function MobileMonitorApp() {
  const { counts, error, loaded, configuration } = useRanchState();
  const stations = monitorStations(configuration.shearers, counts);
  const total = stations.reduce((sum, { station }) => sum + (counts[station]?.counted || 0), 0);
  return (
    <main className="Mobile-monitor">
      <header className="Mobile-monitor-header">
        <div><p className="Mobile-monitor-label">Esquila · Monitor móvil</p><h1>{loaded ? configuration.name : 'Monitor del galpón'}</h1></div>
        <p className="Mobile-monitor-total"><span>Total de hoy</span><strong>{loaded ? total : '—'}</strong></p>
      </header>
      <p className="Mobile-monitor-connection">Se actualiza por el WiFi del galpón. No requiere internet.</p>
      {error && <p className="Mobile-monitor-error" role="alert">{error}</p>}
      {!loaded && !error && <p role="status">Cargando datos del galpón…</p>}
      {loaded && <section className="Mobile-monitor-stations" aria-label="Conteo por esquilador">
        {stations.map(({ shearer, station }) => <MobileStationRow key={station} station={station} shearer={shearer} count={counts[station] ?? EMPTY_COUNT} modes={configuration.modes} />)}
        {!stations.length && <p>No hay esquiladores configurados.</p>}
      </section>}
    </main>
  );
}
