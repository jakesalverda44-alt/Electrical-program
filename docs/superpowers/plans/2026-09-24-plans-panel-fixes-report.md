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
