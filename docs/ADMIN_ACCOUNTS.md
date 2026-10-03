# Personal cloud administrator accounts

Email addresses are usernames. There is no public signup. Each invited person
chooses their own password; you never need to know or email that password.
The Spanish UI lives at `/admin` → **Mi cuenta y accesos** (`/admin/accounts`).
These accounts administer the cloud. They do not replace Mac/server or phone
bearer credentials, and a cloud/mail outage does not stop local counting.

## Configure delivery once

1. Merge/deploy this version and wait for the cloud health check to pass. Tables
   are added automatically without changing ranch records or device tokens.
2. Choose a transactional email provider that supports authenticated SMTP
   (for example SES), verify a sender/domain, and configure its SPF/DKIM records.
   Follow the provider's DMARC guidance. If using a provider's sandbox, move to
   production sending or verify every recipient first. A Fly hostname is not an
   email domain you control. SMTP credentials are separate from your personal
   mailbox password and, for SES, from normal AWS API access keys.
3. In a private terminal, from the repository root, run:

   ```sh
   bash scripts/configure-admin-mail.sh
   ```

   Supply the app name, exact public HTTPS origin, verified sender, SMTP host,
   port (465 TLS or 587 STARTTLS), username, and password. Password input is
   hidden. The script generates `ADMIN_LINK_KEY` if missing, preserves an existing
   key, and passes values to **Fly secrets through stdin**. It creates no secret
   file, puts no password in command arguments, and requires no GitHub secret.
   Do not use shell tracing, record this terminal, or paste credentials into chat.
   Run with a current Node.js and authenticated `flyctl`. Saving secrets restarts
   the cloud machine; ranch counting remains local.
4. Open `/admin/accounts`. A missing-mail warning means configuration is absent
   or invalid. Delivery status is visible per account after sending. `Aceptado
   por el proveedor` means SMTP accepted the message, not guaranteed inbox delivery.
   Check spam, provider delivery/bounce logs, sender verification and credentials.
   Never paste message links or provider credentials into public issues.

The helper encodes credential bytes as base64 to preserve punctuation through
Fly's import parser; base64 is not encryption. The values are still stored as Fly
secrets. If configuring SMTP manually, use the raw credential names and remove
any older `_B64` variants so they cannot override your new values.

No email is sent by installing the code or configuring SMTP alone.

## Create your first personal owner account

For the existing deployment:

1. Open `https://esquila-cloud.fly.dev/admin/accounts` and log in with the current
   shared administration password.
2. Enter that password in **Tu contraseña actual**, then your name and email in
   **Crear mi primera cuenta**. Click **Enviar invitación**.
3. Open the email and choose a unique passphrase of 15–128 characters. The link
   lasts 24 hours and can be used once. Simply opening it does not activate it.
4. Click **Ir a iniciar sesión** and sign in with your email and new password.

Activation permanently switches the deployment to personal accounts. It closes
all shared-password sessions and disables the old password/bearer admin access,
even if those Fly secrets are left configured. Once verified, remove the
obsolete `ADMIN_PASSWORD` and `ADMIN_TOKEN` secrets if present. Existing devices
continue to synchronize. Your account has the **Propietario** role.

Only one first-owner invitation can be pending. If you mistyped the email, use
**Cancelar invitación** before creating the corrected invitation. **Reenviar
invitación** replaces the previous link. Refresh the delivery status after a few
seconds. A failed/ambiguous browser response is safe to recover by viewing the
account list and resending; only the latest link works.

For a new deployment with no shared password, or when that old secret is lost,
use trusted Fly console access (not a public HTTP endpoint):

```sh
flyctl ssh console -a esquila-cloud
cd /app/cloud
node bootstrap-admin.js invite YOUR_EMAIL 'YOUR NAME'
exit
```

Replace placeholders in your private terminal. The command queues an owner
invitation; it never prints a link or password. It refuses to bootstrap after
an owner is activated. Visit `/admin` to wake the cloud and let its email worker
run. Do not edit `admin_auth_state` to reopen shared access.

## Invite your father

1. Sign in as the owner and open **Mi cuenta y accesos**.
2. Enter your current password, his name, and his email.
3. Leave permissions as **Administrador** and click **Enviar invitación**.
4. He opens the email, chooses his own password, and signs in at `/admin`.

An administrator can operate **all ranches on this deployment**, including
configuration, records and device enrollment. Owners additionally invite,
re-invite, or disable people. Only give **Propietario** to someone who should
control access. There is currently no per-ranch account restriction or MFA.
The last active owner cannot be disabled. Disable takes effect for later requests
and revokes that person's sessions and links; it preserves ranch records.
**Invitar de nuevo** requires a fresh password before restoring a disabled user.

## Forgotten password and recovery

At `/admin`, choose **Olvidé mi contraseña**, enter the account email, and open
the newest email. Recovery links expire after 30 minutes. The response is the
same for unknown, disabled and existing accounts. Password reset closes all
sessions; sign in again explicitly. A confirmation email follows the change.
The account page also has **Enviarme un enlace para cambiar mi contraseña**.

If throttling blocks recovery or the owner cannot use the form, a trusted Fly
operator can run `node bootstrap-admin.js recover YOUR_EMAIL` in `/app/cloud`.
This still requires control of the existing active owner's mailbox and never
creates a new owner or bypasses email verification. If that mailbox is lost,
restore access through the email provider or another active owner. Keep at least
one protected, recoverable owner mailbox. Do not manually replace password
hashes or publish recovery tokens.

## Configuration reference

| Fly variable | Purpose |
|---|---|
| `PUBLIC_URL` | Exact HTTPS origin used in links and browser Origin checks; no path, query, credentials or fragment |
| `ADMIN_MAIL_FROM` | Provider-verified sender email |
| `ADMIN_SMTP_HOST`, `ADMIN_SMTP_PORT` | Authenticated SMTP endpoint; port defaults to 465 |
| `ADMIN_SMTP_USER`, `ADMIN_SMTP_PASSWORD` | SMTP credential pair for manual setup |
| `ADMIN_SMTP_USER_B64`, `ADMIN_SMTP_PASSWORD_B64` | Helper-generated base64 equivalents; take precedence over raw credentials; still secrets |
| `ADMIN_LINK_KEY` | Independent 32 random bytes encoded as base64, encrypting queued mail |
| `ADMIN_PASSWORD` / fallback `ADMIN_TOKEN` | Optional migration/bootstrap secret; ignored after first activation |

Keep `NODE_ENV=production` on Fly. Only loopback tests may use HTTP origins or
plaintext fake SMTP. Invalid SMTP configuration disables email actions and emits
a generic warning; device sync and existing account login continue working.

## Design, security and maintenance tradeoffs

- Passwords use salted asynchronous scrypt (`N=32768, r=8, p=3`), with at most
  two hashes running simultaneously to bound memory on the 256 MiB Fly machine.
  Excess requests receive a retryable 503. Passwords are never reversibly stored.
  These settings follow an [OWASP scrypt option](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
- PostgreSQL stores SHA-256 hashes of random 256-bit session and action tokens,
  durable rate limits, and security events. Sessions last at most 12 hours, with
  a 1-hour idle limit, surviving cloud restarts. Cookies are HttpOnly, SameSite
  Strict and Secure with a `__Host-` prefix on HTTPS. All browser mutations,
  including login/reset, check the exact configured Origin. Fly is the trusted
  immediate proxy; do not expose the internal HTTP listener publicly.
- Single-use tokens are consumed transactionally with password changes and
  session revocation. Email links use URL fragments, cleared immediately by the
  access page; tokens never enter request URLs, referrers or persistent browser
  storage. GET requests and email scanners do not consume them. A password reset
  is complete when its transaction commits; if the success response is lost,
  try signing in with the new password before requesting another link. See
  [OWASP recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
- An encrypted mail outbox commits with the token. AES-256-GCM protects pending
  link contents using the separate Fly key. The worker leases jobs, retries up to
  six attempts with backoff, and reuses the same link after ambiguous SMTP errors.
  Duplicate emails are possible; one-time token consumption remains enforced.
  Sent, cancelled and failed jobs lose their payload; job metadata expires after
  30 days. Security events are retained 180 days. These are operational records,
  not an immutable audit trail. Never commit database exports or mail logs.
- Fly auto-stop also pauses retries. A web request wakes the machine and resumes
  the worker; keeping one machine running continuously improves delivery latency
  but increases hosting cost. If email fails, personal login and already-enrolled
  devices keep working, but new invitations/reset requests need working delivery.
  SMTP accepted status cannot detect later bounces; inspect provider logs privately.
- Protect both the database and Fly secrets. Keep the outbox key stable. After a
  key loss/rotation, old queued messages cannot be decrypted: restore the original
  key or reissue invitations/resets with a new key. Do not rotate it on every deploy.
  Backups contain private account addresses, hashes and ranch data. Restore the
  initialized state with the accounts so shared access can never reappear.
- Email/password has a smaller operational footprint than hosted identity, but
  requires ongoing dependency updates, SMTP/domain upkeep, private backups and
  monitoring. MFA/passkeys, breached-password screening and per-ranch roles are
  not included. Protect the owner's mailbox with MFA and use a password manager.
  The implemented common-password checks are intentionally basic, not a breached
  password database. Limits are 30 login attempts per IP and 10 per account per
  15 minutes; reset requests are 20 per IP and 3 per account per hour. Limits are
  durable and can affect households sharing a public IP.
