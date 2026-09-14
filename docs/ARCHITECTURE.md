# Current architecture and application requirements

This document describes the implemented system. For the design history and
resolved product questions, see [OFFLINE_SYNC_UPGRADE.md](OFFLINE_SYNC_UPGRADE.md).

## System boundaries

```text
Barn WiFi (internet optional)

  Tagger phones ─┐
                 ├─ HTTP/SSE ─> Barn server ─> SQLite + durable sync outbox
  Monitor TV ────┘                    │
                                      │ HTTPS when available
                                      v
Internet                         Cloud service ─> PostgreSQL
                                      ^
                                      │ HTTPS, direct phone sync
                            EsquilaDB vaccination PWA
                            (IndexedDB snapshot + outbox)
```

| Component | Runtime | Persistent data | Network dependency | Responsibility |
|---|---|---|---|---|
| Barn server | `countserver.js` in Electron or Node | SQLite, configuration, shearers | Barn LAN required; internet optional | Accept counts, serve tagger/monitors/setup, stream live changes, queue cloud sync, create backups |
| Tagger | React app under `tagger/` | Selected station in browser storage | Barn server only | Record ewes, rams, and bulk lambs with visible outcome and retry safety |
| Monitor | React apps under `monitor/` and `mobilemonitor/` | None authoritative | Barn server only | Display current station totals, last tags, active mode, and updates |
| Mac shell | Electron code under `mac/` | macOS Application Support | None for hosting | Onboard/configure the server, request LAN access, show fullscreen monitor, run from menu bar/login |
| Cloud service | `cloud/server.js` | PostgreSQL | Internet | Authenticate devices/admin, ingest sync batches, serve flock snapshots and the PWA |
| EsquilaDB | React PWA under `esquiladb/` | IndexedDB snapshot, token, pending outbox | None while working; cloud needed to refresh/sync | Search the flock and record treatments directly against the cloud boundary |

The Raspberry Pi files remain a supported fallback, but the Apple Silicon Mac
application is the preferred barn deployment.

## Data ownership and identity

- `counts` in barn SQLite originates shearing records. It maps to
  `shearing_events` in PostgreSQL.
- `treatments` and `treatment_presets` may originate from EsquilaDB. The cloud
  is their shared system of record. Legacy barn endpoints remain transitional.
- Every synchronized entity has a client-generated UUIDv7 `id` and an
  `updated_at` instant. Synchronized records use tombstones (`deleted_at`) rather
  than hard deletion.
- `origin` records the creating server/device. Device display names are useful
  attribution, not an authorization mechanism.
- Treatment occurrence is an `occurred_on` Chile calendar date. Shearing and
  update times are absolute timestamps.
- Current sheep status is derived from the newest live shearing event for a tag;
  it is not a separately mutable sheep row.

Schema definitions are canonical in the migration code in `countserver.js` and
in `cloud/schema.sql`. A schema change must include migration behavior for
existing barn databases, fresh-install behavior, synchronization mapping, and
tests for both old and new data.

## Counting flow

1. The phone selects a station and follows the active mode from `/sse`.
2. It validates and submits a single `/count` or a `/bulk` request with a stable
   `submissionId`.
3. The barn server validates again. In one SQLite transaction it records the
   submission, creates the row(s), and queues outbox entries.
4. Only after commit does it return structured success. The UI shows the result.
5. `/count/events` immediately refreshes monitors; periodic reads remain a
   reconnect fallback.
6. The sync agent later uploads at most 500 queued entries per attempt. Failed
   attempts remain queued and back off to a ten-minute maximum.

A client may lose the response after step 3. Retrying the same submission must
return success without creating another animal. Bulk quantity must be an integer
from 1 through 1,000. Lamb numbers must continue monotonically after restart.

## Vaccination and flock lookup flow

1. A phone enrolls from an admin-generated URL/QR and stores its device token in
   IndexedDB.
2. The PWA renders the last full snapshot immediately, even offline.
3. A treatment write receives a UUIDv7, is merged into local UI state, and is
   placed in the IndexedDB outbox before success is shown.
4. When online, pending rows are sent directly to `/api/sync/push`. The local
   entry is removed only after cloud confirmation.
5. `/api/snapshot` replaces the saved live snapshot after successful refresh;
   pending local entries are still overlaid until accepted.

The service worker caches the application shell, not `/api/*`. IndexedDB owns
offline data semantics; adding HTTP response caching would create two competing
sources of truth.

## Cloud conflict and authorization rules

- Sync batches are transactional: one invalid row rolls back the whole request.
- Replaying the same UUID is safe. A row updates only when the incoming
  `updated_at` is later than the stored value.
- `server` devices may write shearing events, treatments, and presets.
- `phone` devices may write treatments and presets, never shearing events.
- Any enrolled device may read the snapshot. Revocation takes effect by deleting
  its database device row.
- The full snapshot is intentional for this single-flock scale. Do not introduce
  pagination without designing atomic snapshot replacement and offline behavior.

## Failure requirements

| Failure | Required behavior |
|---|---|
| Internet unavailable at barn | Counting, modes, setup, and monitors continue; outbox grows durably |
| Cloud restored | Outbox drains without gaps or duplicates; newer cloud rows are not overwritten by stale rows |
| Barn response lost after commit | Stable submission retry reports success and adds no duplicate |
| Barn process restarts | Existing SQLite data, station configuration, mode, lamb sequence, and pending sync survive |
| Vaccination phone offline | Snapshot remains searchable; new treatment is visible as pending |
| Phone reconnects | Pending treatment syncs directly to cloud and pending state clears |
| Device revoked | Subsequent push and snapshot requests return unauthorized; unsent local work is not silently discarded |
| Malformed/oversized input | Server returns a bounded 4xx response and commits no partial data |
| Monitor event stream drops | Browser reconnects and periodic refresh eventually restores current totals |

## Intentional current limitations

- One flock and one barn server are assumed.
- The cloud provides full snapshots rather than incremental pull.
- A remote live monitor is deferred.
- The barn LAN API is unauthenticated and uses HTTP; physical/WiFi network trust
  is assumed. See [SECURITY.md](SECURITY.md).
- Mac releases are ARM64, ad-hoc signed, and manually updated; notarization and
  auto-update are future distribution work.
- S3 SQLite backup is retained, with a more robust backup/restore system deferred.

