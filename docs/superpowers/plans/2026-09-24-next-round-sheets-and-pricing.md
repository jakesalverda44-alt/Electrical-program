# Next Round: Sheet Check & References (Part A) · Chris's Units & Accubid Pricing (Part B)

**Date:** 2026-09-24
**Status:** Approved by Jake ("start now"), pending implementation
**Planned by:** Opus 5.5 (main session) · **Execution:** Opus 5 · **Review:** Opus 5 (adversarial) → main session verdict
**Depends on:** local main `94459cd` (takeoff-accuracy + rerun-reset merged)
**Order:** Part A fully (tests green, committed) → Part B. One branch, one worktree.

## Why

Live test results on AutoZone #10077 Kissimmee (Sonnet run, 2026-09-23, counting stage working):

| Type | CRM (Sonnet) | Cowork / Chris |
|---|---|---|
| A strip | 55 | 73 |
| B strip | 46 | 52 |
| C / M | 2 / 6 | 2 / 6 |
| G | 9 | 11 |
| Exit/emergency E+F+J+K | 24 | 22 (audit 24) |
| D wall pack | 4 | 5–9 |
| Site poles / heads | 3 / 3 | 3 / 4 |

Gaps: dense strip areas undercount ("symbols could not be read reliably on E-3");
W1/W2/S1/S2 show 0 because photometric PH0.1 is never sent (classifier drops
'civil'); 37 review items (33 count items) is too many to work; Agent 1 ran 13
batches sequentially (~12 min) after ~5 min of prep.

And Chris's estimates (BOMs + breakdowns, see Part B) show how APT actually
prices, which the CRM's Phase A engine doesn't match.

## Jake's decisions (do not relitigate)

1. **Sheet check runs automatically** in the Documents step whenever files are
   added/changed — no separate button. One **Run AI Analysis** button; it reads
   **"Run without N sheets"** when referenced sheets are missing.
2. **Follow references.** Any sheet referenced from electrical sheets ("SEE M-1",
   "REFER TO C-3", "PER PHOTOMETRIC PLAN", "SEE CIVIL") that is present in the
   upload is included automatically as a reference page. Missing ones are listed
   with **Upload** or **Skip (reason)**; skipped ones go into proposal
   clarifications ("Mechanical schedules not provided at time of bid").
   With a full set uploaded nothing is missing and there's no pause.
3. **Models:** title-block classification = Haiku (exists); reference finding on
   text-layer sheets = deterministic regex, vaguer phrasing = Haiku on notes text;
   scanned/no-text sheets = Sonnet vision on the notes region only.
4. **"By G.C." = APT scope.** On electrical drawings, "G.C. furnished/installed" /
   "by GC" means APT furnishes & installs (the GC subs electrical to APT). Count,
   price and write it as APT; never an exclusion. Only another trade (HVAC,
   plumbing), owner, vendor or "others" is outside APT's supply — owner-furnished
   equipment is still APT-installed. Power poles on AutoZone remain an `ask`
   question, but a "by GC" drawing note pre-fills **APT**.
5. **Pricing percentages (2025–2026 only):** labor overhead **38% on labor only**,
   material & labor markup **20%**, vendor quote markup **18%**, adjustment 0% —
   all editable per bid; overhead default editable per GC. 2024 estimates feed
   labor units/ratios only, never percentages.
6. **Models for testing:** live settings are currently Sonnet for all agents
   (Jake testing plumbing). Don't change live settings. Code defaults for fresh
   installs stay as-is.

## Environment facts

- Repo: `/Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version`.
  Migrations: main at **124** → this plan owns **125+**.
- Pipeline: `backend/src/routes/preconstruction.ts` (runPipeline, /analyze),
  `ai/pageClassifier.ts` (title-block crops, Haiku, `SELECT_DISCIPLINES`),
  `ai/documentPrep.ts` (tiling; class configs), `ai/agent1Batching.ts`,
  `ai/counter.ts`, `ai/countRender.ts`, `ai/countMerge.ts`, `ai/countingStage.ts`,
  `ai/reviewItems.ts`, `ai/pdfText.ts` (pdftotext), `estimating/pdfjsLoader.ts`
  (**always pass a copy** to pdf.js — see the detached-buffer incident),
  `bidstd/accountRules.ts`, `bidstd/enforceCounts.ts`, `bidstd/composeProposal.ts`.
- Estimating engine: `backend/src/estimating/{pricing,mapper,library,bidEstimate,calibration,markupMath}.ts`,
  frontend `features/estimating/*`, Labor Library in Settings.
- Known flakes: backend notificationsRetention (worker crash), intakeSimilarCache,
  integration.test backfill timeout; frontend SurveyMarkupEditor,
  ElecProjectsSaveSection, Takeoff List|Plans toggle.
- Test pg pool is capped at 5 (don't raise it); the live app shares the Postgres
  server — never run the full suite more than needed.

## Ground rules (permanent)

- Worktree: `git worktree add "../Electrical-program-wt-next-round" -b feat/sheets-and-pricing main`
  (quote paths). `npm install` both sides. Never edit Local Version (live app;
  Jake has uncommitted edits). Never start dev servers. Tests via `npm test` /
  `npx vitest run` only (backend → electrical_crm_test). **No real Anthropic /
  Drive / email calls** — mock them. No push. **Do NOT use the Agent tool.**
  Never print the Anthropic key. Never run the eval harness against the API.
- First commit = this plan. One commit per task; messages end
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Commit working pieces
  early (usage limits happen).
- Tests use REAL shapes: real multi-page PDFs that own their ArrayBuffer (>4 KB,
  not pooled), real Agent 1 output structures, real Accubid BOM text.
- Report: `docs/superpowers/plans/2026-09-24-next-round-report.md`.

---

## Part A — Sheet check, references, accuracy, review noise

### A1. Page inventory as a first-class record
- Persist the per-page inventory (document, page, sheet no, title, discipline,
  class, has_text_layer, selected, reason) per bid (migration), built by the
  existing classifier when files are added/changed — not only inside /analyze.
- Route `GET/PUT /api/preconstruction/:bidId/sheet-check` (list; force-include /
  exclude a page with reason). /analyze uses the saved selection.
- The classifier result is reused by /analyze (no second Haiku pass if files
  unchanged — key by document content hash).

### A2. Reference finder
- `ai/sheetRefs.ts` (pure where possible): from electrical-sheet text (pdftotext
  per page, already available) extract references: explicit sheet ids
  (`[A-Z]{1,3}-?\d+(\.\d+)?` patterns with context words SEE/REFER/PER/ON/
  SHEET/DWG), and discipline-only references ("see mechanical drawings",
  "per civil", "photometric plan", "reflected ceiling plan", "life safety plan",
  "equipment schedule"). Haiku call only for notes text the regex can't resolve.
- Scanned E-sheets (no text layer): Sonnet vision on the general-notes region
  crop only, returning references as JSON.
- Resolve each reference against the inventory (normalized sheet numbers; for
  discipline-only refs, match by discipline + title keywords). Result per ref:
  `present` (auto-include as reference page) / `missing` / `ambiguous`.
- Always-useful references (included when present even if not explicitly
  referenced): mechanical & plumbing **equipment schedules**, **photometric /
  site lighting** sheets, **reflected ceiling** and **life safety** plans.
- Tests: regex cases (SEE M-1, REFER TO SHEET C-3.1, PER PH0.1, "see civil"),
  AutoZone-shaped inventory (E-7 → PH0.1 included), missing M-1 flagged.

### A3. Sheet Check panel (Documents step) + run button
- Panel sections: **Included** (with "referenced by E-7 note 3" where
  applicable), **Needed but missing** (Upload / Skip with ≥10-char reason),
  **Left out** (force-in checkbox). Runs automatically on file add/remove; shows
  a spinner then results (~1 min).
- The single Run AI Analysis button (Takeoff step + a shortcut here) reads
  "Run without N sheets" when missing items are unskipped; skipped sheets are
  recorded and rendered into Exclusions & Clarifications.
- Reference pages go to Agent 1 as **reference** class (lower resolution, not
  counted) — except photometric/site sheets, which the counter may use for site
  fixture types per the existing cross-sheet rules (site fixtures from site/
  photometric, never stacked on E-7).

### A4. Post-Agent-1 safety net
- If Agent 1 reports a referenced sheet that the check missed, create a review
  item "Referenced sheet X not in analysis" with Upload → **supplement pass**:
  Agent 1 on just the new pages, merged into the run (run_id-guarded), then
  counting re-runs only for affected types. Keep it simple and tested.

### A5. Accuracy & speed
- **Counter tiles for Opus:** when the counter model supports large images
  (Opus 5.5: 2576 px long edge), size tiles to that limit (fewer, sharper
  tiles); keep 1568 px for other models. Model→max-image table in one place.
  Keep core-region ownership de-dup.
- **Dense-area retry:** when the counter marks a sheet/type "could not be read
  reliably", re-count that sheet at higher effective resolution (smaller tiles)
  once, and report both.
- **Parallel Agent 1 batches:** run batches with bounded concurrency (3),
  preserving merge order and run_id/cancel checks; progress text stays accurate.
- Tests: tile sizing per model, retry trigger, parallel merge order identical to
  sequential.

### A6. "By G.C." = APT (Decision 4)
- Account-rule drawing-statement parser, counting targets, Agent 2/4 prompt
  guidance, scope text and hygiene: GC-assigned electrical items → APT F&I.
  Only other trade / owner / vendor / others are non-APT supply (owner-furnished
  still APT-installed). Pole `ask` pre-fills APT from a "by GC" note.
- Tests with the Kissimmee legend strings ("Simplex receptacle, G.C.
  furnished/installed", "Duplex receptacle / floor receptacle, G.C.",
  "Exhaust fan recessed, installed by HVAC, wired by EC").

### A7. Review noise
- Group review items by cause (e.g. one "4 types found only on the photometric
  sheet" group; one "E-1/E-2 same area?" group) with bulk actions.
- Types assigned to another trade/owner/vendor (Decision 4) don't raise
  zero-count blocks — they're listed as info.
- Zeros for types that only exist on reference sheets now resolve via A2/A3
  (photometric included) rather than blocking.
- Target on the Kissimmee-shaped fixture: ≤ 8 blocking items.
- **Blocking duplicate check in Labor & Pricing:** the rerun-reset leftover —
  an unbound kept line plus a fresh new-takeoff line for the same fixture/device
  → blocking "possible duplicate" (same resolve UI as the proposal double-count
  control) before save/proposal.

## Part B — Chris's labor units & Accubid-style pricing

### Source data (read-only; parse with `pdftotext -layout`)
BOMs (item-level units):
- `/Users/jakesalverda/Library/CloudStorage/OneDrive-AccuratePowerandTechnology/Bids/Summit GC/Autozone Kissimmee, FL/Autozone Kissimmee BOM.pdf` (2026-06)
- `/Users/jakesalverda/Downloads/Orlando Clubhouse BOM.pdf` (2024-04)
- `/Users/jakesalverda/Downloads/Rockledge Storage BOM.pdf` (2024-04)
- `/Users/jakesalverda/Downloads/36th Street Warehouse BOM.pdf` (2024-04; has DEMOLITION units)
- `/Users/jakesalverda/Downloads/North Port Storage BOM.pdf` (2024-03; has POLE BASE units)
Breakdowns (totals) — same folders, `* Breakdown.pdf`, plus Golf Simulator,
Seminole State, 7-11 #10319, Bubble Down, Big Dans (= "Tommy's Car Wash Largo"
name), Murrell (OneDrive paths are in the report of the prior round's memory;
Downloads names: "James Co Seminole State Breakdown.pdf", "7-11 #10319 Fort
Meyers Breakdown.pdf", "Bubble Down Remodel Breakdown.pdf", "Big Dans Temple
Terrace (1).pdf").

Facts established: Accubid labor units are identical across jobs (3/4" EMT
3.2 h/C, #12 THHN 5.15 h/M, 4" sq box 23 h/C, duplex 20 h/C, GFCI 25 h/C,
downlight 0.9 ea, exit 0.55 ea…). Chris uses fluorescent/HID Accubid items as
**labor proxies** for LED fixtures. Job-level knobs: labor adjust %, crew mix &
rates, overhead, markup, quotes, equipment, general expenses.

### B1. Accubid BOM parser + unit import
- `estimating/accubidBom.ts`: parse BOM line rows (attributes, description, qty,
  unit E/C/M, price, net cost, labor unit, field labor, labor adj %). Tested on
  all five real BOMs (row counts & totals reconcile to the BOM footer
  `$material / hours`).
- Import into the Labor Library as `source='accubid'`: create/update items
  (labor hours per unit from Accubid; **material net price only from the
  2026 Kissimmee BOM**, dated 2026-06-18; older BOMs contribute units but not
  prices). Keep Jake's manual edits (never overwrite `source='manual'`).
  Map the LED-proxy rule (e.g. "Luminaire Linear Striplight - Fluorescent 8'"
  → 8' LED strip labor).
- Demolition items and pole-base assembly (auger, sono tube, rebar ring, rebar,
  concrete, anchor bolts) as library items/assemblies.
- **Fittings ratios:** derive per-conduit-size ratios (couplings, connectors,
  straps/clamps per 100 ft; boxes/rings/covers per device) from the BOMs
  (median across jobs) and apply them in the conduit/device assemblies.
- Settings → Labor Library: "Import Accubid BOM" (upload a BOM PDF → preview
  diff → apply), idempotent.

### B2. Accubid-style recap
- Add pricing mode `accubid` (default for new bids; Phase A mode kept for
  existing saved estimates unless the estimator switches):
  - Field labor = Σ hours × blended crew rate, where crew = journeyman/
    apprentice/foreman counts and rates with burden % and fringe $/hr (Chris:
    burden 4%, fringe $1.50). Per-item labor adjust % supported.
  - Labor overhead = labor × OH% (**38% default**, per-GC default table).
  - Material markup = material × 20%; labor markup = (labor + labor OH) × 20%;
    quotes: per-quote markup (default 18%) and tax %; equipment and general
    expenses lines (with optional tax); adjustment markup % on net cost.
  - Selling price = material + labor + OH + equipment + GE + quotes (+their
    markup/tax) + markups + adjustment.
- Verify against Chris's breakdowns: with his inputs (his hours, material,
  crew, OH%, markup%), the recap reproduces his Selling Price **to the cent**
  for Kissimmee ($79,112.23), Golf Simulator ($36,429.57), Seminole
  ($20,991.53), Bubble Down ($36,925.89), 36th Street ($22,553.54). Tests.
- `bid_estimates` / `bids.amount` consistency and composeProposal price flow
  unchanged in contract.

### B3. Sections & options on the Labor & Pricing screen
- **Crew** panel (mix, rates, burden, fringe, shift: day/night with night
  rates — Bubble Down night J $59 / A $39).
- **Vendor quotes** (switchgear, lighting package…) with status
  `firm` / `budget-pending` — any budget quote **blocks send** (Chris's "hold
  until CES gets back").
- **Equipment** and **General expenses** lists (lifts, excavator, trencher,
  crane, permits, temp power/lighting, travel).
- **Alternates** (add / deduct), printed as separate lines on the proposal
  without changing the base price (36th Street "deduct $1,830 if existing office
  fixtures stay"); proposal renderer support in the Cowork format.
- Settings: per-GC overhead default table (all 38% now), default markup/quote
  markup, crew defaults.

### B4. Calibration against Chris
- Extend the calibration report: for the jobs with BOMs, compare the engine's
  hours per category (using Chris's quantities) to Chris's hours; show deltas.
  Suggest adjustments, never auto-apply.

---

## Review & merge

1. Opus executes Part A → commit → Part B → report.
2. Opus adversarial review (both parts) → fixes → main-session spot-check.
3. Jake approves merge (never during a live analysis; full backend restart if
   ts-node-dev caches stale code: kill `.crm/backend.pid` tree, then
   `(cd backend && nohup npm run dev > ../.crm/backend.log 2>&1 &)`).
4. Jake switches models to Opus and runs the Kissimmee accuracy test.
