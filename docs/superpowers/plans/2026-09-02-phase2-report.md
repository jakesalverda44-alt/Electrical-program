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
