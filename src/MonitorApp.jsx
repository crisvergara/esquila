import { useState, useEffect } from "react";
import shearers from "../shearers.json";

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

const useCurrentTime = () => {
  const [currentTime, setCurrentTime] = useState(
    new Date().toLocaleString().split(" ")[1]
  );
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date().toLocaleString().split(" ")[1]);
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, []);
  return currentTime;
};

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

function MonitorApp({ counts, refreshCounts }) {
  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);
  const currentTime = useCurrentTime();
  return (
    <div className="Monitor-app">
      <header className="Monitor-app-header">
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
