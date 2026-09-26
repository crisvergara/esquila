# Security and public-repository requirements

This repository is public. Assume every committed byte, pull-request artifact,
CI log, issue excerpt, and Git object is permanently accessible.

## Trust boundaries

| Boundary | Protection | Assumption |
|---|---|---|
| Public internet to cloud admin | Strong password, throttled login, 12-hour HttpOnly SameSite session, same-origin mutation checks, security headers | HTTPS terminates at the trusted Fly proxy |
| Public internet to cloud API | Per-device random bearer token; only SHA-256 token hash stored | Enrollment QR/token is transferred privately |
| Phone role to cloud data | Server-side role/table allowlist | Phones can write treatments/presets but not counts |
| Barn server to cloud | Revocable `server` device token over HTTPS | Mac/Pi secret storage is not shared |
| Barn WiFi to local server | No application authentication; HTTP and LAN reachability | Ranch WiFi and people on it are trusted |
| Local disk | OS account permissions; Mac token encryption | Barn computer account and backups are protected |

Never weaken a server-side boundary because a button is hidden or a client form
validates it. Clients are untrusted.

## Secret rules

Never commit or paste into tracked files:

- `.env` or variant environment files;
- PostgreSQL/Neon connection strings, including passwords;
- Fly, GitHub, AWS, Apple signing, or package-registry credentials;
- admin passwords, device bearer tokens, or enrollment URLs/QR payloads;
- private keys, certificates, provisioning profiles, session cookies, or token
  hashes copied from production;
- the ranch SQLite database, exports, backups, logs, or real flock data.

Use environment variables or the deployment provider's secret store. The Mac
app encrypts the sync token with Electron `safeStorage`/the macOS user context
and restricts its configuration file permissions. Test credentials must be
obviously disposable, confined to an isolated local/CI database, and incapable
of reaching production.

If a secret is committed, deleting the line is not remediation. Immediately
revoke/rotate it, remove or invalidate related sessions/devices, assess logs and
data access, then clean Git history if appropriate. Treat the old value as
compromised forever.

## Cloud authentication requirements

- `ADMIN_PASSWORD` must be high entropy and stored only as a deployment secret
  and in the owner's password manager.
- Admin login comparison remains timing-safe. Login throttling must not trust
  arbitrary forwarded proxy chains.
- Admin cookies remain `HttpOnly`, `SameSite=Strict`, path-wide, and `Secure` on
  HTTPS. Admin pages and scripts remain `no-store`, non-frameable, and protected
  by the existing CSP and browser security headers.
- State-changing browser admin requests require the exact same origin. Bearer
  administration is retained only for controlled compatibility; do not expose
  the admin secret in browser JavaScript.
- Device tokens are generated from cryptographically secure random bytes, shown
  only during creation, and stored in PostgreSQL only as hashes.
- A device name is not an identity proof. Authorization comes from the matched
  token and stored role.
- Revoking a phone/server removes its device record and must immediately reject
  later snapshot and push requests.
- API errors must not return SQL, stack traces, environment variables, or
  credentials. Logs must redact authorization headers, cookies, bodies that may
  contain secrets, and database URLs.

Enrollment links place the bearer token in the URL fragment so it is not sent as
an HTTP request path or referrer. It is still visible to the person/camera that
opens the QR. Generate one device per phone, share it privately, and revoke it if
the phone or QR is lost.

## Cloud shearing administration

Ranch configuration uses the same admin authentication, exact-origin CSRF
checks, no-store headers, CSP and text rendering. Publication requires an
expected revision and durable mutation receipt. Server credentials can fetch
only their own manifest and bootstrap it only before any cloud publication;
phone credentials cannot access configuration endpoints. Manifests are bounded,
schema-validated data, never executable instructions. Mac enrollment requires
HTTPS (loopback HTTP is allowed for local tests), disallows redirects and limits
response size before parsing. Tokens never enter admin links or LAN responses.
Cached versions survive revocation for offline counting. See
[RANCH_CONFIGURATION.md](RANCH_CONFIGURATION.md) for retention and ownership.

Ranch telemetry, browsing, mutation, and history endpoints require the existing
admin session or controlled admin bearer authentication. Phone device tokens
cannot use them or pull the barn revision feed. Remote writes inherit the exact
same-origin CSRF requirement. Shared field validation is enforced server-side;
request sizes, page sizes, and history results are bounded. UI values are rendered
as text, including server names and audit JSON.

Cloud mutation receipts and shearing history contain ranch data; include them in
protected database backups and never export production history into the public
repository. Audit versions are retained, including rejected stale uploads, but
are not a tamper-proof compliance log. A compromised administrator or server
credential can change the flock. Keep local/cloud clocks accurate because
conflicting offline writes use timestamps.

## Data-integrity controls are security controls

- Parameterize all SQL.
- Bound JSON bodies and bulk quantities to limit memory/database abuse.
- Validate table names against a fixed allowlist; never interpolate caller input
  into SQL identifiers.
- Keep sync transactions atomic and idempotent. An attacker or flaky network
  must not create partial batches or duplicate counts through replay.
- Preserve tombstones and timestamp conflict checks so stale devices cannot
  resurrect or overwrite newer records.
- Back up before schema migration and test restoration. A backup that has never
  been restored is not considered verified.

## Mac update trust

The update feed is public metadata, contains no device credentials, and is baked
into the cloud image after CI verifies and publishes the release. The Mac pins
the feed origin and repository download paths, permits only GitHub HTTPS asset
redirects, bounds downloads, and verifies their size and SHA-256 before opening.
Checksums detect corruption but are not independent signatures: GitHub release
writers and Fly deployers are trusted software distributors. Protect both
accounts and never place tokens in update URLs or manifests.

Only the main-branch deploy job receives `contents: write` for release publishing.
PR builds neither publish releases nor receive deployment secrets. No installer
runs or app replacement happens without an explicit local user confirmation.
Production releases require Developer ID signing, hardened runtime, and stapled
notarization. The signed ZIP is additionally verified by Squirrel against the
installed application's signing requirement. The temporary native feed binds
only to loopback, uses unpredictable paths, rejects other methods/Host headers,
and exposes only the preverified ZIP after explicit installation consent.
Apple private keys and notarization passwords live in GitHub Actions secrets;
only trusted main-branch jobs receive them. Treat workflow-write access as
signing authority. Never add these credentials to PR jobs or print them.

## Dependency and CI policy

- Lock dependencies with both package lockfiles and use `npm ci` in CI.
- Pull requests run production dependency audits and fail for high/critical
  advisories. Review transitive deprecation warnings separately; do not apply
  blind breaking upgrades before a ranch event.
- GitHub Actions receive read-only repository contents unless a reviewed job
  needs more. Pull-request Mac builds use only ad-hoc identity `-` and receive no
  Apple signing secrets.
- Keep Playwright artifacts for failed runs only and ensure fixtures contain no
  production data or tokens.
- Before a release, inspect `git diff`, tracked filenames, and history for common
  credential/private-key patterns. Confirm generated DMGs, logs, databases, and
  test reports remain ignored.

## Deployment hardening

- Serve the cloud only through HTTPS. Set `PUBLIC_URL` to the exact public HTTPS
  origin and retain one trusted proxy hop.
- Use a least-privilege PostgreSQL role with access only to the Esquila database
  and schema. It needs the schema privileges required by boot-time idempotent
  migrations; it must not be a provider-wide administrator.
- Keep PostgreSQL inaccessible from arbitrary sources where the provider permits
  network restrictions, require TLS, and rotate credentials after exposure.
- Maintain one cloud machine unless session storage is externalized. Admin
  sessions and login throttling are currently in process memory and reset on
  restart; multiple instances would not share them.
- Protect the barn Mac with automatic security updates, a login password, disk
  encryption, and normal backups. Esquila prevents idle system sleep while it
  is open without preventing display sleep or screen locking. Keep it plugged
  in during an event and quit Esquila when hosting is no longer needed.

## Known risks and follow-up work

- Anyone on the trusted barn WiFi can call the local counting/setup APIs. A later
  phase should add a simple event/admin control if the network becomes shared or
  hostile.
- LAN traffic is HTTP. Do not expose port 3001 through router port forwarding or
  a public tunnel.
- Admin sessions are in memory, so a cloud restart logs admins out and resets
  throttling history. This is acceptable for one small instance, not a scaled
  deployment.
- Device API rate limiting is currently provider/network dependent. Add explicit
  limits before supporting many users or exposing higher-cost operations.
- Local/PR installers are ad-hoc signed. Production installers require Apple
  credentials; protect their renewal, backups, and revocation procedures.
- AWS uses long-lived environment credentials for the retained S3/SES path.
  Prefer a tightly scoped IAM principal and migrate to shorter-lived credentials
  or a more robust managed backup design in a future phase.
