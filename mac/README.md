# Esquila for Mac — barn server

The Mac app packages the existing on-prem Node/SQLite service as a normal
macOS application. No Node installation, Terminal window, or Raspberry Pi is
required on the barn computer.

## What your father does

1. Connect the MacBook to the barn WiFi using the normal WiFi menu.
2. Open `Esquila.dmg`, then drag **Esquila** into **Applications**.
3. Open Esquila from Applications. Production releases from 0.1.7 are Developer
   ID signed and notarized. Accept the normal first-open confirmation. When
   macOS asks for local-network access, choose **Allow**. Older ad-hoc releases
   may require Control-click → Open for the one-time migration.
4. In the setup window:
   - enter the cloud sync URL and server token from the remote admin;
   - choose **Cargar configuración del galpón** and review its name and stations;
   - publish that server's configuration in `/admin` first if prompted;
   - the vaccination-app URL defaults to the same cloud URL;
   - leave **Start Esquila automatically** selected.
5. Choose **Save and open monitor**. The monitor fills the screen.

The first enrollment needs internet. Later launches and counting use the saved
manifest without internet. Existing installations import their current station
names on their first configuration sync unless an administrator already
published settings. Choose **Administrar este galpón en la nube…** in the sheep
menu to edit modes, colors, stations, tag formats and surveys for this exact server.
The browser uses the normal admin login; the menu link contains no credential.
See [remote configuration](../docs/RANCH_CONFIGURATION.md) for delivery status,
retiring options and historical station names. Standalone, unregistered installs
can still use the local station setup by leaving the cloud URL empty.

Closing the monitor does **not** stop the server. Esquila remains available
from the sheep icon in the macOS menu bar. That menu can reopen the monitor,
change settings, open the tagger, edit recent records, disable launch-at-login, or fully quit.

Choose **Configuración… → Modo de conteo → Aplicar modo** to switch all tagger
phones to an active configured mode. This works without internet, remembers the
selection across restarts and does not restart the server. Animals already
started retain their mode until completed. **Actualizar lista** reloads the local
cached options; mode definitions are published from the cloud. If the cloud
retires the selected mode, new entries use the first remaining active mode.
Install this update before publishing schema-3 modes and reload phone tagger tabs.

Choose **Registros recientes…** from the sheep menu to open the record editor.
It shows the latest 200 live shearing records, with a code search for older rows.
Use **Agregar registro**, **Editar**, or **Eliminar** (then confirm) to correct
an animal's code, station, mode, color, or original survey responses. Editing keeps
the original shearing time; dates are displayed in Chile time. For a manually
added animal in a bulk mode, use `L` followed by at least four digits.

Changes save to the Mac immediately without internet, update monitor totals,
and show **Pendiente** until the cloud accepts them. Deleted records disappear
from the table, but their pending deletion remains included in the sync total.
If a save cannot be confirmed, choose **Reintentar**; the same attempt is kept
even if you close and reopen the window, so it cannot create a duplicate. If
another window has changed the row, cancel and reopen it before editing again.
The editor is also available at `http://<mac-name>.local:3001/records/` on the
trusted ranch WiFi.

Choose **Configurar teléfonos…** from the sheep menu to display two QR codes:

- **Registrar ovejas** opens the tagger. Select the phone's shearing station once;
  it remains selected between sheep and after reopening. **Cancelar** returns to
  station selection.
- **Ver monitor en el teléfono** opens the mobile monitor with today's total,
  each shearer's count, latest tag/color and elapsed time. It fits narrow phones,
  preserves inactive stations with counts, and marks retained data as stale if
  the local server becomes unreachable. Its own home-screen shortcut opens the
  monitor, not the tagger. Replace older monitor shortcuts created with the old
  tagger manifest.

Both QR codes are generated **on this Mac without internet**. Keep the Mac and
phones connected to the same barn WiFi even when it reports no internet. WiFi
and internet are different: removing the router's internet uplink is supported;
disconnecting the Mac from the local network removes the address phones need.
Optional QR delivery by email does need internet. The local window never waits
for email or cloud sync. If a phone's scanner will not open a code offline,
type its displayed `http://` address directly into the browser.

The window refreshes both addresses every five seconds and when focused. If the
Mac has multiple connections, choose the phone's network under **Red del
teléfono**. No QR is shown with only VPN/loopback/link-local connectivity or when
the current server address cannot be obtained. Opening the Mac QR window during
local server startup/recovery retries automatically instead of leaving a failed
navigation stuck. Local API failures hide stale QR images and retry visibly.

Shearers open the tagger from another device on the same WiFi at:

```text
http://<mac-name>.local:3001/tagger
```

The Mac name is visible under **System Settings → General → Sharing → Local
hostname**. Setting it to `esquila` makes the address
`http://esquila.local:3001/tagger`.

## Data and secrets

The app stores its data outside the application bundle:

```text
~/Library/Application Support/Esquila/
├── esquila          # SQLite records, outbox and durable manifest versions
├── shearers.json    # legacy/bootstrap station names
├── config.json      # configuration; sync token encrypted by macOS
└── esquila.log      # local diagnostics
```

The token is encrypted with the current user's macOS login keychain. The
configuration file is also owner-readable only. Keep normal Mac backups
enabled; cloud sync is not a replacement for backing up unsynced local data.

To migrate the existing ranch database, quit Esquila from its menu-bar icon,
copy the old `esquila` database over the file above, and reopen the app.

## Build an installer

On a development Mac, from the repository root:

```bash
npm install
npm run build:mac:arm64   # Apple Silicon MacBook (M1/M2/M3/M4/M5)
```

The DMG and ZIP are written to `dist-mac/`. They are deliberately ignored by
Git because they are large generated artifacts.

Local and PR builds use ad-hoc signing without Apple credentials. Production
main builds require Developer ID signing and notarization; missing credentials
fail the release rather than silently publishing an unsigned application.
See [Apple signing setup](../docs/DEPLOY.md#apple-signing-setup).

## Updating the barn Mac

Choose **Buscar actualizaciones…** from the sheep menu. A dedicated window shows
percentage and downloaded/total MB, with **Pausar descarga** and **Reintentar /
continuar descarga**. Closing this window leaves the download running; reopen it
from the sheep menu. Interrupted bytes survive app restarts in
`~/Library/Application Support/Esquila/updates/`. Downloads have a two-minute
inactivity deadline, not a total time limit. If the host cannot resume, the
transfer starts over safely. Completed downloads are verified and cached.

Once ready, choose **Instalar y reiniciar**, then confirm when counting can pause.
The signed application is replaced and relaunched without dragging a DMG.
**Seguir contando** leaves the update downloaded without scheduling installation.
Checking or downloading never stops the barn server. Local data, pending sync,
and encrypted configuration stay in Application Support outside the app bundle.

### One-time migration and maintenance

- Existing ad-hoc installations need one manual replacement with the signed DMG.
  Their existing update menu still downloads that DMG. Quit Esquila, drag the new
  app into Applications, replace, and reopen. Keep the same macOS user account;
  confirm Keychain or local-network access prompts if macOS presents them.
- Signed builds use the verified ZIP for native updates only when its Apple team
  matches the installed build. A different team uses the explicit manual DMG
  fallback. Never change signing identity casually.
- The app checks after 30 seconds and every six hours. Checks notify; downloading
  and installation are operator actions. Neither a cloud outage nor an update
  check affects offline counting. No GitHub account is needed for downloads.
- Every release retains an increasing CI build number, even if its package
  version does not change. Cloud rollback never offers older builds.
- Keep membership, certificates, and notarization credentials current. Failed
  signing/notarization blocks new releases and cloud deployment, not existing
  ranch operation. Retain published assets; do not replace their bytes.
- Allow disk space for the ZIP, extracted replacement, and current app. Old
  downloads can be removed from the updates folder when Esquila is closed.
- Installation briefly stops counting; choose any convenient pause, not
  necessarily a different season. Keep normal backups. App rollback does not
  undo database migrations.
- Test each first signed release and signing-identity change on a real Mac:
  first launch, local-network access, encrypted token access, counting, update
  restart, login item, and preservation of existing records and pending sync.

## Operational notes

- The app binds explicitly to `0.0.0.0:3001`, accepting IPv4 connections on
  all of the Mac's network interfaces. Phones use the current LAN address
  shown in **Configurar teléfonos…**, not `0.0.0.0` as a destination.
- macOS may ask whether Esquila may accept incoming connections; choose
  **Allow**, otherwise phones cannot reach it.
- Esquila prevents automatic idle sleep while it is open, including when all
  windows are closed and only the sheep menu remains. The display can still
  turn off and lock. Quit Esquila to restore normal idle sleep. Keep the Mac
  plugged in during shearing: serving on battery uses extra power. Keep its lid
  open; closing it or explicitly choosing Sleep can still make phones lose
  access. Releases through 0.1.9 require the operator to prevent idle sleep.
- The fullscreen window can be toggled with `Control-Command-F`.
- If port 3001 is already occupied, quit the other process before opening
  Esquila.

## Remote corrections and monitor (0.1.5+)

The cloud `/admin` page can display the last synchronized per-shearer counts and
add, edit, or delete shearing records. This version of the Mac app receives those
changes through the same configured cloud URL and server token. Install the new
release before relying on bidirectional sync; older versions only upload.

Counting remains local while offline. Remote changes appear after reconnection,
normally on the next one-minute sync, and refresh the local monitor. Conflicting
corrections use the later timestamp (cloud wins ties); review retained versions
in the cloud admin history. No remote edit restarts or updates this application.

### If a phone cannot open the tagger

1. Open **Configurar teléfonos…**, press **Actualizar conexión**, and scan the
   current QR again. A saved home-screen shortcut using an old IP does not follow
   DHCP changes. A router DHCP reservation can keep the Mac’s address stable.
2. Confirm the phone and Mac use the same LAN, not guest WiFi or cellular data.
   With multiple Mac connections, select the matching WiFi address.
3. Try the displayed address with the explicit `http://` prefix. The LAN server
   does not serve HTTPS; `https://` on port 3001 will fail. A browser “cannot reach server”
   message at the current address means the problem is connectivity, not the QR
   image. A successful request from the Mac does not prove phone reachability.
4. Check the phone VPN’s local-network access configuration and the router’s
   guest/client-isolation settings. Confirm Esquila is enabled in macOS
   **Privacy & Security → Local Network**, and allow its incoming connections
   if the Mac firewall is enabled. Keep the Mac awake while counting.
5. To separate browser delays from server delays, open
   `http://<current-Mac-IP>:3001/healthz` on another device. It returns
   `{"ok":true}` without loading the tagger or contacting the cloud. On another
   Mac, the following reports connection and first-response times:

   ```sh
   curl --noproxy '*' --connect-timeout 10 --max-time 15 \
     -w '\nconnect=%{time_connect}s first_byte=%{time_starttransfer}s total=%{time_total}s\n' \
     http://<current-Mac-IP>:3001/healthz
   ```

   A quick curl response with a slow browser points to the browser's connection
   path (for example, an HTTPS upgrade or proxy), rather than tagger startup.
   An unreachable address or connection timeout occurs before an HTTP response;
   confirm the current address, WiFi reachability, and whether the Mac is asleep.

The setup page verifies the advertised address, not a connection from the phone.
Only seeing the shearer names on the phone confirms that path works. No internet
connection or cloud sync credential is required for the tagger.

### Repeated tabs can block older releases

Versions through 0.1.5 hold two permanent HTTP connections per tagger tab.
Several open tabs can exhaust the browser connection limit, making even new
page loads or count submissions stall. Close all Esquila tabs and reopen one
as an immediate workaround. Version 0.1.6 replaces these streams with short
local status requests. After upgrading the Mac, close/reopen or reload existing
phone/monitor tabs so they load the corrected client. Counts and mode updates
normally appear within one second; a connection warning appears when status
cannot be refreshed and clears automatically after recovery.

### Configurable shearing questions

After updating Esquila, use **Administrar este galpón en la nube…** to open
**Configuración de galpones → Preguntas de la encuesta**. Publish questions for
each animal mode; the Mac downloads and saves them for offline use. Reload old
phone tabs after upgrading. **Registros recientes…** edits the answers originally
recorded with each animal, including retired questions. New survey manifests need
this updated app; older versions keep their cached settings. See
[configuration and migration details](../docs/RANCH_CONFIGURATION.md).

## English Mac controls and Spanish phones

English and Spanish controls have independent preferences for the Mac, cloud
admin browser, and tagger. Choose English in Mac settings and cloud administration
while leaving the tagger in Spanish. Ranch-authored names and questions stay as
entered. See [language settings and the Spanish audit](../docs/LOCALIZATION.md).
