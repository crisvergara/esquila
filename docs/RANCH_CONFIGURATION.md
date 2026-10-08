# Remote ranch configuration

## Operator workflow

1. Sign in at `/admin` and open **Dispositivos**. Create a **servidor** device if the ranch does not already
   have one. Its token is shown once; keep it private.
2. Open **Configuración** and select the server. Set its name, stations,
   modes, tag colors, prefixes, digit limits, and survey choices, then choose
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

## Configurable modes and local selection

In **Configuración → Modos de conteo**, choose **Copiar configuración de** and
**Agregar modo**. Give the copy a name, edit its colors, prefixes, digit limits
and questions, then publish. Copy an individual mode for tag entry or a bulk
mode for quantity counting. Modes can be reordered, renamed, retired and
restored. At least one must remain active; the limit is 24 including retired
modes. The whole manifest is limited to 80 KB. Restore old choices instead of
creating replacement identities unnecessarily.

The original Ovejas, Carneros and Corderos are defaults, not a fixed list.
Names can change; identifiers and individual/bulk behavior cannot. To change
how a published mode counts, create a new mode and retire the old one. Bulk
modes share the existing durable `L` sequence, so changing modes cannot reuse a
number. Copied surveys/options have identities within their new mode.

On the Mac, open **Configuración… → Modo de conteo**, select **Modo activo** and
choose **Aplicar modo**. This does not save connection settings or restart the
server. **Actualizar lista** refreshes the available modes from the local cache.
The same selector is available on the local `/setup` page. It works without
internet and remembers the choice across restarts. Phones follow the local
server's choice; animals already started retain their original mode and manifest
revision through completion and retries. If a new manifest retires the selected
mode, the server selects its first active mode for new animals. Reordering or
renaming an active selection does not change it.

Each accepted count saves its stable mode ID, display name and counting method;
individual records also save compact tag-validation rules. Both record editors,
cloud filters and the cloud monitor support custom modes. Historical rows show
the captured name even after a mode is renamed or retired. Correcting other
fields keeps the snapshot; deliberately changing a record's mode captures the
selected mode while preserving its original survey. A shared record remains
editable when another server's manifest lacks its mode, using the saved rules.

SQLite v6 adds `counts.mode_json`, with a pre-migration backup for existing
records. PostgreSQL adds `shearing_events.mode` and backfills under the sync
revision lock. Existing IDs, times, tombstones, receipts and outbox entries stay
intact. Legacy records get an explicitly marked inferred mode from their stored
type (`borrega` maps to the original Corderos mode); unknown types are labeled
**Sin modo registrado**. Exact historical custom names cannot be reconstructed.
Snapshots travel with records and audit history in both sync directions. Missing
or legacy mode metadata from an older writer cannot erase a richer snapshot.

Update each Mac before publishing modes. The editor publishes schema 3; older
apps reject it and keep using their last compatible cached configuration. Reload
phone tagger tabs after installing the Mac update. Deploying the cloud does not
change the active local mode until its manifest is downloaded. There is no new
public endpoint for configuration editing or credential in a mode manifest.

## Configurable shearing surveys

In each animal mode, **Preguntas de la encuesta** lets an administrator add,
rename, reorder, retire, and restore questions. Choose **Opciones** (including
sí/no), **Texto**, or **Número**; set whether the answer is required, numeric
bounds, or a text length limit. You can retire all questions. Sheep start with
wool quality and lactation; rams and lambs start with no questions. Lamb-batch
answers apply to every animal in the batch and can be corrected individually.
The animal modes themselves retain their individual/bulk counting semantics.

The tagger shows each question as a large heading above its answers, with a
question counter and required/optional indication. On portrait phones the heading stays visible
while scrolling through choices; entering a question returns to the top and
focuses its heading. The confirmation screen pairs each original question with
its selected answer, including omitted responses. Short screens and text/number
inputs scroll normally so a pinned heading cannot cover the answer controls.

A question's identifier and type are permanent. To change its type or meaning,
retire it and add a new question. Retired questions/options remain in the
manifest so they can be restored. Limits are 24 retained questions per mode,
64 choices per question, 500 characters per text answer, and bounded numeric
values. Publication validates the complete configuration before committing.

Each new shearing event stores a snapshot of the questions actually asked,
including their labels, choice labels, validation rules, and responses. Changing
a question or answer label affects future animals only. The local **Registros
recientes** screen and cloud **Registros** show and edit the
saved snapshot, even when a question or choice has since been retired. Changing
an old record's animal type also preserves its original survey. No new question
is retroactively added to a historical event. Manual new records use the current
survey; a manifest change while the add form is open requires reopening it.

Survey corrections use the same durable submission receipts, stale-editor
checks, conflict history, tombstones, and bidirectional sync as tag corrections.
A lost response can be retried across reload/restart without duplicating the
record. Survey answers synchronize as part of the entire event, not as separate
per-question merges. Concurrent offline corrections therefore retain the usual
last-write-wins behavior, with the discarded cloud version in history.

### Upgrade and historical migration

Deploy the cloud release and update the ranch Mac app before publishing the new
manifest format (configuration schema 3, including surveys). Older Macs reject it and keep
counting with their last cached configuration; they cannot collect newly added
questions. Reload open tagger/record tabs after upgrading. Newly opened Macs
continue to accept and migrate the original schema-1 manifests.

SQLite schema 5 adds `counts.survey_json` transactionally, with a pre-v5 backup
when records exist. PostgreSQL adds `shearing_events.survey` (JSONB), backfills
old events at startup, and issues sync revisions/audit entries for the backfill.
Both migrations preserve identities, occurrence/update times, tombstones,
queued writes, and receipts, and run only once. Existing wool/lactation columns
remain for older installations and flock-status consumers.

Historical rows did not record the question labels or a manifest revision.
Their saved wool/lactation values are imported into an explicitly marked legacy
survey with the original built-in labels; unknown values remain visible as
stored identifiers and missing answers remain missing. Exact customized labels
from the time of those old events cannot be reconstructed. Ram/lamb placeholder
values do not create questions that were never asked.

Older server uploads that omit the survey (or include only a migrated legacy
survey) preserve any custom answers already stored in the cloud while applying legacy wool/lactation corrections. The newer
barn also preserves survey data if an older cloud omits that field on a pull.
Do not downgrade a populated ranch database to old application binaries as a
rollback strategy; recover with its backup and an explicit reconciliation plan.

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
- `GET /mode` lists active cached modes and the local selection; `POST /mode`
  persists an active mode ID without internet.
- `/count` and `/bulk` carry the selected mode in `type` and optionally accept `configurationRevision`, resolving only
  locally stored versions. Unknown revisions fail closed.

The manifest contains schema version, ranch name, station slots and a variable
list of mode schemas, wrapped in a device ID, monotonic revision and UTC publication
timestamp. It contains no credential, remote command, download URL or code.
