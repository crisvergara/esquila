import modes from "../tagger/modeschema.json";
import { useState, useEffect } from "react";

const useTaggingMode = () => {
  const [currentMode, setCurrentMode] = useState(modes[0]);

  useEffect(() => {
    const eventSource = new EventSource("/sse");
    eventSource.onmessage = (event) => {
      try {
        const nextMode = JSON.parse(event.data).mode;
        const nextModeObject = modes.find((mode) => mode.type === nextMode);
        if (nextModeObject) setCurrentMode(nextModeObject);
      } catch (error) {
        console.error("Invalid mode update", error);
      }
    };
    return () => {
      eventSource.close();
    };
  }, []);

  return currentMode;
};

export default useTaggingMode;
