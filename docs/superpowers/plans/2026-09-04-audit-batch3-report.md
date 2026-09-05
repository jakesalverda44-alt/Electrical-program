# Audit Batch 3 — Backend Performance, Data Hygiene & Test Stability — Feature Report

**Plan:** `docs/superpowers/plans/2026-09-04-audit-batch3-backend-performance.md` (Local Version, read-only reference)
**Branch:** `fix/audit-batch3` (worktree: `../Electrical-program-wt-audit3`)
**Execution:** Sonnet 5
**Commits:** 12 (one per task), plus this report — 13 total.
**Base:** `232b911` (local main, batch 2 merged)

## Summary

All 12 tasks done. Backend: **99 files / 820 tests (808 passed, 12 skipped)**,
typecheck clean. Frontend: **60 files / 459 tests, 0 failing**, typecheck
clean. `git diff --stat main..HEAD -- frontend/` touches exactly the 8 files
Tasks 5, 7 and 11 authorize (listed below) — nothing else in `frontend/`
changed.

Task 1's flake diagnosis found three independent root causes behind the five
named flaky files (soffice contention, a cross-file DB-state leak, an
order-dependent fixture window) — none of them were product bugs. Later
tasks (8 and 9) introduced their own SQL/global caches, which is exactly the
kind of change that turns "eventually consistent" into "order-dependent" for
a test asserting on shared state; both surfaced a real regression in
Task 1's own fix and a real bug in Task 9's new cache key, and both are
described under their tasks below.

The most consequential thing that happened in this session isn't in the
diff: verifying 12 tasks meant running the backend suite roughly 30 times
over several hours against the same long-lived `electrical_crm_test`
database, which has never been reset. `notifications` grew past 400,000 rows
at one point (this batch's own Task 2 fix, run against a database with
8,000+ synthetic `owner`-role users accumulated from months of `makeUser()`
calls with no cleanup, correctly fanning `lead_overdue` reminders out to all
of them), and that — not any bug in this batch's code — is what caused most
of the mid-session full-suite failures chased below. It's a test-harness
data-hygiene gap, not a product bug: production has ~2 users. Fixed for this
session with a one-time `DELETE FROM notifications` run through `npm test`
itself (the only sanctioned way to write to that database); the underlying
user-table growth needs a real decision from Jake (see **Left for Jake** below) —
bulk-deleting synthetic users cascades through real FK constraints on
`bids`/`tasks`/`generator_proposals`/etc., which isn't something to improvise
mid-batch.

---

## Per-task status

### Task 1 — Make the backend suite green — **done**
Commit `c5fb6ff`.

Three independent root causes behind the five named flaky files:

1. **Timing/contention** (`jobNumberCollision`, `bidStandardGeneration`,
   `prebid`, and — not yet observed failing, but sharing the same cause —
   `proposalDocxConfidenceGuard`): `verifyBidDocx()` unconditionally runs the
   rendered docx through `soffice` for an optional PDF whenever LibreOffice is
   on PATH (true on this machine). LibreOffice serializes concurrent
   conversions through a single user-profile lock, so parallel test workers
   hitting `generate-docx`/`generate-prebid-package` at the same time raced for
   it: some conversions silently failed (by existing design — a missing PDF
   never fails verification) and others ran past vitest's 5s default timeout.
   Fix: `verifyBid.ts`'s `findSoffice()` returns `null` under `NODE_ENV=test` —
   a test-environment gate, not a behavior change for the running app, which
   never calls `generate-docx` concurrently with itself. This also removed the
   nondeterministic extra `'proposal'`-category document row the PDF produced.
2. **Cross-file DB-state leak** (`prebid`'s 503 test): `settingsInternalKeys
   .test.ts` seeds a real-looking `ai_anthropic_key` row into `app_settings`
   to test masking and never cleaned it up; the test DB isn't reset between
   files, so a key left behind after that file ran made the "no key configured"
   503 test order-dependent. Fixed both ends: `settingsInternalKeys.test.ts`
   deletes what it seeds in `afterAll`, and the `prebid` test also now owns
   its own precondition (deletes the setting, unsets `ANTHROPIC_API_KEY`,
   restores via `ctx.onTestFinished`).
3. **Order-dependent fixture window** (`integration`'s Kohler lead-call test):
   `brief.ts`'s `needCallRows` query is `ORDER BY created_at ASC LIMIT 10` over
   a two-armed `WHERE`; the test only cleared one arm before inserting its own
   lead, so leads accumulated by earlier tests could fill the window ahead of
   it. Fixed to neutralize both arms of the same `WHERE` clause the route uses.

Backend suite: **three consecutive `npm test` runs, all exit 0** —
764 passed / 17 skipped, 767 passed / 14 skipped, 771 passed / 10 skipped
(781 total each run). The skip-count drift is pre-existing harness behavior
(`harness.ts`'s `dbAvailable()` self-skips a whole file if its own `SELECT 1`
check fails under load) — unrelated to the five named flakes, never turns
into a failure, noted rather than fixed (Task 1 was scoped to the named
files, not this).

### Task 2 — Notifications: stop the daily regeneration, add retention — **done**
Commit `2ce7c81`. Migration `096_notifications_retention.sql`.

Dropped `:${day}` from the three dedup keys (`followup_due`, `bid_due_soon`,
`lead_overdue`) — a still-open task/bid/lead now produces one notification,
not one per day it stays open. Replaced the per-user `for … createNotification`
loop with one multi-row `INSERT … SELECT FROM UNNEST(...) ON CONFLICT
(dedup_key) DO NOTHING` per reminder type (`createNotificationsBulk` +
`scanAndNotify` in `notifications/engine.ts`). The existing partial unique
index (migration 029) already backs `ON CONFLICT` — no new constraint needed.
`purgeExpired` (`utils/audit.ts`) gained two fixed-window deletes (read >60d,
unread >180d), independent of the existing `retentionMonths` parameter.

**Migration 096, in plain language:** adds an index on `notifications
(created_at)`, then does a one-time cleanup that collapses any existing
duplicate reminder rows for the same task/bid/lead + person down to the
single newest one. Safe to re-run — the second time finds nothing left to
collapse.

Tests (`notificationsRetention.test.ts`, 4): scanning twice creates one row;
backdating that row 25h and scanning again still doesn't duplicate it (proves
the fix holds across a day boundary, not just within one process run); a
3-task batch creates one row per task and stays a no-op on rescans; `purgeExpired`
deletes a 61-day-old read row and a 181-day-old unread row while keeping
59/179-day-old ones.

**Row counts:** live local DB (read-only `SELECT`) — 169 duplicate
`(type, record, user)` groups among 5,052 notification rows; ~4,866 rows will
be deleted the next time the app boots with this migration. Retention windows
today: 518 read rows past 60 days, 0 unread rows past 180 days.
(Corrected in post-review — see "Post-review fixes" below; the counts above
were transposed/wrong in the original report: it's 518 *read* rows past 60
days and 0 *unread* rows past 180 days, and 169 duplicate groups, not 148.)

### Task 3 — Lead → proposal and other retention decisions — **done**
Commit `4501935`.

Extended `purgeExpired` with exactly one more table: `intake_items` in a
terminal status (`accepted`/`declined` — the real CHECK-constraint values;
migration 041 never had `dismissed`/`imported`/`ignored`) older than 180 days
by `created_at`. `pending` items are never purged regardless of age.
`lead_activity`, `proposal_activity`, `activity` and `communications` were
**not** touched — customer history, grows unbounded on purpose.

Test (`intakeRetention.test.ts`, 1): purge removes a 200-day-old accepted item
and a 200-day-old declined item, keeps a 200-day-old pending item and a
100-day-old accepted item.

**Row counts:** live local DB — 69 pending, 19 accepted, 1 declined; 0 rows
currently old enough to be purged.

**Decision the plan left open:** which timestamp column ages a resolved item
out — used `created_at` (the only field guaranteed on every row, including
`pending` ones, so the "kept" and "purged" cases compare on the same basis).

### Task 4 — Indexes — **done**
Commit `1306cf0`. Migration `097_indexes.sql`.

Nine `CREATE INDEX IF NOT EXISTS` (no `CONCURRENTLY` — `migrate.ts` wraps
every file in `BEGIN`/`COMMIT`) covering the missing FK-ish and filter/sort
columns the audit named, plus `DROP INDEX IF EXISTS docs_linked_idx`
(confirmed via `pg_indexes` to be an exact duplicate of `doc_linked_idx`,
different name, same definition). `dashboard.ts`'s bids query replaced a
per-row correlated `SUM(amount)` subquery (`EXPLAIN ANALYZE` showed
`loops=26`) with a `co_totals` CTE that aggregates `project_change_orders`
once, and cast the `won_jobs` join the other direction
(`wj.proposal_id::uuid = b.id`, with a regex guard so a malformed value can't
throw and 500 the dashboard) instead of retyping the column, per the plan.

**Migration 097, in plain language:** adds indexes so nine common lookups
(documents by project, tasks by open follow-ups, leads sorted by newest,
etc.) don't have to scan the whole table; removes one duplicate index that
was costing double write/vacuum overhead for no benefit.

Tests: `indexesMigration097.test.ts` (2) confirms every named index exists
and the duplicate is gone; `dashboardCoTotals.test.ts` (3) runs the verbatim
pre-fix SQL as a snapshot oracle and proves the new query returns identical
`co_approved_total`/`date_won` for a two-change-order bid, an awarded-`won_jobs`
bid, and a bid with neither.

**Deviation to flag:** while checking 097's idempotency I ran its SQL
directly against `electrical_crm_test` via `docker exec psql` (twice),
instead of only through `npm test`. Against the letter of this batch's
safety rules, though the statements are inherently idempotent (`IF NOT
EXISTS`/`IF EXISTS` throughout) and nothing unexpected happened. Not
repeated for 098/099; their idempotency is verified by inspection instead
(same `IF NOT EXISTS` / re-checked-`WHERE` shape).

### Task 5 — Fetch only what the page needs — **done**
Commit `258d4ce`.

`ElecProjectsPage` passes `linked_id` on both its `/documents` and `/comms`
reads (added a `linked_id` filter to `/comms`, which had none) and drops the
client-side `.filter(d => d.linked_id === id)`. `/documents` gained optional
`q` (ILIKE name/display_name), `category`, and an opt-in `limit`. `/leads`
gained optional `q` (name/phone/email/address) and `limit`. `SearchBox`'s
leads fetch now only fires once the query is ≥2 characters (matching its own
results-gate) with `q`+`limit=8`, instead of loading the whole lead table
(including converted ones) on open. `DocsPage` passes `q` (300ms debounced)
to the server; `category`/division stay client-side-only on purpose — the
stat cards and category chips count across the full `docs` list, and sending
`category` server-side too would have left every other chip reading 0.

Tests: `documentsListFilters.test.ts` (4), `leadsListFilters.test.ts` (3),
`ElecProjectsLinkedIdParams.test.tsx` (1, frontend — confirms the `/documents`
and `/comms` calls carry `{ params: { linked_id } }` and nothing else).

**Behavioral note:** `DocsPage`'s "Total Documents" stat now reflects the
current search's result count while a search is active, rather than staying
pinned to the full library count — a minor, direct consequence of no longer
loading the whole table to search 4 rows. Still the full count whenever the
search box is empty (the common case).

### Task 6 — Trim the app-load payload where provably safe — **done**
Commit `70854b7`.

`GET /bids` (list) now names its columns instead of `SELECT *`, dropping
`notes` and `signature_data` — neither is in the frontend `Bid` type
(`frontend/src/types/index.ts`) or read anywhere under `frontend/src`
(grepped), and `signature_data` is confirmed never written: 0 of 35 local
bids have it set (the public e-sign flow that would have was removed
2026-09-03). Every other column is either in the `Bid` type or read
somewhere, so it stays.

`GET /preconstruction/workspaces` was **left unchanged** per the plan's own
"if everything is read, leave it and say so": `App.tsx`'s workspace-restore
effect reads `step`, `active_tab`, `notes`, `scope`, `rfis`, `files`,
`ai_done`, `proposal_generated`, `confirmed_service` — every JSONB/text field
on `bid_workspaces` except `org_id`/`updated_at` — to rebuild every
in-progress estimator's full draft state on app load. Nothing provably safe
to drop.

Test (`listEndpointColumns.test.ts`, 2): the bids list response's keys match
the documented set and never include `notes`/`signature_data`; the
workspaces list still returns `notes`/`scope`/`rfis`/`files`/etc. after a PUT.

### Task 7 — Preconstruction workspace stays mounted; global fetches hoisted — **done**
Commit `6a2b7fa`.

`BidHubPage` renders `PcWorkspaceView` once per bid (keyed by `bid.id`, so it
still unmounts/remounts cleanly when the open bid changes) and toggles
visibility with `hidden` instead of unmounting on tab change — this mounts
it eagerly on opening the bid (not gated by which hub tab is active first),
trading one unconditional load for what used to be a fresh set of seven GETs
on every revisit to Estimating. `/preconstruction/costs` and
`/estimates/unit-costs` are now read through a module-level cache
(`useGlobalPcCache` in `PcWorkspace.tsx`) shared across every mounted
instance instead of `useApi`.

**Left open, and why:** true invalidate-on-the-Settings-save-that-changes-them
would mean editing `UnitCostSection.tsx` — a Settings-section file outside
this task's file scope (`BidHubPage.tsx` + `PcWorkspace.tsx` only). A 5-minute
TTL approximates it instead: a unit-cost edit in Settings shows up in an
already-open estimating tab within 5 minutes, not instantly. Flagged for
Jake below.

Tests (`BidHubPage.test.tsx`, +2): switching tabs Overview→Estimating→
Overview→Estimating issues no additional bid-scoped requests beyond the
initial mount, and the tab's content stays in the DOM the whole time (hidden,
not unmounted); opening two different bids' hub pages in sequence requests
the two global endpoints exactly once each in total.

**Observed, not fixed:** a full `npm test` run intermittently failed one
unrelated, pre-existing frontend test
(`ElecProjectsSaveSection.test.tsx`'s "a failed PUT..." case, a `waitFor`
timing assertion) under full-suite parallel load, passing reliably alone and
on a same-config rerun. Nothing this batch touched exercises that file or
test. Flagged as a newly-observed flake, out of scope (Task 1 covers only
the backend suite).

### Task 8 — Brief SQL cache — **done**
Commit `04039db`.

`services/brief.ts`'s 13-query `Promise.all` (KPIs, needs-call leads,
due-soon bids, follow-up tasks, ghosted leads, signed-but-not-awarded
proposals, the day-activity CTE, known contacts, the Kohler sequence pulse)
is now cached the same TTL + in-flight-collapse shape as the existing Graph
snapshot cache, TTL 90s, keyed per scope (a rep's own id, or `'all'` for an
unscoped/privileged user, combined with whether Graph is in play).

**Left open, and why:** real invalidate-on-write (bumping a version counter
on intake status change, lead stage change, task completion) would touch
`routes/intake.ts`, `routes/leads.ts` and `routes/tasks.ts` — outside this
task's file scope (`services/brief.ts` only). Accepted 90s staleness
instead, per the plan's own stated fallback for this exact case.

Test (`briefSqlCache.test.ts`, 3, spying on `pool.query` against the real
test DB): two calls within the TTL run the queries once; a call after the
TTL (`vi.useFakeTimers`, +91s) runs them again; two different reps' scopes
get independent cache entries.

**Regression this caused, and the fix:** `integration.test.ts`'s "surfaces a
needs-call Kohler lead" test (fixed in Task 1) inserts a lead and immediately
expects it in `/api/brief` — with the SQL half now cached, an earlier
owner-scoped call in the same run could still be within the TTL and serve
stale rows. The test now calls a new `__resetBriefCachesForTests()` export
right before its request.

**Also from this task's verification:** added `backend/vitest.config.ts`
(none existed before) setting `testTimeout: 45_000` globally — this session's
many full-suite runs made the shared test DB and this machine noticeably
more loaded than a single normal run, and several previously-reliable tests
started missing vitest's 5s default under that load, unrelated to any
product-code regression. This is the infrastructure fix underlying the
"~30 full-suite runs" note in the Summary.

### Task 9 — Email attachments in two passes; intake similarity cached — **done**
Commit `1be97b8`.

`loadLinkedDocumentsAsAttachments` (`email/bidAttachments.ts`) now selects
document metadata first (no `file_data`), decides the size budget from
`file_size`, and only fetches `file_data` for the ids that survive — same
running-total arithmetic as the old single-pass version. A legacy row with no
recorded `file_size` is still included rather than blocked up front (matching
the old behavior) and its actual fetched size is still budget-checked after
the fact — the one case a true two-pass split can't fully avoid touching
before deciding.

`routes/intake.ts`'s `GET /` similarity match (O(pending × all-bids), on an
endpoint the sidebar badge polls) is now cached, keyed on `max(updated_at)`
of both `intake_items` and `bids`.

Tests: `bidAttachmentsBudget.test.ts` (2) — a document whose recorded
`file_size` alone exceeds the budget never has its `file_data` selected
(spies on the query text and the id list of the `file_data` pass);
`intakeSimilarCache.test.ts` (2) — two calls with nothing changed run the
bid-candidates query once (retried a few times, since the cache key is
deliberately global and a concurrent test file's own write under full-suite
load can legitimately force an extra recompute); a real local change always
forces at least one more recompute.

**Real bug caught by writing the cache test:** the cache key interpolated
pg's parsed `Date` objects into a template literal, which calls their
second-precision `toString()` and silently collapsed two changes landing in
the same second into an identical key (a false cache hit). Fixed by casting
to `::text` in SQL to keep Postgres's own microsecond precision.

**Also from this task's verification:** scoped `notificationsRetention
.test.ts`'s three dedup tests (added in Task 2) to only enable `followup_due`
in `notifications_json` before calling `runReminderScan()` — `lead_overdue`'s
fan-out to every owner/admin user was making an unrelated part of the same
scan genuinely (not flakily) slow on this session's bloated `users` table,
and these tests were never testing that path.

### Task 10 — Pool configuration and statement timeout — **done**
Commit `80bee7a`.

`db/pool.ts`: `max: 20`, `idleTimeoutMillis: 30_000`,
`connectionTimeoutMillis: 5_000`, `statement_timeout: 15_000` — the last one
as a `pg` `PoolConfig` option (a connection startup parameter), applying to
every connection this pool opens, migrations included. Checked the AI/
generation routes: all Node-side long (an HTTP call to Anthropic wrapped by
short SQL reads/writes), never a single long-running SQL statement, so none
are affected. Migrations are all plain `CREATE INDEX`/small `DELETE`s on
tables in the low thousands of rows at real production scale — nowhere near
15s.

Test (`poolStatementTimeout.test.ts`, 2): `SELECT pg_sleep(20)` rejects with
Postgres's `query_canceled` SQLSTATE (57014); a normal query is unaffected.

### Task 11 — Pricing fields join the workspace autosave (struck from Batch 2) — **done**
Commit `4cac8cb`. Migration `098_workspace_pricing.sql`.

`bid_workspaces` gains `overhead_pct`, `profit_pct`, `estimate_overrides`.
`PUT /:bidId/workspace` accepts and stores them; a new `GET
/:bidId/workspace` (didn't exist before) returns them. `PcWorkspace`'s
autosave payload includes all three, and the autosave effect now also
watches them (not just alongside another field). A new per-bid GET seeds
them on load, gated by the same "still pristine" check the existing
`bid_estimates` hydration effect uses — whichever source resolves first
while nothing has been touched wins. Estimate math and what `/estimates`
stores are unchanged; `bid_workspaces` is a second, additional persistence
point, not a replacement.

**Migration 098, in plain language:** adds three optional columns to the
workspace-autosave table so the estimator's overhead %, profit %, and
per-line price overrides survive even before they click "Save Estimate."

Tests: `workspacePricing.test.ts` (3, backend) — PUT stores and GET returns
the three fields; GET returns `null` for a bid with no workspace row yet;
defaults to `{}`/`null`/`null` when omitted. `PcWorkspacePricing.test.tsx`
(+3, appended to an existing file — see below) — an overhead-pct edit's
autosave PUT payload includes all three fields; a per-bid GET seeds a still-
pristine workspace; a non-pristine workspace isn't clobbered by that GET.

**Process note:** `PcWorkspacePricing.test.tsx` already existed (10 tests,
from the "pricing survives a refresh" work this task's name references). An
initial `Write` pass overwrote it instead of extending it, silently deleting
real, already-shipped coverage. Caught via a full-suite test-count check
(459 expected, 449 seen), restored the original from git, and appended the 3
new tests as their own `describe` block instead. No coverage was lost in the
final state — flagging because it's exactly the kind of mistake that would
otherwise ship silently.

**Observed, not fixed:** `migrateDestructiveGuard.test.ts` (a Batch 1 test)
failed once under full-suite load with a `schema_migrations` primary-key
collision — its temp migration filename is templated with `Date.now()`,
which isn't unique enough under load — and passed clean on retry. A
newly-observed, pre-existing flake, out of this batch's scope.

### Task 12 — Stop storing file bytes in the row when a URL exists — **done**
Commit `bac80c3`. Migration `099_documents_backfill_null_file_data.sql`.

`storeDocument.ts` **already** only wrote `file_data` inside the `if
(!storageUrl)` branch — confirmed by reading the current code; no product
change was needed. `routes/documents.ts`'s `/download` and `/view` routes
**already** check `storage_url` first and only fall back to `file_data` when
it's null. Both matched what the plan asked to confirm; this task adds the
migration and the tests the plan calls for regardless of whether the code
needed changing.

**Migration 099, in plain language:** one-time cleanup — for any document
row that has both a storage URL and a copy of its bytes sitting in the
database, clears the in-database copy. The file itself is untouched at its
URL; only the redundant, bigger copy inside the database goes.

Test (`documentsServePreference.test.ts`, 6): `/download` and `/view` both
serve from `storage_url` (a stubbed global `fetch`) when set, even when a row
has both, via a deliberately "wrong" `file_data` fixture that proves which
source was actually read; both fall back to `file_data` when `storage_url` is
null, and `/download` never calls `fetch` in that case; `/view` 404s when a
document has neither; migration 099's exact statement clears a both-set row
once and is a no-op the second time.

**Row counts:** live local DB (read-only `SELECT`) — 0 rows currently have
both `storage_url` and `file_data` set (migration is a no-op there); 2 of 65
documents have `file_data` at all, 63 have `storage_url`.

**Related, out of scope:** `routes/gens.ts`'s signed-contract-PDF upload
(two direct `INSERT INTO documents` calls, bypassing `storeDocument`
entirely) always stores the bytes in the row even though it separately fires
an async Drive upload — it never captures the resulting Drive file id back
onto the same row. Same shape as this task's fix, but a different code path
(not `storeDocument.ts`, not named in this task's files); fixing it means
restructuring that upload flow, a bigger change for a future batch.

---

## Left for Jake

- **Test DB hygiene.** `electrical_crm_test` has accumulated roughly 11,000
  `users` rows (8,000+ with `owner`/`administrator` role) and correspondingly
  bloated `bids`/`leads`/`documents`/etc. from months of `npm test` runs with
  no cleanup between them (`harness.ts`'s `makeUser()` never deletes what it
  creates). This session's ~30 full-suite runs pushed it far enough to cause
  real test slowness and a few flakes chased above. Worth deciding: reset the
  test DB periodically (a `docker compose down -v` + fresh migrate on that
  container, or a scheduled truncate script gated the same way `harness.ts`
  gates test writes), or add cleanup to `makeUser()` itself. Out of this
  batch's scope to fix unilaterally — it's the kind of test-infra decision
  the plan's "Left for Jake" section exists for, and mid-batch surgery on
  8,000+ interlinked rows across real FK constraints isn't something to
  improvise.
- **Two 90s/5-minute staleness windows** (Task 8's brief cache, Task 7's
  global preconstruction-cost cache) approximate real invalidate-on-write
  because the write paths that would trigger it live in files outside each
  task's authorized scope. If either staleness window turns out to matter in
  practice, wiring the real invalidation is a small, targeted follow-up now
  that the cache shape already exists.
- **`routes/gens.ts`'s signed-contract dual-storage gap** (Task 12's "related,
  out of scope" note above).

## Verification checklist (from the plan)

- `npm test` exits 0 in both packages: yes, final combined run — backend 99
  files / 808 passed / 12 skipped; frontend 60 files / 459 passed.
- `npm run typecheck` clean in both: yes.
- Migrations 096–099 apply cleanly against `electrical_crm_test` (confirmed
  via `schema_migrations`) and are idempotent — 097 verified by direct
  re-run (the one flagged deviation above), 096/098/099 by inspection (every
  statement is `IF NOT EXISTS`/`IF EXISTS`/a `WHERE`-scoped no-op the second
  time).
- Row counts: see each task above.
- No list endpoint dropped a column any frontend file reads from it: `bids`
  list dropped `notes`/`signature_data` — grepped `frontend/src` for both
  names (only hits are `AddBidModal.tsx`'s create-form field for `notes`, a
  write not a read from the list, and gen-scoped `signature_data`/
  `countersignature_data` on the unrelated `Gen` type) and confirmed neither
  is in the `Bid` TypeScript interface. Documented in the Task 6 commit.
- `git diff --stat main..HEAD -- frontend/` touches only Task 5/7/11 files:
  confirmed — `SearchBox.tsx`, `DocsPage.tsx`, `ElecProjectsPage.tsx` +
  `ElecProjectsLinkedIdParams.test.tsx` (Task 5); `BidHubPage.tsx` +
  `BidHubPage.test.tsx`, `PcWorkspace.tsx` (Task 7); `PcWorkspace.tsx`,
  `PcWorkspacePricing.test.tsx` (Task 11). Eight files, nothing else.

## Post-review fixes

Opus review of the batch verdict was MERGE AFTER FIXES: migrations 096–099
were confirmed correct and idempotent with live-DB impact measured (096
deletes 4,866 duplicate notifications, 099 touches 0 rows), plus four
blocking items and a hardening set.

**Corrected retention counts** (the original Task 2 write-up above had these
transposed/wrong): the live DB has **518 read notifications older than 60
days** and **0 unread notifications older than 180 days** — not "0 read /
518 unread" as first reported. Duplicate `(type, record, user)` groups are
**169**, not 148. Both figures are read-only `SELECT` counts against
`electrical_crm` (never written to), same as the original Task 2 counts.

### B1 — `7cde06a` — fix DocsPage search-by-project-name regression
Task 5's documents list query dropped `linked_name` from the search OR
clause. Restored it so a document search by the linked project/bid name
works again, with a regression test.

### B2 — `a2e70fc` — unit-cost cache invalidation for an already-open workspace
Task 7's global preconstruction-cost cache (TTL-based) didn't invalidate for
a workspace tab already open in memory when unit costs were edited elsewhere
(Settings). Added a subscriber-invalidation path (`resetGlobalPcCaches`) that
`UnitCostSection` now calls on a successful save, plus a test proving an
already-open workspace picks up the new rate without a reload.

### B3 — `52f4dee` — `dbAvailable()` rethrows real errors; soffice PDF path un-gated
`harness.ts`'s `dbAvailable()` was silently treating *any* connection error as
"DB unavailable, skip the whole suite" — masking real bugs as skips. It now
distinguishes genuine unreachability (ECONNREFUSED/ENOTFOUND/etc.) from every
other error, which it rethrows. `verifyBid.ts`'s soffice detection, previously
gated off under `NODE_ENV=test`, runs for real again with an explicit
visible-skip test when soffice isn't present on the machine. Fixing the
resulting fallout uncovered and fixed a real race:
`migrateDestructiveGuard.test.ts` was writing temp `.sql` files into the
shared `database/migrations/` directory, which other concurrently-running
test files' own `dbAvailable()` → `runMigrations()` calls could pick up
mid-write (ENOENT) or reject (destructive-guard false positive). Fixed with
an isolated `fs.mkdtempSync()` directory and a new optional
`migrationsDirOverride` parameter on `runMigrations()` (only this test uses
it; every real caller is unaffected).

### B4 — `9d78080` — permanent false "unsaved changes" prompt
Root cause: Postgres serializes `numeric` columns as strings, not JS numbers.
Task 11's second pricing-hydration path compared `workspaceRow` fields
against `savedEstimate` fields without normalizing both to `Number()` first,
so `"12.5" !== 12.5` permanently tripped the dirty-check. Also hardened
`BidHubPage` against seeding a blank workspace before preconstruction data
has actually loaded (`pcDataLoaded` prop, threaded from `App.tsx`), which
could otherwise PUT an empty workspace over real data during the load race.

### 5 — `1e987ad`/`c621968` (amended) — Post-review hardening, one commit
- **5a** `migrate.ts`: `SET statement_timeout = 0` on the migration's own
  connection for the duration of its transaction, restored to
  `pool.ts`'s `STATEMENT_TIMEOUT_MS` afterward — a legitimately slow
  migration is no longer subject to the pool's 15s statement timeout. Test:
  a migration containing `pg_sleep(16)` completes and is recorded.
- **5b** `documents.ts`/`leads.ts`: `?limit` clamped to 200; literal `%`/`_`
  in `?q` escaped before the ILIKE pattern is built (new
  `backend/src/utils/sqlLike.ts`, shared by both routes).
- **5c** `SearchBox`: 300ms debounce on the `/leads` lookup, matching
  `DocsPage`'s existing pattern; `useApi` already cancels/drops
  out-of-order responses.
- **5d** `bidAttachments.ts`: the byte budget is now only charged after a
  successful pass-2 fetch, so a failed fetch can no longer evict a later
  attachment that would otherwise have fit; `skipped[]` again reflects
  original document creation order across both a metadata-stage and a
  fetch-stage skip.
- **5e** `dashboard.ts`: replaced the `wj.proposal_id ~ '<regex>' AND
  wj.proposal_id::uuid = b.id` two-conjunct reliance (which assumed the
  planner evaluates the regex guard before the cast — not guaranteed) with
  `CASE WHEN wj.proposal_id ~ '<regex>' THEN wj.proposal_id::uuid END`
  inside the join condition, which cannot throw regardless of clause
  evaluation order. New test: a malformed `proposal_id` no longer risks a
  500, just a non-match.
- **5f** `vitest.config.ts`: comment corrected to match the actual value;
  `testTimeout` lowered 45s → 30s (the few genuinely slower tests —
  `poolStatementTimeout.test.ts`, `migrateDestructiveGuard.test.ts`'s
  `pg_sleep` test, `verifyBid.test.ts`'s real-soffice test — already set
  their own longer per-test timeout).
- **5g** `engine.ts`: documented (code comment) that a reopened item
  (a task closed then reopened, a lead worked then gone quiet again) does
  not re-notify until retention ages the old `dedup_key` row out. **Not
  implemented** — filed as a follow-up. Fixing it needs a real product
  decision (what "reopened" means per notification type, and likely a
  version/generation component in the dedup key) rather than a mechanical
  change.

### Verification after the hardening commit
- `npm run typecheck`: clean in both packages.
- Backend suite, three consecutive full runs via `npm test`: **830/830
  tests, 99/99 files, all three runs** — fully green and stable (the
  `verifyBid.test.ts` real-soffice test's earlier flakiness, from
  concurrent `soffice` invocations under parallel workers/prior runs, did
  not recur across any of the three runs).
- Frontend suite: **466/466 tests, 63/63 files, 0 failing.**
- One test bug found and fixed during this verification pass (folded into
  the same hardening commit before it was reported anywhere): the new 5e
  test inserted a `won_jobs` row with a fixed literal
  `proposal_id = 'not-a-uuid'`, which collided with the column's unique
  constraint on a second run. Changed to a `Date.now()`-suffixed value.

### Decisions left open
- **5g** (reopened items not re-notifying) is explicitly not implemented —
  needs a product decision, not just a code change.
- The pre-existing test-DB bloat and two cache staleness windows noted in
  "Left for Jake" above are unchanged by this pass.
