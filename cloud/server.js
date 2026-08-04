// esquila-cloud: the remote hub. Receives sync pushes from the ranch server
// and from phones running EsquilaDB, serves the full-flock snapshot, and
// hosts the EsquilaDB PWA over HTTPS (same origin — no CORS, and the secure
// context the service worker needs).
//
// Env: DATABASE_URL (Postgres/Neon), ADMIN_TOKEN, PORT (default 8080),
//      PUBLIC_URL (optional, for enrollment QR links behind a proxy).

import express from "express";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import QRCode from "qrcode";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = path.join(__dirname, "..", "build-cloud");
const port = process.env.PORT ?? 8080;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
if (!process.env.ADMIN_TOKEN) {
  console.error("ADMIN_TOKEN is required");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const schema = await readFile(path.join(__dirname, "schema.sql"), "utf8");
await pool.query(schema);
console.log("Schema applied");

const app = express();
app.set("trust proxy", true);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const bearerToken = (req) => {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
};

// Device auth: phones and the ranch server hold long random bearer tokens,
// enrolled via /admin. Only the sha256 of a token is stored.
const deviceAuth = async (req, res, next) => {
  try {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: "missing token" });
    const { rows } = await pool.query(
      "SELECT id, name, role FROM devices WHERE token_hash = $1",
      [sha256(token)]
    );
    if (rows.length === 0) return res.status(401).json({ error: "invalid token" });
    req.device = rows[0];
    pool
      .query("UPDATE devices SET last_seen_at = now() WHERE id = $1", [rows[0].id])
      .catch(() => {});
    next();
  } catch (err) {
    next(err);
  }
};

const adminAuth = (req, res, next) => {
  const token = bearerToken(req);
  const expected = sha256(process.env.ADMIN_TOKEN);
  if (!token || !crypto.timingSafeEqual(Buffer.from(sha256(token)), Buffer.from(expected))) {
    return res.status(401).json({ error: "invalid admin token" });
  }
  next();
};

// --------------------------------------------------------------------------
// Sync: idempotent last-write-wins upserts keyed by client-generated UUIDv7.
// Replaying a batch is a no-op; a stale row never overwrites a newer one.
// --------------------------------------------------------------------------

const UPSERTS = {
  shearing_events: {
    columns: [
      "id", "tag", "station", "color", "lactation", "type",
      "wool_quality", "occurred_at", "updated_at", "deleted_at", "origin",
    ],
    required: ["id", "tag", "occurred_at", "updated_at"],
    sql: `
      INSERT INTO shearing_events
        (id, tag, station, color, lactation, type, wool_quality, occurred_at, updated_at, deleted_at, origin)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        tag = excluded.tag, station = excluded.station, color = excluded.color,
        lactation = excluded.lactation, type = excluded.type,
        wool_quality = excluded.wool_quality, occurred_at = excluded.occurred_at,
        updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
        origin = excluded.origin
      WHERE excluded.updated_at > shearing_events.updated_at
    `,
  },
  treatments: {
    columns: [
      "id", "tag", "type", "medication", "dose", "occurred_on",
      "recorded_at", "updated_at", "deleted_at", "origin",
    ],
    required: ["id", "tag", "type", "medication", "occurred_on", "recorded_at", "updated_at"],
    sql: `
      INSERT INTO treatments
        (id, tag, type, medication, dose, occurred_on, recorded_at, updated_at, deleted_at, origin)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        tag = excluded.tag, type = excluded.type, medication = excluded.medication,
        dose = excluded.dose, occurred_on = excluded.occurred_on,
        recorded_at = excluded.recorded_at, updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at, origin = excluded.origin
      WHERE excluded.updated_at > treatments.updated_at
    `,
  },
  treatment_presets: {
    columns: ["id", "type", "medication", "dose", "updated_at", "deleted_at"],
    required: ["id", "type", "medication", "updated_at"],
    sql: `
      INSERT INTO treatment_presets (id, type, medication, dose, updated_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        type = excluded.type, medication = excluded.medication, dose = excluded.dose,
        updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
      WHERE excluded.updated_at > treatment_presets.updated_at
    `,
  },
};

app.post("/api/sync/push", deviceAuth, express.json({ limit: "20mb" }), async (req, res) => {
  const batches = req.body?.batches;
  if (!Array.isArray(batches)) {
    return res.status(400).json({ error: "batches array required" });
  }
  for (const batch of batches) {
    if (!UPSERTS[batch.table]) {
      return res.status(400).json({ error: `unknown table: ${batch.table}` });
    }
    if (!Array.isArray(batch.rows)) {
      return res.status(400).json({ error: "rows array required" });
    }
    for (const row of batch.rows) {
      for (const field of UPSERTS[batch.table].required) {
        if (row[field] === undefined || row[field] === null || row[field] === "") {
          return res
            .status(400)
            .json({ error: `${batch.table} row ${row.id ?? "?"} missing ${field}` });
        }
      }
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const applied = {};
    for (const batch of batches) {
      const spec = UPSERTS[batch.table];
      for (const row of batch.rows) {
        const values = spec.columns.map((col) =>
          col === "origin" ? (row.origin ?? req.device.name) : (row[col] ?? null)
        );
        await client.query(spec.sql, values);
      }
      applied[batch.table] = (applied[batch.table] ?? 0) + batch.rows.length;
    }
    await client.query("COMMIT");
    res.json({ ok: true, applied });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("sync/push failed:", err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Full-flock snapshot: everything the phone needs to work offline.
// Live rows only — the client replaces its whole local snapshot on refresh,
// so tombstones never need to travel down.
app.get("/api/snapshot", deviceAuth, async (req, res, next) => {
  try {
    const [events, treatments, presets] = await Promise.all([
      pool.query(`
        SELECT id, tag, station, color, lactation, type, wool_quality, occurred_at, updated_at
        FROM shearing_events WHERE deleted_at IS NULL
        ORDER BY occurred_at DESC
      `),
      pool.query(`
        SELECT id, tag, type, medication, dose, occurred_on::text AS occurred_on,
               recorded_at, updated_at, origin
        FROM treatments WHERE deleted_at IS NULL
        ORDER BY recorded_at DESC
      `),
      pool.query(`
        SELECT id, type, medication, dose, updated_at
        FROM treatment_presets WHERE deleted_at IS NULL
        ORDER BY type, medication
      `),
    ]);
    res.json({
      server_time: new Date().toISOString(),
      shearing_events: events.rows,
      treatments: treatments.rows,
      presets: presets.rows,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// Device enrollment (admin)
// --------------------------------------------------------------------------

app.get("/api/admin/devices", adminAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, role, created_at, last_seen_at FROM devices ORDER BY created_at"
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.post("/api/admin/devices", adminAuth, express.json(), async (req, res, next) => {
  try {
    const name = (req.body?.name ?? "").trim();
    const role = req.body?.role === "server" ? "server" : "phone";
    if (!name) return res.status(400).json({ error: "name required" });

    const token = crypto.randomBytes(32).toString("base64url");
    const { rows } = await pool.query(
      "INSERT INTO devices (name, token_hash, role) VALUES ($1, $2, $3) RETURNING id",
      [name, sha256(token), role]
    );
    const base = process.env.PUBLIC_URL ?? `${req.protocol}://${req.get("host")}`;
    const enrollUrl = `${base}/#token=${token}&name=${encodeURIComponent(name)}`;
    const qrDataUrl = await QRCode.toDataURL(enrollUrl, { width: 360 });
    res.json({ id: rows[0].id, name, role, token, enrollUrl, qrDataUrl });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/admin/devices/:id", adminAuth, async (req, res, next) => {
  try {
    await pool.query("DELETE FROM devices WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/healthz", (req, res) => res.json({ ok: true }));

// --------------------------------------------------------------------------
// Static EsquilaDB PWA
// --------------------------------------------------------------------------

if (existsSync(BUILD_DIR)) {
  app.use(express.static(BUILD_DIR));
  // SPA fallback for direct navigations (the app is hash-routed, but the
  // service worker's navigateFallback expects index.html to exist here).
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api")) {
      return res.sendFile(path.join(BUILD_DIR, "index.html"));
    }
    next();
  });
} else {
  console.warn(`No PWA build found at ${BUILD_DIR} — run: npm run build:cloud`);
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal error" });
});

app.listen(port, () => {
  console.log(`esquila-cloud listening on port ${port}`);
});
