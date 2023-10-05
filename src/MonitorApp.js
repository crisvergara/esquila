import { useState, useEffect } from "react";

import "./App.css";

function MonitorApp() {
  const [stats, setStats] = useState({
    1: {
      lastTag: "",
      counted: 0,
    },
    2: {
      lastTag: "",
      counted: 0,
    },
    3: {
      lastTag: "",
      counted: 0,
    },
  });
  useEffect(() => {
    const handle = setInterval(async () => {
      const res = await fetch("/count");
      const obj = await res.json();
      setStats(obj);
    }, 5000);
    return () => {
      clearInterval(handle);
    };
  }, []);
  return (
    <>
      <header className="App-header">
        <p>Shearing Monitor</p>
      </header>
      <section className="Esquilador-monitor">
        <div>
          <div className="Esquilador-header">
            1: Angel -- {stats[1].counted}
          </div>
          <div className={`Tag-Display-${stats[1].lastTagColor}`}>
            {stats[1].lastTag}
          </div>
        </div>
        <div>
          <div className="Esquilador-header">
            2: Pacheco -- {stats[2].counted}
          </div>
          <div className={`Tag-Display-${stats[2].lastTagColor}`}>
            {stats[2].lastTag}
          </div>
        </div>
        <div>
          <div className="Esquilador-header">
            3: Jesus -- {stats[3].counted}
          </div>
          <div className={`Tag-Display-${stats[3].lastTagColor}`}>
            {stats[3].lastTag}
          </div>
        </div>
      </section>
    </>
  );
}

export default MonitorApp;
