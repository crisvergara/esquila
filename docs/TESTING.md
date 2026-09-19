# Testing and pull-request checks

Every pull request and push to `main` runs two required jobs from `.github/workflows/pr-checks.yml`.

## Application and offline E2E

This job runs on Linux with a disposable PostgreSQL 16 service and Chromium. It checks:

- JavaScript syntax and both production Vite builds;
- UUIDv7 generation and Chile ranch-calendar behavior across summer and winter offsets;
- legacy SQLite migration, pre-migration backup, vaccination conversion, and outbox backfill;
- the browser onboarding wizard, including validation and four-station configuration;
- sheep, ram, and bulk-lamb tagger flows plus live monitor updates;
- tag-prefix digit limits, station persistence, and a response-loss retry after the server has already committed the count;
- all ranch API validation boundaries, maximum bulk payload, and idempotent retries;
- continued counting with the cloud unavailable, followed by exact row-for-row catch-up;
- recent-record editor additions, edits, deletion confirmations, response-loss retries across reload/restart, stale-editor rejection, offline reconciliation, and stale tombstone replay;
- edits made during a cloud upload whose response is lost, plus durable lamb-number reservation after manual corrections and restart;
- ranch restart safety for lamb numbering and synchronization;
- cloud monitor/record management, lost admin receipts across reload, concurrent
  duplicate submissions, stale editors, deleted-row history, and admin/phone/CSRF
  boundaries;
- bidirectional offline corrections in both conflict directions, retained conflict
  versions, tombstone pulls, ranch acknowledgements, and persisted restart cursors;
- transactional pull-page validation, 500-row paging, no upload echoes, and local
  edits made while a pull is in flight;
- cloud device authentication, phone/server role boundaries, malformed requests, transaction rollback, last-write-wins semantics, admin login, CSRF protection, and device revocation;
- vaccination PWA enrollment, offline writes, offline service-worker reload, direct phone-to-cloud synchronization, and proof that the treatment never passes through the ranch database.

The E2E suite uses temporary directories, a fresh isolated PostgreSQL schema per
worker/retry (removed afterward), and configurable non-production ports. It refuses to run without `TEST_DATABASE_URL`; that URL must point to a disposable database.

## Apple Silicon installer

This job runs on macOS and builds only the ARM64 DMG/ZIP. It verifies the executable architecture, ad-hoc signature, DMG checksum, Bonjour service declaration, and local-network permission description.

The Mac window lifecycle is indirectly covered by the same ranch server and browser onboarding contracts. A fully automated macOS GUI test is intentionally omitted because login-item, tray, fullscreen, and local-network permission dialogs are controlled by macOS and are substantially less reliable on headless GitHub runners. Those remain release-candidate smoke tests on a real Mac.

Updater unit/integration tests cover cloud metadata validation and missing feeds,
version/build rollback rejection, offline checks, concurrent requests, permitted
redirects, corrupt/partial/oversized installers, cached-file tampering, generated
build identity, and release publication/retry behavior using a fake GitHub CLI.
No publication test writes to GitHub. Native notification permissions, opening a
DMG, and dragging the replacement application remain real-Mac smoke checks.

## Delivery on main

On pushes to `main`, the verified Mac DMG/ZIP is uploaded as a workflow artifact
retained for 30 days. Cloud deployment runs only after both required jobs pass,
publishes permanent GitHub Release assets, then deploys and checks the live
health endpoint and update metadata. PRs never deploy. See
[DEPLOY.md](DEPLOY.md#automatic-deployment-and-mac-builds) for token setup,
downloads, and failure recovery. Required check names remain unchanged.

## Running locally

Install dependencies and Chromium once:

```sh
npm ci
npm ci --prefix cloud
npx playwright install chromium
```

Start a disposable PostgreSQL database, then run the same gate as GitHub:

```sh
TEST_DATABASE_URL=postgresql://user:password@127.0.0.1:5432/esquila_test npm run check
```

Useful narrower commands:

```sh
npm run test:unit
TEST_DATABASE_URL=postgresql://user:password@127.0.0.1:5432/esquila_test npm run test:e2e
```

On an E2E failure, Playwright retains a trace, screenshot, and video. GitHub uploads those files for seven days.

## Required branch checks

After merging the workflow, configure the `main` branch ruleset to require:

- `Application and offline E2E`
- `Apple Silicon installer`

GitHub does not allow a workflow committed in the same pull request to make itself required before that pull request merges, so this repository setting is a one-time manual step.
