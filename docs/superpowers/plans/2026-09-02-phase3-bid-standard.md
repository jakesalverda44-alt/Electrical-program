# Phase 3 — The Bid Standard: Adopt the APT_Bid_System Architecture

**Date:** 2026-09-02
**Status:** Approved plan, pending implementation
**Planned by:** Fable 5 · **Execution:** Sonnet 5 · **Review:** Opus 5 (full) → Fable 5 (verdict)
**Depends on:** Phases 1–2 (merged), intake intelligence (merged)

## Problem

The CRM's proposal generator falls short of the APT bid standard, and everything
contractual lives in an editable AI prompt where the model can drop it. Jake's
desktop **APT_Bid_System v4** (installed as the skill `~/.claude/skills/apt-electrical-bid`)
already solved this with a better architecture: one `bid_data.json` feeds
deterministic builders (`build_bid.js`, `build_prebid.js`, `build_takeoff.py`),
and `verify.sh` hard-gates every deliverable. Phase 3 ports that architecture
into the CRM:

- **AI fills data; code renders documents.** Agent 4's output contract becomes the
  project-specific subset of `bid_data.json`. The 6 standard scope bullets, 10
  terms, closing block, section names, and visual spec move into code.
- Today's specific gaps (from the estimating review + Phase 1 findings): section
  header names slightly off; no navy category rows in the takeoff; no
  standard/emergency fixture-row discipline; boilerplate unenforced; no banned-
  language scan; no `.xlsx` output; no pre-bid package generation; official 2026
  logo/signature not in the backend assets; the generated document is checked by
  no one before download.

**Authority documents** (read all before coding — they are the spec):
`~/.claude/skills/apt-electrical-bid/PROJECT_INSTRUCTIONS.md`, `scripts/build_bid.js`
(v4, with keepNext/keepLines), `scripts/build_prebid.js`, `scripts/build_takeoff.py`,
`scripts/verify.sh` (v4), `scripts/bid_data.example.json`, `docs/Bid_Output_Standards.md`.
Where this plan and those files disagree, **the skill files win** — they are Jake's
maintained standard. (Copy what's needed; never modify the skill folder.)

## Environment facts (verified 2026-09-02)

- Render's Aptfile installs poppler only — **no LibreOffice in production**. The
  verification gate therefore runs on extracted docx text (no external tools);
  PDF conversion is an optional enhancement when `soffice` exists (check PATH and
  `/Applications/LibreOffice.app/Contents/MacOS/soffice`).
- Backend deps: `docx` ^9 and `adm-zip` present; **`exceljs` must be added** for
  styled xlsx output (SheetJS community edition can't write fills/borders).
- `backend/assets/` has generic `logo.png`/`signature.png` — replace with the
  official `APT_Logo_2026.jpg` / `Jake_2026_Signature.png` from the skill's
  `assets/` (copy the bytes in; keep backward-compatible lookup).
- Migration numbering: main is at 092 (089 arrived via Phase 2). **This plan owns
  093.**

## Ground rules (permanent)

- Worktree only: `git worktree add "../Electrical-program-wt-phase3" -b feat/phase3-bid-standard main`
  from `"/Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version"`
  (quote paths). `npm install` both sides first. Never touch `Local Version` or
  other worktrees. Never run dev servers.
- Tests only via `npm test` (isolated `electrical_crm_test`, live-DB hard guard,
  muted email — never weaken).
- One commit per task, imperative messages, `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
  Read files before editing. TDD for pure functions. No pushes. Feature report at
  `docs/superpowers/plans/2026-09-02-phase3-report.md`.
- Do not touch the gens pipeline or start Phase 4 (delivery/email/e-sign).

## Task 1 — The bid_data contract and the boilerplate source of truth

**Files:** new `backend/src/bidstd/bidData.ts` (+ test), new
`backend/src/bidstd/boilerplate.ts` (+ test), migration
`database/migrations/093_bid_standard.sql`.

1. `bidData.ts`: TypeScript types mirroring `bid_data.example.json` exactly
   (BidData, TakeoffCategory{name, items[{item, description, unit, qty, conf?,
   source, furnish_by?}]}, Section{title, bullets[(string|{b,t})]}, prebid block,
   alternates, takeoff_notes, building_area/interior_breakdown, total_price,
   job_number, plan_date, etc.). Include a `validateBidData(data): string[]`
   returning human-readable problems (missing required fields, non-6-bullet
   scope, empty sections). Copy `bid_data.example.json` into
   `backend/src/test/fixtures/bidstd/` as the canonical fixture.
2. `boilerplate.ts`: the standard content as code, verbatim from
   PROJECT_INSTRUCTIONS.md — `standardScope6(planDates, sheetList, gcName)`,
   `standardTerms(planDates)` (10 bullets, NEC 2020/FBC 2023/FFPC 2021, 25%
   deposit, Southern Lighting Source…), the exact section header names table,
   the closing-block strings, `SECTION_LIMITS` (A 3–4, B 2, C exactly 3, …).
   Every string identical to the skill's; a test locks each against drift.
3. `jobNumber(date): string` → `JS.MMDDYYYY`.
4. Migration 093 (follow house conventions): `ALTER TABLE bids ADD COLUMN IF NOT
   EXISTS job_number TEXT;` and restate the `documents.category` CHECK **in full**
   (last restated in 082 — read its comment; never amend) adding `bid_data`.
5. Tests: type round-trip of the fixture through `validateBidData` (clean);
   boilerplate substitution; jobNumber formatting.

## Task 2 — Port build_bid.js → the new proposal renderer

**Files:** `backend/src/utils/proposalDocx.ts` (rewrite around a new
`renderBidDocx(data: BidData): Promise<Buffer>`), `backend/assets/` (add the two
official images), tests.

1. Port `build_bid.js` v4 **faithfully** — constants (`NAVY 1F3864`, `ACCENT
   D9E1F2`, Arial, sizes 20/22/24 half-points, band spacing 440/160, bullets
   40/80, takeoff column widths `[620,3640,720,700,3680]`), page setup (Letter,
   margins top/bottom 1080, left/right 1440), navy band tables with **centered**
   white bold text, `keepNext`/`keepLines` orphan control everywhere v4 has it,
   logo 280×224 centered, signature 500×167 left after "Respectfully,", price
   summary as `Proposal Price Summary` + `Total for <project>:  <price>` bold
   navy 12pt, alternates bullets, the exact closing block (centered cost-basis
   line, PO sentence, Print/Sign/Date, centered bold navy thank-you line), the
   takeoff table with navy header row + ACCENT category band rows spanning 5
   columns.
2. Assets: copy `APT_Logo_2026.jpg` and `Jake_2026_Signature.png` from the skill
   into `backend/assets/`; the loader prefers them, falls back to the old names.
3. Keep the existing route-level authority pattern: `bids` row values (name,
   loc, gc, contact) and the validated price override whatever the data blob
   says — same precedence as today's `BidMeta`.
4. Keep `buildProposalDocx(legacyProposalJSON, meta)` working during Task 5's
   transition by implementing it as adapter → `renderBidDocx` (see Task 5.3).
5. Tests (structural, on the produced docx XML via adm-zip — no LibreOffice):
   exact section header strings (`A. Service & Distribution` …
   `E. Low Voltage Infrastructure (Conduit & Boxes Only)`,
   `EXCLUSIONS & CLARIFICATIONS`, `ELECTRICAL QUANTITY TAKEOFF`,
   `TERMS, CONDITIONS & SPECIAL REQUIREMENTS`); band paragraphs centered; the
   closing lines present verbatim; column-width grid equals the spec; fixture
   renders without throwing; Phase 2's confidence-leak guard still passes.

## Task 3 — Port build_takeoff.py → xlsx builder (exceljs)

**Files:** new `backend/src/bidstd/takeoffXlsx.ts` (+ test), `backend/package.json`
(add `exceljs`).

1. `renderTakeoffXlsx(data: BidData, opts: { prebid?: boolean; furnish?: boolean | null })`
   ported from `build_takeoff.py` v4: GC mode 5 columns; `--prebid` adds `CONF.`
   with FIRM green `E2EFDA` / APPROX+VERIFY yellow `FFF2CC` fills; FURNISH BY
   column auto-added when any item carries `furnish_by` (override via opts);
   dynamic centered-column computation (port the `conf_col`/`furnish_col`
   logic); navy category rows with ACCENT fill; header block with
   `building_area` / `interior_breakdown` rows (**takeoff only — never on the
   bid docx**); NOTES block from `takeoff_notes`; landscape, fit-to-width,
   Arial 10, thin borders `9AA5B1`.
2. Filenames per v4: GC `[Project]_Quantity_Takeoff.xlsx`, pre-bid
   `[Project]_PreBid_Quantity_Takeoff.xlsx`.
3. Tests: parse the produced workbook back (exceljs read) — column headers per
   mode, category rows, conf fills, furnish auto-detection, building-area rows
   present in header, notes block.

## Task 4 — The verification gate (verify.sh v4 → TypeScript, text-based core)

**Files:** new `backend/src/bidstd/verifyBid.ts` (+ test).

1. `extractDocxText(buffer)` — reuse/adapt the existing helper in
   `bidDocParse.ts` (paragraph-per-line).
2. `verifyBidDocx(buffer, { kind: 'gc' | 'internal' }): { pass, failures[] }`
   porting verify.sh v4's checks, each failure `{check, detail, matches[]}`:
   - **Placeholders**: bracketed ALL-CAPS tokens `\[[A-Z][A-Z0-9 ()/&._-]{1,60}\]`.
   - **Banned language** (GC only): the v4 list, but with **word boundaries** on
     the substring-prone entries (`\bRFI\b`, `\bcounted\b`, `\bTBD\b`) so
     "Discounted"/"accounted" can't false-positive — this fixes the known nit in
     verify.sh itself; note it in the report.
   - **Square footage** (GC only): `[0-9,]+ *(SF|S\.F\.|sq\.? ?ft)`.
   - **ECFECI** (GC only): occurrence count ≥ 3, and additionally assert the
     three mandated placements exist (Section A ×2 area, Section C bullet 1) by
     checking ECFECI appears at least once between `A. Service & Distribution`
     and `B. Branch Power`, and once between `C. Lighting & Controls` and
     `D. Site`.
   - **Internal docs** (`kind: 'internal'`) skip banned/SF/ECFECI (pre-bid scope
     legitimately carries estimator language), keep placeholders.
3. Optional PDF: `findSoffice()` (PATH + the macOS app path); when present,
   convert to PDF (tmpdir, cleaned in finally) and return the PDF buffer
   alongside — callers may file it. Absent soffice = not a failure.
4. Tests: the sample fixture rendered by Task 2 **passes** the GC gate; doctored
   documents fail each check individually (placeholder, "RFI", "TBD",
   "1,234 SF", ECFECI stripped); "Discounted" does NOT trip `counted`; internal
   kind relaxes correctly.

## Task 5 — Agent 4's new contract (data-only) + legacy adapter

**Files:** `backend/src/ai/prompts.ts` (AGENT4_SYSTEM rewrite),
`backend/src/ai/agent4Message.ts` (output-schema section),
new `backend/src/bidstd/composeBidData.ts` (+ test),
`backend/src/routes/preconstruction.ts` (generate-docx + run-agent4 glue).

1. **AGENT4_SYSTEM rewrite**: Agent 4 now emits ONLY project-specific data —
   JSON `{ plan_date, sheets[], sections[{title, bullets[]}], exclusions[],
   allowances_bullets[], fixture_types[], takeoff[{name, items[...with conf,
   source, furnish_by?]}], alternates[], takeoff_notes[] }`. Instructions keep:
   section bullet limits (A 3–4, B 2, C exactly 3 with the ECFECI lighting
   bullet + controls + fixture-type list), ECFECI phrasing for the Section A
   bullets, the Bid Output Standards conversions (concerns → Exclusions/Terms
   language, NEVER "RFI"/"confirm"/"TBD" — the verifier will reject the
   document). Remove all boilerplate the code now owns (the 6 bullets, the 10
   terms, letterhead identity, closing block). Keep `manualCountRequired`
   handling: those items become protective Exclusions language, not TBD text.
2. `composeBidData.ts`: pure — merge into a full `BidData`:
   bids row (client=gc, contact, project_name=name, project_address=loc,
   job_number: existing or `jobNumber(now)` — persist back to `bids.job_number`
   on first use), date (formatted today), total_price from validated
   `agent4_price` (Task 5 keeps Phase 1's authority chain), Agent 4's data
   blob, `standardScope6(...)` / `standardTerms(...)` from boilerplate,
   confidence values from the saved estimate/takeoff (Phase 2's
   FIRM/APPROX/VERIFY) mapped onto takeoff items' `conf` — for the PREBID
   outputs only; the GC takeoff drops `conf` entirely, and building_area
   (from `bids.sq_ft` when set, labeled "(bid record)") goes to the xlsx
   builder only.
3. **Legacy adapter** `legacyProposalToBidData(oldJson): Partial<BidData>` — maps
   the old ProposalJSON shape (scopeOfWork{A_…}, terms, takeoff rows with
   category strings) so already-generated proposals still render/download
   without re-running Agent 4. Unit-tested against a captured old-shape sample.
4. `run-agent4`: unchanged inputs; the parse-validation after the call now also
   runs a light shape check (sections present? takeoff array?) and stores
   `agent4_output` in the new shape.
5. Tests: composeBidData precedence (bid row beats agent data; price formatting;
   job number persist-once); adapter mapping; prompt constant contains no
   boilerplate strings (lock with a test asserting the 25%-deposit sentence now
   lives ONLY in boilerplate.ts).

## Task 6 — Generation flow: verify-gate, file everything, pre-bid package

**Files:** `backend/src/routes/preconstruction.ts`, small route additions.

1. `GET /:bidId/generate-docx` becomes: compose BidData → `renderBidDocx` →
   **`verifyBidDocx(kind:'gc')` — hard gate**: on failure return
   `422 { error, failures[] }` and file nothing; on pass → file the docx
   (category `proposal`, dated name — keep Phase 1's versioning behavior), file
   the composed bid_data as `<name>_bid_data.json` (category `bid_data`) so the
   desktop system and CRM stay interchangeable, file the PDF too when soffice
   produced one, then stream the docx. Sync `bids.amount` as today.
2. New `GET /:bidId/generate-takeoff-xlsx` → GC-mode xlsx from the same composed
   data, filed (category `takeoff`) and streamed.
3. New `POST /:bidId/generate-prebid-package` → ports `build_prebid.js`
   (internal banner `PRE-BID PACKAGE — INTERNAL USE`, To Chris/From Jake header,
   Owner/Engineer/plan+received dates, sheet list, scope + sections + exclusions,
   FLAGS section, no price/signature/closing) + the pre-bid xlsx
   (`--prebid` mode with confidence fills). Verify both with `kind:'internal'`
   (placeholders still gate). File under the existing `prebid_scope` /
   `prebid_takeoff` categories; return both document ids. Missing inputs
   (no scope at all) → 400 with a clear message.
4. DB-gated route tests: gate blocks a doctored bad document (422, no documents
   row); pass path files docx + bid_data.json; prebid endpoint files both and
   the xlsx has the CONF column.

## Task 7 — Frontend: preview the new shape, surface the gate

**Files:** `frontend/src/features/preconstruction/PcWorkspace.tsx` (+ tests).

1. Proposal preview renders the new schema: sections by their real titles,
   exclusions, alternates, terms (from a new lightweight
   `GET /:bidId/proposal-preview` returning the composed BidData, or compose
   client-side from `agent4_output` — executor's choice, keep it thin), price
   from the bid record. Legacy-shape outputs render via the adapter path.
2. A red/amber **verification panel**: when generate-docx returns 422, list each
   failure (check name + matched text) with "fix and re-run Agent 4" guidance.
   The download button never silently fails.
3. Buttons: `Download Takeoff (.xlsx)` beside the docx download; a
   `Generate Pre-Bid Package for Chris` action (Proposal tab, internal-labeled)
   that calls Task 6.3 and links the two filed documents.
4. Overview/edit: expose `job_number` (read-only display of the auto value with
   edit capability, following the existing edit-form field pattern).
5. Tests: preview renders fixture sections; 422 failure panel renders failures;
   prebid button wires to the endpoint (mocked api per existing patterns).

## Out of scope (Phase 4 and later)

- Sending anything (submittal email, e-sign, public page, follow-up sweeps).
- OneDrive filing per APT_Bid_System v3 (CRM files to its own documents + Drive).
- Prompt-injection sanitization sweep (tracked from Phase 2 review F8) — unless
  trivially adjacent while editing AGENT4_SYSTEM, in which case note it.
- VE alternates math, FURNISH BY estimating logic beyond rendering.
- Changing Agents 1–3.

## Verification

1. Both suites green in the worktree (backend expect ≥470 with only the Kohler
   flake; frontend ≥315 passing with only the 9 known pre-existing).
2. End-to-end trace by reading final code: compose→render→verify→file→stream;
   a doctored "RFI" document blocked with a 422 listing the match; the fixture
   bid renders a docx whose extracted text passes the same gate the desktop
   verify.sh v4 enforces; prebid package produces internal banner + CONF xlsx.
3. Feature report includes: any place the port deviated from the skill scripts
   (each with a reason), and the boilerplate-drift test list.
