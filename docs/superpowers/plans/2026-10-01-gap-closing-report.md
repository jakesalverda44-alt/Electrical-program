# Gap-closing round — builder report. 2026-10-01

Branch `feat/gap-closing` (worktree `Electrical-program-wt-gap-closing`), off main 25dce72. 16 commits, T0 → T15 in the
plan's order (490242f … 2c1396c). Nothing merged or pushed, no app started, no live AI call, no live DB touched; tests
ran on `electrical_crm_test` only. Migrations **164–168**. Jake's decisions J1–J16 ("Do default") are built as approved.

## How the numbers are made (stated once)
- **Replay.** The same harness as the accuracy round: the read-only live exports of 2026-09-30, no model, no DB.
- **SCRIPTED answers** (the gate scenario, labeled in every table). It adds the following to P's SCRIPTED feeder locate / pins:
  - **The account terms.** The migration-114 AutoZone / Default rules (`account-rules-2026-09-30.json`) are resolved by `resolveAccountTerms` against Agent 1's `furnishStatements`; the exports carry no `account_terms` snapshot.
  - **Count answers, each quoting its document:**
    - Kissimmee "200A fused switch NEMA 3R" = 2 (E-4 "(TYP OF 2)"), the MB = 1, CF1-CF3 = 3;
    - 36th TIMER = 1.
  - **36th's fixture-package answer = Yes.** Chris's two lighting quotes are exactly the $4,466.72 vendor quote.
- **Before.** `backend/eval/gap-baseline-2026-10-01.json`, committed first (490242f) and never rewritten.
- **The plan's T0 numbers predate the merged fixes.** "K SCRIPTED $85,294.44 / 697.90 h" was measured before P's fix rounds 1–2 and the R merge. Main's true before is pinned instead:
  - K SCRIPTED $68,753.09 / 638.1 h;
  - K gate $64,994.21 / 600.3 h;
  - K live@submitted $42,916.83 / 364.5375 h;
  - 36th due-fresh $21,357.35 / 167.5 h.
- **Price reference** = Chris's own inputs at the bid's CRM settings (`chrisAtCrmSettings`):
  - **Kissimmee $82,853.75.**
  - **36th $20,100.47.** That is his equipment $890 / GE $310 and his two lighting quotes at his 7% tax / 10% markup, i.e. what he submitted. The plan's $20,904 put his already taxed and marked-up $4,466.72 through the CRM's 18% quote markup a second time.

## Before → after (SCRIPTED answers; Chris from his BOM via hoursGroups.ts)

| | Kissimmee before | Kissimmee after | Chris | 36th before | 36th after | Chris |
|---|---|---|---|---|---|---|
| Selling | $70,505.72 | **$68,512.84** | ref $82,853.75 (−17.3%, band ±20%) / price $79,112 | $18,105.22 | **$19,160.29** | ref $20,100.47 (−4.7%, ±15%) / price $23,230 (−17.5%) |
| Hours | 654.4 | **720.7** (−9.8%, ±12%) | 798.95 | 170.4 | **175.1** (−7.5%, ±15%) | 189.21 |
| Material | $22,767.84 | **$17,462.08** (−32.4%, reported) | $25,842.56 | $1,696.02 | **$2,361.55** (−30.5%, reported) | $3,399.32 |
| Equipment / GE | $4,350 / $3,020 | $4,350 / **$3,770** | $4,350 / $3,770 | $1,200 / $270 | same | $890 / $310 |
| Held lines | 17 | 10 | – | 5 | 5 | – |

The other scenarios, after:
- **K live@submitted** is still **$42,916.83 / 364.5375 h** (calibration off). This is the policy check, pinned in four tests.
- **K gate (projected@due-fresh)** is $76,112 / 656.2 h. That scenario has no account terms, so the fixtures are still priced.
- **36th projected@due-fresh** is $22,403.75 / 172.2 h. It is still inside the old F5 ±15% of $23,230.

### Kissimmee by group (hours)

| Group | Before | After | Chris | Band | Status |
|---|---|---|---|---|---|
| service gear | 22.3 | **47.1** | 42.0 | ±20% | PASS |
| site / underground | 27.1 | **52.2** | 44.6 | ±20% | PASS |
| fixtures | 139.2 | **160.1** | 161.4 | ±7% | PASS |
| devices | 43.2 | **14.3** | 9.4 | ≤ +7 h | PASS |
| branch wiring total (conduit + wire + fittings + hardware + boxes + splices) | 378.3 | **394.7** | 390.6 | ±7% | PASS |
| feeders | 19.9 | 28.9 | 79.6 | (≥36) | reported (Q1) |
| equipment connections | 21.1 | 19.9 | 40.8 | ±15% | reported: the power-pole hosts are a count (fewer-questions / Q4) |
| controls | 2.0 | 2.0 | 14.6 | – | reported (Q9: the CMP line is 0 ft until a length) |
| wire & MC | 81.1 | 75.1 | 87.3 | – | reported |
| misc | 1.5 | 1.5 | 16.0 | – | reported (Q6: the Misc row is offered, excluded) |
| (branch conduit / fittings / hardware / boxes / splices) | 68 / 50.7 / 84.5 / 35.9 / 58.1 | 68 / 52.6 / 99.1 / 38.4 / 61.6 | 52.8 / 59.9 / 87.9 / 35.7 / 66.9 | inside the branch total | |

### 36th by group (hours)

| Group | Before | After | Chris | Status |
|---|---|---|---|---|
| controls | 1.7 | 1.7 | 1.65 | PASS (±0.5) |
| devices | 6.0 | 4.3 | 4.9 | PASS (±2) |
| branch conduit | 18.0 | 17.2 | 30.6 | reported: T13 resolves 3 of 4 HVAC edges, but AHU-2 has no mark in the 0930 count, so the MEASURE set stays a hold |
| fixtures | 28.1 | 30.9 | 35.1 | reported (Q10) |
| wire & MC | 21.3 | 20.3 | 25.7 | reported |
| equipment connections | 4.1 | 4.1 | 0 | reported (Q7) |
| feeders | 0 | 0 | 3.0 | reported (Q13, the riser) |

### Per-item effects, Kissimmee (SCRIPTED)
- **Owner-furnished:** −$13,855 material on 17 lines. The plan's −$23.7k predates B5, which had already zeroed the poles and heads, and R, which corrected the counts.
- **Feeders:**
  - DISCON A/B → PANEL A/B: 16 / 11 → **31 / 27 ft** (through the wall and over). The plan expected ≈36 / 31; its arithmetic assumed a 16 ft horizontal.
  - #3/0: 428 → **592 LF**.
  - Taps: 2 × (5 ft 2" EMT + 4 × 5 ft #3/0) and **8 Polaris taps**, 9.6 h / $360.
- **Service gear:** gutter 6 h / $600, grounding 6 h / $890, FRT plywood 4 h / $250. The 200A switches are 2 × (3.1 + 3 × 0.1) h = 6.8 h, $624.86, flagged "furnish disputed". Meter socket 1.5 h. Flush panels 2 × 4.5 h. Six #6 lugs, 0.9 h.
- **Site:** 1" PVC 317 → **716 ft** (radial; hand measurement 670–700, Chris 750). #10 1,585 → 2,148 ft.
- **Receptacles:** devices 43.2 → 16.8 h before J8, 14.3 h after J8. Box allowance +2.5 h, splices +3.5 h.
- **MC:** 1,404 → **1,915 ft** at 1.52/C. Connectors now 144 × 2.82 × 0.08 h = 32.5 h.
- **Units:**
  - Fixtures 139.2 → 160.1 h (J7 + wall-mount tiers).
  - Panels 16 → 9 h.
  - #3/0 and #6 at 18.8 and 8.9 h/M.
- **Prices:** THHN / EMT / PVC / MC at Chris's 6/18/2026 net. Contactor $800.
- **OxBlue:** GE +$750.

## Per task
- **T0 (490242f).**
  - Classifier: the Feeders hint only decides when the text names no size or gauge. Later additions on both sides: Polaris / lugs and FRT plywood are service gear, and the "MC connector allowance" is fittings.
  - New: the SCRIPTED-answers scenario options (accountTerms, scopeAnswers, quoteFixturePackage, answers), `chrisAtCrmSettings`, `gapTargets.ts`, the scripted-answers and account-rules fixtures, and the baseline.
- **T1 (fa5f99a). Library history (migration 164).**
  - Triggers on `est_items`, `est_assemblies` and `est_assembly_components` write the old row before every priced or mapping change. This covers library.ts, the Accubid import, the calibration apply and every later migration. `changed_by` comes from `app.library_change`.
  - New pure `libraryAsOf`. `getLibraryForBid` is the ONLY library read for a bid: live for `isEstimatingBid`, as of `submitted_at ?? updated_at` otherwise. Items the bid's own saved lines reference are kept.
  - All 11 bid-pricing `getLibrary()` call sites moved: bidEstimate ×7, accubidBidData ×4. A grep test pins it; the only remaining calls are the library admin routes.
  - The replay mirrors the policy (`gapMigrations.ts`).
- **T2 (ceddcd6). Owner-furnished (`ownerFurnished.ts`).**
  - Per term, from the rule, every statement (`parseStatementParties`: "by G.C." = APT) and the estimator's scope answer, which wins.
  - All Owner/Vendor → labor only, quoted. They disagree → priced and flagged.
  - Disconnects are disputed only on fused switches, because every owner statement names fused ones; so the K RTU 60A disconnects are not flagged.
  - Lines are matched by `lineMatchesAutoDeduct` plus a panelboard / fused-switch name check, or by `isFixtureLine` for lighting.
  - One `resolveOptionsForBid` replaces all six fixturePackageQuoted call sites, gated by `isEstimatingBid`. The autoDeductAlternate guard is in place and overrides still win.
  - K: lighting and panels are labor only; disconnects and power poles are disputed; the Default rule (36th) has no effect.
- **T3 (b051ae6 + T14). "Is this quote the fixture package?"**
  - `est_bid_quotes.fixture_package_decided` (migration 164). `fixturePackageQuestion` is on GET /accubid; the PUT takes `fixturePackageDecided`. Never answered automatically.
  - 36th: the prompt shows; Yes → $17,751.35 (pre-round code; the plan said $17,631); No → unchanged.
- **T4 (6db23a9).**
  - (a) Wall crossing comes from Agent 1's location / nemaRating. An unknown location keeps today's rule.
  - (b) Taps from the service spec, plus `Polaris taps — N` at TAP-POLARIS. A tap with no spec is a needs_size hold.
  - (c) `undergroundLaborAdjPct`, 0–100, default 0, no row (J4).
  - **Migration 165** is insert-only, and every item is code-only (ALIAS_ONLY_CODE_RE): TAP-POLARIS, ADJ-UG-HR, SVC-GUTTER, GND-SVC, BKBD-FRT, LUG-6, PNL-225F, LTG-WM175, LTG-WM250, LV-CMP244, ALW-MISC, METER-SKT, ALW-FIT-MCLUM.
- **T5 (6a28299). `serviceGear.ts`** runs after `decideRows`, on estimating bids only. It maps:
  - the service gutter (one priced, the rest duplicate notes);
  - the grounding electrode **system** lump only, never a single ground rod, and counts are never changed (the Ufer allowance becomes a note);
  - FRT plywood;
  - any 200A fused switch → ASM-SW200F (the count stays the answer's);
  - the meter socket;
  - a flush 225A panel → PNL-225F (J6);
  - DSXW1 / wattage wall-mounts → WM250 / WM175 (J7).
  - It also adds the Venstar CMP line (J14) and 3 #6 lugs per priced feeder with a #6 ground.
- **T6 (0166ddd). Radial site runs.**
  - The service corner is registered across site sheets by shared text. K: C4.1 → PH0.1 by 3 labels; the graphic-scale legend is outvoted.
  - One circuit per pole → radial; otherwise the chain. Extra circuits are noted (Q3).
  - Review SF-B: the trench now follows a typed run.
- **T7 (aa711f5). Receptacles device only** (J9, `est_receptacle_device_only`).
  - One predicate before and after generation; if no branch raceway is emitted, it re-runs with the swap off.
  - Estimating bids only; manual picks keep their match (sync is auto-only). D6 is now 0 h.
- **T8 (ceefadc). MC per luminaire** (`isLuminaireText`, one test for BOM and takeoff rows).
  - `mcBasis` / `mcPerLuminaire` 13.3 ("Chris 2026 jobs"). The calibration prints both bases with LOO: per fixture 7.89 ±22%, per luminaire 9.85 ±24%. By job: K 13.49, 36th 13.02, North Port 10.22, Orlando 8.58, Rockledge 7.53.
  - The box / fitting MC connectors are driven per luminaire (ALW-FIT-MCLUM). A non-estimating bid keeps the fixture basis.
  - 36th gives 492 ft, not the plan's 386: its 8 "can lights" count as luminaires (Q10).
- **T9 (6ad46aa).** CMP line and TIMER → LC-TIMESW 1.65 h verified. Probes added: "data cable for cameras", "plywood shelf", "transformer grounding", "gutter downspout", "EAS surface wireway".
- **T10 (8b1ac28).**
  - OxBlue GE rule ($750, the furnish statement quoted).
  - Excluded ALW-MISC row on ground-up estimating bids.
  - **Migration 168**: the receptacle flag; the untouched 150 footage ratios → luminaire; box / fitting luminaire connectors (if absent); OxBlue on the untouched 159 v2.
- **T11 (9097a99). Migration 166**, the approved unit moves only. History is written first, the 156 guard applies, and it is idempotent:
  - J5: THHN-3_0 18.8, THHN-6 8.9 /M.
  - J6: PNL-225 3.6.
  - J7: STRIP4 0.75, DOWN 0.9, EXIT 0.55, TROF24 0.70, TROF22 0.60.
  - J8: DEV-DUP 0.23, DEV-GFCI 0.28, SW-1P 0.21 (20A toggle 18 h/C + plate), SW-3W 0.27 (Orlando 3-way 24 h/C + plate).
  - J10: MC-1202 1.52 /C.
  - Carried from the accuracy round: DISC-30 / 60 / 200 → 1.10 / 1.55 / 3.1, LTG-POLE 4.8, LTG-POLEHEAD 2.2.
  - The seed TS matches. Older rounds' replay tests read `SEED_ITEMS_BEFORE_GAP_ROUND`, so the numbers their reports quote stay pinned.
- **T12 (0ec13e5). Migration 167**, the Kissimmee 6/18/2026 net for the approved list, with material_price_date 2026-06-18. `priceRefreshPreview.test` prints the diff table:

  | code | library | Chris K | 36th (record) |
  |---|---|---|---|
  | THHN-12 /M | 95 | 208 | 137.38 |
  | THHN-10 /M | 150 | 329.70 | 210.40 |
  | THHN-6 /M | 360 | 895.50 | – |
  | THHN-3_0 /M | 1,870 | 4,735 | – |
  | EMT-075 /C | 60 | 92.38 | – |
  | EMT-100 /C | 85 | 157.82 | 181.90 |
  | PVC-100 /C | 35 | 51.82 | – |
  | PVC-200 /C | 85 | 105.68 | – |
  | MC-1202 /C | 70 | 74.52 | 62.61 |
  | LC-CONTACTOR | 180 | 800 | – |

- **T13 (579d32e). One unlabeled panel mark + one unlocated panel → `suggested`.**
  - It quotes "Existing Panels A/B reused; field verify circuits", and a route through it is never `confirmed`. Two unlabeled types → a hold. PANEL B's mark is never reused, and the riser stays skipped.
  - 36th 0930: COMP-1 / AHU-1 / COMP-2 come to 42 / 66 / 150 ft; **AHU-2 has no count mark**, so the 4-edge set is still not priced (the 0929 export had 392 ft for all four).
- **T14 (266be44).** Frontend:
  - badges for owner-furnished (labor only) and furnish disputed;
  - three sidebar / collapsed-strip rows (parity test 16 → 19);
  - the fixture-package prompt with Yes / No and a pick list.
- **T15 (2c1396c).** `gapGate.test.ts`. Every F5 check is kept in replayEval.test.ts.

## Deviations from the plan, and things to confirm
1. **The material band (±30%) is reported, not gated.** K is −32.4% and 36th −30.5%. The K shortfall is Chris's 8 power poles × $650 (the replayed count finds 0 of the 6; that is a count, and this round does not set counts), plus the Misc $1,500 (excluded until Q6) and the CMP $230 (0 ft until Q9).
2. **The plan's "≥ 36 h" feeders band** counted the Polaris taps as feeders. On both sides they classify as service gear, so feeders read 28.9 h. They stay reported (Q1).
3. **Plan figures that moved because P's fixes and R's counts landed first:**
   - Owner-furnished −$13,855, not −$23.7k.
   - #3/0 592 LF, not ≈624.
   - The K DISCON → PANEL feeders 31 / 27 ft, not 36 / 31.
4. **#6 lugs: 3 per feeder #6 ground** follows the plan's "2 × 3 = 6". The three are the switch ground lug, the enclosure bond and the panel ground bar, labeled "default — confirm".
5. **LC-CONTACTOR $800** is Chris's lump for a 6-contactor enclosure. On a job with single contactors it overprices. It was on the approved list; flagged in the SQL and here.
6. **New item METER-SKT** (1.5 h, $0, Chris's 200A meter socket) was not in the plan's item list. T5 needed a meter-socket unit, so it is in 165.
7. **The trigger covers more than the plan asked.** Library history is trigger-based rather than written by hand in each writer, so every write path is covered. Assembly rows (aliases / active) have history too. Labor factors are not covered: they are chosen per bid, not library prices.
8. **Old pins updated, each with a comment saying why:**
   - replayPricingGate hold count 17 → 11;
   - zeroHourLines PIN 17/8/16 → 21/9/11;
   - feederRows DISCON A 16 → 31;
   - the feederEstimate adjacent-gear test (now wall crossing);
   - replayEval.baseline: the due-bid "round additions" bound goes 2% → 10%. 36th is a due bid and takes this round's units on purpose; the gap gate checks it.
   - DB tests estimatingFootageAllowance and estimatingReviewAnswers follow migration 168.
9. **App-settings changes in 168** (the MC basis, the receptacle swap, the OxBlue rule) would otherwise move submitted bids. The code gates each one by `isEstimatingBid`, so a submitted bid keeps the fixture basis and gets no swap. app_settings themselves have no history, so a non-estimating bid's protection comes from those gates, not from libraryAsOf.

## Shared-file edits

**P-owned files (edits additive where possible):**
- bidEstimate.ts: getLibraryForBid; resolveOptionsForBid; owner-furnished in resolveLines; the serviceGear / receptacle / grounding post-passes in takeoffRowsFrom; laborPerFtOf.
- accubidBidData.ts: getLibraryForBid; resolveOptionsForBid; fixtureMaterial; fixturePackageQuestionFor; fixture_package_decided; the OxBlue context.
- pricing.ts: `furnishedBy`, `ownerFurnished`, `furnishDisputed`.
- feederRoute.ts: wall crossing, undergroundLaborAdjPct, suggested tier.
- feederEndpoints.ts: nodeLocations, unlabeled panel, hints.
- feederGraph.ts: tap spec.
- feederRows.ts: tap rows, underground row.
- feederEstimate.ts: locations, hints.
- siteGeometry.ts: radial, text registration, SF-B.
- footageAllowance.ts / footageCalibration.ts: luminaire basis.
- footageAllowanceDb.ts: taps, lugs, underground, Misc, MC basis gate, build_type.
- boxFittingAllowance.ts: MC connectors per luminaire.
- costLineDefaults.ts: OxBlue, parseAgent1.
- mapper.ts: ALIAS_ONLY_CODE_RE extended.
- seed/laborUnits.ts: GAP_CLOSING_ITEMS, moved units, SEED_ITEMS_BEFORE_GAP_ROUND.
- autoDeductAlternate.ts: `NEVER_DEDUCT_RACEWAY_RE` is now exported.
- routes/estimating.ts: the quote PATCH validator takes `fixturePackageDecided`.
- Tests: seedUnitsVsChris, matcherSafety.

**Others:**
- library.ts: history, as-of, created_at.
- hoursGroups.ts: eval classifier.
- calibration.ts and accubidImport.ts: untouched; the trigger covers them.

**Shared with fewer-questions:**
- `eval/replayEval.ts`: additive. New options, `applyScriptedAnswers`, `chrisAtCrmSettings`, `CHRIS_INPUTS`, the 168 mirror constants, owner-furnished / fixture-question fields, `GENERATED_KEY_RE` extended, `libraryAfterMigrations` excluding the 165 codes, and the library choice by isEstimatingBid.
- `replay0930.ts`: read only.
- Not touched: reviewItems.ts, takeoffReview.ts, tradeAssignment.ts, routes/preconstruction.ts, countMerge.ts, the review UI.
- Read only: accountRules.ts, accountRulesDb.ts.

**Frontend:** types.ts, BidSummary.tsx, LaborPricingStep.tsx, AccubidPricingPanel.tsx, useAccubidPricing.ts.

## Test DB note (shared with the fewer-questions worktree)
- Migrations 164–168 ran on `electrical_crm_test`.
- To keep the parallel round's DB tests on their own settings, I reversed 168's setting changes and removed its `schema_migrations` row, using a script on the test DB only. It re-applies the next time this branch's DB tests run.
- 164's triggers and 165's items stay; they are harmless to other branches.
- The test DB has no `source='seed'` library rows at all (other tests turned them manual or calibrated). So 166 and 167 move nothing there, and the existing estimatingLibrary "editing a SEEDED item" test fails for that reason on any branch.

## Open questions for Chris (unchanged from the plan; the build defaults are in)
Q1 lateral and empty 2" PVC · Q2 wall crossing (built) · Q3 radial / pylon · Q4 power poles · Q5 owner-furnished and fused mains · Q6 Misc · Q7 terminations · Q8 flush 4.5 (built) · Q9 Venstar length · Q10 36th EM 2-heads / Type H, and whether the 8 "cans" take whips · Q11 wall-mount tiers (built) · Q12 underground % (setting at 0) · Q13 36th "1" EMT & Wire" / the riser.

For Jake: the library history cannot undo migrations 156 and 158. Those moved submitted bids before any history existed.

## Tests
- **Backend:** tsc clean. Full suite run once: **3,077 passed, 5 failed, 4 skipped**. All 5 failures are on the known-flake list: intakeSimilar.route ×2, intakeSimilarCache ×2, integration lead-backfill. Two files failed to load under load once each (estimatingAccubidBidRoutes, estimatingSheetsRoutes) and passed alone.
- **Frontend:** tsc clean. Full vitest **1,680 passed, 0 failed**.

## Fix round 1 (2026-10-01, after the Opus review f32e211)

**B1 (blocker) fixed.** Migration `169_bid_priced_as_of.sql` adds `bids.priced_as_of` and backfills every non-Due bid from `submitted_at`, else `updated_at` at migration time (a fixed date from then on); Due bids stay NULL.
- Stamped in `transitionBidStage` on every move OUT of an estimating stage (due -> submitted / awarded / lost), and in `PATCH /bids/:id` when Calibration goes from on to off.
- `getLibraryForBid` reads `priced_as_of`, then `submitted_at`, then `updated_at` (last resort only; the backfill means no non-Due bid reaches it). `submitted_at` is untouched (timeline, win rate).
- DB tests (libraryHistory): submit -> back to due -> library change -> re-submit prices with the library at the re-submission (not the first submission, not the live one); due -> lost keeps a fixed date through a later bid edit; Calibration off re-stamps.

**S1 LC-CONTACTOR.** Per-contactor price: $133.33 material (167) and 1.0 h (166 and the seed; `GAP_ROUND_PREVIOUS_LABOR` and the replay mirrors updated), from Chris's Kissimmee BOM row "Lighting Contactor 1 E, $800, 6.0 h" = one lump for the 6-contactor enclosure. The mis-match found: the row "Semi-recessed, circuit B-25" is really "Lighting contactor ENCLOSURE (6 contactors)" (the description shows the spec), and the alias "lighting contactor" put it on LC-CONTACTOR. Fix (serviceGear): a contactor enclosure row becomes a `duplicate` note when a counted contactors row exists (Kissimmee: "Lighting contactors (Work, Sales, Sign x2, Site x2)", still a confirm_match hold), or a visible `confirm_match` hold when alone; never LC-CONTACTOR. **For Jake to confirm:** $133.33 / 1.0 h per contactor from Chris's lump, and that the counted contactor row should land on LC-CONTACTOR once confirmed. K SCRIPTED answers moved $68,512.84 / 720.66 h -> $67,351.72 / 717.5 h (the $800 line is gone until the contactors are confirmed); 36th unchanged.

**S2** a wireway/gutter is the service gutter only when the row names service / main / meter / utility / NEMA 3R / "contractor provided" (a dimension alone no longer counts); lighting control / LCP / controls / ALC / telecom are excluded. Tests: serviceGear.test and matcherSafety.
**S3** transformer / xfmr / T-number / separately-derived grounding is never GND-SVC unless the text also says "service"; it falls to the mapper (a visible hold). Both reviewer strings tested.
**S4** `fixturePackageQuestion` is returned only when `isEstimatingBid`.
**S5** the 36th live@due round delta is pinned: $1,178.47 (+-$1), $22,133.75 vs the live $20,955.28.
**S6** skipped as agreed. For the dry run: `database/previews/166_167_dry_run_preview.sql` is a read-only per-code listing (old value, new value, `would_move`, source, reconciled) for 166 (19 unit rows incl. the contactor) and 167 (10 price rows); in a transaction on the copy, `SELECT changed_by, count(*) FROM est_item_history GROUP BY 1` then gives the per-migration history counts before the ROLLBACK.

**Nits.** N1 `getLibraryHistory(since)` filters `valid_until > ts` (no result changes). N2 flush-panel exclusions (`not flush`, `surface (not`, `existing`). N3 `fusedOnly` now applies to labor-only disconnects (also fixed: "non-fused" no longer counts as fused). N4 the $145 wall-mount material is the library's own LTG-WPACK price, marked "default - confirm" in 165 and the seed. N5 the Calibration toggle hint now says a sync on a submitted/sold bid rewrites its saved lines. N6 the getLibrary grep test now catches member / aliased uses. N7 (account-terms snapshot needed on Kissimmee until the live re-run) is carried to Jake with the re-run.

**Tests.** Gap gate and every gap file pass, including the DB tests the reviewer could not run (libraryHistory, ownerFurnishedBid, estimatingSidebarAccubid). These re-applied 168 and 169 on `electrical_crm_test` (migrations 164-169 are now applied there). Backend and frontend tsc clean; frontend vitest 1,680 passed. Full backend once: 3,086 passed, 5 failed, all on the known-flake list (intakeSimilar.route x2, intakeSimilarCache x2, integration lead-backfill).
