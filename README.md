# Esquila 🐑

A sheep shearing tracking app for use in the field. Shearers use their phones to log each animal as it comes off the table; a supervisor can watch progress in real time on a monitor display.

## What It Does

During a shearing run, each animal has an ear tag with a letter code and number (e.g. `A00123`), plus a colored tag indicating its age/origin. As each animal is sheared, the shearer at their station enters the tag data on their phone. The app records this to a SQLite database and the monitor screen updates live.

Three **modes** control what data is collected per animal:

| Mode | Type | Description |
|------|------|-------------|
| `oveja` | Ewe | Tag entry + wool quality + lactation status survey |
| `carnero` | Ram | Tag entry only |
| `carnillero` | Lamb (bulk) | Enter a quantity, no individual tags |

The active mode is changed centrally and pushed to all tagger devices in real time via Server-Sent Events (SSE).

## Architecture

```
esquila/
├── countserver.js          # Express backend + SQLite + S3 backup + SES email
├── shearers.json           # List of shearer names (one per station)
├── tagger/                 # Mobile tagging UI (for shearers)
│   ├── TaggingApp.jsx
│   ├── StationSelect.jsx
│   └── modeschema.json     # Schema defining modes, tag colors, and survey questions
├── monitor/                # Full desktop monitor UI
│   └── MonitorApp.jsx
├── mobilemonitor/          # Mobile-friendly monitor UI
│   └── MobileMonitorApp.jsx
├── esquiladb/              # Sheep records & treatment tracking UI
│   ├── EsquilaDBApp.jsx
│   └── EsquilaDB.css
├── hooks/
│   ├── useCounts.js        # Polls /count endpoint for live stats
│   ├── useCurrentTime.js   # Live clock
│   ├── useTagEditor.js     # Tag entry state machine
│   ├── useTaggingMode.js   # Subscribes to SSE for real-time mode changes
│   └── useTimeSince.js     # "X minutes ago" display for last scan
└── vite.config.js          # Multi-page build (tagger, monitor, mobilemonitor, esquiladb)
```

## Stations & Shearers

Stations and shearer names are configured in `shearers.json`. There are 3 stations by default (Ramiro, Pacheco, Jesus).

## Tag Format

Tags consist of a **letter prefix** (A, B, C, S, L, X — representing ranch/origin) followed by **5–6 digits**. Tag colors indicate year/cohort.

## EsquilaDB — Sheep Records & Treatment Tracking

The EsquilaDB interface (`/esquiladb`) lets you browse all sheep records, view shearing history, and manage treatments (vaccinations and dewormings). Selecting a sheep shows its full detail view with:

- **Shearing history** — dates and which shearer handled the animal
- **Treatment history** — vaccinations and deworming medications with dates and dosages
- **Treatment presets** — save reusable medication + dose combinations and apply them to sheep with a single tap
- **Vaccination report** — overview of vaccination counts per day

Tracking medication names is important because brands need to be rotated periodically to prevent resistance.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/count` | Log a single animal (tag, station, color, type, woolQuality, lactation) |
| `POST` | `/bulk` | Log a batch of lambs by quantity and station |
| `GET` | `/count` | Get current per-station stats (counted, last tag, breakdown by type) |
| `POST` | `/mode` | Switch the active tagging mode |
| `GET` | `/sse` | Server-Sent Events stream for real-time mode updates |
| `GET` | `/qr.png` | QR code image pointing to the tagger URL |
| `GET` | `/sheep` | List all sheep records (or filter by `?tag=X`) |
| `GET` | `/treatments?tag=X` | Get all treatments (vaccinations/dewormings) for a sheep |
| `POST` | `/treatments` | Add a treatment `{ tag, type, medication, date }` |
| `DELETE` | `/treatments/:id` | Remove a treatment record |
| `GET` | `/treatment-counts` | Get vaccination/deworming counts per tag |

## Setup & Running

### Prerequisites

- Node.js 18+
- AWS credentials (for S3 backups and SES email) set as environment variables:
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`

### Install dependencies

```bash
npm install
```

### Build the frontend

```bash
npm run build
```

### Start the server

```bash
npm start
```

The server starts on port **3001**. On startup it emails a QR code to the configured address so shearers can easily navigate to the tagger on their phones.

## URLs

| URL | Description |
|-----|-------------|
| `http://<host>:3001/tagger` | Tagger UI — for shearers on their phones |
| `http://<host>:3001/monitor` | Desktop monitor — shows all stations at a glance |
| `http://<host>:3001/mobilemonitor` | Mobile monitor — same info, phone-friendly |
| `http://<host>:3001/esquiladb` | EsquilaDB — sheep records & treatment tracking |
| `http://<host>:3001/qr.png` | QR code linking to the tagger |

## Data & Backups

Animal records are stored in a local **SQLite** database file called `esquila`. The database is automatically backed up to the **`sheepplusplus-backups`** S3 bucket every 10 minutes, and also on a clean shutdown (SIGTERM/SIGINT).

## Configuring Shearers

Edit `shearers.json` to change shearer names. Station numbers correspond to array index + 1.

```json
[
  { "name": "Ramiro" },
  { "name": "Pacheco" },
  { "name": "Jesus" }
]
```

## Configuring Modes & Tag Schemas
Edit `tagger/modeschema.json` to add/remove modes, change available tag colors, letter codes, or survey questions.
