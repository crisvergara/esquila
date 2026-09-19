// esquila-cloud: the remote hub. Receives sync pushes from the ranch server
// and from phones running EsquilaDB, serves the full-flock snapshot, and
// hosts the EsquilaDB PWA over HTTPS (same origin — no CORS, and the secure
// context the service worker needs).
//
// Env: DATABASE_URL (Postgres/Neon), ADMIN_PASSWORD (or legacy ADMIN_TOKEN),
//      PORT (default 8080),
//      PUBLIC_URL (optional, for enrollment QR links behind a proxy).

import express from "express";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import QRCode from "qrcode";
import { registerRanchManagement } from "./ranch-management.js";
import { registerMacUpdates } from "./mac-updates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = path.join(__dirname, "..", "build-cloud");
const port = process.env.PORT ?? 8080;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const ADMIN_SECRET = process.env.ADMIN_PASSWORD ?? process.env.ADMIN_TOKEN;
if (!ADMIN_SECRET) {
  console.error("ADMIN_PASSWORD (or legacy ADMIN_TOKEN) is required");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // Recycle idle clients quickly: Neon's pooler drops idle connections
  // (scale-to-zero), and a dropped idle client emits a pool-level error.
  idleTimeoutMillis: 30_000,
  max: 5,
});

// An idle client dying (e.g. Neon suspending) must not crash the server;
// the pool replaces it on the next query.
pool.on("error", (err) => {
  console.error("Idle Postgres client error (ignored):", err.message);
});

const schema = await readFile(path.join(__dirname, "schema.sql"), "utf8");
await pool.query(schema);
console.log("Schema applied");

const app = express();
registerMacUpdates(app);
// Fly Proxy is the one immediate hop in front of the app. Trusting arbitrary
// proxy chains would let clients spoof req.ip and bypass login throttling.
app.set("trust proxy", 1);

const ADMIN_COOKIE = "esquila_admin_session";
const ADMIN_SECURE_COOKIE = "__Host-esquila_admin_session";
const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const adminSessions = new Map();
const loginFailures = new Map();

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const secretsEqual = (provided, expected) => {
  if (typeof provided !== "string" || !provided) return false;
  return crypto.timingSafeEqual(
    Buffer.from(sha256(provided), "hex"),
    Buffer.from(sha256(expected), "hex")
  );
};

const cookies = (req) => Object.fromEntries(
  (req.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const split = part.indexOf("=");
      return split === -1
        ? [part, ""]
        : [part.slice(0, split), decodeURIComponent(part.slice(split + 1))];
    })
);

const adminSession = (req) => {
  const parsed = cookies(req);
  const id = parsed[ADMIN_SECURE_COOKIE] ?? parsed[ADMIN_COOKIE];
  if (!id) return null;
  const expiresAt = adminSessions.get(id);
  if (!expiresAt || expiresAt <= Date.now()) {
    adminSessions.delete(id);
    return null;
  }
  return id;
};

const setAdminCookie = (req, res, id) => {
  const name = req.secure ? ADMIN_SECURE_COOKIE : ADMIN_COOKIE;
  const secure = req.secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${name}=${encodeURIComponent(id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(ADMIN_SESSION_MS / 1000)}${secure}`
  );
};

const clearAdminCookie = (req, res) => {
  const name = req.secure ? ADMIN_SECURE_COOKIE : ADMIN_COOKIE;
  const secure = req.secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`
  );
};

app.use((req, res, next) => {
  if (
    req.path === "/admin" ||
    req.path === "/admin.js" ||
    req.path === "/login.js" ||
    req.path.startsWith("/api/admin")
  ) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    );
    if (req.secure)
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

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
  const session = adminSession(req);
  if (!session && !secretsEqual(token, ADMIN_SECRET))
    return res.status(401).json({ error: "authentication required" });
  if (
    session &&
    req.method !== "GET" &&
    req.headers.origin !== `${req.protocol}://${req.get("host")}`
  ) {
    return res.status(403).json({ error: "invalid request origin" });
  }
  next();
};

// --------------------------------------------------------------------------
// Sync: idempotent last-write-wins upserts keyed by client-generated UUIDv7.
// Replaying a batch is a no-op; a stale row never overwrites a newer one.
// --------------------------------------------------------------------------

registerRanchManagement(app, { pool, adminAuth, deviceAuth });

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

const ROLE_TABLES = {
  phone: new Set(["treatments", "treatment_presets"]),
  server: new Set(Object.keys(UPSERTS)),
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
    if (!ROLE_TABLES[req.device.role]?.has(batch.table)) {
      return res.status(403).json({ error: `${req.device.role} devices cannot write ${batch.table}` });
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
    // Serialize shearing writers before acquiring row locks; revision order is commit order.
    if (batches.some(b => b.table === "shearing_events" && b.rows.length)) {
      await client.query('SELECT revision FROM shearing_sync_clock WHERE singleton FOR UPDATE');
    }
    const applied = {};
    for (const batch of batches) {
      const spec = UPSERTS[batch.table];
      for (const row of batch.rows) {
        const values = spec.columns.map((col) =>
          col === "origin" ? (row.origin ?? req.device.name) : (row[col] ?? null)
        );
        const result = await client.query(spec.sql, values);
        if (batch.table === "shearing_events" && result.rowCount === 0) {
          const existing = (await client.query('SELECT * FROM shearing_events WHERE id = $1', [row.id])).rows[0];
          const different = spec.columns.some((key, i) => {
            const current = existing[key] instanceof Date ? existing[key].toISOString() : existing[key];
            const incoming = ['occurred_at','updated_at','deleted_at'].includes(key) && values[i] ? new Date(values[i]).toISOString() : values[i];
            return current !== incoming;
          });
          if (different) await client.query(`INSERT INTO shearing_audit(row_id,source,before_row,after_row,dedupe)
            VALUES($1,'stale-push',$2,$3,$4) ON CONFLICT(dedupe) DO NOTHING`,
            [row.id, existing, row, sha256(JSON.stringify([row.id, values, existing.revision]))]);
        }
      }
      applied[batch.table] = (applied[batch.table] ?? 0) + batch.rows.length;
    }
    await client.query("COMMIT");
    res.json({ ok: true, applied });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("sync/push failed:", err.message);
    res.status(400).json({ error: "invalid sync batch" });
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
        SELECT id, tag, station, color, lactation, type, wool_quality,
               occurred_at, updated_at, origin
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

app.post("/api/admin/login", express.json({ limit: "4kb" }), (req, res) => {
  const key = req.ip;
  const now = Date.now();
  for (const [ip, failures] of loginFailures) {
    const active = failures.filter((time) => now - time < LOGIN_WINDOW_MS);
    if (active.length) loginFailures.set(ip, active);
    else loginFailures.delete(ip);
  }
  for (const [id, expiresAt] of adminSessions) {
    if (expiresAt <= now) adminSessions.delete(id);
  }
  if (loginFailures.size > 10_000) loginFailures.clear();
  while (adminSessions.size > 10_000) {
    adminSessions.delete(adminSessions.keys().next().value);
  }
  const recent = (loginFailures.get(key) ?? []).filter((time) => now - time < LOGIN_WINDOW_MS);
  if (recent.length >= LOGIN_MAX_FAILURES) {
    loginFailures.set(key, recent);
    res.setHeader("Retry-After", String(Math.ceil((LOGIN_WINDOW_MS - (now - recent[0])) / 1000)));
    return res.status(429).json({ error: "too many attempts; try again later" });
  }
  if (!secretsEqual(req.body?.password, ADMIN_SECRET)) {
    recent.push(now);
    loginFailures.set(key, recent);
    return res.status(401).json({ error: "invalid password" });
  }
  loginFailures.delete(key);
  const id = crypto.randomBytes(32).toString("base64url");
  adminSessions.set(id, now + ADMIN_SESSION_MS);
  setAdminCookie(req, res, id);
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  if (req.headers.origin !== `${req.protocol}://${req.get("host")}`)
    return res.status(403).json({ error: "invalid request origin" });
  const id = adminSession(req);
  if (id) adminSessions.delete(id);
  clearAdminCookie(req, res);
  res.json({ ok: true });
});

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
    if (!name || name.length > 80)
      return res.status(400).json({ error: "name must be 1-80 characters" });

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
  const page = adminSession(req) ? "admin.html" : "login.html";
  res.sendFile(path.join(__dirname, page));
});

app.get("/admin.js", (_req, res) => {
  res.type("application/javascript").sendFile(path.join(__dirname, "admin.js"));
});

app.get("/login.js", (_req, res) => {
  res.type("application/javascript").sendFile(path.join(__dirname, "login.js"));
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
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "invalid JSON" });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "request body too large" });
  }
  res.status(500).json({ error: "internal error" });
});

app.listen(port, () => {
  console.log(`esquila-cloud listening on port ${port}`);
});
