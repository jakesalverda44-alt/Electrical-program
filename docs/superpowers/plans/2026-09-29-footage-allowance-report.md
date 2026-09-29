# Remodel + Footage Round — Builder B report (pricing: B1–B5)

**Branch:** `feat/footage-allowance` (worktree `Electrical-program-wt-footage`), off main `7a69928`. Not pushed.
**Commits:** `85140da` B1 · `34df894` B2 · `1fcc613` B3 · `942f284` B4 · `bad4f57` B5 · then a test fix and this report.
**Migrations:** 150 (demolition units + the footage-ratio setting), 151 (default cost lines). A owns 148–149.

## Results

| | Selling price | vs Chris's $23,230.14 | Labor hours (Chris: 189.21) |
|---|---|---|---|
| Before (the stored 2026-09-29 run, today's code) | $10,092.83 | −56.6% | 68.6 |
| After B1–B4 | $14,283.10 | −38.5% | 105.8 |
| After B1–B4 + Builder A's expected effect (estimate) | $18,240.33 | −21.5% | 125.4 |

All three rows are the full Accubid recap at the app's defaults: 1 journeyman at $37 plus 2 apprentices at $27, 4% burden, $1.50 fringe, 38% labor overhead, 20%/20% markup and 0% tax. The library is the seed library. The numbers are pinned in `thirtySixthStreetReplay.test.ts`.

- **Before matches the live run's ~$10k.** That confirms the replay reproduces what the live run produced.
- **"After A" is my estimate, not a measurement.** I applied A's fixes by hand to the same takeoff rows: the 13 type-H high bays are named, only the new receptacles are counted (5 duplex + 2 GFCI), and Chris's demolition quantities are added as Demolition lines. The live re-run is the real test of A.
- **The ±20% target is missed by 1.5 points.** What is still missing:
  - **Feeders.** They are 0-qty MEASURE lines until someone measures them. Chris carried 400 ft of "EMT & Wire" (10.5 h).
  - **Equipment connections.** The 3 disconnects, AHU #1 and the F1 exhaust fan don't match any library item, so they price at $0 / 0 h. That is a mapper/library gap, outside B's scope.
  - **Boxes and fittings.** Chris carries about 25 h of connectors, straps, clips, anchors and boxes. The seed library has no separate lines for them.
  - **Seed labor units.** They differ from Chris's: wire is 3.5 h/M in the seed vs his 5.15; MC is 2.5 h/C vs his 1.52.
- **The settings are not Chris's either.** His 2024 breakdown used 70% OH, 15%/15% markup, 7% tax, a 1% sales markup and a 1+1 crew. So these prices compare our defaults against his submitted number.

## B1 — Agent 2 allowances are no longer dropped
`footageAllowanceDb.ts`: `parseAgent2Allowances` and `allowanceRows`. `bidEstimate.ts`'s `getCurrentTakeoffRows` adds them to the takeoff rows.

- **Footage > 0.** The allowance becomes a priced line. Its category is kept (default: `Site / Underground / Allowances`) and its unit is LF. The evidence note reads "Agent 2 allowance, ESTIMATED: …" followed by Agent 2's note.
- **Footage = 0.** The allowance becomes a visible 0-qty `NEEDS FOOTAGE — …` line with Agent 2's note.
- **The line's key never carries the footage.** So a typed qty (`qty_overridden`) and the estimator's own reason both survive a re-run that finds a length.
- **Confidence is APPROX, not ESTIMATED.** `est_bid_lines.confidence` only allows FIRM/APPROX/VERIFY, so the word ESTIMATED is in the evidence text instead (see Q1).
- **Tests.** `allowanceRows.test.ts` uses the real 36th Agent 2 allowances (all three are footage 0). `estimatingAllowanceLines.test.ts` is DB-backed.

## B2 — Footage allowance for every analysis
**Files:** `footageCalibration.ts` (fit + leave-one-out), `footageAllowance.ts` (pure), `footageAllowanceDb.ts` (inputs). The ratios are stored in `app_settings.est_footage_ratios`, seeded by migration 150 and editable under **Settings > Labor Library > Allowances**.

### Calibration on Chris's 5 BOMs
Each BOM qty is raw feet or a raw count; the unit letter is only the pricing divisor.

- **Points** are counted with the same classifier the live takeoff uses. Demolition rows, wallplates, lamps and motor terminations are excluded.
- **Footage columns:**
  - EMT: 1" and under.
  - Wire: #12 + #10 THHN, including grounds.
  - MC: 12/2 + 12/3.
  - Site PVC: 1" and under.

| Job | Fixtures | Devices | Equipment | Poles | EMT ft | Wire ft | MC ft | EMT ft/point (actual) |
|---|---|---|---|---|---|---|---|---|
| 36th Street | 39 | 24 | 0 | 0 | 670 | 3,663 | 377.5 | 10.6 |
| Kissimmee | 179 | 39 | 15 | 3 | 1,605 | 10,873 | 1,942.5 | 6.9 |
| North Port | 515 | 127 | 38 | 8 | 3,285 | 16,685 | 4,200 | 4.8 |
| Orlando Clubhouse | 146 | 89 | 7 | 0 | 1,300 | 9,991 | 1,072.5 | 5.4 |
| Rockledge | 334 | 75 | 28 | 0 | 4,066 | 19,370 | 1,980 | 9.3 |

**Fitted ratios:**

- **EMT: 6.60 ft per point.** I pooled fixtures, devices and equipment. Separate per-kind non-negative least-squares ratios did worse on leave-one-out (50% vs 35%): with only 5 jobs they overfit.
- **Wire: 5.54 conductor-ft per conduit-ft** at 3-wire circuits, 47% of it as #10. When the panel circuit wiring names a different conductor count (e.g. 3#12 + 1#12G), the multiplier scales with it.
- **MC: 7.89 ft per fixture.**
- **Site PVC: 130 ft per pole.** Only 2 jobs have poles, so this is low confidence.

**Leave-one-out:** refit on 4 jobs, predict the 5th. Wire is predicted end to end (counts → EMT → wire).

| Held out | EMT error | Wire error | MC error |
|---|---|---|---|
| 36th Street | −39% | −39% | −19% |
| Kissimmee | −5% | −25% | −32% |
| North Port | +62% | +83% | −6% |
| Orlando Clubhouse | +27% | −13% | +8% |
| Rockledge | −39% | −24% | +46% |
| **Mean abs.** | **35%** | **37%** | **22%** |

Site PVC leave-one-out: Kissimmee −66%, North Port +194%.

Small jobs run long per point (36th is 10.6 ft/point), but an intercept model did worse on North Port. I couldn't use job size (SF) because none of the 5 BOMs carries it (see Q2). `footageCalibration.test.ts` re-derives every number above from the fixtures and fails if the seeded defaults drift from them.

### What a bid gets
Lines are added in **Branch Wiring (allowance)**, each mapped to a real library item:

- 3/4" EMT
- #12 THHN
- #10 THHN
- 12/2 MC
- 1" PVC, only when the job has poles

The evidence note on each line shows the math. On the 36th run the EMT line reads: *"Method v1 (ratio). 79 points (27 fixtures, 41 devices, 11 equipment connections) × 6.6 ft EMT per point (calibrated on 5 of Chris's jobs; leave-one-out error ±35%) = 521 ft."*

**Remodel jobs.** Rows marked existing or demo are skipped once A's `status` field lands (tested). Demolition-category rows never count as points. Until A merges, every device counts.

**v2 geometry.** v2 runs on sheets that meet all three conditions:

- a confirmed or title-block scale (a suggested-only scale doesn't count);
- counted marks;
- a panel position: panel-type marks, or a confirmed count markup labelled "Panel …".

v2 estimates each circuit's homerun from the Manhattan distance to the panel plus the device-to-device chain. Marks tagged with a circuit are grouped by it; untagged marks are chained 8 at a time. It then adds `est_default_drop_ft` per device and `est_default_slack_pct`. v2 is used unless it and v1 disagree by more than 40%; then the larger is used and flagged. The line always names its method, and sheets v2 doesn't cover are priced by v1.

**Feeders.** A feeder whose size is on the plans but whose length isn't becomes 0-qty `MEASURE FEEDER` lines in **Feeders (allowance)**: one conduit line plus one line per conductor, each quoting the source text. Two cases are skipped:

- existing feeders that stay in place;
- a feeder Agent 2 already carries as an allowance (so the 36th HVAC feeder shows up once, via B1).

**Overrides survive re-syncs.** A typed qty (`qty_overridden`) survives every re-sync. A confirmed measured run (apply-markups) replaces the allowance, and its evidence note becomes "Measured on the plans (confirmed markups) — replaces the allowance …" (tested DB-backed).

If Agent 2 already read branch footage off the plans, the ratio lines drop to 0 with a note, so nothing is counted twice. If the computation throws, the sync still completes and a visible 0-qty row reports the error.

## B3 — Demolition pricing
- **Seed items** (`DEMOLITION_ITEMS`, category `Demolition`, $0 material, migration 150) use Chris's 36th BOM rates:

  | Item | Chris's rate | Stored per EA |
  |---|---|---|
  | Fluorescent fixture up to 2x4 | 0.31 h/E | 0.31 |
  | HID high bay | 0.58 h/E | 0.58 |
  | Exit/emergency light | 0.50 h/E | 0.50 |
  | Junction box | 0.24 h/E | 0.24 |
  | Receptacle | 13.2 h/C | 0.132 |
  | 1-pole switch | 12.8 h/C | 0.128 |
  | 3-way switch | 15.5 h/C | 0.155 |

  The per-C rates are stored per EA because the mapper never pairs an EA takeoff line with a C item.
- **`mapper.ts` rule:** a demolition line (category or text starting with "Demolition") only matches demolition items, and a new-work line never matches one.
- **Check:** Chris's 36th demolition prices to exactly his 21.734 h (`demolitionPricing.test.ts`).

## B4 — Equipment & general expenses defaults
The rule was fitted to Chris's 10 breakdown PDFs, using net amounts (before tax) against Total Labor Hours (`costLineDefaults.ts`):

- **Equipment:** the larger of $890 (one Sunbelt scissor lift, a real line item on 36th, North Port and Rockledge) and $4.03 per labor hour.
- **General expenses:** $290 up to 300 h (permits only). Above that, a flat $3,060 (permits plus temporary power and lighting), because it doesn't grow with hours.

| Job (hours) | Equip. actual | Equip. LOO | GE actual | GE LOO |
|---|---|---|---|---|
| 36th (189) | $890 | $890 (0%) | $310 | $270 (−13%) |
| 7-11 Fort Myers (1,421) | $7,170 | $5,442 (−24%) | $2,490 | $3,060 (+23%) |
| Kissimmee (799) | $4,350 | $3,100 (−29%) | $3,770 | $3,060 (−19%) |
| Bubble Down (208) | $3,000 | $890 (−70%) | $0 | — |
| Gulf Simulator (324) | $0 | — | $1,220 | $3,060 (+151%) |
| Seminole (197) | $0 | — | $270 | $310 (+15%) |
| North Port (1,841) | $7,060 | $7,513 (+6%) | $3,310 | $3,060 (−8%) |
| Orlando (607) | $1,860 | $2,487 (+34%) | $3,060 | $3,060 (0%) |
| Rockledge (1,394) | $4,390 | $5,853 (+33%) | $3,060 | $3,060 (0%) |
| Big Dans (2,219) | $6,230 | $9,874 (+58%) | $0 | — |
| **MAE** | | **32%** | | **28%** |

**How the defaults behave** (migration 151 adds `auto_default` and `est_bid_cost_line_seeds`; seeding happens in `saveAccubidRecapForBid`):

- An Accubid-mode bid with labor hours and no line of that kind gets `Equipment — default` / `General expenses — default`.
- An untouched default follows the hours.
- An edit makes it the estimator's line for good.
- A deleted default is never re-seeded.
- A line the estimator adds replaces the untouched default.

The rule is editable under Settings > Labor Library > Allowances. Amounts can be edited in place in the pricing panel, and seeded lines are labelled there.

## B5 — Answer key + replay
- **Answer key:** `backend/eval/36th-street-warehouse.expected.json`, using type tags from the run.
  - A=14 and B=2 pass.
  - H=13 is disputed until A2.
  - `$`+`$3`=16 (the run has 15).
  - Duplex new 5 (`DUPLEX RECEPTACLE`+`42`) and GFCI new 2 (`GFI`+`WP`) fail on purpose until A1 (the run has 17 and 9).
  - The demolition items are disputed.
  - The file also carries footage reference items (670 / 3,663 / 377.5, not counted) and `reference_estimate`: $23,230.14, 189.21 h, $3,399.32 material, $4,466.72 quotes, $890 equipment, $310 GE. Chris's 4/9 breakdown printed $22,553.54; both numbers are recorded.
- **Replay:** `thirtySixthStreetReplay.test.ts` produces the table at the top of this report.

## Tests
- **Backend** (`vitest`, electrical_crm_test): 2,456 passed and 3 failed, all known flakes (intakeSimilarCache ×2, integration lead-backfill).
- **One more file didn't run:** `notificationsRetention.test.ts` ran out of memory in its worker. It also does that alone, and it imports only the notifications engine and `utils/audit`, nothing I touched. It looks like test-DB growth: its own header notes thousands of accumulated owner users.
- **Frontend:** 132 files, 1,355 tests, all passed.
- **Typecheck:** clean for both.
- **Chris's pricing reproductions** (`accubidRecap.test.ts`, all six jobs to the cent) are untouched and pass.

## Files outside B's own new ones (all edits kept small and additive)
- `backend/src/estimating/bidEstimate.ts`
  - `RawTakeoffRow.evidence`.
  - `getCurrentTakeoffRows` adds the generated rows.
  - Sync and proposed-lines code write `evidence_note`.
- `backend/src/estimating/mapper.ts`: the demolition-only matching rule (6 lines).
- `backend/src/estimating/seed/laborUnits.ts`: `DEMOLITION_ITEMS`.
- `backend/src/estimating/accubidBidData.ts`
  - `CostLineRow.autoDefault`.
  - Editing a cost line clears `auto_default`.
  - The default sync call in `saveAccubidRecapForBid`.
- `backend/src/routes/settings.ts`: two new allowed keys.
- Frontend
  - `LaborLibrarySection.tsx`: new "Allowances" sub-tab.
  - `useAppSettings.ts`: 2 optional keys.
  - `AccubidPricingPanel.tsx` + `types.ts`: default label and in-place amount edit.
- Tests adjusted for the new generated lines:
  - `estimatingBid.test.ts` and `rerunReset.test.ts` now count only the takeoff's own lines, since every sync now also adds allowance lines.
- I did not touch A's areas: counter prompt/status, countTargets, reviewItems, legend collapsing, unscheduled tags.

## What the live 36th re-run should show (B's side)
- Labor & Pricing has **Branch Wiring (allowance)** lines: EMT ≈ 6.6 × (new fixtures + devices + equipment connections), #12/#10 wire, 12/2 MC. Each has the math in its evidence note. After A, expect about 480–500 ft EMT, against Chris's 670.
- The three Agent 2 allowances appear as 0-qty `NEEDS FOOTAGE` lines.
- Demolition lines from A price at Chris's rates, $0 material.
- `Equipment — default` $890 and `General expenses — default` $290 appear, labelled as defaults.
- Total is about $18k at app defaults (−20 to −22%). Measuring the HVAC feeders and resolving the unmatched equipment connections should close most of the rest.

## Open questions for Jake
1. **Confidence "ESTIMATED".** `est_bid_lines` allows only FIRM/APPROX/VERIFY, so allowance lines are APPROX, with "ESTIMATED" in the evidence text. Is that OK, or should the constraint and UI get a fourth value?
2. **EMT accuracy.** Leave-one-out error is about ±35% on 5 jobs. The BOMs don't carry square footage, so job size can't be calibrated. The SF of the other four jobs, or more BOMs, would let a size term be tested.
3. **v2 "use the larger" policy.** With an assumed 1/4" scale on the 36th sheets, v2 comes out around 3,456 ft against v1's 541: per-circuit homeruns plus a 10 ft drop per device. So a wrong scale or panel pin inflates the price, although it is flagged. Keep "larger", or prefer v1 and just flag?
4. **Feeders.** The MEASURE lines ask for conductor-ft = run × N by hand; the Measure tool fills only the conduit line. Also, the 36th HVAC `NEEDS FOOTAGE` allowance row doesn't auto-map to a library item. Once footage is typed, the estimator has to resolve the match or it prices $0. Should typing footage auto-price conduit + wire?
5. **Equipment/GE fit window.** The rule is fitted on all 10 breakdowns (2024–2026). A 2025–26-only fit would be $7.30/h equipment and $270 / $2,500 GE, but from few jobs, two of which carried $0. Your pricing rule says "% from 2025–26 only". Does that apply to these dollar defaults too?
6. **Remaining 36th gap.** Should I, or a follow-up, tackle the unmatched equipment connections (disconnects, AHU, exhaust fans), the seed wire/MC labor units vs Chris's, and box/fitting hours? They're outside B's scope.
