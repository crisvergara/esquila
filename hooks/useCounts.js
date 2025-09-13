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

  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);

  return { counts, refreshCounts };
};

export default useCounts;
