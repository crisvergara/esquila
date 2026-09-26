# Deploying esquila-cloud (cheap edition)

Total running cost: **~US$2–4/month**.

| Piece | Provider | Cost |
|---|---|---|
| Postgres | Neon free tier (`chile-farm` project, `aws-us-east-2`) | $0 — scales to zero, 0.5 GB storage (plenty) |
| App hosting | Fly.io, 1× `shared-cpu-1x` 256 MB in `iad` | ~$2/mo ceiling; less in practice because `fly.toml` auto-stops the machine when idle |
| IPv4 | Fly shared IPv4 | $0 (only a *dedicated* IPv4 costs $2/mo — don't allocate one) |
| Domain | optional | ~$10/yr only if you want `esquila.yourdomain.com`; `https://<app>.fly.dev` is free |

The machine sleeps when nobody is using it and wakes on the first request
(~1–2 s, plus ~0.5 s for Neon to wake). The phones don't notice: the PWA
renders from its local snapshot instantly and syncs in the background.

---

## 0. One-time prep (your laptop)

Install the Fly CLI and log in (creates a free account if you don't have one):

```bash
brew install flyctl
```

```bash
fly auth signup    # or: fly auth login
```

Pull the merged code:

```bash
git pull
```

## 1. Clear the test data out of Neon

Verification testing left fake sheep/treatments and two test devices in the
`chile-farm` database. In the Neon console SQL editor (or `psql`), run:

```sql
TRUNCATE shearing_events, treatments, treatment_presets;
DELETE FROM devices;
```

While you're in the Neon console, copy the **pooled connection string**
(Connect → check "Connection pooling") — you'll need it in step 3. It looks
like `postgresql://neondb_owner:...@ep-...-pooler.c-3.us-east-2.aws.neon.tech/neondb?sslmode=require`.

## 2. Create the Fly app

From the repo root (it picks up `fly.toml`, which builds `cloud/Dockerfile`):

```bash
fly launch --no-deploy --copy-config
```

- If the name `esquila-cloud` is taken, let it pick/ask for another — everything else stays the same.
- Keep region `iad` (Virginia — ~10 ms from the Neon `us-east-2` database; app↔DB proximity is what matters, not app↔Chile, since the apps are offline-first).
- Say **no** to any offer of a Postgres/Redis database — we use Neon.

## 3. Secrets + deploy

Choose a strong admin password and keep it in your password manager. It protects
the device-enrollment login:

```bash
openssl rand -base64 24
```

```bash
fly secrets set DATABASE_URL='<neon-pooled-connection-string>' ADMIN_PASSWORD='<the-password-you-just-generated>' PUBLIC_URL='https://esquila-cloud.fly.dev'
```

(`PUBLIC_URL` is what enrollment QR codes point at — update it if you use a
different app name or later add a custom domain.)

```bash
fly deploy
```

Verify:

```bash
curl https://esquila-cloud.fly.dev/healthz
```

Should return `{"ok":true}`. Also check you weren't given a paid dedicated
IPv4 (you want `shared`):

```bash
fly ips list
```

If a dedicated v4 snuck in: `fly ips release <addr>` (the shared v4 + free
IPv6 are all an HTTPS-only app needs).

## Automatic deployment and Mac builds

Ranch configuration uses additive PostgreSQL tables applied at cloud startup;
no new secret or infrastructure service is needed. Deploy the cloud and install
the new Mac release before relying on editable tagging schemas. Existing
servers import their local station names only if no manifest is published.
For new servers, publish their configuration in `/admin` before enrollment.
Confirm the admin shows the same published and received revisions, then test
one count with the cloud unavailable. Back up configuration/history/receipt
tables with PostgreSQL and the local cache with SQLite. See
[RANCH_CONFIGURATION.md](RANCH_CONFIGURATION.md) for rollout details.

Pushes to the default branch, **`main`**, run the `Checks and delivery` workflow.
Pull requests run the same required checks without deploying or receiving the
Fly token.

1. `Application and offline E2E` runs the builds, audits, and regression suite.
2. `Apple Silicon installer` builds and verifies the ARM64 DMG/ZIP, then uploads
   them as `Esquila-mac-arm64-<commit SHA>` under the workflow run's **Artifacts**.
   Downloads are retained for 30 days. Main builds are Developer ID signed and
   notarized; PR builds remain ad-hoc and receive no Apple secrets.
3. After both checks succeed, `Deploy cloud to Fly.io` downloads the verified
   artifacts and publishes a GitHub Release tagged `mac-<commit SHA>`. It then
   deploys the same commit using `fly.toml` and verifies `/healthz` and the exact
   `/api/updates/mac` manifest. The Docker build includes the cloud
   service and vaccination PWA. `--ha=false` prevents creating extra standby
   machines; it does not remove any machines already provisioned.

Production runs are serialized and are not canceled midway through deployment.
Superseded PR checks may still be canceled. A failed check blocks deployment;
a failed deployment or health check marks the workflow red. Fix the failure and
rerun failed jobs, or push a correction to `main`.

GitHub requires the repository Actions secret `FLY_API_TOKEN`. Use an app-scoped
token, never a broad personal Fly token. With Fly and GitHub CLI authenticated,
this sends the token directly to the GitHub secret store:

```sh
set -o pipefail
fly tokens create deploy --app esquila-cloud --name github-actions --expiry 8760h | gh secret set FLY_API_TOKEN --repo crisvergara/esquila
```

The deploy job has `contents: write` to publish releases with `GITHUB_TOKEN`;
other jobs remain read-only. No additional secret is required for public release
downloads. Do not remove published installer assets. Failed-job reruns reuse
an existing published installer and its original hash; incomplete draft releases
can be completed safely. If publication or asset verification fails, deployment
is blocked. If Fly deployment fails after publication, the previous cloud feed
continues to advertise its previous release until a successful deployment.

Manual `fly deploy` from a clean checkout has no generated update manifest and
therefore disables the update feed (503). Prefer the workflow; for a deliberate
manual deployment, obtain and verify `mac-update.json` from the intended release
and place it in `cloud/` first. This generated file is ignored by Git but included
in the cloud image. No installer binary is embedded in the image.

Renew the token before its one-year expiry. Existing `DATABASE_URL`,
`ADMIN_PASSWORD`, and `PUBLIC_URL` remain in Fly secrets; GitHub does not need
copies. See the [Fly continuous deployment guide](https://fly.io/docs/launch/continuous-deployment-with-github-actions/).

## 4. Enroll the ranch server

1. Open `https://esquila-cloud.fly.dev/admin` in a browser.
2. Log in with the `ADMIN_PASSWORD`. The login lasts 12 hours and is kept in a
   secure, HttpOnly browser cookie; the password is not stored in the browser.
3. Create a device named `ranch-server` with role **server** → copy the token it shows (shown only once).

On the ranch machine, add these to the environment where `countserver.js`
runs (alongside the existing AWS vars):

```
CLOUD_SYNC_URL=https://esquila-cloud.fly.dev
CLOUD_SYNC_TOKEN=<the server device token>
CLOUD_APP_URL=https://esquila-cloud.fly.dev
```

Then update and restart it:

```bash
git pull && npm install && npm run build && npm start
```

First boot after the upgrade:
- writes a local `esquila-pre-v1-<timestamp>.sqlite` safety copy,
- migrates the SQLite schema,
- queues **all historical rows** and uploads them in batches (500/minute —
  a few thousand rows take a few minutes).

Watch for `Cloud sync: pushed N outbox entries` in the logs. Then compare
counts — on the ranch machine:

```bash
sqlite3 esquila "SELECT (SELECT COUNT(*) FROM counts), (SELECT COUNT(*) FROM treatments), (SELECT COUNT(*) FROM sync_outbox);"
```

vs. in Neon: `SELECT COUNT(*) FROM shearing_events;` etc. When
`sync_outbox` reaches 0, everything is uploaded.

If the ranch has no internet that day, nothing breaks — the outbox just
waits and the server logs a retry with backoff.

## Remote ranch monitor and corrections (Mac 0.1.5+)

After merging, let both required checks complete and the workflow deploy the
cloud. Install the newly published Mac release at the ranch using **Buscar
actualizaciones…** in the sheep menu (or the public release installer). The
existing URL/token remains valid. Old ranch versions still upload, but cannot
report detailed status or receive remote edits; the admin page flags that state.
Do not rely on remote corrections being applied locally until the new app has
reported and the pending cloud count clears.

At `/admin`, inspect each server's last contact, version, mode, shearers, and
pending counts. Browse a Chile date (clear it for all history), search codes,
and include deleted rows to inspect their history. Add/edit/delete is available
with the admin login. Editing preserves the original date. Cloud saves are
immediate; ranch confirmation arrives on the next successful sync. An offline
ranch continues counting, and the remote monitor explicitly shows stale contact.

Operational tradeoffs:

- Conflicting edits are resolved by the later timestamp, with cloud winning
  exact ties. Keep clocks synchronized. **Historial** retains accepted versions
  and discarded stale uploads for manual review; it does not automatically merge
  individual fields. Multiple edits to an unsynced local row can be coalesced.
- The default heartbeat/pull interval is 60 seconds, even without new counts.
  While the ranch app runs, it can keep Fly/Neon awake more often than push-only
  sync. Turn it off normally when not in use or adjust the sync interval, accepting
  slower updates and a stale-contact indicator.
- Historical totals use stations and their latest reported names. Changing a
  shearer's name does not create historical staff assignment records.
- Initial down-sync copies retained cloud history into SQLite, 500 rows per
  cycle. One flock/one active barn is assumed. Do not connect unrelated farms.
- History, receipts, and tombstones grow over time and require database storage
  and backups. Do not truncate them or reset the revision counter to save space.
- If restoring PostgreSQL from an older backup, a barn cursor may be ahead and
  pull will fail closed. Preserve both databases and review/reconcile the missing
  history before changing cursors; resetting them blindly can lose corrections.

## 5. Enroll the phones

For each person: on `/admin`, create a device with role **phone** and a
real name ("Teléfono de Papá") → a QR code appears → scan it with the
phone's camera → the app opens and stores its token. Then **add it to the
home screen** so it installs as an app and works offline:

- iPhone (Safari): Share → *Añadir a pantalla de inicio*
- Android (Chrome): menu ⋮ → *Instalar aplicación*

Quick offline test: open the app once while online (so it caches the
flock), turn on airplane mode, reopen it — the sheep list should load, and
a treatment you add shows a yellow "pendiente" badge that clears once
you're back online.

To revoke a lost phone: delete its device on `/admin`.

## 6. Optional: custom domain

```bash
fly certs add esquila.yourdomain.com
```

Add the CNAME it tells you at your DNS provider, then update `PUBLIC_URL`:

```bash
fly secrets set PUBLIC_URL='https://esquila.yourdomain.com'
```

(Already-enrolled phones keep working; only new QR codes use the new URL.)

## Housekeeping / gotchas

- **Rotate the Neon password** (Neon console → Roles) if you're being
  careful: the connection string was used in local testing. After rotating,
  re-run the `fly secrets set DATABASE_URL=...` with the new string.
- **Updating the app later**: `fly deploy` from the repo root rebuilds the
  PWA and the service; phones auto-update on next launch (service worker
  `autoUpdate`).
- **Backups**: Neon's free tier keeps ~6 hours of point-in-time restore;
  the on-prem SQLite still backs up to S3 every 10 minutes (and actually
  works now). A more robust backup story is a future phase.
- **Cost watch**: `fly dashboard` shows usage. The only surprise charges to
  avoid are a dedicated IPv4 ($2/mo) and extra machines (`fly scale count 1`
  should stay at 1).

## Apple signing setup

Production builds fail closed unless all five GitHub Actions secrets exist:

| Secret | Value |
|---|---|
| `MAC_CSC_LINK` | Base64 PKCS#12 containing the Developer ID Application certificate and private key |
| `MAC_CSC_KEY_PASSWORD` | PKCS#12 export password |
| `APPLE_ID` | Developer account email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password used by Apple's notarization service |
| `APPLE_TEAM_ID` | Ten-character developer team identifier |

Create a **Developer ID Application** certificate (G2) in the Apple developer
portal from a locally generated CSR. Back up its private key and export password
securely outside the repository. Do not use Apple Development, Apple Distribution,
or Developer ID Installer certificates for this app. Generate an app-specific
password at account.apple.com. `scripts/configure-apple-signing.sh` reads these
values in a private local terminal and pipes them directly into GitHub secrets;
it does not print passwords. Do not paste them into chat or commit them.

When exporting with OpenSSL 3, use a macOS-compatible PKCS#12 rather than its
PBES2 default. The default can produce `MAC verification failed` in macOS
`security import` even with the correct password. Keychain Access exports are
also supported. For an existing private key and PEM certificate, use:

```sh
openssl pkcs12 -export -inkey /secure/path/developer-id.key \
  -in /secure/path/developer-id.pem -out /secure/path/developer-id.p12 \
  -passout file:/secure/path/export-password \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1
```

These options apply only to the encrypted certificate transport container, not
the application's code signature. Keep the container and password private and
verify import in an isolated Mac keychain before uploading them to GitHub.
After correcting a credential-only failure, rerun failed jobs; no code change
or version bump is needed. Deployment remains blocked until verification passes.


The main build uses hardened runtime and the Electron JIT entitlement, signs all
bundled code, notarizes/staples the app, and checks Developer ID/team identity,
Gatekeeper acceptance and stapling before generating the public manifest. Both
DMG and ZIP hashes are verified before publication and on immutable release
reuse. Missing credentials or notarization failures block publication/deployment.
PR checks retain their existing required names and do not use these secrets.

Before the first production rollout, manually install the signed DMG on a test
Mac and confirm LAN access, existing encrypted configuration, records and pending
sync. Then install a second build through **Instalar y reiniciar**, checking that
it relaunches with the newer build and identical ranch data. Unit mocks cannot
prove macOS certificate trust or replacement permissions. Test a slow interrupted
download and **Seguir contando** without any restart as well.

Renew membership annually, monitor certificate expiry, and rotate notarization
passwords when required. Preserve the team identity across releases. Revoke a
compromised certificate and rotate the GitHub secrets; a team change requires a
manual migration. A credential outage never stops already-installed counting.
