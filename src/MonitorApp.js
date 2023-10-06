import { useState, useEffect } from "react";

import "./App.css";

function MonitorApp({ counts, refreshCounts }) {
  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);
  return (
    <>
      <header className="App-header">
        <p>Shearing Monitor</p>
      </header>
      <section className="Esquilador-monitor">
        <div>
          <div className="Esquilador-header">
            1: Angel -- {counts[1].counted}
          </div>
          <div className={`Tag-Display-none`}>
            B: {counts[1].borrega} -- C: {counts[1].carnero}
          </div>
          <div className={`Tag-Display-${counts[1].lastTagColor}`}>
            {counts[1].lastTag}
          </div>
        </div>
        <div>
          <div className="Esquilador-header">
            2: Pacheco -- {counts[2].counted}
          </div>
          <div className={`Tag-Display-none`}>
            B: {counts[2].borrega} -- C: {counts[2].carnero}
          </div>
          <div className={`Tag-Display-${counts[2].lastTagColor}`}>
            {counts[2].lastTag}
          </div>
        </div>
        <div>
          <div className="Esquilador-header">
            3: Jesus -- {counts[3].counted}
          </div>
          <div className={`Tag-Display-none`}>
            B: {counts[3].borrega} -- C: {counts[3].carnero}
          </div>
          <div className={`Tag-Display-${counts[3].lastTagColor}`}>
            {counts[3].lastTag}
          </div>
        </div>
      </section>
    </>
  );
}

export default MonitorApp;
