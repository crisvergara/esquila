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
change settings, open the tagger, disable launch-at-login, or fully quit.

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

Build a new installer, quit the old Esquila app, and drag the new app over the
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
