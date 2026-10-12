import React, { useEffect, useRef } from 'react';
import { languagePicker } from './browser-language.js';
// Only mount on an idle screen: switching languages must never discard an animal.
export default function LanguagePicker() {
  const container = useRef(null);
  useEffect(() => { const picker = languagePicker(container.current); return () => picker.remove(); }, []);
  return <div ref={container} />;
}
