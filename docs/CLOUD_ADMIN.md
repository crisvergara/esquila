# Cloud administration and shearing review

The authenticated admin site has persistent navigation and separate pages:

| Screen | Address | Purpose |
|---|---|---|
| Resumen | `/admin` | Selected server's totals by Chile day and station; contact, version and pending sync |
| Registros | `/admin/records` | Recent shearing records, filters, corrections, survey answers, deletion and history |
| Configuración | `/admin/configuration` | A server's stations, colors, tag rules and versioned surveys |
| Dispositivos | `/admin/devices` | Enroll/revoke servers and phones; display one-time credentials |
| Mi cuenta y accesos | `/admin/accounts` | Personal account, invitation and recovery controls |

The selected server follows the navigation links. Existing Mac menu links such
as `/admin?server=<device-id>#configuration` still open the configuration screen
after login. Configuration of a newly enrolled server opens in a new tab so its
one-time token remains visible on the device screen. No token is placed in the
configuration link. Unpublished configuration retains its navigation warning.

## Find recent scans

Open **Registros** to see the latest shearing events across **all dates**, without
entering a code. A server card's **Ver registros** link selects that server.
Choose **Servidor**, a partial **Buscar código**, **Día (Chile)**, and **Ordenar por**. Expand
**Más filtros** to combine inclusive Chile date ranges, station, animal type,
tag color, acknowledgement status and deleted rows. **Hoy en Chile** applies
today's Chile calendar date; **Limpiar filtros** returns to all records.

- **Esquila más reciente / antigua** orders by the original shearing instant.
- **Última carga del servidor** puts newly received uploads first, even if the
  shearing occurred days ago while offline. Historical rows without upload
  metadata sort after known uploads and show that their upload time is unknown.
- **Última modificación** helps find recent corrections, including cloud edits.
- Page sizes are 25, 50 and 100. Filters, sort and pagination live in the URL and
  survive reload and browser back/forward. Search and save refresh the table;
  background uploads do not rearrange it while the operator is reviewing it.
- **Fila** numbers positions across the filtered pages (1–50, 51–100, etc.);
  these numbers are not animal identifiers and can change after a refresh.
- **Históricos sin servidor identificado** includes older rows that cannot be
  attributed reliably. They remain visible and editable in the cloud. Choose
  **Servidor propietario** while editing to assign one after reviewing its history.
  Until assigned, these records do not sync to any ranch.

Every record has one permanent **owning server**, established by the authenticated
token on its first upload, independently of the legacy `origin` string. Only that
server can upload corrections and receive the record or its deletion. Manual
cloud additions require an explicit owning server; cloud administrators can
edit records belonging to any server. Once assigned, ownership cannot be changed
in the editor. Revocation retains ownership and history; it does not transfer
records to a newly enrolled device with the same name.

Choose **Todos los servidores** to search and report across all connected servers
and unassigned history. This does not broaden a ranch server's sync access.
Acknowledgement badges refer only to each record's owner. An unassigned record or
a revoked owner remains pending. The overview monitor shows only the selected
server's counts; station names use that server's configuration.

## Reports for the selected records

Expand **Resumen e informes** on the records screen. The report uses every row
matching the current filters, across all pages, and always excludes deleted rows.
This differs from the overview monitor, whose totals ignore record-detail filters.
Selecting a server limits the report to its owned records; clearing the
server includes every server and unassigned history. The day shortcut sets
both ends of the inclusive Chilean date range. Totals, rows and survey aggregates
are read from one consistent database snapshot.

- **Ovejas contadas** counts shearing events, not distinct animal tags. Repeated
  shearings count separately. Totals also split by station and recorded mode.
  Station names come from the current reference configuration; mode names come
  from each event's saved snapshot.
- Choice questions show counts and percentages for each saved answer and for
  skipped answers. Only events that actually recorded that question enter its
  denominator. Records with no survey are counted separately.
- Numeric questions show average, minimum and maximum over answered values;
  zero is an answer. Text questions show answered/unanswered counts; their text
  remains available in the record editor.
- Changed question or option wording is reported separately within each recorded
  mode. Later manifest edits never relabel old responses. Built-in controls are
  translated; ranch-authored names and questions are not.

Reports refresh on filtering, paging, manual refresh and corrections. Failures
show an error instead of partial totals. If more than 2,000 saved question/answer
groups are needed, the survey section asks for a narrower day/code filter; basic
counts still cover all matching records. Corrections appear on the other side
after synchronization. The same report is available offline in the Mac's
**Registros recientes** window after installing this release.

## Export to Excel

In **Registros / Records**, apply your filters, then choose **Exportar a Excel /
Export to Excel**. The `.xlsx` download includes **all matching pages**, in the
selected order, even when you are viewing a later page. Unapplied changes in the
search form are not included. The file is a fresh, consistent snapshot of the
cloud database; counts still waiting on an offline ranch are not available yet.
Check the browser's Downloads list after the completion message.

The workbook uses the admin browser's language for headings and contains:

- **Records**: numbered rows, stable record and owning-server IDs, tag codes,
  Chile day/time and original UTC instant, station number, saved mode, color
  code, acknowledgement status, deletion state and upload/update timestamps.
  Server names are current references (or retained names for revoked servers).
  Station numbers and color codes avoid inventing historical names.
- **Answers**: one row per saved survey question, with its original wording,
  type, response value and saved choice label. Numeric answers remain numbers,
  including zero. Skipped questions have a blank value and an explicit unanswered
  flag; questions never asked have no row. Records without questions remain in
  the Records sheet. Imported legacy surveys are marked in Records.
- **Export**: generation time, timezone, record count, scope and applied filter
  values. This is an export for analysis, not an import or database backup.

Deleted records are excluded unless **Include deleted** is selected; included
deletions are clearly marked. Tags remain text, including leading zeros. Excel
filters and frozen headings help browse the workbook; values beginning with
formula characters remain literal text. Ranch-authored content is not translated.

The cloud permits one export at a time per instance, up to **10,000 records**
(and their saved answers). Larger selections produce an error; narrow the server
or date filters. Export failures show a retry message and never change records
or sync state. Only authenticated administrators can download exports; device
tokens do not grant access. No Mac update is needed for this cloud feature.

## Correct a scan

Choose **Editar** in the row. The form shows the recorded survey questions and
answers from that shearing, even if today's manifest differs. Save changes to
its tag, station, type, color or survey responses. The original occurrence time
and stable identity are preserved. **Eliminar** asks for confirmation and keeps
a tombstone. **Historial** shows readable before/after versions, including local
corrections superseded by newer changes.

A successful save means **saved in cloud**. The owning ranch receives it on its next
successful sync; refresh the list to see **Recibido en galpón**. Offline ranches
continue counting and catch up later. Interrupted saves retain the exact request
in this browser for **Reintentar mismo cambio**, including after reload. A stale
editor must reload the latest record instead of overwriting another correction.

## Storage and compatibility

`shearing_record_servers` is an additive, cloud-only attribution table keyed by
record and server UUID, with a retained server name and first/latest upload
instants. Upload attribution commits in the same transaction as the batch and
rolls back with it. Equal/older retries do not advance upload timestamps. Manual
cloud additions record their server context in the same mutation transaction.
The table deliberately has no device foreign key so credential revocation does
not erase historical information. It records provenance, not replication permissions.

The authoritative `shearing_events.owner_server_id` is immutable after assignment.
Cloud migration uses original creation evidence, leaving ambiguous history
unassigned. SQLite v7 archives foreign copies and their pending corrections
before removing them locally, without deleting cloud data. See the
[ownership rollout and recovery guide](DEPLOY.md#server-ownership-rollout).
Revision ordering, receipts, LWW checks, survey snapshots and tombstones remain.
The read API validates and
bounds filters and uses parameterized SQL and a repeatable-read transaction for
consistent totals/pages. Existing `day`, `tag`, `offset`, and `deleted=1` API
calls remain supported; new controls add `from`, `to`, `server`, `station`,
`type`, `color`, `sync`, `sort`, and `limit`. `report=1` adds full filtered report
aggregates without changing monitor totals or sync payloads. All pages and APIs retain session,
CSRF, no-store and content-security protections. UI tests use disposable data.

## Language preference

English and Spanish controls have independent preferences for the Mac, cloud
admin browser, and tagger. Choose English in Mac settings and cloud administration
while leaving the tagger in Spanish. Ranch-authored names and questions stay as
entered. See [language settings and the Spanish audit](LOCALIZATION.md).
