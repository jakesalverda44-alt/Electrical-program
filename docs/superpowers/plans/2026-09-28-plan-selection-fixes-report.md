# Plan-selection fixes report (bid 041c6d48 live test, 2026-09-28)

Branch fix/plan-selection off c532321. Commits: 00b4907 (B3), 69fddab (B4), a10f7a3 (B1 + backend defense), 6ceac62 (B2).

## B1 — empty sheet-check run wiped a good check
- POST /:bidId/sheet-check/run now returns 400 when the run resolves to no live files, and never writes the row. Message: "None of the selected files are current — they were removed or replaced. Reselect the plan files." (or "Select at least one plan file to check." when nothing was sent at all).
- Choice: 400 rather than returning the unchanged check. useSheetCheck already surfaces the error text, and a 200 would look like a run that never happened.
- gatherAnalysisInputs reports trashed/missing ids as excluded reason 'deleted'; POST /analyze uses the same specific message when every selected id was trashed (backend defense in depth).
- Tests: src/test/planSelectionB1.test.ts.

## B2 — Estimating kept / started with a stale selection
- PcWorkspaceView: selection is pruned to still-eligible docs whenever projectDocsData changes; an emptied selection ticks all current plan docs. A prior run only counts if at least one of its docs is still eligible, else the no-prior-run default applies.
- Found while testing: BidHubPage keeps the Estimating view mounted (hidden) while Overview is open, and project docs were never re-read. Added an optional `visible` prop (BidHubPage passes tab === 'estimating'); docs reload each time the tab is shown again.
- Tests: PcWorkspaceStaleSelection.test.tsx (prior run trashed; replace while open; partial replace).

## B3 — job profile stuck 'waiting' after replace
- refreshAfterPlanFilesChanged now calls resumeAfterSheetCheck(bidId) when requestJobProfile returns 'waiting'. Order matters: requestJobProfile first, so a row with stale pending ids is not resumed before it is rewritten. runJobProfileNow's token claim still guarantees one model call (R2-S1).
- Test: planSelectionB3.test.ts (pre-seeded waiting row with content_key of the new set; replace; exactly one model call, stays one).

## B4 — NULL content_sha256 defeated dedupe
- New utils/backfillContentHashes.ts (loadDocumentBytes shared with gatherAnalysisInputs; backfillContentHashes; boot pass).
- Both: on demand in storeDocument's dedupe path (per bid, category plans, limit 100, no-op once filled) so dedupe is correct exactly when it matters; plus a capped (200/boot, newest first) fire-and-forget pass after listen, skipped under NODE_ENV=test, logging counts. Unreadable rows stay NULL and are retried next boot. No migration needed.
- Test: planSelectionB4.test.ts (legacy NULL row + same bytes -> duplicate; boot backfill counts, unreadable row tolerated).

## Test results
Backend 2352 passed / 3 failed (known load flakes: intakeSimilarCache x2, integration lead-backfill; one worker-exit message). Frontend 1351/1351.

## Notes
- backend/node_modules and frontend/node_modules in the worktree are symlinks to Local Version's (read-only use), excluded via .git/info/exclude.
