import assert from "node:assert/strict";
import test from "node:test";

import { ranchDay, RANCH_TIMEZONE } from "../../shared/ranchdate.js";
import { uuidv7 } from "../../shared/uuidv7.js";

test("UUIDv7 has the correct version, variant, and embedded timestamp", () => {
  const timestamp = 1_725_000_123_456;
  const id = uuidv7(timestamp);

  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16), timestamp);
});

test("UUIDv7 values sort chronologically across timestamps", () => {
  const earlier = uuidv7(1_700_000_000_000);
  const later = uuidv7(1_700_000_000_001);
  assert.ok(earlier < later);
  assert.notEqual(uuidv7(1_700_000_000_000), uuidv7(1_700_000_000_000));
});

test("ranch calendar dates use Chile summer and winter offsets", () => {
  assert.equal(RANCH_TIMEZONE, "America/Santiago");
  assert.equal(ranchDay("2026-01-01T02:59:59.999Z"), "2025-12-31");
  assert.equal(ranchDay("2026-01-01T03:00:00.000Z"), "2026-01-01");
  assert.equal(ranchDay("2026-07-01T03:59:59.999Z"), "2026-06-30");
  assert.equal(ranchDay("2026-07-01T04:00:00.000Z"), "2026-07-01");
  assert.equal(ranchDay("not-a-date"), null);
});
