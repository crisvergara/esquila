# Remote ranch configuration

## Operator workflow

1. Sign in at `/admin`. Create a **servidor** device if the ranch does not already
   have one. Its token is shown once; keep it private.
2. In **Configuración de galpones**, select the server. Set its name, stations,
   tag colors, prefixes, digit limits, and survey choices, then choose
   **Publicar configuración**. No JSON editing or application rebuild is needed.
3. For a new Mac, enter the cloud origin and that server's token in Esquila.
   Choose **Cargar configuración del galpón**, review the ranch and stations,
   then **Guardar y abrir monitor**. The first enrollment needs internet and a
   published configuration. Subsequent starts work entirely offline.
4. Use **Administrar este galpón en la nube…** in the sheep menu to open its
   specific admin page. The normal admin password is still required. The link
   carries only the server ID, never a device token or admin password.

Green (**Verde**) and black (**Negro**) are included for both sheep and rams.
Black is distinct from **No Hay** (no tag color). Add a color with a name,
background swatch, and text swatch; choose readable contrasting colors. The
preview shows the same combination used on phones and monitors.

There are up to 24 station slots. **Quitar estación** deactivates a slot without
renumbering later stations. **Restaurar estación** reuses that same number.
Retired stations with counts still appear in the monitor. Renaming a station
changes its displayed name for previous dates too; historical personnel
assignments are not a separate data model.

**Quitar** a color, prefix, or answer removes it from new entries and retains its
identifier for historical records. It can be restored. Existing records keep
their data and can be corrected while retaining a retired value. New entries
cannot choose retired options. There are at most 64 retained choices per list;
restore an old choice instead of repeatedly creating duplicates.

The three animal modes retain their counting semantics: sheep have wool and
lactation questions, rams have individual tags without those questions, and
lambs use bulk counting with automatic `L` numbers. Names/options of the sheep
questions and per-mode tag formats are configurable. Adding another animal
type or a new database field remains a code/schema change.

## Publication and offline behavior

Saving publishes a numbered, immutable version in PostgreSQL. The page reports
**Pendiente en el galpón** until the server acknowledges receipt; publishing is
not the same as immediate delivery. When connected, delivery is normally within
one minute. Network failures retry up to a ten-minute interval. Invalid or older
metadata leaves the last working configuration in place.

The barn validates and commits each manifest to SQLite before using it. Its
phones fetch only the barn's local `/api/live`; they never call the cloud.
Polling sends configuration only when its identity/revision changes. An animal
already being entered keeps its starting schema and station through submission
and response-loss retries. New settings apply to the next animal. No manifest
change stops counting, restarts Esquila, or installs software.

Configuration sync runs independently from record upload/pull, so a malformed
manifest cannot block shearing reconciliation and a stuck upload cannot block
configuration delivery. Each request has a deadline. A revoked server retains
its offline configuration and queued counts but cannot synchronize until its
credentials are repaired.

Two administrators cannot silently overwrite each other: publication requires
the revision originally loaded. A stale editor must reload and reapply its
changes. If a save response is lost, **Reintentar publicación** uses the same
durable submission receipt, even after closing/reloading the page. Unpublished
form edits remain only in the current page; a navigation warning protects them.

## Existing installations and boundaries

Deploy the cloud and install this Mac release before configuring new choices.
Older clients continue counting with their bundled JSON and do not acknowledge
configuration revisions; close/reload older tagger pages after the upgrade.

When an upgraded barn first connects and no cloud configuration exists, it
imports its existing station names and bundled mode definitions as revision 1.
A configuration already published by an administrator takes precedence. Old
local names are not blindly substituted into a published remote configuration.
For an entirely standalone unregistered install, the previous local setup remains
available. Once managed, local station editing directs the operator to the cloud.

Configuration is scoped to the authenticated server device ID. A server token
cannot read or modify another server's configuration, and phone tokens cannot
use configuration endpoints. Only authenticated administrators can publish after
the initial barn import. Device revocation deletes its cloud configuration and
configuration history along with its credential; it does not delete shearing
records. Back up these tables with the cloud database.

This remains one shared flock. Per-server configurations do not create separate
flocks or change existing bidirectional shearing replication. The remote monitor
uses station names/options from the selected server and explicitly labels the
records as shared. Local connectivity still requires working ranch Wi-Fi.

## Storage and API

- PostgreSQL: `ranch_configurations` stores the published version and receipt
  status; `ranch_configuration_history` retains versions and their source;
  `ranch_configuration_receipts` makes publication retries idempotent.
- SQLite schema version 4 adds `ranch_configuration`. Cache namespaces are a
  hash of cloud origin and server credential, so changing enrollment cannot reuse
  another server's manifest. Versions remain available for in-progress requests.
- `tagger/modeschema.json` and `shearers.json` are bootstrap defaults. Runtime
  configuration is in SQLite; editing bundled files is not a management workflow.
- `GET/PUT /api/admin/ranches/:id/configuration`: authenticated admin read and
  optimistic publication with `revision`, `configuration`, and `submissionId`.
- `GET /api/server/configuration`: server-token-scoped onboarding preview.
- `POST /api/sync/configuration`: server-token-scoped pull/acknowledgement; only
  revision-zero clients may bootstrap an as-yet unconfigured server.
- `GET /api/configuration`: non-secret local manifest/status for the Mac shell.
- `/count` and `/bulk` optionally accept `configurationRevision`, resolving only
  locally stored versions. Unknown revisions fail closed.

The manifest contains schema version, ranch name, station slots and the three
mode schemas, wrapped in a device ID, monotonic revision and UTC publication
timestamp. It contains no credential, remote command, download URL or code.
