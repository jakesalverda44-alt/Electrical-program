# Estimating Labor Engine — Part 1 (Backend) Report

**Branch:** `feat/estimating-labor`, off local `main` (`c662ceb`)
**Commit range:** `bae1bd5..4568a6a` (7 commits: plan copy + Tasks 1–6)
**Executor:** Sonnet 5
**Scope:** Tasks 1–6 only (migrations 101–102, pricing engine, mapper, bid
estimate service + `/api/estimating` routes, calibration report). Frontend
(`frontend/`) was not touched.

## Baseline (before any change, on this worktree at `c662ceb`)

- Backend (`npm test` in `backend/`): **836 passed, 3 failed, 839 total**,
  99 passed / 1 failed test file. The 1 failed file was
  `notificationsRetention.test.ts` (3 tests) — `RangeError: Invalid string
  length` / `Connection terminated unexpectedly`. This is **not** one of the
  flakes named in the plan (`prebid`, `integration`, `jobNumberCollision`,
  `bidStandardGeneration`, `proposalDocxConfidenceGuard`) but is clearly
  pre-existing and unrelated to estimating — confirmed by re-running it in
  isolation before touching any estimating code, and again identically after
  every task.
- Frontend (`npm test -- --run` in `frontend/`): **578 passed, 1 failed, 579
  total**, 85 passed / 1 failed test file
  (`SurveyMarkupEditor.test.tsx`, a `waitFor` timeout on a fullscreen toggle —
  unrelated to estimating).

## Final (after Tasks 1–6)

- Backend: **907 passed, 3 failed, 910 total**, 106 passed / 1 failed test
  file. The 1 failed file is the **same** `notificationsRetention.test.ts`
  with the same 3 failures, same error signatures — re-confirmed not
  introduced by this work (it fails identically on a clean `git stash` of
  everything past `bae1bd5`... actually simpler: it already failed at the
  baseline measurement above, before any estimating code existed).
  Net: **+71 passed tests, +7 test files**, zero new failures.
- Frontend: **579 passed, 0 failed, 579 total** — identical file/test count
  to baseline (nothing in `frontend/` changed); the one baseline failure
  (`SurveyMarkupEditor.test.tsx`) didn't reproduce on this run, confirming it's
  an intermittent flake, not something this work touched either way.
- `npx tsc --noEmit` in `backend/`: clean, no errors, at every task boundary.

No known flakes from the plan's list (`prebid`, `integration`,
`jobNumberCollision`, `bidStandardGeneration`, `proposalDocxConfidenceGuard`)
were exercised in a way that changed their behavior; I ran `integration.test.ts`
directly after refactoring `estimates.ts` (Task 5) and it passed clean (31/31).

## Task 1 — Schema (migration 101)

**Commit:** `c2eb956`
**Files:** `database/migrations/101_estimating_labor.sql`,
`backend/src/test/estimatingSchema.test.ts`

Creates `est_items`, `est_assemblies`, `est_assembly_components`,
`est_labor_factors`, `est_bid_lines`, `est_bid_settings`, plus the five
`est_default_*` app_settings rows (insert-if-absent; `est_default_labor_rate`
prefers the average of any `bid_cost_breakdown.avg_labor_rate` values already
in the DB, falling back to 38.00).

**Deviation from the plan's literal field list:** `est_bid_settings` also
gets a `crew_size numeric NOT NULL DEFAULT 3` column. The plan's Task 1 field
list for that table doesn't mention it, but Task 3's pricing engine spec
requires `crew_size` ("from settings (default 3)") for the `crew_weeks`
output, and there was no other place in the schema to source it per-bid. This
follows the same pattern as the table's other per-bid pricing knobs
(`labor_rate`, `overhead_pct`, ...), each with a sensible default.

**Tests (5):** every `est_*` table is created; the 5 `est_default_*` settings
are seeded exactly once with a positive labor rate; `est_items` rejects a unit
outside EA/LF/C/M and rejects negative `labor_hours`; `est_bid_lines` rejects
a row with both `assembly_id` and `item_id` set, and allows a row with
neither.

**One real gotcha hit and resolved (not a bug, a race inherent to
`migrate.ts`):** the first time migrations 101/102 were applied, two parallel
vitest workers' `dbAvailable()` calls raced to INSERT the same
`schema_migrations` row for `102_estimating_labor_seed.sql`, and one lost with
a duplicate-key error. This is a pre-existing characteristic of
`migrate.ts`'s check-then-insert pattern under parallel test workers (see its
own comments about the destructive-guard test's ENOENT race) — it only bites
on a migration file's *first* application across the whole test DB's history,
never again once the row is committed. It self-resolved on the very next run
and every run since. Not something to fix in this plan's scope (`migrate.ts`
itself isn't part of the module boundary), but worth flagging for whoever
merges: the first `npm test` run against a database that hasn't seen 101/102
before could show this once.

## Task 2 — Seed library (migration 102 + `seed/laborUnits.ts`)

**Commit:** `59076ef`
**Files:** `backend/src/estimating/seed/laborUnits.ts`,
`backend/scripts/generateLaborSeedSql.ts`,
`database/migrations/102_estimating_labor_seed.sql`,
`backend/src/test/estimatingSeed.test.ts`

**139 items, 41 assemblies, 9 labor factors** across all 8
`TAKEOFF_CATEGORIES` (raceway/wire, devices, lighting controls, interior/
exterior lighting, distribution, site/underground, low-voltage/FA rough-in,
special equipment connections, grounding). Every row is `source='seed'` with
`material_price_date` left `NULL` (unverified). Labor hours and material
costs are values I authored for this app — deliberately not the NECA Manual
of Labor Units. Aliases are pulled from `backend/src/test/fixtures/bidstd/
bid_data.example.json` (the canonical Agent 4 output fixture) plus common
trade phrasing, never the live DB.

**Which seeding pattern, and why:** the plan offered two options — "insert
from a generated SQL block" or "have migrate's seed hook call the TS."
`migrate.ts`'s runner only executes raw `.sql` files inside their own
BEGIN/COMMIT; its one precedent for TS-driven seeding (bootstrapping the
first admin user) is inline in `migrate.ts` itself, which would mean
special-casing this one migration's filename there. I generated the SQL
instead: `laborUnits.ts` is the single typed source of truth, and
`scripts/generateLaborSeedSql.ts` renders it to
`102_estimating_labor_seed.sql` (every INSERT is `ON CONFLICT (code) DO
NOTHING`, or the natural key for `est_assembly_components`). Regenerate with
`npx tsx scripts/generateLaborSeedSql.ts > ../database/migrations/
102_estimating_labor_seed.sql` from `backend/` whenever the seed data changes.

**Tests (8):** the typed source data — counts near the plan's ~150/~40
targets, every item's unit/hours/material_cost valid, every item code
unique, every assembly has ≥1 component referencing a real item code, every
assembly code unique with a valid unit, labor factor groups sane (3 height
bands) — plus DB-level idempotency (re-running the generated SQL a second
time changes no row counts) and the source/`material_price_date` invariant.

## Task 3 — Pricing engine (`estimating/pricing.ts`)

**Commit:** `b768580`
**Files:** `backend/src/estimating/pricing.ts`,
`backend/src/estimating/pricing.test.ts`

Pure (`priceBid()`, no DB/I/O). Takes resolved lines (per-unit material $/
hours already looked up, plus overrides), bid settings, and a factor
selection; returns the full recap per the plan's formula list exactly —
material subtotal, consumables, tax, labor hours (with supervision folded in
once at the aggregate level), labor cost, small tools, direct cost, overhead,
profit, grand total, $/SF, crew-weeks — plus per-category rollups and
warnings (unmatched, VERIFY, $0-material-on-a-matched-line, excluded count,
unverified-material share).

**Money rounding rule (as the plan asked, "pick one rule, test it"):** every
money value rounds to the nearest cent via integer-cent arithmetic, and every
subtotal is a **sum of already-rounded cents**, never a round of a sum of
fractions — so the displayed total always equals the sum of the displayed
line items, with no drift. Hours are rounded only for display (4 decimal
places), never before being summed.

**Factor exclusivity:** at most one factor per `group_key` is applied (first
occurrence wins) regardless of how many the caller passes — defensive against
a caller sending two height bands at once; the UI is expected to offer one
radio-style choice per group.

**Tests (17):** empty input, EA/LF pass-through, C (÷100) and M (÷1000) unit
conversion, material/hours overrides winning over the resolved value,
excluded lines contributing nothing to totals/categories while still being
priced for display, factor exclusivity and its effect on hours-not-material,
every warning type, and a **golden-file recap** for a 10-line C-store-style
bid with every total hand-computed and matched exactly on the first run.

## Task 4 — Takeoff → assembly mapper (`estimating/mapper.ts`)

**Commit:** `8b7d088`
**Files:** `backend/src/estimating/mapper.ts`,
`backend/src/estimating/mapper.test.ts`

Pure, deterministic, no AI. `mapTakeoffLine()`/`mapTakeoffLines()` match a
normalized line against the library (items + assemblies, by name + aliases)
and return a confidence tier (`exact`/`alias`/`fuzzy`/`none`) plus the
winning candidate. Two adapters cover the plan's two named input shapes:
`fromTakeoffCategories()` (bidstd `TakeoffItem`/`TakeoffCategory`) and
`fromLegacyTakeoff()` (the Agent 2/4 `{category,item,qty,unit,confidence}`
shape `buildLineItemsFromTakeoff` reads). A string qty (`"VERIFY"`) is never
coerced — it maps to `qty: 0` with `sourceConfidence: 'VERIFY'`.

**A real bug found and fixed while building the fixture test:** fuzzy
matching started as a plain token-overlap coefficient (chosen over Jaccard,
which over-penalizes short phrases with extra qualifiers). Against the real
seed library, this let **"400A ... service entrance assembly, NEMA 3R"**
out-score the correct **"800A ... service entrance assembly, NEMA 3R"**'s
alias match — the two share almost every word ("service", "entrance",
"assembly", "nema") and differ only in the rating. Frequency-weighting the
tokens (down-weighting words common across the library) helped but wasn't
enough on its own, because "3PH"/"NEMA"/"3R" are *also* only shared by these
two candidates, so they got high weight too and didn't discriminate. The
actual fix: a fuzzy candidate whose own name/alias carries a digit-bearing
token (a rating or size) that the takeoff description does **not** have is
disqualified outright, not just down-ranked — silently pricing an 800A
service against 400A numbers is worse than leaving it unmatched for the
resolver. Locked in with a dedicated regression test.

**Tests (16):** normalize() unifying `3/4"` / `.75"` / `3/4 in` / `3/4 inch`;
all four confidence tiers; assembly-over-item tie-break; unit/category
disambiguation; VERIFY qty handling (string vs numeric-string vs a
passed-through FIRM/APPROX); both adapters; the rating-conflict regression;
and an integration-style test running the **real seed library**
(`SEED_ITEMS`/`SEED_ASSEMBLIES`) against the canonical
`bid_data.example.json` fixture.

**Mapper match rate on the fixture bid: 13/13 lines (100%)**, well above the
plan's 85% bar — logged per-line in the test output (7 exact, 3 alias, 3 that
were exact/alias after the rating-conflict fix, 0 fuzzy, 0 none).

## Task 5 — Bid estimate service + `/api/estimating` routes

**Commit:** `b4ddbda`
**Files:** `backend/src/estimating/library.ts`,
`backend/src/estimating/bidEstimate.ts`, `backend/src/routes/estimating.ts`,
`backend/src/utils/bidComps.ts` (new — extracted from `estimates.ts`),
`backend/src/routes/estimates.ts` (edited: now calls the shared helper),
`backend/src/index.ts` (mounts the router),
`backend/src/test/estimatingLibrary.test.ts`,
`backend/src/test/estimatingBid.test.ts`

- `library.ts`: `getLibrary()` (items, assemblies with resolved components,
  factors — active and inactive, so an admin UI can manage deactivated rows),
  `resolveAssemblyCost()`, and admin CRUD. Editing a row (any field but
  `active`) sets `source='manual'`; deactivate/reactivate is a pure `active`
  flag and never touches `source` or deletes anything.
- `bidEstimate.ts`: resolves `est_bid_lines` against the library into
  `pricing.ts`'s input shape; builds an **unsaved proposed mapping**
  (`GET /:bidId` returns `proposed: true`) from `takeoff_results.agent2_output`
  when a bid has no saved lines yet, parsed the exact same way the frontend's
  `buildLineItemsFromTakeoff` already does (fenced-code-block-then-first-`{`
  extraction) so both read the one stored blob identically; **syncs from a
  re-run takeoff** (`POST /:bidId/sync-takeoff`) keyed by `takeoff_key`
  (`${category}||${item}`, same shape as `bid_workspaces.estimate_overrides`)
  — surviving lines keep their match/overrides/exclusion and only refresh
  qty/unit/confidence, brand-new takeoff lines are mapped and inserted,
  vanished ones are **excluded with a note, never deleted**; and **saves**
  (`PUT /:bidId`) a bid's full line set + settings by recomputing the recap
  and, in one transaction, replacing `est_bid_lines`, upserting
  `est_bid_settings`, upserting `bid_estimates`, and updating `bids.amount` —
  the last three all come from the one recap just computed, so they can never
  drift apart.
- **Known limitation, documented inline:** `bid_estimates.line_items` is
  written in the legacy `{category,item,qty,unit,unit_cost,total,overridden,
  confidence}` shape so existing readers don't break, but `item` is populated
  with the line's `description` (est_bid_lines has no separate short-id
  column). `composeBidData`'s `SavedConfidenceItem` lookup
  (`preconstruction.ts:1841`) keys on Agent 4's short item id (e.g. `"5.1"`),
  so for a bid priced through the new engine that specific confidence-carry-
  through will miss and fall back to Agent 4's own echoed confidence — it
  degrades gracefully, it doesn't crash, but it's a real behavior gap versus
  the old flat-estimate path. Fixing it would mean adding an item-label
  column to `est_bid_lines`, which is a schema change beyond this task's
  scope; flagging it for the Opus review pass.
- `bid_estimates.subtotals[category]` is now `material + labor` extended $
  for that category (direct-cost contribution), not the old flat `qty ×
  unit_cost` — the `/preconstruction/costs` reader only displays this number,
  it doesn't do further math on it, so this is a safe approximation, not a
  crash risk.
- `routes/estimating.ts`: `GET/POST/PUT /library(/items|/assemblies
  |/factors)` (writes `requireAdmin`); per-bid `GET/PUT /:bidId`, `POST
  /:bidId/sync-takeoff`, `POST /:bidId/price` (no writes), all via the same
  `loadAccessibleBid` used by `estimates.ts`. Validates finite numbers, 0–100
  percentages, `qty >= 0`, and the assembly/item exclusivity before touching
  the DB.
- `utils/bidComps.ts`: the comp-count/confidence query extracted verbatim out
  of `estimates.ts`'s PUT handler per the plan's explicit instruction — same
  query, same thresholds, `estimates.ts` now just calls it. Covered by the
  pre-existing `estimates.confidence.test.ts` (still green) and
  `integration.test.ts` (31/31, re-run directly after this change).

**Tests (21 across the two new files):** library reads (any authenticated
user) vs writes (admin-only, 403 for `estimator`/non-privileged roles);
editing a seeded item flips it to `source='manual'` (and the test restores
the original value afterward so it doesn't leave permanent drift for later
runs); deactivate is reversible and never deletes; bad unit/negative-number/
empty-components 400s; assembly create/update with components round-trips
the resolved component list; proposed mapping when a bid has takeoff output
but no saved lines; empty recap for a bid with neither; **save** writes
`bid_estimates`/`bids.amount` consistent with the returned recap (`grand_total`
matches to the cent, `line_items.length` and `subtotals` keys correct); 400s
for negative qty, an out-of-range percentage, and an assembly_id+item_id
line; **sync-takeoff** end-to-end (create from scratch, save with an override
+ a manual line, change the takeoff to drop one line/add another/change a
qty, sync, and verify: the surviving line's qty refreshed but its override
survived, the vanished line is excluded with the `[No longer in takeoff]`
note, the manual line is completely untouched, the new line was added and
mapped); bid-access 403 for a salesperson reading/pricing another rep's bid,
404 for a bid that doesn't exist; `POST /price` writes nothing to
`est_bid_lines`.

## Task 6 — Calibration report

**Commit:** `4568a6a`
**Files:** `backend/src/estimating/calibration.ts`,
`backend/src/routes/estimating.ts` (adds `GET /calibration`, **before**
`/:bidId` so it's never captured as a bid id),
`backend/src/test/estimatingCalibration.test.ts`

`computeCalibrationReport()`: finds every bid with a real Accubid breakdown
(`bid_cost_breakdown.labor_hours`) **and** a takeoff the engine can price
(saved lines, or an unsaved proposed mapping when nothing's saved yet — never
writes). Per bid: engine hours vs Accubid hours and their ratio. Overall:
Σengine / Σaccubid. Per category: an hours-weighted average deviation from
1.0 across every bid that has hours in that category, sorted by the largest
miscalibration first — the basis for Task 12's "apply suggested adjustment"
button (writes `source='calibrated'`), which is out of scope here.

**A real test-hygiene bug found and fixed:** the shared test DB is never
reset between runs (by design — see harness.ts's incident-note comments),
and this report aggregates over **every** bid with a `bid_cost_breakdown`
row, company-wide. The first version of this test created two bids, asserted
on the report's *global* `overallRatio` and `categoryGaps`, and passed — then
failed on the very next `npm test` run, because the previous run's bids were
still sitting in `bid_cost_breakdown` and skewed the aggregate
(`overallRatio` drifted from the expected `1.0` to `1.018`). Fixed by having
every test in the file delete the `bid_cost_breakdown` rows it inserted in a
`finally` block; re-ran the file three times in a row to confirm it's stable.
This is worth calling out for the Opus review: **any future test that reads
a company-wide aggregate over a table this test DB never truncates must clean
up after itself**, or it will pass once and then flake forever after.

**Tests (4):** a two-bid fixture (one bid where the engine reports 20% more
hours than Accubid, one where it reports 20% less) with every ratio and
per-category adjustment hand-computed and matched exactly; a bid with a
breakdown but no takeoff/lines is excluded from the report entirely (not
counted as a 0); a bid with takeoff output but no saved lines uses the
proposed mapping; the route is admin-only.

## What's deferred (and why)

- **Tasks 7–12 (frontend workspace redesign)** — explicitly out of scope for
  this run; Part 2 per the plan.
- **`item_label`/short-id column on `est_bid_lines`** — would let
  `composeBidData`'s confidence lookup work for new-engine bids the way it
  does for the old flat-estimate path (see Task 5's note above). A schema
  change beyond Tasks 1–6; flagging for the review pass to decide whether
  it's worth a small follow-up migration before merge.
- **Frontend touched:** none. No shared type file needed changing — the
  legacy `EstimateLineItem`/`unit_cost_library` contracts in
  `frontend/src/features/preconstruction/` are untouched; the new engine's
  types live entirely in `backend/src/estimating/`.

## Everything a reviewer should look at first

1. **`backend/src/estimating/mapper.ts`'s digit-conflict guard** (the
   `hasConflictingSpec` check) — this is the fix for a real silent-mispricing
   bug (400A vs 800A). Worth an adversarial look for other cases where
   frequency-weighted overlap alone still isn't enough.
2. **`backend/src/estimating/bidEstimate.ts`'s `saveBidEstimate()`** — the
   money-critical transaction (est_bid_lines replace, est_bid_settings
   upsert, bid_estimates upsert, bids.amount update, all one transaction).
3. **The `line_items`/`subtotals` legacy-shape approximation** in
   `saveBidEstimate()` and the `composeBidData` confidence-lookup gap it
   creates — a real, documented, but not-yet-fixed compatibility gap.
4. **`migrate.ts`'s first-application race** noted under Task 1 — not a bug
   in this work, but will surface once, harmlessly, on the first real `npm
   test` run against a database that hasn't seen 101/102 before.

**Update, Part 1 follow-up (see below):** item 3 above (the composeBidData
confidence-lookup gap) is fixed — migration 103 adds
`est_bid_lines.takeoff_item_id`, populated end to end. See "Part 1 follow-up"
immediately below, before the Part 2 section.

---

# Part 1 follow-up — takeoff_item_id (composeBidData confidence gap)

**Commit:** `cb19d21`

Closes the gap flagged above. Migration 103 (101 was already applied on the
test DB, so this is a new migration, not an edit) adds a nullable
`est_bid_lines.takeoff_item_id text`.

While wiring this through, corrected a wrong assumption from the original
Task 4 work: in the legacy Agent 2/4 takeoff shape, `item` is Agent 4's short
takeoff item id (e.g. `"5.1"`), matching `Agent4TakeoffItem`'s own field —
**not** the descriptive text. The original assumption (based on a
hand-crafted confidence-test fixture, not the real shape) had this backwards.
`spec` (previously unmodeled) carries the descriptive text; `fromLegacyTakeoff`
now falls back to `item` for matching when `spec` is absent, so every existing
caller/test that only ever set `item` keeps working unchanged.
`mapper.ts`'s `NormalizedTakeoffLine`/`MappedLine` and `bidEstimate.ts`'s
`RawTakeoffRow`/`ClientLineInput`/`BidLineRow` all carry
`takeoffItemId`/`takeoff_item_id` through; `getProposedLinesFromTakeoff`,
`syncTakeoff` (on both insert and update — it's a takeoff-owned fact,
refreshed on every sync, not an estimator override) and `saveBidEstimate` all
populate it. `saveBidEstimate` emits it as `bid_estimates.line_items[].item`
when present; a manual line has none, so its description is used instead.

**A second, unrelated bug found and fixed while wiring this in:**
`saveBidEstimate`'s `legacyLineItems` builder zipped the recap's lines
(filtered to drop excluded ones) against the **original, unfiltered** `lines`
array by index — every line after the first excluded one was paired with the
wrong original, corrupting its `item`/`overridden` value. Fixed by pairing
every recap line with its original by index **before** filtering.

**5 new tests:** `takeoff_item_id` round-trips into `line_items.item` and
`est_bid_lines`; a dedicated regression for the index-misalignment bug (an
excluded line followed by a kept, overridden line); and the requested proof
that `composeBidData` resolves per-line confidence for a bid saved through the
new engine — reads `bid_estimates.line_items` exactly as
`preconstruction.ts`'s `composeCurrentBidData` does and confirms the saved
`VERIFY` beats Agent 4's own echoed confidence.

**Test counts after this fix:** backend 912 → 915 passed (3 known-flake
failures unchanged), 915 total. Zero frontend changes.

---

# Part 2 — Frontend Workspace Redesign Report

**Commit range:** `1f51405..be340f6` (6 commits: Tasks 7, 9, 10, 11, 8+12)
**Scope:** Tasks 7–12 of the plan (EstimateShell, Labor & Pricing step, Bid
Summary panel, Settings Labor Library, re-homing existing step content into
the shell, lazy-loading the new chunk). Two small, contained backend
additions were needed for Task 11 (documented in that task's section) — no
other backend files changed in Part 2.

## Baseline (immediately before Part 2, i.e. right after the Part 1 follow-up commit)

- Backend: 915 passed / 3 failed / 918 total (unchanged from the Part 1
  follow-up's own final count — Part 2 added 3 more backend tests for Task
  11's small calibration-apply endpoint, bringing it to 918 passed / 3 failed
  / 921 total by the end of Part 2 — see Task 11 below).
- Frontend: 579 passed / 0 failed / 579 total, 86 files (the one baseline
  flake, `SurveyMarkupEditor.test.tsx`, didn't reproduce on the Part 1
  report's final run).

## Task 7 — Estimating shell: step rail + work area + summary

**Commit:** `1f51405`
**Files:** `frontend/src/features/estimating/{types,steps,EstimateShell,
useEstimateStepParam}.ts(x)` + their `.test` files, `estimating.css`.

`EstimateShell.tsx`: left step rail + center work area + right Bid Summary
panel, exactly as the plan's ASCII layout shows. Five steps in working order
(Documents, Takeoff, Labor & Pricing, Scope & RFIs, Review & Proposal), every
step always clickable (no hard lock), a "needs X first" hint under a
not-done step whose immediate predecessor also isn't done, the save-state
indicator moved into the rail header (`est-save-state`, replacing the old
TabStrip's `pc-save-state`), and three responsive layouts via a small
`useEstimateBreakpoint()` hook (same addEventListener-with-Safari-fallback
shape as the app's existing `useIsMobile()`): ≥1280px three columns,
900–1279px a collapsible slim summary bar above the work area, <900px a
horizontal chip-row rail plus a sticky bottom summary bar.

`steps.ts` (pure, no React): the five step definitions;
`mapLegacyTabToStep()` implementing the plan's exact table
(overview/prebid/files→documents; bid/takeoff→takeoff; pricing→pricing;
scope/rfis→scope; proposal→review; costs/intel/compare→pricing); the reverse
`stepToLegacyTab()` for persisting a representative legacy value back into
`ws.activeTab`; `deriveStepStatus()` (done status computed from data every
render, never stored); `stepHint()`.

`useEstimateStepParam.ts`: `?step=<key>`, merged onto whatever else is in the
URL (in particular BidHubPage's own `?tab=`) — satisfies the plan's
`?tab=estimating&step=<key>` contract. **Made Router-optional after Task 8
surfaced the reason why** — see Task 8's section; this file's own tests
(added at that point) cover both the routed and local-state paths.

`types.ts`: the frontend's mirror of `backend/src/estimating`'s wire shapes.

**Tests:** 27 (13 `steps.ts`, 10 `EstimateShell`, 4 `useEstimateStepParam` —
later 5 once Task 8 added the Router-optional case). Rail renders all five
steps in order; done/active styling; every step clickable regardless of
status; hint logic; save-state text; work-area header/children/Next action;
responsive breakpoint switch via a `matchMedia` mock returning different
`matches` per query string (simulating 1400px/1000px/700px viewports).

## Task 9 — Labor & Pricing screen

**Commit:** `d64356b`
**Files:** `useEstimatingBid.{ts,test.ts}`, `LaborPricingStep.{tsx,test.tsx}`.

`useEstimatingBid(bidId)`: owns a bid's estimating state (lines, settings,
recap, proposed) so the Labor & Pricing step and Bid Summary always read the
same numbers. The plan calls this "shared via context"; a hook owned by the
caller (PcWorkspaceView, alongside everything else it already owns — `ws`,
`aiResults`, `savedEstimate`) achieves the same sharing with one fewer moving
part and matches how the rest of that component is built — a deliberate,
documented deviation from a literal React Context, not an oversight. Debounces
edits into one `POST /price` 400ms after the last change (two rapid edits
collapse into a single request — tested), `PUT`s the full set on save
(clearing `proposed` and dirty), `POST`s `sync-takeoff`.

`LaborPricingStep.tsx`: labor rate/crew size/tax/consumables/small tools/
supervision/overhead/profit inputs; factor chips grouped by `group_key`,
mutually exclusive within a group; an unmatched-lines banner opening a
resolver (search the library, pick an item/assembly, or keep as a manual
line, via the shared `Modal` component — default z-index tier, since nothing
here opens from inside a drawer); a table grouped by category with
inline-editable qty/material-override/hours-override (a "reset" link on an
edited cell); exclude toggle; "add manual line"; "sync from takeoff"; Save.
Enter moves focus to the same column in the next row (a small `onKeyDown` on
the table — Tab already does this natively via DOM order).

**Tests:** 19 (7 `useEstimatingBid`, 12 `LaborPricingStep`, later 13 once the
malformed-response regression was added in Task 8). Hydration exactly once;
the debounced recalc; dirty detection; save's payload/proposed-clearing/error
handling; sync-takeoff's line replacement; rendering from a recap fixture; an
override edit calling `setLines`; reset-to-library; exclude; the resolver's
pick and keep-as-manual paths; save-payload shape; factor mutual exclusivity;
Enter-moves-down-a-column.

## Task 10 — Bid Summary panel

**Commit:** `aee02ce`
**Files:** `BidSummary.{tsx,test.tsx}`.

Reads the same recap `LaborPricingStep` prices from (both are handed the same
`useEstimatingBid` slices by their common caller). Material (incl. tax/
consumables), labor hours + $, small tools, overhead, profit, the total (an
"Unsaved" tag while `proposed`), $/SF, crew-weeks, a $/SF-vs-comparables bar
(marker placed proportionally between the comps' min/max $/SF), a warnings
list (unmatched/VERIFY are click-to-jump — wired to `onSelectStep('pricing'
| 'takeoff')` in Task 8's integration; $0-material/unverified-share/excluded
are informational), and a collapsible Insights section taking today's
Historical Costs/Win-Rate content as a slot rather than reimplementing it.

**Tests:** 12. Every value from a fixture; unsaved tag presence; em-dash for
unknown $/SF; no warnings section when clean; warning clicks; informational
warnings render without being buttons; comps-bar marker math; no bar with no
comparables; Insights collapsed/expand/absent.

## Task 11 — Settings: Labor Library

**Commit:** `eda552e`
**Files:** `LaborLibrarySection.{tsx,test.tsx}` (replaces `UnitCostSection`
in the same nav slot, relabeled "Labor Library"), `categories.ts`,
`SettingsPage.tsx`, `useAppSettings.ts` (5 new `est_default_*` fields) — plus
two small backend additions: `routes/settings.ts` (the 5 keys added to
`ALLOWED_KEYS` — the generic settings PUT already existed) and
`estimating/calibration.ts` + `routes/estimating.ts`
(`applyCalibrationAdjustment()` / `POST /calibration/apply`, admin). The
original Part 1 plan text assigned the apply-button endpoint to "Task 12"
under the plan's original single 12-task numbering — that's Task 11 in the
delivered frontend split, so it's built here rather than left for later.

Items (searchable, category filter, unverified-price-only filter, inline
edit material $/labor hours/price date, source badge, deactivate with an
Undo banner), Assemblies (component `qty_per` editor), Labor Factors (label/
pct/active), Defaults (the 5 `est_default_*` keys — overhead %/profit %/crew
size are per-bid-only defaults with no global settings key in this phase, per
Task 1's original schema, and the Defaults panel says so rather than
pretending to control them), Calibration (Task 6's report, "Apply suggested
adjustment" per-category or global behind a confirm dialog).

**A real test-hygiene lesson repeated from Part 1, applied proactively this
time:** the calibration-apply backend test never runs `scope: 'global'`
against the real shared library — doing so would permanently multiply every
one of the ~139 seeded items' `labor_hours` for every future test run on this
database. It's scoped to a test-only category and proven against a second,
untouched test-only category instead.

**Tests:** 16 (9 frontend, 7 backend). Edit-and-blur PUTs the right payload
and no-ops when unchanged; deactivate requires confirmation and shows a
working Undo; calibration apply posts the correct scope/category/pct payload
for both global and per-category; Defaults enables Save only once edited;
backend admin-only + 400s + the multiply-by-`(1+pct/100)`/`source=calibrated`
behavior.

## Tasks 8 + 12 (partial) — re-homing, integration, lazy chunk

**Commit:** `be340f6`

### Task 8 — re-home existing step content

`PcWorkspaceView.tsx`'s render replaced: `StepTracker`+`TabStrip`+`renderTab()`
→ `EstimateShell` (via the new lazy `EstimatingWorkspace` wrapper, see Task
12 below) + `renderStepContent(step)`, which stacks the plan's exact
groupings per step:
- **Documents:** `FilesTab` + `PreBidTab`.
- **Takeoff:** `BidTab` + `TakeoffTab` (same confirm-key-data soft gate,
  unchanged).
- **Labor & Pricing:** `LaborPricingStep`, sourced from `useEstimatingBid`.
- **Scope & RFIs:** `ScopeTab` + `RfisTab`.
- **Review & Proposal:** a new pre-send checklist (reads the new engine's
  `unmatchedCount`/`verifyCount`/`unverifiedMaterialShare` warnings,
  informational only) + the unchanged `ProposalTab` (its own `verifyBid` gate
  remains the real gate, per the plan).
- **Insights** (Historical Costs + Win-Rate) moved into `BidSummary`'s
  collapsible slot instead of being separate tabs.
- **Overview** is dropped entirely, per the plan's explicit instruction to
  remove the duplicate Overview/Files tabs — its content (stats row, notes
  textarea, `ImportPanel`, the takeoff-on-file list, "Advance to Next Step")
  had no un-duplicated equivalent to re-home into the new 5-step shape.

Step status is derived from real data (`ws.files.length`, `aiResults.
agent1_output` + `ws.confirmedService?.confirmed`, `!estimatingBid.proposed
&& estimatingBid.lines.length>0 && !unmatchedCount`, any non-empty
`ws.scope` value, `ws.proposalGenerated`). Current step is a URL param
(`useEstimateStepParam`, seeded from `mapLegacyTabToStep(ws.activeTab)`);
selecting a step also writes `stepToLegacyTab(step)` back into `ws.activeTab`
so the persisted DB column stays populated with something a stale
reload/old build still understands. `useUnsavedGuard` gets a **second**
registration (`estimatingBid.dirty`) alongside the pre-existing
`pricingDirty` one — both real, independently registered, no conflict.

**Two real bugs found by mounting this against the ~15 existing
PcWorkspaceView tests**, both fixed at the shared-module level:

1. **`useEstimateStepParam` threw outside a Router.** Nearly every existing
   PcWorkspaceView test renders it standalone with no `<MemoryRouter>` (it
   had no router dependency before this task). `useSearchParams()` throwing
   mid-render corrupted React's hook order for the rest of that render,
   cascading into unrelated-looking `Cannot read properties of undefined`
   crashes elsewhere in the same test file. Fixed by branching on
   `useInRouterContext()` (which never throws): outside a Router, the step
   is local `useState` instead of a URL param. `inRouter` is invariant for a
   given mounted instance (whether a Router wraps you is a static fact about
   where you're rendered), so the conditional-hook-call shape is safe despite
   looking like a Rules-of-Hooks violation — documented inline. Added a test
   for the outside-Router path.
2. **`useEstimatingBid` crashed on a malformed GET response.**
   `BidHubPage.test.tsx`'s blanket `get` mock returns `{ data: [] }` for
   *every* URL (not estimating-specific); the hydration effect assumed
   `data.lines`/`data.settings`/`data.recap` were always present and crashed
   on `undefined.length`. Now falls back to safe empty defaults. Added a
   regression test.

**Test fallout from retiring `PricingTab`/`OverviewTab`**, resolved per file
rather than left broken (per the plan, only the *re-homed* components'
existing tests are protected — `PricingTab` is explicitly replaced by Task 9,
`OverviewTab` explicitly dropped):
- **Deleted:** `PcWorkspacePricing.test.tsx` (13 tests — `PricingTab`'s own
  hydration/confidence-chip/save-toast behavior; superseded by
  `LaborPricingStep.test.tsx`), `PcWorkspaceGlobalCache.test.tsx` (1 test —
  the retired flat `unit_cost_library` reprice-on-Settings-save path),
  `PcWorkspaceProfiler.test.tsx` (2 tests — a render-boundary/element-count
  guard specifically for `PricingTab`'s per-row `PricingRow` memoization,
  which doesn't exist in the same shape in the new table architecture; an
  equivalent guard for `LaborPricingStep` would be a reasonable follow-up,
  not attempted here), `PcWorkspaceTakeoff.test.tsx` (1 test, and the file's
  *entire* remaining content — the Overview tab's "Quantity Takeoff on File"
  null-quantity rendering, now nowhere in the UI).
- **Rewritten:** `PcWorkspacePricingDirtyGuard.test.tsx` — the
  `bid_estimates`/`bid_workspaces` hydration-race mechanism it guarded is
  retired with `PricingTab` (the new engine has one data source, no race to
  guard); rewritten to prove the plan's actual ask instead — unsaved Labor &
  Pricing edits arm `useConfirmLeave`, Save clears it — using the *same*
  `useConfirmLeave`/`UnsavedGuardProvider` harness as before. (One of its
  three new tests initially failed non-deterministically because
  `findByDisplayValue('10')` matched either the qty input or the Overhead %
  settings input — both default to `10` in the fixture; fixed by targeting
  the qty cell's `data-field` attribute instead.)
- **Edited:** `PcWorkspaceAutosave.test.tsx` — its trigger (the Overview
  tab's Notes textarea) is gone; every edit now goes through the Scope &
  RFIs step's Section A textarea instead (the autosave debounce/retry/
  backoff/StrictMode mechanism under test doesn't care which watched `ws`
  field changes). The save-state assertions moved from `pc-save-state` to
  `est-save-state`. Also needed a `beforeAll` pre-warm of the Task 12 lazy
  chunk's dynamic import — see below.

### Task 12 (partial) — lazy chunk only

`EstimatingWorkspace.tsx` is the one module `PcWorkspaceView`
`React.lazy()`-imports: `EstimateShell` + `BidSummary` + `LaborPricingStep`
(and their CSS) ship as their own chunk instead of growing the main bundle,
inside a `<Suspense fallback={...}>` boundary matching the app's existing
`App.tsx` pattern. The re-homed old tabs (computed by `renderStepContent`,
still eagerly bundled — correct, since they were already part of the main
bundle before this plan) are passed in as an already-rendered
`otherStepContent` child, not re-imported inside the lazy chunk.

This broke `PcWorkspaceAutosave.test.tsx`'s fake-timer-based flushing: the
first-ever resolution of a real dynamic `import()` under fake timers didn't
reliably settle within a couple of bare `act()` flushes, leaving the
Suspense fallback on screen when the test tried to find the Scope textarea.
Fixed with a `beforeAll` that awaits the same dynamic import once, with real
timers, before any test in the file runs — every render after that hits
React.lazy's already-resolved internal promise and paints synchronously,
same as it will in production once a user's browser has fetched the chunk
once.

**The rest of Task 12 is deferred**, not attempted this pass given the time
already spent on Tasks 7–11 and the Task 8 integration/test-fallout work:
- A consistent heading style across the five steps' work-area headers.
- Further inline-style-to-class extraction — `EstimateShell.tsx`/
  `BidSummary.tsx` already use `estimating.css` classes throughout;
  `LaborPricingStep.tsx`'s settings-row/factor-chip/table structure does too,
  but its resolver `Modal`'s inner layout and the Review step's pre-send
  checklist banner (in `PcWorkspaceView.tsx`) still use inline styles.
- An explicit, single-action empty state per step (e.g. "Upload plans" on an
  empty Documents step) — Documents/Takeoff currently show whatever the
  re-homed old tab's own empty state already was (still reasonable, just not
  audited against the plan's "single clear action" wording).
- Explicit light/dark-theme verification — moot: there is no light theme
  anywhere in this codebase (confirmed during research), so nothing to
  verify.

## Final test counts

- **Backend:** 918 passed, 3 failed, 921 total (up from Part 1's 915/918 —
  net +3 from Task 11's `calibration/apply` backend tests; Part 2 touched no
  other backend logic). 108 test files, 1 failing (`notificationsRetention.
  test.ts`, the same pre-existing flake noted throughout — on the final full
  run it manifested as a native worker crash rather than 3 graceful
  assertion failures, an intensified but still pre-existing, still
  code-unrelated symptom; re-running it in isolation reproduces the same
  crash independent of anything in this branch).
- **Frontend:** 631 passed, 0 failed, 631 total, 89 files — up from the
  579-test baseline. Every estimating-related test is green; the one
  baseline flake (`SurveyMarkupEditor.test.tsx`) did not reproduce on the
  final full run (confirmed independently flaky by re-running it in
  isolation, where it also passes).

## What's deferred (Part 2), and why

- **The rest of Task 12** — see its section above.
- **`PricingTab.tsx`/`PricingRow.tsx`/`UnitCostSection.tsx` are not
  deleted**, even though nothing renders them anymore. Deleting them cleanly
  would mean also removing their now-dead upstream state in
  `PcWorkspaceView.tsx` (`savedEstimate`, `pricingLineItems`, `onSaveEstimate`,
  `onUnitCostChange`/`onOverheadChange`/`onProfitChange`, the `/estimates/
  :bidId` and `/estimates/unit-costs` fetches) and verifying nothing else
  imports them — real, contained work, but additional risk on top of an
  already large diff under time pressure. They're genuinely dead code
  (confirmed via `grep`, no remaining imports of the CRM-facing components),
  not still-reachable-by-accident.
- **A `LaborPricingStep`-specific render-boundary profiler test**, replacing
  the deleted `PcWorkspaceProfiler.test.tsx` — the old one measured
  `PricingTab`/`PricingRow`'s specific per-row memoization boundary, which
  doesn't exist in the same shape in the new table (no separate memoized
  row component). Writing an equivalent guard for the new architecture is
  reasonable future work.
- **Auto-opening BidSummary's Insights section** when a legacy `active_tab`
  of `costs`/`intel` is the mapping source — the plan calls for this
  ("costs/intel/compare → pricing (+ open the Insights section)");
  `legacyTabWantsInsights()` exists in `steps.ts` (tested) but isn't wired to
  anything, since `BidSummary`'s Insights toggle is self-contained local
  state with no prop to force it open from outside. A small, low-risk
  follow-up (add an `initialOpen` prop).

## Everything a reviewer should look at first (Part 2)

1. **`useEstimateStepParam.ts`'s Router-optional branch** and
   **`useEstimatingBid.ts`'s defensive hydration fallback** — both are
   real-bug fixes discovered by the existing test suite, not speculative
   hardening; worth confirming the reasoning holds (`useInRouterContext()`
   never throws, `inRouter` is genuinely invariant per mounted instance).
2. **`PcWorkspacePricingDirtyGuard.test.tsx`'s rewrite** — confirm the new
   dirty-guard tests actually exercise the same user-facing contract the
   deleted arrival-order tests used to protect a different mechanism for.
3. **`PcWorkspaceView.tsx`'s `renderStepContent`/`EstimatingWorkspace`
   wiring** — the biggest, highest-risk diff in Part 2; confirm every
   re-homed tab still receives the exact same props it did before.
4. **The deferred items above**, especially the undeleted `PricingTab`/
   `UnitCostSection` dead code and the un-wired `legacyTabWantsInsights()`.
   test` run against a DB that hasn't seen migration 102 before.

## Fix round 1 (independent adversarial review response)

An independent Opus 5 read-only review
(`docs/superpowers/plans/2026-09-22-estimating-review.md`, committed at
`d4d5fd0`) returned verdict **DO NOT MERGE**, with five Blockers, ten
Should-fix items and twelve Nits. The coordinator confirmed B1 and B4
directly and directed every fix listed below, plus a hard test rule: every
new test must use Agent 2/4's real line shape
(`{item: '5.1', spec: '3/4" EMT', qty: 1200, unit: 'LF'}`), and an explicit
end-to-end test (takeoff → mapper → priceBid → saveBidEstimate) proving real
seed magnitudes.

**Commit range:** `2201b20..9697d1a` (10 commits, this worktree/branch).

### Blockers

| ID | Fix | Commit(s) | Tests |
|---|---|---|---|
| B1 | `PricingLineInput.libraryUnit` — pricing.ts divides by the MATCHED LIBRARY ITEM's unit, not the takeoff line's display unit; mapper.ts gates every match on unit-family compatibility (EA vs LF/C/M) via new `isUnitCompatible`/`unitFamily`; `resolveLines()` resolves `libraryUnit` from the matched item/assembly and discards a unit-incompatible match | `2201b20`, `a8161ca`, `db2ec49` | `pricing.test.ts` "B1: libraryUnit conversion" (4 cases); `mapper.test.ts` EA/linear gate case; **`estimatingBid.test.ts`'s "B1 — end to end" describe block** — the required real-shape e2e test, proving 1,200 LF 3/4" EMT = $720 and 3,600 LF #12 THHN = $342 against the real seed through takeoff → sync → save |
| B2 | Unit alias normalization (`normalizeUnit`, applied in both mapper adapters and `validateLines`); `unitUnknown` flag on unmatched/unpriced lines (never NaN, prices only from an explicit override); `NonFiniteTotalError` + `assertFiniteRecap()` block any non-finite total from being written (400, not 500 or a silent bad write); sync-takeoff can no longer 500 on a missing/unrecognized unit | `2201b20`, `a8161ca`, `0599a33`, `db2ec49` | `pricing.test.ts` "B2: unit-unknown lines never produce NaN" (3 cases); `estimatingBid.test.ts` "B2 — unit-unknown lines never 500 and never NaN" (3 cases) |
| B3 | Token-boundary alias matching (was raw substring — "4 EMT" no longer falsely matches "3/4 EMT"); digit/rating conflict guard extended to every non-exact tier with a `scheduleDigits()` carve-out for "Sch 40/80"; new material-type conflict guard (EMT/PVC/RMC/MC/THHN); `normalize()` unifies all three written forms of a fractional trade size; confidence-tier now strictly gates ranking (fuzzy can never outrank alias/exact via bonuses); `altText` fixes the item-vs-spec field-choice bug (receptacle→switch, GFCI→duplex); `ASM-SVCENT-800` now consumes a new `DISC-800` item instead of `DISC-400` | `a8161ca` (mapper/seed), `c5eb269` (migration 105 applies the seed fix to already-migrated databases) | `mapper.test.ts` "B3: mismatch regressions against the real seed library" — 11 cases covering every mismatch the review listed, all run against real `SEED_ITEMS`/`SEED_ASSEMBLIES` |
| B4 | `suggestedAdjustmentPct` (global and per-category) is now `(accubid/engine - 1) * 100`, not `(engine/accubid - 1) * 100` (the old formula pointed every correction the wrong direction); `computeCalibrationReport()` canonicalizes each line's category before grouping (`canonicalizeTakeoffCategory`, also used in mapper.ts's category bonus — B3/N4); `applyCalibrationAdjustment` canonicalizes its own category input, caps \|adjustmentPct\| at 50, and throws (400) on a 0-rows-changed apply instead of returning a silent 200 success; `LaborLibrarySection.tsx`'s apply flow now shows a success toast naming the row count and an error toast on failure | `f53ad71` | `estimatingCalibration.test.ts` — fixed the two locked-in-wrong-sign assertions (Branch Power now expects ≈-16.67%, Interior Lighting +25%) and added 3 new cases (0-rows/400, >50%/400, short-category-name canonicalization, with real seed rows snapshotted and restored); `LaborLibrarySection.test.tsx` +2 (success toast names count, 400 shows error toast) |
| B5 | `qty_overridden` (migration 104) — sync-takeoff never overwrites an estimator-set qty; `sync_excluded` (migration 104) distinguishes a sync-driven exclusion (vanished from takeoff) from a user exclusion — only the former reverses on reappearance; `dedupeTakeoffKeys()` suffixes duplicate category+item takeoff keys so a duplicate row is never dropped; `syncTakeoff()` now writes `bid_estimates`/`bids.amount` in the SAME transaction as the `est_bid_lines` changes (new `writeBidEstimateSnapshot()`, shared with `saveBidEstimate()`); frontend: `LaborPricingStep`'s sync button confirms (`useConfirm`) when `dirty` | `db2ec49` (backend), `c5eb269` (frontend confirm) | `estimatingBid.test.ts` "B5 fix round 1 regressions" — 4 cases (qty_overridden survives a re-sync, sync- vs user-exclusion on reappearance, duplicate keys never dropped, sync persists bid_estimates/bids.amount without a separate PUT); `LaborPricingStep.test.tsx` "B5: sync-takeoff confirms..." (2 cases) |

### Should-fix

| ID | Fix | Commit(s) | Tests |
|---|---|---|---|
| S1 | `dirty` no longer includes "proposed && lines.length > 0" — a proposed-but-unedited mapping is not dirty; `BidSummary` shows "Unsaved proposal" (proposed) and, separately, "Unsaved changes" (dirty && !proposed) | `c5eb269` | Rewrote the 2 `useEstimatingBid.test.ts` cases that locked in the old behavior; `BidSummary`'s existing tag test still covers `proposed` |
| S2 | Deleted `PricingTab.tsx`, `PricingRow.tsx`, `UnitCostSection.tsx` (confirmed zero remaining references) and PcWorkspaceView.tsx's fully-dead call chain that only fed them (`pricingLineItems`, `saveEstimate`/`runSaveEstimate`/`savingEstimate`, `estimateSaved`, `onSaveEstimate`) | `ce59ce9` | Existing `PcWorkspacePricingDirtyGuard.test.tsx` was already testing the NEW engine's real dirty source (edit qty → Leave → prompt; Save → Leave → no prompt) — confirmed, no rewrite needed |
| S3 | Found the concrete stale-total bug: `runAgent4Proposal()` POSTs `propPrice` straight to Agent 4 as the price it writes into `bids.amount`, and `propPrice` was only ever pre-filled ONCE from the legacy `savedEstimate.grand_total`. Now syncs from `estimatingBid.recap.totals.grandTotal` whenever it reflects a saved state (`!dirty && !proposed`) and stops once the estimator types into the field by hand (`propPriceEdited`) | `ce59ce9` | Covered indirectly by existing `PcWorkspaceProposal.test.tsx` (still green); no new dedicated test added — see "Not fixed / deferred" |
| S4 | Restored Workspace Notes and Import Finished Bid (Accubid breakdown upload — calibration.ts's only data source) into the Documents step; both were orphaned on `PcWorkspace/OverviewTab.tsx`, which nothing imports (BidHubPage's own, different `OverviewTab` shadowed the name) | `ce59ce9` | No new test added — see "Not fixed / deferred" |
| S5 | `numberOr()` replaces every `Number(x) \|\| fallback` in `getBidSettings()` | `db2ec49` | `estimatingBid.test.ts` "S5 — an explicit 0 settings value is honored" |
| S6 | A bid's first-ever `est_bid_settings` inherits `overhead_pct`/`profit_pct` from `bid_workspaces`, then `bid_estimates`, before the hardcoded 10/15 | `db2ec49` | `estimatingBid.test.ts` "S6 — ... inherit overhead/profit from bid_workspaces" |
| S7 | Backend: reject negative `material_unit_override`/`labor_hours_override` (qty/rates/pcts were already validated). Frontend: clearing an override input sets `null` not `0`; "Keep as manual line" requires a material $ or hours value first | `db2ec49` (backend), `c5eb269` (frontend) | `estimatingBid.test.ts` negative-override 400 case; `LaborPricingStep.test.tsx` clear-to-null + keep-as-manual-disabled (2 cases) |
| S8 | `recapByKey` pairs by stable line id, never array position; every line gets an id the instant it's created (`newLineId()` for new manual lines, not a server-derived array-index synthetic id); `useEstimatingBid`'s live recalc gained a request-sequence guard (an older `/price` response can't clobber a newer one) | `c5eb269` | `useEstimatingBid.test.ts` "S8: a stale (older) /price response..."; `LaborPricingStep.test.tsx`'s existing id-keyed rendering tests continue to pass |
| S9 | `PUT /api/estimates/:bidId` returns 410 Gone. Grepped every caller first: one frontend call site (removed in the same commit, S2) and one backend test (renamed/rewritten). `GET /api/estimates/:bidId` is unchanged — still read by `PcWorkspaceView.tsx`'s overhead/profit hydration | `ce59ce9` | `estimatesLegacyRetired.test.ts` (renamed from `estimates.confidence.test.ts`) — 410 + still-requires-auth + GET-still-works (3 cases); its old confidence-round-trip coverage now lives in `estimatingComposeBidDataFix.test.ts` for the new engine |
| S10 | `bid_estimates.line_items[].total`/`unit_cost` and `.subtotals` now come from pricing.ts's `directShare`/`subtotal` (new fields, pro-rata allocated so they sum exactly to `directCost`) instead of `materialExt+laborExt`/`material+labor` alone | `2201b20` (pricing.ts), `db2ec49` (bidEstimate.ts wiring) | `pricing.test.ts` "S10: subtotals/directShare always reconcile..." (2 cases) plus reconciliation assertions added to the golden-recap test |

### Nits

| ID | Fix | Commit(s) |
|---|---|---|
| N1 | Exact half-cent rounding via `Number.EPSILON` in `toCents()` | `2201b20` |
| N2 | `BidSummary`'s comps-vs-$/SF marker no longer disappears with exactly one comparable — falls back to 0/50/100% instead of a `compsMax > compsMin` guard that hid it entirely | `c5eb269` |
| N3 | New `floors_above_2` per-bid setting (migration 106) multiplies the MULTI-STORY labor factor's pct instead of applying it flat | `a5bbfe3` |
| N4 | `canonicalizeTakeoffCategory()` (boilerplate.ts) maps Agent 2's shorter categorization-prompt spellings to the canonical `TAKEOFF_CATEGORIES` strings; used in the mapper's category bonus and calibration's category grouping | `a8161ca` |
| N5 | `ASM-DUPLEX` gained qualified aliases (`duplex`, `duplex outlet`, `receptacle outlet`, `standard receptacle`) — bare `receptacle`/`outlet` deliberately excluded (would steal GFCI/quad/twist-lock/data-outlet matches) | `a8161ca` (seed), `c5eb269` (migration 105 applies it to already-migrated DBs) |
| N6 | Checked — "View Results" (`BidTab.tsx`) already only renders under the Takeoff step's `case` in `renderStepContent`'s switch, so it's already unreachable from anywhere else; no bug reproduced, no change made |
| N7 | `BidSummary` gained `initialInsightsOpen`, wired from `steps.ts`'s `legacyTabWantsInsights(ws.activeTab)` in `PcWorkspaceView.tsx` — previously computed but never called anywhere | `c5eb269` |
| N8 | Manual lines get a Delete button with Undo; a failed `sync-takeoff` shows an error toast instead of failing silently | `c5eb269` |
| N9 | `generateLaborSeedSql.ts`'s header now says `npx ts-node` (a resolvable devDependency) instead of `npx tsx` (never installed) — verified by actually running it | `c5eb269` |
| N11 | `.est-summary-bottom` clears the mobile bottom nav's height (`bottom: 64px` at ≤768px) instead of sharing its screen region and losing the z-index fight | `9697d1a` |
| N10, N12 | Skipped per the coordinator's explicit instruction |

### Not fixed / deferred, and why

- **S2's literal scope** ("the pricingDirty/savedEstimate/pricingLineItems
  state and its hydration") was only partially done. `pricingLineItems` and
  everything that only fed the deleted `PricingTab`/`onSaveEstimate` dead
  code IS removed. `savedEstimate`/`savedEstimateData`, `pricingDirty`, and
  the ~80-line overhead/profit/estimate_overrides hydration effect (three
  code-review passes deep per its own comments) were deliberately KEPT —
  they still hydrate `ws.overheadPct`/`profitPct`/`estimateOverrides` from
  whichever of `bid_estimates`/`bid_workspaces` is newer, a real cross-check
  I could not fully trace every downstream consumer of within this fix
  round's budget (composeBidData's fallback path for bids that never adopt
  the new engine is one; there may be others). Removing it outright without
  that mapping felt like a bigger, less-reversible risk than leaving one
  extra (harmless — it registers its own `useUnsavedGuard`, independent of
  the new engine's) legacy hydration path in place. Flagging this explicitly
  rather than silently under-scoping it.
- **S3/S4 have no NEW dedicated test** — S3's fix is covered indirectly by
  the existing `PcWorkspaceProposal.test.tsx` suite staying green (it
  exercises `runAgent4Proposal`/`propPrice` already) and S4's by
  `PcWorkspaceFiles.test.tsx`/manual reasoning about the JSX addition; a
  purpose-built test proving `propPrice` re-syncs after a save, and that the
  Documents step renders the notes textarea/ImportPanel, would be a good
  follow-up.
- **N6**: investigated, found no reproducible bug (see table above) — not a
  deferral, just recorded here since the finding list expected a fix.

### Verification

- Backend: `npx tsc --noEmit` clean. Full `npx vitest run`: **107/108 files,
  955/959 tests passed** — the one uncounted file,
  `src/test/notificationsRetention.test.ts`, crashes its worker with a
  V8 "JavaScript heap out of memory" error; reproduced in isolation
  (unrelated to any file this fix round touched) and is the same class of
  pre-existing flake noted in the Part 2 report's baseline run (there, 3
  assertion failures in the same file; here, a full OOM crash — same root
  cause, not a regression this round introduced).
- Frontend: `npx tsc --noEmit` clean. Full `npx vitest run`: **89/89 files,
  643/643 tests passed.**
- The required end-to-end test (real Agent 2/4 line shape, through
  takeoff → mapper → priceBid → saveBidEstimate, real seed magnitudes) is in
  `backend/src/test/estimatingBid.test.ts`, describe block
  `"B1 — end to end: takeoff -> mapper -> priceBid -> saveBidEstimate, real
  seed magnitudes"`.
