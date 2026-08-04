# Esquila Offline-First Sync Upgrade — Implementation Document

Status: **approved 2026-08-03** — all open questions resolved; see [Decisions](#decisions-resolved-2026-08-03) at the end.

## Context

Esquila today is a single on-prem Express + SQLite server (`countserver.js`, port 3001) serving four React apps from one Vite build: `tagger/` (counting app), `monitor/` + `mobilemonitor/` (dashboards), and `esquiladb/` (vaccination/records app). Everything assumes the LAN and the server are reachable; a failed fetch silently loses data. The upgrade goals:

1. On-prem count server syncs to a remote service when online.
2. Tagger keeps talking only to the on-prem server (unchanged).
3. EsquilaDB (vaccination app) works fully offline and syncs new treatment records **directly to the remote**, bypassing the count server.
4. EsquilaDB doubles as a sheep lookup app — when online it pulls the latest status of the whole flock.

Design bias: this is a family ranch tool. Boring tech, minimal moving parts, reuse of the existing Express/fetch/React patterns. No ORMs, no sync frameworks.

## Recommended architecture (summary)

```
tagger / monitors ──LAN HTTP──> countserver.js (SQLite + outbox)
                                      │  push-only sync (60s, batched, LWW)
                                      ▼
                        esquila-cloud (Express + Neon Postgres, HTTPS)
                                      ▲
        esquiladb PWA (IndexedDB snapshot + outbox) ── direct, online-only
```

- **Remote service ("esquila-cloud")**: a small Express app + **Neon Postgres** (free tier, scales to zero). Deployed to a cheap always-on host (Fly.io/Railway/Render, ~$0–5/mo) with a custom domain + HTTPS. It **also serves the esquiladb static build on the same origin** — this is load-bearing: it gives esquiladb a secure context for its service worker (impossible on `http://<lan-ip>:3001`), keeps relative-fetch style, and avoids CORS.
- **Identity**: all rows get client/origin-generated **UUIDv7** ids plus `updated_at`, `deleted_at` (tombstones), `origin` columns. Deletes become soft deletes everywhere.
- **Sync**: push-only outbox on both origins (on-prem server and phones), idempotent `INSERT … ON CONFLICT (id) DO UPDATE … WHERE excluded.updated_at > t.updated_at` (last-write-wins) on the remote. Counts are written only on-prem and treatments are append-only + soft-delete, so real conflicts are ~nil.
- **System of record**: remote owns `treatments` after cutover; on-prem owns `counts` (and pushes them up). **No down-sync in v1** (easy to add `GET /api/sync/pull?since=` later). Once esquiladb is served over HTTPS it can't fetch from the HTTP LAN server anyway (mixed content), so the bypass is total by construction.
- **Offline UX (esquiladb)**: installable PWA; renders instantly from an IndexedDB snapshot; background-refreshes `GET /api/snapshot` when online; treatment writes go to a local outbox and drain on `online`/focus/60s timer; pending badges + online/offline indicator + snapshot-age line.
- **Auth**: per-device bearer tokens enrolled via QR code from an admin endpoint; token stored on the phone; revocable by deleting the device row. On-prem server gets a `role='server'` token via env var.

## Remote schema (Neon Postgres)

```sql
create table shearing_events (          -- mirrors on-prem counts
  id uuid primary key,                  -- UUIDv7 from origin
  tag text not null,
  station int, color text, lactation text, type text, wool_quality text,
  occurred_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  origin text not null                  -- 'ranch-server' | device id
);
create index on shearing_events (tag);
create index on shearing_events (occurred_at);

create table treatments (
  id uuid primary key,
  tag text not null,
  type text not null check (type in ('vaccination','deworming')),
  medication text not null,
  dose text not null default '',
  occurred_on date not null,            -- ranch-local calendar day (fixes dual date conventions)
  recorded_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  origin text not null
);
create index on treatments (tag);
create index on treatments (occurred_on);

create table treatment_presets (
  id uuid primary key,
  type text not null, medication text not null, dose text not null default '',
  updated_at timestamptz not null, deleted_at timestamptz
);

create table devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null,             -- sha256 of bearer token
  role text not null default 'phone',   -- 'phone' | 'server'
  created_at timestamptz default now(),
  last_seen_at timestamptz
);

create view sheep_latest as             -- sheep status is derived, not stored
  select distinct on (tag) tag, id, station, color, lactation, type,
         wool_quality, occurred_at
  from shearing_events where deleted_at is null
  order by tag, occurred_at desc;
```

## Remote API surface

| Endpoint | Caller | Purpose |
|---|---|---|
| `POST /api/sync/push` | ranch server + phones | Batch `{table, rows:[…]}`; idempotent LWW upsert by `id`; returns `{applied:[ids]}` |
| `GET /api/snapshot` | phones | One JSON: `sheep_latest`, treatment history/counts per tag, presets, `server_time` (few hundred KB at this scale — no pagination) |
| `GET /api/vaccination-summary?start&end` | phones | Same shape as today, grouped by `occurred_on` |
| `POST /admin/enroll`, `DELETE /admin/devices/:id` | admin (env `ADMIN_TOKEN`) | Device lifecycle + QR enrollment page |
| `GET /*` | phones | Static esquiladb build, SW, manifest |

## On-prem SQLite changes (countserver.js)

- Introduce `PRAGMA user_version`-guarded migrations (the current try/catch-ALTER pattern won't handle this).
- `counts` has **no primary key** — needs the standard table-rebuild: new table with `id TEXT PRIMARY KEY` (UUIDv7 seeded from each row's `date` so historical ids sort chronologically), `updated_at`, `deleted_at`, `origin`, then copy/drop/rename. Add missing indexes on `tag` and `date`. Same rebuild for `treatments` and `treatment_presets`.
- All write paths set `updated_at`; `DELETE` endpoints become soft deletes; reads gain `WHERE deleted_at IS NULL`.
- **Outbox**: `sync_outbox(seq INTEGER PK AUTOINCREMENT, tbl TEXT, row_id TEXT)`; every write inserts an outbox row in the same `db.transaction()`. Sync loop (a `setInterval`, like the existing backup timer): every 60s drain up to 500 entries → `POST /api/sync/push` → delete seqs on 2xx; exponential backoff to a 10-min cap on failures (days offline is the normal case, not an error).
- **Initial backfill** = insert one outbox entry per existing row after migration; the normal loop drains it. No special code path.
- Legacy `vaccinated`/`vaccinationDate` columns and `POST /vaccinate` are excluded from sync and retired at cutover.

## EsquilaDB offline-first rework

- **Storage**: IndexedDB via the `idb` package (~1KB). Stores: `snapshot` (sheep by tag, treatments by id, presets, `fetchedAt`), `outbox` (pending writes keyed by client UUIDv7), `meta` (device token/name).
- **Reads**: render from snapshot immediately; stale-while-revalidate by hand (~30 lines). Pending outbox treatments are merged over the snapshot so unsent records appear in lists/counts.
- **Writes**: preset quick-apply and the manual form (which currently swallow failures silently) become: generate UUIDv7 → write outbox + local snapshot → instant success. Drain loop posts to `/api/sync/push`. Deletes enqueue tombstones.
- **PWA**: split esquiladb into its own Vite build target; `vite-plugin-pwa` precaches the app shell; `/api/*` is `NetworkOnly` (the app's own outbox/snapshot handles offline — never double-cache API responses); real manifest + icons.
- **UI**: header status dot (green synced / yellow N pending / gray offline), per-record "pendiente" badge, "Datos de hace X horas" line.

## Prerequisite bug fixes (would poison sync if left)

| Bug | Location | Phase |
|---|---|---|
| S3 backup uploads the **filename string** as Body → zero real backups exist; must fix before destructive migrations | `countserver.js:151` | 0 |
| Bulk lamb counter resets to 0 on restart → duplicate `L####` tags forever | `countserver.js:249, 349–356` — seed from `MAX(tag)` at boot | 0 |
| SSE cleanup removes wrong event listener (leak) | `countserver.js:468` | 0 |
| Dual date conventions in `treatments.date` (UTC-now vs local-noon) + UTC-day grouping | `countserver.js:225–247`, `EsquilaDBApp.jsx:119, 241` — normalize to ranch-local `occurred_on` during migration | 1 |
| Dead `updateTagByRowId` calls nonexistent `db.run()` | `countserver.js:300–323` — delete | 1 |

## Phases (each independently shippable)

- **Phase 0 — Stabilize on-prem (small)**: fix S3 backup Body, lamb counter, SSE leak; verify a real backup lands in S3. Nothing visible changes; data becomes safe to migrate.
- **Phase 1 — Sync-safe schema (medium)**: user_version migrations; UUIDv7/updated_at/deleted_at/origin rebuilds; date normalization; soft deletes; outbox on all writes; backfill outbox. LAN apps keep working against unchanged endpoint shapes.
- **Phase 2 — esquila-cloud (medium)**: new `cloud/` Express app + Neon schema; `POST /api/sync/push` LWW upsert; `GET /api/snapshot`; device-token auth + QR enroll; deploy with domain + HTTPS. Ships an empty but live remote.
- **Phase 3 — On-prem sync agent (small)**: sync loop + backoff in `countserver.js`; drains the backfill; verify row counts match in Neon. **Req #1 done.**
- **Phase 4 — Offline-first esquiladb (large)**: point at remote `/api/*`; idb snapshot + outbox; PWA; pending/offline UI; deploy static build with esquila-cloud; enroll phones by QR. **Reqs #3 and #4 done.**
- **Phase 5 — Cutover & cleanup (small)**: retire on-prem treatments/presets writes and `/vaccinate`; drop esquiladb from the on-prem build (leave a redirect); delete vestigial CRA `manifest.json`; optional tagger retry-queue fix for its silent data loss.

## Critical files

- `countserver.js` — migrations, outbox, sync loop, bug fixes (Phases 0/1/3/5)
- `esquiladb/EsquilaDBApp.jsx` — offline rework, remote API, sync UI (Phase 4)
- `vite.config.js` — split esquiladb build, vite-plugin-pwa, proxy (Phase 4)
- `package.json` — new deps: `uuidv7`, `idb`, `vite-plugin-pwa`, `pg` (cloud)
- new `cloud/server.js` — the esquila-cloud service (Phase 2)

## Verification

- Phase 0: restart server twice, confirm no duplicate `L` tags; download an S3 backup and open it with sqlite3.
- Phase 1: run against a copy of the production DB; diff row counts pre/post; exercise every endpoint from the existing apps.
- Phase 3: compare `SELECT count(*)` per table between SQLite and Neon; kill the network mid-sync and confirm the outbox drains after reconnect with no duplicates.
- Phase 4: airplane-mode test on a real phone — browse sheep, apply a preset, confirm "pendiente", go online, confirm the record lands in Neon; hard-refresh offline to prove the SW shell loads.

## Implementation status (2026-08-03)

All phases are **implemented and verified end-to-end locally**: legacy-DB migration, outbox backfill push, lamb-counter restart safety, ranch-timezone date normalization, tombstone replication both directions of origin (on-prem delete and phone delete), LWW replay safety, device auth, and the PWA UI (enrollment via hash URL, snapshot rendering, one-tap preset write synced to Neon).

**Cloud database**: the existing Neon project **`chile-farm`** (`muddy-surf-12021054`, `aws-us-east-2`, Postgres 17) was reused; the schema is applied. Note: it currently holds **test data** from verification. Before going live, clear it:

```sql
TRUNCATE shearing_events, treatments, treatment_presets;
DELETE FROM devices;  -- test devices: ranch-server, test-phone
```

### Go-live checklist (the remaining manual steps)

1. `fly launch --no-deploy` in the repo root (uses `fly.toml` → `cloud/Dockerfile`), then
   `fly secrets set DATABASE_URL=<neon-pooler-url> ADMIN_TOKEN=<long-random-string>` and `fly deploy`.
2. Clear the Neon test data (SQL above).
3. Open `https://<app>/admin` → create a **server** device → set `CLOUD_SYNC_URL` + `CLOUD_SYNC_TOKEN` (and `CLOUD_APP_URL`) in the ranch server's environment.
4. `git pull && npm install && npm run build && npm start` on the ranch machine. First boot migrates SQLite (writes a local `esquila-pre-v1-*.sqlite` safety copy) and uploads all history.
5. Verify row counts: SQLite `counts`/`treatments` vs Neon `shearing_events`/`treatments`.
6. On `/admin`, create one **phone** device per person; scan the QR; add the app to the home screen.
7. Optional: custom domain + cert on Fly (`fly certs add esquila.<domain>`), then set `PUBLIC_URL` so enrollment QRs use it.

## Decisions (resolved 2026-08-03)

1. **Hosting**: cheapest workable option; **the farm is in Chile**, so region matters. Neon has no South America region, and app↔DB proximity matters more than app↔phone proximity (each API call is several queries; the phone does one snapshot fetch + background sync). Decision: **co-locate the Fly.io app with the Neon project's region (US East)**. Phone RTT Chile→US East (~130 ms) is invisible under the offline-first design. Supabase São Paulo was considered for latency but rejected: its free tier pauses projects after inactivity — fatal for a ranch that's offline for weeks — and the paid tier ($25/mo) isn't worth it here. Revisit only if Neon adds `sa-east-1`.
2. **Auth**: per-device QR-enrolled bearer tokens. No Neon Auth / user accounts.
3. **Single flock** — no `flock_id`.
4. **Same-day counts at the shed**: accepted that the phone app won't show today's counts until the ranch server syncs.
5. **No down-sync to on-prem.** The count server exists only to drive the barn-TV Monitor during shearing; vaccination work doesn't need it. Phone + remote is the treatments path.
6. **Remote monitor** (e.g. watching the shearing from NY): future phase, noted but out of scope.
7. **Timezone: America/Santiago (Chile)** for `occurred_on` normalization and all day-grouping.
8. **Snapshot**: full payload — all shearing events + all treatment history + presets. The vaccination report is computed client-side from local data, so it works offline too.
9. **Repo layout**: everything in this repo; cloud service under `cloud/`.
10. **Retention**: keep everything forever, tombstones included.
11. **Backups**: keep the 10-minute S3 SQLite backup (now actually fixed); Neon PITR covers the remote. A more robust backup story is a future phase.
