import { useState, useEffect } from "react";

import "./MobileMonitorApp.css";

const timeSinceISO = (isoString) => {
  if (!isoString) return "00:00:00";
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const elapsed = now - then;
  const hours = Math.floor(elapsed / 1000 / 60 / 60);
  const minutes = Math.floor(elapsed / 1000 / 60) % 60;
  const seconds = Math.floor(elapsed / 1000) % 60;

  const hoursString = "00".slice(hours.toString().length) + hours;
  const minutesString = "00".slice(minutes.toString().length) + minutes;
  const secondsString = "00".slice(seconds.toString().length) + seconds;
  return `${hoursString}:${minutesString}:${secondsString}`;
};

const useTimeSince = (isoString) => {
  const [timeSince, setTimeSince] = useState("00:00:00");
  useEffect(() => {
    setTimeSince(timeSinceISO(isoString));
    const interval = setInterval(() => {
      setTimeSince(timeSinceISO(isoString));
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [isoString]);
  return timeSince;
};

function MobileMonitorApp({ counts, refreshCounts }) {
  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);
  const timeSince1 = useTimeSince(counts[1].lastScanTime);
  const timeSince2 = useTimeSince(counts[2].lastScanTime);
  const timeSince3 = useTimeSince(counts[3].lastScanTime);
  return (
    <>
      <header className="App-header">
        <p>Shearing Monitor</p>
      </header>
      <section className="Esquilador-mobile-monitor">
        <div>
          <div className="Esquilador-mobile-header">
            1: Bastian -- {counts[1].counted}
          </div>
          <div className={`Tag-Display-none`}>Tiempo: {timeSince1}</div>
          {/*<div className={`Tag-Display-none`}>
            B: {counts[1].borrega} -- C: {counts[1].carnero}
  </div>*/}
          <div className={`Tag-Display-${counts[1].lastTagColor}`}>
            {counts[1].lastTag}
          </div>
        </div>
        <div>
          <div className="Esquilador-mobile-header">
            2: Carlos -- {counts[2].counted}
          </div>
          <div className={`Tag-Display-none`}>Tiempo: {timeSince2}</div>
          {/*<div className={`Tag-Display-none`}>
            B: {counts[2].borrega} -- C: {counts[2].carnero}
</div>*/}
          <div className={`Tag-Display-${counts[2].lastTagColor}`}>
            {counts[2].lastTag}
          </div>
        </div>
        <div>
          <div className="Esquilador-mobile-header">
            3: Salvador -- {counts[3].counted}
          </div>
          <div className={`Tag-Display-none`}>Tiempo: {timeSince3}</div>
          {/*<div className={`Tag-Display-none`}>
            B: {counts[3].borrega} -- C: {counts[3].carnero}
</div>*/}
          <div className={`Tag-Display-${counts[3].lastTagColor}`}>
            {counts[3].lastTag}
          </div>
        </div>
      </section>
    </>
  );
}

export default MobileMonitorApp;
