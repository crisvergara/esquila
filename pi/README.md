# Ranch server on a Raspberry Pi

Sets up a Pi as the on-prem count server + barn TV kiosk: the Pi boots
straight into a fullscreen browser, runs `countserver.js` as a systemd
service, and syncs to esquila-cloud whenever internet is available.

**First boot shows an onboarding wizard on the TV** (in Spanish): connect to
the ranch WiFi and set the shearers' names. That means one person can
prepare the Pi anywhere, ship it, and someone else — no terminal, no
laptop — can plug it in at the ranch and finish setup with just a USB
keyboard + mouse.

Hardware: Raspberry Pi 4 or 5, 2 GB+ RAM, 16 GB+ microSD, HDMI to the barn
TV, and a USB keyboard + mouse for the first boot.

---

## Part A — Prepare the Pi (technical person, anywhere with internet)

### 1. Flash the microSD card

Use the official **Raspberry Pi Imager** (https://www.raspberrypi.com/software/):

1. Choose OS → **Raspberry Pi OS (64-bit)** — the regular one *with Desktop*
   (the kiosk browser needs it; not "Lite").
2. Click the gear / "Edit settings" before writing and set:
   - hostname: `esquila`
   - username + password (this account becomes the kiosk user)
   - your own WiFi (just for this preparation step — the ranch WiFi gets
     configured later by the wizard)
   - locale: timezone `America/Santiago`
   - Services tab: **enable SSH**
3. Write the card, boot the Pi, give it a minute.

### 2. Install Esquila

```bash
ssh <username>@esquila.local
```

then on the Pi:

```bash
curl -fsSL https://raw.githubusercontent.com/crisvergara/esquila/main/pi/install.sh | sudo bash
```

(If the repo is private: `git clone` it with your credentials and run
`sudo bash esquila/pi/install.sh` instead.)

This installs Node 22, clones the repo to `/opt/esquila`, builds, creates
the `esquila` systemd service (database in `/var/lib/esquila`), wires the
kiosk + onboarding autostart, grants the service scoped `nmcli` access for
the WiFi wizard, enables desktop auto-login, and disables screen blanking.

### 3. Migrate the existing database (if replacing an old ranch machine)

Copy the old machine's SQLite file **before** shipping, so the flock's
history is on the appliance:

```bash
sudo systemctl stop esquila
sudo scp <olduser>@<oldhost>:/path/to/esquila /var/lib/esquila/esquila
sudo chown esquila:esquila /var/lib/esquila/esquila
sudo systemctl start esquila
```

### 4. Configure cloud sync (token stays secret, so this is done here)

```bash
sudo esquila-setup
```

Enter the cloud sync URL and a `server`-role device token from the cloud's
`/admin` page. AWS keys are optional (S3 backups + QR email).

### 5. Reset for shipping

Remove the preparation WiFi and the onboarding marker so the ranch gets a
fresh wizard, then shut down:

```bash
sudo nmcli connection delete id "<your-prep-wifi-ssid>"
```

```bash
sudo rm -f /var/lib/esquila/.onboarded && sudo shutdown now
```

Ship the Pi (or the whole kit: Pi + power supply + HDMI cable + keyboard/mouse).

---

## Part B — At the ranch (no technical knowledge needed)

1. Conectar el Pi al televisor con el cable HDMI.
2. Conectar el teclado y el mouse USB.
3. Conectar la corriente y esperar ~1 minuto.
4. En el televisor aparece **"Esquila — Configuración"**:
   - **Paso 1**: tocar "Buscar redes WiFi", elegir la red del campo,
     escribir la contraseña, "Conectar". (Si hay cable de red, se puede
     tocar "Continuar" directamente.)
   - **Paso 2**: escribir los nombres de los esquiladores, uno por
     estación. Se pueden agregar o quitar estaciones.
   - **Paso 3**: tocar "Comenzar".
5. El televisor muestra el monitor de esquila. Listo — en adelante el
   equipo prende directo al monitor.

Para volver a la pantalla de configuración (cambiar WiFi o nombres):
abrir `http://esquila.local:3001/setup` desde cualquier teléfono o
computador en la misma red — o conectar el teclado y presionar `F5` tras
borrar el marcador (ver abajo).

---

## Day-2 operations

| Task | Command |
|---|---|
| Watch server + sync logs | `journalctl -fu esquila` |
| Change cloud config | `sudo esquila-setup` |
| Re-run the TV onboarding wizard | `sudo rm /var/lib/esquila/.onboarded && sudo reboot` |
| Change WiFi / shearers from a phone | open `http://esquila.local:3001/setup` |
| Update the app | re-run `sudo /opt/esquila/pi/install.sh` |
| Restart service | `sudo systemctl restart esquila` |
| Escape the kiosk (keyboard attached) | `Alt+F4`, or switch console with `Ctrl+Alt+F2` |
| Check sync backlog | `sudo sqlite3 /var/lib/esquila/esquila 'SELECT COUNT(*) FROM sync_outbox'` |

Shearer names are stored at `/var/lib/esquila/shearers.json` (the repo's
`shearers.json` is only the seed) and are picked up by the tagger and
monitors at load time — no rebuild needed. The cloud-hosted EsquilaDB app
still uses the names baked in at its deploy time.

The tagger phones connect to `http://esquila.local:3001/tagger` (or the
Pi's IP — the QR email still works if AWS is configured).
