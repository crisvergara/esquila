import "./MobileMonitorApp.css";
import "../tagger/Tagger.css";
import useCounts from "../hooks/useCounts";
import useTimeSince from "../hooks/useTimeSince";
import shearers from "../shearers.json";

function MobileMonitorApp() {
  const { counts } = useCounts();
  return (
    <>
      <header className="App-header">
        <p>Shearing Monitor</p>
      </header>
      <section className="Esquilador-mobile-monitor">
        {shearers.map((shearer, index) => {
          const timeSince = useTimeSince(counts[index + 1].lastScanTime);
          return (
            <div key={index}>
              <div className="Esquilador-mobile-header">
                {index + 1}: {shearer.name} -- {counts[index + 1].counted}
              </div>
              <div className={`Tag-Display-none`}>Tiempo: {timeSince}</div>
              <div className={`Tag-Display-${counts[index + 1].lastTagColor}`}>
                {counts[index + 1].lastTag}
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}

export default MobileMonitorApp;
