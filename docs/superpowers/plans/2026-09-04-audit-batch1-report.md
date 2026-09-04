# Audit Batch 1 — Security & Data-Safety Fixes — Feature Report

**Plan:** `docs/superpowers/plans/2026-09-04-audit-batch1-security-data.md` (Local Version, read-only reference)
**Branch:** `fix/audit-batch1` (worktree: `../Electrical-program-wt-audit1`)
**Execution:** Sonnet 5
**Commits:** 12 (one per task), plus this report commit, plus 3 post-review
fix commits (below) and this section's own report-update commit.

## Summary

All 12 tasks done. Closes the batch's two critical and several high findings:
destructive migrations that could wipe a restored database, deactivated
employees who could still log in, an unauthenticated public link that leaked
internal cost/margin data, a credential (VAPID private key) readable by any
logged-in account, a document-upload/proxy/content-type chain that let a rep
attach files to another rep's job and let an uploaded file be served back as
whatever type the attacker declared, an unescaped live customer email and an
unsanitized live AI prompt path, Microsoft OAuth with no CSRF state and a
bearer token riding in the URL, a six-write lead→proposal handoff with no
transaction, credentials leaking into request logs, a test-database guard
that was a blocklist instead of an allowlist, production having no backup
job at all, and three dependencies with known CVEs in their currently-used
version range.

## Per-task status

### Task 1 — Destructive migrations can never run again — **done**
- `database/migrations/025_clear_test_data.sql` and `056_clear_test_leads.sql`:
  bodies replaced with historical no-op comments (filenames unchanged, so
  `schema_migrations` tracking is untouched).
- `backend/src/migrate.ts`: scans each migration's SQL (comments stripped,
  case-insensitive) for `TRUNCATE`/`DROP TABLE` before executing it; throws
  naming the file unless `ALLOW_DESTRUCTIVE_MIGRATIONS=1`.
- Test: `backend/src/test/migrateDestructiveGuard.test.ts` (4 tests) — writes
  temp migration files into the real `database/migrations/` directory (worktree
  copy only) and cleans them up in `afterEach`; confirmed fails on unfixed
  `migrate.ts` (2 of 4 assertions fail — no throw), passes fixed.

### Task 2 — Deactivated users cannot authenticate — **done**
- `backend/src/routes/auth.ts`: `AND status = 'active'` added to the login
  query, the forgot-password lookup, and the reset-password lookup; the
  Microsoft path's `status != 'inactive'` normalized to `status = 'active'`.
- Test: `backend/src/test/authInactiveUser.test.ts` (5 tests) — inactive-user
  login 401s, forgot-password for an inactive user matches the generic
  unknown-email response exactly, no reset token is issued, reset with a
  valid token on an inactive user 400s. Confirmed 3 of 5 fail on unfixed code.

### Task 3 — Public proposal route returns customer-safe columns only — **done**
- `backend/src/routes/gens.ts`'s `GET /p/:token`: both the preview `SELECT`
  and the view-stamping `UPDATE ... RETURNING` now use an explicit column
  list (`customer, product_type, proposal_no, form_data, totals_data,
  signature_data, initials_data, signed_at, countersigned_at,
  countersignature_data`) derived from reading `ProposalPublicPage.tsx`
  end to end. `totals_data`/`form_data` were confirmed to be customer-facing
  sell-side pricing (not a separate cost/margin column), so no server-side
  sub-projection of the JSONB was needed beyond the column list itself.
- Test: `backend/src/test/gensPublicProposal.test.ts` (3 tests) — snapshots
  the exact key set on both branches, and asserts 19 internal fields/columns
  (salesperson_id, org_id, all Drive folder ids, checklist_data,
  survey_markup, id, amount/tax/mfr/model/kw/stage, etc.) are absent.
  Confirmed all 3 fail on unfixed code.

### Task 4 — Secrets never leave app_settings — **done**
- Grepped every `getSetting('...')` / `INSERT INTO app_settings` key in
  `backend/src`. Only `jwt_secret` (already handled) and `vapid_private_key`
  are credentials; `vapid_public_key` is intentionally public (browsers need
  it for push subscriptions) and stays out of `INTERNAL_KEYS`. `ai_anthropic_key`
  is the one third-party API key and was already in `MASKED_KEYS`. No other
  key name matched secret/token/private_key/password/client_secret.
  **Final `INTERNAL_KEYS`:** `['jwt_secret', 'vapid_private_key']`.
  **Final `MASKED_KEYS`:** `['ai_anthropic_key']` (unchanged).
- `vapid_private_key` was never in `ALLOWED_KEYS`, so `PUT /api/settings`
  already could not be used to set or echo it back — no additional
  "read-back" guard was needed beyond the `INTERNAL_KEYS` addition.
- Test: `backend/src/test/settingsInternalKeys.test.ts` (4 tests) — a
  non-admin authenticated GET never returns `vapid_private_key` or
  `jwt_secret`; `vapid_public_key` still returns; `ai_anthropic_key` returns
  masked (`••••••••` + last 4); PUT cannot set `vapid_private_key`. Confirmed
  1 of 4 fails on unfixed code (the other 3 pass unfixed since they test
  pre-existing, correct behavior).

### Task 5 — Documents: upload ownership, fail-closed proxy, safe content types — **done**
- `backend/src/routes/documents.ts`: `POST /` now checks
  `ownsLinkedRecord(scope, linked_id)` before `storeDocument` runs (403,
  nothing lands in Drive on failure). The Drive proxy
  (`GET /drive-file/:fileId`) now fails closed — no tracked row means 403,
  never an implicit fetch.
- `backend/src/utils/upload.ts`: added `EXT_TO_MIME` (one entry per extension
  across all three upload filters) and `mimeTypeForFilename()`.
- `backend/src/utils/storeDocument.ts`: derives the stored/served type from
  the filename extension via `mimeTypeForFilename`, never the client's
  declared multipart type — used for the Cloudinary upload, the Drive
  upload, and the `documents.file_type` column alike.
- `backend/src/routes/documents.ts`'s `/view` and `/download` routes: a
  shared `serveDocument()` helper sets Content-Type from the stored
  `file_type` (never Drive's or Cloudinary's own reported type), adds
  `X-Content-Type-Options: nosniff`, and only allows `inline` for
  `application/pdf`/`image/*` — everything else forces `attachment` (the
  `/download` route already always used `attachment`, so it was
  functionally safe already, but now shares the same safe Content-Type
  source).
- Pre-existing document rows keep whatever `file_type` was recorded at
  upload time — client-declared, not to be trusted the same way as rows
  filed after this fix. No backfill, per the plan.
- Test: `backend/src/test/documentsOwnershipAndContentType.test.ts`
  (6 tests) — cross-rep upload 403s with no row created; owner/manager
  uploads succeed; drive-file proxy 403s on an untracked id; a `.pdf`
  uploaded with a spoofed `text/html` multipart type is stored and served
  as `application/pdf` with `nosniff` and `inline`; a `.csv` (non-pdf/image)
  is always `attachment` even on `/view`. Confirmed 4 of 6 fail on unfixed
  code.

### Task 6 — Escape the live proposal email; sanitize the live AI path — **done**
- `backend/src/email/proposalEmail.ts`: every interpolated value
  (`customerName`, `proposalNo`, `spec`, `total`, `deposit`, `senderNote`,
  `defaultMessage`, `gasContacts`) now runs through `escapeHtml` before
  interpolation; `nl2br` runs after escaping. `link` and `validDays` are not
  user-supplied text and were left as-is.
- `backend/src/ai/agent1Batching.ts`: `sanitizeForPrompt` now wraps
  `u.filename`, `u.label`, and `u.cls` in both sheet-delimiter lines
  (document-fallback and pdf-page branches) — this is the module the live
  route (`routes/preconstruction.ts`) actually calls.
- `backend/src/ai/documentPrep.ts`: deleted the dead `buildAgent1Content`
  orchestrator (referenced only by its own test) and the now-unused
  `isPdftotextAvailable`/`extractPdfPageTexts`/`pageTextBlock`/
  `MIN_CHARS_FOR_TEXT_BLOCK`/`TOTAL_TEXT_CAP`/`sanitizeForPrompt` imports it
  alone required. The tile-generation helpers `agent1Batching.ts` imports
  (`tileSettingsFor`, `tilesForSelectedPdfPages`, `pdfDocumentBlock`,
  `imageToBlock`, `classifySheet`, etc.) are untouched.
  `backend/src/ai/documentPrep.test.ts`: removed the three `describe` blocks
  that tested only the deleted function (and their now-unused imports),
  kept every other describe block (`classifySheet`, `computePrepFidelity`,
  `contiguousPageRanges`, `computeTileGrid`, `tileSettingsFor`,
  `parseTileOverrideSetting`) untouched.
- Note: `u.cls` is typed `SheetClass = 'schedule' | 'plan' | 'detail'` — a
  closed literal union, not free text. Sanitizing it is a no-op in practice;
  it's included anyway because the plan named it explicitly and it's
  harmless.
- Tests: `backend/src/email/proposalEmail.test.ts` (5 tests, new — no prior
  test file existed for this pure function),
  `backend/src/ai/agent1BatchingSanitization.test.ts` (3 tests, new).
  Confirmed 6 of 8 combined fail on unfixed code (the 2 "renders normal
  values"/"leaves a normal filename unaffected" sanity cases pass either way).

### Task 7 — Microsoft login: CSRF state + no token in the URL — **done**
- `backend/src/routes/auth.ts`: `GET /microsoft` mints a 32-byte random
  `state`, stored in an **in-memory `Map<state, expiresAt>`** (10 min TTL,
  opportunistically pruned) rather than a signed cookie — this app runs as
  a single Node instance (no `numInstances` in `render.yaml`), so there's no
  cross-process state to share, and it avoids adding cookie-parsing
  middleware for a value only ever read back within the same round trip.
  **This is the executor's call the plan left open**, documented here per
  its instruction.
  `GET /microsoft/callback` verifies `state` (one-time use, deleted on read)
  before any token exchange with Microsoft; 400 on missing/unknown/expired
  state.
  The token-in-URL redirect (`?mstoken=<jwt>`) is replaced with a one-time
  opaque code (60s TTL, same in-memory-Map pattern) — `?mscode=<code>` —
  and a new `POST /api/auth/microsoft/exchange { code }` trades it for
  `{ token, user }` exactly once (404 on replay/expiry).
- `frontend/src/hooks/useAuth.ts`: the `?mstoken` branch becomes a `?mscode`
  → `POST /auth/microsoft/exchange` → existing token/localStorage/`setUser`
  path. The code is captured **synchronously** in the `useState` lazy
  initializer (before any effect runs) because App.tsx's unauthenticated
  view redirects everything but `/login`/`/reset-password`/`/p/:token` to
  `/login` via a wildcard `<Navigate>`, which drops the query string — that
  redirect's own effect could otherwise race ahead of the exchange and lose
  `?mscode` before it's ever read. The actual POST runs in a `useEffect`,
  guarded by a module-level "in flight for this code" flag so React 18
  StrictMode's dev-mode double-invoke can't double-spend the one-time code.
  `frontend/src/features/auth/LoginPage.tsx` needed no changes — it already
  renders the `?error=...` banner the exchange-failure path reuses, and the
  file is untouched (confirmed via `git diff --stat -- frontend/src/features/`
  = empty for this task and the whole branch).
- Tests: `backend/src/test/authMicrosoftOAuth.test.ts` (6 tests, mocks
  `global.fetch` for the Microsoft token exchange only), `frontend/src/hooks/useAuth.test.ts`
  (4 tests, mocks `api.post`; needed a small in-file localStorage shim — see
  "Frontend test environment gap" below). Confirmed 5 of 6 backend and 2 of
  4 frontend fail on unfixed code.

### Task 8 — Lead → proposal handoff is atomic — **done**
- `backend/src/routes/leads.ts`: `convertLeadToProposal` now takes a
  `PoolClient` as its first argument; every write inside it
  (`generator_proposals` insert, `proposal_activity` timeline copy, the
  `UPDATE generator_proposals` re-link branch, the documents relink, the
  lead's `stage='converted'` write, and both activity-log inserts) goes
  through `client.query`, and the `.catch(() => {})` swallowing on the
  document-relink/activity-log writes was removed — inside a transaction a
  real failure must roll back, not continue silently.
- The `PATCH /:id` handoff branch now opens `pool.connect()` +
  `BEGIN`/`COMMIT`/`ROLLBACK` covering: the dynamic-fields lead update, the
  site-visit stamp, and the full `convertLeadToProposal` call — six writes
  total, matching the plan's list. The non-handoff (ordinary field edit)
  path is untouched, still `pool.query` directly (no transaction overhead
  for the common case).
  `pushSiteVisitToCalendar` and `closeLeadFollowups` moved to run
  **after** `COMMIT`.
- Test: `backend/src/test/leadHandoffAtomic.test.ts` (2 tests) — forces the
  document-relink write to fail and asserts no `generator_proposals` row
  exists and the lead is not `converted`; a companion happy-path test.
  **Debugging note**: the first fault-injection approach (rejecting the
  query with a plain `Promise.reject`, either by reassigning a `PoolClient`
  instance's `.query` or by patching `Client.prototype.query`) reliably
  **hung the whole HTTP request indefinitely** — verified directly by
  isolating it down to a bare `pool.query(...).catch()` call outside any
  route. node-postgres tracks per-connection wire-protocol state
  internally; short-circuiting a query with a JS-level rejection (bypassing
  an actual round trip) leaves that state inconsistent and wedges every
  later query on the same connection. The working fix routes the induced
  failure through a **real** Postgres error instead (rewriting the matched
  query's SQL to reference a table that doesn't exist), which goes through
  the actual wire protocol and leaves connection state intact. Documented
  in the test file's own comment for whoever touches this pattern next.

### Task 9 — Logs, proxy, health — **done**
- `backend/src/index.ts`: `pinoHttp` gains
  `redact: ['req.headers.authorization', 'req.headers["x-api-key"]', 'req.headers.cookie', 'res.headers["set-cookie"]']`,
  exported as `LOG_REDACT_PATHS` so a test exercises the actual config
  object, not a hand-copied duplicate. `app.set('trust proxy', 1)` when
  `NODE_ENV === 'production'`. `GET /api/health` now `await`s
  `pool.query('SELECT 1')` under a 2s race-timeout, returning
  `{ ok: true, db: true }` or 503 `{ ok: false, db: false }`; the
  `autoLogging` ignore for `/api/health` is unchanged.
- Test: `backend/src/test/healthAndLogging.test.ts` (6 tests) — health
  happy/failure paths; `LOG_REDACT_PATHS` contains all four paths and a
  scratch `pino` instance with that config actually redacts a synthetic
  request object (secrets never appear in the log line); `trust proxy` is
  unset under `NODE_ENV=test` and becomes `1` when the module is
  re-imported (`vi.resetModules()` + dynamic `import()`) under
  `NODE_ENV=production`. Confirmed 5 of 6 fail on unfixed code.

### Task 10 — Test database guard becomes an allowlist — **done**
- `backend/src/test/harness.ts`: replaced the `current_database() === 'electrical_crm'`
  blocklist with `!currentDb.endsWith('_test')`, naming the connected
  database and the required suffix in the thrown message. Incident comment
  kept and extended with the reasoning (Supabase's default database name is
  `postgres`, not `electrical_crm` — the old check would have let that
  straight through).
- **No automated test**, per the plan (would require actually connecting to
  a non-test database from the suite). Verified with manual dry runs
  instead, both showing the exact new failure message and refusing outright:
  - `DB_NAME=electrical_crm npx vitest run src/test/authInactiveUser.test.ts` →
    `Refusing to run tests against database "electrical_crm" — its name does
    not end in "_test"...`
  - `DB_NAME=postgres npx vitest run src/test/authInactiveUser.test.ts` →
    `Refusing to run tests against database "postgres" — its name does not
    end in "_test"...` (this is the case the old blocklist would have missed).

### Task 11 — Backups: prod dump job, prune fix, gitignore — **done**
- `scripts/` itself was untracked (never committed) before this batch — this
  commit adds it to git for the first time, containing only the two backup
  scripts and the new plist (not `start-crm.sh`, which stays Jake's to add
  by hand per the plan's own manual-steps list).
- `scripts/backup-db.sh`: the `SUCCESS` log line now runs immediately after
  `mv "$TMP" "$FINAL"`, before the iCloud mirror and both prune steps, so a
  mirror/prune failure can never hide a successful dump; `|| true` added to
  the iCloud prune's `find ... -delete`.
- `scripts/backup-prod-db.sh` (new): same dump/sanity-check/mirror/prune
  shape, sources `$REPO/.crm/prod-db.env` for `PROD_DATABASE_URL` (clear
  failure message if absent), runs `pg_dump` via `docker run --rm
  postgres:16-alpine` (no local pg client needed), files named
  `electrical_crm-prod-<stamp>.sql.gz`, never echoes the URL.
- `scripts/launchd/com.jakesalverda.crm-backup-prod.plist` (new): `20:30`
  daily, `AbandonProcessGroup` true, paths matching the existing
  `com.jakesalverda.crm-backup.plist`. Jake installs it by hand
  (`launchctl bootstrap gui/$(id -u) <path>`), per the plan.
- `.gitignore`: added `.env.*` + `!.env.example` (`*.env`/`.env` only
  matched a file literally ending in `.env`, missing
  `backend/.env.pre-migration`). Confirmed `.crm/` was already ignored, and
  confirmed with `git check-ignore -v` that `.env.*` now catches
  `backend/.env.pre-migration` while `backend/.env.example` and
  `.env.example` stay trackable.
- **Dry run** (env file absent, as required — did NOT create
  `.crm/prod-db.env`, did NOT run against prod):
  ```
  $ bash scripts/backup-prod-db.sh
  backup-prod-db.sh: FAILURE: /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/.crm/prod-db.env not found. Create it with a single line: PROD_DATABASE_URL=<supabase-connection-string>, then chmod 600 it.
  exit code: 1
  ```
  This also appended one `FAILURE (prod)` line to Local Version's
  `.crm/backup.log` (a gitignored runtime log the existing `backup-db.sh`
  already writes to the same way) — the only Local Version side effect,
  informational only, not a source-file edit.

### Task 12 — Dependency upgrades that do not change APIs — **done**
- Backend: `adm-zip` 0.5.17 → 0.6.0, `sharp` 0.33.5 → 0.35.4. No direct
  `axios` dependency in backend (confirmed — skipped per the plan).
- Frontend: `axios` 1.7.2 → 1.20.0.
- `multer` (backend, currently `^2.1.1`), `jspdf` (frontend), and `xlsx`
  (frontend) deliberately left untouched, per the plan. Note: the audit's
  quoted vulnerable range for multer was "1.0–2.1.1", which technically
  already includes the version pinned in `package.json` — this batch does
  not touch it either way, per the plan's explicit instruction; flagging
  for whoever scopes the next batch.
- `npm run typecheck` and `npm test` clean/at-baseline in both packages
  after each upgrade (see Final test counts).

## Remaining `npm audit` list (after this batch's upgrades)

**Backend** — 15 vulnerabilities (8 moderate, 6 high, 1 critical):
- `body-parser` ≤1.20.6 (moderate) — via `express`
- `brace-expansion` (high) — transitive (`googleapis-common`, dev tooling)
- `esbuild` ≤0.24.2 (moderate) — dev-only, via `vite`/`vitest` toolchain
- `form-data` 4.0.0–4.0.5 (high) — transitive
- `multer` 1.0.0–2.1.1 (high) — **deliberately not touched this batch**
- `nanoid` (high) — transitive (`docx`)
- `postcss` ≤8.5.22 (high) — dev-only, via `vite`
- `qs` 2.2.5–6.15.3 (moderate) — via `express`
- `uuid` <11.1.1 (moderate) — via `exceljs`

**Frontend** — 14 vulnerabilities (7 moderate, 5 high, 2 critical):
- `browserslist` ≤4.28.6 (high)
- `dompurify` ≤3.4.12 (moderate, many advisories) — via `jspdf`
- `jspdf` ≤4.2.0 — **deliberately not touched this batch** (depends on
  vulnerable `dompurify`; fixing requires the jsPDF major bump the plan
  excludes)
- `esbuild` ≤0.24.2 (moderate) — dev-only, via `vite`/`vitest`
- `nanoid` ≤3.3.17 (high)
- `postcss` ≤8.5.22 (high) — dev-only, via `vite`
- `react-router`/`react-router-dom` 6.0.0–7.17.0 (moderate)
- `xlsx` * (high, no fix available) — **deliberately not touched this
  batch**, per the plan (evaluate replacing with `exceljs`, already a
  backend dependency, in a later batch)

Neither `adm-zip`, `sharp`, nor the backend/frontend `axios` versions
touched by Task 12 appear in either remaining list — confirmed fixed.

## Deviations / decisions the plan left open (all reasoned, none silent)

1. **Task 7's CSRF-state storage: in-memory `Map`, not a signed cookie.**
   The plan offered either; picked in-memory since the app is a single Node
   instance and it avoids new cookie-parsing middleware for a value read
   back only within the same OAuth round trip. See Task 7 above.
2. **Task 7's frontend token-race fix**: the plan's literal instruction
   ("strip the query param from the URL after exchange") doesn't by itself
   prevent App.tsx's unauthenticated-view redirect from dropping `?mscode`
   before the exchange ever reads it. Solved by capturing (not stripping)
   the code synchronously in the `useState` initializer, before any effect
   (including the router's own redirect) can run. `LoginPage.tsx` needed no
   changes.
3. **Task 8's test-fault-injection technique**: documented as a debugging
   note in the test file itself (see Task 8 above) — a `Promise.reject`
   short-circuit on a pg query hangs the whole request; the fix routes the
   induced failure through a real Postgres error instead.
4. **Task 1's guard regex** strips `--` line comments and `/* */` block
   comments before scanning for `TRUNCATE`/`DROP TABLE`, so the neutralized
   025/056 files (whose comments now say "the TRUNCATE was removed") do not
   themselves trip the new guard.
5. **Task 11**: `scripts/` had never been committed to git at all. This
   batch's Task 11 commit adds it for the first time, but only the two
   backup scripts and the new plist template — `start-crm.sh` (also
   currently untracked) is left for Jake, per the plan's own "Jake does
   these by hand" list (item 1).
6. **Task 6**: one pre-existing doc comment in the new
   `agent1BatchingSanitization.test.ts` originally named the deleted
   function by its literal identifier, which would have failed the plan's
   own `grep -rn buildAgent1Content backend/src` verification line. Reworded
   before this report's commit; folded into this commit rather than
   amending Task 6's commit, to avoid rewriting already-pushed-nowhere but
   already-final history.

## Frontend test environment gap (found, not fixed — out of scope)

This happy-dom version (20.10.1, as pinned in `frontend/package.json`)
provides **no global `localStorage`** (`typeof localStorage` and
`typeof window.localStorage` are both `undefined` in this Vitest/happy-dom
setup) — confirmed directly, and confirmed pre-existing: `useInstallPrompt.test.ts`
fails the same way on `main`, unrelated to this batch. `frontend/src/hooks/useAuth.test.ts`
(Task 7) works around this with a small in-file in-memory `localStorage`
shim rather than depending on the real thing being present; no application
or config file was changed to "fix" this gap, since it's outside this
batch's scope and the existing failure is already documented as
pre-existing (see phase4 report: "9 pre-existing failures in ...
`useInstallPrompt.test.ts` and `CustomerHub.test.tsx`").

## Final typecheck/test results

**Backend** (`npm run typecheck` then `npm test`, `NODE_ENV=test DB_NAME=electrical_crm_test`):
- `tsc --noEmit`: clean.
- **759 passed, 5 failed, out of 764** (2 skipped when DB unavailable are
  not counted here — DB was available throughout this session). All 5
  failures are pre-existing test-isolation/parallelism flakiness, confirmed
  by re-running: the exact failing subset and even the exact failing
  assertion within a given test **changes between runs** with **no source
  files touched between runs**, in files this batch never modified for
  behavior (`bidStandardGeneration.test.ts`, `integration.test.ts`'s
  "Kohler lead" case — the same flake documented in the existing
  `2026-09-03-phase4-report.md` — and `prebid.test.ts`'s document-row-count
  assertions). Baseline (before Task 1, on `main`, before any of this
  batch's changes): 2 failed / 732 passed out of 734, also non-deterministic
  across repeated runs with identical code. Test count grew from 734 to 764
  as this batch's 30 new tests were added across the 12 tasks.

**Frontend** (`npm run typecheck` then `npm test`):
- `tsc --noEmit`: clean.
- **347 passed, 9 failed, out of 356.** All 9 are the same pre-existing
  failures in `useInstallPrompt.test.ts` and `CustomerHub.test.tsx`
  documented in the phase4 report (the happy-dom `localStorage` gap above),
  confirmed unrelated by running the identical suite before Task 7's
  `useAuth.ts` change (2 failed files / 9 failed tests / 343 passed, same
  two files) and after (same 2 files / 9 tests, 347 passed — the +4 are
  Task 7's new, passing `useAuth.test.ts`).

## Safety confirmation

- **Tests only ever ran against `electrical_crm_test`** (or a deliberately
  wrong `DB_NAME` for Task 10's two dry runs, both of which correctly
  refused before touching any table). `harness.ts`'s live-DB guard — now an
  allowlist — was never tripped against a real non-test database.
- **`backup-prod-db.sh` was dry-run only**, with `.crm/prod-db.env` absent
  throughout; it was never run against the real Supabase database, and
  `.crm/prod-db.env` was never created.
- **Never ran a dev server, never touched Docker state.** All verification
  was `tsc --noEmit`, `vitest`/`npm test`, and the two documented shell dry
  runs above (Task 10, Task 11).
- **No `.env` file contents were ever printed.** Where `.crm/sync-prod-to-local.sh`
  was read for reference (Task 11), the connection-string line was piped
  through a redaction filter before being shown in this session's own
  output.
- **No pushes.** All 12 task commits plus this report are local to
  `fix/audit-batch1` in the `Electrical-program-wt-audit1` worktree, which
  never touches `Local Version`.
- **`Local Version` was never edited.** The plan and audit files were only
  ever read from there (and `.crm/sync-prod-to-local.sh` and the existing
  `com.jakesalverda.crm-backup.plist`, both read-only, for reference). The
  one Local Version side effect — a log line appended by Task 11's required
  dry run — is documented above under Task 11.
- **Clean tree** as of the final (report) commit.

---

## Post-review fixes (2026-09-04)

An Opus 5 adversarial review of the merged `fix/audit-batch1` branch returned
**MERGE AFTER FIXES**: three blocking findings (B1, B2, B3) and four cheap
non-blockers. All seven are addressed below, three commits (one per review
item, per the reviewer's instruction), in the same worktree, same safety
rules as the original batch.

| # | Commit | Status |
|---|---|---|
| B1 + B2 (one commit) | `bc0f326` | done |
| B3 | `65c4a85` | done |
| Non-blockers (a)–(d), one commit | `7df8130` | done |

### B1 + B2 — Drive proxy fails closed for every role, without breaking job photos — done, `bc0f326`

- **B1**: `GET /api/documents/drive-file/:fileId`'s "no `documents` row → 403"
  guard lived inside `if (scope)` (`ownScopeId` returns `null` for every role
  except `salesperson`/`salesperson_legacy`), so a `read_only`, `technician`,
  or `owner` account could still proxy an arbitrary Drive file id through the
  service account. Moved the "no row → 403" check outside the scope gate so
  it applies to every role; the ownership sub-check (uploader match or
  `ownsLinkedRecord`) stays scoped to restricted reps only, unchanged.
- **B2**: that fix alone would 403 job-site photo thumbnails for salespeople,
  since `GET /gens/:id/photos` / `GET /bids/:id/photos` list a Drive Photos
  subfolder directly (`listFolderFiles`) and those file ids never get a
  `documents` row — same for a Cloudinary-stored upload, whose Drive id (if
  any) is never persisted either. Added two owned-record routes,
  `GET /gens/:id/photos/:fileId` (behind `loadOwnedGen`) and
  `GET /bids/:id/photos/:fileId` (behind `loadOwnedBid`) — the explicitly
  authorized exception to "nothing in the gens pipeline beyond the one public
  route." Each confirms the requested file's parent folder equals that
  record's own `drive_photos_folder_id` via a new `getFileParents()` helper
  in `services/googleDrive.ts`, then streams via the existing `getFileMedia`.
  `frontend/src/components/DriveImage.tsx` gained an optional `src` prop to
  override the default `/documents/drive-file/:fileId` proxy;
  `frontend/src/features/gen-projects/GenProjectsPage.tsx` and
  `frontend/src/features/elec-projects/ElecProjectsPage.tsx` (the two photo
  grids) now pass the matching owned route. No other file under
  `frontend/src/features/` was touched for this fix.
- Test: `backend/src/test/driveProxyOwnership.test.ts` (5 tests) — a
  `read_only` and an `owner`-role user both 403 on an untracked file id
  (B1); the owning salesperson 200s a photo whose Drive parent matches their
  gen's photos folder (B2, `getFileParents`/`getFileMedia` mocked via a
  partial `vi.mock` of `services/googleDrive`); a salesperson fetching a
  photo under a gen they don't own gets 403/404 with Drive never consulted;
  a file whose parent isn't the gen's photos folder 403s. Confirmed 4 of 5
  fail on the pre-fix code (the 403/404 "not your gen" case incidentally
  passes either way, since the new route doesn't exist pre-fix and Express
  404s the unmatched path — an acceptable outcome under that test's own
  `[403, 404]` assertion).

### B3 — `form_data` projected server-side on the public link — done, `65c4a85`

Task 3's explicit column list was correct, but `form_data` itself still
shipped whole. New `backend/src/utils/publicFormData.ts` whitelists exactly
the keys the two preview components read, applied to both branches of
`GET /api/gens/p/:token`.

**Every `form.*` access in `ProposalPreview.tsx`** (generator form), read
directly from the file: `customer`, `attn`, `address`, `city`, `state`,
`zip`, `phone`, `email`, `brand`, `size`, `atsQty`, `atsSize`, `jobType`,
`validDays`, `depositPct`, `smmQty`, `surgeProQty`, `silverServicePromo`,
`extWarranty`, `extWarrantyPromoStart`, `extWarrantyPromoEnd`, `genStand`,
`evCharger`, `evChargerTier`, `notes`, `includeBreakdown`, `taxRate`
(inside the `includeBreakdown` page only), `liftType` (same), `extraWire`
(same) — plus two fields needed only **transitively**, because
`ProposalPreview.tsx` calls these `genCalc` helpers in its own render body:
`loadCenterFor(form)` needs `coolingType` (not read as `form.coolingType`
literally anywhere else in the file, but required for the helper to return
the right load-center label), and `activeCustomItems(form)` /
`customItemAmount(item)` need `customItems` and each item's own `id`,
`desc`, `amount`, `taxable`. `genModelNo` and `genPriceRows` are imported
but never actually called in this file — no additional fields needed for
those. `discount`, `discountType`, `labor`, `permit`, `startup` are
**never read directly** by this component at all (the rendered breakdown
table uses pre-computed `totals.laborAmt`/`totals.permitAmt`/
`totals.startupAmt`, not the raw form fields) — but the raw values still
rode along in the un-projected `form_data` JSON regardless of what the UI
displayed, which is the actual leak B3 describes. Per the review's
instruction, these are treated as breakdown components and shipped only
when `includeBreakdown` is true (matching the page that would show that
class of number), not added unconditionally.

**Every `form.*` access in `EvProposalPreview.tsx`** (EV-charger form):
`customer`, `attn`, `address`, `city`, `state`, `zip`, `phone`, `email`,
`depositPct`, `validDays`, `panelUpgrade`, `notes`, `includeBreakdown`,
`distanceTier` (via `evTierLabel(form.distanceTier)`) — plus `customItems`
transitively via `activeCustomItems`/`customItemAmount`, same as the
generator form. `discount`, `discountType`, `taxAmount` are never read
directly (the breakdown table uses `totals.discountAmt`/`totals.tax`) —
same treatment as the generator side's breakdown fields, gated on
`includeBreakdown`. `tierPriceOverride` (the EV analog of
`genPriceOverride`) is not read anywhere and is never sent at all, even
with `includeBreakdown` true — it isn't a hidden cost figure (it's the same
number `totals.tierAmt` already shows), but nothing in either preview
component needs it, so it stays out of the whitelist by the "only what's
read" rule.

Confirmed `ProposalPublicPage.tsx` needs nothing beyond this: it only reads
`data.form_data` as an opaque object to pass straight through to
`ProposalPreview`/`EvProposalPreview` as the `form` prop (after
`migrateGenForm`/`migrateEvForm`, which only ever fill in *missing* keys
with defaults — they don't require extra keys to be present) — it does not
read any `form.*` field itself.

Test: `backend/src/test/gensPublicFormDataProjection.test.ts` (4 tests) —
`includeBreakdown: false` drops both the internal site-detail keys
(`feedFt`, `genSide`, `panelRel`, `panelFt`) and the breakdown keys, and the
remaining key set matches the whitelist exactly (snapshotted);
`includeBreakdown: true` keeps the breakdown keys present, still drops the
site-detail keys; a custom line item's extra/unexpected field
(`secretCostBasis`) is stripped down to `id`/`desc`/`amount`/`taxable`; an
EV-charger proposal is projected with the EV key list and never carries
`tierPriceOverride`/`discount`/`taxAmount`. Confirmed all 4 fail on the
pre-fix code.

### Non-blockers (a)–(d) — one commit, `7df8130`

- **(a) `routes/auth.ts`**: `GET /api/auth/microsoft` now runs behind
  `authLimiter` (it minted one unbounded `oauthStates` entry per
  unauthenticated call). `oauthStates` is capped at 1000 entries with
  oldest-first eviction (`Map` iteration order is insertion order) once
  pruning expired entries isn't enough. An invalid/expired `state` on the
  callback — a browser navigation, not an API call, and reachable in
  practice by a backend restart mid-login dropping the in-memory map —
  now redirects to `${frontendBase}/login?error=oauth_state` instead of a
  raw JSON 400 the user would see verbatim. Updated
  `authMicrosoftOAuth.test.ts`'s three affected assertions (no-state,
  unknown-state, and the replay case) to expect the redirect.
- **(b) `routes/leads.ts`**: the post-commit `closeLeadFollowups(lead.id)`
  call is now wrapped in `.catch()` with a logged warning, mirroring
  `pushSiteVisitToCalendar`'s existing best-effort handling just above it —
  a throw there must not 500 a handoff that already committed successfully.
  (Note: `closeLeadFollowups` already catches its own errors internally and
  never actually rejects, so this is defense-in-depth against that
  changing later, not a fix for an observed failure.) A failed `ROLLBACK`
  in the handoff transaction's `catch` block now releases the client with
  the error (`client.release(rollbackErr)`) instead of a plain
  `client.release()`, so `pg` destroys a possibly-corrupted connection
  instead of returning it to the pool; restructured to exactly one
  `release()` call per exit path (no `finally`, which would have
  double-released after the new error-path release).
- **(c) `utils/upload.ts`**: `.dwg`/`.dxf` no longer map to the unofficial
  `image/vnd.dwg`/`image/vnd.dxf` types — `documents.ts`'s inline check is
  a bare `type.startsWith('image/')`, so these tripped it even though no
  browser can actually render a CAD file as an image (not exploitable as
  found, but contrary to the allowlist's intent). Now `application/acad`
  and `application/dxf` respectively; `.dwf`/`.dwfx` (already `model/vnd.*`,
  never matched `image/`) are unchanged.
- **(d) `scripts/backup-prod-db.sh`**: the Supabase connection string now
  passes into the container via `-e PGURL=...` and the dump runs as
  `sh -c 'pg_dump "$PGURL"'`, keeping it out of `pg_dump`'s own argv inside
  the container (visible to `docker top`/an in-container process listing)
  rather than a literal command argument. `scripts/backup-db.sh`'s prune
  glob changed from `electrical_crm-*.sql.gz` to `electrical_crm-[0-9]*.sql.gz`
  (the local dump's date-stamp starts with a digit) so it can never match
  `electrical_crm-prod-*.sql.gz` in the same `$DEST`, even if the two
  scripts' retention policies diverge later. Re-ran the Task 11 dry run
  (env file absent) after this change — same clean failure message, no
  docker/pg_dump ever invoked.

### Post-review: final test counts

- **Backend** (`npm test`, `electrical_crm_test`): **762 passed, 4 failed,
  7 skipped, out of 773** — same pre-existing test-isolation/parallelism
  flakiness documented in the original report above (confirmed again by
  re-running: `prebid.test.ts`, `bidStandardGeneration.test.ts`, and
  `integration.test.ts`'s "Kohler lead" case, none of which any post-review
  fix touches). Test count grew from 764 to 773 with the 9 new tests added
  across the three post-review commits (5 + 4).
- **Frontend** (`npm test`): **347 passed, 9 failed, out of 356** —
  unchanged from the original report (no frontend test files added or
  changed in the post-review round beyond the two call-site edits, which
  have no dedicated test file of their own).
- `npx tsc --noEmit` clean on both `backend/` and `frontend/` after each of
  the three post-review commits.

### Post-review: safety confirmation

- **Tests only ever ran against `electrical_crm_test`.**
- **`backup-prod-db.sh`'s dry run (re-run after fix (d))** used the env-file-absent
  path only — never executed against prod, `.crm/prod-db.env` never created.
- **Never ran a dev server, never touched Docker state.**
- **No pushes.** All three post-review commits plus this report update are
  local to `fix/audit-batch1` in the `Electrical-program-wt-audit1` worktree.
- **Clean tree** as of this report-update commit.
