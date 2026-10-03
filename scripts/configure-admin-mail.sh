#!/usr/bin/env bash
# Never enable shell tracing: secrets travel only through stdin to Fly.
set +x
set -euo pipefail
command -v flyctl >/dev/null
command -v node >/dev/null
read -r -p 'Fly app [esquila-cloud]: ' app
app=${app:-esquila-cloud}
[[ "$app" =~ ^[a-zA-Z0-9-]+$ ]] || { echo 'Invalid app name.'; exit 1; }
read -r -p 'Public HTTPS origin [https://esquila-cloud.fly.dev]: ' origin
origin=${origin:-https://esquila-cloud.fly.dev}
read -r -p 'Verified sender email: ' sender
read -r -p 'SMTP hostname: ' host
read -r -p 'SMTP port [465; use 587 for STARTTLS]: ' port
port=${port:-465}
read -r -p 'SMTP username: ' smtp_user
read -r -s -p 'SMTP password (hidden): ' smtp_password
printf '\n'
# Validate non-secret inputs and require HTTPS. Do not emit secret values.
PUBLIC_URL="$origin" ADMIN_MAIL_FROM="$sender" ADMIN_SMTP_HOST="$host" ADMIN_SMTP_PORT="$port" node --input-type=module <<'NODE'
import { publicOrigin, normalizeEmail } from './cloud/admin-security.js';
try {
  publicOrigin(process.env.PUBLIC_URL);
  if (!normalizeEmail(process.env.ADMIN_MAIL_FROM) || !/^[a-z0-9.-]+$/i.test(process.env.ADMIN_SMTP_HOST) || !['465','587'].includes(process.env.ADMIN_SMTP_PORT)) throw new Error();
} catch { console.error('Invalid origin, sender, SMTP host or port.'); process.exit(1); }
NODE
[[ -n "$smtp_user" && -n "$smtp_password" ]] || { echo 'SMTP credentials are required.'; exit 1; }
# Keep the existing encryption key: replacing it would invalidate queued mail.
key_exists=$(flyctl secrets list -a "$app" --json | node --input-type=module -e 'let s=""; for await (const c of process.stdin) s+=c; const rows=JSON.parse(s); if (!Array.isArray(rows)) process.exit(1); console.log(rows.some(x=>(x.Name || x.name)==="ADMIN_LINK_KEY") ? "yes" : "no");')
link_key=''
if [[ "$key_exists" == no ]]; then link_key=$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64"))'); fi
# Fly's parser does not JSON-unescape. Encode credential bytes before import;
# this is transport encoding only, not encryption. Never use argv values.
PUBLIC_URL="$origin" ADMIN_MAIL_FROM="$sender" ADMIN_SMTP_HOST="$host" ADMIN_SMTP_PORT="$port" ADMIN_SMTP_USER="$smtp_user" ADMIN_SMTP_PASSWORD="$smtp_password" ADMIN_LINK_KEY="$link_key" node --input-type=module <<'NODE' | flyctl secrets import -a "$app"
for (const key of ['PUBLIC_URL','ADMIN_MAIL_FROM','ADMIN_SMTP_HOST','ADMIN_SMTP_PORT','ADMIN_SMTP_USER','ADMIN_SMTP_PASSWORD','ADMIN_LINK_KEY']) {
  if (!process.env[key]) continue;
  const encoded = ['ADMIN_SMTP_USER','ADMIN_SMTP_PASSWORD'].includes(key);
  const name = encoded ? `${key}_B64` : key;
  const value = encoded ? Buffer.from(process.env[key], 'utf8').toString('base64') : process.env[key];
  process.stdout.write(`${name}="${value}"\n`);
}
NODE
unset smtp_password link_key
printf 'Email settings saved to Fly. Open /admin/accounts to create your owner invitation.\n'
