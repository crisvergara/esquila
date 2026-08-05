// IndexedDB persistence for EsquilaDB's offline-first mode.
// - "meta": key-value store (device token, device name, last snapshot)
// - "outbox": pending writes waiting for the cloud, keyed by `${table}:${rowId}`
//   so a later edit/tombstone of the same row replaces the earlier entry.
import { openDB } from "idb";

const dbPromise = openDB("esquiladb", 1, {
  upgrade(db) {
    db.createObjectStore("meta");
    db.createObjectStore("outbox", { keyPath: "key" });
  },
});

export async function getMeta(key) {
  return (await dbPromise).get("meta", key);
}

export async function setMeta(key, value) {
  return (await dbPromise).put("meta", value, key);
}

export async function deleteMeta(key) {
  return (await dbPromise).delete("meta", key);
}

export async function putOutbox(table, row) {
  return (await dbPromise).put("outbox", { key: `${table}:${row.id}`, table, row });
}

export async function getOutbox() {
  return (await dbPromise).getAll("outbox");
}

export async function removeOutbox(keys) {
  const db = await dbPromise;
  const tx = db.transaction("outbox", "readwrite");
  for (const key of keys) {
    tx.store.delete(key);
  }
  await tx.done;
}
