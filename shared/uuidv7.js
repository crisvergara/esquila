// UUIDv7: 48-bit unix-ms timestamp + version/variant bits + 74 random bits.
// Works in Node 18+ and browsers (both expose globalThis.crypto).
// Accepts an explicit timestamp so migrated historical rows get ids that
// sort by their original event time.
export function uuidv7(timestampMs = Date.now()) {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);

  let ts = BigInt(Math.max(0, Math.floor(timestampMs)));
  for (let i = 5; i >= 0; --i) {
    bytes[i] = Number(ts & 0xffn);
    ts >>= 8n;
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
