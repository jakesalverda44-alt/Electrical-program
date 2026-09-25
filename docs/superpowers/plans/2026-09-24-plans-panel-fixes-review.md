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

---

## Addendum — fix round `eb39943..fc08a97`

**Verdict: NOT READY. One blocker (a small permission hole in the new Undo route).** Everything else in the review is fixed.

**How this was checked:**
- `git diff 76d5539 fc08a97` on the classifier and selection files.
- A DB-backed scratch test in a temporary worktree (since removed) against `electrical_crm_test`, with a mocked Anthropic that can simulate the credit-balance error. It covered undo permissions, replace with an identical file, undo after other changes, and S3/S4 with a failing model. It left a few `PP2 …` bids in the test DB.
- The author's 92 targeted backend tests and 44 bid-hub frontend tests pass, and `tsc` is clean for both.

### Each finding, verified
| Item | Status | Evidence |
|---|---|---|
| **B1** `spec` discipline | **Fixed** | `ai/pageClassifier.ts`, `ai/prompts.ts` and `routes/preconstruction.ts` are **byte-identical to main `76d5539`**. The sheet-page cache key is therefore unchanged, and so are classification and `/analyze` selection. `services/sheetCheck.ts` differs from main only by (1) the friendly-error mapping and (2) an optional `specBookPage` flag. The **only reader** of that flag is `sheetSummaryOf` (grep confirms), so it can't affect `applySelection`, `selectPages`, `shouldDropWholeFile` or Agent 1. `computeSpecBookPages` never flags a page that has a sheet number, and it is text-only. At worst an unnumbered drawing in a spec-majority file is left out of the summary *count*, never out of analysis. |
| **S1** one model call per old file | **Fixed** | `POST …/plan-files/replace` trashes all the old files and then refreshes **once**. |
| **S2** replace atomicity | **Fixed** | The new files are stored first. On any failure the ones already uploaded are soft-deleted again, the old set is untouched, and a 400 names the file that failed. **Dedupe interaction:** replace passes `skipDedupe`, so a new file byte-identical to an old one is stored as its own row before the old row is trashed. Reproduced: old `{same, old2}` replaced by `{new1 = same bytes, new2}` leaves exactly `new1, new2` live. Rollback only touches rows this request created. Nit: the same file picked twice in one replace is stored twice. |
| **S3** overwriting Estimating's check | **Fixed** | The row is claimed only if it's empty, already for the new set, or still at the profile's own last `content_key`. `content_key` is written when the profile is requested, even when it reads from the cache and doesn't own the row, so a row Estimating claimed for a different selection never matches. Reproduced: a row at an Estimating subset key survives a remove. The remaining overlap: an Estimating check whose selection is the whole plan set has the same key as the profile's. That's safe, because after the removal Estimating's own inputs resolve to the same new set (deleted documents are skipped server-side). |
| **S4** stale summary after Undo | **Fixed** | Restore goes through `POST …/plan-files/:docId/restore`, which refreshes. Reproduced **even with the model failing on credits**: remove, then restore, gives summary total 3 of 3 files. The profile shows the friendly credit message, never raw JSON. |
| **N1** malformed id → 500 | **Fixed** | A UUID check returns 404 first. |
| **N2** raw JSON in old rows | **Fixed** | `sanitizeStoredError` runs on read for both the profile and sheet-check payloads. |
| **N3** dedupe could match generated rows | **Fixed** | The query now has `AND generated = false`. |

### Blocker

**PB1. `POST /:bidId/plan-files/replace/undo` has no role gate, so `read_only` can trash plan files.**
- Reproduced:
  - A `read_only` user's `POST …/replace/undo {uploadedIds:[<plan doc id>]}` returned **200** and the bid was left with **0** live plan files.
  - The same user's `DELETE …/plan-files/:id` correctly returns **403**.
  - The general `DELETE /api/documents/:id` is admin-only.
- `uploadedIds` accepts **any** plan document on the bid, not just files that request uploaded. So the route is effectively an ungated plan-file delete. Removed files then silently drop out of the takeoff inputs.
- Fix:
  1. Add the `canEditPlans` check, as the other plan-file routes have.
  2. Only trash `uploadedIds` the same user uploaded within the restore window (`uploaded_by` / `created_at`), or have the replace response return a signed undo token.

### Should-fix

**PS1. Undo of a replace half-applies when the old files can't be restored.**
- Reproduced:
  1. Replace `{old1, old2}` with `{new1, new2}`.
  2. The user removes `new2` and uploads `extra.pdf`.
  3. The old files' restore window lapses.
  4. Undo returns **200**.
- Result: the old files stay in Trash (not restorable), **`new1` is trashed anyway**, and only `extra.pdf` is left live. The plan set is gone, apart from recovery from Trash by an admin.
- Fix: do it all or nothing in one transaction. If any `removedId` isn't restorable, return 409 ("can't undo — restore from Trash") and trash nothing.
- Undo after *other* changes is otherwise sane: files uploaded since (`extra.pdf`) aren't touched, and already-removed replacement files are skipped.

### Nit
- Replace stores the same file twice if it's picked twice in one upload (`skipDedupe` applies within the request too). Dedupe within the request by content hash.
