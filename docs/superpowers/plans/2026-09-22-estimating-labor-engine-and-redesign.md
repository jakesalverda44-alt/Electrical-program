# Estimating: Labor Engine (Phase A) + Estimating Workspace Redesign

**Date:** 2026-09-22
**Status:** Approved direction (Jake, 2026-09-22), pending implementation
**Planned by:** Opus 5.5 (main session) · **Execution:** Sonnet 5 · **Review:** Opus 5 (full, adversarial) → main session (verdict, spot-checks only)
**Depends on:** local main `c662ceb` (all four audit batches merged)

## Why

Jake wants the Electrical side of the CRM to estimate like Drawer AI / Accubid /
ConEst — labor hours, material, a real bid recap — and wants the Estimating
section to look clean and run in a clear order. Intake and the Leads board are
fine and are **out of scope**.

Today:

- **Pricing is qty × one flat unit cost per category** (`unit_cost_library` in
  `app_settings`, keyed by category — `UnitCostSection.tsx`,
  `PcWorkspace/parsing.ts:158 lookupUnitCost`, `buildLineItemsFromTakeoff`,
  `backend/src/routes/estimates.ts`). No material/labor split, no hours.
- **Labor hours exist only inside Accubid breakdown PDFs**, parsed by
  `backend/src/utils/accubidParse.ts` for comparables.
- **The Estimating UI stacks three navigation systems:** Bid Hub tabs
  (`bid-hub/BidHubPage.tsx:17` — Overview/Estimating/Compare/Files/Activity) →
  11 workspace tabs (`preconstruction/constants.ts:13 PC_TABS`) → a 7-step
  stepper (`PC_STEPS`) whose labels don't match the tabs. Overview and Files
  appear twice. Tab order doesn't follow the work: upload in Files, run AI in
  "Bid Builder", see results in "Plan Review". Historical Costs and Win-Rate
  Insights are reference panels posing as steps.

## Decisions already made (do not relitigate)

1. **Built inside the existing CRM**, inside the Bid Hub's **Estimating** tab.
   Estimating code lives in its own module boundary (below).
2. **Layout: left step rail + center work area + right Bid Summary panel.**
   Five steps, in working order:
   1. **Documents** — plan/spec files + pre-bid package import
   2. **Takeoff** — run the AI takeoff + review/confirm counts (merges today's
      "Bid Builder" + "Plan Review")
   3. **Labor & Pricing** — NEW: assemblies, labor hours, material, factors, recap
   4. **Scope & RFIs** — scope of work + RFIs
   5. **Review & Proposal** — internal review, proposal, send to GC
3. **Labor units: seed industry-typical NECA-style starting values**, editable in
   Settings, then calibrated against hours from Jake's Accubid breakdowns.
   These are APT's own starting values written for this app — **not a copy of
   the NECA Manual of Labor Units** (copyrighted). Every seeded unit is marked
   `source='seed'` so the UI can show it hasn't been verified.
4. **Existing contracts stay working.** `bid_estimates` (grand_total, subtotals,
   overhead_pct, profit_pct) and `bids.amount` remain the outputs that
   proposal generation (`preconstruction.ts:1680`), bidData, and the pipeline
   read. The new engine *writes* them; nothing downstream changes.

## Out of scope (later phases, do NOT start)

Plan viewer / sheet markup (Phase B), symbol auto-detection + Python service
(Phase C), distributor price import & copper index (Phase D), job actuals
feedback loop (Phase E), Intake, Leads, Generators.

## Environment facts

- Migrations live in `database/migrations/` (repo root). Main is at **100**.
  **This plan owns 101–104.** `migrate.ts` wraps each file in BEGIN/COMMIT →
  no `CREATE INDEX CONCURRENTLY`. The destructive guard refuses TRUNCATE /
  DROP TABLE — none are needed.
- Backend tests: `npm test` in `backend/` (sets `DB_NAME=electrical_crm_test`;
  harness refuses any other DB). Frontend: `npm test` in `frontend/` (vitest).
- Known backend flakes (pre-existing, not yours): `prebid`, `integration`,
  `jobNumberCollision`, `bidStandardGeneration`, `proposalDocxConfidenceGuard`.
  Baseline both suites first and record numbers in the report.
- UI kit to reuse (from audit batch 4): `components/Modal`, `ConfirmDialog`
  (+Undo), `Badge`, `lib/date.ts`, `lib/money.ts`, `hooks/useApi`,
  `hooks/useMutation`, CSS tokens in `styles.css`. **z-index above a drawer
  must be ≥ 250** (mobile drawer tier is 240).
- `PcWorkspaceView.tsx` (1,229 lines) owns workspace state + autosave
  (`bid_workspaces`, incl. `overhead_pct`/`profit_pct`/`estimate_overrides`
  from migration 098). Persisted `active_tab` values from the old 11-tab set
  must still restore to a sensible step.
- Local Version currently has **uncommitted edits** (browser-extension files,
  `frontend/src/features/builder/ProposalPreview.tsx`). They are Jake's; the
  worktree branches from committed main and must not touch or depend on them.

## Ground rules (permanent)

- Worktree only, from Local Version:
  `git worktree add "../Electrical-program-wt-estimating" -b feat/estimating-labor main`
  (quote paths). `npm install` in `backend/` and `frontend/`. Never edit Local
  Version or other worktrees. **Never start dev servers.** Tests via `npm test`
  only. No pushes. Never send email; never hit the live `electrical_crm` DB.
- Copy this plan into the worktree and commit it as the first commit. Before
  merge, the untracked copy in Local Version must be removed (known merge
  gotcha).
- One commit per task, imperative message, ending with
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Every behavior change ships with tests. Pricing math gets exhaustive unit
  tests (it is money).
- Report at `docs/superpowers/plans/2026-09-22-estimating-report.md`: per task
  — commits, files, tests added, anything deferred and why.

## Module boundary

```
backend/src/estimating/        ← all new backend logic
  pricing.ts                   ← pure pricing engine (no DB, no I/O)
  mapper.ts                    ← takeoff line → assembly matching (pure)
  library.ts                   ← DB access for est_* library tables
  bidEstimate.ts               ← load/save a bid's priced lines; writes bid_estimates + bids.amount
  calibration.ts               ← computed hours vs Accubid breakdown hours
  seed/laborUnits.ts           ← seed data (items + assemblies)
backend/src/routes/estimating.ts   ← mounted at /api/estimating
frontend/src/features/estimating/  ← new UI (shell, rail, summary, Labor & Pricing, library settings)
```

The rest of the CRM talks to estimating only through `/api/estimating/*` and
the existing `bid_estimates` row.

---

## Part 1 — Labor engine (backend)

### Task 1 — Schema (migration 101)

`database/migrations/101_estimating_labor.sql`:

- `est_items` — the material/labor catalog.
  `id uuid pk`, `code text unique` (e.g. `EMT-075`), `name text`, `category
  text` (use the takeoff category names, see `SCOPE_SECS` / Agent 4 categories),
  `unit text` (`EA`, `LF`, `C` = per 100 ft, `M` = per 1000 ft), `material_cost
  numeric(12,4)`, `material_price_date date null`, `labor_hours numeric(10,4)`
  (per unit), `aliases text[] default '{}'` (match terms), `source text check
  in ('seed','accubid','manual','calibrated')`, `active bool default true`,
  timestamps.
- `est_assemblies` — `id`, `code unique`, `name`, `category`, `unit`,
  `aliases text[]`, `source`, `active`, timestamps.
- `est_assembly_components` — `assembly_id fk cascade`, `item_id fk`,
  `qty_per numeric(12,4)` (component qty per 1 assembly unit), pk
  `(assembly_id, item_id)`.
- `est_labor_factors` — named multipliers: `id`, `code unique`, `label`,
  `pct numeric(6,2)` (e.g. `10` = +10% hours), `group_key text` (factors in the
  same group are mutually exclusive, e.g. working height 10–14 / 14–20 / 20+),
  `active`.
- `est_bid_lines` — a bid's priced lines. `id`, `bid_id fk bids`, `sort int`,
  `category`, `description`, `qty numeric`, `unit`, `assembly_id null`,
  `item_id null` (exactly one or neither — CHECK), `takeoff_key text null`
  (stable key back to the takeoff line: `${category}||${item}`, same shape as
  `estimateOverrides`), `material_unit_override numeric null`,
  `labor_hours_override numeric null`, `confidence text null`
  (FIRM/APPROX/VERIFY), `excluded bool default false`, `source text check in
  ('takeoff','manual')`, timestamps. Index on `bid_id`.
- `est_bid_settings` — one row per bid: `bid_id pk fk`, `labor_rate numeric`
  (blended $/hr, default from app setting), `factor_ids uuid[]`,
  `material_tax_pct`, `small_tools_pct` (of labor $), `supervision_pct` (of
  labor hours), `consumables_pct` (of material), `overhead_pct`, `profit_pct`,
  `updated_at`.
- App settings defaults (insert-if-absent into `app_settings`):
  `est_default_labor_rate` (use Accubid's typical blended rate if the parsed
  breakdowns in the DB give one; else 38.00), `est_default_material_tax_pct` 7,
  `est_default_small_tools_pct` 3, `est_default_supervision_pct` 0,
  `est_default_consumables_pct` 2.

Tests: migration applies on the test DB; CHECK constraints reject an
`est_bid_lines` row with both `assembly_id` and `item_id`.

### Task 2 — Seed library (migration 102 + `seed/laborUnits.ts`)

Seed ~150 items and ~40 assemblies covering APT's commercial work
(C-stores w/ fuel, car wash, self-storage, office, warehouse, restaurant,
retail, medical):

- Raceway: EMT ½–4", PVC sch40 ½–4", rigid ¾–2", MC cable 12/2–10/3, fittings
  lumped into assemblies (e.g. "¾" EMT per 100 LF incl. couplings/straps").
- Wire: THHN #12–#4/0, 250–500 kcmil, per M ft.
- Devices: duplex, GFCI, dedicated circuit, floor box, switches (1p/3w/dimmer),
  occupancy sensors, J-boxes, disconnects 30–200A.
- Lighting: 2×4 / 2×2 troffer, downlight, strip, high-bay, exit/emergency,
  wall pack, pole light (base + pole + fixture assembly), canopy light.
- Distribution: panelboards 100–400A (by circuits), transformers 15–150 kVA,
  switchboard allowance, meter base/CT cabinet, service entrance.
- Site: trenching per LF (allowance), pull boxes, conduit underground.
- Low voltage / FA rough-in: data box + ring + pull string, FA device
  rough-in.
- Special: fuel dispenser/ESO rough-in, car wash equipment connection, gate
  operator, EV charger rough-in.

Rules:

- Labor hours are **industry-typical starting values** authored for this app,
  `source='seed'`. Put the whole dataset in `seed/laborUnits.ts` (typed), and
  have migration 102 insert from a generated SQL block (or have `migrate`'s
  seed hook call the TS — follow whatever pattern existing seeding uses;
  report which). Insert-if-absent by `code` so re-runs are idempotent and
  Jake's edits are never overwritten.
- Material costs: ballpark 2026 values, `material_price_date = NULL` meaning
  **unverified**. The UI flags unverified prices (Task 11) — they must never
  silently look authoritative.
- Aliases: include the phrasings Agent 4 actually emits. Pull real item names
  from recent `bid_data` / takeoff JSON in **test fixtures and prompts** (not
  the live DB) and add them as aliases.
- Labor factors seed: working height (10–14 ft +10, 14–20 +20, 20+ +35,
  group `height`), occupied/renovation +15, congested ceiling +10, night/after
  hours +15, multi-story (per floor above 2) +3, remote/site access +5,
  prevailing-wage placeholder 0.

Tests: seed is idempotent (run twice → same counts); every assembly has ≥1
component; every item has unit ∈ allowed set and hours ≥ 0.

### Task 3 — Pricing engine (`estimating/pricing.ts`, pure)

Input: lines (resolved to per-unit material $ and per-unit hours, via assembly
components or item, with overrides applied), bid settings, factor list.
Output (the **recap**):

```
per line: qty, unit, material_unit, material_ext, hours_unit, hours_ext
          (after factors), labor_ext
per category: material, hours, labor $
totals:
  material_subtotal
  consumables        = material_subtotal × consumables_pct
  material_tax       = (material_subtotal + consumables) × material_tax_pct
  labor_hours        = Σ hours_ext × (1 + supervision_pct)
  labor_cost         = labor_hours × labor_rate
  small_tools        = labor_cost × small_tools_pct
  direct_cost        = material + consumables + tax + labor_cost + small_tools
  overhead           = direct_cost × overhead_pct
  profit             = (direct_cost + overhead) × profit_pct   (same rule as today's estimates.ts)
  grand_total
  sell_per_sf        (when bids.sq_ft known)
  crew_weeks         = labor_hours / (crew_size × 40), crew_size from settings (default 3)
warnings: unmatched lines, VERIFY lines, $0 material on a matched line,
          unverified (NULL price date) material share of total, excluded lines
```

- Factors: sum of selected factor pcts (one per `group_key`), applied to hours.
- Units `C`/`M`: qty in LF, per-unit values are per 100 / 1000 → divide.
- Money rounding: keep full precision internally, round to cents only in the
  output fields. No floating-point drift in totals (sum rounded line values
  consistently — pick one rule, test it).
- Tests: every formula above, factor exclusivity, C/M conversion, overrides,
  excluded lines, empty input, a golden-file recap for a realistic C-store bid.

### Task 4 — Takeoff → assembly mapper (`estimating/mapper.ts`, pure)

- Input: takeoff categories/items (the `TakeoffItem` shape in
  `bidstd/bidData.ts:17` and the legacy Agent 2/4 line shape used by
  `buildLineItemsFromTakeoff`), plus the library.
- Deterministic matching: normalize (lowercase, strip punctuation, unify
  `3/4"`, `.75"`, `3/4 in`), match against name + aliases, prefer same unit,
  prefer assemblies over bare items, score and return best match + confidence
  (`exact` / `alias` / `fuzzy` / `none`). Quantities that are strings
  ("VERIFY") map with qty 0 and confidence VERIFY — never coerce to a guessed
  number.
- No AI in this task. (A "suggest with AI" button for unmatched lines is a
  follow-up, not this plan.)
- Tests: table-driven cases from real Agent 4 fixture phrasing; ≥85% of the
  lines in the fixture bids map to something, reported in the test output.

### Task 5 — Bid estimate service + routes

`estimating/bidEstimate.ts` + `routes/estimating.ts` at `/api/estimating`
(`requireAuth`; library writes `requireAdmin`; bid access via the same
`loadAccessibleBid` used in `estimates.ts`):

- `GET  /library` — items, assemblies (with components), factors.
- `PUT  /library/items/:id`, `POST /library/items`, same for assemblies and
  factors (admin). Editing an item sets `source='manual'`. Soft-deactivate,
  never hard delete.
- `GET  /:bidId` — lines + settings + fresh recap. If the bid has no
  `est_bid_lines` yet but has takeoff output, return an **unsaved proposed
  mapping** (`proposed: true`) so the UI can show it before the first save.
- `POST /:bidId/sync-takeoff` — (re)build lines from the current takeoff.
  Preserve manual lines, overrides and exclusions keyed by `takeoff_key`; add
  new takeoff lines; mark vanished takeoff lines `excluded` with a note rather
  than deleting.
- `PUT  /:bidId` — save lines + settings (validated: finite numbers, pcts
  0–100, qty ≥ 0). Recompute recap server-side, then **in the same
  transaction** upsert `bid_estimates` (grand_total, overhead/profit pct,
  subtotals per category, total_direct = direct_cost, total_overhead,
  total_profit, line_items in the legacy shape so old readers keep working,
  comp_count/confidence exactly as `estimates.ts` computes them) and update
  `bids.amount`. Extract the comp_count query from `estimates.ts` into a
  shared helper rather than duplicating it.
- `POST /:bidId/price` — price an unsaved payload and return the recap (for
  live recalculation while editing; no writes).
- Tests (test DB): proposed mapping, sync preserves overrides, save writes
  `bid_estimates` + `bids.amount` consistently with the recap, auth (non-admin
  can't edit library; user without bid access gets 404/403 like elsewhere),
  validation 400s.

### Task 6 — Calibration report

`estimating/calibration.ts` + `GET /api/estimating/calibration` (admin):
for bids that have **both** an imported Accubid breakdown (hours from
`accubidParse`) and a takeoff that maps through the engine, compute engine
hours vs Accubid hours per bid and overall ratio, plus the categories with the
largest gaps. Read-only — it **suggests** a global or per-category adjustment;
applying it is a button in Settings that writes `source='calibrated'` values
(Task 12). Tests with fixture data.

---

## Part 2 — Estimating workspace redesign (frontend)

Visual direction: clean, calm, dense-but-readable, like a modern estimating
tool. Reuse existing tokens and components; **move inline styles in touched
files into classes in a new `features/estimating/estimating.css`**. Light and
dark both correct. No new UI library.

### Task 7 — Estimating shell: step rail + work area + summary

`features/estimating/EstimateShell.tsx`, rendered by the Bid Hub
**Estimating** tab in place of today's `TabStrip` + `Stepper`:

```
┌──────────────┬───────────────────────────┬─────────────────┐
│ ESTIMATE     │  3 · Labor & Pricing      │ BID SUMMARY     │
│ ✓ 1 Documents│  (step content)           │ Material        │
│ ✓ 2 Takeoff  │                           │ Labor hrs / $   │
│ ● 3 Labor &  │                           │ OH / Profit     │
│     Pricing  │                           │ TOTAL           │
│ ○ 4 Scope &  │                           │ $/SF vs comps   │
│     RFIs     │                           │ Warnings        │
│ ○ 5 Review & │                           │ ▸ Insights      │
│     Proposal │                           │                 │
└──────────────┴───────────────────────────┴─────────────────┘
```

- Step status is **derived from data**, not stored: Documents done when plan
  files exist; Takeoff done when AI output exists **and** key project data is
  confirmed (today's gate in TakeoffTab); Labor & Pricing done when saved lines
  exist with no unmatched non-excluded lines; Scope done when scope sections
  are non-empty; Review & Proposal done when the proposal is filed/sent. Steps
  are always clickable (no hard lock) but show "needs X first" hints.
- Each step shows a primary "Next: …" action at the bottom of the work area.
- URL: `?tab=estimating&step=<key>`. Map persisted legacy `active_tab` values:
  overview/prebid/files → documents; bid/takeoff → takeoff; pricing → pricing;
  scope/rfis → scope; proposal → review; costs/intel/compare → pricing (+ open
  the Insights section).
- Save-state indicator ("Saving… / Saved / Not saved — retrying") moves to the
  rail header. Autosave behavior in `PcWorkspaceView` is unchanged.
- **Responsive:** ≥1280px three columns; 900–1279px summary collapses to a
  slim sticky bar at top of the work area (expandable); <900px rail becomes a
  horizontal chip row and the summary a sticky bottom bar with the total.
  16px gutters, no horizontal page scroll.
- Remove the duplicate workspace "Overview" and "Files" tabs from estimating —
  Documents step reuses the existing file components filtered to plans/specs,
  with a link to the Bid Hub Files tab for everything else.
- Tests: rail renders five steps in order; derived status cases; legacy
  `active_tab` mapping; URL step round-trip; responsive class switch (via
  matchMedia mock).

### Task 8 — Re-home existing step content (no behavior changes)

- **Documents:** FilesTab (plans/specs) + PreBidUpload/PreBidTab import.
- **Takeoff:** BidTab's "Run AI Takeoff / Resume" panel on top, TakeoffTab
  results below (one screen). Keep the confirm-key-data gate.
- **Scope & RFIs:** ScopeTab then RfisTab, as two panels on one screen.
- **Review & Proposal:** ProposalTab + SendBidProposalModal entry point,
  preceded by a short **pre-send checklist** reading the recap warnings
  (unmatched lines, VERIFY qtys, unverified material share) — informational,
  not blocking (the existing verifyBid gate remains the real gate).
- Old `PricingTab` is replaced by Task 9; delete it once nothing imports it.
  `CostsTab` and `IntelTab` move into the summary's Insights section (Task 10).
- Existing tests for these components must stay green; update only
  selectors/mount paths, never assertions about behavior.

### Task 9 — Labor & Pricing screen

`features/estimating/LaborPricingStep.tsx`:

- Header row: labor rate, crew size, factor chips (grouped; one per group),
  tax / consumables / small tools / supervision / overhead / profit — compact
  inline inputs, defaults from settings.
- **Unmatched lines** banner at top when any exist → opens a resolver: search
  the library (items + assemblies), pick, or "keep as manual line" with typed
  material $ and hours.
- Table grouped by category (collapsible), columns: description · qty · unit ·
  assembly/item · mat $/unit · mat ext · hrs/unit · hrs ext · labor $ ·
  confidence badge. Inline edit qty, material override, hours override (edited
  cells marked, "reset to library" on hover). Exclude toggle. Add manual line.
  Category subtotal rows.
- Unverified material price → subtle marker on the cell with tooltip.
- "Sync from takeoff" button (calls `sync-takeoff`, shows what changed).
- Live recap: debounce 400ms → `POST /price`; Save → `PUT /:bidId`. Integrate
  with the existing workspace dirty-guard/autosave pattern (see
  `PcWorkspacePricingDirtyGuard.test.tsx`) so leaving with unsaved pricing
  prompts the same way it does today.
- Keyboard: Enter/Tab move between editable cells.
- Tests: render from a recap fixture, override edit → recalc request, exclude,
  resolver pick, save payload shape, dirty guard.

### Task 10 — Bid Summary panel

`features/estimating/BidSummary.tsx` (reads the latest recap, from context
shared with the Labor & Pricing step so both show the same numbers):

- Material (incl. tax/consumables), Labor hours + labor $, Small tools,
  Overhead, Profit, **Total** (large), $/SF, crew-weeks.
- **$/SF vs comparables:** use the existing
  `/preconstruction/:bidId/comparables` data → show range and where this bid
  falls (simple bar, not a chart library).
- Warnings list with click-to-jump (e.g. "3 VERIFY quantities" → Takeoff step
  filtered; "2 unmatched lines" → resolver).
- Collapsible **Insights**: today's Historical Costs (CostsTab) and Win-Rate
  Insights (IntelTab) content, compacted.
- Before a pricing save exists, show the proposed recap with an "unsaved" tag.
- Tests: values render from fixture; warning click navigates; comps bar
  placement.

### Task 11 — Settings: Labor Library

Replace `settings/sections/UnitCostSection.tsx` with
`features/estimating/LaborLibrarySection.tsx` (keep the Settings nav slot;
admin only):

- Tabs: Items · Assemblies · Labor Factors · Defaults · Calibration.
- Items/assemblies: searchable table, category filter, inline edit
  (hours, material $, price date, aliases), source badge (Seed / Manual /
  Calibrated / Accubid), "unverified price" filter, deactivate with Undo.
- Assemblies: component editor (item picker + qty_per), live per-unit
  material/hours preview.
- Defaults: labor rate, crew size, tax/consumables/small tools/supervision/
  OH/profit.
- Calibration: renders Task 6's report; "Apply suggested adjustment"
  (per-category or global) behind ConfirmDialog → writes `source='calibrated'`.
- The legacy `unit_cost_library` setting stays in the DB untouched (read-only
  fallback is no longer used by pricing; note it in the report).
- Tests: edit + save round-trip, deactivate/undo, calibration apply payload.

### Task 12 — Polish & consistency pass (estimating screens only)

- One heading style per step, consistent panel spacing, empty states with a
  single clear action ("Upload plans", "Run AI takeoff", "Sync from takeoff").
- Remove leftover inline styles in touched estimating files → classes.
- Verify both themes and the three breakpoints via component tests (class
  assertions) — the executor does not run a browser.
- Main bundle must not grow: estimating ships as a lazy chunk (follow the
  batch-4 code-splitting pattern; `App.codeSplitting.test.tsx`).

---

## Review & merge

1. Sonnet executes Tasks 1–6 (backend), reports; then Tasks 7–12.
2. Opus 5 full adversarial review of `main..feat/estimating-labor`: money math,
   `bid_estimates`/`bids.amount` consistency, legacy readers of
   `bid_estimates.line_items`, auth on library writes, sync-takeoff never
   destroying estimator edits, autosave/dirty-guard regressions, z-index,
   mobile layout. File:line evidence, verdict MERGE / MERGE AFTER FIXES / DO
   NOT MERGE.
3. Fix rounds as needed; main session gives final verdict with spot-checks.
4. **Jake approves merge.** After merge: migrations 101–102 apply on the live
   backend restart; verify `/api/health`, frontend 200; kickstart
   `com.jakesalverda.crm-autostart` if ts-node-dev sticks mid-merge.
5. Jake test-drives on one real bid (Labor & Pricing → Save → proposal shows
   the same total) before relying on it.
