# Phase 2 — Takeoff Fidelity: Port the Playbook's Method into the Pipeline

**Date:** 2026-09-02
**Status:** Approved plan, pending implementation
**Planned by:** Fable 5 · **Execution:** Sonnet 5 · **Review:** Fable 5
**Depends on:** Phase 1 (merged to main 2026-09-02, commit 825df3e)

## Problem

The AI takeoff pipeline reads plans at a fraction of the fidelity of the manual
playbook method (`~/.claude/skills/apt-electrical-bid/docs/Takeoff_Process.md`),
which is why the desktop workflow still beats the app on accuracy:

1. **No text extraction anywhere.** The playbook's rule #1 is text-extract first —
   `pdftotext` on schedules gives FIRM numbers (luminaire schedules, panel/feeder
   tables, equipment schedules). The pipeline rasterizes everything and asks a
   vision model to *read* numbers that are sitting in the PDF as literal text.
2. **Sheets are classified by filename** (`classifySheet`, `isElectricalSheet` in
   `documentPrep.ts` / `preconstruction.ts`) — the playbook explicitly says
   "identify sheet types by title block, not filename." Worse, filtering is
   per-FILE: a 62-page combined building set (electrical = pp. 44–62, like the
   Nick & Moe's example) is sent in its entirety — 40+ non-electrical pages
   rasterized, tiled, and billed.
3. **Tile fidelity is capped wrong.** Every tile is downscaled to 1568 px on the
   long edge, so effective resolution is `1568 / tileInches` px/in regardless of
   raster DPI — schedule tiles at 11" get ~142 px/in ceiling, and the flat
   `maxTilesPerPage = 9` cap forces even bigger (blurrier) tiles on dense 24×36
   sheets. Raising DPI alone gains nothing; the lever is smaller tiles.
4. **Handoffs are pretty-printed text blobs.** Agent 1's JSON goes to Agents 2/3
   2-space-indented (≈25% wasted tokens), and an all-empty analysis (`{}` from
   every batch failing) flows through as a valid-looking but contentless takeoff.
5. **Confidence dies at Agent 2.** Agent 1 emits VERIFIED/ASSUMED per quantity and
   Agent 2 carries a confidence field, but Pricing shows nothing — the estimator
   can't see which numbers are firm vs guessed, which the playbook treats as the
   core of a takeoff (FIRM/APPROX/VERIFY).
6. **The pre-bid package is ignored by the pipeline.** When a Cowork pre-bid
   takeoff exists (`bid_takeoffs kind='prebid'`), Agent 3's QC never sees it —
   throwing away the strongest QC available: two independent takeoffs to reconcile.
7. **Local dev runs low-fidelity silently.** Poppler is not installed on the dev
   Mac (verified 2026-09-02: `pdftotext` missing), so every local run takes the
   `document`-block fallback. Production (Aptfile) has it. The fallback is silent
   (one log line); the user was never told.

## Ground rules for execution (same as Phase 1 — the incident rules are permanent)

- **Never run tests against the live `electrical_crm` database.** The backend test
  script forces `electrical_crm_test` and the harness hard-fails on the live DB
  (Phase 1 Task 0) — do not weaken either. Outbound email is muted under test.
- **Work in an isolated git worktree**, never the main checkout (the dev server
  watches it): create `../Electrical-program-wt-phase2` off `main` from
  `/Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version`
  (quote paths — space and ampersand). Run `npm install` in backend/ and frontend/
  inside the worktree first.
- Never start dev servers (`npm run dev`, `crm.sh`). Typecheck + vitest only.
- Branch `feat/phase2-takeoff-fidelity`. One commit per task, imperative messages.
- Read every file before editing. Anchor on quoted code, not line numbers.
- Do not touch the gens pipeline, proposalDocx content/structure (Phase 3), or any
  delivery feature (Phase 4). Do not change the four agent prompts beyond what
  Tasks 5–6 specify.
- Feature report at `docs/superpowers/plans/2026-09-02-phase2-report.md`, committed
  with the final task.
- **AI calls cannot be integration-tested** (no Anthropic mocking infra). Put all
  new logic in pure, unit-tested functions; the AI-touching glue stays thin.

## Task 1 — Text-extract first (the playbook's rule #1)

**Files:** `backend/src/ai/documentPrep.ts`, new `backend/src/ai/pdfText.ts` + test.

1. New module `pdfText.ts`:
   - `isPdftotextAvailable()` — same cached-ENOENT pattern as `isPdftoppmAvailable`.
   - `extractPdfPageTexts(pdfBuffer): Promise<string[]>` — one
     `pdftotext -layout in.pdf -` run per PDF (write to the same mkdtemp pattern
     `pdfToTiledImageBlocks` uses), split the output on form-feed (`\f`) into
     per-page strings, `trim()` each. Throws on failure — callers degrade.
   - Pure helper `pageTextBlock(sheetLabel, pageNo, text, opts)` — builds the text
     content block, capping a single page at 12,000 chars with a visible
     `[TEXT TRUNCATED]` marker (mirror `truncateWithMarker` in `agent4Message.ts`).
2. In `buildAgent1Content`: for each PDF (when pdftotext is available), extract
   page texts once. For every page with ≥ 200 chars of extracted text, insert a
   text block **before** that page's tiles:
   `--- Sheet <label> p<N> — EXTRACTED TEXT (machine-read, treat as FIRM source) ---`
   followed by the page text. Pages with < 200 chars (pure raster / drawing-only)
   get no text block. Tiles are still produced for every page — schedules are
   sometimes raster, and plans always need vision — the text is additive.
3. Cap total extracted text per run at 150,000 chars (drop further page texts with
   one `[additional page text omitted — cap reached]` block) so a text-heavy spec
   book can't blow the context.
4. `AGENT1_SYSTEM` (prompts.ts): add one short instruction — when an
   `EXTRACTED TEXT` block exists for a sheet, treat its numbers as the primary
   source for that sheet (they are machine-read, not OCR), mark quantities read
   from it VERIFIED, and use the image tiles to resolve layout/symbols and anything
   the text lacks.
5. Tests (pure parts): form-feed splitting (multi-page, trailing \f, empty pages);
   the 200-char gate; per-page and total caps with markers; block ordering (text
   before tiles for the same page). Gate any test invoking real `pdftotext` on
   `isPdftotextAvailable()` — skip cleanly when absent.
6. **Fallback matrix stays graceful:** no pdftotext → today's behavior exactly; no
   pdftoppm but pdftotext present → text blocks + `document` block fallback (an
   improvement over today's document-only).

## Task 2 — Classify pages by title block, select pages, label sheets honestly

**Files:** new `backend/src/ai/pageClassifier.ts` + test, `documentPrep.ts`,
`preconstruction.ts` (`runPipeline` / `buildAgent1Blocks`), migration
`089_prep_inventory.sql`, `backend/src/ai/prompts.ts` (new small prompt const).

1. New module `pageClassifier.ts`:
   - `renderTitleBlockCrops(pdfBuffer)` — rasterize each page at 100 DPI
     (`pdftoppm`), crop the **right 25% strip, full height** (title blocks on
     arch/eng sheets live on the right edge or bottom-right corner; the strip
     covers both), sharp-resize to ≤ 800 px long edge, JPEG.
   - `classifyPages(client, model, crops, filename)` — batches of ≤ 20 crops per
     call to a cheap model (new setting `ai_prep_classifier_model`, default
     `claude-haiku-4-5-20251001`), with a new `PAGE_CLASSIFIER_SYSTEM` prompt in
     `prompts.ts`: return STRICT JSON
     `[{page, sheetNo, title, discipline, cls}]` where `discipline` ∈
     `electrical | fuel | lowvoltage | cover | architectural | civil | structural |
     mechanical | plumbing | other` and `cls` ∈ `schedule | plan | detail`.
     Reuse `callWithRetry` + `parseAIJSON`.
   - Pure `selectPages(inventory)` — include `electrical`, `fuel`, `lowvoltage`,
     `cover`, and anything the classifier failed to classify (**default-include**,
     matching the current filter's philosophy); exclude the rest. If selection
     would exclude everything, include everything (same guard as today's filter).
2. Wire into the pipeline (this replaces the per-FILE `isElectricalSheet` filter
   for PDFs; keep the filename filter for images and as the fallback):
   - Classify → select pages → for selected pages only: text blocks (Task 1) and
     tiles, with per-page `cls` driving tile size (replacing the per-file
     `classifySheet` guess) and the sheet label using real identity:
     `--- Sheet E1.1 "Panel Schedules" (schedule) ---` instead of the filename.
   - Page-level rasterization: `pdfToTiledImageBlocks` gains a `pages?: number[]`
     option (pdftoppm `-f`/`-l` per contiguous run, or rasterize-all-then-skip —
     executor's choice, but do not rasterize excluded pages at high DPI).
   - Classifier fails entirely → log + today's behavior (filename classify, whole
     file, existing labels). Never let classification failure kill a run.
3. Persist the inventory: migration `089_prep_inventory.sql` adds
   `prep_inventory JSONB` to `takeoff_results`; store
   `[{file, page, sheetNo, title, discipline, cls, included, textChars}]`. Also
   record `prep_fidelity TEXT` — `'tiled+text' | 'tiled' | 'document-fallback'` —
   so a low-fidelity run is *visible* (fixes problem 7's silence; surface in the
   Plan Review UI's run-cost area as one line: "Prep: 14 of 62 pages sent
   (tiled+text)" — keep the UI change minimal).
4. Classifier usage/cost: accumulate its token usage into `usage_agent1` (it is
   part of drawing analysis) — do not invent a new usage column.
5. Tests: `selectPages` (each discipline; default-include on unknown; the
   all-excluded guard); crop geometry math (pure — given page dims, the extract
   rectangle); classifier JSON parse tolerance (markdown fences, missing fields →
   page treated as unclassified/included). No live AI calls in tests.

## Task 3 — Fix the fidelity math and make it configurable

**Files:** `documentPrep.ts`, `preconstruction.ts` (`loadAIConfig`),
`frontend/src/features/settings/sections/AISection.tsx`.

**The math (put this comment in the code):** every tile is downscaled to
`maxLongEdge = 1568` px, so effective legibility is `1568 / tileInches` px per
real inch — raster DPI beyond `1568 / tileInches` is wasted. Today: schedule
tiles 11" → 142 px/in ceiling, and `maxTilesPerPage = 9` forces a 36×24 sheet to
12"-wide tiles minimum. The playbook's 300-DPI-crops guidance translates here to
smaller tiles, not more DPI.

1. Per-class tile targets become:
   - `schedule`: tileInches **8** (→ ~196 px/in), maxTilesPerPage **15** (36×24 at
     8" = 5×3), raster DPI **200** (just above the 196 px/in ceiling).
   - `detail`: tileInches 12, maxTiles 9, DPI 170 (near today).
   - `plan`: tileInches 16, maxTiles 6, DPI 130 (counting symbols — today's 9-cap
     rarely binds here anyway; lower DPI saves memory on 36×24 rasters).
   `pdfToTiledImageBlocks` already accepts `dpi`/`tileInches`/`maxTilesPerPage` —
   callers pass per-class values; the per-page `cls` from Task 2 picks the class.
2. Settings (all optional, defaults above): `ai_prep_dpi_schedule`,
   `ai_prep_dpi_plan`, `ai_prep_tiles_schedule`, `ai_prep_tiles_plan` — read in
   `loadAIConfig` with `parseNumberSetting` clamps (DPI 72–300, tiles 1–24). Add a
   compact "Document Prep" row to AISection following its existing TOKEN_KEYS
   input pattern, with a one-line cost warning (more tiles = more input tokens).
3. Memory guard: a 36×24 page at 200 DPI is a ~7200×4800 raster; sharp streams
   from file (already the case — extract reads the PNG on disk per tile), so no
   change needed — but verify tiles are extracted from the file path, not a
   loaded-in-memory buffer, and note it in the report.
4. Tests: grid math for a 36×24 sheet per class (5×3 at schedule targets; cap
   shrink loop still respected); config clamps.

## Task 4 — Structured handoffs and an empty-analysis guard

**Files:** `preconstruction.ts` (`runPipeline`), small pure helper + test.

1. Compact the inter-agent payloads: Agent 2 and Agent 3 receive
   `JSON.stringify(parsed)` (no 2-space indent) — storage/UI keeps the pretty
   version exactly as today. (~25% token cut on the largest payload in the system.)
2. Empty-analysis guard, pure function `analysisIsEmpty(a1): boolean` — true when
   `panels`, `equipment`, and `quantities` are ALL empty/absent. In `runPipeline`,
   after the merge/parse: if empty, set `status='error'` with
   `agent1_output = 'Drawing analysis found no electrical content. Check that the
   right sheets were uploaded (see the prep inventory) — the run was stopped
   before Agents 2–3 to avoid billing for an empty takeoff.'` and return.
3. Tests: `analysisIsEmpty` (empty object, empty arrays, one panel → false);
   compactness (the Agent 2 message contains no `"\n  "` from the payload).

## Task 5 — Confidence survives to the estimator's screen

**Files:** new `frontend/src/features/preconstruction/confidence.ts` + test,
`PcWorkspace.tsx`, `backend/src/routes/estimates.ts` (type only, JSONB is
additive), `backend/src/test/` route test.

1. Pure `confidenceToPlaybook(c: string|undefined): 'FIRM'|'APPROX'|'VERIFY'|null`:
   `VERIFIED→FIRM`, `ASSUMED→APPROX`, `NOT SHOWN→VERIFY`, already-playbook values
   pass through, unknown/absent → null. (Code-level mapping — do NOT change the
   agent prompts' confidence vocabulary; Agent 3's QC references VERIFIED/ASSUMED.)
2. `buildLineItemsFromTakeoff` keeps each row's confidence; the Pricing tab renders
   a small chip per row (FIRM green / APPROX amber / VERIFY amber — reuse the
   existing chip styling from the Pre-Bid tab's unresolved list) and a header
   count: "N FIRM · N APPROX · N VERIFY". Saved into `bid_estimates.line_items`
   (JSONB — no migration).
3. Add a `VERIFY`-count line to the existing $0-lineitem save toast when > 0
   ("… · 3 items need verification").
4. Guard the GC document: add a route test asserting `buildProposalDocx` output
   never contains the strings FIRM/APPROX/VERIFY/VERIFIED/ASSUMED in the takeoff
   table cells (confidence is internal; the playbook bans tolerance language on
   bids — full banned-string gate is Phase 3, this is the one Phase 2 must not
   regress).
5. Tests: the mapping; chip rendering with a mocked takeoff (follow
   `PcWorkspacePricing.test.tsx` patterns); persisted line_items carry confidence.

## Task 6 — Pre-bid cross-check feeds Agent 3

**Files:** new `backend/src/ai/agent3CrossCheck.ts` + test, `preconstruction.ts`
(Agent 3 call site), `prompts.ts` (append one paragraph to `AGENT3_SYSTEM`).

1. Pure `buildPrebidCrossCheck(prebid): string | null` — given the
   `bid_takeoffs kind='prebid'` row (categories + line_items), emit:
   `--- INDEPENDENT PRE-BID TAKEOFF (human-reviewed Cowork package) ---` followed
   by a compact per-category listing: description, qty (or `UNRESOLVED`),
   confidence. Cap at 20,000 chars with a marker. Null when no pre-bid exists.
2. In `runPipeline`, before Agent 3: load the pre-bid row; when present, append
   the cross-check block to Agent 3's user message.
3. `AGENT3_SYSTEM` addition: when an INDEPENDENT PRE-BID TAKEOFF block is present,
   reconcile it against Agent 2's takeoff — a quantity differing by more than ~20%
   between two independent takeoffs, or a category present in only one, is a
   `conflicts[]` entry (cite both numbers); agreement between the two upgrades
   your confidence assessment. The pre-bid's UNRESOLVED items belong in
   `missingFromScope[]` if Agent 2 also lacks them.
4. Tests: builder output shape; null on no pre-bid; UNRESOLVED rendering for
   qty-null rows; the cap.

## Verification (whole phase)

1. Worktree: `cd backend && npm run typecheck && npm test` → expect 361+ passing,
   0 failures (Phase 1 de-flaked the harness; a failure here is yours).
   `cd frontend && npm run typecheck && npm test` → 299+ passing, only the 9
   known pre-existing failures (PWA install-prompt, CustomerHub preview).
2. Trace by reading final code: (a) a text-rich schedule page produces text block
   before tiles; (b) a 62-page set with 19 electrical pages tiles only ~19 pages
   plus cover; (c) schedule tiles now target 8"/200 DPI; (d) Agent 2's message
   contains compact JSON; (e) an all-empty analysis stops before Agent 2; (f) a
   VERIFY chip renders in Pricing; (g) Agent 3's message includes the pre-bid
   block when one exists.
3. Report actual token-size deltas where measurable (compact vs pretty on a
   fixture JSON) in the feature report.

## Out of scope

- Everything Phase 3 (bid_data.json schema, proposalDocx ports, verify.sh gate,
  xlsx generation, pre-bid package generation) and Phase 4 (delivery/follow-up).
- Prompt rewrites beyond the three specified additions.
- Installing poppler on the dev Mac (user action — see plan notes; production
  already has it via Aptfile).
- Parallelizing Agent 1 batches (playbook parallelizes counting; the pipeline's
  serial batches are a cost/rate-limit choice — revisit only with real timing data).
