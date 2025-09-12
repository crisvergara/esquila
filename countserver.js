import express from 'express';
import bodyParser from 'body-parser';
import Database from 'better-sqlite3';
import QRCode from 'qrcode';
import os from 'os';

const app = express();
const port = 3001;

const db = new Database('esquila', {});

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
}

setInterval(async () => {
  await refreshCounts();
}, 5000);

const writeTagToDb = db.prepare(`
  INSERT INTO counts (tag, station, color, lactation, type, woolQuality, date)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const updateTagByRowId = (rowid, tag, station, color, lactation, type, woolQuality, date) => {
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

  writeTagToDb.run(tag, station, color, lactation, type, woolQuality, dateString);
  
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
  const url = `http://${Object.values(os.networkInterfaces()).flat().find(addr => !addr.internal && addr.family === 'IPv4')?.address}:3001#app`;
  QRCode.toFileStream(res, url);
});


app.use(express.static("build"));

app.listen(port, () => {
  console.log(`Go count some sheep! App listening on port ${port}`);
});
