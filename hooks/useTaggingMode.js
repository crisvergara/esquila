import mode from "../tagger/modeschema.json";
import { useState, useEffect } from "react";

const eventSource = new EventSource("/sse");

const useTaggingMode = () => {
  const [currentMode, setCurrentMode] = useState(mode[0]);

  useEffect(() => {
    eventSource.onmessage = (event) => {
      const nextMode = JSON.parse(event.data).mode;
      const nextModeObject = mode.find((m) => m.type === nextMode) || mode[0];
      setCurrentMode(nextModeObject);
    };
    return () => {
      eventSource.close();
    };
  }, []);

  return currentMode;
};

export default useTaggingMode;
