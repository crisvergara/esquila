// Sync client for esquila-cloud: drains the local outbox (push) and refreshes
// the full-flock snapshot (pull). All requests carry the device bearer token.
import {
  getMeta,
  setMeta,
  deleteMeta,
  getOutbox,
  putOutbox,
  removeOutbox,
} from "./localdb.js";

export class AuthError extends Error {}

async function authedFetch(path, options = {}) {
  const token = await getMeta("token");
  if (!token) throw new AuthError("not enrolled");
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 401) throw new AuthError("token rejected");
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

// Queue a row locally. It shows up in the UI immediately (merged over the
// snapshot) and is pushed to the cloud on the next drain.
export async function enqueue(table, row) {
  await putOutbox(table, row);
}

export async function loadPending() {
  return getOutbox();
}

export async function loadSnapshot() {
  return getMeta("snapshot");
}

// Push every pending write in one idempotent batch. Only clears the outbox
// after the cloud confirms, so a failure just retries later.
export async function drainOutbox() {
  const entries = await getOutbox();
  if (entries.length === 0) return 0;
  const byTable = {};
  for (const entry of entries) {
    (byTable[entry.table] ??= []).push(entry.row);
  }
  await authedFetch("/api/sync/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      batches: Object.entries(byTable).map(([table, rows]) => ({ table, rows })),
    }),
  });
  await removeOutbox(entries.map((e) => e.key));
  return entries.length;
}

// Replace the local snapshot wholesale with the cloud's current state.
export async function refreshSnapshot() {
  const data = await authedFetch("/api/snapshot");
  const snapshot = { ...data, fetchedAt: new Date().toISOString() };
  await setMeta("snapshot", snapshot);
  return snapshot;
}

export async function getEnrollment() {
  const token = await getMeta("token");
  if (!token) return null;
  return { deviceName: (await getMeta("deviceName")) ?? "phone" };
}

export async function saveEnrollment(token, deviceName) {
  await setMeta("token", token);
  await setMeta("deviceName", deviceName ?? "phone");
}

export async function clearEnrollment() {
  await deleteMeta("token");
}
