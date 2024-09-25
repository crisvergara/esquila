import TaggingApp from "./TaggingApp";
import MonitorApp from "./MonitorApp";
import BulkLambApp from "./BulkLambApp";
import RamApp from "./RamApp";
import { useState, useEffect, useCallback } from "react";

const App = () => {
  const [counts, setCounts] = useState({
    1: {
      lastTag: "",
      lastTagColor: "none",
      counted: 0,
    },
    2: {
      lastTag: "",
      lastTagColor: "none",
      counted: 0,
    },
    3: {
      lastTag: "",
      lastTagColor: "none",
      counted: 0,
    },
  });

  const refreshCounts = useCallback(async () => {
    const countsRes = await fetch("/count");
    setCounts(await countsRes.json());
  }, []);
  useEffect(() => {
    let interval = setInterval(async () => {
      try {
        await refreshCounts();
      } catch (error) {
        console.error(error);
      }
    }, 3000);
    return () => {
      clearInterval(interval);
    };
  }, [refreshCounts]);

  if (window.location.hash === "#monitor") {
    return <MonitorApp counts={counts} refreshCounts={refreshCounts} />;
  } else if (window.location.hash === "#bulk") {
    return <BulkLambApp counts={counts} refreshCounts={refreshCounts} />;
  } else if (window.location.hash === "#ram") {
    return <RamApp counts={counts} refreshCounts={refreshCounts} />;
  }
  return <TaggingApp counts={counts} refreshCounts={refreshCounts} />;
};

export default App;
