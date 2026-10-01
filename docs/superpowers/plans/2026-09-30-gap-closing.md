# Plan: gap-closing round (CRM vs Chris). Planned 2026-09-30, read-only

**For Jake (plain summary, 114 words):**
This round closes most of what still separates the CRM from Chris on Kissimmee and 36th Street.
- **Fixtures and panels AutoZone furnishes:** priced as labor only, with the spec quote shown on the line.
- **Vendor quotes:** when a quote may already cover the fixtures, the CRM asks you instead of counting the fixtures twice.
- **Service and site wiring:** feeders go through the wall and over the top, the wireway taps get priced, the service-gear holds get Chris's units, and each site pole gets its own homerun.
- **Receptacles:** the doubled raceway is removed, only if you approve.
- **Labor units and prices:** proposed from Chris's BOMs. Each one waits for your yes.

Submitted bids keep their prices: a dated library history prices them as they were when submitted. Thirteen questions for Chris decide the rest.

---

**Status:** planned, nothing built. **Execution:** Opus builds (this is accuracy-critical), Sonnet does the fix rounds, Opus reviews.
**Worktree / branch:** `../Electrical-program-wt-gap-closing`, branch `feat/gap-closing`. No dev servers, no push, no DB writes outside `electrical_crm_test`, no live AI calls in tests. Commits end with the session's attribution lines.

**Depends on (builds after these merge):**
- `feat/accuracy-reading` (R: A = site poles 6→3 / heads 10→4; B = power-pole hosts 2→6; C3 = locate[]);
- `feat/accuracy-pricing` (P) **plus the P fix round** (B1–B5, S1–S8). This round does not redo any of them.

**Runs in parallel with** fewer-questions. That round owns `ai/reviewItems.ts`, `estimating/takeoffReview.ts`, `bidstd/tradeAssignment.ts`, `routes/preconstruction.ts` and the review UI. **This round edits none of them.**

**Stage rule (Jake, 23:35, supersedes 23:25):** submitted or sold bids keep their prices. New rows, units and prices apply only to `isEstimatingBid` bids (a pre-submission stage, or the Calibration flag).
- **The existing gate is not enough.** Saved lines store no unit costs: `resolveLines` (`bidEstimate.ts:~420`) reads `est_items.labor_hours` / `material_cost` live.
- So every seed or price migration (156 and 158 included) already re-prices submitted bids, saved or not.
- Task 1 fixes that before any library change in this round.

**Migrations:**
- Taken: 158–160 (P), 161 (main), 162 (fewer-questions' optional index), 163 (learning L2).
- **This round: 164–168**, split so Jake can approve each one on its own. The builder confirms with `ls database/migrations | tail` at build time.
- 164: schema (library history, quote decided-flag).
- 165: new Chris-unit items (insert-only).
- 166: approved seed-unit moves.
- 167: approved price refresh.
- 168: settings (MC basis, OxBlue GE rule, receptacle device-only flag).

---

## Decisions for Jake (each with the recommended default)

| # | Decision | Recommended default | Why |
|---|---|---|---|
| J1 | Owner-furnished lines carry **labor only** when every source that names who furnishes agrees on Owner/Vendor. Kissimmee lighting and panels: both conflict options say "furnished by the Owner"; only *install* is disputed. | **Yes.** Disputed furnish (disconnects: rule APT vs E-4 "AUTOZONE PROVIDED"; power poles: spec AZ vs E-2 "GC TO FURNISH") stays **priced**, with a visible "furnish disputed" flag | Chris priced both of the disputed items; he carries fixtures and panels at $0 |
| J2 | Ask "Is this quote the fixture package?" when a bid has a non-flagged quote and the fixture lines still carry library material | **Yes.** Shown as a pricing warning plus an inline prompt. Never auto-flagged | 36th double count, $3,005 |
| J3 | Exterior disconnect → interior panel routes **up and over** (no 15 ft adjacent-gear shortcut when one end is Exterior/3R and the other interior) | **Yes** (Q2 confirms) | Chris ≈ 33 ft per feeder |
| J4 | Underground PVC labor adjustment (Chris +25% on Kissimmee, +5% Orlando, 0 on North Port and Rockledge) | **Setting exists, default 0%.** Wait for Q12 | Not consistent across his BOMs |
| J5 | `THHN-3_0` 16.5 → **18.8**/M; `THHN-6` 7.0 → **8.9**/M | **Yes** | Chris's units on every BOM |
| J6 | `PNL-225` 8.0 → **3.6** h (surface) / **4.5** (flush, new item) | **Yes: 3.6, plus a 4.5 flush twin chosen by "flush" text.** Q8 confirms flush | −8.8 h K |
| J7 | Fixture units: `LTG-STRIP4` 0.65→**0.75**; `LTG-DOWN` 0.6→**0.9**; `LTG-EXIT` 0.6→**0.55**; `LTG-TROF24` 0.75→**0.70**; `LTG-TROF22` 0.7→**0.60**; wall mount by wattage (new **≤175 W 1.1 h** and **≤250 W 1.6 h** items; DSXW1 wall packs → ≤250 W) | **Yes for strip, downlight, exit, troffers.** Wall-mount tiers yes, pending Q11 | Chris's catalog units. 36th troffers go *down* 0.9 h, shown honestly |
| J8 | Device units: `DEV-DUP` 0.35→**0.23** (0.20 + plate 0.03); `DEV-GFCI` 0.40→**0.28**; toggles 0.30→**0.17–0.21** + plate | **Yes for duplex and GFCI; toggles too** | −3.3 h K, −1.6 h 36th |
| J9 | **Receptacle device-only:** when the footage allowance carries the branch wiring, receptacles map to the device item (with its box back in the box allowance), not `ASM-DUPLEX/GFCI/WPGFCI`. Earlier Jake said "measure only" (D6) | **Yes, behind setting `est_receptacle_device_only` = true**, landing in the same merge as Tasks 4–6 | −27 h K, a measured double count. Lowers hours; the gate is adjusted for it |
| J10 | MC whips: basis → **interior luminaires** (excluding exit / EM / exterior / poles). Ratio choice: (a) pooled per-luminaire fit over 5 BOMs (≈ 10 ft, LOO printed) or (b) Chris's 2026 practice **13.3 ft** (Kissimmee 13.49, 36th 13.02). Plus `MC-1202` 2.5→**1.52**/C and the MC connector allowance driven per luminaire (Chris 406 / 144 = 2.82 connectors × 0.08 h) | **Basis change yes; ratio (b) 13.3 ft labeled "Chris 2026 jobs"; unit 1.52/C; connectors per luminaire** | Hours land within 0.5 h of Chris on both jobs. Risk: over-fit to the two gate jobs (stated) |
| J11 | Library price refresh: Chris's Kissimmee BOM net prices (6/18/2026) for THHN, EMT, PVC, MC, contactor, with `material_price_date = 2026-06-18`, using the existing `accubidImport` preview restricted to an **approved list** (prices only, labor untouched by this step) | **Yes, Kissimmee BOM as the single source** (the import's own rule B1). Chris's 36th prices are lower; listed for the record | +$3.8k material K (+$4.6k selling). Every estimate changes, so this needs approval |
| J12 | Misc Materials lump (1 × $1,500 / 16 h, Kissimmee only) | **No default.** Add an optional *excluded* allowance row on ground-up bids, "include if Chris says it's standard" (Q6) | Pure padding if it is not a rule |
| J13 | OxBlue camera support GE line ($750) when a furnish statement says the contractor provides the camera support | **Yes** (v2 cost-line rule, untouched-setting guard) | Derivable from the spec |
| J14 | Venstar CMP #24 4-pair data cable row when the documents say "EC will install … data cable" | **Yes, as a visible `needs_length` hold** with "Use Chris's 1,000 ft (Kissimmee)" in the evidence. Default qty only after Q9 | No silent quantity |
| J15 | 36th branch EMT ratio for remodels (Chris ≈ 10 ft/pt vs 6.6) | **No change; report only** (LOO ±35%, one remodel job) | Q13 |
| J16 | 36th "ELECTRICAL PANEL" = Panel A: when exactly one unlabeled panel mark exists and exactly one panel node is unlocated, offer it as a **suggested** endpoint (confirm) | **Yes, tier `suggested`, quoted, never `confirmed`** | Unlocks 392 ft of HVAC circuits (0929 export) |

**Also say this to Jake in one line:** the library history (Task 1) cannot undo migrations 156 and 158, which already moved submitted bids. Restoring those is P fix round B1's job.

---

## Questions for Chris
1. **Q1 (service).**
   - "How long did you take the transformer-to-meter lateral, per conductor, including makeup? Your feeders and grounds imply about 60 ft."
   - "Does the 2" PVC include conduit with no wire in it (the two 4" GC utility conduits, the Duke primary, telephone)? About 266 ft of your 2" carries no #3/0."
2. **Q2 (feeders).** "Exterior disconnect → interior panel: do you always go up through the wall and over (about 33 ft), never a back-to-back nipple?"
3. **Q3 (site lighting).** "750 ft of 1" PVC for 3 poles: a separate homerun to each pole (A-15/17/19), or chained? Does it include the pylon sign (A-18) or the landscape stub?"
4. **Q4 (power poles).** "Are the 8 poles at 3.5 h + $650 the 6 store poles plus the two 3" PVC data/security poles? Why $650 each, when the spec says AutoZone furnishes the Hubbell poles and E-2 says the GC furnishes them?"
5. **Q5 (owner-furnished).** "E-4 says the 200A fused switches are AUTOZONE PROVIDED, but you priced them. Always on AutoZone? And confirm that AZ-furnished fixtures, poles and panels are labor only."
6. **Q6 (misc).** "Is Misc Materials $1,500 / 16 h a standard ground-up allowance? How do you size it?"
7. **Q7 (terminations).** "No terminations for the WH, EF, DF, signs, mini-tune, contactors, or the AC/AHU on 36th. Are they inside your circuit units, or in Misc?"
8. **Q8 (panels).** "3.6 h for 225A panels, but E-4 says MOUNTING FLUSH. Should flush be 4.5?"
9. **Q9 (Venstar).** "1,000 ft of Venstar data cable: measured, or standard per store?"
10. **Q10 (36th fixtures).** "Which symbol are the 8 '2-Heads 80W Unit Equipment'? And why is Type H priced as a 2x4 high bay at 1.0 h, not a strip?"
11. **Q11 (fixture units).** "Do 8' strips get the 4' wraparound unit (0.75)? Are wall packs 1.1 / 1.6 h by wattage on every job?"
12. **Q12 (underground).** "Is +25% on buried PVC and elbows standard? (Kissimmee 25%, Orlando 5%, others 0.)"
13. **Q13 (36th).** "'1" EMT & Wire' 300 ft at 2.5 h/C: which circuits? And '2" EMT & Wire' 100 ft for a riser the drawings call existing: always carry it?"

---

## Tasks

Order: T0 → T1 → (T2, T3) → (T4, T5, T6, T7 together) → T8–T10 → T11–T12 (after Jake's answers) → T13 → T14 → T15. Commit per task.

### T0. Baseline, scripted answers, classifier, targets (commit before any behavior change)
**Files:**
- `backend/src/eval/replayEval.ts` (shared with fewer-questions, which adds `reviewCounts`; keep the change additive);
- `backend/src/estimating/hoursGroups.ts`;
- new `backend/src/eval/gapTargets.ts`;
- new `backend/src/test/fixtures/realrun/scripted-answers-2026-09-30.json`;
- new `.../account-rules-2026-09-30.json` (the AutoZone and Default rules copied from migration 114, labeled SCRIPTED);
- new `backend/eval/gap-baseline-<date>.json`.

**Changes:**
1. **Classifier, size first.** In `groupOfText`, the Feeders and Site hints apply only when the text has no raceway size or wire gauge. Otherwise the ≥1-1/4" / ≥#8 rule decides, on both sides.
   - Effect: K lateral 8.2 h moves Site → Feeders.
   - 36th: the HVAC 3/4" EMT on Feeders-category rows becomes branch conduit, as with Chris's "1" EMT & Wire".
   - This is eval-only.
2. **`replayPricing` options**, for a new **"SCRIPTED answers"** scenario:
   - `accountTerms?: AccountTermsSnapshot` (built with `resolveAccountTerms` from the account-rule fixture + `agent1.furnishStatements`);
   - `scopeAnswers?`;
   - `quoteFixturePackage?: Record<quoteId, boolean>`;
   - `answers?`, the count answers projected the way `projectCountsOntoRows` does: DISCON 200A fused switch 2 (E-4 "(TYP OF 2)"), MB 1, TIMER 1, CF1-CF3 3. Each answer carries a quote.
   - The scenario is labeled SCRIPTED in every table.
3. **`chrisAtCrmSettings(job)`.** `accubidRecapFrom` with Chris's BOM material and hours under the bid's own `pricingContext`. It reproduces §1 scenario C: $82,854 (K, GE $3,770) and $20,904 (36th). This becomes the price reference.
4. **`gapTargets.ts`.** Per job, per group: Chris h, expected after, band, and status `gated | reported(Qn)`. Values are in the tables below.

**Acceptance:** the baseline JSON is committed first and never rewritten. It reproduces P's numbers exactly: K SCRIPTED $85,294.44 / 697.90 h; 36th $21,357.35 / 167.54 h.

### T1. Library history: submitted bids price "as of" their submission
**Files:**
- migration 164 (`est_item_history`, `est_assembly_component_history`);
- `backend/src/estimating/library.ts` (updateItem / createItem / deleteItem write history; new `getLibraryAsOf(ts)`);
- new pure `backend/src/estimating/libraryAsOf.ts` + test;
- `backend/src/estimating/bidEstimate.ts` and `accubidBidData.ts`: every `getLibrary()` call made for a bid goes through `getLibraryForBid(bid)`;
- `backend/src/estimating/accubidImport.ts` (applyImportPreview writes history).

**Changes:**
1. **The history table.** `est_item_history(item_id, code, labor_hours, material_cost, material_price_date, aliases, active, valid_until timestamptz, changed_by text)`.
2. **Every library-changing migration in this round** (165–167) first INSERTs the old row into history (`valid_until = now()`), then UPDATEs, under the 156 guard (`source='seed' AND accubid_reconciled_at IS NULL`).
3. **`libraryAsOf(lib, history, ts)`:**
   - items created after `ts` are dropped (`created_at`);
   - for each item, the earliest history row with `valid_until > ts` supplies the values, aliases included, so a mapping on an unsaved submitted bid is stable too.
4. **`getLibraryForBid(bid)`:** `isEstimatingBid(bid)` ? live : as of `bids.submitted_at ?? updated_at`.

**Edge cases:**
- A bid un-submitted back to `due` prices live (intended).
- A Calibration bid prices live.
- A deleted item is reconstructed from history.
- History is empty before migration 164, so 156 / 158 are unaffected (stated).
- If the P fix round's B1 lands an equivalent freeze, reuse it and drop this task.

**Tests:**
- K live@submitted with the 165–167 libraries applied equals the pre-round price to the cent;
- a due bid sees the new units;
- the as-of library drops an item created later.

### T2. Owner-furnished material → labor only (gap #1; generalizes P fix B5)
**Files:**
- new pure `backend/src/estimating/ownerFurnished.ts` + test;
- `bidEstimate.ts`: `ResolveOptions.ownerFurnished`; a single `resolveOptionsForBid(bidId)` replacing the six `{ fixturePackageQuoted: await fixturePackageQuoted(bidId) }` call sites (computeRecapForBid, priceUnsaved, syncTakeoff, persistPhaseAPriceForBid, saveBidEstimate, `accubidBidData.ts:354`);
- `pricing.ts`: line field `furnishedBy`; warning `ownerFurnished { lineCount, materialRemoved }`.
- **Reads** `bidstd/accountRules.ts` (`statementParties`, `mentionsTerm`) and `bidstd/accountRulesDb.ts` (`effectiveAccountTerms`) **without editing them**, plus `takeoff_results.account_terms` and `review_items`.

**Logic, per term (lighting, panels, disconnects, power_poles):**
1. Collect the furnish half from:
   - the rule (fixed);
   - every matching drawing statement (`statementParties`; "by G.C." = APT);
   - the estimator's scope answer (wins outright when present).
2. **Labor only** when every furnish source is Owner or Vendor. Kissimmee lighting and panels qualify: rule Owner, both conflict options Owner; only install is open.
3. **Priced, with flag** "furnish disputed — <quotes>; answer scope:<term>" when the sources disagree. Kissimmee disconnects and power poles fall here. This is not a hold and never $0.
4. Lighting also covers site poles, heads and anchor-bolt templates when a lighting statement names "site light poles" (spec 16500, E-1 K). This is the same evidence P's B5 reads; reuse B5's helper, don't fork it.
5. A line matches a term by description (`autoDeductAlternate.ts` `TERM_DESCRIPTION_MATCH` + `NEVER_DEDUCT_RACEWAY_RE` + panel exclusions; reuse, don't copy), or by category for fixture lines (`isFixtureLine`).

**What changes on a matched line:**
- material goes to 0 on an item; on an assembly, only its fixture or panel components (the same logic as fixturePackage);
- `material_unit_override` still wins;
- labor is untouched;
- evidence: "Owner-furnished — labor only: <sheet> '<quote>'".

**Gating:** applied only when `isEstimatingBid`.

**Edge cases:**
- A rule with `autoDeductAlternate` covering the term is never zeroed: it is priced in and deducted as an alternate.
- Default rule (36th): no effect.
- A Kissimmee "PANEL A AUTOZONE PROVIDED" statement whose install half is empty is still a furnish source.

**Tests:**
- K SCRIPTED: material −$23,718 pre-R (the B5 share is already removed by P's fix);
- disconnects and power poles stay priced and flagged;
- a "by GC" statement never zeroes;
- an override survives;
- the 7-Eleven deduct parity tests still pass.

### T3. "Is this quote the fixture package?" (36th double count; S8)
**Files:**
- migration 164 (`est_bid_quotes.fixture_package_decided boolean default false`);
- `accubidBidData.ts` (quote patch sets decided; a warning `fixturePackageQuestion { quoteIds, fixtureMaterial }`);
- `routes/estimating.ts` (the existing quote PUT carries `fixturePackageDecided`);
- frontend `AccubidPricingPanel.tsx`, `BidSummary.tsx` `bidSummaryWarnings`, `types.ts`.

**Rule:**
- **Trigger:** some quote is not excluded and not flagged, `fixture_package_decided` is false, and fixture lines carry library material > 0.
- **Message:** "Quote '<desc>' $X and library fixture material $Y are both priced — is this quote the fixture package?"
- **Yes** sets `fixture_package = true`. **No** sets decided. Neither answer is ever automatic.

**Edge cases:**
- Several quotes: one prompt, a pick list.
- On a lighting-only quote, the description words raise the prompt to the top.
- The check happens before the 18% quote markup. Note in the evidence that "$4,470 already includes the vendor's tax and markup", as Chris had it.

**Tests:**
- 36th → prompt shown; Yes → $17,631;
- No → stays $21,357 and the prompt is gone;
- payload parity.

### T4. Service and feeder conductors (gap #2 a, b, c, e)
**Files:**
- `estimating/feederRoute.ts`: wall crossing; `undergroundLaborAdjPct` in `FeederEstimateSettings` + validation, default 0;
- `estimating/feederEndpoints.ts`: carries Agent 1 `location` / `nemaRating` per node;
- `estimating/feederGraph.ts`: taps get a spec from the service spec;
- `estimating/feederRows.ts`: tap rows;
- `seed/laborUnits.ts` + migration 165: `TAP-POLARIS` 1.2 h, $45, alias-only via code; `ADJ-UG-HR` 1 EA = 1 h, $0.

**Changes:**
1. **(a) Wall crossing.** The adjacent-gear rule is skipped when one end's panel entry says Exterior / NEMA 3R and the other doesn't. Both ends then rise to the deck; the math says "exterior → interior: through the wall and over (Q2)". K: DISCON A/B → PANEL A/B ≈ 36 / 31 ft against Chris's ~33.
2. **(b) Taps.** For each `graph.taps` entry with a service spec:
   - "Tap WIREWAY → DISCON x — #3/0 ×4 @ ~5 ft + 2" nipple" (conduit 5 ft, conductors 4 × 5 ft);
   - "Polaris taps — N" = tapped phase + neutral conductors (K: 8), at `TAP-POLARIS`, quoting the one-line.
   - A tap with no spec is a visible hold (P's nit).
3. **(c) Underground adjustment.** When `undergroundLaborAdjPct > 0`, one generated row "Underground PVC labor adjustment +N% (setting)". Qty = Σ (buried PVC LF × that size's labor unit) × N%, at `ADJ-UG-HR`, with the math in the evidence. At 0 there is no row.

**Edge cases:**
- 2-set feeders (P's B4) keep `sets`;
- a disconnect with unknown location keeps today's rule;
- 36th has no taps.

**Tests:**
- K SCRIPTED: #3/0 428 → ≈ 624 LF, 2" conduit +39 ft, 8 Polaris taps;
- the math strings;
- the setting validation.

### T5. Service gear held at $0 → Chris's units (gap #4 b)
**Files:**
- new pure `backend/src/estimating/serviceGear.ts` (`decideServiceGear(rows, ctx)`), called in `takeoffRowsFrom` right after `decideRows`. A shared line in `bidEstimate.ts`; `equipmentConnection.ts` is untouched;
- seed + migration 165 items, alias-only by code only (never alias tokens, per P's B2):
  - `SVC-GUTTER` service gutter/wireway, 6 h, $600;
  - `GND-SVC` grounding materials (service), 6 h, $890;
  - `BKBD-FRT` fire-rated plywood backboard, 4 h, $250;
  - `LUG-6` #6 compression lug, 0.15 h.

**Rules:**
- Wireway / gutter row → `SVC-GUTTER`.
- The service grounding LS row ("ground rod, building steel, water pipe, Ufer") → `GND-SVC` qty 1. The "concrete-encased electrode #2" LF row becomes a note, "inside Grounding materials (Chris)".
- FRT plywood → `BKBD-FRT`.
- #6 lugs: one per #6 ground termination on feeder edges (K 2 feeders × 3 = 6).
- Evidence on every row cites Chris's BOM row.

**Counts are not this round's.** DISCON A/B "(TYP OF 2)" and the meter base come from fewer-questions' checklist or Jake's answer. This task only checks that a count of 2 maps to the 200A fusible assembly plus 3 fuses each, and a count of 1 maps to the meter socket (1.5 h, Quoted, $0).

**Tests:**
- K SCRIPTED answers: service gear 19.3 → ≈ 54 h (≈ 45 h with J6);
- the B2-style probes ("transformer grounding", "plywood shelf", "gutter downspout") do **not** match.

### T6. Site 1" PVC: radial homeruns from the service corner (gap #7)
**Files:** `estimating/siteGeometry.ts` (P's, after P's B3 one-source fix); `feederEstimate` result types (read).

**Changes:**
1. **Start point:** the METER / XFMR / PANEL endpoint on a site sheet. If it is on another site sheet (C4.1), register it with `alignSheets`; otherwise fall back to today's entry, flagged "start approximate".
2. **Radial when** `siteCircuits().circuits.length === poles`, i.e. one circuit per pole (K A-15 / A-17 / A-19 = 209 / 418 / 209 VA). Each pole gets a Manhattan homerun + 2 × (burial + stub-up), and 2#10 + #10G per run.
3. **Chain when** one circuit feeds several poles (today's code).
4. The math lists every run.

**Edge cases:**
- Poles not marked on a scaled sheet → today's hold.
- More circuits than poles (pylon A-18) → radial for the matching poles; the extra circuit is noted "pylon/landscape — not included (Q3)".

**Tests:**
- K PH0.1 → 670–700 ft, against the hand measurement (SCRIPTED-grade target, ±10%);
- the chain fallback;
- the B3 one-source test still passes.

### T7. Receptacle-assembly double count (gap #9; behind J9)
**Files:**
- `bidEstimate.ts`: `pointHasBoxResolver` and a `mapRawTakeoffRows` post-pass, swapping `ASM-DUPLEX/GFCI/WPGFCI` → `DEV-DUP/DEV-GFCI/DEV-WPGFCI` with evidence "device only — raceway, wire and box carried by the branch allowance";
- migration 168 setting `est_receptacle_device_only`.

**Rules:**
- The swap applies only when the footage allowance emitted branch raceway rows. Decide with one pure predicate, used both before generation (box points) and after it (the check). If the generation produced no branch rows, re-run with the predicate off.
- A manual pick (`match_source='manual'`) is never swapped.

**Tests:**
- K: devices 43.2 → ≈ 16 h (−22.7 raceway/wire, −4.5 assembly box), boxes +3.4 h;
- 36th: unchanged (D6 = 0);
- the D6 test is updated to assert ≈ 0.

### T8. MC per luminaire (J10) and the MC connector driver
**Files:**
- `estimating/footageAllowance.ts` (`countPoints` gains `luminaire`, i.e. fixture minus exit / EM / exterior / pole; `mcBasis: 'fixture' | 'luminaire'`);
- `footageCalibration.ts` (fit both, LOO for both);
- `boxFittingAllowance.ts` (`fitMc` driver = luminaires × connectors-per-luminaire when the basis is luminaire);
- migration 168 (the `est_footage_ratios` / `est_box_fitting_allowance` JSON only when untouched);
- unit change to `MC-1202` in 166 (J10).

**Tests:**
- K MC 1,452 → ≈ 1,915 ft, 36.3 → ≈ 29.1 h;
- 36th 316 → ≈ 386 ft, 7.9 → ≈ 5.9 h;
- fittings unchanged within 0.5 h;
- `footageCalibration.test` re-derives both bases.

### T9. Controls
**Files:** `serviceGear.ts` (control rows); migration 165 item `LV-CMP244` (8.6 h/M, $230/M); `matcherSafety.test.ts` probes.

**Changes:**
1. **Venstar data cable.** A furnish statement with installBy EC naming "data cable" + an LCP / ALC row → "Lighting control data cable (Venstar), CMP #24 4-pair" as a `needs_length` hold (J14). The hold quotes E-6 and "Chris carried 1,000 ft (Kissimmee, Q9)".
2. **TIMER.** Verify that "TIMER — Leviton VP24 7-day astronomic timer switch" maps to `LC-TIMESW` (migration 157) once counted. The count is fewer-questions' or Jake's.
3. **Contactor material** ($180 vs $800 lump) goes to T12, not here.

### T10. Optional defaults: Misc lump (J12) and OxBlue GE (J13)
**Files:** `costLineDefaults.ts` (v2 rule `oxblue_support`, $750, keyed on a furnish statement matching `/oxblue|construction camera/` + "support"); `footageAllowanceDb.ts` (generated row "Misc materials & labor allowance — Chris Kissimmee", `ALW-MISC` 1 EA = $1,500 / 16 h, **excluded**, ground-up bids only); migration 165 / 168.

**Tests:**
- K GE $3,020 → $3,770;
- the misc row is present, excluded, and $0 in totals.

### T11. Seed-unit migration 166 (only the J5–J8 and J10 items Jake approved)
**Files:** `seed/laborUnits.ts`, migration 166 (history first, the 156 guard), `seedUnitsVsChris.test.ts` (cites each BOM row), `replayEval.ts` `libraryAfterMigrations` (mirrors 165–167 exactly).
- **Edge:** this does not touch the B2 alias rules.

### T12. Price refresh migration 167 (J11)
**Files:**
- a test-only script `eval/priceRefreshPreview.test.ts` that prints `buildImportPreview(kissimmee-bom, library, {updatePrices:true})` restricted to the approved code list (the diff table for Jake);
- migration 167 with explicit values + `material_price_date '2026-06-18'`, history rows, and the guard.
- **Never** a Quoted row: no $0 overwrite.

### T13. 36th HVAC circuits (J16) and the riser
**Files:** `estimating/feederEndpoints.ts`.

**Changes:**
- A sole unlabeled panel mark plus a sole unlocated panel node → candidate `suggested`, quoting the mark label and Agent 2's "existing Panel A reused".
- Two or more unlabeled marks → hold.
- The riser stays skipped (Q13).

**Tests:** on the 0930 export the edges resolve to ≈ 392 ft 3/4" EMT + 3#6 (the 0929 parity); the "PANEL B" mark is never reused.

### T14. Frontend
**Files:**
- `LaborPricingStep.tsx`: an "Owner-furnished — labor only" badge (P's D5 badge pattern, quote as tooltip) and a "furnish disputed" badge;
- `BidSummary.tsx` `bidSummaryWarnings`: "Owner-furnished material not priced: $X (N lines)", the fixture-package question, and "N furnish disputes";
- `AccubidPricingPanel.tsx` (T3 prompt);
- `types.ts`.

**Tests:** parity of the collapsed strip; `tsc`.

### T15. Gate extension + report
**Files:** `eval/replayEval.test.ts`, new `eval/gapGate.test.ts`, report `docs/superpowers/plans/2026-10-xx-gap-closing-report.md`.

**Checks:**
1. Every existing F5 check is kept.
2. **New, on the SCRIPTED-answers scenario:**
   - per-group bands (below);
   - total hours within ±12% of Chris (K) / ±15% (36th);
   - selling price within ±20% (K) / ±15% (36th) of **Chris's inputs at the CRM's settings** (the old Chris-price row is still printed);
   - material within ±30% of Chris after owner-furnished.
3. "K hours ≥ baseline" uses the post-T7 expectation: T7 must land with T4–T6.
4. No silent $0 line (and P's S7 fix: hold reasons are specific).
5. If `pdftoppm` is missing, the gate fails under CI.

---

## Expected before → after (SCRIPTED answers, after R + P fixes; "≈" means the builder pins exact values in T0/T15)

**Kissimmee by group** (CRM before, from §2; Feeders/Site after the T0 reclass).

| Group | Before h | After h | Chris h | Band (gated unless noted) | Tasks |
|---|---|---|---|---|---|
| feeders | 28.9 | ≈ 38–40 | 79.6 | ≥ 36 h; **reported** until Q1 (≈ 43 h of lateral + empty 2" is judgment) | T4, J5 |
| service gear | 19.3 | ≈ 54 (≈ 45 with J6) | 42.0 | ±20% once J6 decided, else ≤ +30% | T5, J6 |
| equipment connections | 22.7 | ≈ 41 (R's PP hosts + S2 + fans counted) | 40.8 | ±15% | R, P, fewer-questions |
| site / underground | 27.1 | ≈ 47 | 44.6 | ±20% | T6 (+7 h if J4 = 25%) |
| controls | 6.3 | ≈ 6.3 (≈ 14.9 when CMP length set) | 14.6 | reported (Q9) | T9 |
| devices | 43.2 | ≈ 16 (≈ 12.7 with J8) | 9.4 | ≤ +7 h | T7, J8 |
| fixtures | 139.2 after R | ≈ 161 | 161.4 | ±7% | J7 |
| wire & MC | 82.2 | ≈ 75 | 87.3 | reported (the #10 split washes with site) | T8 |
| fittings / hardware / boxes / splices | 52.1 / 86.7 / 36.9 / 59.4 | ≈ 52.6 / 86.7 / 40.3 / 59.4 | 59.9 / 87.9 / 35.7 / 66.9 | branch wiring total (conduit + wire + fittings + hw + boxes + splices) ±7% | T7, T8 |
| misc | 1.5 | 1.5 (17.5 if J12 is included) | 16.0 | reported (Q6) | T10 |
| **Total** | 697.9 (680.8 after R) | **≈ 735–745** | 798.9 | ±12% | |
| Material | $33,110 | ≈ $16.1k (≈ $19.9k with J11) | $25,843 | ±30% | T2, T5, T12 |
| Selling (CRM settings) | $85,294 | ≈ $68–73k | ref $82,854 | ±20% | |

Per item, the Kissimmee $ effects:

| Item | Effect |
|---|---|
| Owner-furnished | −$23.7k material (−$28.5k selling) |
| Feeders + taps | +10 h, +$0.6–0.9k material |
| Service gear | +34.8 h / −8.8 h (J6), +$2.7k material (+$4.7k selling) |
| Site radial | +20 h (+$1.8k) |
| Receptacles | −27 h (−$1.6k) |
| MC | −7.2 h, +$0.35k |
| Fixture units | +22.2 h (+$1.2k) |
| CMP | +8.6 h, +$230 (+$0.75k) once the length is set |
| Price refresh | +$4.6k selling |
| OxBlue | +$750 |
| Misc | +$2.7k, only if included |

**36th by group** (before → after; Chris).
- **branch conduit:** 17.7 → ≈ 33 with T13 (17.7 without); Chris 30.6; ±15% when located, else reported.
- **fixtures:** 28.1 → ≈ 28.5 (J7: strip +1.3, troffers −0.9). +4.6 if Q10 says high bay; +5.2 when R reads the 8 EM 2-heads. Chris 35.1; reported (Q10).
- **controls:** 0 → 1.65 (TIMER counted); Chris 1.65; ±0.5 h.
- **wire & MC:** 21.1 → ≈ 19.1 (T8); Chris 25.7; reported.
- **devices:** 6.0 → ≈ 4.4 (J8); Chris 4.9; ±2 h.
- **feeders:** 0 → 0; Chris 3.0; reported (Q13).
- **equipment connections:** 4.1 → 4.1; Chris 0; reported (Q7).
- **Total:** 167.5 → ≈ 168–186; Chris 189.2; ±15%.
- **Material:** $4,537 → ≈ $1.5k + the quote, once the fixture package is answered.
- **Selling:** $21,357 → ≈ $17.6–19.4k, against ref $20,904 (±15%). The old Chris-price row ($23,230) will read −17% to −24%. That is the honest number (S8), and it is printed, not gated.

---

## Shared files (edit additively; coordinate)
- **With the P fix round (P-owned):** `estimating/bidEstimate.ts`, `feederRoute.ts`, `feederGraph.ts`, `feederRows.ts`, `feederEndpoints.ts`, `siteGeometry.ts`, `footageAllowance.ts`, `footageAllowanceDb.ts`, `footageCalibration.ts`, `boxFittingAllowance.ts`, `costLineDefaults.ts`, `accubidBidData.ts`, `pricing.ts`, `seed/laborUnits.ts`, `seedUnitsVsChris.test.ts`, `matcherSafety.test.ts`, `routes/estimating.ts`.
- **With fewer-questions:** `eval/replayEval.ts` (they add `reviewCounts`), `test/fixtures/realrun/replay0930.ts` (read only). This round adds `scripted-answers-*.json`.
- **Read only:** `bidstd/accountRules.ts`, `bidstd/accountRulesDb.ts`, `ai/reviewItems.ts` types.
- **Not touched:** `reviewItems.ts`, `takeoffReview.ts`, `tradeAssignment.ts`, `routes/preconstruction.ts`, `ai/countMerge.ts`, the review UI.
- **Frontend (shared with UI rounds 1 / 2A and P):** `LaborPricingStep.tsx`, `BidSummary.tsx`, `AccubidPricingPanel.tsx`, `types.ts`.
- **Library and other:** `estimating/library.ts`, `estimating/accubidImport.ts` (history writes), `estimating/hoursGroups.ts` (eval classifier).

## Risks
- **The library as-of layer** touches every pricing entry point. A missed call site would re-price a submitted bid. Mitigation: grep test that `getLibrary()` is called only inside `getLibraryForBid` / library routes.
- **Owner-furnished over-reach** (a "panel" or "fixture" word in a non-package line). Mitigation: reuse the S16 description matcher and raceway exclusion, every zeroed line badged, override wins, and a `by GC` test.
- **Disputed furnish** must stay priced. A silent zero on the disconnects would undercut Chris by $625.
- **T7 lowers hours.** Landing it without T4–T6 fails the "≥ baseline" check. Same merge; reviewer checks the order.
- **MC 13.3 ft is fit to the two gate jobs** (older jobs 7.5–10). The LOO for both bases is printed; Jake decides.
- **Wall-crossing detection** depends on Agent 1 `location`/`nemaRating` text. Missing text keeps today's rule (no regression).
- **Radial start registration** across C4.1 → PH0.1. A failed alignment falls back, flagged.
- **Price refresh:** Chris's prices vary ±50% between jobs; one dated source, shown.
- **Gate re-base** to "Chris's inputs at the CRM's settings" could look like goal-post moving. The old rows stay printed and the reason (§1.3, S8) is cited.

## Reviewer focus
1. **Stage rule:**
   - a submitted bid's price is unchanged to the cent after migrations 165–167 (T1 test);
   - the generated rows and owner-furnished pricing are gated by `isEstimatingBid`;
   - Calibration bids reprice.
2. **Nothing silent:**
   - every new priced row, every owner-furnished zero and every swap carries its quote or math;
   - disputed furnish stays priced and flagged;
   - no count is raised or lowered (counts come only from answers / fewer-questions);
   - the CMP cable is a hold, not a guess.
3. **Owner-furnished correctness:** "by G.C." = APT; furnish halves agree; the install-only dispute still zeroes; the autoDeductAlternate guard; the override wins.
4. **No double counting:**
   - fixture package × owner-furnished × B5 (one mechanism);
   - taps vs feeders;
   - site radial vs the B3 one-source rule;
   - receptacle device + box allowance (box counted once);
   - MC connectors driven per luminaire, not per ft.
5. **Alias safety:** the new items are reached by code only. The B2 probes plus new ones ("plywood shelf", "transformer grounding", "gutter downspout", "data cable for cameras") don't match.
6. **Migrations:**
   - numbered after 163 (confirmed at build);
   - history first;
   - the 156 guard;
   - idempotent;
   - only the values Jake approved;
   - `libraryAfterMigrations` mirrors the SQL exactly.
7. **Gate honesty:**
   - the baseline is committed first;
   - SCRIPTED answers are labeled, each with a quote;
   - the classifier change is applied to both sides and to the baseline;
   - the old rows are still printed;
   - CI fails without `pdftoppm`.
8. **No edits to fewer-questions-owned files**, and the `replayEval.ts` changes are additive.

### Critical Files for Implementation
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-accuracy-p/backend/src/estimating/bidEstimate.ts (resolveLines ~395–525, ResolveOptions 389, takeoffRowsFrom 686–735, mapRawTakeoffRows 640, pointHasBoxResolver 743, the six fixturePackageQuoted call sites)
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-accuracy-p/backend/src/bidstd/accountRules.ts (resolveAccountTerms 333, statementParties 672) + /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-accuracy-p/backend/src/bidstd/accountRulesDb.ts (effectiveAccountTerms) + /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-accuracy-p/backend/src/estimating/autoDeductAlternate.ts (TERM_DESCRIPTION_MATCH)
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-accuracy-p/backend/src/estimating/feederRoute.ts (adjacent-gear rule ~165) + /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-accuracy-p/backend/src/estimating/feederGraph.ts (taps ~160) + /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-accuracy-p/backend/src/estimating/siteGeometry.ts (E1 chain)
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-accuracy-p/backend/src/estimating/library.ts (getLibrary 85, updateItem 177) + /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-accuracy-p/backend/src/estimating/seed/laborUnits.ts + /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-accuracy-p/database/migrations/156_price_accuracy_seed_updates.sql (guard pattern)
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-accuracy-p/backend/src/eval/replayEval.ts + /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-accuracy-p/backend/src/eval/replayEval.test.ts + /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-accuracy-p/backend/src/estimating/hoursGroups.ts (groupOfText hints ~52)