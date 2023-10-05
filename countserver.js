const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const fs = require("node:fs/promises");
const port = 3001;

const writeTag = async (tag, station, color) => {
  const d = new Date();
  const line = `${station},${tag},${color},${d.toISOString()}\n`;
  await fs.writeFile("./counts/counts.csv", line, { flag: "a+" });
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
    },
    2: {
      lastTag: "",
      lastTagColor: "none",
      counted: 0,
    },
    3: {
      lastTag: "",
      lastTagColor: "none",
      counted: 0,
    },
  };
  for (let line of lines) {
    const fields = line.split(",");
    if (fields.length < 3) continue;
    stats[fields[0]].lastTag = fields[1];
    stats[fields[0]].lastTagColor = fields[2];
    stats[fields[0]].counted += 1;
  }
  return stats;
};

let countStatsByStation = {
  1: {
    lastTag: "",
    counted: 0,
  },
  2: {
    lastTag: "",
    counted: 0,
  },
  3: {
    lastTag: "",
    counted: 0,
  },
  4: {
    lastTag: "",
    counted: 0,
  },
  5: {
    lastTag: "",
    counted: 0,
  },
  6: {
    lastTag: "",
    counted: 0,
  },
};

app.post("/count", bodyParser.json(), (req, res) => {
  console.log("Request received");
  if (!req.body.tag || !req.body.station || !req.body.color) {
    res.sendStatus(400);
  }
  writeTag(req.body.tag, req.body.station, req.body.color)
    .then(() => res.sendStatus(200))
    .catch((err) => res.sendStatus(500));

  countStatsByStation[req.body.station].lastTag = req.body.tag;
  countStatsByStation[req.body.station].counted++;
});

app.get("/count", (req, res) => {
  getStatsFromFile()
    .then((stats) => res.json(stats))
    .catch((err) => {
      console.error(err);
      res.sendStatus(500);
    });
});

app.put("/reset", (req, res) => {
  countStatsByStation = {
    1: {
      lastTag: "",
      counted: 0,
    },
    2: {
      lastTag: "",
      counted: 0,
    },
    3: {
      lastTag: "",
      counted: 0,
    },
    4: {
      lastTag: "",
      counted: 0,
    },
    5: {
      lastTag: "",
      counted: 0,
    },
    6: {
      lastTag: "",
      counted: 0,
    },
  };
  res.sendStatus(200);
});

// parse various different custom JSON types as JSON
app.use(express.static("build"));

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
