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

The active mode is changed centrally and refreshed on tagger devices through short local requests, normally within one second.

## Architecture

The system is offline-first with two halves (full design doc: `docs/OFFLINE_SYNC_UPGRADE.md`):

```
tagger / monitors ──LAN HTTP──> countserver.js (on-prem, SQLite + sync outbox)
                                      │  bidirectional shearing sync when online
                                      ▼
                        esquila-cloud (Express + Neon Postgres, HTTPS)
                                      ▲
        EsquilaDB PWA (offline-first, IndexedDB) ── syncs directly, bypasses LAN
```

- **countserver.js** runs on-prem at the barn. The tagger and monitors only ever talk to it over the LAN — shearing works with zero internet. Every write is queued in a `sync_outbox` table and pushed to the cloud whenever internet is available (safe to be offline for weeks).
- **cloud/server.js** ("esquila-cloud") is the remote hub: Neon Postgres, last-write-wins upserts keyed by UUIDv7, device-token auth with QR enrollment, and it serves the EsquilaDB PWA over HTTPS. It is the system of record for treatments.
- **EsquilaDB** is an installable PWA that works fully offline (IndexedDB snapshot + write outbox) and syncs directly with the cloud — it does not use the count server at all.

```
esquila/
├── countserver.js          # On-prem Express backend + SQLite + sync agent + S3 backup
├── cloud/                  # esquila-cloud remote service
│   ├── server.js           # Sync push endpoint, snapshot API, device enrollment
│   ├── schema.sql          # Neon Postgres schema
│   ├── admin.html          # Ranch monitor, record management, enrollment (/admin)
│   └── Dockerfile          # Deploy image (see fly.toml at repo root)
├── shared/
│   ├── uuidv7.js           # Time-ordered ids, generated at whichever origin writes
│   └── ranchdate.js        # America/Santiago calendar-day helpers
├── shearers.json           # List of shearer names (one per station)
├── tagger/                 # Mobile tagging UI (for shearers)
│   ├── TaggingApp.jsx
│   ├── StationSelect.jsx
│   └── modeschema.json     # Schema defining modes, tag colors, and survey questions
├── monitor/                # Full desktop monitor UI
│   └── MonitorApp.jsx
├── mobilemonitor/          # Mobile-friendly monitor UI
│   └── MobileMonitorApp.jsx
├── esquiladb/              # EsquilaDB PWA (cloud-hosted, offline-first)
│   ├── EsquilaDBApp.jsx
│   ├── localdb.js          # IndexedDB stores (snapshot, outbox, device token)
│   ├── sync.js             # Snapshot refresh + outbox drain against the cloud API
│   └── EsquilaDB.css
├── hooks/                  # Shared React hooks (LAN apps)
├── vite.config.js          # LAN build (tagger, monitor, mobilemonitor)
└── vite.cloud.config.js    # Cloud PWA build (esquiladb + service worker)
```

## Stations & Shearers

Manage station names and tagging choices per server in the cloud admin's
**Configuración de galpones**. Published manifests synchronize to the barn and
remain available offline. Up to 24 stable station slots can be activated or
retired without renumbering records. See [ranch configuration](docs/RANCH_CONFIGURATION.md).
`shearers.json` and `tagger/modeschema.json` now supply bootstrap defaults.

## Tag Format

Tags consist of a **letter prefix** (A, B, C, S, L, X — representing ranch/origin) followed by **5–6 digits**. Tag colors indicate year/cohort.

## EsquilaDB — Sheep Records & Treatment Tracking

EsquilaDB is an installable PWA served from the cloud origin (not the LAN server). It works **fully offline**: on launch it renders instantly from its local IndexedDB snapshot, and when online it refreshes the latest status of the whole flock and pushes any pending treatment records. A status bar shows synced / N pending / offline, and unsent records carry a "pendiente" badge.

- **Sheep lookup** — every sheep's latest shearing status, filterable by tag
- **Shearing history** — dates and which shearer handled the animal
- **Treatment history** — vaccinations and deworming medications with dates and dosages
- **Treatment presets** — save reusable medication + dose combinations and apply them to sheep with a single tap
- **Vaccination report** — per-day vaccination counts, computed locally so it works offline

Tracking medication names is important because brands need to be rotated periodically to prevent resistance.

Phones are enrolled by scanning a QR code generated on the cloud's `/admin` page; each device gets its own revocable token. All calendar-day logic (treatment dates, report grouping) uses the ranch's timezone, **America/Santiago**.

## Remote ranch administration

Open [the cloud admin](https://esquila-cloud.fly.dev/admin) and sign in with the
admin password. The page shows the latest ranch contact, app version, mode,
configured shearers, and per-station totals for the selected Chile date. Browse
records by date/code, include deleted rows to inspect their history, and add,
edit, or delete records. Editing preserves the original shearing time.

Install Mac **0.1.5 or later** to receive cloud corrections. The ranch pushes
local writes then pulls cloud changes (including deletions), normally every
minute. Changes remain pending while disconnected; local counting continues.
Conflicting edits use the later timestamp, with the cloud winning exact ties;
versions are retained in the admin history. The cloud monitor is a synchronized
view, not a live LAN feed. Names reflect the latest station configuration.

## API Endpoints

### On-prem (countserver.js, port 3001)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/count` | Log a single animal (tag, station, color, type, woolQuality, lactation) |
| `GET/POST` | `/api/records` | List recent shearing records; retry-safe additions, edits, and tombstone deletions |
| `POST` | `/bulk` | Log a batch of lambs by quantity and station |
| `GET` | `/count` | Get current per-station stats (counted, last tag, breakdown by type) |
| `POST` | `/mode` | Switch the active tagging mode |
| `GET` | `/api/live` | Current counts and mode for short local polling requests |
| `GET` | `/sse` | Legacy mode stream for older clients |
| `GET` | `/qr.png` | QR code image pointing to the tagger URL |
| `GET` | `/sheep` | List all sheep records (or filter by `?tag=X`) |
| `GET/POST/DELETE` | `/treatments`, `/treatment-presets`, `/treatment-counts`, `/vaccination-summary` | Legacy treatment endpoints kept for the transition; the cloud is the system of record now |

All deletes are soft deletes (tombstones), and every row carries a UUIDv7 `id`, `updated_at`, and `origin` so sync is idempotent.

### Cloud (cloud/server.js)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/sync/push` | device token | Batched last-write-wins upserts `{batches: [{table, rows}]}` |
| `GET` | `/api/snapshot` | device token | Full flock: latest shearing events, all treatments, presets |
| `POST` | `/api/admin/login`, `/api/admin/logout` | admin password/session | Start or end an HttpOnly admin session |
| `GET/POST/DELETE` | `/api/admin/devices` | admin session | Device lifecycle; POST returns the token + enrollment QR |
| `POST` | `/api/sync/ranch` | server token | Ranch heartbeat and up to 500 shearing changes after a durable revision cursor |
| `GET` | `/api/admin/ranch` | admin session | Last ranch contact, version, mode, shearers, and pending changes |
| `GET/POST` | `/api/admin/shearing` | admin session | Browse by Chile date/code, monitor totals, retry-safe additions/edits/deletions |
| `GET` | `/api/admin/shearing/:id/history` | admin session | Last 50 accepted changes and discarded stale corrections |
| `GET` | `/admin` | login required | Ranch monitor, shearing management, and device enrollment |
| `GET` | `/healthz` | — | Health check |
| `GET` | `/api/updates/mac` | — | Verified Apple Silicon installer metadata for Mac update checks |

## Setup & Running

### Prerequisites

- Node.js 18+
- AWS credentials (for S3 backups and SES email) set as environment variables:
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`
- For cloud sync (optional — the server runs fine without it and queues everything):
  - `CLOUD_SYNC_URL` — the esquila-cloud origin, e.g. `https://esquila-cloud.fly.dev`
  - `CLOUD_SYNC_TOKEN` — a `server`-role device token from the cloud `/admin` page
  - `CLOUD_APP_URL` — where `/esquiladb` should redirect (the cloud origin)

> **Barn Mac app (recommended)**: to install this as a normal Mac application
> that runs in the background and opens the monitor fullscreen, see
> [`mac/README.md`](mac/README.md).
>
> The earlier Raspberry Pi appliance remains documented in
> [`pi/README.md`](pi/README.md) as a fallback.
> Cloud deployment steps live in [`docs/DEPLOY.md`](docs/DEPLOY.md).

### Install & run the on-prem server

```bash
npm install
npm run build
npm start
```

The server starts on port **3001**. On first boot after this upgrade it migrates the SQLite database to the sync-safe schema (a local pre-migration backup file is written first) and queues all historical rows for upload. On startup it emails a QR code to the configured address so shearers can easily navigate to the tagger on their phones.

### Run esquila-cloud

```bash
npm run build:cloud                  # builds the EsquilaDB PWA into build-cloud/
cd cloud && npm install
DATABASE_URL=<neon-url> ADMIN_PASSWORD=<strong-password> node server.js
```

To deploy on Fly.io, see `fly.toml` (the app builds from `cloud/Dockerfile`). After deploying, open `https://<app>/admin`, create a `server` device, and set its token as `CLOUD_SYNC_TOKEN` on the ranch machine. Create a `phone` device per family phone and scan the QR to enroll.

For local frontend development: `npm run dev:cloud` proxies `/api` to a local cloud server on port 8080.

## URLs

| URL | Description |
|-----|-------------|
| `http://<host>:3001/tagger` | Tagger UI — for shearers on their phones (LAN) |
| `http://<host>:3001/records/` | Recent-record editor, also opened from the Mac sheep menu |
| `http://<host>:3001/tagger-setup` | QR code and phone setup instructions |
| `http://<host>:3001/monitor` | Desktop monitor — shows all stations at a glance (LAN) |
| `http://<host>:3001/mobilemonitor` | Mobile monitor — same info, phone-friendly (LAN) |
| `https://<cloud-host>/` | EsquilaDB PWA — sheep records & treatment tracking (offline-capable) |
| `https://<cloud-host>/admin` | Ranch configuration, monitor, shearing management, and device enrollment |
| `http://<host>:3001/qr.png` | QR code linking to the tagger |

## Data & Backups

Animal records are stored in a local **SQLite** database file called `esquila`. The database is automatically backed up to the **`sheepplusplus-backups`** S3 bucket every 10 minutes, and also on a clean shutdown (SIGTERM/SIGINT).

## Configuring Shearers

Use **Configuración de galpones** in `/admin` to rename, add or retire stations
for the selected ranch server. Station numbers remain stable when a station is
retired. New Mac installations download these names during enrollment; existing
installations receive changes through manifest synchronization.

## Configuring Modes & Tag Schemas
Use **Configuración de galpones** in `/admin` to add/retire colors, change
prefixes and digit limits, and edit survey names/options. Green and black are
included for both sheep and rams. These changes need no new application build;
the three animal types retain their database/counting semantics. See
[ranch configuration](docs/RANCH_CONFIGURATION.md) for onboarding and offline behavior.
