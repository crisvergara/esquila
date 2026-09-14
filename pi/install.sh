#!/bin/bash
# Turns a fresh Raspberry Pi OS (64-bit, with Desktop) install into the
# Esquila ranch server + barn TV kiosk. Idempotent — re-run it any time to
# update the app (it pulls the repo and rebuilds).
#
#   curl -fsSL https://raw.githubusercontent.com/crisvergara/esquila/main/pi/install.sh | sudo bash
# or, from a clone:
#   sudo bash pi/install.sh
set -euo pipefail

REPO_URL="${ESQUILA_REPO:-https://github.com/crisvergara/esquila.git}"
APP_DIR=/opt/esquila

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo." >&2
  exit 1
fi

echo "==> Installing packages"
apt-get update
apt-get install -y git curl ca-certificates

if ! command -v node > /dev/null || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 20 ]; then
  echo "==> Installing Node.js 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Fetching Esquila into $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
fi

echo "==> Building"
cd "$APP_DIR"
npm ci
npm run build

echo "==> Service user + config"
id -u esquila > /dev/null 2>&1 || useradd --system --home /var/lib/esquila --shell /usr/sbin/nologin esquila
mkdir -p /etc/esquila
if [ ! -f /etc/esquila/esquila.env ]; then
  install -m 600 /dev/null /etc/esquila/esquila.env
  cat > /etc/esquila/esquila.env <<'EOF'
# Esquila ranch server configuration. Edit via: sudo esquila-setup
CLOUD_SYNC_URL=
CLOUD_SYNC_TOKEN=
CLOUD_APP_URL=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
EOF
fi
[ -f /etc/esquila/kiosk.conf ] || echo "KIOSK_URL=http://localhost:3001/monitor" > /etc/esquila/kiosk.conf

echo "==> WiFi control for the onboarding wizard"
# The wizard (served by countserver as the 'esquila' user) manages WiFi by
# shelling out to nmcli. Grant exactly that, nothing else.
cat > /etc/sudoers.d/esquila-nmcli <<'EOF'
esquila ALL=(root) NOPASSWD: /usr/bin/nmcli
EOF
chmod 440 /etc/sudoers.d/esquila-nmcli

echo "==> systemd service"
install -m 644 "$APP_DIR/pi/esquila.service" /etc/systemd/system/esquila.service
install -m 755 "$APP_DIR/pi/esquila-setup" /usr/local/bin/esquila-setup
install -m 755 "$APP_DIR/pi/esquila-kiosk" /usr/local/bin/esquila-kiosk
systemctl daemon-reload
systemctl enable esquila

echo "==> Barn TV kiosk autostart"
# The desktop user is whoever the Raspberry Pi Imager created (uid 1000).
KIOSK_USER=$(id -nu 1000 2>/dev/null || echo "")
if [ -n "$KIOSK_USER" ]; then
  KIOSK_HOME=$(getent passwd "$KIOSK_USER" | cut -d: -f6)

  # Raspberry Pi OS Bookworm uses labwc (new) or wayfire (older); X11/LXDE
  # honors XDG autostart. Wire up all three — only the active one runs.
  mkdir -p "$KIOSK_HOME/.config/labwc"
  touch "$KIOSK_HOME/.config/labwc/autostart"
  grep -q esquila-kiosk "$KIOSK_HOME/.config/labwc/autostart" || \
    echo "/usr/local/bin/esquila-kiosk &" >> "$KIOSK_HOME/.config/labwc/autostart"

  WAYFIRE_INI="$KIOSK_HOME/.config/wayfire.ini"
  if [ -f "$WAYFIRE_INI" ] && ! grep -q esquila-kiosk "$WAYFIRE_INI"; then
    printf '\n[autostart]\nesquila_kiosk = /usr/local/bin/esquila-kiosk\n' >> "$WAYFIRE_INI"
  fi

  mkdir -p /etc/xdg/autostart
  cat > /etc/xdg/autostart/esquila-kiosk.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Esquila Kiosk
Exec=/usr/local/bin/esquila-kiosk
X-GNOME-Autostart-enabled=true
EOF

  chown -R "$KIOSK_USER:$KIOSK_USER" "$KIOSK_HOME/.config"
else
  echo "WARNING: no uid-1000 desktop user found; kiosk autostart not configured"
fi

if command -v raspi-config > /dev/null; then
  echo "==> Desktop autologin + no screen blanking + Chile timezone"
  raspi-config nonint do_boot_behaviour B4 || true   # boot to desktop, auto-login
  raspi-config nonint do_blanking 1 || true          # never blank the TV
fi
timedatectl set-timezone America/Santiago || true

systemctl restart esquila

cat <<'EOF'

============================================================
 Esquila ranch server installed.

 Next steps:
   1. If migrating from an old machine, copy its database first:
        sudo systemctl stop esquila
        sudo cp /path/to/old/esquila /var/lib/esquila/esquila
        sudo chown esquila:esquila /var/lib/esquila/esquila
        sudo systemctl start esquila
   2. Configure cloud sync:   sudo esquila-setup
   3. Reboot for the kiosk:   sudo reboot

 Logs:  journalctl -fu esquila
============================================================
EOF
