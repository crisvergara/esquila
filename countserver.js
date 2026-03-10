import express from "express";
import bodyParser from "body-parser";
import Database from "better-sqlite3";
import QRCode from "qrcode";
import os from "os";
import process from "process";
import { PassThrough } from "node:stream";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import nodemailer from "nodemailer";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { unlink } from "node:fs/promises";
import EventEmitter from "events";

const modeEmitter = new EventEmitter();

const app = express();
const port = 3001;

const db = new Database("esquila", {});

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

const createCountTable = db.prepare(`
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

createCountTable.run();

// Add vaccination columns (safe to re-run once columns exist)
try {
  db.exec("ALTER TABLE counts ADD COLUMN vaccinated INTEGER DEFAULT 0");
} catch (e) {
  // Column already exists
}
try {
  db.exec("ALTER TABLE counts ADD COLUMN vaccinationDate TEXT");
} catch (e) {
  // Column already exists
}

db.exec(`
  CREATE TABLE IF NOT EXISTS treatments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag TEXT NOT NULL,
    type TEXT NOT NULL,
    medication TEXT NOT NULL,
    date TEXT NOT NULL
  )
`);

try {
  db.exec("ALTER TABLE treatments ADD COLUMN dose TEXT DEFAULT ''");
} catch (e) {
  // Column already exists
}

// Migrate legacy vaccinated rows into treatments table (one-time)
const migrated = db
  .prepare(
    `SELECT rowid, tag, vaccinationDate FROM counts
     WHERE vaccinated = 1
       AND tag NOT IN (SELECT DISTINCT tag FROM treatments)`
  )
  .all();
if (migrated.length > 0) {
  const insertMigrated = db.prepare(
    `INSERT INTO treatments (tag, type, medication, date) VALUES (?, 'vaccination', 'Desconocido', ?)`
  );
  const migrate = db.transaction((rows) => {
    for (const row of rows) {
      insertMigrated.run(row.tag, row.vaccinationDate ?? new Date().toISOString());
    }
  });
  migrate(migrated);
  console.log(`Migrated ${migrated.length} legacy vaccination records into treatments table`);
}

const createSettingsTable = db.prepare(`
  CREATE TABLE IF NOT EXISTS settings (
    mode TEXT,
    email TEXT
  )
`);

createSettingsTable.run();

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
  const backupName = `esquila-${new Date().toISOString()}.sqlite`;
  try {
    await db.backup(backupName);
    const command = new PutObjectCommand({
      Bucket: "sheepplusplus-backups",
      Key: backupName,
      Body: backupName,
    });
    await s3Client.send(command);

    // Delete the backup file
    await unlink(backupName);
  } catch (error) {
    console.error("Failed to backup database:", error);
  }
};

setInterval(backupDb, 1000 * 60 * 10); // 10 minutes

process.on("SIGTERM", async () => {
  console.log(`Received SIGTERM, backing up database and exiting...`);
  await backupDb();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log(`Received SIGINT, backing up database and exiting...`);
  await backupDb();
  process.exit(0);
});

const readTagsFromDb = db.prepare(`
  SELECT rowid, tag, station, color, lactation, type, woolQuality, date FROM counts
  WHERE date > date()
  ORDER BY date;
`);

const searchSheepByTag = db.prepare(`
  SELECT rowid, tag, station, color, lactation, type, woolQuality, vaccinated, vaccinationDate, date
  FROM counts
  WHERE tag = ?
  ORDER BY date
`);

const vaccinateSheepByRowid = db.prepare(`
  UPDATE counts SET vaccinated = 1, vaccinationDate = ? WHERE rowid = ?
`);

const insertTreatment = db.prepare(`
  INSERT INTO treatments (tag, type, medication, dose, date) VALUES (?, ?, ?, ?, ?)
`);

const getTreatmentsByTag = db.prepare(`
  SELECT id, tag, type, medication, dose, date FROM treatments WHERE tag = ? ORDER BY date DESC
`);

const deleteTreatmentById = db.prepare(`
  DELETE FROM treatments WHERE id = ?
`);

const getTreatmentCountsByTag = db.prepare(`
  SELECT tag,
    SUM(CASE WHEN type = 'vaccination' THEN 1 ELSE 0 END) AS vaccinations,
    SUM(CASE WHEN type = 'deworming' THEN 1 ELSE 0 END) AS dewormings
  FROM treatments
  GROUP BY tag
`);

let lambs = 0;

let countStatsByStation = {
  1: {
    lastRowId: 0,
    lastTag: "",
    lastTagColor: "none",
    counted: 0,
    oveja: 0,
    borrega: 0,
    carnero: 0,
  },
  2: {
    lastRowId: 0,
    lastTag: "",
    lastTagColor: "none",
    counted: 0,
    oveja: 0,
    borrega: 0,
    carnero: 0,
  },
  3: {
    lastRowId: 0,
    lastTag: "",
    lastTagColor: "none",
    counted: 0,
    oveja: 0,
    borrega: 0,
    carnero: 0,
  },
};

// Flag to prevent race condition between API requests updating
// the stats object, and the timer replacing it outright with
// file contents.

let writeGuard = false;

const refreshCounts = async () => {
  countStatsByStation = await getStatsFromDb();
};

setInterval(async () => {
  await refreshCounts();
}, 5000);

const writeTagToDb = db.prepare(`
  INSERT INTO counts (tag, station, color, lactation, type, woolQuality, date)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const updateTagByRowId = (
  rowid,
  tag,
  station,
  color,
  lactation,
  type,
  woolQuality,
  date
) => {
  return new Promise((resolve, reject) => {
    db.run(
      `
        UPDATE counts
        SET tag = ?, station = ?, color = ?, lactation = ?, type = ?, woolQuality = ?, date = ?
        WHERE rowid = ?
      `,
      [tag, station, color, lactation, type, woolQuality, date, rowid],
      (result, error) => {
        error ? reject(error) : resolve(result);
      }
    );
  });
};

const writeTag = async (
  tag,
  station,
  color,
  lactation = "idk",
  type = "oveja",
  woolQuality = "IDK"
) => {
  const d = new Date();
  const dateString = d.toISOString();

  writeTagToDb.run(
    tag,
    station,
    color,
    lactation,
    type,
    woolQuality,
    dateString
  );

  await refreshCounts();
};

const writeBulkTags = async (station, quantity) => {
  for (let i = 0; i < quantity; ++i) {
    lambs += 1;
    let tag = "L" + "0000".slice(lambs.toString().length) + lambs;

    await writeTag(tag, station, "none", "idk", "borrega");
  }
};

const getStatsFromDb = async () => {
  const tags = readTagsFromDb.iterate();
  const stats = {
    1: {
      lastRowId: 0,
      lastTag: "",
      lastTagColor: "none",
      lastTagScanTime: null,
      counted: 0,
      oveja: 0,
      borrega: 0,
      carnero: 0,
    },
    2: {
      lastRowId: 0,
      lastTag: "",
      lastTagColor: "none",
      lastTagScanTime: null,
      counted: 0,
      oveja: 0,
      borrega: 0,
      carnero: 0,
    },
    3: {
      lastRowId: 0,
      lastTag: "",
      lastTagColor: "none",
      lastTagScanTime: null,
      counted: 0,
      oveja: 0,
      borrega: 0,
      carnero: 0,
    },
  };
  for (let tag of tags) {
    stats[tag.station].lastRowId = tag.rowid;
    stats[tag.station].lastTag = tag.tag;
    stats[tag.station].lastTagColor = tag.color;
    stats[tag.station].lastScanTime = tag.date;
    stats[tag.station].counted += 1;
    stats[tag.station][tag.type] += 1;
  }
  return stats;
};

app.post("/count", bodyParser.json(), (req, res) => {
  if (!req.body.tag || !req.body.station || !req.body.color) {
    res.sendStatus(400);
  }
  writeTag(
    req.body.tag,
    req.body.station,
    req.body.color,
    req.body.lactation,
    req.body.type ?? "oveja",
    req.body.woolQuality ?? "IDK"
  )
    .then(() => res.sendStatus(200))
    .catch((err) => {
      console.error(err);
      res.sendStatus(500);
    });
});

app.post("/bulk", bodyParser.json(), (req, res) => {
  if (!req.body.station || !req.body.quantity) {
    res.sendStatus(400);
  }
  const quantity = parseInt(req.body.quantity);

  writeBulkTags(req.body.station, quantity)
    .then(() => res.sendStatus(200))
    .catch((err) => {
      console.error(err);
      res.sendStatus(500);
    });
});

app.get("/count", (req, res) => {
  res.json(countStatsByStation);
});

app.get("/qr.png", (req, res) => {
  const url = `http://${
    Object.values(os.networkInterfaces())
      .flat()
      .find((addr) => !addr.internal && addr.family === "IPv4")?.address
  }:3001/tagger`;
  QRCode.toFileStream(res, url);
});

app.post("/mode", bodyParser.json(), (req, res) => {
  updateSettingsFromDb.run(req.body.mode);
  mode = req.body.mode;
  modeEmitter.emit("modeswitch", req.body.mode);
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
    modeEmitter.off("count", modeSwitchHandler);
  });
});

const getAllSheep = db.prepare(`
  SELECT rowid, tag, station, color, lactation, type, woolQuality, vaccinated, vaccinationDate, date
  FROM counts
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

app.post("/vaccinate", bodyParser.json(), (req, res) => {
  const { rowid } = req.body;
  if (!rowid) {
    return res.status(400).json({ error: "rowid required" });
  }
  try {
    vaccinateSheepByRowid.run(new Date().toISOString(), rowid);
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

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

app.post("/treatments", bodyParser.json(), (req, res) => {
  const { tag, type, medication, dose, date } = req.body;
  if (!tag || !type || !medication || !date) {
    return res.status(400).json({ error: "tag, type, medication, and date are required" });
  }
  if (type !== "vaccination" && type !== "deworming") {
    return res.status(400).json({ error: "type must be 'vaccination' or 'deworming'" });
  }
  try {
    const result = insertTreatment.run(tag, type, medication, dose ?? "", date);
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.delete("/treatments/:id", (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "valid id required" });
  }
  try {
    deleteTreatmentById.run(id);
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

app.use(express.static("build"));

app.listen(port, async () => {
  const taggerUrl = `http://${
    Object.values(os.networkInterfaces())
      .flat()
      .find((addr) => !addr.internal && addr.family === "IPv4")?.address
  }:3001/tagger`;

  const mobileMonitorUrl = `http://${
    Object.values(os.networkInterfaces())
      .flat()
      .find((addr) => !addr.internal && addr.family === "IPv4")?.address
  }:3001/mobilemonitor`;

  try {
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
      });
    });

    // Generate QR code to the PassThrough stream
    QRCode.toFileStream(pass, taggerUrl);
  } catch (err) {
    console.error("Failed to generate QR code:", err);
  }

  console.log(`Go count some sheep! App listening on port ${port}`);
});
