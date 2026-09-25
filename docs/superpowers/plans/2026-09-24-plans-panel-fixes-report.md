# Bid Hub Overview "Plans & Job Profile" panel — fix round report

**Branch:** `fix/plans-panel` (worktree `../Electrical-program-wt-plansfix`), from local main `76d5539`.
**Executor:** Sonnet 5 · **Date:** 2026-09-24/25

## Commit range

`76d5539..0036129` (3 commits):

| Commit | Task |
|---|---|
| `3189aa9` | Task 3 — separate plan sheets from a bound spec book's pages |
| `0b90a91` | Task 2 — map Anthropic errors to human-readable text |
| `0036129` | Task 1 — remove a plan file, replace the plan set, dedupe on upload |

## Migrations

**Last migration: 146.** `documents.content_sha256` already existed (migration 121, populated for every upload since — it already backs `routes/preconstruction.ts`'s own dedupe and revision logic). Migration 146 adds one supporting index:

```sql
CREATE INDEX IF NOT EXISTS idx_documents_plan_dedupe
  ON documents (linked_id, content_sha256)
  WHERE deleted_at IS NULL AND category = 'plans' AND content_sha256 IS NOT NULL;
```

Additive and idempotent (`CREATE INDEX IF NOT EXISTS`, no data change). No `documents` column was missing, so no `ADD COLUMN` was needed for the dedupe itself.

## Task 1 — remove, replace, dedupe

- **Per-file remove ("×")** on the Overview panel's plan list. `DELETE /api/preconstruction/:bidId/plan-files/:docId` (new route, `backend/src/routes/jobProfile.ts`) soft-deletes the document (`deleted_at`/`deleted_by`, the same Trash every other document uses), writes an audit entry, and refreshes the sheet check / job profile for the files that remain. Never a hard delete.
- **Permission:** gated on `BID_EDIT_ROLES` (owner, administrator, manager, estimator, sales_manager, salesperson, salesperson_legacy, project_manager) or the AI `view_results` permission — the exact same gate `POST /job-profile/run` and `PUT /plan-revisions` already use. Not admin-only. `read_only`, `technician` and `accounting` get 403.
- **Undo:** the existing `POST /documents/:id/restore` route already lets the same user who deleted a document restore it within the 10-minute restore window (`canRestore`, `middleware/auth.ts`) — no new backend route needed. The panel's toast carries an Undo action wired to it, then re-syncs the job profile.
- **ConfirmDialog:** both remove and replace ask first, via the app's existing `useConfirm()`/`ConfirmDialog` — replace's dialog lists the current plan files that are about to move to Trash.
- **"Replace plan set":** uploads the new files first, then (only on success) soft-deletes the files that were the bid's current plan set before the replace. Undo restores exactly those files. The new upload passes `skip_dedupe` (a new `StoreDocumentInput.skipDedupe` / `skip_dedupe` form field) so bytes identical to the file about to be replaced don't get deduped against it.
- **Refresh without Re-run Analysis:** `refreshAfterPlanFilesChanged(bidId)` (new, `services/jobProfileRun.ts`) re-runs the sheet check for the bid's remaining current plan documents — cache-backed for files already classified, so removing a file costs nothing new to re-check — then calls the existing `resumeAfterSheetCheck`, the same staleness rule that already re-triggers the job profile whenever the plan set changes (a new upload, Estimating's per-sheet Upload). This only ever writes `bid_sheet_check` / `bid_job_profile`; it never touches `ai_results`/run history, so a takeoff already run is never reset. The DELETE route awaits it synchronously and returns the refreshed job-profile payload in one round trip, so the panel updates without a second request.
- **Dedupe on upload:** `storeDocument()` now hashes the buffer up front and, for a `category='plans'` upload with a `linked_id`, checks for an existing non-deleted plan file on that bid with the same `content_sha256` **before** any Drive/Cloud upload happens. A match returns the existing row with `duplicate: true` and nothing new is stored; the panel shows an "Already uploaded" toast. Scoped to `category='plans'` (the reported bug) so re-uploading, say, a signed contract under a different category is unaffected. Scoped per bid (`linked_id`) so the same plan set on two different bids is never deduped against each other. A file re-uploaded after being removed (Trashed) is stored fresh, not deduped against the trashed copy (`deleted_at IS NULL` in the check).

## Task 2 — friendly Anthropic errors

New `backend/src/ai/friendlyError.ts`, `friendlyAnthropicError(err)`:
- `"credit balance is too low"` → the exact text Jake asked for: *"Your Anthropic account is out of credits — add credits at console.anthropic.com → Plans & Billing, then click Read the plans again."* (exported as `CREDIT_BALANCE_MESSAGE` for tests).
- `401` / `authentication_error` → "Your Anthropic API key is missing or invalid — check Settings → AI → API Key, then click Read the plans again."
- `403` / `permission_error` → account/model access message.
- `429` / `rate_limit_error` → rate-limit message.
- `529` / `overloaded_error` → overloaded message.
- Any other Anthropic-shaped status (5xx, 400/`invalid_request_error`, or an unnamed one) → a generic, never-raw fallback.
- An error that **isn't** shaped like an Anthropic API response (no `status`, no nested `error` body — an `AgentTruncatedError`, a `RunCancelledError`, a plain bug) passes its own message through unchanged rather than being replaced with something less specific, since those already carry a human-authored message from elsewhere in the codebase.

Wired into the two places a model call's failure is stored: `services/jobProfileRun.ts`'s `runJobProfileNow` catch block (`bid_job_profile.error`) and `services/sheetCheck.ts`'s `runSheetCheck` catch block (`bid_sheet_check.error`). Both keep logging the raw `err` via `logger.error({ err, ... }, ...)` — only the friendly text ever reaches the DB column or a JSON response. The Plans & Job Profile panel and the Documents step's `SheetCheckPanel` both just render `data.error`/`row.error` already, so no frontend change was needed there.

**A note on `sheetCheck.ts`'s reachability:** `buildInventory`'s per-file classification and reference-reading calls already catch and swallow a plain Anthropic API error per file ("never throws for one file" is the module's own stated design — a rate-limited or overloaded classifier call just leaves that file "unclassified" instead of failing the whole check). So in practice a raw JSON body was never actually reaching `bid_sheet_check.error` for the credit/auth/rate-limit/overloaded cases; the only errors that escape to the outer catch today are a truncated model reply (`AgentTruncatedError`, deliberately re-thrown) or a genuine cancellation — both already friendly. The mapper is still wired there for defensiveness and consistency ("anywhere the profile or sheet check surfaces errors"), and the job-profile path (where a model call's failure genuinely does reach the user) is where the credit/auth/rate-limit/overloaded mappings are proven end to end.

## Task 3 — plan sheets vs. a bound spec book

`pageClassifier.ts` gained a `'spec'` discipline (dense running text, no drawing, no sheet number — a specifications / project-manual page) alongside `PAGE_CLASSIFIER_SYSTEM`'s prompt text describing it. Changing the prompt text automatically busts `sheet_page_cache` (its cache key already hashes the classifier's own system prompt), so existing cached classifications get re-classified the next time a check runs against those files — no backfill needed.

`sheetSummaryOf()` (`services/jobProfileRun.ts`) now excludes `discipline === 'spec'` pages from `total`/`electrical` and reports them separately as `specPages`. The panel renders `"{total} plan sheets · {electrical} electrical"` and, only when `specPages > 0`, appends `" · spec book {specPages} pages"` — e.g. **"55 plan sheets · 7 electrical · spec book 142 pages"** instead of the old "142 sheets in set · 23 electrical" that counted the spec book's pages as sheets.

## Tests

| Area | File | Count |
|---|---|---|
| Summary (Task 3) | `backend/src/test/jobProfileSummary.test.ts` | 5 (new) |
| Summary (Task 3) | `frontend/.../PlansJobProfilePanel.test.tsx` | 1 new + 1 updated |
| Friendly errors (Task 2) | `backend/src/test/friendlyAnthropicError.test.ts` | 11 (new, pure mapper) |
| Friendly errors, wired (Task 2) | `backend/src/test/jobProfileErrorMapping.test.ts` | 1 (new, real route + DB, mocked Anthropic) |
| Friendly errors, wired (Task 2) | `backend/src/test/sheetCheckErrorMapping.test.ts` | 1 (new, real `runSheetCheck` + DB, mocked Anthropic) |
| Remove / undo / replace / dedupe / permission / refresh (Task 1) | `backend/src/test/planFilesRemoveDedupe.test.ts` | 11 (new) |
| Remove / undo / replace / dedupe UI (Task 1) | `frontend/.../PlansJobProfilePanel.test.tsx` | 5 (new) |

**41 new/updated tests total** (23 backend, 18 frontend — including the 13 pre-existing panel tests re-verified unchanged plus 1 updated for the new summary wording).

No real Anthropic, Drive or email call is made anywhere — every new test either mocks `@anthropic-ai/sdk` (job profile / sheet check error mapping, remove/dedupe route tests) or is a pure function test. `NODE_ENV=test` mutes Drive/Cloud storage the same way the rest of the suite already does.

### Full suites (run once, at the end)

| Suite | Result |
|---|---|
| Backend `npm test` | 2313 tests: **2305 passed, 4 failed** (215 files: 211 passed, 3 failed, 1 lost to a worker crash). `tsc --noEmit`: clean. |
| Frontend `npx vitest run` | **1346 / 1346 passed** (130 files). `tsc --noEmit`: clean. |

**The 4 backend failures + 1 worker crash, classified** (none touches a file this branch changed):
- `intakeSimilarCache.test.ts` ×2 — the same known load-sensitive flake documented in every prior fix round's report for this codebase (`2026-09-24-next-round-report.md` onward): it times out under the full suite's load, unrelated to `routes/intake.ts` or anything this branch touches.
- `integration.test.ts` "backfills a follow-up for an existing lead already sitting in a stage" — the same documented load timeout.
- `estimatingMarkups.test.ts` "a well-formed document_id filter still works normally" — a new instance of the identical failure shape (`Test timed out in 30000ms`, no assertion failure). Re-ran `src/test/estimatingMarkups.test.ts` alone: **all 28 tests pass in 1.9s**. This branch never touches `routes/estimatingMarkups.ts` or anything markups-related; the timeout is purely a function of the full suite's load (2313 tests now, up from 2206–2284 in prior rounds — consistent with the previously-documented "apparently slowing as the test DB accumulates bids" pattern, now surfacing on a different, equally unrelated test).
- One "Worker exited unexpectedly" losing tests from the total count (215 files collected, 214 reported pass/fail) — matches the same worker-crash pattern every prior round's report also hit and attributed to `notificationsRetention`, not to anything this branch changed.

## Deferrals / follow-ups (honest)

- **Estimating's own in-memory selection** (an already-open Documents/Estimating tab's ticked-file state) isn't pushed a live update when a file is removed or replaced from the Overview panel elsewhere in the app — it reflects the change on its own next fetch of `/documents`/the sheet check, exactly the way every other plan-file change already works today (a new upload from Overview doesn't live-push into an already-mounted Estimating tab either). This is an existing, app-wide limitation, not something new introduced or left uniquely unresolved by this round.
- **`refreshAfterPlanFilesChanged` can trigger a real (billed) job-profile model call** when removing/replacing changes the plan set's content-hash key (e.g., removing an actual duplicate file shrinks the sorted list of content hashes the profile is keyed on) — this reuses the exact same `resumeAfterSheetCheck` staleness rule that already fires on any other upload, so it's consistent with existing behavior, not a new cost pattern, but it does mean a remove/replace can cost a few cents the same way an upload already can. Worth Jake's awareness if a bid sees a lot of remove/replace churn.
- **No bulk remove** — the panel removes one file at a time (with its own confirm+undo each); "Replace plan set" is the bulk path when the intent is "swap the whole set."
- **No manual role-based hiding of the × / "Replace plan set" buttons** — they're shown regardless of role and the server enforces the permission (403 on a denied role), consistent with how "Read the plans" already behaves in this panel.

## Top files for review

- `backend/src/utils/storeDocument.ts` — the dedupe check, run before any storage I/O.
- `backend/src/routes/jobProfile.ts` — the new `DELETE /:bidId/plan-files/:docId` route.
- `backend/src/services/jobProfileRun.ts` — `refreshAfterPlanFilesChanged`, `sheetSummaryOf`.
- `backend/src/ai/friendlyError.ts` / `friendlyAnthropicError.test.ts` — the error mapper and its reachability note.
- `backend/src/ai/pageClassifier.ts`, `backend/src/ai/prompts.ts` — the `'spec'` discipline.
- `frontend/src/features/bid-hub/PlansJobProfilePanel.tsx` — remove/replace/dedupe UI, the updated summary line.
- `database/migrations/146_plan_files_dedupe_index.sql`.

---

## Fix round (review `eb39943`, verdict NOT READY — one blocker)

**Range:** `eb39943..HEAD` (3 commits including this report update). **No new migration** — nothing in this round needed a schema change (see B1 and N3 below); the next one, if ever needed, starts at 147.

### B1 (blocker) — the "spec" discipline is reverted; spec-book detection is text-only and never touches selection

The review reproduced (from real Kissimmee title-block crops and reasoning about the code) that a real electrical sheet — an "E-0.1 Electrical Specifications" cover, or any E-series sheet whose notes read like a specifications section (dense text, "PART 1 - GENERAL", section numbers) — could be classified `spec` by the model and silently drop out of both `/analyze`'s page selection and Agent 1's counting, with only the prompt wording (not code) stopping it. The prompt change also busted `sheet_page_cache` for every existing bid.

Fix:
- `backend/src/ai/pageClassifier.ts` and `backend/src/ai/prompts.ts` are reverted **byte-for-byte to main (`76d5539`)** — `git checkout 76d5539 -- <path>`, verified with `git diff 76d5539 -- <path>` showing no diff. No `'spec'` discipline exists anywhere in the classifier; the classifier cache key is unchanged.
- New `backend/src/ai/specBookPages.ts`: `computeSpecBookPages()` is a pure, deterministic, **text-only** annotation (`CheckedPage.specBookPage`, a new optional field) computed from the classifier's own `sheetNo` output and the page's text layer — never from discipline. **Absolute guard: a page with a real sheet number (`normalizeSheetId`) is never a spec-book page, regardless of its text.** A page counts only when it has no sheet number *and* either (a) its own text reads like a specifications section (dense text + "SECTION 26 05 19" / "PART 1 - GENERAL" / "DIVISION 26"-style numbering), or (b) most of its file's pages do (a bound spec book — its title page, blank dividers, and table of contents count too, since they wouldn't individually match (a) on their own).
- `sheetSummaryOf()` now filters on `specBookPage`, not discipline.
- This annotation is **never read** by `applySelection`, `/analyze`'s own page selection, or the classifier/cache — proven by a test that runs `applySelection` on the identical page with and without the flag and asserts byte-identical output (role, reason, refs, revision proposals, duplicates).

Tests (`backend/src/test/specBookPages.test.ts`, `pageClassifierSpecRevert.test.ts`, updated `jobProfileSummary.test.ts` — 23 total):
- An E-sheet with real dense notes (no section numbering) and an "E-0.1 Electrical Specifications" sheet (section-numbered text) both stay out of the spec-book set because they carry sheet numbers — the review's exact repro.
- A Kissimmee-style bound spec book (title page + 140 section-numbered pages + an end page, none with a sheet number) is fully flagged as spec, in the summary only.
- A file that is *not* predominantly spec-like only flags the one page that individually matches — no over-eager whole-file flagging.
- `applySelection` is proven blind to the flag.
- The classifier cache key (`classifierCacheKey('claude-haiku-test')`) is locked to the exact value computed from main's prompt text; `SELECT_DISCIPLINES` is locked to main's 5 values; a classifier reply claiming `discipline: "spec"` now falls back to `"unknown"` (the parser's own invalid-enum-value behavior) instead of being accepted.

### S1/S2 (should-fix) — "Replace plan set" is one atomic, all-or-nothing server operation

The review reproduced that replacing a 3-file set made **3 separate billed job-profile model calls** (one per `DELETE`, each awaiting its own `refreshAfterPlanFilesChanged`, each reading a momentarily mixed old+new set), and that a partial upload failure left the bid with old set + part of new and only a generic error, with Undo restoring the old files but never trashing the replacements.

Fix — new `POST /api/preconstruction/:bidId/plan-files/replace` (multipart `files`) and `POST /api/preconstruction/:bidId/plan-files/replace/undo` (`{removedIds, uploadedIds}`), replacing the client-side loop entirely:
- Every new file is stored first (`skip_dedupe` implied, same as before). On any failure, the files that DID upload are soft-deleted again (never left as orphaned extras) and the response names the failed file with a 400 (not a 5xx — this app's frontend error handling folds every 5xx into a generic "Server error" and drops the specific message, so a 4xx is required for "the file that failed" to actually reach the panel).
- Only once every new file is stored are the bid's previous plan files soft-deleted; a removal that doesn't affect any row is collected into `failedRemovals` and returned (surfaced in the panel's toast), never silently dropped.
- Exactly one refresh (`refreshAfterPlanFilesChanged`, see S3/S4 below) runs at the end — one profile call at most, over the new set only.
- Undo is one action: restores the old files and soft-deletes the new ones, then one refresh.
- The frontend's `runReplace`/`undoReplace` were rewritten to call these two routes directly instead of looping `uploadOne`/`DELETE`/`restore`.

Tests (`backend/src/test/planFilesReplaceAtomic.test.ts`, 4; plus 2 updated + 1 new frontend test): a 3-file replace makes exactly 1 job-profile model call; a storage failure on file 2 of 3 trashes file 1 (which DID upload), names file 2 in the 400 response, and leaves the old set completely untouched; Undo restores the old file and trashes the replacement in one action with at most one more profile call; the panel sends one multipart request (no per-file DELETE/upload calls) and surfaces a partial-upload failure by name in its error toast.

### S3/S4 (should-fix) — the shared sheet check is never overwritten unsafely, and Undo still keeps the summary current

The review reproduced that the B1-round `refreshAfterPlanFilesChanged` called `claimSheetCheck` unconditionally on every remove/replace, overwriting `bid_sheet_check` even when it belonged to Estimating's own, differently-ticked selection (S3) — and separately, that Undo never refreshed the check at all, leaving the summary showing a smaller set than the bid's actual current files (S4).

Naively fixing S3 by delegating straight to `requestJobProfile`'s existing R2-S6 rule (`ours = sc.input_key === newContentHashKey`) turns out to under-fix S4: that rule compares against the row's *current* content-hash key, which a remove/restore always changes relative to whatever the row already says — so the row would never be reclaimed again after the *first* plan-file change, even in the common case where nothing but this bid's own Overview panel has ever touched it.

`refreshAfterPlanFilesChanged` (`backend/src/services/jobProfileRun.ts`) now checks a sharper signal before claiming the row: is the row's content-hash key either (a) missing, (b) already exactly the new set, or (c) exactly what **this bid's own job profile last recorded as its own** (`bid_job_profile.content_key`, an existing column)? If any of those hold, nothing else has touched the row since our own last run and it's safe to claim/update for the new set. If the row exists and matches none of those, something else (Estimating's own selection) owns it now, and it's left completely untouched — the job profile still reads the new set fine, via `requestJobProfile`'s existing shared classification-cache fallback.

This resolves both: in the common case (no Estimating divergence), a remove *and* a subsequent restore correctly reclaim and update the row each time, so the summary is never stuck stale — S4. In the divergent case (Estimating's own check, made independently of any job-profile run), the row is never touched by a remove/replace/restore — S3.

Also new: `POST /api/preconstruction/:bidId/plan-files/:docId/restore`, a scoped Undo route (same `canRestore` permission check as the generic documents restore) that calls `refreshAfterPlanFilesChanged` in the same round trip, replacing the panel's old two-call pattern (generic restore + a separate manual `job-profile/run`).

Tests (`backend/src/test/planFilesReviewFixes.test.ts`, part of 7): removing a plan file that isn't part of Estimating's own ticked selection (seeded directly on `bid_sheet_check`, before any job-profile run ever happened on the bid) leaves that check row's `run_token`/`input_key` byte-identical; a remove-then-restore cycle on a bid with no Estimating divergence ends with the summary back at the full, current file count (2 → 1 → 2), never stuck at the smaller set.

### Nits

- **N1.** `DELETE .../plan-files/not-a-uuid` (and the new restore route) validate the id against a UUID shape first and return 404 instead of a raw 500 from Postgres' uuid-cast error.
- **N2.** New `sanitizeStoredError()` (`ai/friendlyError.ts`) recovers the Anthropic SDK's own `"${status} ${json}"` `APIError.message` shape from an old stored raw-JSON error and runs it through the same `friendlyAnthropicError()` mapping a live error gets — so an old row gets the *specific* message (credit balance, authentication, rate limit, overloaded, …), not just a generic fallback, whenever the text is still parseable; falls back to the generic message only when it truly isn't. Wired into both `loadJobProfile()` (GET `/job-profile`) and `sheetCheckPayload()` (GET `/sheet-check`) on every read. (Fixing this also surfaced and fixed a small pre-existing gap in `friendlyAnthropicError()` itself: it wasn't including a plain-string `err` in its "credit balance" substring check, which `sanitizeStoredError` needed.)
- **N3.** The dedupe query in `storeDocument()` now explicitly excludes generated documents (`AND generated = false`) — harmless before (no generated document is filed as `plans`), now explicit.

### Tests (full suites, run once, at the end)

| Suite | Result |
|---|---|
| Backend `npm test` | 2347 tests: **2340 passed, 3 failed** (219 files: 216 passed, 2 failed, 1 lost to a worker crash). The 3 failures are the same known load-sensitive flakes documented in the first report and every prior round of this codebase's history — `intakeSimilarCache.test.ts` ×2 and `integration.test.ts`'s lead-backfill timeout — neither touches a file this round changed. `tsc --noEmit`: clean. |
| Frontend `npx vitest run` | 1347 tests: **1346 passed, 1 failed** (130 files). The failure, `SurveyMarkupEditor` "Escape exits full screen", is the same documented load flake from prior rounds (a gen-pipeline test this branch never touches); re-ran alone and it passes. `tsc --noEmit`: clean. |

**New/updated tests this round:** 23 (spec-book revert + detection) + 4 (replace atomicity) + 7 (S3/S4/N1/N2/N3) + 5 (`friendlyAnthropicError`/`sanitizeStoredError` additions) = **39 backend**; 3 updated + 1 new frontend (`PlansJobProfilePanel.test.tsx`, matching the new replace/restore API surface).

### Top files for this round's review

- `backend/src/ai/specBookPages.ts` / `specBookPages.test.ts` — the deterministic spec-book detector and its guard.
- `backend/src/services/jobProfileRun.ts` — `refreshAfterPlanFilesChanged`'s "safe to claim" heuristic; `sheetSummaryOf`.
- `backend/src/routes/jobProfile.ts` — `POST .../plan-files/replace`, `.../replace/undo`, `.../:docId/restore`.
- `backend/src/ai/friendlyError.ts` — `sanitizeStoredError`.
- `backend/src/ai/pageClassifier.ts`, `backend/src/ai/prompts.ts` — confirm byte-identical to main.
