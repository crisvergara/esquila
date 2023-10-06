const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const fs = require("node:fs/promises");
const port = 3001;

let lambs = 102;

let countStatsByStation = {
  1: {
    lastTag: "",
    lastTagColor: "none",
    counted: 0,
    oveja: 0,
    borrega: 0,
    carnero: 0,
  },
  2: {
    lastTag: "",
    lastTagColor: "none",
    counted: 0,
    oveja: 0,
    borrega: 0,
    carnero: 0,
  },
  3: {
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

setInterval(async () => {
  if (!writeGuard) {
    writeGuard = true;
    try {
      countStatsByStation = await getStatsFromFile();
    } catch (err) {
      console.error(err);
    } finally {
      writeGuard = false;
    }
  }
}, 5000);

const writeTag = async (
  tag,
  station,
  color,
  lactation = "idk",
  type = "oveja"
) => {
  const d = new Date();
  const line = `${station},${tag},${color},${d.toISOString()},${lactation},${type}\n`;

  await fs.writeFile("./counts/counts.csv", line, { flag: "a+" });
  // If we're loading from file system, wait for load to finish.
  while (writeGuard) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  countStatsByStation[station].lastTag = tag;
  countStatsByStation[station].lastTagColor = color;
  countStatsByStation[station].counted++;
  countStatsByStation[station][type] += 1;
};

const writeBulkTags = async (station, quantity) => {
  for (let i = 0; i < quantity; ++i) {
    lambs += 1;
    let tag = "L" + "0000".slice(lambs.toString().length) + lambs;

    await writeTag(tag, station, "none", "idk", "borrega");
  }
};

const getStatsFromFile = async () => {
  const fileContents = await fs.readFile("./counts/counts.csv", {
    encoding: "utf-8",
  });
  const lines = fileContents.split("\n");
  const stats = {
    1: {
      lastTag: "",
      lastTagColor: "none",
      counted: 0,
      oveja: 0,
      borrega: 0,
      carnero: 0,
    },
    2: {
      lastTag: "",
      lastTagColor: "none",
      counted: 0,
      oveja: 0,
      borrega: 0,
      carnero: 0,
    },
    3: {
      lastTag: "",
      lastTagColor: "none",
      counted: 0,
      oveja: 0,
      borrega: 0,
      carnero: 0,
    },
  };
  for (let line of lines) {
    const fields = line.split(",");
    if (fields.length < 3) continue;
    stats[fields[0]].lastTag = fields[1];
    stats[fields[0]].lastTagColor = fields[2];
    stats[fields[0]].counted += 1;
    stats[fields[0]][fields[5]] += 1;
  }
  return stats;
};

app.post("/count", bodyParser.json(), (req, res) => {
  console.log("Request received");
  if (!req.body.tag || !req.body.station || !req.body.color) {
    res.sendStatus(400);
  }
  writeTag(
    req.body.tag,
    req.body.station,
    req.body.color,
    req.body.lactation,
    req.body.type ?? "oveja"
  )
    .then(() => res.sendStatus(200))
    .catch((err) => res.sendStatus(500));
});

app.post("/bulk", bodyParser.json(), (req, res) => {
  console.log("Bulk Request received");
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

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
