import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncLoop } from '../../shared/sync-loop.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(run) {
  const timers = new Map(), errors = [];
  let id = 0;
  const loop = createSyncLoop({ run, intervalMs: 60, maxBackoffMs: 600,
    schedule(fn, ms) { timers.set(++id, { fn, ms }); return id; },
    cancel(key) { timers.delete(key); },
    onError(error, delay) { errors.push({ error, delay }); },
  });
  return { loop, timers, errors, fire() {
    const [key, timer] = timers.entries().next().value;
    timers.delete(key); timer.fn();
  } };
}

test('startup is immediate; a reconnect cancels backoff; success restores normal polling', async () => {
  let calls = 0;
  const f = fixture(async () => { if (++calls <= 2) throw new Error('offline'); });
  f.loop.request(); await tick();
  assert.equal(calls, 1);
  assert.equal([...f.timers.values()][0].ms, 120);
  f.fire(); await tick();
  assert.equal([...f.timers.values()][0].ms, 240);
  f.loop.request(); await tick();
  assert.equal(calls, 3);
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].ms, 60);
});

test('repeated hints coalesce to one follow-up without overlapping an in-flight request', async () => {
  let calls = 0, active = 0, release;
  const f = fixture(async () => {
    calls++; active++;
    assert.equal(active, 1);
    await new Promise(resolve => { release = resolve; });
    active--;
  });
  f.loop.request(); await tick();
  for (let i = 0; i < 30; i++) f.loop.request();
  assert.equal(calls, 1);
  release(); await tick();
  assert.equal(calls, 2);
  release(); await tick();
  assert.equal(calls, 2);
  assert.equal(f.timers.size, 1);
});

test('shutdown aborts a stuck attempt, retries serially, and never restarts polling', async () => {
  let calls = 0, active = 0;
  const f = fixture(async signal => {
    calls++; active++;
    assert.equal(active, 1);
    if (calls === 1) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    active--;
    signal.throwIfAborted();
  });
  f.loop.request(); await tick();
  f.loop.request();
  const signal = new AbortController().signal;
  const finished = f.loop.finish(signal);
  assert.equal(f.loop.finish(signal), finished);
  await finished;
  f.loop.request(); await tick();
  assert.equal(calls, 2);
  assert.equal(f.timers.size, 0);
  assert.equal(f.errors.length, 0);
});

test('failed final attempts are reported without deleting retry state or scheduling again', async () => {
  const f = fixture(async () => { throw new Error('offline'); });
  await f.loop.finish(new AbortController().signal);
  assert.equal(f.errors.length, 1);
  assert.equal(f.errors[0].delay, null);
  assert.equal(f.timers.size, 0);
});

test('loops retry independently and a successful manifest can request an early acknowledgement', async () => {
  const data = fixture(async () => { throw new Error('offline'); });
  const config = fixture(async () => 1);
  data.loop.request(); config.loop.request(); await tick();
  assert.equal([...data.timers.values()][0].ms, 120);
  assert.equal([...config.timers.values()][0].ms, 1);
});
