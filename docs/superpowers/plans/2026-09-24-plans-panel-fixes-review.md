# Plans panel fixes — independent review

**Range:** `76d5539..792c1c2` (branch `fix/plans-panel`, migration 146) · **Reviewer:** Opus · **Date:** 2026-09-25
**Scope:** blockers and regressions only.

**Verdict: NOT READY. One blocker.**
- The new `spec` discipline has no deterministic guard, and it takes a page out of analysis.
- Remove, dedupe and the friendly errors are sound. Their should-fixes are cost and consistency issues around Replace / Undo.

## How this was checked
- **Code:** I read the full diff and the report.
- **Real crops:** I rendered the real Kissimmee right-25% title-block crops (the classifier's actual input) for C0.1, C0.2, E-1 and E-3.
- **Scratch route test:** a DB-backed test in a temporary worktree (since removed) against `electrical_crm_test`, with a mocked Anthropic that counts job-profile calls. It covered replace, the shared-row write, Undo and scope. It left a few `PP …` bids in the test DB only.
- **Author's suites:** 60 targeted backend tests, 43 bid-hub frontend tests, and `tsc` for both, all passing.
- No real model call was possible, so the classifier findings are reasoned from the code and the real crops.

## Blocker

**B1. A plan sheet can be classified `spec` and silently leave analysis and counting. Nothing guards against it except the prompt.**
- **Where:** `ai/pageClassifier.ts:43,58,65`, `ai/prompts.ts:421`.
- **How a page drops out:**
  - `spec` is a valid classifier output. It is not in `SELECT_DISCIPLINES`, so `applySelection` (`services/sheetCheck.ts:186-192`) marks the page `excluded`.
  - `/analyze`'s own selection (`routes/preconstruction.ts:438-448`, `selectPages`) drops it from what Agent 1 reads.
  - `shouldDropWholeFile` can drop the whole file when every page is `spec` and the file name doesn't read as electrical.
  - The only thing stopping an E-sheet from landing there is the prompt wording ("no title-block sheet number").
- **What the classifier actually sees:** image crops of the right 25% strip, and those strips are text-heavy.
  - Kissimmee **E-1**'s crop is mostly dense running notes ("WORK INCLUDED: A. CONDUIT, WIRES… SERVICE ENTRANCE, ELECTRIC AND TELEPHONE… PANELBOARDS: A. INSTALL…") above the title block.
  - **E-3**'s crop is a notes paragraph plus a long "REMARKS / MOUNTING" table.
  - Typical high-risk sheets: "E-0.1 ELECTRICAL GENERAL NOTES & SPECIFICATIONS", or specs printed on the drawings with "26 05 00 / PART 1 - GENERAL" headings. These match the prompt's `spec` description almost word for word (section numbers, PART 1 - GENERAL), even though they carry a sheet number.
  - A `cover` general-notes sheet (in `SELECT_DISCIPLINES` today) is exposed in the same way.
- **The prompt change also busts `sheet_page_cache` for every bid**, so every existing plan set is reclassified on its next check. A sheet that was `electrical` last week can come back `spec` and silently leave a re-run's analysis.
- **The report doesn't mention any of this.** It describes `spec` only as a summary-count change, not as "spec pages are excluded from analysis".
- **Fix (small, deterministic):** after parsing, when the classifier says `spec`:
  - If the page has a sheet number (`normalizeSheetId(sheetNo)` is not null), map `spec` to the discipline that sheet's prefix implies (E / FA / T / LV → electrical / lowvoltage, and so on), else to `cover`.
  - If the title matches `ELECTRICAL|POWER|LIGHTING|PANEL|SPECIFICATIONS` together with an E-series number, keep it `electrical`.
  - Only a page with **no** sheet number may stay `spec`.
  - Add tests with crops or inventory rows for "E-0.1 ELECTRICAL SPECIFICATIONS" and a Division 26 notes sheet.
  - State in the report that `spec` pages never reach Agent 1.

## Should-fix (not blocking)

**S1. Replace makes one billed job-profile call per old file, and reads a mixed set in between.** Reproduced.
- Replacing a 3-file set made **3 job-profile model calls** (one per `DELETE`), each over a mixed old+new set.
- Each `DELETE` awaits `refreshAfterPlanFilesChanged`: a sheet check plus possibly a model call, inside the request.
- Fix: a single `POST …/plan-files/replace` (or a `refresh=false` flag on the per-file DELETE) that trashes all the old files and then refreshes **once**.

**S2. Replace isn't all-or-nothing, and its Undo leaves both sets.** Reasoned from the code.
- `runReplace` (`PlansJobProfilePanel.tsx`) uploads sequentially. If upload 2 of 3 fails, the mutation errors after file 1 is already stored and nothing is trashed, so the bid now has old set + part of new with only a generic error toast.
- Old-file DELETE failures are swallowed.
- `undoReplace` restores the old files but doesn't trash the new ones, so both sets end up active. The revision-proposal flow will then block Run AI until the user answers.
- Fix:
  - On a partial upload failure, trash the new files that did upload (or say exactly which ones uploaded).
  - Report old files that couldn't be removed.
  - Make Undo trash the replacement files too.

**S3. Remove overwrites the shared `bid_sheet_check` row with a check for the full plan set.** Reproduced.
- After a remove, `input_key` is replaced even when Estimating's check was for its own selection.
- `refreshAfterPlanFilesChanged` calls `claimSheetCheck(bidId, <all plans>)`. That is exactly the shared-row overwrite the job profile was changed to avoid (R2-S6). Estimating's panel and Run AI's "Run without N sheets" skips then describe a different file set.
- Fix: refresh through the content-hash cache as `requestJobProfile` does, or re-run the check for Estimating's stored selection minus the removed file.

**S4. After Undo, the sheet summary is stale.** Reproduced.
- After restore plus `job-profile/run`, the stored sheet check still has **2** file hashes and the summary says **total 2**, while the bid has **3** current plan files.
- Undo restores the file but never refreshes the sheet check. The profile run reads the cache but doesn't claim the row.
- Fix: call `refreshAfterPlanFilesChanged` (or a restore-aware equivalent) after a plan-file restore.

## Checked and fine
- **Soft delete only.** `deleted_at` and `deleted_by = user.id` are set, and it's audited.
- **Scope.** A proposal document on the same bid returns 404 through the route (`category='plans'` filter). Another bid's plan file returns 404 (`linked_id` match). `loadAccessibleBid` applies, and `read_only` / technician / accounting get 403.
- **Undo.** The same user can restore within the window, and `canRestore` matches on `deleted_by`.
- **Refresh doesn't reset the takeoff.** Only `bid_sheet_check` and `bid_job_profile` are written, never `takeoff_results`.
- **Removed files leave the selection.** `gatherAnalysisInputs` skips deleted documents.
- **Dedupe.** It is scoped per bid (`linked_id`) and to `category='plans'` and non-deleted rows, checked before any storage I/O. A re-upload after a soft delete is stored fresh. Different bids and other categories are never deduped. Migration 146 is an idempotent partial index.
- **Friendly errors.**
  - Every Anthropic-shaped error, with a status or a body type, maps to fixed text. A raw-looking message (`{…` or `"type":"error"`) falls back to generic text.
  - The job-profile and sheet-check error columns only receive mapped text.
  - I found no path on the panel that shows a raw JSON body.

## Nits
- **N1.** `DELETE …/plan-files/not-a-uuid` returns **500** (a uuid cast error). Validate the id and return 404.
- **N2.** Rows written before this branch can still hold raw JSON in `bid_job_profile.error` / `bid_sheet_check.error` until their next run. A one-line scrub in migration 146 (or mapping the text on read) would close that.
- **N3.** The dedupe query doesn't exclude `generated` rows. That's harmless today because no generated document is filed as `plans`, but `AND NOT generated` makes the intent explicit.
