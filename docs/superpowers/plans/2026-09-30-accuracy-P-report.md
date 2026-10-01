# Accuracy round, Builder P report. 2026-09-30

Branch `feat/accuracy-pricing` (worktree `Electrical-program-wt-accuracy-p`). Nothing is merged or pushed.

**Status.** All backend P tasks are done: Task 0, C1–C2, C4–C7 (API), C8 eval items, D0–D6, E0–E4, the calibration flag, F4 and F5.

**Frontend is not done yet.** That covers the C7 FeedersPanel and Plans route layer, the D5 badges / filter / sidebar line, and the calibration checkbox. UI round 1 is now on main (11e510e), so this work is unblocked. It will start by merging main.

Every before number below comes from `backend/eval/replay-baseline-2026-09-30.json`. Every after number comes from `src/eval/replayEval.test.ts`, which prints the tables.

## How the replay works (stated once, applies to every table)
- **Inputs.** The read-only live exports of 2026-09-30: Kissimmee 041c6d48 / 11ff4565 and 36th 0cd39e74 / ec90ce29. No model calls, no DB.
- **Library.** The exported live library, with migrations 158 and 159 applied the way the SQL applies them.
- **"projected" rows.** The replayed count is laid onto Agent 2's rows (`projectCountsOntoRows`). This is the replay's stand-in for Agent 2 reading the new counts; a live re-run may differ.
- **"due-fresh".** Stage `due` is assumed, and the default cost lines are treated as never seeded. The gate uses `projected@due-fresh`.
- **Kissimmee text runs.** The real C4.1 / PH0.1 text runs are always included (the app's loader reads the same).
- **SCRIPTED scenario.** Adds the SCRIPTED locate[] stand-in for Builder R's C3 (E-1: Panel A/B, DISCON A/B, METER, WIREWAY). Also adds SCRIPTED pins for XFMR and METER on C4.1, measured once from the local PDF and documented in `kissimmee-2026-09-30-scripted-pins.json`. No review answers: the pole-type / typical answers arrive with R.

## Before → after (gate scenario `projected@due-fresh`)

**Kissimmee.** Counts are unchanged in P; site poles 6 / heads 10 until R's A lands.

| | Before | After, automatic | After, SCRIPTED | Chris |
|---|---|---|---|---|
| Selling price | $65,657 | $81,535 | $85,294 | $79,112 |
| Hours | 601.4 | 660.1 | 697.9 | 798.9 |
| Equipment / GE | $0 / $0 (seeded) | $4,350 / $3,020 | $4,350 / $3,020 | $4,350 / $3,770 |
| Held $0 lines | 42 (silent) | 15 visible holds + 9 notes | 14 holds + 10 notes | – |
| #3/0 LF | 0 | 0 | 428 | 872 |
| #6 LF | 0 | 0 | 615 | 498 (+#6 G 66) |
| 1" PVC LF | 780 (ratio, 6 poles) | 302 (site geometry) | 317 | 750 |
| Branch Wiring h | 414.1 | 375.4 | 383.2 | 406.6 |
| Exterior / Site Lighting h | 14.6 | 72.5 | 72.5 | 49.5 |
| Branch Power h | 53.9 | 67.6 | 67.6 | 50.2 |
| Feeders h | 0 | 0 | 20.7 | 79.6 |
| Site / Underground h | 0 | 21.5 | 30.8 | 44.6 |
| Service & Distribution h | 16.3 | 16.3 | 16.3 | 42.0 |
| Lighting Controls h | 3.2 | 7.5 | 7.5 | 14.6 |

Notes on the Kissimmee table:
- The ratio PVC row was carried in the Branch Wiring category; the site rows now replace it. That is why Branch Wiring drops.
- Exterior / Site Lighting is inflated by the 6 poles / 10 heads double count (R's A). With 3 poles / 4 heads it comes to about 31.5 h.
- The **live proposal as stored** (`live@submitted`) goes from $42,916.83 / 364.5 h to $58,756.51 / 430.4 h. That is Chris's units, the pole aliases and the notes; no stage-gated rows, because the bid is submitted.

**36th Street** (stored answers; stage `due`):

| | Before | After | Chris |
|---|---|---|---|
| Selling price | $21,225 | $21,357 (−8.1%) | $23,230 |
| Hours | 164.1 | 167.5 (−11.5%) | 189.2 |
| Holds | 10 silent | 5 holds + 1 note | – |

- The gain is the COMP/AHU #6 terminations, 3 × 1.12 h. Each one is an equipment connection Chris did not carry.
- The HVAC equipment-circuit feeder edges stay holds: the 0930 count has no "PANEL A" mark (only "ELECTRICAL PANEL" / "PANEL B"). On the 0929 export the same edges resolve, at 392 ft of 3/4" EMT + 3#6 against Chris's 300 ft "1" EMT & Wire".
- The riser is skipped as existing, because the export says "Existing per riser / existing to remain, verify". Chris carried 100 ft of 2" EMT & Wire there, about 3 h.

**Gate (F5).** All checks pass:
- no count regression;
- |hours − Chris| is not worse than baseline + 2%;
- 36th is within ±15%;
- Kissimmee hours are at or above the baseline;
- no line prices at a silent $0.

The site poles / heads check is skipped until R's A changes the replayed count (it skips itself while site_poles is still 6).

## C — feeders
- **C1 `feederGraph.ts`.** Kissimmee 0928 and 0930 produce exactly six edges: XFMR→METER (service lateral, (2)4#3/0 2"), METER→WIREWAY, DISCON A→PANEL A, DISCON B→PANEL B (4#3/0 + #6G 2"), PANEL B→RTU-1, PANEL B→RTU-2 (3#6 + #10G 3/4"). WIREWAY→DISCON A/B are taps. On 36th the riser is skipped as existing (pinned) and there are four HVAC edges from Panel A. `feederNodes()` is exported for R's C3.
- **C2 `sheetScale.ts`.** C4.1 and PH0.1 read 0.2776 ft/pt off the real scale bars. E-1 reads 0.1111 ft/pt, and the area check passes (6,644 SF from the mark extent vs 7,147 bid SF). E-7 "Not to Scale" is unverified.
- **C4 `feederEndpoints.ts`.** Each node gets one candidate per sheet, in priority order: pin, locate, counted, label. The edge then picks a sheet both ends share.
  - On Kissimmee the RTU ends are the two "HVAC disconnect with unit" marks, marked interchangeable.
  - XFMR resolves from the C4.1 label "ELECTRICAL TRANSFORMER," (approximate). The legend "TRANSFORMER PAD" is excluded.
  - A bare "METER" on a civil sheet is never used.
- **C5 `feederRoute.ts`.** The math string is always shown. Settings are in `est_feeder_estimate` (migration 159). Two pieces of gear within 15 ft run at the gear with no rise; I added this so a disconnect next to its panel doesn't climb to the deck and back.
- **C6 `feederRows.ts`** (estimating / calibration bids only).
  - Today's MEASURE sets stay exactly as they are (same item, so a typed qty survives) unless every run of the set resolves. In that case a typed qty carries over, shared across the runs by their estimated lengths.
  - Agent 2's feeder RUN / LOT rows become notes.
  - The estimator's own line still wins.
  - Estimated equipment circuits take their disconnect / connection points off the branch ratio (Kissimmee: −26 ft).
  - Submitted bids get exactly today's rows (tested).
- **C7.** `GET /api/estimating/:bidId/feeders` returns edges, math, tier, endpoints (located or the pin hold), route (documentId, pageIndex, points), quantities, taps, skipped feeders, scales and a summary.

**C8 numbers (Kissimmee).**
- **Automatic** (no locate / pins): every edge is a hold. The panels, disconnects and meter are not count targets, so the endpoints wait for R's locate[] or a pin. The plan's "≈250 LF automatic" assumed the locate step works.
- **SCRIPTED**:
  - #3/0: 428 LF vs 872 (−51%). The transformer pad on C4.1 is about 9 ft from the building wall (29 ft run × 8 conductors = 232 LF). The disconnects sit next to their panels (16 / 11 ft runs). The plan's 608 LF lateral estimate isn't supported by the drawing geometry.
  - #6: 615 LF vs 498 + 66 (+9% against both). RTU-1 is 121 ft and RTU-2 75 ft.
  - #3/0 and #6 are reported (not pass/fail), with the ±25% band.

## D — zero-hour lines
- **D0** (`zeroHourLines.test.ts`). The 41 silent $0 lines are now 18 priced (Chris's units), 8 classified notes and 15 visible holds, each with a reason.
  - The before classes are per the plan: circuit_list ×3, circuit_ref ×4, equip_no_unit ×8, disconnect_no_size ×2, held_fuzzy ×6, unit_unknown ×4, no_unit ×5, feeder_run ×1, scope_note ×8. The full table is in the test output.
- **D1 / D2.** Circuit lists and circuit references of another row are notes:
  - the sign J-boxes and the pylon connection are references of the SIGNS row;
  - a receptacle on a shared circuit never becomes a reference.
  - When the detail is refs-only or a scope phrase ("With unit", "Contractor provided"), the row maps by its item.
- **D3.** Chris's units, by code:
  - RTU-1/2 → #6 termination (1.12 h);
  - "RTU disconnects" → 60 A safety switch (sized from the two RTUs); "HVAC disconnect with unit" is noted as the same two disconnects;
  - WH / mini-tune / DF / signs / ALC / exhaust fans → ≤#10 termination (0.72 h);
  - fridge / drink machine / battery chargers → "served by a receptacle" notes.
  - **36th check:** the 4 COMP/AHU rows get #6 terminations (3 counted, 3.36 h). Chris carried no terminations there, so this is an over-count of about 3.4 h against Chris.
  - The bare "Disconnect" ×4 rows hold for size because they name no equipment. They never guess.
- **D4 / migration 158 + decision 1.** New items: terminations, 200A fuse + the 200A fusible switch assembly, power pole set-and-wire, simplex w/ plate, ceiling fan, 30 ft pole, anchor-bolt set, pipe-pole riser. DISC-30/60/200 moved to 1.10 / 1.55 / 3.1, LTG-POLE to 4.8 and LTG-POLEHEAD to 2.2, with site pole / fixture heads aliases.
  - The seed TS and migration 158 agree (`seedUnitsVsChris.test.ts` cites each BOM row).
  - The new units are alias-only (never fuzzy, off the token frequencies), so the only mapper changes are DISCON A/B (now the 200A fusible switch by alias) and the S1/S2 heads (now the pole-head alias).
  - Chris's recap reproductions are unchanged: `accubidRecap` tests pass.
- **D5.** `PricingWarnings.holds` carries a reason per line (no_unit, confirm_match, unit_unknown, needs_length, needs_size, needs_endpoint, needs_scale, circuit_ref), plus a `noteCount`. Notes are recognized from the evidence prefix, so saved lines classify the same way.
- **D6** (report only). On Kissimmee, 18 receptacles on the complete-circuit assemblies carry 22.70 h of EMT + #12 that the footage allowance also carries (1.26 h each). On 36th: 0.

## E — site, defaults, calibration
- **E0** (reported in Task 0).
  - Kissimmee is `submitted`, so the box / fitting / hardware / splice rows (234.5 h) and the default cost lines were not in the live $42,917.
  - Both bids already carry "seeded" markers for both default kinds.
- **E1 `siteGeometry.ts`.**
  - **Method:** PH0.1 at the scale bar; the building comes from the wall-pack marks. Entry → 3 poles nearest-first = 282 ft + stub-ups 20 ft + the interior run (Panel A → wall, approximate, only when Panel A is located). The conductors are the 3 site circuits A-15/17/19 + N + G = 5 #10.
  - **Result:** 302–317 ft of 1" PVC against Chris's 750 (−58%). It replaces the ratio PVC row.
- **E2.** "Site poles, anchor bolts, templates AZ furnished; EC installs" gives an anchor-bolt set per pole. The "verify who pours bases" note is quoted on the line.
- **E3.** Trenching is a line excluded by default (site route + underground feeders).
- **E4 / migration 159.** Itemized v2 defaults. Kissimmee reproduces $4,350 equipment exactly and $3,020 of the $3,770 GE (the $750 camera pole is AutoZone-specific).
  - **The fit is weak outside Kissimmee.** The 10-breakdown table is printed by `costLineDefaults.test.ts`. Equipment under-predicts the big 2024 jobs (Fort Myers 7,170 vs 1,250). In the 2025–26 window it is Bubble Down 3,000 vs 1,250, and Gulf / Seminole 0 vs 1,250.
  - Only Kissimmee's features (poles) are known. The other breakdowns are scored on hours alone.
- **Calibration flag (migration 160).** `bids.calibration` (default false) is accepted by PATCH /api/bids/:id as boolean only. `isEstimatingBid()` = stage `due` OR calibration, used everywhere the stage gate was. The replay takes `calibration: true`.

## Frontend (after main was merged in at 3591cd0)
- **D5** (`2cf51cb`). Each line in `recap.warnings.holds` gets a "needs a price: <reason>" badge, with the evidence note as its tooltip.
  - A "Needs a price/unit (N)" filter on Labor & Pricing shows only those lines.
  - The sidebar says "Total excludes N held lines — needs a price/unit". It comes from `bidSummaryWarnings`, so the collapsed strip counts it too, and the parity test is extended.
- **C7 FeedersPanel** (`9228955`). It sits on Labor & Pricing, below the factors, and shows one card per feeder:
  - from → to, kind / spec, the length and tier or what is missing, and the math;
  - **Show on plans** opens the sheet;
  - **Adopt as run** creates a confirmed linear markup on the conduit line (drops 2 × half the vertical + makeup, default slack), then calls apply-markups. It needs a saved estimate. The markup length uses the measure tool's own formula, so an underground route loses the 1.15 site factor.
  - **Confirm length** handles cross-sheet routes;
  - **Pin <node>** opens the Plans view and says how to name the count marker. It does not pre-select the count tool.
  - **Type length** sets conduit = run × sets as the estimator's own qty. The wire follows on the next sync.
  - `/feeders` now also returns stage, calibration, slackPct and each route's vertical / makeup ft.
- **Calibration job checkbox** (`9228955`). It is in the same panel's header and uses Jake's copy. It PATCHes `bids.calibration`.
- **Plans layer** (`4a5f85d`). A remembered toggle draws the "Suggested feeder routes" as read-only dashed polylines inside PlanViewer's origin / rotation-aware `<g>`.
  - Tested on Kissimmee E-1's real /Rotate 270 geometry: the Panel B pin lands at its measured displayed point (1325.76, 449.76).
  - Works in full-screen mode (tested).
- **Shared frontend files** (additive): `LaborPricingStep.tsx`, `BidSummary.tsx`, `EstimatingWorkspace.tsx`, `types.ts`, `estimating.css`, `plans/PlanViewer.tsx`, `plans/PlansWorkspace.tsx`, `preconstruction/PcWorkspace/PcWorkspaceView.tsx` (two props passed to EstimatingWorkspace).
- **Tests:** frontend `tsc` is clean. The full `vitest run` gave 1,622 passed and 1 failed; the failure is PlanViewer's devicePixelRatio test, which passed twice when the file was run alone (load flake).

## MC fixture whips vs Chris (report only, nothing changed)
Our allowance is a flat 7.89 ft of 12/2 MC per counted fixture point. That ratio is pooled over all five BOMs, and the point count includes exit, emergency and exterior fixtures.

Chris's MC per lay-in / linear / downlight luminaire, by job:

| Job | Chris, ft per luminaire | Our replay MC | Chris MC | Our gap |
|---|---|---|---|---|
| Kissimmee | 13.49 (1,942.5 ÷ 144) | 1,452 LF (184 points × 7.89) | 1,942.5 LF | −25% |
| 36th | 13.02 (377.5 ÷ 29) | 316 LF (40 points × 7.89) | 377.5 LF | −16% |
| North Port | 10.22 | – | – | – |
| Orlando | 8.58 | – | – | – |
| Rockledge | 7.53 | – | – | – |

- The ~13 ft per fixture holds on 36th and Kissimmee only; the three older jobs run 7.5–10 ft.
- We count more points than Chris has luminaires (exit / emergency / exterior get whips too), but at about 60% of the length each.
- A per-luminaire ratio of about 13 ft, excluding exit / emergency / exterior, would match these two jobs. That is a calibration decision for Jake.

## Shared-file edits (backend)
- `estimating/mapper.ts` (circuit-list wording, alias-only units).
- `estimating/footageAllowance.ts` (feeder meta `estimate`, note rows skip countPoints).
- `estimating/footageAllowanceDb.ts` (pure core, feeder / site integration).
- `estimating/bidEstimate.ts` (pure cores, pre-mapping decisions, note / libraryCode / excluded / holdReason).
- `estimating/wiringScopes.ts` (an estimated feeder gives way to the estimator's own line; a vanished MEASURE line carried into an estimate is not a second estimator feeder).
- `estimating/pricing.ts` (holds).
- `estimating/reviewAnswers.ts` (`projectCountsOntoRows`, replay-only).
- `estimating/accubidBidData.ts`, `estimating/costLineDefaults.ts`, `routes/bids.ts`, `routes/settings.ts`, `routes/estimating.ts` (GET /feeders).
- `test/fixtures/realrun/*`: `live0930.ts`, `replay0930.ts`, `feeders0930.ts`, the SCRIPTED pins, the `replay36thB` run option.
- Not touched: `ai/countingStage.ts` and `ai/reviewItems.ts` (both R's).

## Tests
The full backend suite was run once: 2,819 passed, 6 failed, 1 skipped. All six are on the known-flake list (intakeSimilarCache ×2, integration lead-backfill), or are intakeSimilar.route ×2, which also fails on a clean d783568 checkout, or are restorePermission, which passes when run alone.

## Open items
- **After R merges:**
  - flip / confirm the site poles / heads gate;
  - re-run the gate so R's 3 poles / 4 heads flow into E1 / E2 / E4;
  - reconcile R's node normalizer with `feederNodes()`.
- **Live re-sync** of the two bids is for the main session with Jake. Kissimmee is `submitted`: it needs the calibration flag to show any stage-gated rows.
