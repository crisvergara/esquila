# Esquila for Mac — barn server

The Mac app packages the existing on-prem Node/SQLite service as a normal
macOS application. No Node installation, Terminal window, or Raspberry Pi is
required on the barn computer.

## What your father does

1. Connect the MacBook to the barn WiFi using the normal WiFi menu.
2. Open `Esquila.dmg`, then drag **Esquila** into **Applications**.
3. Open Esquila from Applications. Because this first build is not signed,
   macOS may block it the first time. Control-click **Esquila**, choose
   **Open**, then choose **Open** again. When macOS asks whether Esquila may
   find and communicate with devices on the local network, choose **Allow**.
4. In the setup window:
   - enter the shearer names in station order;
   - enter the cloud sync URL and server token;
   - enter the vaccination-app URL (normally the same cloud URL);
   - leave **Start Esquila automatically** selected.
5. Choose **Save and open monitor**. The monitor fills the screen.

Closing the monitor does **not** stop the server. Esquila remains available
from the sheep icon in the macOS menu bar. That menu can reopen the monitor,
change settings, open the tagger, edit recent records, disable launch-at-login, or fully quit.

Choose **Registros recientes…** from the sheep menu to open the record editor.
It shows the latest 200 live shearing records, with a code search for older rows.
Use **Agregar registro**, **Editar**, or **Eliminar** (then confirm) to correct
an animal's code, station, type, color, wool quality, or lactation. Editing keeps
the original shearing time; dates are displayed in Chile time. For a manually
added lamb, use `L` followed by at least four digits.

Changes save to the Mac immediately without internet, update monitor totals,
and show **Pendiente** until the cloud accepts them. Deleted records disappear
from the table, but their pending deletion remains included in the sync total.
If a save cannot be confirmed, choose **Reintentar**; the same attempt is kept
even if you close and reopen the window, so it cannot create a duplicate. If
another window has changed the row, cancel and reopen it before editing again.
The editor is also available at `http://<mac-name>.local:3001/records/` on the
trusted ranch WiFi.

Choose **Configurar teléfonos…** from the sheep menu to display a QR code and
step-by-step instructions. Each tagger phone scans that code while connected
to the barn WiFi, adds **Esquila Tagger** to its home screen, and selects its
shearing station once. The station remains selected between sheep and after
the phone app is reopened; **Cancelar** returns to station selection.

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
├── esquila          # SQLite database
├── shearers.json    # editable station names
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

The local build is ad-hoc signed. Control-click/Open is adequate for a
family-only deployment. For normal double-click installation, obtain an Apple
Developer ID certificate, replace the ad-hoc `"identity": "-"` setting, and
configure Electron Builder signing/notarization credentials.

## Updating the barn Mac

Download the DMG from the latest successful **Checks and delivery** run on
`main` in GitHub Actions (under **Artifacts → Esquila-mac-arm64-<commit SHA>**),
or build locally. Quit the old Esquila app and drag the new app over the
old one in Applications. The database and configuration remain untouched in
Application Support.

There is no automatic updater in this first Mac release. Revisit signed and
automatic updates if more than one ranch computer needs ongoing maintenance.

## Operational notes

- The app listens on port 3001 on the Mac's network interfaces.
- macOS may ask whether Esquila may accept incoming connections; choose
  **Allow**, otherwise phones cannot reach it.
- Prevent sleep while plugged in under **System Settings → Lock Screen** so
  the server stays reachable during a shearing event.
- The fullscreen window can be toggled with `Control-Command-F`.
- If port 3001 is already occupied, quit the other process before opening
  Esquila.
