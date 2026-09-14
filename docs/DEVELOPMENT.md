# Development requirements

## Prerequisites and generated files

- Use Node.js 22, matching GitHub Actions.
- Install root and cloud dependencies with `npm ci` and
  `npm ci --prefix cloud`.
- Browser end-to-end tests require Chromium from Playwright and a disposable
  PostgreSQL database.
- Never edit generated `build/`, `build-cloud/`, `dist-mac/`, test reports,
  SQLite files, or package contents. They are ignored and must not be committed.
- Commit lockfile changes whenever dependencies change.

## Build targets

| Command | Output/purpose |
|---|---|
| `npm run build` | LAN tagger and monitor assets in `build/` |
| `npm run build:cloud` | EsquilaDB PWA and service worker in `build-cloud/` |
| `npm start` | Barn Express server on `PORT` or 3001 |
| `npm run dev:cloud` | Cloud PWA development server, proxying `/api` to port 8080 |
| `npm run build:mac:arm64` | Apple Silicon DMG/ZIP in `dist-mac/` |
| `npm run check` | Syntax, both builds, unit tests, and full E2E suite |

The cloud server requires its own process:

```sh
DATABASE_URL='<disposable-postgres-url>' \
ADMIN_PASSWORD='<local-only-password>' \
PUBLIC_URL='http://127.0.0.1:8080' \
npm start --prefix cloud
```

Use obvious disposable values in examples and tests. Never paste a production
connection string or enrollment token into a shell transcript, issue, fixture,
test report, or commit.

## Configuration contract

### Barn server

| Variable | Required | Meaning |
|---|---|---|
| `PORT` | No | HTTP port; defaults to 3001 |
| `CLOUD_SYNC_URL` | No | Cloud origin; omitting it leaves synchronization disabled while local operation continues |
| `CLOUD_SYNC_TOKEN` | With sync URL | `server`-role bearer token |
| `CLOUD_SYNC_INTERVAL_MS` | No | Base sync interval; defaults to 60 seconds |
| `CLOUD_APP_URL` | No | HTTPS PWA origin used by the legacy `/esquiladb` redirect |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | No | Enable S3 backup and SES QR email together |
| `ESQUILA_DATA_DIR` | Tests/Mac internals only | Overrides Electron user-data location for isolated runs |

The barn process uses its working directory for the `esquila` SQLite file and
live `shearers.json`. The Mac wrapper deliberately starts it in Application
Support; do not replace those paths with repository-relative assumptions.

### Cloud server

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | Yes | TLS PostgreSQL connection URL |
| `ADMIN_PASSWORD` | Yes | Admin login secret; `ADMIN_TOKEN` is legacy fallback only |
| `PUBLIC_URL` | Recommended | Public HTTPS origin embedded in enrollment links |
| `PORT` | No | HTTP port; defaults to 8080 |

## Rules by change area

### Barn persistence and API

- Treat an existing SQLite database as irreplaceable ranch data.
- Use `PRAGMA user_version` migrations and create a recoverable pre-migration
  copy before destructive table rebuilds.
- Put domain writes, submission-id recording, and outbox insertion in one
  `better-sqlite3` transaction.
- Validate at the server boundary even when the React form already validates.
- Return JSON for API success and error outcomes. Preserve retry semantics and
  avoid exposing stack traces or secrets.
- Any count-changing path must update live monitors and remain recoverable by the
  periodic count refresh.

### Cloud persistence and API

- Use parameterized SQL only.
- Validate every batch before beginning writes, then commit all rows or none.
- Preserve the role/table allowlist and last-write-wins condition.
- Keep request sizes bounded. The current sync ceiling is 20 MB because full
  offline catch-up batches are expected.
- PostgreSQL schema bootstrap must remain idempotent. Production database roles
  need permission to create/use the configured schema; see deployment docs.

### React and field UI

- Keep field-facing copy in clear Chilean Spanish; developer/admin diagnostics
  may use English where already established.
- Design first for gloved/touch use, unreliable WiFi, phone portrait layouts,
  and a fullscreen barn TV.
- Disable accidental repeat submissions while a request is active, but retain a
  stable submission identifier for deliberate retry after an ambiguous failure.
- Show accepted, duplicate/already-recorded, pending, offline, validation, and
  server-failure states explicitly.
- Do not add a cloud call to tagger or monitor code. Do not add a barn call to
  EsquilaDB.

### Dates, identifiers, and deletion

- Generate synchronized IDs with `shared/uuidv7.js`; do not use array indexes,
  SQLite rowids, or tags as cross-system identity.
- Generate instants with ISO UTC timestamps.
- Use `shared/ranchdate.js` for ranch-day calculations and test both Chilean
  daylight-saving offsets.
- Synchronizable deletion is a tombstone with a later `updated_at`, not a hard
  delete. Device revocation is the exception and intentionally deletes the
  credential row.

## Adding or changing a mode

`tagger/modeschema.json` defines mode type, bulk behavior, tag prefixes/colors,
and surveys. A mode change must be reflected in server-side validation and
count-stat handling, remain compatible with historical rows, render in tagger
and monitors, and receive E2E coverage. Unknown modes and invalid survey values
must continue to fail closed.

## Definition of done

- The feature works online, fully disconnected where required, after restart,
  and after connectivity returns.
- Duplicate delivery and response-loss retry do not duplicate data.
- Authorization boundaries and malformed input remain covered.
- `npm run check` passes with a disposable `TEST_DATABASE_URL`.
- Mac packaging changes pass `npm run build:mac:arm64` and the metadata checks in
  `.github/workflows/pr-checks.yml`.
- Documentation, tests, lockfiles, and deployment configuration are updated in
  the same pull request.
- No generated artifact, runtime database, log, token, password, private URL, or
  environment file is present in the diff.

