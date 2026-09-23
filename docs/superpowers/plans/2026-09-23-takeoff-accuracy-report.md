# Takeoff accuracy — execution report (2026-09-23)

Branch `feat/takeoff-accuracy`, worktree `Electrical-program-wt-takeoff-accuracy`.
Commits `b17fd90` (plan copy) .. `HEAD` (this report). Not pushed. Local
Version was never touched. No real Anthropic or Drive calls, no email, and the
eval harness was never run against the API.

## Commits

| Commit | Task |
|---|---|
| b17fd90 | Plan copied into the worktree |
| 1bfffdc | 1 — fail on `max_tokens` for every agent call; counter model settings |
| b06856e | 2 — count-target type list + Agent 1 counting sections |
| b29bc05 | 3 — 300 DPI renderer, ≤8" tiles with 1" overlap |
| a26a74e | 4 — counter agent (Agent 1C), strict parse, overlap de-dup |
| 05799bc | 5 — merge into the takeoff (cross-sheet rules, poles vs heads, load check) |
| 39a7a22 | 6 — AI-counted locations as suggested markers in the Plans view |
| 0097ee2 | 7 backend + Task 1 follow-ups (robust JSON fences, Agent 4 failure detail) |
| 3e3bb4f | 7 frontend — Needs-review panel; proposal blocked while it's open |
| e0b436c | Task 1 follow-up — every agent call streams |
| 65d9f09 | 8 — account rules (fixed or `ask`, drawings-aware, enforced after Agent 4) |
| dde638e | 9 — output hygiene |
| 3477794 | 10 — eval harness (dry run by default) + Kissimmee expected file |
| 2f0509c | 11 — estimator scope list, non-electrical gate, near-duplicates (Lake City) |
| a80d999 | 12 — pre-bid draft right after the analysis; package from it; proposal reuses it |
| e80a787 | 13 — proposal matches the Cowork format and style |

Each commit message describes what it did in detail. This report summarizes and
lists what is **not** done.

## Test suites

| Suite | Baseline (before Task 1) | Final |
|---|---|---|
| Backend | 1160–1161 passed of 1166, 118 files (known flakes: intakeSimilarCache, notificationsRetention) | 1340 passed, 4 failed, 4 skipped of 1348, 138 files (see note) |
| Frontend | 1188 / 1188, 115 files | 1214 / 1214, 121 files (clean rerun — see note) |

Backend final run, 4 failures:
- **2 × intakeSimilarCache.** This is the known flake. One of them fails
  again when the file is run alone.
- **1 × integration.test lead follow-up backfill.** This is a 30 s timeout
  under full-suite load and is not related to this work. It passes when run
  alone.
- **1 × takeoffTruncation "every agent call streams".** This was a real
  stale expectation left by Task 12. Since Task 12, `runPipeline` composes the
  pre-bid draft right after the analysis, which adds a fourth streamed call at
  Agent 4's Max Tokens. The test was updated in the report commit and now
  passes (4/4).

So once that fix is counted, only the known flake and the load timeout remain.

The first full backend run of the session hit a worker crash ("Worker exited
unexpectedly"). It reported 18 failures of 1325 because the crashed worker's
files were lost. The rerun above replaces it.

The first full frontend run reported 4 failures in 5 files plus 1 unhandled
error. Only the summary tail was captured, so which tests failed is not known.
An immediate clean rerun passed 1214/1214. The known frontend flake is
`SurveyMarkupEditor`, and this is treated as that kind of flakiness, but it was
not confirmed.

Task 13 also corrected one stale Task 12 test expectation: the pre-bid package
message now says the draft isn't ready.

## Key design choices

### Counter call split: one call per sheet
Each counted plan sheet goes to Opus 5.5 as **one call**: all of its tiles plus
the full type list. The sheet is split into **whole-row tile groups only when it
would exceed 20 images or 24 MB of base64** (`groupTilesForCalls`). Why:

- A symbol in an overlap band shows up in two or four tiles. De-dup
  (same type, different tiles, within 18 pt = 0.25", and inside both tiles) is
  most reliable when one response sees every tile of the sheet.
- The type list and the system prompt are sent once per sheet, not once per tile.
- A D-size sheet (36×24", title strip excluded) comes to about 5×3 = 15–20
  tiles, which is inside the per-request image limit. Groups are made of whole
  rows so every overlap band that gets split still falls between two
  neighbouring groups, and cross-group de-dup still works on PDF points.
- Concurrency is capped at 3 calls. A failed sheet fails alone. A truncated
  sheet fails the run.

### Estimated Opus token budget per plan sheet
- Each tile is at most 1568 px on the long edge, so it costs about 3.3k input
  tokens (roughly w×h/750).
- A D-size sheet has about 20 tiles, so about 66k tokens of images. The system
  prompt and type list add about 2–4k, for **~70k input**.
- Output with effort `high` (thinking plus `[type,tile,x,y]` marks) runs about
  **10–20k**.
- At $4/$20 per MTok, that is about **$0.50–0.70 per sheet**. A typical
  AutoZone set counts 3–5 plan sheets, so the counter costs about **$2–3.50 per
  run**.
- These are estimates, not measurements. The eval harness prints real usage
  per stage the first time it runs.

### Other decisions
- The counter tiles are sized for 1568 px (≥196 px/in). Opus 5.5 accepts
  2576 px images. Using that would allow larger tiles and fewer calls, but it
  was left alone to stay inside Decision 3's numbers.
- Streaming everywhere: the SDK rejects a non-streaming request above about
  21,333 `max_tokens`, which is what caused the live Agent 4 failure. The test
  fake enforces the same rule, so any call site that regresses fails in tests.
- The pre-bid draft is Agent 4 in draft mode, not a separate composer. It has
  one output contract, so the account terms, scope list, review resolutions and
  verification apply to both documents.
- Account terms are either fixed or `ask`:
  - For `ask`, an explicit drawing statement wins (and is cited).
  - An `ask` term with no statement becomes a blocking scope question.
  - A fixed rule value that conflicts with the drawings becomes a conflict
    question. It is never silently overridden.

## Task 13 — format and style (Cowork match)
The renderer now matches Cowork's proposal:
- **Header block:** date, bold GC, Attn, email, Re with the store number, address, Job No.
- **Intro:** bold.
- **Section bands:** shaded navy bands.
- **Bullets:** a small • with a tight hanging indent, and bold-lead `{b,t}` bullets.
- **Takeoff table:**
  - no borders and fixed widths
  - navy header row that repeats on each page
  - light-blue section rows and numbered items
  - no CKT rows (removed and reported as a correction) and no zero rows
  - rows never split across pages
- **Sheet citation:** electrical sheets plus photometric/civil sheets only.
- **Terms page.**
- **Price line:** the amount in words and in figures
  (`amountWords.ts`, tested for cents, thousands and hundred-thousands), kept
  on the same page as the signature block.
- **PDF:** generate-docx already converts through LibreOffice and files the
  PDF. draft-proposal already attaches the PDF when one exists; that was
  existing behaviour and is covered by existing tests.
- **In-app Proposal Preview:** a white Letter-width page in the same format. It
  stays white in dark mode, and the colors are locked by a test. The account-term
  corrections and hygiene warnings are shown above it. The preview route returns
  the .docx's exact header, intro, price and description strings, so the two
  can't drift.
- **Structure test** (`utils/proposalCoworkStructure.test.ts`): checks the
  rendered Kissimmee reference against a committed Cowork outline:
  - header lines, intro, and band order
  - table columns and sections, and numbering restarting in each section
  - the price block, then the closing
  - page count ≤ Cowork's 6 (5 in LibreOffice)
- Cowork's two errors are **not** copied: disconnects are APT-furnished, and
  change orders are approved by the GC. The test asserts both.
- Renders at 60 DPI are in `2026-09-23-takeoff-accuracy-renders/`:
  - `before-*` (old CRM output, 7 pages)
  - `cowork-*` (Cowork reference, 6 pages)
  - `after-*` (new CRM output, 5 pages, continuous flow, no large gaps)

## For Jake to decide
1. **PROJECT_INSTRUCTIONS line 23 vs the 7-Eleven seed.** The skill says
   7-Eleven is "furnish by GC / **install by GC**" on fixtures, panels, etc. The
   plan's seed (and the rule as committed) says furnish by GC, **install by
   EC**. The seed follows the plan. Edit the rule in Settings → Account Rules if
   line 23 is right.
2. **Change orders.** PROJECT_INSTRUCTIONS lines 162 and 185 still say
   "approved/signed by the **Owner**". The CRM now says GC, per your
   instruction. The skill's text needs the same edit so the desktop bid system
   doesn't reintroduce it.
3. **AutoZone power poles** are `ask`. A job whose drawings are silent raises a
   scope question that blocks the proposal until it is answered.

## Migrations
- The plan owned **112–115**. **116** (`bid_scope_items`, Task 11) and **117**
  (pre-bid draft columns plus `agent4_source`, Task 12) come from the tasks
  added during the run.
- The next plan should start at **118**. If main has taken 112–117 in the
  meantime, renumber before merging.

## Not built / deferred / limits (honest list)
- **Eval not run.** `scripts/evalTakeoff.ts` is a dry run by default. It needs
  `--confirm-live-api` and Jake's OK. No counts from a real Opus run exist yet,
  so the per-sheet cost above is an estimate.
- **The load cross-check is job-wide, not per panel.** Decision 5 says per
  panel. Agent 1's panel circuits don't reliably tie each fixture type to a
  panel, so counted watts are compared with the total VA of lighting circuits.
  A kVA-looking circuit is excluded and flagged, never converted.
- **Panel-circuit fallback targets are weak.** They are used only when there is
  no fixture schedule, legend or equipment schedule, and they carry a warning.
  Circuit descriptions rarely map one-to-one to countable symbols.
- **Tiles are sized for 1568 px** even though Opus 5.5 supports 2576 px (see
  above).
- **Same-area detection** (enlarged plans, same level) relies on the page
  classifier's sheet titles and levels. A sheet with an unusual title can be
  summed when it should be max-kept. The merge flags every max-keep so the
  estimator sees it.
- **Counter accuracy on real drawings is unmeasured.** All counter tests use a
  perfect fake counter on real pdftoppm tiles of a committed vector fixture.
  They prove the geometry, de-dup and merge, not Opus's symbol recognition.
- **The in-app preview is HTML, not the PDF.** It matches the format; exact
  pagination comes only from the generated PDF.
- Project-type account rules (car wash, etc.) start empty, as the plan says.

## Files most worth reviewing
1. `backend/src/ai/counter.ts` — the prompt, the call split, strict parsing, overlap de-dup
2. `backend/src/ai/countMerge.ts` — cross-sheet rules, poles vs heads, the load check
3. `backend/src/ai/countRender.ts` and `backend/src/estimating/pageGeometry.ts` — tiling and the point math
4. `backend/src/bidstd/accountRules.ts` — `ask` vs fixed terms, conflicts, and enforcement on Agent 4 output
5. `backend/src/routes/preconstruction.ts` — `runPipeline` (counting stage), `composeCurrentBidData`, the review gate, `runDraftComposition` and draft reuse
6. `backend/src/ai/outputHygiene.ts`, `backend/src/bidstd/scopeList.ts`, `backend/src/bidstd/verifyBid.ts`
7. `backend/src/utils/proposalDocx.ts` and `frontend/src/features/preconstruction/PcWorkspace/ProposalPaper.tsx`
8. `frontend/src/features/preconstruction/PcWorkspace/TakeoffReviewPanel.tsx`
