# Remodel + Footage Round — Builder B report (pricing: B1–B5)

**Branch:** `feat/footage-allowance` (worktree `Electrical-program-wt-footage`), off main `7a69928`. Not pushed.
**Commits:** `85140da` B1 · `34df894` B2 · `1fcc613` B3 · `942f284` B4 · `bad4f57` B5 · `62b1cb4` test fix · `1737cb8` report v1 · then the coordinator's decisions: `fe60a5b` Q3 (prefer the ratio) · `86b3edd` Q5 (2025–26 fit) · `403689c` Q4 (typed footage prices conduit + wire) · this report update.
**Migrations:** 150 (demolition units + the footage-ratio setting), 151 (default cost lines). A owns 148–149.

## Results

| | Selling price | vs Chris's $23,230.14 | Labor hours (Chris: 189.21) |
|---|---|---|---|
| Before (the stored 2026-09-29 run, today's code) | $10,092.83 | −56.6% | 68.6 |
| After B1–B4 | $14,263.10 | −38.6% | 105.8 |
| After B1–B4 + Builder A's expected effect (estimate) | $18,245.48 | −21.5% | 125.4 |

These are the numbers after the coordinator's decisions (Q3/Q4/Q5). Only the Q5 cost-line defaults move them: equipment $890 / $915.15 and GE $270, where the first pass had $890 and $290. The first pass priced after B1–B4 at $14,283.10 and after A at $18,240.33.

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

- **Footage > 0.** Within a wiring scope (branch / feeder / site), the allowance expands into a complete conduit + wire set, or it isn't used (see the fix round). Outside those scopes (e.g. trenching) it is a priced line. Its category is kept (default: `Site / Underground / Allowances`) and its unit is LF. The evidence note reads "Agent 2 allowance, ESTIMATED: …" followed by Agent 2's note.
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

**v2 geometry** (updated per Q3: the ratio is preferred). v2 needs all three of:

- a CONFIRMED scale: calibrated, or a title-block scale the estimator accepted. `ft_per_pt` is only ever written by a confirm or calibration; the merely suggested scale lives in `suggested_ft_per_pt` and is never read.
- counted marks.
- a panel position: panel-type marks, or a confirmed count markup labelled "Panel …".

v2 estimates each circuit's homerun from the Manhattan distance to the panel plus the device-to-device chain, then adds `est_default_drop_ft` per device and `est_default_slack_pct`. It sets the qty only when it is within 40% of the ratio; sheets it doesn't cover stay on the ratio. Otherwise the qty stays at the ratio and the evidence reads "Plan-geometry estimate X ft … — check scale and panel position". It is never "use the larger". Tested on the real 36th run at an assumed 1/4" scale: geometry 3,456 ft vs ratio 541 → qty stays at 521 ft, flagged.

**Feeders.** A feeder whose size is on the plans but whose length isn't becomes 0-qty `MEASURE FEEDER` lines in **Feeders (allowance)**: one conduit line plus one line per conductor, each quoting the source text. Two cases are skipped:

- existing feeders that stay in place;
- a feeder Agent 2 already carries as an allowance (so the 36th HVAC feeder shows up once, via B1).

**Overrides survive re-syncs.** A typed qty (`qty_overridden`) survives every re-sync. A confirmed measured run (apply-markups) replaces the allowance, and its evidence note becomes "Measured on the plans (confirmed markups) — replaces the allowance …" (tested DB-backed).

**Typed footage on a NEEDS FOOTAGE line (Q4).** When a B1 `NEEDS FOOTAGE — …` line names its conduit and wiring (e.g. the 36th `HVAC feeders 3/4" 3#6 1#10G`) and the estimator types the run length, the line prices per foot: the conduit, plus each conductor × its count. Every part is resolved through the mapper, exact/alias matches only; if any part doesn't resolve, the line isn't priced at all rather than partially. A match the estimator picked by hand is left alone. This lives in `footageSpecPricing.ts`, called from `resolveLines`, so it applies on every save and price. Example: 100 ft → 100 ft 3/4" EMT + 300 ft #6 + 100 ft #10 = $183 / 6.52 h on seed prices.

**One source per wiring scope** (fix round, see below): the branch, feeder and site scopes each take their footage from exactly one source, so an Agent 2 footage, a typed footage and the ratio never add up to a double count. If the computation throws, the sync still completes and a visible 0-qty row reports the error.

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
**Updated per Q5: pricing defaults come from 2025–26 jobs only.** `pricingWindow()` keeps the 4 breakdowns dated 2025 or later: Kissimmee, Bubble Down, Gulf Simulator and James Co Seminole. That is at least 3, so there's no fallback; with fewer than 3 it would fall back to all 10 and say so. The fit uses net amounts (before tax) against Total Labor Hours (`costLineDefaults.ts`):

- **Equipment:** the larger of $890 (one Sunbelt scissor lift, a domain floor) and $7.30 per labor hour.
- **General expenses:** $270 up to 300 h (permits only), $2,500 above (permits plus temporary power and lighting).

**Leave-one-out on the 4 recent jobs** (weak: only 2 carried equipment, only 3 carried GE, and one small job is left):

| Job (hours) | Equip. actual | Equip. LOO | GE actual | GE LOO |
|---|---|---|---|---|
| Kissimmee (799) | $4,350 | $11,521 (+165%) | $3,770 | $1,220 (−68%) |
| Bubble Down (208) | $3,000 | $1,132 (−62%) | $0 | — |
| Gulf Simulator (324) | $0 | — | $1,220 | $3,770 (+209%) |
| Seminole (197) | $0 | — | $270 | $0 (−100%) |
| **MAE** | | **114%** | | **126%** |

For reference, the first pass fitted on all 10 breakdowns: $890 / $4.03 per h and $290 / $3,060, with MAE 32% / 28%. The breakdown table still carries the 2024 jobs.

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
- `Equipment — default` (max of $890 and $7.30/h; about $915 after A) and `General expenses — default` $270 appear, labelled as defaults.
- Total is about $18k at app defaults (−20 to −22%). Measuring the HVAC feeders and resolving the unmatched equipment connections should close most of the rest.

## Coordinator decisions (applied)
- **Q1:** APPROX with "ESTIMATED" in the evidence text is fine. No change.
- **Q3:** prefer the ratio; geometry only on a confirmed scale + panel position + within 40%, otherwise shown as "plan-geometry estimate X ft — check scale". Done (`fe60a5b`).
- **Q4:** typed footage on a NEEDS FOOTAGE feeder/HVAC line prices conduit + wire through the mapper. Done (`403689c`).
- **Q5:** fit on 2025–26 breakdowns only. Done (`86b3edd`). 4 jobs qualify, so no fallback.

## Left for a follow-up round
- **Q2, EMT accuracy.** Leave-one-out error is about ±35% on 5 jobs. The BOMs have no square footage, so job size can't be calibrated; the SF of those jobs, or more BOMs, would allow a size term.
- **Q6, the rest of the 36th gap:**
  - equipment connections that don't match the library (disconnects, AHU #1, exhaust fans) price at $0;
  - the seed wire and MC labor units differ from Chris's (3.5 vs 5.15 h/M wire; 2.5 vs 1.52 h/C MC);
  - box and fitting hours (about 25 h on 36th) have no lines in the seed library.
- **Equipment/GE fit.** The 2025–26 fit rests on 4 jobs; revisit it as more 2025–26 breakdowns come in.

## Tests (after the decisions)
- **Backend:** 2,461 passed, 4 failed.
  - Three are the known flakes: intakeSimilarCache ×2 and integration lead-backfill.
  - The fourth is `supplementPass` S7, an async timing test that passes 7/7 when run alone.
  - `notificationsRetention.test.ts` again ran out of memory in its worker; it touches nothing of mine.
- **Frontend:** 132 files, 1,355 tests, all passed.
- **Typecheck:** clean for both.

## Fix round (review `7bb9df9`: NOT READY → fixed)
Every repro in `2026-09-29-footage-allowance-review.md` is now a test. Each fix is its own commit, `7bb9df9..HEAD`.

**BL-1: defaults never touch existing, saved or submitted bids** (`3011c75`).
- Migration 151 (amended, still idempotent) marks every bid that already exists as "defaults handled" for both kinds.
- `syncDefaultCostLines` only acts on bids in stage `due`, the one pre-submission stage (`due | submitted | awarded | lost`). That covers seeding, follow-the-hours and placeholder removal.
- Tests:
  - the reviewer's repro: a submitted bid plus a $0 quote leaves `bids.amount` unchanged and gets no lines;
  - a default freezes once the bid is submitted;
  - the 151 backfill, run in a rolled-back transaction.

**BL-2 / BL-3 / BL-4: one source of truth per wiring scope** (`27dc36a`, new file `wiringScopes.ts`).

The scopes are branch (conduit + wire), fixture whips (MC), feeder (feeders / HVAC / service) and site (site lighting / poles / underground). MC is its own scope (coordinator follow-up): it is separate material Chris carries alongside the branch run, so branch footage never zeroes it. Only an estimator-entered MC line or an Agent 2 MC row replaces the MC allowance. Each takes its footage from exactly one source, in this order:

1. **The estimator.** Any LF line in the scope they added by hand, typed a qty on, or confirmed from markups. The ratio lines for that scope go to 0 with "Replaced by your entered/measured footage in this scope (…)". The same goes for Agent 2's footage rows in the scope. Typing on the branch or site NEEDS FOOTAGE line counts; the site NEEDS FOOTAGE line and the per-pole PVC line are the same scope.
2. **Agent 2.** Allowance rows with footage, or LF `takeoff[]` rows, in the scope. They are expanded into a complete conduit + wire set by the same spec parser as the typed NEEDS FOOTAGE pricing, and every part must map exactly (or by alias) in the library.
   - An Agent 2 MC row is a complete fixture-whip set by itself.
   - A set that can't be read completely never prices partially. It becomes a 0-qty NEEDS FOOTAGE line saying so, the ratio carries the scope, and the ratio lines note "not a complete conduit + wire set … check for double counting".
   - Separate Agent 2 conduit and wire rows count as complete only together.
3. **The ratio / geometry allowance.**

Also:
- A NEEDS FOOTAGE line without a complete, resolvable spec now stays visibly unresolved; it never fuzzy-matches one part. An empty-conduit run ("3/4" empty control conduit") counts as complete as conduit only.
- Low-voltage, control, grounding and trenching runs are in no scope.

Tests:
- **BL-2** (36th, pure recap): typing 670 ft on the branch NEEDS FOOTAGE line gives $14,052.29. The review's double count was $16,700.38. The price is above carrying the 670 ft as conduit alone. The ratio EMT, #12 and #10 are 0; the MC whips (213 ft) stay.
- **BL-3** (36th, pure recap): branch 670 ft + HVAC 100 ft from Agent 2 expand to:
  - branch: 1/2" EMT 670 + #12 1,340 + #10 670;
  - HVAC: 3/4" EMT 100 + #6 300 + #10 100.

  The ratio EMT/wire go to 0 and the MC stays. Total: $14,628.69. The review's conduit-only total was $13,368.27, and the new total is above the no-footage run.
- **BL-4** (DB): manual 3/4" EMT 670 LF + #12 3,660 LF, then a re-sync. The EMT/#12/#10 allowance lines are 0, with $0 / 0 h added. The MC whip allowance (237 ft) stays, since it is its own scope.
- **MC scope:** a manual 12/2 MC line, or an Agent 2 MC takeoff row, zeroes only the MC allowance, and the branch EMT stays.
- **Kissimmee site:** a typed "Site lighting underground conduit and wire to poles S1/S2" line turns the 390 ft per-pole PVC line to 0.
- An Agent 2 conduit-only row keeps the ratio active.

**Should-fixes:**
- **SF-1 demolition** (`e341dfe`). Demolition matching now keys on demo / demolish / remove / removal / "existing … to be removed" in the category *or* the text, for lines and items alike, and never pairs across. The demo items got bare-noun aliases, which are safe because only a demolition line ever sees them; migration 150 was amended. Tests:
  - "Demo existing 2x4 fluorescent fixtures" in "Demo / Removals" → DEMO-FLUOR24;
  - "Remove existing receptacle" → DEMO-RECEPT.
- **SF-2 v2 wire** (`85f7f83`). Accepted geometry uses the same conductor basis as the ratio (conduit × 5.54 × conductors/3). Homeruns are grouped per circuit, by the mark's circuit tag when present. Tests pin one homerun per circuit and the shared basis.
- **SF-3 measured EMT** (derivation in `27dc36a`, DB test `1b4f45c`). A measured or entered EMT allowance run sets #12/#10 = run × 5.54, split 53/47, with the math as evidence.
- **SF-4 settings** (`7656310`).
  - `PUT /api/settings` returns 400 for a malformed, non-string, negative or out-of-range `est_footage_ratios` / `est_cost_line_defaults`, and stores nothing.
  - The Allowances panel flags blank, negative or >100% fields inline and blocks the save.
  - "Saved" only ever follows a successful PUT (tested, including a server 400).
- **SF-5 calibration** (`7f4ed16`). The calibration report prices lines without the allowance lines: the ratio and feeder-measure lines, and Agent 2 allowance rows.
- **SF-6 report.** The duplicated B1/B2 sections and the contradictory v2 paragraph are gone (this commit).

**36th Street replay after the fix round** (full Accubid recap, app defaults; pinned in `thirtySixthStreetReplay.test.ts`):

| Scenario | Price | vs $23,230.14 |
|---|---|---|
| Before | $10,092.83 | −56.6% |
| After B1–B4 | $14,263.10 | −38.6% |
| After B1–B4 + A's expected effect | $18,245.48 | −21.5% |
| BL-2: estimator types 670 ft on the branch NEEDS FOOTAGE line (MC kept) | $14,052.29 | −39.5% |
| BL-3: Agent 2 reads branch 670 ft + HVAC 100 ft | $14,628.69 | −37.0% |

The BL-2 row stays $210.81 below the plain after-B1–B4 price, even with the MC kept. The typed 670 ft of 1/2" EMT + 2,010 conductor-ft (2#12 1#10G) carries less than the ratio's 521 ft of 3/4" EMT + 2,889 conductor-ft. The estimator's typed run is now the only branch source, which is the intended behavior.

The first three rows are unchanged from before the fix round. On the stored run no scope has a user or Agent 2 source, so the ratio carries everything, exactly as before.

- **Test DB only:** I refreshed the seeded `est_cost_line_defaults` value earlier for Q5. The already-applied DEMO rows there keep their old aliases, because rows referenced by existing test lines can't be re-seeded. No DB test depends on the aliases.

**Tests after the fix round:**
- **Backend** (full suite, electrical_crm_test): 2,479 passed and 3 failed, all known flakes (intakeSimilarCache ×2, integration lead-backfill). `notificationsRetention.test.ts` again ran out of memory in its worker; it imports nothing of B's.
- **Frontend:** 1,356 passed and 1 failed. The failure is `SurveyMarkupEditor` (gen-pipeline, untouched by B), a timing flake that passes when run alone.
- **Typecheck:** clean on both.
- **Chris's recap reproductions** pass unchanged.


## Re-check fix round (addendum `9982606`: NOT READY → fixed)
Every repro in the addendum is now a test. Each fix is its own commit, `9982606..HEAD`.

**Migrations** (`ce7c372`).
- 150 and 151 are restored to exactly what `1fcc613` / `942f284` first committed.
- Every later amendment now lives in a new, idempotent `152_footage_round_fixes.sql`:
  - the demolition bare-noun aliases, added only to untouched `source='seed'` rows and only when missing;
  - the Q5 cost rule, moved from the untouched 151 seed value to the 2025–26 fit, and never over an edited value;
  - the BL-1 `est_bid_cost_line_seeds` backfill for every existing bid (`ON CONFLICT DO NOTHING`).
- Verified on `electrical_crm_test`, which ran the old 150/151 at 20:21 / 20:26. 152 applied cleanly and marked 61,088 bids. Its DEMO-* rows there are `source='manual'`, so they are correctly left alone.
- Tests run 152 twice in a rolled-back transaction, and assert that 152's cost-rule `from` equals the old 151 seed and its `to` equals the current default.

**NSF-1: demolition** (`4882a81`).
- "Relocate", "reinstall", "replace", "remove and reinstall" and "Demonstration …" are never demolition, so they stay install lines.
- The line's text must *start* with demo / demolish / remove, or say "existing … to be removed". The category may say Demo / Removals anywhere.
- A demolition line maps only to a demolition unit of its own device class (j-box / receptacle / switch / 3-way / exit-em / HID / fixture). No class means no match: the line stays unresolved for the estimator, never a fuzzy cross-class match.
- A's real row shape still maps 6/6.

**NB-2 / NSF-2 / NSF-4: scopes and subtraction** (`295098a`).
- A line joins a wiring scope only if it names power wiring material or says branch/feeder. Power wiring material means EMT / PVC / MC / RMC / IMC / conduit, or a THHN / #size conductor.
- It never joins one when it is a signal, low-voltage, control or ground run. The full list: telecom, data, Cat5/6, CCTV, camera, security, intercom, speaker, paging, A/V, TV, doorbell, nurse call, BAS/BMS/EMS, thermostat, 0-10V, dimming control, fire alarm, low voltage, control, grounding, bonding, GEC.
- So "Single pole switch" gets no scope, the GECs get no scope, and "#8 THHN branch" is branch.
- **The estimator's footage is subtracted, never zeroed:**
  - conduit-ft comes off the EMT (or site PVC);
  - conductor-ft comes off #12/#10, by share;
  - MC-ft comes off MC.

  Each floors at 0, with the arithmetic in the evidence ("Reduced by your entered/measured footage … 521 − 670 = 0 ft").
- A typed NEEDS FOOTAGE line with no resolvable spec and no picked item takes nothing off. The ratio lines say "pick the library item; the allowance is unchanged until then".

**NB-1: overrides on Agent 2 runs** (`7aec7c3`).
- Split parts keep stable keys: the original takeoff key + the part.
- An override on the run's original row, or on any part, drives every part: conduit = run, wire = run × conductors. The order is the original row first, then the conduit part, then a wire part ÷ its count.
- Driven parts are written as the estimator's own qty (`qty_overridden`, `qty_source` manual/markup), so they hold after the original line vanishes.
- An excluded line never counts, and a run's own lines never count as the scope's generic footage.
- DB test: the review's 500 → 650 two-sync repro keeps 650 / 1,300 / 650 on both syncs, and the price is stable.

**NB-3: feeders per run** (`2f6433c`).
- A feeder is identified by the panels or equipment it serves (Panel B, DISCON A, RTU-1, METER …), or else by its spec.
- Entered or measured footage on one feeder replaces only Agent 2's footage for **that** feeder.
- A typed or measured conduit run on a MEASURE FEEDER line drives only that feeder's wire lines (run × conductors).
- Parallel sets now parse correctly: `(2)4#3/0` → 8#3/0.
- Tests:
  - the review's repro: typing 80 ft on Panel B leaves Agent 2's HVAC feeder at 100 / 300 / 100;
  - a same-feeder line replaces only that feeder;
  - Kissimmee's 3 feeder groups (DISCON A/B, METER, RTU-1/2) stay separate.

**36th Street replay after the re-check fix round** (full Accubid recap, app defaults, pinned in `thirtySixthStreetReplay.test.ts`):

| Scenario | Price | vs $23,230.14 |
|---|---|---|
| Before | $10,092.83 | −56.6% |
| After B1–B4 | $14,263.10 | −38.6% |
| After B1–B4 + A's expected effect | $18,245.48 | −21.5% |
| BL-2: estimator types 670 ft on the branch NEEDS FOOTAGE line (subtracted, MC kept) | $14,363.98 | −38.2% |
| BL-3: Agent 2 reads branch 670 ft + HVAC 100 ft | $14,628.69 | −37.0% |
| NB-2: manual 40 ft "1" EMT telecom" | allowance unchanged: $14,263.10 before the telecom line's own price | (the review: −$2,539.95) |
| NB-2: manual 20 ft extra 3/4" EMT | within $5 of $14,263.10 (your 20 ft in, 20 ft of allowance out) | |

BL-2 is now **above** the plain after-B1–B4 price. The typed 670 ft takes the 521 ft ratio EMT to 0 and 2,010 of the 2,889 ratio conductor-ft off, and the remaining 879 conductor-ft stay.

**Tests after the re-check fix round:**
- **Backend** (full suite, electrical_crm_test): 2,489 passed and 5 failed.
  - Three are the known flakes: intakeSimilarCache ×2 and integration lead-backfill.
  - `jobProfileRoutes` failed with an `ECONNRESET` under load and passes when run alone.
  - `estimatingLibrary` "editing a SEEDED item" fails on the test DB's state: no `source='seed'` items are left there. The review's integration run attributes this to neither branch.
  - `notificationsRetention` ran out of memory in its worker again.
- **Typecheck:** clean for backend and frontend. The frontend is unchanged this round.
