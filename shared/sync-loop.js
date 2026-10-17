// A serial retry loop. Lifecycle hints bypass backoff, but never overlap writes
// or acknowledgements. Several hints during one attempt become one follow-up.
export function createSyncLoop({ run, intervalMs, maxBackoffMs, onError = () => {},
  schedule = setTimeout, cancel = clearTimeout }) {
  let timer, running, controller, finishing;
  let stopped = false, pending = false, delay = intervalMs;

  function attempt() {
    controller = new AbortController();
    const signal = controller.signal;
    running = Promise.resolve().then(() => run(signal)).then(nextDelay => {
      delay = nextDelay ?? intervalMs;
    }, error => {
      delay = Math.min(delay * 2, maxBackoffMs);
      if (!stopped) onError(error, delay);
    }).finally(() => {
      running = undefined;
      if (stopped) return;
      if (pending) {
        pending = false;
        delay = intervalMs;
        attempt();
      } else {
        timer = schedule(() => { timer = undefined; attempt(); }, delay);
      }
    });
  }

  return {
    request() {
      if (stopped) return;
      cancel(timer);
      timer = undefined;
      delay = intervalMs;
      if (running) pending = true;
      else attempt();
    },
    finish(signal) {
      if (finishing) return finishing;
      stopped = true;
      pending = false;
      cancel(timer);
      // Cancel an offline/hung attempt before giving the final attempt its
      // bounded opportunity. An ambiguous upload is safe to replay by ID.
      controller?.abort();
      finishing = (async () => {
        await running;
        signal.throwIfAborted();
        await run(signal);
      })().catch(error => { onError(error, null); });
      return finishing;
    },
  };
}
