import express from 'express';
import bodyParser from 'body-parser';
import sqlite3 from 'sqlite3';
import ViteExpress from 'vite-express';
const app = express();
const port = 3001;

const db = new sqlite3.Database('esquila');

db.serialize(() => {
  db.run(`
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
});

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

const writeTagToDb = (tag, station, color, lactation, type, woolQuality, date) => {
  return new Promise((resolve, reject) => {
    db.run(
      `
        INSERT INTO counts (tag, station, color, lactation, type, woolQuality, date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [tag, station, color, lactation, type, woolQuality, date],
      (result, error) => {
        error ? reject(error) : resolve(result);
      }
    );
  });
}

const readTagsFromDb = () => {
  return new Promise((resolve, reject) => {
    db.all(
      `
        SELECT rowid, tag, station, color, lactation, type, woolQuality, date FROM counts
        WHERE date > date()
        ORDER BY date;
      `,
      (error, rows) => {
        error ? reject(error) : resolve(rows);
      }
    );
  });
};

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

  await writeTagToDb(tag, station, color, lactation, type, woolQuality, dateString);
  
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
  const tags = await readTagsFromDb();
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

// parse various different custom JSON types as JSON
app.use(express.static("build"));

ViteExpress.listen(app, port, () => {
  console.log(`Example app listening on port ${port}`);
});
