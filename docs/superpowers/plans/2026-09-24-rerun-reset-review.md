# Re-run Reset / Analysis Inputs / Stop Analysis: Adversarial Review

**Branch:** `fix/rerun-reset`, reviewed range `cc486ce..08f46dd`: 7 commits, migrations 121–123.
**Reviewer:** Opus 5 (independent, read-only)
**Date:** 2026-09-24

**Verdict: MERGE AFTER FIXES.** Two blockers. Both are cases where the reset or the re-bind silently changes the estimator's own numbers. Each is a small, local fix.

## Verification

| Check | Result |
|---|---|
| Merge onto current `main` (d388c08) | **Clean.** `git merge-tree --write-tree main 08f46dd` exits 0. b08aa59 and acfc2bc have the same `git patch-id` (667b5d3…), so the pdf.js fix merges as a no-op. |
| `tsc --noEmit` backend / frontend | clean / clean (at 3299c56, and again at 08f46dd) |
| Backend `npm test`, runs 1–2 (at 3299c56) | 1462 passed, 10 failed, 32 skipped; then 1500 passed, 5 failed (of 1508–1509) |
| Backend `npm test`, run 3 (at 08f46dd) | 1500 passed, 5 failed (1509) |
| Frontend `vitest run`, runs 1–3 | 1239/1239; 1238/1239 (`ElecProjectsSaveSection`); 1238/1239 (`SurveyMarkupEditor`), which includes the 08f46dd tests |
| Backend on `main` d388c08 (baseline, temp worktree) | 1468 passed, 9 failed. The failures are the same kind: intake ×4, integration ×3, `aiCountMarkers` re-run, `jobNumberCollision`. |

**How the failures were classified.** None is an assertion regression.

- **"sorry, too many clients already".** Every backend run on the branch hit this; the main baseline run didn't. Postgres allows `max_connections` = 100. The branch has 147 test files against main's 145, and each worker opens a pool of up to 20 connections.
- The new transaction helpers (`beginAnalysisRun`, `loadScopeSnapshot`) release their client in `finally`. No handle is held across a run: `registerRun` handles are AbortControllers, not DB clients.
- **Connection-exhaustion failures:**
  - `fixRound2` S-R2-1 failed in all 3 runs, always with the connection error at `getSetting`.
  - `estimatingMarkups`, `estimatingSheetsRoutes`, `estimatingBid` and `dashboardCoTotals` failed once each.
  - All four files together passed 108/108 alone, twice.
- **Known flakes:**
  - `intakeSimilarCache`
  - the `integration` backfill timeout and the `integration` soft-delete test
  - the `notificationsRetention` worker crash
  - frontend `SurveyMarkupEditor` and `ElecProjectsSaveSection`, which also fail on `main`
- Consider lowering the pool's `max` under `NODE_ENV=test`, or capping vitest workers, so the suite stops tripping `max_connections`.

**How the repros ran.** Supertest and SQL repros ran against `electrical_crm_test`, only after the full suites had finished, in throwaway detached worktrees that were then removed and pruned. There were no Anthropic, Drive or email calls, the eval was not run, and Local Version was not touched.

---

## Blockers

### B1. A kept (estimator-edited) line re-binds to a different item by key alone, then double counts [reproduced]
- **Where:** `backend/src/estimating/bidEstimate.ts:636-638`.
  - The third pass, `bindPass((l, i) => keys[i] === l.takeoff_key)`, binds on the key alone. The key is `category||item` (`:481-483`), and Agent 2 renumbers `item` on every run.
  - `descMatch` requires exact normalized equality, so "Duplex receptacle" vs "Duplex receptacle, 20A" fails passes 1 and 2 and falls through to pass 3.
- **Repro:**
  - Kept line: "Duplex receptacle", key `Power||6.1`, qty 34 (overridden), material $9.50.
  - New run: 6.1 is "GFCI receptacle, weather-resistant" and 6.4 is "Duplex receptacle, 20A" at qty 30.
  - The kept line becomes the GFCI item at qty 34 and $9.50. A fresh duplex line is added at 30, so duplex is priced twice.
  - The sync reports `rebound=0, unbound=0` and writes the estimate and `bids.amount` from these lines. The only sign is the generic re-check badge.
- **Fix:**
  - Drop the key-only pass. Or accept it only when the descriptions nearly match: token overlap ≥ 0.8, or one contains the other after normalization.
  - Never overwrite a kept line's description from the row it binds to.
  - Report a carried line that is still unbound after the description passes as `unbound`, and warn in the Bid Summary.
  - Add this exact case as a test.

### B2. A typed bid amount is nulled [reproduced]
- **Where:** `backend/src/services/rerunReset.ts:151-158` nulls `bids.amount` whenever a saved estimate or an Agent 4 price existed. It never compares values.
- **Repro:** estimate 23,173, amount then typed as 25,000, re-run → `amount` is NULL.
  - An amount confirmed through import-bid is lost the same way.
  - The confirm shows the estimate total (`savedGrandTotal ?? bidAmount`, `rerunReset.tsx:73`), not the typed amount that is about to disappear.
- **Why it's a blocker:** this is the exact question the review was asked ("only nulled when derived?"), and the answer is no. The amount is the bid's price on the dashboard and in the pipeline.
- **Fix:**
  - Null it only when `amount` equals, to the cent, the saved estimate's grand total or the previous `agent4_price`. Otherwise keep it and list it under Kept.
  - Show the actual `bids.amount` in the confirm.

---

## Should-fix

### S1. Documents a person filed under Proposal, Takeoff or Pre-Bid are treated as CRM-generated and silently left out of the analysis [reproduced]
- **Where:**
  - `routes/preconstruction.ts:2173` and `:2266` exclude on `generated = true OR category = ANY(GENERATED_OUTPUT_CATEGORIES)`.
  - `frontend/.../PcWorkspace/shared.ts:33-35` does the same.
  - Users can choose these categories in `RecordFiles.tsx:26-40`, and import-bid and import-prebid file human uploads under them.
- **Repro:** user-filed PDFs in `takeoff` and `proposal` were both excluded as "generated", so nothing was sent. The Files tab badges them "Generated by the CRM".
- **Fix:** exclude only when `generated = true`. The migration-121 backfill already covers the old generated rows. Keeping `bid_data` excluded by category is safe.

### S2. A re-run doesn't abort the previous run's in-flight AI calls, so they keep billing [reproduced]
- **Where:**
  - `/analyze` (`routes/preconstruction.ts:~2366`) calls `beginAnalysisRun` but never `abortRuns`. Only the stop route does.
  - The counter's `shouldStop` (`:~1084`) checks only the in-memory signal, so a superseded run keeps launching Opus sheet calls until every sheet is done (about $2–3.50) and then discards them.
  - A superseded Agent 4 or draft call also runs to completion. Its write is refused, but it is still billed.
- **Fix:**
  - After `beginAnalysisRun` commits, call `abortRuns(bidId, ['analysis','draft','agent4'])`. The new run registers later, so only old controllers are hit.
  - Also make `shouldStop` true once the run is superseded.
  - Optionally return 409 from `/analyze` while a run is in progress. A double-click today runs two resets and two pipelines; that's safe, thanks to the run-id guards, but paid.

### S3. Stopping "analysis" just after it finished silently kills the pre-bid draft and strands the page [reproduced on the backend; frontend part reasoned]
- **Where:** the end-of-pipeline draft runs under the analysis client (`:~1239`) after `status='complete'`.
- **What happens:** `{what:'analysis'}` at that moment returns 200 with `stopped` all false and `aborted: 1`.
  - The draft vanishes: status, error and output are all empty.
  - The `checkpoint()` after it skips the scope/materials write, the project_type/sq_ft auto-fill and the Drive scope JSON.
  - The frontend (`PcWorkspaceView.tsx:~1205`) stops polling on the 200 and shows "Stopped", so `aiDone`, the scope fill and the panel refresh never happen.
- **Why it's likely:** the confirm dialog is often still open when the run finishes.
- **Fix:**
  - Abort only when the DB update actually cancelled a running analysis.
  - Give the end-of-pipeline draft its own `draft` handle.
  - In the frontend, when `stopped.analysis` is false, keep polling or apply the "complete" handling instead of showing "Stopped".

### S4. The Scope of Work is wiped wholesale, including hand-typed sections [reasoned]
- **Where:** `rerunReset.ts:169` sets `scope = '{}'`.
  - Scope sections are editable textareas (`ScopeTab.tsx:67`), and they're also filled from the pre-bid package and from imported bids.
  - Main's frontend already cleared scope on re-run, so this isn't new behaviour. But the report now calls it "AI-derived", and it moved to an atomic server-side delete.
- **Fix:**
  - Clear only sections still identical to what Agent 2 produced.
  - Keep edited sections and flag them "from previous run — re-check".
  - At minimum, say "including sections you edited" in the confirm.

### S5. An imported AI RFI the estimator rewrote (but hasn't sent or answered) is deleted [reasoned]
- **Where:** `rfiIsAi` (`rerunReset.ts:63-74`) decides origin from the import id's shape or a text match. An edit never flips the origin to `manual`.
- **Fix:** set `origin: 'manual'` when an RFI's question is edited in the UI. Also consider keeping any AI RFI that has notes.

### S6. With unsaved Plans markup, the Plans view stays stale through the whole re-run [reasoned]
- **Where:** `refreshPanels` (`PcWorkspaceView.tsx:1183-1185`) skips remounting Plans while there is unsaved markup, both after the reset and at the end of the run.
  - The server has already soft-deleted the suggested AI markers and cleared the untouched lines, so new markers can be tied to lines that no longer exist.
  - The confirm warns about unsaved pricing edits but not about unsaved markup.
- **Fix:** save the Plans markup before posting `/analyze`, the same way the workspace autosave is flushed. Or list unsaved markup in the confirm and remount Plans after saving.

---

## Nits

- **N1.** When two new rows in one category share a description, a kept line takes the first unclaimed one (`bidEstimate.ts:630`). Break ties on qty or unit.
- **N2.** "Superseded, never deleted" isn't fully true. `storeDocument`'s `replaceExisting` (`utils/storeDocument.ts:~153`, used by import-bid and import-prebid) hard-deletes every document in that category, including generated or superseded ones. This predates the branch. Limit that delete to `generated = false`.
- **N3.** Review answers are cleared on every re-run (the report's open question 1), including power-pole furnish/install answers and "not on this job" reasons. The comment above `beginAnalysisRun` in `/analyze` still says resolutions carry over. Fix the comment, and decide on carrying over answers for unchanged items.
- **N4.** Agent 4 can start after a stop. `agent4_status='running'` is set and the response sent before `registerRun` (`:2533-2556`). A stop in that window cancels in the DB, but the call is still billed; only its write is refused. Register before responding, or re-check the status just before the call, as the draft does.
- **N5.** `isCancellationError` (`runControl.ts:29`) matches `/Abort|aborted/i` on any error, so a real error whose message says "aborted" is treated as a stop: it isn't retried, and the status is left at e.g. `agent2_running` with no error. Only count `RunCancelledError`, the SDK's `APIUserAbortError`, or a signal that is actually aborted.
- **N6.** The retry backoff (`retry.ts`) doesn't wake on abort, so a stop during a backoff waits out the delay. Harmless.
- **N7.** 08f46dd: `inputDocumentIds` maps an upload to the bid's newest non-generated document with the same hash. It is recorded best-effort (`.catch` → warn), and the frontend pre-ticks only eligible PDF/image documents, once per run, only when nothing is selected. This is fine. Note that S1 also affects it: a user-filed "Takeoff"-category plan is never pre-ticked.
- **N8.** The test suite now trips Postgres `max_connections` under full load (see Verification).

---

## Verified OK

- **Atomic with run creation.** The `takeoff_results` row lock (`FOR UPDATE`), the new run id, every clear, and the `reset_summary` all run in one transaction that rolls back on error. The rollback is tested with a sabotage trigger.
- **A failed start changes nothing.** No usable files, no API key, no permission and no bid access all return before `beginAnalysisRun`. Failures after the commit are caught by the pipeline.
- **Estimator line and marker work is kept:**
  - qty, material and labor overrides; markup or manual qty; manual matches; deliberate exclusions (`TOUCHED_TAKEOFF_LINE_SQL`);
  - a UI qty edit always sets `qty_overridden`;
  - confirmed markers are kept, and markers on deleted lines become unassigned (not deleted);
  - manual lines, notes, the scope list and overrides, `est_bid_settings`, account rules and `manual_count_targets` survive.
  - Deleting `bid_estimates` loses nothing typed: it is a snapshot recomputed from the lines and settings on the next save.
- **Documents.** The reset flags only `generated = true` rows in the output categories. Nothing new deletes a document. `loadMostRecentBidDoc` skips superseded files, so they are never attached.
- **Migration 121** only adds columns plus the backfill, and the RFI backfill leaves existing origins alone. 122 and 123 are additive.
- **Stop analysis:**
  - SDK 0.100.1 `messages.stream(body, { signal })` wires the signal into the stream's controller, and `finalMessage()` rejects on abort.
  - `abortableClient` passes the signal as the request option and merges it with any caller signal (`AbortSignal.any`).
  - Every model call in a run goes through the wrapped client: the classifier, Agent 1 single and batched, the counter, Agents 2/3, the draft and Agent 4.
  - Aborts are never retried, and the counter launches no new sheet once stopped.
  - Every write checks the run id and that the status isn't cancelled: the counting transaction, the marker writer, draft, Agent 4, `bids.amount` and the error write.
  - The stop route requires `run_analysis` and bid access (403 tested) and returns 409 when nothing is running.
- **Frontend:**
  - The functional `set()` makes two same-tick updates compose.
  - `rerunAI` flushes a pending autosave before posting, so the cleared RFIs can't be PUT back.
  - The poller ignores stale loops, handles `cancelled`, and reconnects on load.
  - Labor & Pricing reloads after the reset and keeps unsaved edits when the run ends.
  - The review, scope list and pre-bid panels remount.
- **Duplicate inputs** (the same document twice, or the same bytes twice) are sent once, and the Project Files copy wins. The name+size fallback applies only to generated documents without a stored hash, so a real plan isn't excluded that way (S1 is the real exclusion problem).
