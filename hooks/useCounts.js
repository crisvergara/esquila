import { useState, useEffect, useCallback } from "react";

const useCounts = () => {
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
    if (!countsRes.ok) throw new Error(`Count refresh failed (${countsRes.status})`);
    const nextCounts = await countsRes.json();
    if (!nextCounts || typeof nextCounts !== "object") {
      throw new Error("Count refresh returned invalid data");
    }
    setCounts(nextCounts);
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        await refreshCounts();
      } catch (error) {
        console.error(error);
      }
    }, 10000);
    return () => {
      clearInterval(interval);
    };
  }, [refreshCounts]);

  useEffect(() => {
    refreshCounts().catch((error) => console.error(error));
  }, [refreshCounts]);

  useEffect(() => {
    const events = new EventSource("/count/events");
    events.onmessage = (event) => {
      try {
        const nextCounts = JSON.parse(event.data);
        if (nextCounts && typeof nextCounts === "object") setCounts(nextCounts);
      } catch (error) {
        console.error("Invalid count update", error);
      }
    };
    events.onerror = () => {
      // The periodic fetch above remains as a fallback while SSE reconnects.
    };
    return () => events.close();
  }, []);

  return { counts, refreshCounts };
};

export default useCounts;
