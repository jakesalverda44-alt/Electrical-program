# Phase 2 — Takeoff Fidelity — Feature Report

## Summary

Implemented all six tasks of the approved plan
(`docs/superpowers/plans/2026-09-02-phase2-takeoff-fidelity.md`) on
`feat/phase2-takeoff-fidelity`: text-extract-first for schedules, title-block
page classification + selection (replacing per-file filename filtering),
corrected per-class tile fidelity math with configurable settings, compact
inter-agent handoffs plus an empty-analysis billing guard, confidence
surfacing through the Pricing tab to the estimator, and Agent 3 cross-checking
the independent Cowork pre-bid takeoff.

**This execution resumed an interrupted prior attempt.** State at resume:
Tasks 1–4 committed (`ec42f0c`, `b9cad4b`, `13c6875`, `318ccb0`); Task 5
in progress with uncommitted working-tree changes (all files already written,
no code missing); Task 6 not started. This session reviewed the Task 5
working tree file-by-file against the plan's five numbered requirements,
found it complete and correct (see below — no code changes were needed, only
verification and running the suites), committed it, then implemented and
committed Task 6, then wrote this report.

## Task 1 — Text-extract first (already committed, `ec42f0c`)

Not re-done this session; spot-checked via the full test run (`pdfText.test.ts`,
`documentPrep.test.ts` Task 1 cases — 33/33 pass together). Confirmed present:
`pdfText.ts` (`isPdftotextAvailable`, `extractPdfPageTexts`, `pageTextBlock`,
form-feed page splitting, the 200-char gate, the 12,000-char per-page /
150,000-char total-run caps with visible markers), wired into
`buildAgent1Content` so a text block precedes that page's tiles, and one
`AGENT1_SYSTEM` instruction (`prompts.ts:17`) telling Agent 1 to treat an
`EXTRACTED TEXT` block as the primary, VERIFIED source for that sheet.

## Task 2 — Classify pages by title block (already committed, `b9cad4b`)

Not re-done this session; spot-checked via the full test run
(`pageClassifier.test.ts`, `documentPrep.test.ts` Task 2 cases — pass).
Confirmed present: `pageClassifier.ts` (`renderTitleBlockCrops` at 100 DPI on
the right 25% strip, `classifyPages` batching ≤20 crops to
`ai_prep_classifier_model` default `claude-haiku-4-5-20251001`, pure
`selectPages` with default-include-on-unknown and the all-excluded guard),
wired into `preconstruction.ts` so PDFs are filtered page-by-page instead of
per-file, migration `089_prep_inventory.sql` (`prep_inventory JSONB`,
`prep_fidelity TEXT`), and the Plan Review UI line
`Prep: N of M pages sent (tiled+text)` (`PcWorkspace.tsx:1470`, amber when
`prep_fidelity === 'document-fallback'`).

## Task 3 — Fix the fidelity math (already committed, `13c6875`)

Not re-done this session; spot-checked via the full test run
(`documentPrep.test.ts` Task 3 grid-math + clamp cases — pass). Confirmed
present: per-class tile targets (`schedule` 8"/DPI 200/15 tiles, `detail`
12"/DPI 170/9 tiles, `plan` 16"/DPI 130/6 tiles) via a pure `computeTileGrid`,
the four settings (`ai_prep_dpi_schedule`, `ai_prep_dpi_plan`,
`ai_prep_tiles_schedule`, `ai_prep_tiles_plan`, clamped 72–300/1–24) read in
`loadAIConfig`, and the AISection.tsx Document Prep row. Re-verified the
memory-guard claim this session by reading `documentPrep.ts:300`: tile
extraction is `sharp(file).extract(...)` where `file` is the rasterized PNG's
path on disk, not a loaded-in-memory buffer — no change needed at higher DPI,
consistent with the commit's note.

## Task 4 — Structured handoffs + empty-analysis guard (already committed, `318ccb0`)

Not re-done this session; spot-checked via the full test run
(`compactPayload.test.ts`, `emptyAnalysis.test.ts` — pass). Confirmed present:
`compactForHandoff` (falls back to the original text unchanged when it isn't
parseable JSON) used in both the Agent 2 and Agent 3 request bodies; pure
`analysisIsEmpty` checked in `runPipeline` right after Agent 1's JSON parses,
stopping the run with an actionable `agent1_output` error before Agent 2 ever
runs. **Measured token-size delta** (from the commit message, on a realistic
Agent 1 fixture): pretty-printed 3515 chars → compact 2432 chars, **~31%
reduction** on the largest payload in the system.

## Task 5 — Confidence survives to the estimator's screen

**Commit `0f20021`.** Reviewed the full uncommitted working tree against the
plan's five numbered requirements before committing — all five were already
implemented correctly; no code changes were needed this session beyond
running the suites and committing.

1. `frontend/src/features/preconstruction/confidence.ts` (new):
   `confidenceToPlaybook` maps `VERIFIED→FIRM`, `ASSUMED→APPROX`,
   `NOT SHOWN→VERIFY`, passes already-playbook values through unchanged, and
   returns `null` for unknown/absent — case-insensitive, whitespace-trimmed.
   Agent prompts' own vocabulary is untouched; this is a Pricing-tab-boundary
   mapping only.
2. `PcWorkspace.tsx`: `buildLineItemsFromTakeoff` carries each row's
   `confidence` through into the pricing line item; the Pricing tab renders a
   per-row FIRM/APPROX/VERIFY chip (green/amber, reusing the Agent 2
   structured view's existing `pill()` helper, lifted to module scope so both
   call sites share it) plus a header count (`N FIRM · N APPROX · N VERIFY`).
   `confidence?: string` added to `EstimateLineItem` (`frontend/src/types/index.ts`)
   and to the route's request type (`backend/src/routes/estimates.ts` —
   type-only; `line_items` is already JSONB and the route already round-trips
   whatever fields are sent, so no migration).
3. The $0-lineitem save toast gained a VERIFY-count clause
   (`"… · N items need verification"`) only when `> 0`.
4. New `backend/src/test/proposalDocxConfidenceGuard.test.ts`: generates a
   real proposal `.docx` from takeoff rows carrying a stray `confidence`
   field the schema doesn't define, and asserts the rendered document never
   contains `FIRM`/`APPROX`/`VERIFY`/`VERIFIED`/`ASSUMED` — confirmed by
   reading `proposalDocx.ts` that it reads only
   category/item/description/unit/qty/sourceNotes per takeoff row, so the
   guard proves the renderer safely ignores an unexpected field rather than
   someone later naively spreading the whole row into a cell.
5. Tests: `confidence.test.ts` (7 cases, the mapping); `PcWorkspacePricing.test.tsx`
   gained 4 new cases (chip rendering, header count, VERIFY toast clause
   present/absent); `backend/src/test/estimates.confidence.test.ts` (2 cases,
   DB-gated — a per-line confidence value round-trips through `PUT` then
   `GET`, and an older line item with no `confidence` field still works).

**Verification this session:** ran the full backend and frontend suites (see
final counts below) — all Task 5 tests pass; no regressions.

## Task 6 — Pre-bid cross-check feeds Agent 3

**Commit `89858c0`.**

1. New `backend/src/ai/agent3CrossCheck.ts`: pure `buildPrebidCrossCheck(prebid)`
   groups a `bid_takeoffs kind='prebid'` row's `line_items` by category
   (preferring the row's own `categories` order, falling back to
   first-appearance order when `categories` is absent or incomplete) and
   emits `--- INDEPENDENT PRE-BID TAKEOFF (human-reviewed Cowork package) ---`
   followed by `- <description> — <qty or UNRESOLVED> [<confidence>]` per row.
   Returns `null` when there is no row or zero line items. Capped at 20,000
   chars with a `[TRUNCATED — pre-bid cross-check exceeded limit]` marker.
   Makes no AI/DB calls — pure formatting off an already-loaded row, per the
   plan's "AI calls cannot be integration-tested" ground rule.
2. `preconstruction.ts` `runPipeline`, Agent 3 section: loads the prebid row
   (`SELECT categories, line_items FROM bid_takeoffs WHERE bid_id=$1 AND
   kind='prebid'`) inside its own try/catch — a missing table row, or a query
   failure, degrades to `null` (today's behavior) and is logged, never blocks
   the run. When non-null, the cross-check block is appended to Agent 3's
   user message after the compact Agent 1/2 JSON.
3. `AGENT3_SYSTEM` (`prompts.ts`) gained one paragraph ("PRE-BID
   CROSS-CHECK: ..."): when the block is present, a >20% quantity mismatch or
   a category present in only one of the two independent takeoffs becomes a
   `conflicts[]` entry citing both numbers; agreement between the two upgrades
   the confidence assessment; the pre-bid's UNRESOLVED items route into
   `missingFromScope[]` when Agent 2 also lacks them. No other prompt text
   changed.
4. Tests (`agent3CrossCheck.test.ts`, 8 cases): builder output shape
   (header, per-category grouping, description/qty/confidence format);
   null on no pre-bid (missing row, empty/null `line_items`); UNRESOLVED
   rendering for a `qty: null` row (never `"null"` or a bare `"0"`); category
   order from the row's `categories` list winning over first-appearance
   order, with a fallback when `categories` is absent or omits a category
   present in `line_items`; the 20,000-char cap with its visible marker.

**Verification this session:** `agent3CrossCheck.test.ts` 8/8 pass standalone;
full backend suite re-run afterward, no regressions (test count moved by
exactly +8, matching the new file).

## Verification (whole phase, plan's Verification section)

1. `cd backend && npm run typecheck` — clean. `npm test` — **440 tests
   total, 439 pass, 1 fail** (pre-existing, unrelated — see below), 0 skipped.
   Exceeds the plan's 361+ floor (Phase 1's count); the increase over Phase
   1's 361 reflects both phases' new test files.
   `cd frontend && npm run typecheck` — clean. `npm test` — **322 tests
   total, 313 pass, 9 fail** — exactly the plan's documented 9 known
   pre-existing failures (PWA install-prompt ×7, CustomerHub preview ×2),
   exceeding the plan's 299+ floor.
2. Traced by reading the final code (not re-running live AI):
   - (a) A text-rich schedule page produces a text block before its tiles —
     `documentPrep.ts`'s Task 1 wiring inserts the `pageTextBlock(...)` output
     ahead of that page's tile blocks in the same content array;
     `documentPrep.test.ts`'s "inserts an EXTRACTED TEXT block before that
     page's tiles" case asserts the ordering directly. ✓
   - (b) A 62-page set with 19 electrical pages tiles only ~19 pages plus
     cover — `selectPages` (Task 2) default-includes
     electrical/fuel/lowvoltage/cover/unclassified and excludes the rest;
     `pdfToTiledImageBlocks`'s `pages?: number[]` option rasterizes only the
     selected pages via `pdftoppm -f/-l` per contiguous run
     (`documentPrep.ts`), confirmed by reading the call site in
     `preconstruction.ts`. ✓
   - (c) Schedule tiles now target 8"/200 DPI — `documentPrep.ts`'s
     `tileSettingsFor('schedule')` returns `{ tileInches: 8, dpi: 200,
     maxTilesPerPage: 15 }`, confirmed by reading the function and by
     `documentPrep.test.ts`'s grid-math assertions (5×3 on a 36×24 sheet). ✓
   - (d) Agent 2's message contains compact JSON —
     `preconstruction.ts:564`'s Agent 2 `content` string embeds
     `compactForHandoff(agent1Output)`, confirmed by reading the call site and
     by `compactPayload.test.ts`. ✓
   - (e) An all-empty analysis stops before Agent 2 — `runPipeline` calls
     `analysisIsEmpty(a1)` immediately after parsing Agent 1's JSON and, when
     true, writes `status='error'` with the actionable message and `return`s
     before the Agent 2 section, confirmed by reading the code around that
     check. ✓
   - (f) A VERIFY chip renders in Pricing — `PcWorkspace.tsx`'s Pricing tab
     renders `pill(c, confChipColor(c))` per row when
     `confidenceToPlaybook(li.confidence)` is non-null, confirmed by reading
     the render code and by `PcWorkspacePricing.test.tsx`'s
     "renders a FIRM chip for VERIFIED and an APPROX chip for ASSUMED..."
     case (which also asserts a VERIFY chip from `NOT SHOWN`). ✓
   - (g) Agent 3's message includes the pre-bid block when one exists —
     `preconstruction.ts`'s Agent 3 section appends
     `\n\n---\n\n${prebidCrossCheck}` to the request `content` when
     `buildPrebidCrossCheck(...)` returns non-null, confirmed by reading the
     call site added this session. ✓
3. Token-size deltas: see Task 4 above (~31% reduction, 3515→2432 chars on a
   realistic Agent 1 fixture — measured and recorded in that task's commit
   message).
4. This report, committed with the final task's changes (Task 6, `89858c0`
   plus this report's own commit).

### Known pre-existing test failures — backend (unrelated to this plan)

`src/test/integration.test.ts > command center brief (integration) >
surfaces a needs-call Kohler lead as a lead-call item with a tel: CTA` fails
consistently (`expected undefined to be 'lead-call'`) on every run this
session, including runs before any Phase 2 Task 5/6 changes were committed.
`integration.test.ts` is not touched by this plan's diff, and its owning
feature commit (`cc4dce0`, "Command Center morning-brief dashboard") predates
the point this branch was cut from `main` (confirmed via
`git merge-base --is-ancestor cc4dce0 feat/phase2-takeoff-fidelity` →
ancestor) — pre-existing, out of scope, noted per instructions and left
unfixed.

### Known pre-existing test failures — frontend (unrelated to this plan)

9 failures across `src/hooks/useInstallPrompt.test.ts` (7, PWA install-prompt
API) and `src/features/contacts/CustomerHub.test.tsx` (2, document-preview
`localStorage` access) — exactly the set the plan's Verification section
names as pre-existing. Neither file is touched by this plan's diff. Not
fixed — outside this plan's scope.

## Files changed (this session: Task 5 review/commit, Task 6)

- `backend/src/routes/estimates.ts` — `confidence?: string` on the `PUT`
  request type (type-only).
- `frontend/src/types/index.ts` — `confidence?: string` on `EstimateLineItem`.
- `frontend/src/features/preconstruction/confidence.ts` (new) +
  `confidence.test.ts` (new) — the FIRM/APPROX/VERIFY mapping.
- `frontend/src/features/preconstruction/PcWorkspace.tsx` — confidence chips,
  header count, VERIFY-count toast clause.
- `frontend/src/features/preconstruction/PcWorkspacePricing.test.tsx` — 4 new
  confidence-chip/toast cases.
- `backend/src/test/estimates.confidence.test.ts` (new) — DB-gated
  round-trip test.
- `backend/src/test/proposalDocxConfidenceGuard.test.ts` (new) — DB-gated
  GC-document confidence-leak guard.
- `backend/src/ai/agent3CrossCheck.ts` (new) + `agent3CrossCheck.test.ts`
  (new) — the pre-bid cross-check builder.
- `backend/src/routes/preconstruction.ts` — loads the prebid row and appends
  the cross-check block to Agent 3's message.
- `backend/src/ai/prompts.ts` — `AGENT3_SYSTEM` reconciliation paragraph.

## Commits (this branch, in order)

- `92081fd` — plan doc.
- `ec42f0c` — Task 1 (already committed at resume).
- `b9cad4b` — Task 2 (already committed at resume).
- `13c6875` — Task 3 (already committed at resume).
- `318ccb0` — Task 4 (already committed at resume).
- `0f20021` — Task 5 (this session — reviewed the interrupted session's
  working tree, found it complete, ran the suites, committed).
- `89858c0` — Task 6 (this session).
- (this report's commit) — docs.

Not pushed, per instructions.

## Safety confirmation

- All tests run via `npm test` only (`NODE_ENV=test DB_NAME=electrical_crm_test
  vitest run`), never `npx vitest` directly against the default env — verified
  the live-DB hard guard is still in place by attempting `npx vitest run` on
  the DB-gated integration file without the env vars set, which correctly
  refused to run against `electrical_crm` (see the "Refusing to run tests
  against the live database" error surfaced mid-session).
- No dev servers started (`npm run dev` / `crm.sh` never invoked).
- No changes made outside
  `/Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-phase2` —
  the "Local Version" live-dev checkout and the `-wt-intake` worktree were
  never touched.
- No merge/rebase onto `main` performed, per instructions — the branch's only
  new commits are the two from this session (`0f20021`, `89858c0`) plus this
  report's commit.
- One commit per task; no `--amend`, no force operations, nothing pushed.

## Post-review fixes

An adversarial review of the merged phase found eight defects (FIX-1 through
FIX-8 below), all verified against the code before fixing. This section
covers the fix round, executed as its own set of commits on
`feat/phase2-takeoff-fidelity` after the six tasks above.

### FIX-1 (HIGH) — restore the filename fallback for purely non-electrical PDFs

**Commit `20ac159`.** `documentPrep.ts`'s per-file `isElectricalSheet` filter
stopped applying to PDFs once Task 2 switched to page-level classification —
combined with `pageClassifier.selectPages`'s per-file all-excluded guard
(which falls back to including *every* page when a real selection would be
empty), a purely architectural PDF uploaded alongside a real electrical set
(e.g. `"A101 Architectural.pdf"`) rode that guard straight into full tiling
and billing.

- `selectPages` now returns `{ pages, allExcluded }` instead of a bare
  array — the guard firing is a fact callers can inspect, not something
  baked silently into the returned page list.
- `isElectricalSheet` moved from `preconstruction.ts` to `documentPrep.ts`
  (exported) so `pageClassifier.ts` can use it without a circular import.
- New pure `pageClassifier.shouldDropWholeFile(classifications, filename)`:
  true only when the guard fired AND the filename itself reads as
  non-electrical — an electrical/ambiguous filename keeps today's
  include-everything fallback exactly as before.
- New pure `pageClassifier.reviveIfAllDropped(files)`: the whole-upload
  safety net — if every classified PDF in a batch would be dropped, revert
  every drop rather than sending Agent 1 nothing (mirrors the pre-existing
  `isElectricalSheet`-based `filesToSend` guard for non-PDF images).
- `preconstruction.ts`'s `classifyAndSelectPdfPages` (later folded into
  FIX-2's `prepOnePdf`) applies the drop decision and records dropped pages
  in `prep_inventory` with `included: false` and a `reason` string instead
  of vanishing silently.
- Tests (`pageClassifier.test.ts`): `shouldDropWholeFile` — architectural
  filename + all-non-electrical pages drops; electrical filename + all-other
  pages does not drop; ambiguous filename does not drop; a real (non-guard)
  selection is never dropped regardless of filename. `reviveIfAllDropped` —
  reverts when every file is dropped; leaves drops alone when at least one
  file survives; no-op on empty input. `selectPages`'s existing tests
  updated for the new `{pages, allExcluded}` shape.

### FIX-2 (HIGH, own commit) — batch Agent 1 by estimated token budget, not file count

**Commit `390e962`.** Stage 0 split work into one Agent 1 call per
`BATCH_SIZE` *files* (1 file/call whenever more than one PDF was uploaded,
otherwise the whole upload in a single call) — unrelated to how much content
a call actually carries. A single combined PDF with ~19 selected pages went
out as ONE call: at up to 15 tiles/page (Task 3's schedule-class cap) and
~3000 estimated tokens/tile, that's comfortably over the 200k context window
and matches the plan's own "~400s timeout" headline scenario. This was also
the fix that required addressing the reviewer's F6 finding
(`extractPdfPageTexts` running twice per PDF).

**New `backend/src/ai/agent1Batching.ts`** (pure packing + one non-pure
block-builder):
- `TOKENS_PER_TILE = 3000` — approximates Anthropic's `(width_px *
  height_px) / 750` vision pricing post the 1568px-long-edge downscale;
  documented in the module comment rather than measuring each tile's actual
  pixel dimensions (the whole point is estimating *before* paying the
  rasterization cost).
- `tilesForClass(cls)` — a class's `maxTilesPerPage` (Task 3) doubles as the
  natural full-grid tile count for a standard 36x24 sheet at that class's
  target tile size, so it's a reasonable pre-rasterization estimate.
- `estimatePageTokens(cls, textChars)` = `tilesForClass(cls) *
  TOKENS_PER_TILE + ceil(textChars / 4) + PAGE_TOKEN_OVERHEAD(200)`.
- `orderScheduleFirst(units)` — stable sort, schedule pages before detail
  before plan, across the *whole* upload (not just within one file).
- `packPagesByBudget(units, budget)` — greedy packer: appends to the
  current batch until it would exceed `AGENT1_INPUT_BUDGET = 100_000`, then
  starts a new one; a single unit whose own estimate exceeds the budget gets
  isolated into its own batch rather than blocking the packer.
- `buildBlocksForBatch(units)` — the non-pure counterpart: groups a batch's
  PDF-page units by filename (one `tilesForSelectedPdfPages` call per file
  per batch, regardless of how the packer interleaved pages from different
  files), then reassembles blocks in the batch's original packed order. The
  Task 1 total-text cap (`TOTAL_TEXT_CAP`) is now scoped **per batch**
  rather than per whole run — its purpose was always to protect a single
  Agent 1 call's context window, which is now this batch's job exactly once
  per call instead of once for a possibly-multi-call upload.

**`preconstruction.ts` restructuring:**
- `prepOnePdf` — classification, page selection, and text extraction run
  **exactly once per file** (fixes F6). Returns `pages: PdfPageSelection[] |
  null`: non-null whenever a page count is known, either from a real
  classification or, when classification fails outright but `pdftotext`
  still succeeded, a synthesized uniform filename-based selection (today's
  whole-file `classifySheet` guess) covering every known page — so even a
  classifier failure still packs by the token budget instead of going out
  as one oversized call. `pages` is `null` only in the true last-resort
  case (poppler entirely unavailable, or `pdftotext` also unavailable/failed
  after classification did) — that PDF goes out as a single opaque document
  block, sized to force it into its own batch since its true size is
  unknown.
- `prepareAgent1Upload` — builds one `Agent1WorkUnit` per page (or per
  whole file for images/opaque fallbacks) across the *entire* upload, wires
  in FIX-1's drop/revive logic, orders schedule-first, packs by budget, and
  turns each packed batch into Agent 1 content blocks.
- `runPipeline`'s Agent 1 section now iterates `agent1Batches` (however many
  the packer produced) instead of file-count-derived batches; a single
  batch still takes the pre-existing single-pass code path (`agent1Batches.length
  <= 1`), multiple batches still go through the pre-existing
  `mergeAgent1Batches` merge path — neither downstream path changed.

**Two other fixes ride along in this same rewritten code** (both touch
lines this restructuring necessarily rewrites — not practically separable
into their own commits):
- **FIX-5's inventory `classified` flag** — `PrepInventoryEntry` gained
  `classified: boolean`, set from `c.discipline !== 'unknown'` inside
  `prepOnePdf`'s inventory-building code.
- **FIX-7 (LOW)** — `usage_agent1` now persists the FULL Anthropic `usage`
  shape. Single-pass path: `{ ...resp.usage, input_tokens: ..., output_tokens:
  ... }` (spreads `cache_creation_input_tokens`/`cache_read_input_tokens`
  through, only overriding the two token counts to fold in classifier
  usage). Multi-batch path: a new `mergeUsage(a, b)` helper sums every
  numeric field across batches (and classifier usage) instead of reshaping
  down to just `input_tokens`/`output_tokens`.

**Tests** (`agent1Batching.test.ts`, 14 cases): `tilesForClass` /
`estimatePageTokens` composition; `orderScheduleFirst` grouping, stability,
non-mutation; `packPagesByBudget` — fits-in-one, splits-at-budget,
oversized-single-page isolation, ordering preserved across all batches,
empty input. A **realistic 62-page/19-selected-page scenario** (3 schedule +
2 detail + 14 plan pages, matching a plausible c-store electrical section
mix) asserts every resulting batch is `<= AGENT1_INPUT_BUDGET` and that
every page appears exactly once across the batches in order.

**Plan-verification trace update (supersedes the original Task 2 trace item
"(b) a 62-page set with 19 electrical pages tiles only ~19 pages plus
cover"):** with the realistic mix above, `packPagesByBudget` produces
**5 calls**, each measured under the 100k-token budget:

```
batch 1: pages [44,45]          ~90,650 est. tokens (2 schedule pages)
batch 2: pages [46,47,48]       ~99,975 est. tokens (1 schedule + 2 detail)
batch 3: pages [49,50,51,52,53] ~91,625 est. tokens (5 plan)
batch 4: pages [54,55,56,57,58] ~91,625 est. tokens (5 plan)
batch 5: pages [59,60,61,62]    ~73,300 est. tokens (4 plan)
```

The exact call count depends on the real set's class mix — an all-plan
section would pack tighter (closer to 2 calls); a schedule-heavy section
(every schedule page near the ~44k-token/page estimate the reviewer's own
math used) packs looser. What's invariant, and what this fix actually
guarantees, is that **every batch fits under budget** — the headline
scenario (one oversized call, ~400s timeout risk) cannot happen regardless
of mix.

### FIX-3 (MED-HIGH) — confidence chips were dead on any bid with a saved estimate

**Commit `3dfdf4d`.** `PcWorkspace.tsx`'s `computePricingItems` short-circuited
to `savedEstimate.line_items` whenever a saved estimate existed — old rows
(saved before confidence tracking existed, or from any other path that
didn't carry it) have no `confidence` field, so the chips, header count, and
save-toast clause never appeared, and re-running the takeoff didn't help
because this branch never looked at the fresh takeoff again.

`computePricingItems` now also builds the fresh takeoff (`buildLineItemsFromTakeoff`
off `aiResults?.agent2_output`) whenever a saved estimate exists, and
backfills each saved row's confidence by `category||item` key from the
fresh build — **only when the saved row's own `confidence` is `undefined`**,
never overwriting a value the saved row already carries.

Tests (`PcWorkspacePricing.test.tsx`, 2 new cases): a saved estimate with
one row missing confidence and one row carrying its own (`ASSUMED`) +
a fresh agent2 takeoff with `VERIFIED` values for both — asserts the
missing row backfills to a FIRM chip while the existing row's APPROX chip
is untouched (header count `1 FIRM · 1 APPROX · 0 VERIFY`); a saved estimate
with no matching fresh-takeoff row renders no chips at all (nothing to
backfill from).

### FIX-4 (MED) — sheet-label/EXTRACTED-TEXT header collision broke per-sheet logging

**Commit `daea4ad`.** The page-selection tiling path in `documentPrep.ts`
emitted `--- Sheet <label> ---` (no colon) while `preconstruction.ts`'s
`summarizePrep` matches `'--- Sheet:'` (with colon) to attribute tiles to a
sheet for logging — so per-sheet tile counts silently broke for every
page-classified PDF (Task 2's whole point). Fixed by adding the colon back;
`summarizePrep` additionally now explicitly excludes any block containing
`'EXTRACTED TEXT'` (pdfText.ts's per-page text header, which is `'--- Sheet
<label> p<N> — EXTRACTED TEXT ...'` — no colon) so the two header shapes can
never be confused regardless of future label text.

The `documentPrep.test.ts` assertions that counted "sheets" via
`b.text.startsWith('--- Sheet')` (no colon) were fragile in exactly the way
the review flagged — they'd also match an EXTRACTED TEXT header. Updated to
`startsWith('--- Sheet:')`, and a new test proves it: a page with >=200
chars of text (which *does* produce an EXTRACTED TEXT block, per Task 1)
still yields exactly one real sheet label, not two.

### FIX-5 (MED) — unclassifiable pages defaulted to the lowest fidelity class

**Commit `daea4ad`** (classifier-side pieces) **+ `390e962`** (the
inventory `classified` flag, which lands inside FIX-2's rewritten
`prepOnePdf` — see FIX-2 above). `pageClassifier.parseClassifierJSON`
defaulted a missing/invalid page entry to `cls: 'plan'` — 16"/130DPI, ~98
px/in, the *lowest*-fidelity class, directly contradicting
`documentPrep.ts`'s own stated "safer = more detail" philosophy for an
unknown sheet. Both default sites (missing entry entirely; present but
invalid `cls` value) now default to `'schedule'` (8"/200DPI, the highest
per-class fidelity) instead.

Also hardened batch numbering: `pageClassifier.ts`'s per-crop content block
now reads `"Page N (absolute page number in the full document):"`, the
per-batch instruction text explicitly says not to renumber from 1, and
`PAGE_CLASSIFIER_SYSTEM` (`prompts.ts`) gained a "PAGE NUMBERS" section
making the same point. A new pure `reoffsetIfRelative(rawPages,
expectedPages)` tolerates a model that ignores all of that and returns a
relative `1..N` sequence anyway: detected only when the raw response is
*exactly* `[1, 2, ..., N]` in order and that's not *also* what was actually
expected (so a legitimate single-batch run starting at page 1 is never
"corrected" into something wrong) — anything else (partial response,
out-of-order, genuine absolute numbers) is left untouched.
`parseClassifierJSON` applies the re-offset before building its `byPage`
lookup, so a relative-numbered batch 2+ no longer has every page silently
fall back to `unknown`.

Tests (`pageClassifier.test.ts`): `reoffsetIfRelative` — re-offsets a
relative response to the expected absolute numbers; leaves a genuinely
absolute response untouched; does not "correct" a legitimate page-1-start
run; leaves a mismatched-length or out-of-order response untouched; no-op
on empty input. `parseClassifierJSON`'s existing default-value tests
updated to `'schedule'`; a new end-to-end case feeds a batch-2-shaped
1-3-numbered response with `expectedPages [21,22,23]` and asserts it
resolves to real classifications keyed by 21/22/23, not three `unknown`
entries.

### FIX-6 (MED) — tiles now encode as JPEG, not PNG

**Commit `daea4ad`.** `documentPrep.ts`'s tile extraction emitted every
tile as PNG (`~0.5-1MB` each for dense line-art); 20 pages x up to 15
tiles/page (Task 3's schedule-class cap) risked OOM and a giant request
body. Switched to `.jpeg({ quality: 85 })` / `image/jpeg` — a lossy
re-encode of an already-downscaled raster, not the source drawing, so text
legibility at that quality is unaffected in practice.

A plain uploaded image (e.g. a `.png` the estimator attaches directly) is
unaffected — that's a straight passthrough of the original file's own
media type (`imageToBlock`), never a generated tile.

Test (`documentPrep.test.ts`): rasterizes a real PDF page through
`buildAgent1Content` and asserts every resulting `image` block's
`media_type` is `image/jpeg`.

### FIX-7 (LOW) — usage_agent1 lost its cache fields on the single-pass path

**Commit `390e962`**, folded into FIX-2 (see above — same rewritten usage-
merging code). Summary: single-pass path spreads `resp.usage` before
overriding `input_tokens`/`output_tokens`, so `cache_creation_input_tokens`/
`cache_read_input_tokens` survive; the multi-batch path sums every numeric
usage field across batches via a new `mergeUsage` helper instead of
reshaping down to two fields.

### FIX-8 (LOW) — ai_prep_classifier_model was unsettable from the UI

**Commit `3dfdf4d`.** `ai_prep_classifier_model` was already read in
`loadAIConfig` and present in `AppSettings`, but `AISection.tsx` had no
field for it. Added as a model `<select>` in the "Document Prep" section
(following the existing per-agent model-dropdown pattern), defaulting to
`claude-haiku-4-5-20251001`.

### Verification (post-review fix round)

- `cd backend && npm run typecheck` — clean. `npm test` — **470 tests
  total, 469 pass, 1 fail** (the same pre-existing `integration.test.ts`
  Kohler-brief failure documented above — untouched by this round's diff,
  confirmed still failing identically before and after).
- `cd frontend && npm run typecheck` — clean. `npm test` — **324 tests
  total, 315 pass, 9 fail** — exactly the 9 pre-existing failures documented
  above (PWA install-prompt x7, CustomerHub preview x2) — untouched by this
  round's diff.
- Working tree clean after each commit; no `--amend`, no force operations,
  nothing pushed.

### Commits (post-review fix round, in order)

- `20ac159` — FIX-1 (drop purely non-electrical PDFs).
- `390e962` — FIX-2, own commit as required (token-budget batching; carries
  FIX-5's inventory flag and FIX-7 as unavoidable same-code riders).
- `daea4ad` — FIX-4 + FIX-5's classifier-side pieces + FIX-6 (sheet-label
  colon, safer classifier default, absolute page numbering, JPEG tiles).
- `3dfdf4d` — FIX-3 + FIX-8 (confidence backfill, classifier model setting).
- (this section's commit) — report update, committed last per instructions.

Out of scope for this round, per instructions: prompt-text sanitization
(deferred to Phase 3), classifier cost attribution changes, and any further
temp-file write reduction beyond FIX-2(a)'s single-extraction change.
