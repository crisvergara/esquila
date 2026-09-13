import { useState, useEffect } from "react";
import baked from "../shearers.json";

// Shearer names are editable at runtime via the Pi onboarding wizard, so the
// LAN apps fetch them from the server. The build-time JSON renders instantly
// as a fallback until (or in case) the fetch resolves.
const useShearers = () => {
  const [shearers, setShearers] = useState(baked);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/shearers")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) setShearers(data);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  return { shearers, loaded };
};

export default useShearers;
