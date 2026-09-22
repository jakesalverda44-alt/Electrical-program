# Estimating Labor Engine + Redesign: Adversarial Review

**Branch:** `feat/estimating-labor` (`main..6906a4a`, 14 commits, 52 files, +10,178/-1,181)
**Reviewer:** Opus 5 (independent, read-only)
**Date:** 2026-09-22

## Verification run

| Check | Result |
|---|---|
| `npm test` (backend, `electrical_crm_test`) | **914 passed / 918**, 107 of 108 files. The one failing file is `notificationsRetention.test.ts`: the worker crashed ("Worker exited unexpectedly"), which is the known pre-existing flake. This branch does not touch that file. |
| `npx tsc --noEmit` (backend) | clean |
| `npm test -- --run` (frontend) | **631 passed / 631**, 89 files (SurveyMarkupEditor flake did not reproduce) |
| `npx tsc --noEmit` (frontend) | clean |

Hand-computed recap. The inputs are 12 C of 3/4" EMT ($60/C, 4.0 h/C), 40 EA duplex ($6, 0.35 h), and 1 EA 100A panel ($650, 5 h). Settings: $38/h, consumables 2%, tax 7%, supervision 10%, small tools 3%, OH 10%, profit 15%, a +10% height factor with a second height factor passed in, and 2,500 SF. By hand: material 1,610.00, consumables 32.20, tax 114.95, hours 73.7 × 1.10 = 81.07, labor 3,080.66, small tools 92.42, direct 4,930.23, OH 493.02, profit 813.49, **total 6,236.74**, $2.49/SF. `priceBid()` returned exactly these values, and the second height factor was ignored as intended. **Once units are consistent, the formulas in `pricing.ts` match the plan.** The blockers below come from the inputs the engine receives in practice.

All mapper and pricing probes below ran against the real seed library (`SEED_ITEMS` and `SEED_ASSEMBLIES`) through `mapTakeoffLines()` and `priceBid()`.

---

## Blockers

### B1. Takeoff quantities in LF are priced against per-C and per-M library units, so conduit and wire come out 100× and 1000× too high

- **Evidence.** In `backend/src/estimating/mapper.ts:237`, `MappedLine.unit` is the takeoff's own unit (`line.unit`), not the matched candidate's unit. `bidEstimate.ts:315` (proposed), `:385` (sync insert), `:377` (sync update) and `:449-452` (save) keep that unit. `pricing.ts:171-172` divides qty by `UNIT_DIVISOR[line.unit]`. Every seed raceway and cable item is `unit: 'C'` and every THHN item is `unit: 'M'` (`seed/laborUnits.ts:79`, `:135-138`, `:147`). Agent 2 emits LF (`ai/prompts.ts:81`, `:158`). No code converts LF to C or M anywhere.
- **Failure.** A takeoff row `3/4" EMT, 1200 LF` alias-matches EMT-075 ($60/C, 4.0 h/C). The engine prices **$72,000 material and 4,800 hours**. The correct figures are $720 and 48 hours. Other probes:
  - `#12 THHN, 3600 LF` gives **$342,000 and 12,600 h** (correct: $342 and 12.6 h).
  - `#1 THHN, 1000 LF` gives $1,050,000.
  - `12/2 MC, 500 LF` gives $35,000 (correct: $350).

  This flows straight into the proposed recap, the Bid Summary total, `bid_estimates.grand_total` and `bids.amount` on Save. The UI shows the unit column read-only (`LaborPricingStep.tsx:245`), so the estimator cannot fix it except by typing a per-LF material override and hours override on every line.
- **Fix.** Give each line a `library unit` and convert qty whenever the takeoff unit and the matched unit differ: `qtyInLibraryUnits = qty × divisor(takeoffUnit) / divisor(libraryUnit)`. Normalize takeoff units first (`ft`, `LF`, `lf` → LF). Alternatively, store the line in the library unit when mapping. Add a test that feeds `{qty:1200, unit:'LF'}` mapped to a `C` item and asserts $720. Refuse a match whose units cannot convert (EA vs LF) and leave it unresolved.

### B2. Takeoff units are never validated, so unknown units produce NaN totals, persist NaN money, and crash the pricing screen

- **Evidence.** `routes/estimating.ts:66-109`. `validateLines` checks qty, overrides, source and confidence, but **not `unit`**: `:95` casts `raw.unit as EstUnit`. `est_bid_lines.unit` has no CHECK constraint (`101_estimating_labor.sql:98`). `pricing.ts:171` looks up `UNIT_DIVISOR['LS']`, gets `undefined`, and the whole recap becomes NaN.
- **Failure.**
  - A takeoff line with `unit: "LS"`, `"SET"` (the canonical fixture uses `"SET"`: `test/fixtures/bidstd/bid_data.example.json:126`), `"ea"` or `""` makes every total NaN. Probe: `unit:'LS'` returns every total as `null` in JSON. `unit:'ea'` does the same.
  - On Save, `saveBidEstimate` writes `recap.totals.*` (NaN) into `bid_estimates` and `bids.amount` (`bidEstimate.ts:519-524`). Postgres `numeric` accepts `'NaN'`, so the pipeline amount is corrupted, or at best the save fails.
  - The recap JSON carries `null` for `materialExt`/`hoursExt`/`laborExt`. `LaborPricingStep.tsx:254`, `:263` and `:264` call `priced?.materialExt.toFixed(2)`, which throws `TypeError` on `null`, so the Labor & Pricing step crashes.
  - A missing unit (`undefined`) also violates `unit NOT NULL` in `syncTakeoff`'s INSERT, and the whole sync fails with a 500.

  The legacy path defaulted `row.unit || 'EA'` (`PcWorkspace/parsing.ts`).
- **Fix.**
  - Normalize units in `fromLegacyTakeoff` (uppercase; map `FT`/`LF`, `EA`/`EACH`/`SET`/`LS`/`LOT` → EA; blank → EA).
  - Reject any unit outside `ALLOWED_UNITS` in `validateLines` with a 400.
  - Add a CHECK on `est_bid_lines.unit` in a new migration.
  - In `priceBid`, throw (or mark unresolved) when `UNIT_DIVISOR[unit]` is undefined.
  - Guard every `toFixed` against non-finite values.

### B3. The mapper confidently picks the wrong trade size or material type and labels it `alias`/`fuzzy`, so it is never flagged as unresolved

- **Evidence.**
  - `mapper.ts:176-182`. Alias matching is a raw substring test (`descNorm.includes(n) || n.includes(descNorm)`) with no token boundaries. The digit-conflict guard at `:196` only runs in the fuzzy branch, so alias matches bypass it.
  - `:204-206`. The +0.2 category bonus lets a fuzzy candidate outrank a correct alias.
  - `:314`. `fromLegacyTakeoff` matches on `spec` **instead of** `item` whenever `spec` is present. In Agent 2's actual shape (`ai/prompts.ts` AGENT2 `takeoff[]`: `item`, `spec`), `item` is the descriptive name and `spec` is the qualifier.
- **Failure (probes against the real seed library).**

  | Takeoff line | Matched to | Confidence |
  |---|---|---|
  | `4" EMT` | **3/4" EMT** (EMT-075) | alias |
  | `2" EMT` | **1/2" EMT** | alias |
  | `4" PVC` | **3/4" PVC** | alias |
  | `2" PVC` | **1/2" PVC** | alias |
  | `1-1/4" EMT` (in Service & Distribution) | **1-1/4" rigid steel** (RGD-125) | fuzzy |
  | `2 EMT` | **#2 THHN wire** | fuzzy |
  | item `Duplex receptacle`, spec `20A, 125V, NEMA 5-20R, spec grade` | **single-pole switch** (SW-1P) | — |
  | item `GFCI receptacle`, spec `20A 125V` | **duplex circuit** | — |

  None of these count as unmatched, so the resolver banner never shows them. Separately, `ASM-SVCENT-800` (800A service) is built on a **400A** disconnect (`seed/laborUnits.ts:338`) and prices at $3,587, less than the 400A panel at $3,956.
- **Fix.**
  - Match aliases on whole-token boundaries (compare token sequences, not substrings).
  - Apply the conflicting-spec guard to every tier, both ways: a size or rating token in the description that the candidate lacks is also a conflict.
  - Never let the category or unit bonus lift a fuzzy match over an alias.
  - Treat a conflicting material family (EMT/RGD/PVC/THHN/MC) as a disqualifier.
  - Match on `${item} ${spec}` together.
  - Downgrade fuzzy matches to "needs review" in the UI.
  - Add table tests for every row above.
  - Fix the 800A assembly components.

### B4. Calibration suggests the adjustment with the wrong sign, so "Apply" doubles the error

- **Evidence.** `estimating/calibration.ts:93-103` and `:111`. The suggested adjustment is `(ratio - 1) × 100`, with `ratio = engine / accubid`. `applyCalibrationAdjustment` (`:135-157`) multiplies `labor_hours` by `1 + pct/100`. The UI passes the suggestion straight through (`LaborLibrarySection.tsx:345`, `:371`). The tests lock in the inversion: `estimatingCalibration.test.ts:65` and `:75` expect +20% when the engine is already 20% high.
- **Failure.** The engine estimates 120 h where Accubid shows 100 h. The report says +20%, and Apply makes it 144 h (+44% error). With B1 in play, ratios of ~100× suggest +9,900%, and the only guard is `multiplier < 0`. Separately, a per-category apply filters `est_items.category`, which uses seed names ("Exterior / Site Lighting", "Site / Underground / Allowances", "Low Voltage Infrastructure …"). The report's categories are Agent 2's takeoff names ("Exterior Site Lighting", "Site Underground Allowances", "Low Voltage"), so the apply matches no rows and silently does nothing.
- **Fix.**
  - Suggest `(1/ratio - 1) × 100`, or `accubid/engine`.
  - Cap the apply range (for example ±50%).
  - Map report categories to library categories through each line's matched item, not the takeoff category.
  - Record each applied calibration (who, when, pct) so a double-click cannot compound it.
  - Correct the tests.

### B5. "Sync from takeoff" destroys estimator work and leaves `bid_estimates`/`bids.amount` stale while the UI shows "saved"

- **Evidence.**
  - Client: `useEstimatingBid.ts:128-144`. `syncTakeoff` replaces `lines` with the server copy and resets `persistedRef` without checking `dirty`. The button (`LaborPricingStep.tsx:172`) has no confirm.
  - Server: `bidEstimate.ts:376-379` overwrites `qty` and `description` on every surviving takeoff line.
  - Server: `:373-379` never clears `excluded` on a line that comes back after it vanished, and it strips the `[No longer in takeoff]` prefix.
  - Server: `:352-355` plus `:366-392` collapse duplicate `category||item` keys.
  - Server: `syncTakeoff` writes `est_bid_lines` but never rewrites `bid_estimates` or `bids.amount`. `useEstimatingBid.ts:137-138` then clears `proposed` and `dirty`.
- **Failure.**
  1. An estimator edits overrides and qtys, doesn't save, and clicks Sync. All unsaved edits vanish and no dirty prompt appears.
  2. A VERIFY line (qty 0) is corrected to 24 and saved. Any later Sync resets it to 0 and the line silently drops to $0.
  3. A line vanishes from one takeoff run, gets auto-excluded, then reappears. It stays excluded with no marker left, so it looks like a deliberate exclusion and is silently under-bid.
  4. Two takeoff rows share `Branch Power||Duplex receptacle`. The second sync prices only one of them, and the other is marked vanished and excluded.
  5. After any sync that adds lines, the Bid Summary shows the new total with no "unsaved" tag, while `bid_estimates.grand_total`, `bids.amount` and the proposal prefill keep the old number. Step 3 reports "done".

  This violates the plan's rule that `bid_estimates`/`bids.amount` always agree with the recap, and the rule that sync must never destroy estimator edits.
- **Fix.**
  - Block or confirm Sync while `dirty`.
  - Server-side: keep an estimator-edited qty. Either add `qty_override` or compare against the previous takeoff qty and only update when the row was untouched.
  - Clear `excluded` only on lines the sync itself excluded; add a `vanished_at`/`auto_excluded` flag rather than a description prefix.
  - Key sync on `takeoff_item_id` plus position, or reject duplicate keys.
  - Either recompute and write `bid_estimates` plus `bids.amount` in the same sync transaction, or leave the client dirty (`persistedRef` unchanged) so Save is required and the guard fires.

---

## Should-fix

### S1. The proposed state is always dirty, so every existing bid with an AI takeoff prompts "unsaved changes" on leave, and the only way to clear it overwrites the historical estimate

- **Evidence.** `useEstimatingBid.ts:104-106` treats `proposed && lines.length > 0` as dirty, and `useEstimatingBid.test.ts:45` asserts this on purpose. `PcWorkspaceView.tsx:1045` registers `useUnsavedGuard(estimatingBid.dirty)`, which arms `beforeunload` plus in-app navigation. `BidHubPage.tsx:146-148` mounts `PcWorkspaceView` (hidden) for every opened bid, whatever tab is showing.
- **Failure.** After merge, no bid has `est_bid_lines`. Opening any bid's hub (even just the Overview tab) that has `takeoff_results.agent2_output` and then navigating away shows the unsaved-changes dialog. The only way to clear it is Save in Labor & Pricing. That overwrites `bid_estimates` and `bids.amount` (including on awarded bids) with seed-priced, B1/B3-affected numbers, and resets OH/profit to 10/15 (see S6).
- **Fix.** A proposed mapping the user has not edited is not dirty: compare against the proposed snapshot. Show the "Unsaved" tag instead.

### S2. The legacy `pricingDirty` guard is still registered, but its only clear action (Save Estimate) is gone, and the tests that covered it were deleted

- **Evidence.** `PcWorkspaceView.tsx:287-292` (still live), `:306` (`/estimates/:bidId` still fetched), and the hydration effect at `:365-407` (still live, still autosaving `overhead_pct`/`profit_pct`/`estimate_overrides` into `bid_workspaces`). `PricingTab` is no longer rendered.

  The rewritten `PcWorkspacePricingDirtyGuard.test.tsx` mocks `/estimates/:bidId` and `/workspace` as `null` (lines 61-62), so it never exercises this path. The deleted tests that covered this still-live code were:
  - "numeric-string estimate never arms guard" (old `:109`)
  - the two arrival-order tests (old `:205`, `:217`)
  - `PcWorkspacePricing.test.tsx`'s three workspace-autosave and pristine-hydration tests (old `:385-407`)

  **The rewrite weakened the contract:** the old tests protected a guard that still runs in production.
- **Failure.**
  - Any bid whose `bid_workspaces` row carries unsaved legacy OH/overrides, which main showed as "go save pricing", now prompts forever with no UI to resolve it.
  - Engine saves also write `line_items[].overridden` and `overhead_pct` into `bid_estimates`. A later scope-edit autosave then stores the stale hydrated overrides in `bid_workspaces` with a newer `updated_at`. On the next reload the workspace wins, `ws.estimateOverrides ≠ overridesFromEstimate(bid_estimates)`, and the guard is permanently armed.
- **Fix.** Delete the legacy `pricingDirty` registration and its hydration effect together with the dead pricing state (see S9). Keep `saveState === 'error'` as its own guard. Restore a test for "a loaded estimate never arms the guard".

### S3. The Review step's proposal price is not tied to the engine's saved total, and Agent 4 then overwrites `bids.amount` with it

- **Evidence.** `PcWorkspaceView.tsx:437-441`. `propPrice` is prefilled once from `savedEstimate.grand_total`, which is fetched once at mount (`:306`) and never refreshed after an engine save (`useEstimatingBid.save` doesn't touch it). `preconstruction.ts:1747-1750`: run-agent4 writes that price into `bids.amount`.
- **Failure.** A bid was previously estimated at $100k. The estimator reprices to $120k in Labor & Pricing and saves (`bids.amount` = 120k), then generates the proposal from the prefilled "100000". The proposal says $100k and `bids.amount` goes back to 100k. This is exactly the plan's acceptance test ("Labor & Pricing → Save → proposal shows the same total"). On a bid's first save, the price is simply empty.
- **Fix.** Prefill `propPrice` from `estimatingBid.recap.totals.grandTotal` when the estimate is saved and not dirty, and update it after each save unless the user has typed a price. Show a mismatch warning in the pre-send checklist when `propPrice ≠` the saved total.

### S4. Removing the Overview tab also removed features that were not duplicates, including the only upload path for Accubid breakdowns

- **Evidence.** `PcWorkspaceView.tsx:1022`: `importPanel` is still built but rendered nowhere. On main, `case 'overview'` rendered `OverviewTab` with `importPanel` (main `PcWorkspaceView.tsx:1014-1023`). `ImportPanel.tsx` is the "Import Finished Bid" panel (bid doc + takeoff + **Accubid breakdown**), which POSTs `/import-bid` and writes `bid_cost_breakdown`. That table is the calibration report's only data source (`calibration.ts:46-52`). The workspace notes textarea and "Advance to Next Step" also disappeared. The report calls this "dropped per the plan", but the plan only removes *duplicate* Overview/Files content.
- **Failure.** Jake can no longer import finished bids or Accubid breakdowns, so calibration (Task 6/11) never gets new data, imported-bid comps stop growing, and workspace notes can't be edited.
- **Fix.** Re-home `ImportPanel` into Documents (or Insights) and the notes field into Documents or Review. Restore the `PcWorkspaceTakeoff`-style regression test for whichever takeoff-on-file view is kept.

### S5. A zero default is ignored: 0% tax, 0% small tools, 0% consumables and a $0 labor-rate default fall back to 7/3/2/38

- **Evidence.** `bidEstimate.ts:119-124`: `Number(taxPct) || 7`, and so on. `routes/settings.ts:64-65` makes these keys editable.
- **Failure.** An admin sets the default material tax to 0 for a tax-exempt customer class. Every new bid is still priced with 7% tax.
- **Fix.** Use `Number.isFinite(n) ? n : fallback`. Validate the `est_default_*` values (0–100, rate ≥ 0) in the settings PUT.

### S6. Per-bid OH/profit ignore the bid's existing markup

- **Evidence.** `bidEstimate.ts:125-126` hard-codes `overhead_pct: 10`, `profit_pct: 15` when `est_bid_settings` has no row. The bid's existing `bid_estimates.overhead_pct`/`profit_pct` or `bid_workspaces` values are ignored.
- **Failure.** A legacy bid saved at 22% OH / 8% profit is re-saved through the engine at 10/15 (see S1), silently changing markup and total.
- **Fix.** Seed the first `est_bid_settings` from `bid_estimates` (or the workspace), then fall back to 10/15. Show the source.

### S7. Validation allows negative overrides, and "Keep as manual" silently prices a line at $0

- **Evidence.** `routes/estimating.ts:75-80` checks overrides only for finiteness. `LaborPricingStep.tsx:309` sets `material_unit_override: 0, labor_hours_override: 0`. `pricing.ts:186` warns about $0 only on *matched* lines. `LaborPricingStep.tsx:128`, `:139`, `:243`, `:249` and `:258` use `Number(e.target.value)`, so clearing a field writes 0.
- **Failure.**
  - A −10 h override on a line yields negative labor, and negative totals can reach `bids.amount` (probe: a single −$500/−10 h line gives grand total −$1,185.43).
  - Resolving an unmatched takeoff line as "manual" and forgetting to type numbers drops it to $0 with no warning.
  - Clearing the labor-rate field while editing zeroes all labor.
- **Fix.**
  - Require overrides ≥ 0 (or require an explicit "credit" line type).
  - Count manual lines with 0 material and 0 hours in a warning.
  - Treat an empty input as "no change" or null, not 0.

### S8. Live recalc can show an out-of-order recap

- **Evidence.** `useEstimatingBid.ts:90-102` has no request sequence or abort. `LaborPricingStep.tsx:43-47` pairs `recap.lines[i]` with `lines[i]` by index.
- **Failure.** On a slow server, edit A is sent, then edit B 450 ms later, and A's response lands last. The summary and table show A's total while the inputs show B. Adding a line before the recap returns shifts the per-row priced values.
- **Fix.** Add a monotonic request id and ignore stale responses. Key recap lines by id, not index.

### S9. The legacy estimate write path is still live next to the new one

- **Evidence.** `routes/estimates.ts:42` (`PUT /api/estimates/:bidId`) still writes `bid_estimates` and `bids.amount`. `PcWorkspaceView.tsx:586-640` still computes `pricingLineItems` and defines `saveEstimate` on every render. `PricingTab.tsx`, `PricingRow.tsx` and `UnitCostSection.tsx` remain, and `/estimates/unit-costs` is still fetched at `:138`.

  In the current UI this code is unreachable: `onSaveEstimate` is only passed to `PricingTab`, which is never rendered, and nothing imports `PricingTab`/`UnitCostSection` except each other. It is still risky:
  1. A browser tab left open on a pre-merge build can click "Save Estimate" and overwrite the engine's `bid_estimates` and `bids.amount` with the flat-rate number, and `est_bid_lines` then disagrees.
  2. It keeps S2's guard alive.
- **Fix.** Delete the dead components and state, and make `PUT /api/estimates/:bidId` return 409 when `est_bid_lines` exist for the bid (or 410 outright).

### S10. `bid_estimates.subtotals` and the legacy `line_items` totals do not reconcile to the totals

- **Evidence.** `bidEstimate.ts:455`: the subtotal is `material + labor` per category and leaves out consumables, tax, small tools and supervision. `:464`: `line_items[].total` is `materialExt + laborExt`. Agent 4 receives these as "Category Subtotals" (`agent4Message.ts:89-94`).
- **Failure.** In the hand-computed case, the subtotals sum to $4,410.60 while `total_direct` is $4,930.23 and the grand total is $6,236.74. Agent 4, and any GC-facing text it writes, sees category numbers that add up to 71% of the price.
- **Fix.** Either allocate the add-ons into the category subtotals (pro rata) or label them clearly as "material + base labor" in the Agent 4 message.

---

## Nits

- **N1.** `pricing.ts:119-121`: `Math.round(n*100)` rounds half-cents down on binary artifacts (`1.005 → 1.00`). Use `Math.round((n + Number.EPSILON) * 100)` or a decimal lib. The comment's claim that "the displayed total equals the sum of displayed lines" is also untrue for labor: `laborCost` at `:225` is computed from total hours, not from Σ line `laborExt`. Reword the comment or reconcile.
- **N2.** `BidSummary.tsx:91`: with one comparable (or all equal), `compsMax - compsMin = 0` and the marker position becomes `NaN%` or `Infinity`. Guard the zero width.
- **N3.** `seed/laborUnits.ts`: the `MULTI-STORY` factor says "per floor above 2" but is applied once as a flat 3%. Either take a floor count or relabel it.
- **N4.** The seed library's categories (`'Exterior / Site Lighting'`, `'Site / Underground / Allowances'`, `'Low Voltage Infrastructure …'`) do not match Agent 2's takeoff category names, so the mapper's category bonus never fires for those three.
- **N5.** Phrasing decides whether a receptacle count is priced as a bare device or a full circuit. "Duplex receptacle" maps to DEV-DUP ($6, 0.35 h), while "20A 125V duplex receptacle, spec grade" maps to ASM-DUPLEX ($29, 1.7 h).
- **N6.** `BidTab.tsx:73`: "View Results" now only writes `activeTab` and no longer navigates (it is harmless inside the combined Takeoff step). Drop it or wire it to `onSelectStep('takeoff')`.
- **N7.** `legacyTabWantsInsights()` (`steps.ts`) is implemented and tested but not wired. The plan's "costs/intel → open Insights" is unmet.
- **N8.** `LaborPricingStep.onSync` has no `catch`, so a failed sync is an unhandled rejection with no toast. Manual lines cannot be deleted, only excluded.
- **N9.** `generateLaborSeedSql.ts`'s header says `npx tsx`, but `tsx` is not a dependency (only `ts-node`).
- **N10.** Deleted `PcWorkspaceProfiler.test.tsx`: `EstimatingWorkspace` receives a fresh `otherStepContent` element on every parent render, and `LaborPricingStep` is not memoized. There is no render-boundary guard for the new table. This is fine for now, but it is a known perf regression surface.
- **N11.** The resolver `Modal` uses the default overlay tier (150, or 240 on mobile). That is correct here because nothing opens it from inside a drawer, and `ConfirmDialog` uses `Z_ABOVE_DRAWER`. The mobile sticky summary bar (`estimating.css:262`, z-index 5) may sit under the fixed bottom nav (z 200). Check this on a phone.
- **N12.** `useEstimateStepParam`: the Router-optional branch is sound (`useInRouterContext()` is invariant per mount, and `PcWorkspaceView` is keyed by `bid.id`). `?step=` persists across bids in the URL, which is harmless.

## Items checked and found OK

- **Auth.** Library writes, calibration GET and calibration apply are `requireAuth + requireAdmin`. Every `/:bidId` route (GET, PUT, `/price`, `/sync-takeoff`) calls `loadAccessibleBid` first. `/calibration` is declared before `/:bidId`. The settings allowlist adds only the five `est_default_*` keys. `express-async-errors` covers the async handlers.
- **Migrations 101–103.** All are `IF NOT EXISTS`, with `DROP CONSTRAINT IF EXISTS` then `ADD`. There are no destructive statements. The 102 seed is `ON CONFLICT DO NOTHING` throughout, so it never overwrites an edit.
- **`saveBidEstimate`.** It runs in one transaction. `bid_estimates` totals and `bids.amount` come from the same recap. The index-misalignment fix is correct (lines are paired before filtering). `takeoff_item_id` is emitted as `line_items[].item`, which matches what the legacy path wrote (Agent 2's `row.item`). `composeBidData`'s lookup is no worse than on main.
- **Pricing formulas.** They match the plan once units are consistent (see the hand computation above). Factor exclusivity works per group. C/M conversion is correct when the line's unit is the library unit.
- **Lazy chunk.** `EstimatingWorkspace` is `React.lazy` with a `Suspense` fallback, and the hooks stay static.
- **`useEstimatingBid` hydration.** The defensive hydration is fine. The `bidId`-change branch is moot because the view is keyed by bid.

---

## Verdict: **DO NOT MERGE**

The pricing formulas are right, but the inputs they receive in practice produce wrong money:

- B1: every LF conduit and wire line is 100–1000× high.
- B2: unknown units produce NaN totals and crash the screen.
- B3: sizes and types are mis-mapped with high confidence.
- B4: calibration pushes hours in the wrong direction.
- B5: sync silently resets corrected quantities and leaves the pipeline amount stale.

S1 then pushes users to Save these numbers over real historical estimates on every bid they open.

Re-review after B1–B5 and S1–S4 are fixed. Each fix needs a test built from Agent 2's real `{item, spec, qty, unit: 'LF'}` shape, not from lines pre-converted to C/M.
