# Esquila contributor guide

This file applies to the entire repository. It is the starting point for a new
development session; detailed requirements live in the linked documents so they
can be maintained without turning this file into a second README.

## Documentation table of contents

| Area | Read this | Use it for |
|---|---|---|
| Product and repository overview | [README.md](README.md) | User-facing capabilities, repository map, URLs, and API summary |
| Current system architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Component boundaries, data ownership, sync flows, invariants, and failure behavior |
| Approved offline-sync design | [docs/OFFLINE_SYNC_UPGRADE.md](docs/OFFLINE_SYNC_UPGRADE.md) | Original design decisions, trade-offs, rollout phases, and resolved questions |
| Development requirements | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local setup, configuration, change rules, database migrations, and definition of done |
| Test strategy and merge gates | [docs/TESTING.md](docs/TESTING.md) | Required commands, end-to-end coverage, CI jobs, artifacts, and branch protection |
| Security and secret handling | [docs/SECURITY.md](docs/SECURITY.md) | Trust boundaries, credentials, authentication, public-repository rules, and known risks |
| Cloud deployment and operations | [docs/DEPLOY.md](docs/DEPLOY.md) | PostgreSQL/Fly deployment, device enrollment, verification, cost controls, and recovery |
| Barn Mac application | [mac/README.md](mac/README.md) | Installation, onboarding, settings, local-network access, data locations, and ARM64 builds |
| Ranch configuration | [docs/RANCH_CONFIGURATION.md](docs/RANCH_CONFIGURATION.md) | Remote editor, manifests, stable station/color identity, offline cache, and onboarding |
| Raspberry Pi fallback | [pi/README.md](pi/README.md) | Legacy appliance install, kiosk onboarding, service operations, and recovery |

## Non-negotiable requirements

1. **Counting works without internet.** Tagger phones and monitors communicate
   only with the barn server over the local network. A cloud outage must never
   prevent, delay, or lose a count.
2. **Vaccination works without internet.** EsquilaDB must render its saved flock,
   accept treatments locally, show their pending state, and synchronize directly
   to the cloud when connectivity returns. It must not depend on the barn server.
3. **Every accepted write is durable and retry-safe.** Local writes and their
   outbox entries belong in one transaction. Client-generated UUIDv7 identifiers,
   submission identifiers, last-write-wins timestamps, and tombstones make replay
   safe. Never acknowledge a write before its durable local transaction commits.
4. **Data ownership stays explicit.** The barn SQLite database and authenticated
   cloud administrators may originate and correct shearing events. Shearing
   changes synchronize in both directions with durable cursors and tombstones.
   The remote PostgreSQL database is the shared flock view and system of record
   for treatments. Phone-role devices may write treatments and presets, but
   never shearing events.
5. **Ranch calendar dates use `America/Santiago`.** Instants are ISO-8601 UTC
   timestamps; treatment/report days are Chilean calendar dates. Do not derive
   ranch days with the developer machine's timezone.
6. **Field UX must be resilient.** Primary ranch workflows are in Spanish,
   touch-friendly, usable on small phones and a fullscreen TV, and give visible
   success, pending, duplicate, offline, and failure feedback. Never swallow a
   failed network request.
7. **The public repository contains no secrets or runtime data.** Follow
   [docs/SECURITY.md](docs/SECURITY.md). Do not commit `.env*`, databases, tokens,
   credentials, logs, build output, enrollment URLs, or production exports.
8. **Behavior changes require regression coverage.** Extend the closest unit or
   Playwright scenario and run the merge gate described in
   [docs/TESTING.md](docs/TESTING.md). Do not weaken an assertion merely to make a
   change pass.

9. **App updates never interrupt counting automatically.** Cloud update metadata
   may advertise only a verified, published installer. Check/download failures
   must leave the barn server running. Quitting to install requires explicit
   operator action, and application replacement must preserve ranch data.

10. **Remote configuration remains usable offline.** Cloud manifests are scoped
    to the authenticated server, validated and persisted locally before use.
    Retiring choices preserves history and station numbers. An in-progress
    animal and its retries retain their starting configuration. Configuration
    failures must not block counting or record synchronization.

11. **Background hosting stays awake.** The Mac shell prevents automatic idle
    sleep while it is running, including with all windows closed. Preserve
    display sleep and screen locking, and release the assertion when it exits.

## Working agreement for future sessions

Before editing:

1. Read this file and the documents for the affected component.
2. Inspect `git status` and preserve unrelated user changes.
3. Identify which offline, authorization, data-integrity, and restart paths the
   change can affect.

Before handing off:

1. Run `npm run check` against a disposable PostgreSQL database, plus the ARM64
   installer job when Mac packaging changed.
2. Confirm both online and disconnected behavior for changed synchronization
   paths, including replay after an ambiguous response.
3. Run `git diff --check`, review all staged files, and scan for secrets/runtime
   artifacts.
4. Update the relevant documentation in the same change. If an invariant or
   design decision changed, update this file and `docs/ARCHITECTURE.md` as well.
5. Keep the two GitHub checks—`Application and offline E2E` and
   `Apple Silicon installer`—required on `main`.
