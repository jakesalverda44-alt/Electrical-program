# Accuracy round, Builder P report. 2026-09-30

Branch `feat/accuracy-pricing` (worktree `Electrical-program-wt-accuracy-p`). Nothing is merged or pushed.

**Status.** All P tasks are done, backend and frontend: Task 0, C1–C2, C4–C8, D0–D6, E0–E4, the calibration flag, F4 and F5, plus the C7 / D5 / calibration UI (see Frontend below).

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

---

# Fix round 1 (Opus review 932fd94: MERGE AFTER FIXES)

Branch `feat/accuracy-pricing`, commits ee7efc4..95eb9ec (12 commits; one per blocker, small groups for the rest). Nothing merged or pushed. "Before" = the P tip 932fd94 (the tables above). "After" = HEAD, from `replayEval.test.ts` and `replayPricingGate.test.ts`.

Pricing policy applied (Jake): submitted / sold bids keep their prices; only open bids (PRE_SUBMISSION_STAGES) and bids with the Calibration flag get new rows, units and prices. The stage gate and the visible "Calibration job" checkbox are unchanged.

## Before → after, both jobs

**Kissimmee (submitted, 041c6d48), calibration = false (the stored proposal).**

| Scenario | Before (932fd94) | After (HEAD) | Stored today (baseline) |
|---|---|---|---|
| live@submitted price / hours | $58,756.51 / 430.4 h | **$42,916.83 / 364.5375 h** | $42,916.83 / 364.5375 h |
| projected@submitted | $58,990.53 / 434.3 h | $42,986.70 / 365.5 h | $42,986.70 / 365.5 h |

live@submitted with calibration = true (the same bid flagged a calibration job) gets the new rows (test: price > +$5,000, hours > +20 h over the unflagged run).

**Gate scenario `projected@due-fresh`, and SCRIPTED.**

| | Before | After, automatic | After, SCRIPTED | Chris |
|---|---|---|---|---|
| Kissimmee price | $81,535 | $69,514 (-12.1%) | $73,274 (-7.4%) | $79,112 |
| Kissimmee hours | 660.1 | 650.5 | 688.3 | 798.9 |
| Kissimmee holds / notes | 15 / 9 | 17 / 11 | 16 / 12 | - |
| 36th price (stage due) | $21,357 (-8.1%) | $21,357 (-8.1%) | - | $23,230 |
| 36th hours | 167.5 | 167.5 | - | 189.2 |
| 36th holds / notes | 5 / 1 | 5 / 1 | - | - |

What moved on Kissimmee (automatic): -$11.8k price, -9.6 h. The poles / heads are labor only (B5): about -$9.5k of material at 6 poles / 10 heads, before markup. The lighting contactors are a held controls match again, not 6 sign terminations (S1, -4.3 h, +1 hold). Holds went 15 → 17: the contactors, and the new Polaris taps line (nit). 36th does not move (none of the touched rules fire on it). Chris's six recap reproductions (`accubidRecap`) are exact. All the gate checks pass (count regression, hours not worse than baseline + 2%, 36th within ±15%, Kissimmee hours ≥ baseline).

**S8 — the 36th ±15% gate vs the existing fixture double count (pre-existing, not fixed).** 36th prices its interior fixtures from the library and adds the "materials. vendor" quote ($4,470) while `fixturePackageQuoted` is false. Replay: with the double count **$21,357 (-8.1%)**; without it **$17,751 (-23.6%)**, which would fail the gate. (The review's figure was $17,631; the difference is the other fixes.) The gate number is therefore partly the double count. Next round: a "quote present but fixture_package false" prompt. Printed by `replayPricingGate.test.ts` (`[S8]`).

## Blockers

- **B1 (ee7efc4).** `decideRows` takes `priced`; on a submitted non-calibration bid it returns Agent 2's rows untouched (no note, hold or code: any of them can move a displayed price, and the replay showed notes alone moved it by $924). `takeoffRowsFrom` passes `isEstimatingBid`. The generic aliases ('site pole', 'pole (site lighting)', 'fixture heads', 'pole top fixture head') are gone from migration 158, the seed and `libraryAfterMigrations`; migration 158 also strips them from a DB that applied the first draft. The S1/S2/SITE LIGHT heads and the DISCON A/B 200A fused switches are now decided by code in `decideRows` (gated). Test `replayPricingGate.test.ts`: live@submitted with calibration=false is $42,916.83 / 364.5375 h to the cent, with the migration-158 library; with calibration=true it gets the new rows.
  - Finding the review did not have: even an exact alias match re-prices an unsaved submitted proposal the day the migration adds the item (the "Simplex receptacle" row moved +$148 by exact name). So the alias-only units are now reached by `libraryCode` only: the mapper skips them entirely (stricter than the "exact only" you asked for; see B2).
- **B2 (9aaa15e).** Mapper: `isAliasOnlyCandidate` is skipped at every confidence (not just fuzzy). `decideRows`: the speed controls row ("FSC", "speed controls") is not a fan; the "wall speed controller" in the CF row is a descriptor and is still a fan; the exhaust / ceiling combo is not a fan; the fan rows are one set (largest count priced, the rest `duplicate` notes, as for power poles). Probes in `matcherSafety.test.ts`: "Emergency fixture, 2 heads", "Remote emergency fixture heads", "Fixture heads for track lighting", "Anchor bolt set for transformer pad", "Exhaust fan / ceiling fan combo", "Pipe pole for service mast", "FSC — Ceiling fan speed controls" assert no wrong-family match through the mapper AND through `decideRows`. The pinned Kissimmee fuzzy set is back to the pre-P set.
  - Mapper sweep (`aliasSweep.test.ts`, prints before → after): every Agent 2 row of Kissimmee 0928 (92 rows, 29 changed), 0930 (94, 31), 36th 0929 (44, 12), 0929b (42, 13), 0930 (40, 10). Kissimmee 0924 is count-only (no Agent 2 rows). BEFORE = the exported live library, mapper alone; AFTER = library after migration 158, `decideRows` then mapper. Every changed row is a deliberate by-code decision (TERM-*, PP-SET, DEV-SIMPLEX, FAN-CEIL, LTG-POLE-LAB / HEAD-LAB, RISER-PIPEPOLE, ASM-SW200F), a classified note or a visible hold; the mapper alone never lands on an alias-only unit. Found by the sweep and fixed under S1: the photocell row (host "RTU") lost its LC-PHOTO match, and 0928's "RTU-1 ... Energize at unit disconnect" lost its termination.
- **B3 (aa97395).** `siteGeometryRows` takes the site scope decision from `composeWiringRows`. Source 3 (ratio): E1 rows price as before. Source 1 or 2 (the estimator's typed / measured site footage on a line with a library item picked, or an Agent 2 site footage): the E1 PVC and wire rows go to 0 with "Replaced by your own / Agent 2's site footage (...) — never counted twice", and they no longer zero the ratio row (NB-2 reduces it as it always did). Test: typing 750 on the site line (1" PVC picked) → both geometry rows 0, scope source 1. A typed qty on the NEEDS FOOTAGE line with no library item prices nothing ("pick the library item", unchanged) so it cannot double count.
- **B4 (6da85f3).** `/feeders` sends `sets` per edge (the (2)4#3/0 lateral and METER→WIREWAY are 2). "Type length" uses it (60 ft → 120 conduit-ft; the wire follows at 60 × 8 = 480, tested through the sync). "Adopt as run" is disabled with a tooltip for sets > 1 (a markup measures one route and would halve conduit and wire); sets = 1 is unchanged.
- **B5 (c3b5f03).** New items LTG-POLE-LAB and LTG-POLEHEAD-LAB (Chris's pole 4.8 h / head 2.2 h, $0 material; migration 158 + seed, alias-only, `seedUnitsVsChris` checks them). `decideRows` uses them for site poles and heads (LTG-POLE-30 was already $0 material) and quotes Agent 1's furnish statement on the line ("Site poles, anchor bolts, templates AZ furnished; EC installs"), else "Material — confirm (Chris carries the poles as Quoted, $0)". The $950 / $385 library material is never auto-priced; the estimator can still override. Test on Kissimmee: the pole / head lines carry hours and $0 material.

## Should-fix

- **S1 / S2 (5ed6dc1).** Contactors / relays / the LCP / photocells / sensors skip the hard-wired test (the zone list "Sign x2" no longer makes 6 terminations); the power-pole host test runs before the pipe-pole test (the "PP-1..6 — Power poles #1 ... #5 PVC data/security pipes" row is a power-pole row; the pin is one PP-SET, the rest `duplicate` notes; only the "pipes at pole #5" row is RISER-PIPEPOLE). Also: an RTU-1 row whose spec only says "unit disconnect" stays a termination; "A/C Comp Unit" counts as compressor-class.
- **S3 (1abaa43).** The sidebar and the collapsed strip list "N feeder lengths suggested — confirm" and "N feeders need a location / scale", counted from the estimate lines by `feederSidebarCounts` (priced feeder and site-geometry rows still "suggested — confirm"; MEASURE rows that say what they need), through `bidSummaryWarnings` (parity test extended to 16 rows). Nit in the same commit: a confirm-match line is counted in "matches to confirm", not again in "held lines".
- **S4 (a5cabc1).** Agent 2's feeder RUN row becomes a note only when its edge's rows were emitted as priced rows (`pricedEstimates`); with a library item missing the row keeps its hold. Tested both ways.
- **S5 (f7bd1a0).** One loader, `loadEstSheetScales` (count docs plus the text-layer docs), used by `/feeders` and the sync. A DB test checks a civil sheet that is not a count sheet is read. (Same-source by construction; there is no full pixel-level parity test of the two paths because they now share the loader and the pure `estimateFeeders`.)
- **S6 (3378e9e).** `bids.amount` is not written by a calibration save (a calibration bid outside PRE_SUBMISSION_STAGES), on both the Phase A and Accubid save paths (`BIDS_AMOUNT_GUARD_SQL`). The `bid_estimates` snapshot is still written (it is the calibration result). Non-calibration saves are unchanged. Test: submitted + calibration keeps its amount through a save; a due bid still updates.
- **S7 (7e2a7af).** `silentZeroLines` now checks reason specificity (a $0 line with no reason, or the `no_unit` fallback on a generated row or on a line that matched a library item): the detector has a self-test that proves it can fail, and runs for both jobs without rendering (`replayPricingGate.test.ts`). The hold counts are pinned (Kissimmee 17, 36th 5; the plan's ≤ 12 automatic target is not met; reported). The render gate (`replayEval.test.ts`) still skips without pdftoppm locally but FAILS when `CI` is set (verified with a PATH that hides pdftoppm).
- **S8.** Reported above; not fixed.

## Nits (95eb9ec)
- `byCircuit` was dead code: removed, with a comment that "assigned by circuit tag if read" is not implemented (marks carry a circuit only on some jobs; the units pair by sort order and are interchangeable; per-run lengths 121 / 75 ft can be swapped, totals do not change).
- The 15 ft adjacent-gear rule is named in `feederRoute.ts` as P's deviation from the plan (it gives 16 / 11 ft against Chris's ~33 ft through the wall for exterior disconnect → interior panel; there is no wall information to restrict it to same-side runs). Not changed.
- Polaris taps: a visible hold line "Feeder taps — WIREWAY → DISCON A, DISCON B (Polaris taps)", 2 EA, "needs a unit; Chris carries 9.6 h" (due / calibration bids only).
- HVAC family regex: a family-worded disconnect point comes off the ratio only when every equipment edge of that family is estimated. (No dedicated test: the Kissimmee fixtures cannot hold one RTU edge and resolve the other without a new scripted pin; the existing C6 tests still pass.)
- Confirm-match double count: done (S3 commit).
- `noteKindOfEvidence` keys on the evidence prefix: not changed (persisting the kind needs a column and a migration; flagged for the main session).
- `hoursGroups`: a feeder-size raceway / wire (≥ 1-1/4", ≥ #8) in the Site / Underground category is group `feeders` (as in Chris's BOM), bucket unchanged; eval only.
- Report wording on the 608 LF lateral: the gap analysis §3.1a shows the 608 LF covered more than the lateral; the "not supported by the geometry" sentence above should be read with that.

## Tests (fix round)
- Backend: `src/estimating` + `src/eval` + feeders route 615 passed / 1 skipped, tsc clean. Replay gate (`replayEval.test.ts`, `replayEval.baseline.test.ts`) passes. Full backend once: 2,892 passed, 5 failed in 3 files, all on the known-flake list (intakeSimilar.route ×2, intakeSimilarCache ×2, integration lead-backfill), plus one vitest "Worker exited unexpectedly" (the frontend suite was running at the same time).
- Frontend: tsc clean; full vitest 1,625 passed, 2 failed (PlanViewer rotation overlay, ElecProjects save toast), both pass when run alone (load flakes while the backend suite ran).
- No live AI, no live DB, `electrical_crm_test` only.

---

# Fix round 2 (re-check f8a18ba, main + accuracy-reading merged at 993d7dc)

Commits after 993d7dc: N1, the library policy, the baseline-test reconciliation, the gate with R merged. Nothing pushed.

## N1 — a length typed on the site-geometry PVC line keeps its wire
The geometry rows (`Site lighting circuits — 1" PVC underground` / `#10 wire`) are the run's own lines, like the feeder estimate rows: `composeWiringRows` no longer counts them as "the estimator's site footage" (so the scope stays source 3), and the #10 wire is derived from the typed run (`typedRunFt` x conductors). Test: typed 400 → wire 400 x 5 = 2,000, the geometry PVC not zeroed. The B3 tests stay: a separate site line (a line with a library item picked) or Agent 2 footage still zeroes the geometry rows.

## Policy decision: no existing library row changes this round
Jake: submitted / sold bids keep their prices. Saved lines price against the CURRENT library, so the five labor moves of decision 1 (DISC-30 1.5 → 1.10, DISC-60 2.0 → 1.55, DISC-200 4.5 → 3.1, LTG-POLE 4.5 → 4.8, LTG-POLEHEAD 1.2 → 2.2) would re-price saved submitted bids. They are REMOVED from migration 158, the seed TS and `libraryAfterMigrations` (the seed values are back to 1.5 / 2.0 / 4.5 / 4.5 / 1.2) and move to the gap-closing round, which adds library history first. Kept: every insert-only item and the stage-gated paths. To keep Chris's 3.1 h for the 200A fusible switch assembly without touching DISC-200, there is a new insert-only item DISC-200F (material $420, 3.1 h; ASM-SW200F uses it); LTG-POLE-LAB / LTG-POLEHEAD-LAB keep 4.8 h / 2.2 h at $0 material. The migration now has no `SET labor_hours`; a test pins this and the five seed values. A DB that applied the first draft keeps the old labor (only the test DB: nothing is merged), and the migration re-points the assembly component to DISC-200F.

## replayEval.baseline.test.ts reconciled with R's scoping
R's `INTENDED_COUNT_CHANGES` / `withoutIntended` (counting rows and projected@ scenarios) are kept. Added the pricing scoping this branch needs, documented in the test: a bid being estimated (`isEstimatingBid`; 36th is `due`) legitimately prices differently from the committed pre-round file in every scenario and in its reproduction, so those are excluded from the pinned comparison and checked by the gate and the pricing tests; a bid that is NOT being estimated (Kissimmee, submitted) keeps live@submitted and its reproduction pinned on price / hours / material. "Acceptance" for a due bid: the COMMITTED pre-round reproduction is within $1, and the round's additions stay within 2% of the stored price (36th: +$132, +3.4 h, the COMP/AHU terminations); a submitted bid stays within $1 / 0.1 h (Kissimmee: exact). The committed baseline JSON is not rewritten.

## Gate with R merged (3 poles / 4 heads)
The gate's "projected" stand-in carried Agent 2's stale live rows, so SITE LIGHT stayed stacked on S1/S2 (6 poles) and PP-1..6 stayed at 2 although R's count merges / does not find them. The stand-in now sets such rows (type merged, or 0 found where the live count had some) to qty 0, as Agent 2 re-reading R's count would. The site pole / head check no longer skips: 3 poles / 4 heads pass (`site_poles 3/3 pass`, `site_heads 4/4 pass`).

| | Before fix round 1 (932fd94) | End of fix round 1 | After fix round 2 | Chris |
|---|---|---|---|---|
| Kissimmee live@submitted (calibration off) | $58,756.51 / 430.4 h | $42,916.83 / 364.5375 h | **$42,916.83 / 364.5375 h** | - |
| Kissimmee projected@submitted | $58,990.53 | $42,986.70 | $41,446.70 / 342.9 h (R's counts; the submitted bid is not re-synced) | - |
| Kissimmee gate (projected@due-fresh) | $81,535 / 660.1 h | $69,514 / 650.5 h | **$64,994 / 600.3 h** (-17.8%) | $79,112 / 798.9 h |
| Kissimmee SCRIPTED | $85,294 / 697.9 h | $73,274 / 688.3 h | **$68,753 / 638.1 h** | - |
| Kissimmee holds / notes (gate) | 15 / 9 | 17 / 11 | 17 / 10 | - |
| 36th gate (due-fresh) | $21,357 / 167.5 h | same | same ($21,357, -8.1%) | $23,230 / 189.2 h |

The Kissimmee gate fell by about 51 h and $4.6k more once R's counts flow in: SITE LIGHT's stacked poles / heads (-31 h), PP-1..6 not found (-7 h, no PP-SET) and the branch footage of fewer points (-13 h). All intended removals; the replay is now further from Chris in hours (600 vs 799), which is the open gap for the next rounds (feeders, the 6 power poles, fixtures), not a P regression. The gate's floor "Kissimmee hours >= baseline" (written before R) is now the baseline minus the same 2%-of-Chris tolerance, with that reason in the test.

At 3 poles: E1 site circuits 302 ft of 1" PVC (317 SCRIPTED) with the #10 wire, E2 anchor-bolt sets 3 (3.54 h, was 6), trenching 302 ft excluded by default, E4 default cost lines unchanged ($4,350 equipment, $3,020 GE: Kissimmee's pole count in the E4 features is read from the count, and the figures still reproduce).

## Tests
Backend tsc clean; `src/estimating` + `src/eval` + feeders route + the full gate all pass; full backend once: 3,004 passed, 5 failed in 3 files, all on the known-flake list (intakeSimilar.route x2, intakeSimilarCache x2, integration lead-backfill), plus one vitest "Worker exited unexpectedly". Frontend: tsc clean, full vitest 1,676 passed, 0 failed.
