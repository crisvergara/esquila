import express from "express";
import bodyParser from "body-parser";
import Database from "better-sqlite3";
import QRCode from "qrcode";
import os from "os";
import process from "process";
import { PassThrough } from "node:stream";
import { createReadStream, readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import nodemailer from "nodemailer";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { unlink } from "node:fs/promises";
import EventEmitter from "events";
import { uuidv7 } from "./shared/uuidv7.js";
import { ranchDay } from "./shared/ranchdate.js";

const modeEmitter = new EventEmitter();
const countEmitter = new EventEmitter();

const app = express();
const port = Number(process.env.PORT) || 3001;

const db = new Database("esquila", {});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const taggingModes = JSON.parse(
  readFileSync(path.join(__dirname, "tagger", "modeschema.json"), "utf8")
);
const taggingModesByType = new Map(
  taggingModes.map((taggingMode) => [taggingMode.type, taggingMode])
);

const taggerConnectionInfo = () => {
  const candidates = Object.entries(os.networkInterfaces()).flatMap(
    ([interfaceName, addresses]) =>
      (addresses ?? [])
        .filter((address) =>
          !address.internal &&
          (address.family === "IPv4" || address.family === 4) &&
          !address.address.startsWith("169.254.")
        )
        .map((address) => {
          let score = 0;
          if (/^(en0|en1|wlan0|eth0)$/i.test(interfaceName)) score += 100;
          if (/^(utun|tun|tap|bridge|docker|vbox|vmnet)/i.test(interfaceName)) score -= 100;
          if (
            address.address.startsWith("10.") ||
            address.address.startsWith("192.168.") ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(address.address)
          ) score += 20;
          return { address: address.address, score };
        })
  );
  candidates.sort((a, b) => b.score - a.score);
  const localName = os.hostname().split(".")[0];
  const friendlyUrl = `http://${localName}.local:${port}/tagger/`;
  const url = candidates[0]
    ? `http://${candidates[0].address}:${port}/tagger/`
    : friendlyUrl;
  return { url, friendlyUrl };
};

// Shearer names are editable at runtime (Mac/Pi onboarding wizard). The live
// copy lives in the data directory (CWD); the repo file only seeds it.
const SHEARERS_FILE = path.resolve("shearers.json");
if (!existsSync(SHEARERS_FILE)) {
  copyFileSync(path.join(__dirname, "shearers.json"), SHEARERS_FILE);
}

const readShearers = () => {
  try {
    const parsed = JSON.parse(readFileSync(SHEARERS_FILE, "utf8"));
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch (e) {
    // fall through to repo default
  }
  return JSON.parse(readFileSync(path.join(__dirname, "shearers.json"), "utf8"));
};

const hasAwsCredentials = Boolean(
  process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
);

const s3Client = new S3Client({
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const sesClient = new SESv2Client({
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const transporter = nodemailer.createTransport({
  SES: { sesClient, SendEmailCommand },
});

// ---------------------------------------------------------------------------
// Schema bootstrap + migrations
//
// bootstrapLegacySchema brings a fresh OR pre-upgrade database to the "v0"
// shape the app had before sync support. migrateToV1 then rebuilds every
// table with sync-safe identity (UUIDv7 ids, updated_at, tombstones, origin)
// guarded by PRAGMA user_version, and backfills the sync outbox.
// ---------------------------------------------------------------------------

const bootstrapLegacySchema = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS counts (
      tag TEXT,
      station INTEGER,
      color TEXT,
      lactation TEXT,
      type TEXT,
      woolQuality TEXT,
      date TEXT
    )
  `);
  for (const alter of [
    "ALTER TABLE counts ADD COLUMN vaccinated INTEGER DEFAULT 0",
    "ALTER TABLE counts ADD COLUMN vaccinationDate TEXT",
    "ALTER TABLE treatments ADD COLUMN dose TEXT DEFAULT ''",
  ]) {
    try {
      db.exec(alter);
    } catch (e) {
      // Column already exists (or table created below already has it)
    }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS treatments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag TEXT NOT NULL,
      type TEXT NOT NULL,
      medication TEXT NOT NULL,
      date TEXT NOT NULL,
      dose TEXT DEFAULT ''
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS treatment_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      medication TEXT NOT NULL,
      dose TEXT DEFAULT ''
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      mode TEXT,
      email TEXT
    )
  `);
};

const migrateToV1 = db.transaction(() => {
  const nowIso = new Date().toISOString();
  const idFor = (dateText) => {
    const ts = Date.parse(dateText);
    return uuidv7(Number.isNaN(ts) ? Date.now() : ts);
  };

  // Fold legacy vaccinated flags into treatments (last run of the old
  // one-time migration, while the legacy columns still exist).
  const legacyRows = db
    .prepare(
      `SELECT tag, vaccinationDate FROM counts
       WHERE vaccinated = 1
         AND tag NOT IN (SELECT DISTINCT tag FROM treatments)`
    )
    .all();
  const insertLegacy = db.prepare(
    `INSERT INTO treatments (tag, type, medication, date) VALUES (?, 'vaccination', 'Desconocido', ?)`
  );
  for (const row of legacyRows) {
    insertLegacy.run(row.tag, row.vaccinationDate ?? nowIso);
  }
  if (legacyRows.length > 0) {
    console.log(`Migrated ${legacyRows.length} legacy vaccination records into treatments table`);
  }

  // counts: no primary key today, so rebuild the table around a UUIDv7 id.
  // Ids are seeded from each row's event date so they sort chronologically.
  db.exec(`
    CREATE TABLE counts_v1 (
      id TEXT PRIMARY KEY,
      tag TEXT,
      station INTEGER,
      color TEXT,
      lactation TEXT,
      type TEXT,
      woolQuality TEXT,
      date TEXT,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      origin TEXT NOT NULL DEFAULT 'ranch-server'
    )
  `);
  const insertCountV1 = db.prepare(`
    INSERT INTO counts_v1 (id, tag, station, color, lactation, type, woolQuality, date, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const oldCounts = db.prepare(
    `SELECT tag, station, color, lactation, type, woolQuality, date FROM counts ORDER BY rowid`
  );
  for (const row of oldCounts.all()) {
    insertCountV1.run(
      idFor(row.date),
      row.tag,
      row.station,
      row.color,
      row.lactation,
      row.type,
      row.woolQuality,
      row.date,
      row.date ?? nowIso
    );
  }
  db.exec("DROP TABLE counts");
  db.exec("ALTER TABLE counts_v1 RENAME TO counts");

  // treatments: UUID id, plus occurred_on — the ranch-local (America/Santiago)
  // calendar day. Historical rows had two date conventions (UTC-now and
  // local-noon ISO); both normalize correctly through ranchDay().
  db.exec(`
    CREATE TABLE treatments_v1 (
      id TEXT PRIMARY KEY,
      tag TEXT NOT NULL,
      type TEXT NOT NULL,
      medication TEXT NOT NULL,
      dose TEXT NOT NULL DEFAULT '',
      occurred_on TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      origin TEXT NOT NULL DEFAULT 'ranch-server'
    )
  `);
  const insertTreatmentV1 = db.prepare(`
    INSERT INTO treatments_v1 (id, tag, type, medication, dose, occurred_on, recorded_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const oldTreatments = db.prepare(
    `SELECT tag, type, medication, dose, date FROM treatments ORDER BY id`
  );
  for (const row of oldTreatments.all()) {
    insertTreatmentV1.run(
      idFor(row.date),
      row.tag,
      row.type,
      row.medication,
      row.dose ?? "",
      ranchDay(row.date) ?? ranchDay(),
      row.date,
      row.date ?? nowIso
    );
  }
  db.exec("DROP TABLE treatments");
  db.exec("ALTER TABLE treatments_v1 RENAME TO treatments");

  db.exec(`
    CREATE TABLE treatment_presets_v1 (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      medication TEXT NOT NULL,
      dose TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `);
  const insertPresetV1 = db.prepare(`
    INSERT INTO treatment_presets_v1 (id, type, medication, dose, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const oldPresets = db.prepare(`SELECT type, medication, dose FROM treatment_presets ORDER BY id`);
  for (const row of oldPresets.all()) {
    insertPresetV1.run(uuidv7(), row.type, row.medication, row.dose ?? "", nowIso);
  }
  db.exec("DROP TABLE treatment_presets");
  db.exec("ALTER TABLE treatment_presets_v1 RENAME TO treatment_presets");

  db.exec(`
    CREATE INDEX idx_counts_tag ON counts (tag);
    CREATE INDEX idx_counts_date ON counts (date);
    CREATE INDEX idx_treatments_tag ON treatments (tag);
    CREATE INDEX idx_treatments_day ON treatments (occurred_on);
    CREATE TABLE sync_outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      tbl TEXT NOT NULL,
      row_id TEXT NOT NULL
    );
  `);

  // Backfill: queue every existing row for the first push to the cloud.
  db.exec(`INSERT INTO sync_outbox (tbl, row_id) SELECT 'counts', id FROM counts`);
  db.exec(`INSERT INTO sync_outbox (tbl, row_id) SELECT 'treatments', id FROM treatments`);
  db.exec(`INSERT INTO sync_outbox (tbl, row_id) SELECT 'treatment_presets', id FROM treatment_presets`);

  db.pragma("user_version = 1");
});

bootstrapLegacySchema();
if (db.pragma("user_version", { simple: true }) < 1) {
  // The rebuild drops tables; keep a local safety copy of the pre-migration DB.
  const safetyCopy = `esquila-pre-v1-${new Date().toISOString().replaceAll(":", "-")}.sqlite`;
  await db.backup(safetyCopy);
  console.log(`Pre-migration backup written to ${safetyCopy}`);
  migrateToV1();
  console.log("Database migrated to sync-safe schema (v1)");
}

// A phone keeps the same submission id while retrying an uncertain request.
// Recording it in the same transaction as the count makes retries idempotent.
db.exec(`
  CREATE TABLE IF NOT EXISTS count_submissions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

// Additive migration: durable receipts protect editor retries after response loss.
if (db.pragma("user_version", { simple: true }) < 2) {
  db.transaction(() => {
    db.exec(`CREATE TABLE record_mutations (
      id TEXT PRIMARY KEY, request TEXT NOT NULL, result TEXT NOT NULL
    );
      CREATE INDEX idx_sync_outbox_row ON sync_outbox (tbl, row_id);
      CREATE TABLE lamb_sequence (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), value INTEGER NOT NULL);
      INSERT INTO lamb_sequence VALUES (1, 0)`);
    db.pragma("user_version = 2");
  })();
}

const getSettingsFromDb = db.prepare(`
  SELECT mode, email FROM settings
`);

const setSettingsFromDb = db.prepare(`
  INSERT INTO settings (mode, email) VALUES (?, ?)
`);

const updateSettingsFromDb = db.prepare(`
  UPDATE settings SET mode = ?
`);
let mode, email;
// If there is no mode in the database, set it to "oveja"
let settings = getSettingsFromDb.get();
if (!settings) {
  setSettingsFromDb.run("oveja", "esquila@sheepplusplus.com");
  mode = "oveja";
  email = "esquila@sheepplusplus.com";
} else {
  mode = settings.mode;
  email = settings.email;
}

const backupDb = async () => {
  if (!hasAwsCredentials) return;
  const backupName = `esquila-${new Date().toISOString()}.sqlite`;
  try {
    await db.backup(backupName);
    const command = new PutObjectCommand({
      Bucket: "sheepplusplus-backups",
      Key: backupName,
      Body: createReadStream(backupName),
    });
    await s3Client.send(command);

    // Delete the backup file
    await unlink(backupName);
  } catch (error) {
    console.error("Failed to backup database:", error);
  }
};

if (hasAwsCredentials) {
  setInterval(backupDb, 1000 * 60 * 10); // 10 minutes
} else {
  console.log("S3 backups disabled — no AWS credentials configured");
}

process.on("SIGTERM", async () => {
  console.log(`Received SIGTERM, exiting...`);
  await backupDb();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log(`Received SIGINT, exiting...`);
  await backupDb();
  process.exit(0);
});

const readTagsFromDb = db.prepare(`
  SELECT rowid, tag, station, color, lactation, type, woolQuality, date FROM counts
  WHERE date > date() AND deleted_at IS NULL
  ORDER BY date;
`);

const searchSheepByTag = db.prepare(`
  SELECT rowid, id, tag, station, color, lactation, type, woolQuality, date
  FROM counts
  WHERE tag = ? AND deleted_at IS NULL
  ORDER BY date
`);

const insertTreatment = db.prepare(`
  INSERT INTO treatments (id, tag, type, medication, dose, occurred_on, recorded_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const getTreatmentsByTag = db.prepare(`
  SELECT id, tag, type, medication, dose, occurred_on, recorded_at AS date
  FROM treatments
  WHERE tag = ? AND deleted_at IS NULL
  ORDER BY recorded_at DESC
`);

const softDeleteTreatmentById = db.prepare(`
  UPDATE treatments SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL
`);

const getTreatmentCountsByTag = db.prepare(`
  SELECT tag,
    SUM(CASE WHEN type = 'vaccination' THEN 1 ELSE 0 END) AS vaccinations,
    SUM(CASE WHEN type = 'deworming' THEN 1 ELSE 0 END) AS dewormings
  FROM treatments
  WHERE deleted_at IS NULL
  GROUP BY tag
`);

const getAllPresets = db.prepare(`
  SELECT id, type, medication, dose FROM treatment_presets
  WHERE deleted_at IS NULL
  ORDER BY type, medication
`);

const insertPreset = db.prepare(`
  INSERT INTO treatment_presets (id, type, medication, dose, updated_at) VALUES (?, ?, ?, ?, ?)
`);

const softDeletePresetById = db.prepare(`
  UPDATE treatment_presets SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL
`);

const getVaccinationSummaryAll = db.prepare(`
  SELECT occurred_on AS day, COUNT(*) AS count
  FROM treatments
  WHERE type = 'vaccination' AND deleted_at IS NULL
  GROUP BY occurred_on
  ORDER BY day DESC
`);

const getVaccinationSummaryRange = db.prepare(`
  SELECT occurred_on AS day, COUNT(*) AS count
  FROM treatments
  WHERE type = 'vaccination' AND deleted_at IS NULL AND occurred_on BETWEEN ? AND ?
  GROUP BY occurred_on
  ORDER BY day DESC
`);

const getVaccinationSummaryFrom = db.prepare(`
  SELECT occurred_on AS day, COUNT(*) AS count
  FROM treatments
  WHERE type = 'vaccination' AND deleted_at IS NULL AND occurred_on >= ?
  GROUP BY occurred_on
  ORDER BY day DESC
`);

// Sync outbox: every local write also queues the row for the cloud push.
const queueSyncRow = db.prepare(`
  INSERT INTO sync_outbox (tbl, row_id) VALUES (?, ?)
`);

// Bulk lamb tags: seed the counter from the database so restarts never
// re-issue tags that already exist.
let lambs = db
  .prepare(
    `SELECT COALESCE(MAX(CAST(substr(tag, 2) AS INTEGER)), 0) AS max
     FROM counts WHERE tag LIKE 'L%'`
  )
  .get().max;
lambs = Math.max(lambs, db.prepare("SELECT value FROM lamb_sequence WHERE singleton = 1").get().value);
const reserveLambSequence = db.prepare("UPDATE lamb_sequence SET value = MAX(value, ?) WHERE singleton = 1");
reserveLambSequence.run(lambs);

// One stats entry per station; station count follows the shearers list,
// which is editable at runtime via the Pi onboarding wizard.
const emptyStationStats = () => ({
  lastRowId: 0,
  lastTag: "",
  lastTagColor: "none",
  lastScanTime: null,
  counted: 0,
  oveja: 0,
  borrega: 0,
  carnero: 0,
});

const defaultStatsByStation = () => {
  const stats = {};
  for (let station = 1; station <= readShearers().length; ++station) {
    stats[station] = emptyStationStats();
  }
  return stats;
};

let countStatsByStation = defaultStatsByStation();

const refreshCounts = async () => {
  countStatsByStation = await getStatsFromDb();
  countEmitter.emit("update", countStatsByStation);
};

setInterval(async () => {
  await refreshCounts();
}, 5000);

const writeTagToDb = db.prepare(`
  INSERT INTO counts (id, tag, station, color, lactation, type, woolQuality, date, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const findCountSubmission = db.prepare(`
  SELECT id FROM count_submissions WHERE id = ?
`);

const recordCountSubmission = db.prepare(`
  INSERT INTO count_submissions (id, kind, created_at) VALUES (?, ?, ?)
`);

const insertCountTxn = db.transaction((row, submissionId) => {
  if (submissionId && findCountSubmission.get(submissionId)) return false;
  writeTagToDb.run(
    row.id,
    row.tag,
    row.station,
    row.color,
    row.lactation,
    row.type,
    row.woolQuality,
    row.date,
    row.updated_at
  );
  queueSyncRow.run("counts", row.id);
  if (submissionId) recordCountSubmission.run(submissionId, "single", row.date);
  return true;
});

const writeTag = async (
  tag,
  station,
  color,
  lactation = "idk",
  type = "oveja",
  woolQuality = "IDK",
  submissionId = null
) => {
  const dateString = new Date().toISOString();

  const created = insertCountTxn({
    id: uuidv7(),
    tag,
    station,
    color,
    lactation,
    type,
    woolQuality,
    date: dateString,
    updated_at: dateString,
  }, submissionId);

  await refreshCounts();
  return created;
};

const insertBulkCountTxn = db.transaction((station, quantity, submissionId) => {
  if (submissionId && findCountSubmission.get(submissionId)) return false;
  const dateString = new Date().toISOString();
  for (let i = 0; i < quantity; ++i) {
    lambs += 1;
    const row = {
      id: uuidv7(),
      tag: "L" + String(lambs).padStart(4, "0"),
      station,
      color: "none",
      lactation: "idk",
      type: "borrega",
      woolQuality: "IDK",
      date: dateString,
      updated_at: dateString,
    };
    writeTagToDb.run(
      row.id,
      row.tag,
      row.station,
      row.color,
      row.lactation,
      row.type,
      row.woolQuality,
      row.date,
      row.updated_at
    );
    queueSyncRow.run("counts", row.id);
  }
  reserveLambSequence.run(lambs);
  if (submissionId) recordCountSubmission.run(submissionId, "bulk", dateString);
  return true;
});

const writeBulkTags = async (station, quantity, submissionId = null) => {
  const created = insertBulkCountTxn(station, quantity, submissionId);
  await refreshCounts();
  return created;
};

const readSubmissionId = (body) => {
  const value = body?.submissionId;
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,100}$/.test(value)
    ? value
    : null;
};

const readStation = (body) => {
  const station = Number(body?.station);
  return Number.isInteger(station) && station >= 1 && station <= readShearers().length
    ? station
    : null;
};

const validateTagSubmission = (body) => {
  const type = body?.type ?? "oveja";
  const taggingMode = taggingModesByType.get(type);
  if (!taggingMode?.tagSchema || taggingMode.bulk) {
    return { error: "invalid sheep type" };
  }

  const station = readStation(body);
  if (!station) return { error: "invalid station" };

  const color = body?.color;
  if (!taggingMode.tagSchema.colors.some((entry) => entry.value === color)) {
    return { error: "invalid tag color" };
  }

  const tag = body?.tag;
  if (typeof tag !== "string") return { error: "invalid tag" };
  const [codeSchema, digitsSchema] = taggingMode.tagSchema.textSchema;
  const matchingCode = [...codeSchema.options]
    .sort((a, b) => b.value.length - a.value.length)
    .find((option) => tag.startsWith(option.value));
  const digits = matchingCode ? tag.slice(matchingCode.value.length) : "";
  if (
    !matchingCode ||
    !/^\d+$/.test(digits) ||
    digits.length < digitsSchema.min ||
    digits.length > digitsSchema.max
  ) {
    return { error: "tag must contain a valid prefix and 5-6 digits" };
  }

  for (const survey of taggingMode.surveySchema ?? []) {
    if (!survey.options.some((option) => option.value === body?.[survey.field])) {
      return { error: `invalid ${survey.field}` };
    }
  }

  return { value: { type, station, color, tag } };
};

const getStatsFromDb = async () => {
  const tags = readTagsFromDb.iterate();
  const stats = defaultStatsByStation();
  for (let tag of tags) {
    const s = (stats[tag.station] ??= emptyStationStats());
    s.lastRowId = tag.rowid;
    s.lastTag = tag.tag;
    s.lastTagColor = tag.color;
    s.lastScanTime = tag.date;
    s.counted += 1;
    s[tag.type] = (s[tag.type] ?? 0) + 1;
  }
  return stats;
};

app.post("/count", bodyParser.json(), (req, res) => {
  const validation = validateTagSubmission(req.body);
  if (validation.error) return res.status(400).json({ error: validation.error });
  const submissionId = readSubmissionId(req.body);
  if (req.body.submissionId && !submissionId) {
    return res.status(400).json({ error: "invalid submissionId" });
  }
  writeTag(
    validation.value.tag,
    validation.value.station,
    validation.value.color,
    req.body.lactation,
    validation.value.type,
    req.body.woolQuality ?? "IDK",
    submissionId
  )
    .then((created) => res.json({ ok: true, created, counts: countStatsByStation }))
    .catch((err) => {
      console.error(err);
      res.sendStatus(500);
    });
});

app.post("/bulk", bodyParser.json(), (req, res) => {
  const station = readStation(req.body);
  if (!station) return res.status(400).json({ error: "invalid station" });
  const quantity = Number(req.body?.quantity);
  const submissionId = readSubmissionId(req.body);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
    return res.status(400).json({ error: "quantity must be between 1 and 1000" });
  }
  if (req.body.submissionId && !submissionId) {
    return res.status(400).json({ error: "invalid submissionId" });
  }

  writeBulkTags(station, quantity, submissionId)
    .then((created) => res.json({ ok: true, created, counts: countStatsByStation }))
    .catch((err) => {
      console.error(err);
      res.sendStatus(500);
    });
});

const recentRecords = db.prepare(`
  SELECT c.*, EXISTS(SELECT 1 FROM sync_outbox o WHERE o.tbl = 'counts' AND o.row_id = c.id) AS pending
  FROM counts c WHERE c.deleted_at IS NULL AND c.tag LIKE ?
  ORDER BY c.date DESC, c.id DESC LIMIT 200
`);
app.get("/api/records", (req, res) => {
  const filter = typeof req.query.tag === "string" ? req.query.tag.slice(0, 40) : "";
  res.json({ rows: recentRecords.all(`%${filter}%`),
    pending: db.prepare("SELECT COUNT(DISTINCT row_id) AS n FROM sync_outbox WHERE tbl = 'counts'").get().n,
    syncConfigured: Boolean(process.env.CLOUD_SYNC_URL && process.env.CLOUD_SYNC_TOKEN) });
});

const mutateRecord = db.transaction((body) => {
  const signature = JSON.stringify([body.action, body.id, body.updated_at, body.tag,
    body.station, body.type, body.color, body.woolQuality, body.lactation]);
  const receipt = db.prepare("SELECT * FROM record_mutations WHERE id = ?").get(body.submissionId);
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
  if (receipt) {
    if (receipt.request !== signature) fail(409, "Este intento ya se usó para otro cambio.");
    return { ...JSON.parse(receipt.result), duplicate: true };
  }
  const old = body.action === "add" ? null : db.prepare("SELECT * FROM counts WHERE id = ?").get(body.id);
  if (body.action !== "add") {
    if (!old || old.deleted_at) fail(404, "El registro ya no existe. Actualiza la tabla.");
    if (old.updated_at !== body.updated_at) fail(409, "El registro cambió. Cierra el formulario y vuelve a abrirlo.");
  }
  const now = new Date(Math.max(Date.now(), old ? Date.parse(old.updated_at) + 1 : 0)).toISOString();
  const id = old?.id ?? uuidv7();
  if (body.action === "delete") {
    db.prepare("UPDATE counts SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
  } else {
    if (!["oveja", "carnero", "borrega"].includes(body.type)) fail(400, "Tipo de animal inválido.");
    if (body.type === "borrega") {
      if (!readStation(body) || !/^L[0-9]{4,10}$/.test(body.tag) || body.color !== "none" ||
          body.woolQuality !== "IDK" || body.lactation !== "idk") fail(400, "Datos de cordero inválidos.");
    } else {
      const validation = validateTagSubmission(body);
      if (validation.error) fail(400, "Revisa el código, estación, color y respuestas del animal.");
      if (body.type === "carnero" && (body.woolQuality !== "IDK" || body.lactation !== "idk")) {
        fail(400, "El carnero no requiere respuestas de lana ni lactancia.");
      }
    }
    if (old) {
      db.prepare(`UPDATE counts SET tag = ?, station = ?, color = ?, lactation = ?,
        type = ?, woolQuality = ?, updated_at = ? WHERE id = ?`).run(
        body.tag, Number(body.station), body.color, body.lactation, body.type, body.woolQuality, now, id);
    } else {
      writeTagToDb.run(id, body.tag, Number(body.station), body.color, body.lactation,
        body.type, body.woolQuality, now, now);
    }
  }
  if (body.action !== "delete" && /^L[0-9]+$/.test(body.tag)) {
    reserveLambSequence.run(Number(body.tag.slice(1)));
  }
  queueSyncRow.run("counts", id);
  const result = { ok: true, id, updated_at: now, duplicate: false };
  db.prepare("INSERT INTO record_mutations VALUES (?, ?, ?)").run(body.submissionId, signature, JSON.stringify(result));
  return result;
});

app.post("/api/records", bodyParser.json(), async (req, res) => {
  const body = req.body;
  if (!readSubmissionId(body) || !["add", "edit", "delete"].includes(body?.action) ||
      (body.action !== "add" && (typeof body.id !== "string" || typeof body.updated_at !== "string"))) {
    return res.status(400).json({ error: "Solicitud inválida." });
  }
  try {
    const result = mutateRecord(body);
    // Manual L tags must also reserve their number before the next bulk submission.
    lambs = Math.max(lambs, db.prepare("SELECT value FROM lamb_sequence WHERE singleton = 1").get().value);
    await refreshCounts();
    res.json(result);
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.status ? error.message : "No se pudo guardar. Reintenta el mismo cambio." });
  }
});

app.get("/count", (req, res) => {
  res.json(countStatsByStation);
});

app.get("/count/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(`data: ${JSON.stringify(countStatsByStation)}\n\n`);

  const sendCounts = (counts) => {
    res.write(`data: ${JSON.stringify(counts)}\n\n`);
  };
  countEmitter.on("update", sendCounts);
  res.on("close", () => countEmitter.off("update", sendCounts));
});

app.get("/qr.png", (req, res) => {
  res.type("png");
  // The Mac's address can change after reconnecting to WiFi. Never let the
  // setup window reuse a QR code cached for an earlier address.
  res.setHeader("Cache-Control", "no-store, max-age=0");
  QRCode.toFileStream(res, taggerConnectionInfo().url, {
    errorCorrectionLevel: "M",
    margin: 4,
    width: 512,
  });
});

app.post("/mode", bodyParser.json(), (req, res) => {
  const nextMode = req.body?.mode;
  if (!taggingModesByType.has(nextMode)) {
    return res.status(400).json({ error: "invalid mode" });
  }
  updateSettingsFromDb.run(nextMode);
  mode = nextMode;
  modeEmitter.emit("modeswitch", nextMode);
  res.sendStatus(200);
});

app.get("/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ mode })}\n\n`);

  const modeSwitchHandler = (mode) => {
    res.write(`data: ${JSON.stringify({ mode })}\n\n`);
  };
  modeEmitter.on("modeswitch", modeSwitchHandler);
  res.on("close", () => {
    modeEmitter.off("modeswitch", modeSwitchHandler);
  });
});

const getAllSheep = db.prepare(`
  SELECT rowid, id, tag, station, color, lactation, type, woolQuality, date
  FROM counts
  WHERE deleted_at IS NULL
  ORDER BY date DESC
`);

app.get("/sheep", (req, res) => {
  const tag = req.query.tag;
  if (tag) {
    const rows = searchSheepByTag.all(tag);
    res.json(rows);
  } else {
    const rows = getAllSheep.all();
    res.json(rows);
  }
});

// Treatment read/write endpoints remain during the transition so an older
// LAN build of EsquilaDB keeps working; all writes flow to the cloud through
// the outbox either way. The cloud service is the system of record now.

app.get("/treatments", (req, res) => {
  const tag = req.query.tag;
  if (!tag) {
    return res.status(400).json({ error: "tag query parameter required" });
  }
  try {
    const rows = getTreatmentsByTag.all(tag);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

const insertTreatmentTxn = db.transaction((row) => {
  insertTreatment.run(
    row.id,
    row.tag,
    row.type,
    row.medication,
    row.dose,
    row.occurred_on,
    row.recorded_at,
    row.updated_at
  );
  queueSyncRow.run("treatments", row.id);
});

app.post("/treatments", bodyParser.json(), (req, res) => {
  const { tag, type, medication, dose, date, occurred_on } = req.body;
  if (!tag || !type || !medication || !(date || occurred_on)) {
    return res.status(400).json({ error: "tag, type, medication, and date are required" });
  }
  if (type !== "vaccination" && type !== "deworming") {
    return res.status(400).json({ error: "type must be 'vaccination' or 'deworming'" });
  }
  try {
    const nowIso = new Date().toISOString();
    const row = {
      id: uuidv7(),
      tag,
      type,
      medication,
      dose: dose ?? "",
      occurred_on: occurred_on ?? ranchDay(date),
      recorded_at: date ?? nowIso,
      updated_at: nowIso,
    };
    if (!row.occurred_on) {
      return res.status(400).json({ error: "invalid date" });
    }
    insertTreatmentTxn(row);
    res.json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

const deleteTreatmentTxn = db.transaction((id, nowIso) => {
  const result = softDeleteTreatmentById.run(nowIso, nowIso, id);
  if (result.changes > 0) {
    queueSyncRow.run("treatments", id);
  }
});

app.delete("/treatments/:id", (req, res) => {
  const id = req.params.id;
  if (!id) {
    return res.status(400).json({ error: "valid id required" });
  }
  try {
    deleteTreatmentTxn(id, new Date().toISOString());
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.get("/treatment-counts", (req, res) => {
  try {
    const rows = getTreatmentCountsByTag.all();
    const counts = {};
    for (const row of rows) {
      counts[row.tag] = { vaccinations: row.vaccinations, dewormings: row.dewormings };
    }
    res.json(counts);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.get("/vaccination-summary", (req, res) => {
  try {
    const { start, end } = req.query;
    let rows;
    if (start && end) {
      rows = getVaccinationSummaryRange.all(start, end);
    } else if (start) {
      rows = getVaccinationSummaryFrom.all(start);
    } else {
      rows = getVaccinationSummaryAll.all();
    }
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    res.json({ days: rows, total });
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.get("/treatment-presets", (req, res) => {
  try {
    const rows = getAllPresets.all();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

const insertPresetTxn = db.transaction((row) => {
  insertPreset.run(row.id, row.type, row.medication, row.dose, row.updated_at);
  queueSyncRow.run("treatment_presets", row.id);
});

app.post("/treatment-presets", bodyParser.json(), (req, res) => {
  const { type, medication, dose } = req.body;
  if (!type || !medication) {
    return res.status(400).json({ error: "type and medication are required" });
  }
  if (type !== "vaccination" && type !== "deworming") {
    return res.status(400).json({ error: "type must be 'vaccination' or 'deworming'" });
  }
  try {
    const row = {
      id: uuidv7(),
      type,
      medication: medication.trim(),
      dose: (dose ?? "").trim(),
      updated_at: new Date().toISOString(),
    };
    insertPresetTxn(row);
    res.json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

const deletePresetTxn = db.transaction((id, nowIso) => {
  const result = softDeletePresetById.run(nowIso, nowIso, id);
  if (result.changes > 0) {
    queueSyncRow.run("treatment_presets", id);
  }
});

app.delete("/treatment-presets/:id", (req, res) => {
  const id = req.params.id;
  if (!id) {
    return res.status(400).json({ error: "valid id required" });
  }
  try {
    deletePresetTxn(id, new Date().toISOString());
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// ---------------------------------------------------------------------------
// Onboarding wizard (Pi appliance): WiFi + shearer names, shown fullscreen on
// the barn TV at first boot. The Mac app uses its own native shell for cloud
// configuration and the normal macOS WiFi controls.
// ---------------------------------------------------------------------------

const ONBOARD_MARKER = path.resolve(".onboarded");

const nmcli = (args, timeoutMs = 60000) =>
  new Promise((resolve, reject) => {
    execFile("sudo", ["-n", "nmcli", ...args], { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(stdout);
    });
  });

app.get("/shearers", (req, res) => {
  res.json(readShearers());
});

app.get("/setup", (req, res) => {
  res.sendFile(path.join(__dirname, "setup", "index.html"));
});

app.get("/tagger-setup", (req, res) => {
  res.sendFile(path.join(__dirname, "setup", "tagger.html"));
});

app.get("/tagger-setup.js", (req, res) => {
  res.sendFile(path.join(__dirname, "setup", "tagger.js"));
});

app.get("/tagger-info", (req, res) => {
  res.json(taggerConnectionInfo());
});

app.get("/setup/state", async (req, res) => {
  let wifiAvailable = false;
  let currentSsid = null;
  let connectivity = null;
  try {
    const active = await nmcli(["-t", "-f", "ACTIVE,SSID", "dev", "wifi"], 15000);
    wifiAvailable = true;
    for (const line of active.split("\n")) {
      if (line.startsWith("yes" + ":")) currentSsid = line.slice(4).replaceAll("\\:", ":");
    }
    connectivity = (await nmcli(["networking", "connectivity", "check"], 15000)).trim();
  } catch (e) {
    // No nmcli / no sudo rule (e.g. dev machine): wizard hides the WiFi step.
  }
  res.json({
    onboarded: existsSync(ONBOARD_MARKER),
    wifiAvailable,
    currentSsid,
    online: connectivity === null ? null : connectivity === "full",
    shearers: readShearers(),
  });
});

app.post("/setup/wifi/scan", async (req, res) => {
  try {
    const out = await nmcli(
      ["-t", "-f", "SSID,SIGNAL,SECURITY", "dev", "wifi", "list", "--rescan", "yes"],
      45000
    );
    const bySsid = new Map();
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split(/(?<!\\):/);
      const ssid = (parts[0] ?? "").replaceAll("\\:", ":");
      const signal = parseInt(parts[1] ?? "0", 10) || 0;
      const secured = (parts[2] ?? "").trim() !== "";
      if (!ssid) continue;
      const existing = bySsid.get(ssid);
      if (!existing || signal > existing.signal) bySsid.set(ssid, { ssid, signal, secured });
    }
    const networks = [...bySsid.values()].sort((a, b) => b.signal - a.signal);
    res.json({ networks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/setup/wifi/connect", bodyParser.json(), async (req, res) => {
  const { ssid, password } = req.body ?? {};
  if (!ssid) {
    return res.status(400).json({ error: "ssid required" });
  }
  try {
    // Drop any stale profile for this SSID so a corrected password takes.
    await nmcli(["connection", "delete", "id", ssid], 15000).catch(() => {});
    const args = ["dev", "wifi", "connect", ssid];
    if (password) args.push("password", password);
    await nmcli(args, 90000);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/setup/shearers", bodyParser.json(), (req, res) => {
  const names = req.body?.names;
  if (
    !Array.isArray(names) ||
    names.length < 1 ||
    names.length > 6 ||
    names.some((n) => typeof n !== "string" || !n.trim())
  ) {
    return res.status(400).json({ error: "names must be 1-6 non-empty strings" });
  }
  writeFileSync(SHEARERS_FILE, JSON.stringify(names.map((n) => ({ name: n.trim() })), null, 2));
  refreshCounts();
  res.json({ ok: true });
});

app.post("/setup/complete", (req, res) => {
  writeFileSync(ONBOARD_MARKER, new Date().toISOString());
  res.json({ ok: true });
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

// EsquilaDB now lives on the cloud origin (it needs HTTPS for offline
// support). Redirect anyone who still has the old LAN URL.
app.get(["/esquiladb", "/esquiladb/*splat"], (req, res) => {
  if (process.env.CLOUD_APP_URL) {
    res.redirect(process.env.CLOUD_APP_URL);
  } else {
    res
      .status(410)
      .send("EsquilaDB se movió a la nube. Configura CLOUD_APP_URL en el servidor para redirigir.");
  }
});

app.use(express.static(path.join(__dirname, "build")));

// ---------------------------------------------------------------------------
// Cloud sync agent: drains sync_outbox to the esquila-cloud service.
// Push-only, batched, idempotent on the remote (LWW upsert by id), so
// retrying after days offline is safe. Backs off exponentially while the
// internet is down — which is the normal state at the ranch, not an error.
// ---------------------------------------------------------------------------

const CLOUD_SYNC_URL = process.env.CLOUD_SYNC_URL;
const CLOUD_SYNC_TOKEN = process.env.CLOUD_SYNC_TOKEN;
const SYNC_INTERVAL_MS = Number(process.env.CLOUD_SYNC_INTERVAL_MS) || 60 * 1000;
const SYNC_MAX_BACKOFF_MS = 10 * 60 * 1000;
const SYNC_BATCH_SIZE = 500;

const readOutbox = db.prepare(`
  SELECT seq, tbl, row_id FROM sync_outbox ORDER BY seq LIMIT ?
`);
const deleteOutboxEntry = db.prepare(`DELETE FROM sync_outbox WHERE seq = ?`);
const clearOutboxEntries = db.transaction((entries) => {
  for (const entry of entries) {
    deleteOutboxEntry.run(entry.seq);
  }
});

const getRowForSync = {
  counts: db.prepare(`SELECT * FROM counts WHERE id = ?`),
  treatments: db.prepare(`SELECT * FROM treatments WHERE id = ?`),
  treatment_presets: db.prepare(`SELECT * FROM treatment_presets WHERE id = ?`),
};

const toRemoteRow = {
  counts: (r) => ({
    id: r.id,
    tag: r.tag,
    station: r.station,
    color: r.color,
    lactation: r.lactation,
    type: r.type,
    wool_quality: r.woolQuality,
    occurred_at: r.date,
    updated_at: r.updated_at,
    deleted_at: r.deleted_at,
    origin: r.origin,
  }),
  treatments: (r) => ({
    id: r.id,
    tag: r.tag,
    type: r.type,
    medication: r.medication,
    dose: r.dose,
    occurred_on: r.occurred_on,
    recorded_at: r.recorded_at,
    updated_at: r.updated_at,
    deleted_at: r.deleted_at,
    origin: r.origin,
  }),
  treatment_presets: (r) => ({
    id: r.id,
    type: r.type,
    medication: r.medication,
    dose: r.dose,
    updated_at: r.updated_at,
    deleted_at: r.deleted_at,
  }),
};

const remoteTableFor = {
  counts: "shearing_events",
  treatments: "treatments",
  treatment_presets: "treatment_presets",
};

let syncDelay = SYNC_INTERVAL_MS;

const runSync = async () => {
  try {
    const entries = readOutbox.all(SYNC_BATCH_SIZE);
    if (entries.length > 0) {
      const seen = new Set();
      const rowsByTable = { counts: [], treatments: [], treatment_presets: [] };
      for (const entry of entries) {
        const key = `${entry.tbl}:${entry.row_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const row = getRowForSync[entry.tbl]?.get(entry.row_id);
        if (row) rowsByTable[entry.tbl].push(toRemoteRow[entry.tbl](row));
      }
      const batches = Object.entries(rowsByTable)
        .filter(([, rows]) => rows.length > 0)
        .map(([tbl, rows]) => ({ table: remoteTableFor[tbl], rows }));

      if (batches.length > 0) {
        const res = await fetch(`${CLOUD_SYNC_URL}/api/sync/push`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CLOUD_SYNC_TOKEN}`,
          },
          body: JSON.stringify({ batches }),
        });
        if (!res.ok) {
          throw new Error(`push returned ${res.status}`);
        }
      }
      clearOutboxEntries(entries);
      console.log(`Cloud sync: pushed ${entries.length} outbox entries`);
    }
    syncDelay = SYNC_INTERVAL_MS;
  } catch (err) {
    syncDelay = Math.min(syncDelay * 2, SYNC_MAX_BACKOFF_MS);
    console.error(`Cloud sync failed (next attempt in ${Math.round(syncDelay / 1000)}s):`, err.message);
  } finally {
    setTimeout(runSync, syncDelay);
  }
};

if (CLOUD_SYNC_URL && CLOUD_SYNC_TOKEN) {
  setTimeout(runSync, 5000);
} else {
  console.log("Cloud sync disabled — set CLOUD_SYNC_URL and CLOUD_SYNC_TOKEN to enable");
}

app.listen(port, async () => {
  const taggerUrl = taggerConnectionInfo().url;

  const mobileMonitorUrl = `http://${
    Object.values(os.networkInterfaces())
      .flat()
      .find((addr) => !addr.internal && addr.family === "IPv4")?.address
  }:${port}/mobilemonitor`;

  if (hasAwsCredentials) try {
    // Create a PassThrough stream to collect QR code data
    const pass = new PassThrough();
    const chunks = [];

    // Collect data as it's written
    pass.on("data", (chunk) => {
      chunks.push(chunk);
    });

    pass.on("end", async () => {
      // Convert chunks to buffer
      const qrBuffer = Buffer.concat(chunks);

      // Don't let a failed email (no network / no AWS creds) crash the server.
      const info = await transporter.sendMail({
        from: "esquila@sheepplusplus.com",
        to: email,
        subject: "QR code generated for sheep app!",
        text: `The QR code has been generated for the sheep app and is attached.
The URL is ${taggerUrl}.

The mobile monitor URL is ${mobileMonitorUrl}.`,
        attachments: [
          {
            filename: "qr.png",
            content: qrBuffer,
            contentType: "image/png",
          },
        ],
      }).catch((err) => {
        console.error("Failed to email QR code:", err.message);
      });
    });

    // Generate QR code to the PassThrough stream
    QRCode.toFileStream(pass, taggerUrl);
  } catch (err) {
    console.error("Failed to generate QR code:", err);
  }

  console.log(`Go count some sheep! App listening on port ${port}`);
});
