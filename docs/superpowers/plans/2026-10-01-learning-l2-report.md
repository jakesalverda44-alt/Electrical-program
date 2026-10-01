# Report: Level 2, "learning from corrections" (Tasks 9–16)

**Branch:** `feat/fewer-questions` (the same worktree as the fewer-questions round, built on top of it), based on main `25dce72`.
**Built by:** Opus 5.5, 2026-10-01. **Not merged, not pushed, app not started.**

**No live model call was made by anyone in this session.** `scripts/learningEvalLive.ts` exists for development, refuses to start without explicit guards, and **was not run**. The RECORDED-LIVE gate did **not** run.

## For Jake (plain summary)
When you confirm, move, delete or re-type a counter marker, or answer an "unlisted tag" question, the CRM now queues a small picture of that symbol, along with what you said it is. It turns the picture into an "example" a little later, off the request path.

On later bids, the counter may be shown a few examples, but only for symbols whose own legend says the same thing. Examples are never matched by tag letter, never come from the same bid or the same drawings, and the prompt says "this sheet's legend wins".

Repeated answers become **proposed lessons**. You approve, edit or dismiss each one in Settings → Counting Lessons. "All jobs" is preselected.

Nothing goes live until **you** press "Check and release" and no item gets worse.
- Today the bank holds no examples from other jobs, so the check will truthfully say "no change" and spend nothing.
- Nothing here can change a count. That is proven in CI, byte for byte.

## Commits
| Task | Commit | What |
|---|---|---|
| 9 | `6daa3a6` | migration **163**, `meaning.ts`, `visualHash.ts`, `learningDb.ts` |
| 10 | `a1389eb` | `capture.ts`, `harvest.ts`, `countRender.rasterizeGray` / `renderSymbolCrops`, capture hooks, boot sweep |
| 11 | `fe737a7` | `selectExamples.ts`, `counterLearning.ts`, `bank.ts`, counter / countingStage / pipeline wiring, committed request-hash baseline |
| 12 | `f447987` | `proposeLessons.ts`, `lessonsService.ts`, `routes/learning.ts` |
| 13 | `be1caab` | lessons in the counter prompt, `reviewHints.ts` (an additive `buildReviewItems` option) |
| 14 | `a6c1112` | releases, `services/learningCheck.ts` ("Check and release"), the gate rule, the guarded CLI |
| 15 | `2a828e2` | Settings → Counting Lessons, the "Learning used on this run" strip, "Make a lesson from this answer" |

Migrations: **162** (fewer-questions, an index) and **163** (learning). Confirmed free with `ls database/migrations | tail`. The gap-closing round owns 164–168.

## Jake's decisions, as built
**L1 / L2 / L3**
- Examples are global, and the meaning gate is never the tag letter.
- The header sentence opens every examples block.
- A conflicted dHash cluster needs a strict match (Jaccard ≥ 0.8, or a shared series token). Negatives from its other meanings are never shown.

**L-D1:** there was no labelling session, so the gate ships in **"no-change" mode**.
- A job whose leave-one-job-out bank is empty is reported "no change — the leave-one-job-out bank is empty for this job (no model calls)".
- The release still passes and activates.

**L-D2:** the live A/B runs **only from Jake's button**.
- The route is `POST /api/learning/releases/:id/check`. It is admin-only, requires `confirmCost: true`, and the UI shows a dialog with "about $12–15" and the leave-one-job-out note.
- It runs in the background and never writes the bid.
- The evidence cache is read-only (`set` is a no-op).
- Tests inject fakes; the Anthropic constructor throws in every test file that touches it.

**L-D3:** unlisted-tag lessons default to `applies_to ['review']`. "Use in: Counting" is an explicit checkbox at approval.

## What exists today (honest state)
- **Examples:** none in any real database. In this worktree, captures start only when someone confirms, moves, deletes or re-types markers, or answers an unlisted tag.
- The only human-verified, positioned label in the exports is **36th `unlisted:H`**. The SCRIPTED harvest test turns it into 4 positive candidates: "surface strip light, 4ft", `fixture.strip`. The crops come from a **blank stand-in PDF**; the pixels are not the real sheet.
- **Lessons:** the real 36th export gives **0 automatic proposals** (one bid). `from-item unlisted:H` gives one proposal with evidence [36th Street Warehouse, `unlisted:H`, 13, "H surface strip light, 4ft\" × 13"].
- **Expected effect today: none on either eval job.** The CI gate proves this byte for byte.

## CI gate result (Task 14 A, `npm test`)
**A1 — an empty bank is byte-identical.** `backend/eval/learning-baseline-2026-10-01.json` holds a sha256 per counter request: 6 for Kissimmee, 4 for 36th. It was committed with the code that produced it (Task 11 commit).
- Both 0930 replays reproduce the hashes exactly.
- So does a bank in which nothing matches.

**A2 — no count change.** With a SCRIPTED bank (crops drawn by the test, other-bid provenance invented, labelled SCRIPTED), the Kissimmee replay counter answers the same marks. Identical with and without the bank:
- `countResult` minus `learning`;
- `buildReviewItems`;
- `enforcedCounts`.

**A3 — budget and leakage.**
- ≤ 12 example images and ≤ 1,500 image tokens per call.
- The header comes before `SHEET:`; only the call's own targets are named.
- The photometric sheet never gets the GFCI example.
- Never used: an example from the same bid, from the same document sha, matching by tag letter only, or a conflicted cluster without a strict match. The skipped list says "from this bid" or "from these same drawings".
- Per-bid "off": `all` → no learning object at all; one example off → that example is never used.

**A4 — the fewer-questions Task 8 gate passes** (same branch).

**Grep test** (`noCountPath.test.ts`):
- `learning/` is imported only by the counter prompt path, the pipeline, the capture hooks (`takeoffReview`, `routes/estimating`), the routes, `index.ts` (boot sweep) and `reviewItems` (hints).
- `countMerge`, `reviewAnswers`, `pricing`, `bidEstimate`, `accubidBidData` and the `enforcedCounts` body never mention learning or `lessonHints`.

**Review hints change nothing.** On the 36th export, a matching lesson leaves these identical: `reviewStatus`, `enforcedCounts`, the item fingerprint, and `hashScopeSnapshot`.

## RECORDED-LIVE gate (Task 14 B)
**Not run: there are no cross-job labels yet, and L-D2 reserves the run for Jake's button.** There is no `learning-ab-*.json` fixture.

The gate rule (worse-of-2 per arm, disputed items reported, "asked" must not rise) is tested on synthetic recorded pairs:
- a regression fails;
- noise within A's own spread passes;
- a disputed item is only reported.

The release flow is tested with injected fakes:
- an empty LOJO bank → no runner call, "no change", passed and activated;
- a regression in arm B → `failed`, not activated.

## Token / cost (estimates; there are no `usage` actuals because no live call ran)
- One example image at the tile scale (1.2" × 196 px/in ≈ 235 px) ≈ **74 image tokens**, plus about 35 text tokens.
- SCRIPTED Kissimmee replay with 4 matching examples: 4 images per sheet call. `countResult.learning.tokensEst` = **2,201 for the whole run**, which is 5 calls at about 440 tokens each.
  - About $0.0018 per call uncached at $4/MTok, and about $0.009 for the run.
  - About $0.0001 per call when the cached prefix is reused (the last learning block carries `cache_control`).
- Caps enforced in code and asserted in tests:
  - 12 images per call, ~1,500 image tokens, 1,000 example-text characters;
  - 5 lessons, ≤ 400 tokens.
- "Check and release" is estimated at **$12–15** when both eval jobs have a bank. It is **$0 today**, because the LOJO banks are empty and no call is made.

## Shared-file edits (all additive, behind the optional `learning` input)
- `backend/src/ai/counter.ts`:
  - `CounterRunInput.learning?`;
  - `buildCounterContent(…, learningPrefix = [])`;
  - `countOne` prepends the prefix, or `[]` if it fails.
  - **COUNTER_SYSTEM is untouched.**
- `backend/src/ai/countingStage.ts`: `CountingStageInput.learning?` is passed to all three `runCounter` calls (count, dense retry, consistency pass), and `countResult.learning` is set only when learning exists (also on the supplement path).
- `backend/src/ai/countRender.ts`: `renderCountTiles` was refactored onto the new `rasterizeGray` with no behavior change (the countRender tests pass, and the request hashes are byte-identical). `renderSymbolCrops` is new.
- `backend/src/routes/estimating.ts`:
  - the markups batch reads the pre-change rows;
  - it logs `marker_create` / `marker_delete`;
  - it enqueues captures fire-and-forget.
  - **This file may also be touched by the gap-closing round (routing); my edit is one localized block plus a helper.**
- `backend/src/estimating/takeoffReview.ts`: review captures after the commit and undo on reopen, both fire-and-forget.
- `backend/src/routes/preconstruction.ts`:
  - the release bank is loaded before counting;
  - `makeCounterLearning`;
  - lesson hints go into `buildReviewItems`;
  - `example_used` / `lesson_used` events;
  - lesson proposals are refreshed after a run;
  - GET `/review` carries the strip data when anything was used.
- `backend/src/ai/reviewItems.ts`: `lessonHints` and the `lessons` / `lessonContext` options (`withHints`). `enforcedCounts` and the resolutions are untouched.
- `backend/src/index.ts`: the `/api/learning` router and the boot harvest (skipped under `NODE_ENV=test`).
- `backend/src/estimating/labeledEvents.ts`: kinds `marker_create`, `marker_delete`, `example_used`, `lesson_used`. The table stays write-only; nothing reads it.
- `backend/src/ai/accountMemory.ts`: `fp` moved to `ai/textFingerprint.ts` (re-exported) to keep imports acyclic.
- Test fixtures `replay0930.ts` / `replay36thB.ts`: an optional `learning` pass-through.
- Frontend:
  - `TakeoffReviewPanel.tsx` (the strip, the lesson link);
  - `review/ReviewCardShell.tsx` (hints);
  - `review/reviewCards.tsx` (UnlistedCard "Use this name");
  - `review/payloadCases.ts` (appended `LEARNING_BODIES`; frozen section untouched);
  - `settings/SettingsPage.tsx` (new section).

## Deviations and judgement calls
1. **Migration 163's unique index** is `(source_kind, polarity, markupId, memberKey, crop_sha256)`, not `(source_kind, markupId, crop_sha256)`. A re-type stores a positive and a negative from the same crop, and an unlisted tag stores up to 4 crops per item. It was amended before 163 was applied anywhere. `learning_releases.status` also allows `'checking'`.
2. **"Check and release" checks and activates in one step** (the button). `/activate` stays available and refuses without a passed check.
3. **The eval jobs are fixed** to the two live bids (Kissimmee `041c6d48…`, 36th `0cd39e74…`), with their committed expected files and disputed items.
4. **Recording of live replies:** the in-app check stores its gate result in `learning_releases.eval`. It does not write a RECORDED-LIVE fixture (an app cannot commit to the repo). If Jake wants CI replays of a live check, that is a follow-up.
5. **Status-convention lesson (pattern 2)** reads the human `remodel:conventions` "shaded / filled" answers on ≥ 2 bids. It does not combine the sheet's printed rule quote with the status-crop answers, because those are not kept per bid in review items.
6. **No statuscrop captures.** The reclassification items carry counts but no mark positions, so there is nothing to crop. Statuscrop captures are listed in the schema for later.
7. **The visual-hash test** draws the duplex and GFCI glyphs with SVG. `buildSymbolPdf` only draws filled squares.
8. **Device-class pinning:** the meaning test pins about 50 of the 108 targets explicitly; the rest are covered by the "never a tag match" and category tests.
9. **The strip's data comes with GET `/review`** (no extra request). `GET /api/learning/bids/:bidId` also exists.

## Open questions for Jake
- When you want a meaningful model-effect check: label one or two other jobs (L-D1 option a), then press "Check and release". Until then it reports "no change" for free.
- Privacy: global examples mean small symbol crops from one client's drawings go to Anthropic while another client's bid is counted. They are tiny and carry no title block. You approved this; it is restated here.

## Test counts
- New backend tests (Level 2):
  - `meaning` (8), `harvest` (4, test DB + real pdftoppm), `counterLearning` (3), `noCountPath` (2);
  - `proposeLessons` (12), `learningLessonsRoute` (2), `lessonsUse` (7), `learningReleases` (2), `learningGate` (5).
- New frontend tests: `LearningSection.test` (5).
- **Full runs at the end (both rounds):** see "Full-suite results" below.

## Full-suite results (one run at the end, both rounds, test DB `electrical_crm_test` only)
**Backend (`cd backend && npm test`): 307 files, 3,162 tests.**
- First run: 7 failed.
- Two were real and are fixed in `ee6ea5c`:
  - the import allowlist was missing the gate service;
  - the Q1 snapshot comparison needed to drop the new additive fields `step` / `memoryText`.
  - Both files re-run green (24/24).
- The other 5 are the known load / timeout flakes, in files this branch does not touch:
  - `intakeSimilar.route.test.ts` ×2 and `intakeSimilarCache.test.ts` ×2. These time out at 30 s even when run alone (~36 s each): the similarity scan grows with the shared test DB.
  - `integration.test.ts` "lead follow-up backfill" (30 s timeout under full-suite load).
- Net: 3,157 pass + 5 known flakes.

**Frontend (`cd frontend && npx vitest run`): 150 files, 1,694 tests, all pass.**
- `npx tsc --noEmit` is clean in both packages.
- `scripts/learningEvalLive.ts` type-checks on its own (`scripts/` is outside the backend tsconfig).
