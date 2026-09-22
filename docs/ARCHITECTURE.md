# Current architecture and application requirements

This document describes the implemented system. For the design history and
resolved product questions, see [OFFLINE_SYNC_UPGRADE.md](OFFLINE_SYNC_UPGRADE.md).

## System boundaries

```text
Barn WiFi (internet optional)

  Tagger phones ─┐
                 ├─ HTTP ─> Barn server ─> SQLite + durable sync outbox
  Monitor TV ────┘                    │
                                      │ HTTPS when available
                                      ↕
Internet                         Cloud service ─> PostgreSQL
                                      ^
                                      │ HTTPS, direct phone sync
                            EsquilaDB vaccination PWA
                            (IndexedDB snapshot + outbox)
```

| Component | Runtime | Persistent data | Network dependency | Responsibility |
|---|---|---|---|---|
| Barn server | `countserver.js` in Electron or Node | SQLite, configuration, shearers | Barn LAN required; internet optional | Accept counts, serve tagger/monitors/setup, serve current counts/mode, queue cloud sync, create backups |
| Tagger | React app under `tagger/` | Selected station in browser storage | Barn server only | Record ewes, rams, and bulk lambs with visible outcome and retry safety |
| Monitor | React apps under `monitor/` and `mobilemonitor/` | None authoritative | Barn server only | Display current station totals, last tags, active mode, and updates |
| Mac shell | Electron code under `mac/` | macOS Application Support | None for hosting | Onboard/configure the server, request LAN access, show fullscreen monitor, run from menu bar/login |
| Cloud service | `cloud/server.js` | PostgreSQL | Internet | Authenticate devices/admin, ingest sync batches, serve flock snapshots and the PWA |
| EsquilaDB | React PWA under `esquiladb/` | IndexedDB snapshot, token, pending outbox | None while working; cloud needed to refresh/sync | Search the flock and record treatments directly against the cloud boundary |

The Raspberry Pi files remain a supported fallback, but the Apple Silicon Mac
application is the preferred barn deployment.

The Mac shell holds a `prevent-app-suspension` power assertion while hosting,
including with all windows closed and during child-process recovery. Normal
idle sleep must not take the barn server offline. The assertion ends on app
exit; display sleep and screen locking remain available. Explicit system sleep,
lid closure, shutdown, and battery exhaustion can still interrupt LAN service.

## Data ownership and identity

- `counts` in barn SQLite and authenticated cloud administrators may originate
  and correct shearing records. Barn `counts` maps to PostgreSQL
  `shearing_events`; both replicas reconcile through the cloud. Phone-role
  devices cannot mutate shearing rows.
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

Schema definitions are canonical in `countserver.js`, `shared/ranch-sync.js`, and
in `cloud/schema.sql`. A schema change must include migration behavior for
existing barn databases, fresh-install behavior, synchronization mapping, and
tests for both old and new data.

## Counting flow

1. The phone selects a station and follows the active mode from `/api/live`.
2. It validates and submits a single `/count` or a `/bulk` request with a stable
   `submissionId`.
3. The barn server validates again. In one SQLite transaction it records the
   submission, creates the row(s), and queues outbox entries.
4. Only after commit does it return structured success. The UI shows the result.
5. Short `/api/live` requests refresh counts and mode once per second while
   visible (five seconds in background), with bounded retries after failure.
6. The sync agent later uploads at most 500 queued entries per attempt. Failed
   attempts remain queued and back off to a ten-minute maximum.

A client may lose the response after step 3. Retrying the same submission must
return success without creating another animal. Bulk quantity must be an integer
from 1 through 1,000. Lamb numbers must continue monotonically after restart.

## Browser connection budget

Tagger and monitor pages share one polling loop per page for counts and mode.
Requests have a five-second deadline, never overlap, and back off up to ten
seconds on failure. Returning online or focusing the page retries immediately.
A visible error marks stale data; reconnection clears it. Counting writes keep
independent retry-safe submission IDs and never wait for a status refresh.

Earlier taggers opened two permanent EventSource connections per tab. Several
open tabs exhausted the browser's HTTP/1 connection pool and blocked navigation
and writes even while the server was healthy. New clients use short JSON
requests to avoid that failure. Legacy `/sse` and `/count/events` endpoints remain
compatible; old tabs must be closed/reloaded after updating the Mac app. The
tradeoff is up to one second of foreground display/mode propagation latency.

## Phone connection discovery

The phone-setup page refreshes `/tagger-info` every five seconds and on focus.
The response includes a QR and text URL generated from the same network snapshot,
plus alternate LAN interfaces. VPN, loopback, and link-local addresses are not
advertised. No usable IPv4 address means no QR; an unavailable server clears the
last QR instead of leaving an obsolete link visible. Operators can select the
interface on the phone’s LAN. This is address discovery, not proof that a phone
can connect through router isolation or VPN policies.

## Barn record corrections

The Mac menu opens `/records/`, a LAN-only editor backed by `GET/POST
/api/records`. It lists the latest 200 live records and supports code filtering.
Adds, edits, and deletes run in one SQLite transaction with their outbox entry
and a durable `record_mutations` receipt (additive schema version 2). Receipts
bind a submission ID to the exact mutation; replay returns the previous result,
and reusing the ID for different content fails. The editor retains unconfirmed
requests in browser storage across reloads and window closure.

Edits and deletes require the row's current `updated_at` to reject stale editors.
Edits retain identity and occurrence time. Each mutation advances `updated_at`
strictly, even within the same millisecond or after a backwards clock change.
Deletes retain tombstones; existing cloud LWW rules prevent stale resurrection.
Manual lamb codes reserve their sequence number durably in `lamb_sequence` for
subsequent bulk counts, even if the code is later edited or deleted.
All mutations refresh monitor counts after commit. The pending total includes
deletions even though the table hides deleted rows. As with counting, the local
API trusts the ranch WiFi and grants no additional cloud roles to phones.

## Cloud ranch management and bidirectional shearing sync

`/admin` serves a password-protected monitor and paginated record editor in
addition to device enrollment. `GET /api/admin/ranch` reports the last heartbeat
per server device, version/hostname/platform, uptime, mode, configured shearers,
local outbox size, and cloud rows awaiting acknowledgement (including deletes).
`GET /api/admin/shearing` filters by Chile date and code, returns 100 rows per
page, and optionally includes tombstones. Monitor totals ignore the code filter
and exclude deleted records. Both local and cloud monitors use `America/Santiago`.
Station names come from the most recently reporting server; historical name
assignments are not stored. Contact older than three minutes is marked stale;
this is a synchronized monitor, not a cloud dependency in the LAN counting path.

Admin writes use shared field validation, optimistic `updated_at` checks, and a
transactional submission receipt (`admin_record_mutations`). The browser saves
the exact request before sending and offers a safe retry after reload or an
ambiguous response. Adds get UUIDv7 identities, edits preserve occurrence time,
and deletes retain tombstones. Admin writes require internet and existing admin
authentication/CSRF checks. A cloud commit is displayed separately from ranch
receipt; no remote change triggers an application update or restart.

After each successful outbox push (or with an empty outbox), the barn posts its
last applied cursor and heartbeat to `/api/sync/ranch`. Only server-role devices
can use this endpoint. It returns at most 500 current shearing versions ordered
by revision, including tombstones. A PostgreSQL transactional counter lock
serializes shearing writers, so committed revision order cannot skip a delayed
transaction as an ordinary sequence could. Revisions may have gaps. Existing
cloud rows are assigned revisions on migration.

SQLite schema version 3 adds `ranch_sync_state`. Each page is validated before
applying rows and its cursor in one transaction. Restart/replay is safe. Imported
rows never enter the outbox; the merge reserves lamb numbers and refreshes local
monitors. Local timestamps newer than the cloud are retained. Before replacing
an equal/newer row with pending local writes, the merge stops at that row until
those writes have been uploaded, preserving the chance to audit a conflict.
The cloud wins exact timestamp ties. No per-field merge is attempted.

Cloud changes retain before/after versions in `shearing_audit`. Discarded stale
or equal-timestamp conflicting uploads are also retained with deduplication;
identical replays add no history. The admin history shows the latest 50 entries
per record, including deleted records. Unsynchronized intermediate local edits
may be coalesced by the existing outbox: this is a cloud reconciliation history,
not a full local keystroke audit. History, receipts, and tombstones are retained
indefinitely; pruning requires a separate retention/acknowledgement design.

Each network request has a 30-second deadline. Failures preserve local data and
cursor and use the existing exponential backoff. One page is processed per
cycle, so initial historical catch-up may take several minutes. A cursor ahead
of the cloud fails closed to flag a database restore requiring operator review;
never reset a production cursor or erase tombstones without a recovery plan.
Treatments continue using their existing ownership and phone snapshot protocol.

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
- Authenticated administrators may add, edit, and soft-delete shearing events.
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
| Status request fails | Visible stale-data warning; bounded retries restore counts and mode |

## Mac update distribution

The cloud serves a public, non-cacheable `GET /api/updates/mac` manifest baked
into its image. Missing or invalid metadata returns 503 without breaking other
cloud endpoints. CI embeds its run number and commit into the Mac package,
verifies the installer, publishes permanent GitHub Release assets, and only then
deploys the manifest. Published assets are reused on retries rather than replaced.
This keeps the cloud advertisement tied to an available, verified installer.

The ARM64 Mac shell checks at startup and every six hours, with a manual menu
check. It accepts only the supported schema, architecture, increasing build
number, nondecreasing package version, and an exact HTTPS download URL within
this repository. Downloads permit only GitHub's known HTTPS asset hosts, impose
size/inactivity limits, resume partial files with validated HTTP ranges, verify SHA-256, and rename only
after success. Cached files are reverified immediately before opening.

Checks and downloads never stop the barn child process or depend on its sync
credentials. A user explicitly confirms installation before any native staging. Production
builds are Developer ID signed and notarized. The backward-compatible schema-1
feed retains its DMG fields and adds an optional `automatic` ZIP descriptor with
size, digest, URL, and Apple team. Signed clients choose it only for their own
team. After verification and consent, a random-token loopback-only HTTP server
passes the cached ZIP to Electron/Squirrel, which checks the code signature.
The barn child stops only after staging succeeds, then Squirrel replaces and
relaunches the app. Before consent, quitting cannot apply a downloaded update.
Older or differently signed clients retain the manual DMG path. Ranch data stays
in Application Support outside the application bundle. No remote installation
command or automatic schema rollback is supported.

## Intentional current limitations

- One flock and one barn server are assumed.
- Vaccination phones receive full snapshots; barns incrementally pull shearing.
- The remote monitor is as current as the last ranch sync, typically one minute.
- Accurate computer clocks matter for conflicting offline corrections.
- The barn LAN API is unauthenticated and uses HTTP; physical/WiFi network trust
  is assumed. See [SECURITY.md](SECURITY.md).
- Mac releases are ARM64. Installation requires operator confirmation; updates
  never restart an active counting session automatically.
- S3 SQLite backup is retained, with a more robust backup/restore system deferred.
