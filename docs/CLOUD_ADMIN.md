# Cloud administration and shearing review

The authenticated admin site has persistent navigation and separate pages:

| Screen | Address | Purpose |
|---|---|---|
| Resumen | `/admin` | Shared flock totals by Chile day and station; server contact, version and pending sync |
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
Choose **Servidor**, a partial **Buscar código**, and **Ordenar por**. Expand
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
- **Históricos sin servidor identificado** includes older rows that cannot be
  attributed reliably. They remain visible, editable and synchronized.

Server attribution is collected from the authenticated device during upload,
not from the legacy `origin` string (often just `ranch-server`). We do not guess
which server created old records. New manual cloud records are associated with
the selected/reference server but are not shown as an upload until that server
uploads them. A record can be sent by more than one server. Revocation retains
historical attribution and marks the server as revoked.

This is still **one shared flock**: filtering by server does not restrict which
records sync to other enrolled ranch servers. An acknowledgement badge refers
to the filtered server, or all enrolled servers when none is selected. No active
recipient means the record remains pending. The overview monitor shows shared
counts; station names use the chosen reference server, including past dates.

## Correct a scan

Choose **Editar** in the row. The form shows the recorded survey questions and
answers from that shearing, even if today's manifest differs. Save changes to
its tag, station, type, color or survey responses. The original occurrence time
and stable identity are preserved. **Eliminar** asks for confirmation and keeps
a tombstone. **Historial** shows readable before/after versions, including local
corrections superseded by newer changes.

A successful save means **saved in cloud**. The ranch receives it on its next
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
not erase historical information. No SQLite migration or Mac update is needed.

The existing shearing payload, revision ordering, receipts, LWW checks, survey
snapshots and tombstone protocol remain unchanged. The read API validates and
bounds filters and uses parameterized SQL and a repeatable-read transaction for
consistent totals/pages. Existing `day`, `tag`, `offset`, and `deleted=1` API
calls remain supported; new controls add `from`, `to`, `server`, `station`,
`type`, `color`, `sync`, `sort`, and `limit`. All pages and APIs retain session,
CSRF, no-store and content-security protections. UI tests use disposable data.

## Language preference

English and Spanish controls have independent preferences for the Mac, cloud
admin browser, and tagger. Choose English in Mac settings and cloud administration
while leaving the tagger in Spanish. Ranch-authored names and questions stay as
entered. See [language settings and the Spanish audit](LOCALIZATION.md).
