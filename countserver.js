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

const app = express();
const port = 3001;

const db = new Database("esquila", {});

const s3Client = new S3Client(/*{
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
}*/);
const sesClient = new SESv2Client(/*{
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
}*/);

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

app.use(express.static("build"));

app.listen(port, async () => {
  const url = `http://${
    Object.values(os.networkInterfaces())
      .flat()
      .find((addr) => !addr.internal && addr.family === "IPv4")?.address
  }:3001/tagger`;

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
        to: "esquila@sheepplusplus.com",
        subject: "QR code generated for sheep app!",
        text: `The QR code has been generated for the sheep app and is attached.
        The URL is ${url}.`,
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
    QRCode.toFileStream(pass, url);
  } catch (err) {
    console.error("Failed to generate QR code:", err);
  }

  console.log(`Go count some sheep! App listening on port ${port}`);
});
