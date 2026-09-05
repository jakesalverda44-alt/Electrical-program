# Adversarial Review — Audit Batch 3 (`fix/audit-batch3`, 13 commits)

## 1. Verdict: **MERGE AFTER FIXES**

Migrations 096–099 are the safest part of this batch: correctly written,
genuinely idempotent, no unauthorized data modification; I verified their
live-DB impact with read-only SELECTs (§5). Task 4's dashboard rewrite is
provably output-identical on the live DB. Typecheck clean both packages;
frontend 459/459.

Four things must be fixed first: a real search regression on DocsPage, a
stale-pricing defect in Task 7's cache that the report describes incorrectly, a
newly-introduced permanent false "unsaved changes" prompt on every bid with
autosaved pricing, and the fact that the "green suite" gate Task 1 exists to
establish is not reliable — three of my runs silently skipped 12, 5 and 17 tests
in *different* files each time and still exited 0.

## 2. Blocking

### B1 — DocsPage search by project name is broken (Task 5)
`backend/src/routes/documents.ts:69`
```ts
if (q) { params.push(`%${q}%`); conds.push(`(name ILIKE $${params.length} OR display_name ILIKE $${params.length})`); }
```
`frontend/src/features/docs/DocsPage.tsx:180` (the client fallback):
```ts
if (q && !d.display_name.toLowerCase().includes(q) && !(d.linked_name ?? '').toLowerCase().includes(q)) return false;
```
The client filter matches **`linked_name`**; the server filter does not. Since
DocsPage now sends `q` to the server (`DocsPage.tsx:84-86`), rows that match only
by `linked_name` never reach the browser, and a client-side filter can only
narrow — it cannot recover them. `DocsPage.tsx:76` states this as the mitigation; it is the bug.

**Failure:** Jake types a GC or project name into the docs search and gets "No
documents match these filters" where he used to get that project's documents.
**Fix:** add `OR linked_name ILIKE $n` server-side. `documentsListFilters.test.ts`
has no `linked_name` case, which is why this shipped.

### B2 — Unit-cost cache never refreshes for an open workspace (Task 7)
`frontend/src/features/preconstruction/PcWorkspace.tsx:65-84`
```ts
function useGlobalPcCache<T>(cache: GlobalPcCacheEntry<T>, url: string): T | null {
  useEffect(() => {
    const isFresh = cache.data !== null && (Date.now() - cache.fetchedAt) < GLOBAL_PC_CACHE_TTL_MS;
    ...
  }, [cache, url]);        // both constants — this effect runs ONCE per mount
```
`GLOBAL_PC_CACHE_TTL_MS = 5 * 60 * 1000` (line 51) is consulted only at mount —
no interval, no focus listener, no invalidation from the Settings save
(`UnitCostSection.tsx:66` PUTs `/estimates/unit-costs`; nothing clears the
cache). Task 7.1 simultaneously keeps the workspace mounted for as long as a bid
is open, so the effect no longer re-runs on tab switches either; before this
branch every click on Estimating remounted and refetched.

The report's "shows up in an already-open estimating tab within 5 minutes" is
**not true** — for an already-open workspace it never shows up.

**Failure:** Jake edits a unit cost, returns to the bid he had open, and
`buildLineItemsFromTakeoff` prices every line at the old rate; "Save Estimate"
then persists those totals and syncs `bids.amount`. Wrong money, no indication,
and it sticks because it was written to the DB.
**Fix:** export the existing cache-reset and call it from `UnitCostSection`'s
save.

### B3 — `npm test` exits 0 while silently skipping whole files (Task 1)
Three full backend runs, all exit 0:

| run | passed | skipped | files silently skipped |
|---|---|---|---|
| 1 | 808 | 12 | settingsInternalKeys, leadHandoffAtomic, driveProxyOwnership, generateDocxStorage |
| 2 | 815 | 5 | **dashboardCoTotals**, **intakeSimilarCache** |
| 3 | 803 | 17 | **dashboardCoTotals**, leadHandoffAtomic, generateDocxStorage, driveProxyOwnership, bidsStage, settingsAllowedKeys |

**None of the 12/5/17 skips are soffice-related.** All are whole-file self-skips
from `backend/src/test/harness.ts:44-47`:
```ts
} catch (err) {
  if (err instanceof Error && err.message.startsWith('Refusing to run tests against database')) throw err;
  ready = false;      // every other error → the entire file reports as "skipped"
}
```
`dbAvailable()` also calls `runMigrations()`, so a migration failure skips
silently too. In runs 2 and 3 the vanished file was `dashboardCoTotals.test.ts`
— **the before/after snapshot test the plan explicitly required for Task 4**.
I ran all six files in isolation: 6 passed / 17 tests, so no skip hides a
failure — but "the suite is green" is not currently meaningful. Task 10's new
`connectionTimeoutMillis: 5_000` (`db/pool.ts:22`) plausibly widens the window;
the behavior predates the batch.
**Fix:** have `dbAvailable()` rethrow anything that is not a connection
refusal.

### B4 — Permanent false "unsaved changes" prompt (Task 11 + Task 7)
`bid_estimates.overhead_pct` is `numeric` and there is **no `setTypeParser`
anywhere in `backend/src`**, so `pg` returns it as the string `"22.00"`. The
pre-existing bid_estimates hydration (`PcWorkspace.tsx:734-737`) sets
`overheadPct: savedEstimate.overhead_pct` — the string — and the dirty check at
`PcWorkspace.tsx:562-566` compares against that same string, so it stayed
consistent. Task 11's new hydration does not:
```ts
set({ overheadPct: workspaceRow.overhead_pct != null ? Number(workspaceRow.overhead_pct) : 10, ... });
```
(`PcWorkspace.tsx:763`). When the new `/preconstruction/:bidId/workspace` GET
wins the race against `/estimates/:id` — both gate on the same `isPristine`,
whichever resolves first wins — `ws.overheadPct` is the *number* `22` while
`savedEstimate.overhead_pct` is `"22.00"`, so `pricingDirty` is `true` forever
with zero user interaction. Task 7 then makes it worse: the workspace is now
mounted on **every** hub tab, so `useUnsavedGuard` fires from Overview too.

**Failure:** Jake opens a bid he previously autosaved pricing on, looks at
Overview, navigates away — confirm dialog; refreshes — `beforeunload` prompt.
Every time. This is the "noise the user learns to click through" that
`useUnsavedGuard.ts:8-11` warns about, and it will train him to dismiss the
prompt that protects real unsaved work.
**Fix:** `Number()` both sides of the comparison (or add a `setTypeParser` for
`numeric` once, backend-wide). One-line change; add a test at the guard.

**Related risk:** both hydration effects `set()` after mount, changing the
autosave snapshot (`PcWorkspace.tsx:524-541`) and scheduling a PUT.
`BidHubPage.tsx:122` passes `ws={pcData[bid.id] ?? blankWorkspace(...)}` and
`App.tsx:275` does not gate first paint on `/preconstruction/workspaces`, so if
that list is slow or failed the PUT writes `notes:''`, `scope:{}`, `rfis:[]`,
`files:[]` over a real row (full-row upsert, `preconstruction.ts:1351-1382`).
Pre-existing, but Task 7's eager mount widens it from "clicked Estimating" to
"opened any bid". Not reproduced at runtime — gating the render on
`pcData[bid.id]` closes it cheaply.

## 3. Non-blocking

- **Reopened items never re-notify.** The key is now `followup:<id>:<uid>`
  forever and nothing deletes notifications on task completion or lead
  re-activity (only `bids.ts:747`/`gens.ts:714` purge, plus retention). A task
  that closes and reopens — or a lead worked and then gone quiet again — gets
  **no** new notification until the row ages out (60/180 d). Plan-mandated, but
  unmentioned in the report. Follow-up: delete the dedup row when the item
  leaves the reminder condition.
- **Report's retention row counts are inverted.** It says "0 read past 60 d, 518
  unread past 180 d"; the live DB has **518 read >60 d, 0 unread >180 d**.
  Duplicate groups are 169, not 148.
- **Task 6's payload win is ~zero.** No frontend code calls `GET /bids` at all;
  `App.tsx:129` fills `bids` from `/dashboard`, still `SELECT b.*`, still
  shipping `notes`/`signature_data` on every app load. The drop is safe
  (verified: `Bid` type has neither, no read anywhere, both PATCH call sites
  enumerate fields) but optimizes a dead endpoint.
- **`bidAttachments` budget diverges on fetch failure.** `bidAttachments.ts:112`
  charges `doc.file_size` in pass 1; if the pass-2 fetch then fails, that budget
  is never reclaimed (the old code never charged it), so a later attachment can
  be dropped that previously fit. `skipped[]` ordering also changed. Identical
  on the happy path.
- **`SearchBox` fires one `/leads` request per keystroke** (no debounce, unlike
  DocsPage's 300 ms) and can briefly render results for the previous prefix.
- **`useGlobalPcCache` drops `useApi`'s error handling.** A 500 on
  `/estimates/unit-costs` now silently yields an empty library (every line
  prices at $0) with no `reportError` and no retry for the life of the mount.
- **`limit` is lower-bounded only** (`documents.ts:86`, `leads.ts:478`): no
  upper clamp. `q` is correctly parameterized in both — no injection — but
  `%`/`_` in user input are unescaped ILIKE wildcards.
- **The dashboard's regex guard is not a reliable guard.** `dashboard.ts:30`
  relies on `wj.proposal_id ~ '<uuid>'` running before `wj.proposal_id::uuid`;
  Postgres does not guarantee clause order. Harmless today: 0 of 9 live
  `won_jobs` rows are non-uuid.
- **`findSoffice()` returns null under `NODE_ENV=test`** (`verifyBid.ts:236`) —
  product code gated for tests; the PDF-conversion path is now exercised by no
  test at all. The plan asked for a *visible skip*, not a global disable.
- **`settingsInternalKeys.test.ts` `afterAll` deletes `jwt_secret`** from shared
  `app_settings` — safe only because tokens never cross worker boundaries.
- **`vitest.config.ts`**: comment says "20s", value is `45_000` — generous
  enough to hide a hang. Slowest files: `poolStatementTimeout` 15.2 s (by design,
  `pg_sleep(20)`), `integration` 9.8 s, `intakeSimilarCache` 8.0 s,
  `bidStandardGeneration` 2.6 s. Nothing else over 2 s.

## 4. Per-task

| Task | Verdict |
|---|---|
| 1 Flakes | Root causes fixed (soffice lock, `app_settings` leak, fixture window) — real, no `.skip`/retry/timeout-widening on the five named files. **But B3.** |
| 2 Notifications | Correct. `ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL` correctly matches the *partial* index `notifications_dedup_idx` — a bare `ON CONFLICT (dedup_key)` would have errored. `UNNEST` batch preserves per-user rows; `RETURNING dedup_key` drives the digest. Windows exactly 60/180 d, only on `notifications`. |
| 3 Intake retention | Correct. `intake_items_status_check` on the live DB allows only `pending/accepted/declined` — the plan's guessed names don't exist; executor used the real terminal ones and never purges `pending`. |
| 4 Indexes + dashboard | Correct. No `CONCURRENTLY`; all 14 referenced columns exist; `docs_linked_idx`/`doc_linked_idx` byte-identical in `pg_indexes`. Snapshot test runs the verbatim pre-fix SQL as an oracle; old-vs-new on the live DB differs in 0 rows. `::uuid` in-query, no retype. |
| 5 Server filters | **B1.** Otherwise: `q`/`category`/`limit`/`linked_id` parameterized; `/comms` scoping preserved (the OR-arm was correctly parenthesized before the new `AND`). |
| 6 Bids list | Safe. Exactly `notes` + `signature_data` dropped (46 of 48 columns retained, verified against live `\d bids`); no frontend or backend read. See non-blocking. |
| 7 Mounted workspace | **B2 + B4.** Mount/hidden is correct (`key={bid.id}`, exactly one instance at a time — no unbounded memory growth). Autosave's no-op guard holds for a *clean* workspace; it does not for one that hydrates from either pricing source. |
| 8 Brief cache | Correct. Keyed `${scope ?? 'all'}:${useGraph}` — a rep's id never collides with `'all'`, so no cross-scope leak. 90 s TTL, in-flight collapse, rejections not cached. |
| 9 Attachments + similarity | Same attachment set on the happy path (see non-blocking edge). The `Date`-precision fix is real and verified: `intake.ts:106` casts `max(updated_at)::text` in SQL. |
| 10 Pool | `max: 20`, idle 30 s, connect 5 s, `statement_timeout: 15_000`. Migrations share this pool — checked, none is near 15 s (largest is 096 over 5,052 rows). |
| 11 Pricing autosave | **B4.** PUT/GET round-trip the three fields; payload and dep array both include them; only one PUT caller exists (`PcWorkspace.tsx:497`), so no wipe-by-omission. Original 10 tests intact (10 → 13). Estimate math untouched. The two hydration sources race and the loser is overwritten, so a draft-only pricing edit is not reliably the one that survives a reload. |
| 12 file_data | `storeDocument.ts:133-137` already gated on `!storageUrl`; serve path prefers `storage_url` with a `file_data` fallback, tested both ways plus a neither-set 404. |
| Scope | `git diff --stat main..HEAD -- frontend/` = exactly the 8 authorized files. **No extras.** |

## 5. Migration impact (live `electrical_crm`, read-only SELECTs)

| Migration | Changes | Live rows affected | Idempotent |
|---|---|---|---|
| 096 | index `notifications(created_at)`; collapse duplicate `followup_due`/`lead_overdue`/`bid_due_soon` per `(type, link_id, user_id)`, keeping newest | **deletes 4,866**, keeps 169 groups (of 5,052 total rows) | Yes — `rn > 1` is empty on a second run |
| 097 | 9 `CREATE INDEX IF NOT EXISTS`; `DROP INDEX IF EXISTS docs_linked_idx` | 0 rows; 1 duplicate index dropped (definitions verified identical) | Yes |
| 098 | `bid_workspaces` + `overhead_pct`, `profit_pct`, `estimate_overrides jsonb DEFAULT '{}'` | 0 rows (no rewrite on PG11+) | Yes — `ADD COLUMN IF NOT EXISTS` |
| 099 | `file_data = NULL WHERE storage_url IS NOT NULL AND file_data IS NOT NULL` — backfill only, as authorized | **0 rows** (2 of 65 docs have `file_data`, 63 have `storage_url`, 0 have both) | Yes |
| *(not a migration)* `purgeExpired`, 30 s after boot then hourly | notifications 60/180 d + terminal `intake_items` 180 d | 518 read notifications; 0 unread; 0 intake_items | n/a |

Net on first boot: notifications 5,052 → ~170. Every deletion is inside what
Tasks 2 and 3 authorize; no other table is touched. Migrations share the
15 s-`statement_timeout` pool — none is close (096's is the largest, 5,052 rows).

## 6. Tests measured

- Backend: 3 runs, all exit 0 — 808/12, 815/5, 803/17 skipped (820 collected).
- Typecheck exit 0 both packages. Frontend: 60 files / **459 passed / 0 failed**.
- 6 previously-skipped files run in isolation: 6 passed / 17 tests.
- Live-DB dashboard old-vs-new: 26 = 26 rows, 0 differ in either direction.
- `git status --short` empty; nothing edited, no commits, nothing written to
  `electrical_crm`.

## 7. Could not verify

- How often Jake searches DocsPage by project name (B1's blast radius) — the
  code path is unambiguous, the usage frequency is not.
- Anything at runtime (no dev server): B2 and B4 are read off unambiguous
  dependency arrays and type comparisons; B4's blank-workspace PUT wipe is a
  reachable code path I could not time in a browser.
- The report's Task 1 run totals (764/767/771 of 781) — they predate later
  commits and cannot be reproduced on the final tree.
- The ~11,000-row test-`users` bloat: it is in the *test* DB, which I did not
  query. Consistent with the observed slowness; does **not** block (production
  has ~2 users). The gens signed-contract dual-storage gap is real (two direct
  `INSERT INTO documents` in `gens.ts` bypassing `storeDocument`), out of Task
  12's scope, does not block.

---

# Re-review — six post-review commits (`b2bb335..HEAD`)

## Verdict: **MERGE AFTER FIXES** — one blocking item

B1, B2 and B4 are properly fixed with real tests, and B3's harness fix works —
**zero silent skips in all three runs**. But the *new* test B3 added to prove
the soffice path is exercised is itself flaky and turned the suite red in 2 of
my 3 runs.

## Blocking

### R1 — the new soffice test fails 2 runs in 3; `npm test` exits 1
`backend/src/bidstd/verifyBid.test.ts:288`
```ts
const result = await verifyBidDocx(buf, { kind: 'gc' });
expect(result.pass).toBe(true);
expect(result.pdf).toBeTruthy();      // ← AssertionError: expected undefined to be truthy
```
Run 1: exit 0, 830 passed, **0 skipped**. Runs 2 and 3: **exit 1**, 1 failed /
829 passed — this test both times.

`convertToPdf` (`verifyBid.ts:245-259`) returns `null` by design when the
conversion fails, and it fails when LibreOffice's single user-profile lock is
contended — precisely what happens when parallel workers hit `generate-docx`
together. That contention is the original Task 1 root cause; the new test
asserts it can never happen, re-importing the flake as a hard failure.

**Fix:** give each conversion its own profile —
`-env:UserInstallation=file://<tmpdir>` in the `execFileAsync` argv at
`verifyBid.ts:250` (also a production robustness win) — or run this test
serially. Do not weaken it back to `if (result.pdf)`.

## Verified fixed

- **B1** — `documents.ts:79` now `(name ILIKE $n OR display_name ILIKE $n OR
  linked_name ILIKE $n)`, with a real test (`documentsListFilters.test.ts:52`,
  asserts every returned row carries the marker and the unrelated row is
  excluded).
- **B2** — `resetGlobalPcCaches()` (`PcWorkspace.tsx:81-86`) clears both caches
  *and* fires a subscriber set, so mounted instances bump a `gen` counter and
  refetch; `UnitCostSection.tsx:76` calls it in the save's `onSuccess`, and it
  is the only Settings save touching either endpoint (`/preconstruction/costs`
  is derived from awarded jobs). A window-`focus` handler covers a second tab.
  `PcWorkspaceGlobalCache.test.tsx` asserts a rendered price moves 20 → 50 after
  the save. The failure path calls `reportError`, keeps stale data rather than
  resetting to an empty library, and retries every 5 s.
- **B3 (harness)** — `harness.ts:12-20` rethrows unless the error is
  `ECONNREFUSED/ENOTFOUND/EHOSTUNREACH/ECONNRESET` or pg-pool's connection-timeout
  message; confirmed by outcome (0 skipped, three runs). `migrationsDirOverride`
  defaults to the same path, `index.ts:189` passes no argument, and the only
  override caller is `migrateDestructiveGuard.test.ts` — production unchanged.
- **B4** — `Number()` on both sides at `PcWorkspace.tsx:612-613` and in both
  hydration branches; the two effects are merged into one with a documented
  estimate-first / workspace-if-strictly-newer rule.
  `PcWorkspacePricingDirtyGuard.test.tsx:109` asserts no guard and a successful
  navigation after hydrating from numeric strings. `pcDataLoaded`
  (`App.tsx:396` → `BidHubPage.tsx:44`) gates both the blank-workspace seed and
  the mount, so no PUT fires before the list settles. **Probe answered:** a new
  bid is not blocked — once `workspacesApi.data !== null` the seed effect
  (`BidHubPage.tsx:57-62`) writes a `blankWorkspace` and the workspace mounts.
  On a *failed* fetch it stays on "Loading workspace…", but `App.tsx:282`
  surfaces a partial-failure banner with a reload — recoverable, not a dead end.
- **5a** — `SET statement_timeout = 0` before `BEGIN`, reset to the shared
  `STATEMENT_TIMEOUT_MS` in `finally` before `client.release()`
  (`migrate.ts:89-103`); `pg_sleep` migration test present.
- **5b** — `clampLimit` caps at 200; `escapeLikePattern` escapes `\ % _`. No
  `ESCAPE` clause is declared, but Postgres's default LIKE escape is backslash —
  verified on the live DB: `'50% Electric' ILIKE '%50\%%'` → `t`, `'50X Electric'`
  → `f`, `'axb' ILIKE '%a\_b%'` → `f`.
- **5c** — 300 ms debounce on SearchBox's `/leads` params.
- **5d** — the pre-filter now only drops individually-oversized docs; the
  cumulative total is charged solely on a successful fetch that fits, and
  `skipped[]` is rebuilt by walking `meta` in original order.
- **5e** — `CASE WHEN … THEN wj.proposal_id::uuid END = b.id`. Re-ran old-vs-new
  on the live DB: 26 = 26 rows, **0 differ either way**.
- **5f/5g** — global 30 s with per-test overrides; the reopen-notify limitation
  is documented at `engine.ts:98-110`.
- **Report counts** match my SELECTs exactly: 518 read >60 d, 0 unread >180 d,
  169 duplicate groups, 4,866 deletes, 099 = 0 rows. Typecheck exit 0 both
  packages; frontend **466/466**; `git status --short` empty.

## Non-blocking

- **The newer-wins rule is defeated by async ordering.** The merged effect
  (`PcWorkspace.tsx:790-836`) returns early when `!isPristine`, so whichever of
  `savedEstimate` / `workspaceRow` resolves *first* hydrates and the other is
  never compared — the rule only applies when both land before the first
  hydration. The dirty-guard bug is fixed regardless; Task 11's "draft
  survives" guarantee is not. Gate on both having settled.
- `pcDataLoaded?: boolean` defaults to `true` — a future caller that omits it
  silently gets the unsafe pre-fix behavior. Prefer required.
- `ECONNRESET` in `UNREACHABLE_DB_CODES` also matches a reset *mid-query*, which
  is not "no database".
- `migrate.ts:60-70` now skips a vanished migration file with a warning in
  production too; harmless, but it softens a real failure mode for a test-only
  race.
- 5d fetches `file_data` for every individually-sized-OK document, including
  ones that later overflow the cumulative budget — correctness restored at a
  small cost to Task 9's saving.
- `dashboardCoTotals.test.ts`'s malformed row uses `Date.now()` for uniqueness
  and never cleans up; collision risk negligible, but it leaves a junk
  `won_jobs` row per run.
- Six frontend files outside the plan's original Task 5/7/11 scope
  (`App.tsx`, `types/index.ts`, `UnitCostSection.tsx`, three test files) —
  justified by the fixes, but worth recording.

---

# Final pass — round 3 (`51b5a50..HEAD`: 3a0928b, 8dbd1bf, a441ccd)

## Verdict: **MERGE**

R1 is fixed and the suite is now genuinely green. No blocking findings; nothing
new introduced.

**1. soffice profile isolation — fixed.** `verifyBid.ts:257-262` passes
`-env:UserInstallation=file://${profileDir}` where `profileDir` is
`path.join(tmpDir, 'profile')` and `tmpDir` is the per-call `fsp.mkdtemp`.
Cleanup is the existing `finally { fsp.rm(tmpDir, { recursive: true, force: true }) }`,
so the profile goes with it on success, on a thrown conversion, and on timeout.
No extra cleanup path needed, and none missing.

**Three backend runs, all exit 0:**

| run | passed | failed | skipped |
|---|---|---|---|
| 1 | 830 | 0 | 0 |
| 2 | 830 | 0 | 0 |
| 3 | 830 | 0 | 0 |

99/99 files in every run. The previously flaky
`verifyBid.test.ts` PDF assertion passed all three times. The stack traces in
run 2's log are logged output from negative-path tests (503/500 assertions,
`Graph auth is muted under test`), not failures.

**2. Hydration arrival order — fixed and genuinely covered.**
`PcWorkspace.tsx:824` now short-circuits on
`if (savedEstimateLoading || workspaceRowLoading) return;`, and the estimate
branch reads `savedEstimateData` (the raw `useApi` value) rather than the
`savedEstimate` state that lags one render behind. Deps updated to
`[savedEstimateData, workspaceRow, savedEstimateLoading, workspaceRowLoading]`.
The two new tests in `PcWorkspacePricingDirtyGuard.test.tsx` stagger the two
responses with real `setTimeout` delays and assert the rendered Overhead %
input, not internal state: workspace-first-but-older → `'22'` (estimate wins);
workspace-last-but-newer → `'30'` (workspace wins). Both orders covered, and
both fixtures use numeric strings (`'15.00'`, `'20.00'`), so they also keep the
B4 type coercion honest. Newer-wins now holds regardless of arrival order.

**3. `pcDataLoaded` — required.** `BidHubPage.tsx:45` is `pcDataLoaded: boolean`
with no `?` and no default in the destructure (`:49`). Both callers pass it:
`App.tsx:396` (`workspacesApi.data !== null`) and `BidHubPage.test.tsx:66`.
Typecheck enforces it for any future caller.

**4. Scope.** `git diff --stat 51b5a50..HEAD` = exactly 6 files: `verifyBid.ts`,
`dashboardCoTotals.test.ts`, `BidHubPage.tsx`, `PcWorkspace.tsx`,
`PcWorkspacePricingDirtyGuard.test.tsx`, and the report. Nothing else touched.
The `dashboardCoTotals` `afterAll` now deletes the malformed `won_jobs` rows it
inserts, closing the last non-blocker.

**Verification:** typecheck exit 0 in both packages; frontend **468/468** (63
files); `git status --short` empty — no edits, no commits, nothing written to
`electrical_crm`.

All prior blocking findings (B1–B4, R1) are resolved. The remaining items from
earlier rounds are the documented, deliberate ones: the reopen-notify
limitation (`engine.ts:98-110`), test-DB hygiene, and the gens signed-contract
dual-storage gap — all follow-ups, none blocking.
