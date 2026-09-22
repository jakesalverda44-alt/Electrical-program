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
   test` run against a DB that hasn't seen migration 102 before.
