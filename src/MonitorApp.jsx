import { useState, useEffect } from "react";

import "./MonitorApp.css";

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

function MonitorApp({ counts, refreshCounts }) {
  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);
  const timeSince1 = useTimeSince(counts[1].lastScanTime);
  const timeSince2 = useTimeSince(counts[2].lastScanTime);
  const timeSince3 = useTimeSince(counts[3].lastScanTime);
  return (
    <>
      <header className="Monitor-app-header">
        <p>Shearing Monitor</p>
      </header>
      <section className="Esquilador-monitor">
        <div className="Esquilador-row">
          <div className="Esquilador-header">
          <p>Salvador</p> <p>{counts[1].counted}</p>
          </div>
          <div className={`Esquilador-Tag-Display-${counts[1].lastTagColor}`}>
            {counts[1].lastTag}
          </div>
          <div className={`Esquilador-Tag-Display-none`}>{timeSince1}</div>
          {/*<div className={`Tag-Display-none`}>
            B: {counts[1].borrega} -- C: {counts[1].carnero}
  </div>*/}
        </div>
        <div className="Esquilador-row">
          <div className="Esquilador-header">
            <p>Bastian</p> <p>{counts[2].counted}</p>
          </div>
          <div className={`Esquilador-Tag-Display-${counts[2].lastTagColor}`}>
            {counts[2].lastTag}
          </div>
          <div className={`Esquilador-Tag-Display-none`}>{timeSince2}</div>
          {/*<div className={`Tag-Display-none`}>
            B: {counts[2].borrega} -- C: {counts[2].carnero}
</div>*/}
        </div>
        <div className="Esquilador-row">
          <div className="Esquilador-header">
          <p>Carlos</p> <p>{counts[3].counted}</p>
          </div>
          <div className={`Esquilador-Tag-Display-${counts[3].lastTagColor}`}>
            {counts[3].lastTag}
          </div>
          <div className={`Esquilador-Tag-Display-none`}>{timeSince3}</div>
          {/*<div className={`Tag-Display-none`}>
            B: {counts[3].borrega} -- C: {counts[3].carnero}
</div>*/}
        </div>
      </section>
    </>
  );
}

export default MonitorApp;
