import { useSyncExternalStore } from 'react';

// One short request per page supplies both hooks. Persistent HTTP/1 streams
// exhaust the browser's six-connection pool across repeated tagger tabs.
let state = { counts: {}, mode: 'oveja', error: null };
const listeners = new Set();
let timer;
let pending;
let controller;
let failures = 0;
const notify = () => { for (const listener of listeners) listener(); };

export function refreshRanchState() {
  if (pending) return pending;
  clearTimeout(timer);
  controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  pending = (async () => {
    try {
      const response = await fetch('/api/live', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`Estado del galpón: ${response.status}`);
      const next = await response.json();
      if (!next.counts || typeof next.counts !== 'object' || !['oveja', 'carnero', 'carnillero'].includes(next.mode)) throw new Error('Estado del galpón inválido');
      failures = 0;
      state = { counts: next.counts, mode: next.mode, error: null };
      notify();
      return state;
    } catch (error) {
      failures++;
      state = { ...state, error: 'Sin conexión con el galpón. Revisa el WiFi; los datos pueden estar atrasados. Reintentando…' };
      notify();
      throw error;
    } finally {
      clearTimeout(timeout);
      pending = null;
      controller = null;
      if (listeners.size) timer = setTimeout(poll, failures ? Math.min(1000 * 2 ** Math.min(failures, 4), 10000) : document.hidden ? 5000 : 1000);
    }
  })();
  return pending;
}
function poll() { refreshRanchState().catch(() => {}); }
function wake() { if (!document.hidden) poll(); }
function subscribe(listener) {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    poll();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearTimeout(timer);
      controller?.abort();
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    }
  };
}
export default function useRanchState() {
  return useSyncExternalStore(subscribe, () => state);
}
