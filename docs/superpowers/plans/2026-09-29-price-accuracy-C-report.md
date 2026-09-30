# Price accuracy round — Builder C report (C1–C7)

**Branch:** `fix/price-accuracy` (worktree `Electrical-program-wt-pricefix`), off main `a5ac9cd`. Not pushed.
**Commits:** `8ad4be3` C1 · `5adde62` C2 · `7417e34` C3 · `4454509` C4 · `4476ac9` C5 · `15e039e` C6 · `5bee608` C7 · `af7fc04` report · decisions: `2beff1d` (wire units) · `60524ff` (fixture package) · `6b9daf8` (pole-head alias) · (this report update).
**Migrations:** 153 (match_confidence 'confirm'), 154 (LTG-HIBAY24), 155 (ALW-* allowance units, C5 demolition units, #12/#10 THHN labor units, `est_bid_quotes.fixture_package`, the pole-head alias; see "Deviations").

## C1 — matcher safety (`estimating/mapper.ts`)
- Equipment families (transformer, gear, disconnect, fixture, device, control, wire, conduit, fitting, box, equipment connection, demolition, low voltage, site, grounding). The line's family comes from its item text first, then spec, then category/unit. The library row's family comes from its name within its category. **A fuzzy match never crosses families.** Device and control may still match each other.
- **Held matches.** A fuzzy match into gear or a transformer, or one above **$250 material or 2 h per library unit** (EA rows), is stored as `match_confidence = 'confirm'`. The line keeps the suggested item but prices at $0 / 0 h and reads as unresolved until confirmed. The Labor & Pricing row shows "confirm match: <item> ($0 until confirmed)" with a button, and the sidebar shows "N matches to confirm".
- **Circuit lists** (a panel's circuit enumeration, "Branch circuit 20/1 — Panel A") map to a branch-circuit assembly if one exists. Otherwise they stay unresolved with the evidence note "Branch circuit count — wiring carried by the allowance".
- **Equipment-connection rows** (HVAC, motor or appliance loads named before any device/disconnect noun) map only to an equipment-connection unit at their stated amperage and poles. Otherwise they stay unresolved with the reason. The library's own exact name, or an equipment-connection alias, still wins.
- Existing saved lines keep their stored confidence, so no saved or submitted bid changes price.
- **Pin change:** the B5 36th replay pins were restated, because the old pins included the bogus matches (−$3,354.36 on the old run).

### Fuzzy-match sweep, before → after (seed library)
**36th 2026-09-29b**
- Before:
  - Branch circuit ?/1 → XFMR-15 ($1,100 / 4 h × 17)
  - COMP #1 → XFMR-15
  - DISC-A and DISC-B → LTG-WPACK (wall pack)
  - EXT-FAN → LTG-WPACK
  - WH → SPEC-KITCHEN
  - Motor → SPEC-MOTOR
  - Equipment direct power → DEV-DED20
  - Meter → METERCT
  - F2 → SPEC-KITCHEN
  - Types C, D, E2, E3, G → fixtures; OS → LC-OCCSW
- After:
  - Circuit list: unresolved (allowance note).
  - COMP #1/#2, AHU #1/#2, WH, Motor, EXT-FAN: unresolved (no unit at 40A/2P, or no amperage).
  - DISC-A/B, Equipment direct power: unresolved.
  - Meter → METERCT **held**.
  - F2 → SPEC-KITCHEN, and the fixture/sensor matches, unchanged.

**Kissimmee 2026-09-28**
- Before:
  - Branch circuit 20/1 Panel A → LC-RELAYPANEL ($650 / 4 h × 31)
  - Branch circuit 60/3 → BOX-4SQ
  - Branch circuit 20/1 Panel B → ASM-GFCI
  - RTU-2 → BOX-4SQ; WH → SPEC-EVFINAL
  - MINI-TUNE breaker → LTG-HIBAY; WIREWAY → SITE-PB1212
  - PP-TEST → PNL-SUB100; QC/RELOCK → ASM-GFCI; PYLON SIGN → ASM-GFCI
  - Recessed exhaust fan → LC-OCCSW; CF1-CF3 fans → ASM-FLOORBOX; Ceiling fan → LC-OCCCEIL
  - Plywood backboard → LTG-WPACK; Telephone conduit → SITE-TRENCH
  - DISCON A/B → DISC-200; S1/S2 heads → LTG-POLEHEAD; Lighting contactors → LC-RELAYPANEL; ALC alarm module → LC-RELAYPANEL
- After:
  - All three circuit lists: unresolved (allowance note).
  - RTU-1/2, WH: unresolved (60A/3P, or no amperage).
  - Every cross-family match is gone.
  - Held: DISCON A/B → DISC-200, contactors and alarm module → LC-RELAYPANEL.
  - S1/S2 heads: held after C1. C5's demolition units briefly pushed them under the fuzzy threshold; decision 5's `pole fixture head` alias brings them back as held pole-head suggestions.
  - Still auto-priced: strips → LTG-STRIP4, SIGNS → SPEC-EVFINAL, DATA-CONC and 3" PVC data poles → LV-DATA, motion/occupancy sensors → LC-OCCSW.
- `matcherSafety.test.ts` asserts, for every fuzzy match in all three runs, no family conflict and held exactly when gear or >$250 / >2 h. It pins the Kissimmee after-list.

## C2 — review answers → estimate (`estimating/reviewAnswers.ts`)
- `getCurrentTakeoffRows` now reads `review_items`. It applies the proposal's own enforcement (`enforcedCounts` + `enforceCountsOnTakeoff`) to Agent 2's rows before mapping, so answers show up on the next GET, in sync-takeoff and in the footage allowance, without a re-run.
- Answers handled: unlisted named+counted becomes its own line; "same as X" adds to X; count, status, area and legend answers set the quantity; not-on-job removes the line; `demodup` keep/sum and `demounit` counts update the Demolition lines.
- New seed item **LTG-HIBAY24** "LED high bay, 2x4 flat lens", 1.0 h/E (Chris's BOM row), migration 154.
- Jake's actual H answer produces `Type H — LED high bay 2x4 - warehouse (per Chris)` × 13, which maps to LTG-HIBAY24 (13.0 h). This is covered by a route test through `/review/resolve`.

## C3 — boxes / fittings / hardware (+ splices, see C7)
- `boxFittingCalibration.ts` classifies Chris's BOM rows into groups: box sets, EMT/PVC/MC fittings, support hardware and twist-on splices. Its drivers are points (fixture/device/equipment) and EMT/PVC/MC-plus-flex footage.
- **Fit (5 BOMs):**

  | Allowance | Hours | Material |
  |---|---|---|
  | Box set, per point (one rate beats fixture/device rates on LOO) | 0.19 h | $2.29 |
  | EMT fittings, per C (net of the seed EMT's built-in couplings/straps) | 1.13 h | $9.88 |
  | PVC fittings, per C (net) | 1.20 h | $23.04 |
  | MC/flex connectors, per C | 2.20 h | $12.30 |
  | Hardware, per C of EMT+MC | 2.68 h | $27.01 |
  | Hardware, per fixture | 0 h | $2.49 |
  | Splices, per point | 0.27 h | $0.76 |

- **Leave-one-out mean absolute error:** box 35%, fittings 27%, hardware 15%, splices 28%, all four together 19%.
- **Calibration table** (hours: Chris / fitted / leave-one-out):

  | Job | Box | Fittings | Hardware | Splices | Total LOO |
  |---|---|---|---|---|---|
  | 36th Street | 12.9 / 11.9 / 11.9 | 8.3 / 15.9 / 16.3 | 24.0 / 28.1 / 28.1 | 15.2 / 16.9 / 17.0 | +21% |
  | Kissimmee | 35.7 / 44.1 / 45.5 | 67.9 / 75.6 / 77.8 | 83.2 / 95.2 / 96.7 | 65.8 / 62.6 / 62.1 | +12% |
  | North Port | 88.0 / 128.7 / 157.1 | 147.0 / 143.6 / 141.2 | 201.3 / 203.6 / 224.3 | 144.7 / 182.7 / 209.3 | +26% |
  | Orlando Clubhouse | 52.1 / 45.8 / 44.7 | 51.8 / 48.8 / 48.1 | 56.5 / 64.0 / 64.4 | 50.1 / 65.0 / 67.6 | +7% |
  | Rockledge | 124.5 / 82.7 / 67.7 | 113.6 / 104.6 / 99.4 | 177.9 / 164.5 / 147.9 | 168.9 / 117.4 / 98.9 | −29% |

  (36th fittings are net of the seed EMT's built-in share, so the net figure is 8.3 h against 13.9 h gross.)
- **Lines** (category "Boxes, Fittings & Hardware (allowance)", priced from ALW-* items, migration 155):
  - They are added only on bids at stage `due`. A submitted bid never gets them.
  - A group with no driver adds no line.
  - Points already priced as an assembly that includes its box (e.g. ASM-DUPLEX) are skipped.
  - Takeoff and estimator box lines come off the box count.
  - An estimator's own fitting, hardware or connector lines replace that group.
  - ALW-* items are exact-name-only in the mapper, so they never fuzzy-match real lines.
- **Settings:** `est_box_fitting_allowance` (on/off plus a scale per group), with a validator and a panel in Settings > Labor Library.
- **36th per-group hours, ours (after) vs Chris:**

  | Group | Ours | Chris |
  |---|---|---|
  | Boxes & rings | 12.5 | 12.9 |
  | Fittings | 11.9 | 8.3 net (13.9 gross) |
  | Hardware | 20.2 | 24.0 in my grouping (the plan's 11.8 used a narrower one) |
  | Splices (in wire & MC) | +17 | 15.2 |

## C4 — sidebar follows the pricing mode
- GET `/estimating/:bid` and POST `/:bid/price` return `accubid` (the full Accubid recap on the proposed or unsaved lines) in Accubid mode, and `null` in Phase A mode.
- The preview adds the default equipment and GE lines a first save would seed. They are shown but never written.
- GET `/:bid/accubid` prices the proposed mapping before the first save, so the breakdown is never $0.
- **Bid Summary in Accubid mode:** material, field labor, equipment, GE, quotes, prime cost, labor OH, net, markup, and selling price as the total. The Phase A figures appear only in Phase A mode.
- `useEstimatingBid` keeps the recap live from /price and re-reads it after save or sync. Previewed defaults are read-only in the panel.

## C5 — demolition units
- Units: equipment connection/disconnect **0.75 h**, device (other) **0.15 h**, site pole light **3.0 h**, building-mounted exterior fixture **0.5 h**, lighting control **0.25 h**. All are $0 material and named "(default — confirm)". The codes are DEMO-EQUIP, DEMO-DEVICE, DEMO-SITEPOLE, DEMO-EXTFIX and DEMO-CONTROL.
- `demolitionClass` gained classes for equipment, control, site-pole, exterior and device. The classes stay exclusive.
- **For D4:** these are the AI reading's own line names, and each maps exactly:
  - "Demolition — equipment connection / disconnect"
  - "Demolition — device (other)"
  - "Demolition — site pole light"
  - "Demolition — building-mounted exterior fixture"
  - "Demolition — lighting control device (sensor / timer)"
- D still owns `PRICED_DEMO_CLASSES` in `ai/remodel/demolition.ts` (not touched by C).

## C6 — per-bid default equipment/GE opt-in
- Endpoint: `POST /estimating/:bid/accubid/cost-lines/use-defaults {kinds}`. It only works for a `due` bid with no line of that kind and a never-seed marker (every bid from before migration 151). It returns 409 otherwise and re-persists the price.
- The Accubid recap returns `defaultOptIns`. The panel shows a per-kind button. Nothing runs automatically.

## C7 — the replay (36th 2026-09-29b + Jake's H answer, full Accubid recap, app defaults)

These numbers include the decisions: #12/#10 THHN at Chris's 5.15/5.65 h/M. The "quoted" rows add decision 3's fixture-package quote the way Chris bid it: lighting $3,795 at 7% tax + 10% markup, with fixture lines priced labor-only.

| | Selling price | Hours | Material (database) |
|---|---|---|---|
| Chris | $23,230.14 | 189.2 | $3,399 (+ $4,467 lighting quote) |
| **Before** (main a5ac9cd, same harness) | $37,829.30 (sidebar showed $39,026, Phase A) | 152.8 (68 of them the bogus transformer) | $23,401 |
| After C1–C6 without H | $12,360.50 | 127.9 | $3,463 |
| **After C1–C7 + decisions** | **$17,704.87 (−23.8%)** | **163.8 (−13.4%)** | $6,063 (fixture material in the lines) |
| After + D's expected effect | $18,050.30 (−22.3%) | **167.8 (−11.3%)** | $6,143 |
| **After, lighting package quoted** | **$16,771.59 (−27.8%)** | 163.8 (−13.4%) | **$1,563 (−54% vs $3,399)** + quote |
| After + D, lighting package quoted | $17,117.02 (−26.3%) | 167.8 (−11.3%) | $1,643 + quote |

- D's expected effect is hand-applied: 5 duplex + 2 GFCI new; demolition 52 fluorescent, 2 HID, 2 exit, 18 receptacles, 6 + 2 switches.
- **Hours:** within ±15% of Chris's 189.2 h from C alone (163.8, −13.4%), and 167.8 (−11.3%) with D's expected effect.
- **Material:** with the lighting package quoted, the comparison is finally like for like, and it is **−54%**: $1,563 vs Chris's database $3,399. This is the next gap. The seed material costs are ballpark and low against Chris's prices, e.g. 3/4" EMT $60/C vs his ~$92/C, and #12 THHN $95/M vs ~$137/M. Only labor units were in scope this round.
- **Selling price:** −24% to −28%. The remaining gap is that material plus the hours still missing.
- **Remaining hours by group (after vs Chris):**

  | Group | Ours | Chris |
  |---|---|---|
  | Wire & MC | 38.7 (incl. 17 h of splices) | 54.4 |
  | Conduit + fittings | 29 | 46.2 |
  | Fixtures | 32 | 35.1 |
  | Demolition | 23.8 | 22.2 |

  - The unmeasured feeders (Chris's 400 ft of "EMT & Wire", 10.5 h) stay 0-qty MEASURE lines.
- **Splices stay under wire & MC** (decision 4).

## Decisions round (coordinator, 2026-09-29)

1. **Held-match threshold:** kept at $250 material / 2 h per library unit. No change.
2. **Wire labor units:** #12 THHN 3.5 → **5.15 h/M**, #10 THHN 4.2 → **5.65 h/M** (every one of Chris's five BOMs).
   - Seed and migration 155 update only rows whose `source` is still `seed`.
   - The test DB's rows are `manual`, and stayed untouched, as they should.
   - `estimatingWireUnitsMigration.test.ts` runs the UPDATEs on a seed row and on a calibrated row inside a rolled-back transaction.
   - Assemblies that use THHN-12 (e.g. ASM-DUPLEX) re-price live. A saved bid's stored amount does not move, but it shows "Estimate changed since last save".
   - **Follow-up list (seed ≠ Chris)**, pinned in `seedUnitsVsChris.test.ts`; not changed:

     | Seed item | Seed | Chris |
     |---|---|---|
     | EMT-050 / 075 / 100 (seed "incl. couplings/straps") | 3.5 / 4.0 / 5.0 h/C | bare 2.78 / 3.2 / 4.05 |
     | LFMC-075 | 5.2 h/C | 4.95 |
     | MC-1202 | 2.5 h/C (25 h/M) | 1.52 h/C (15.2 h/M) |
     | MC-1203 | 2.8 h/C | 1.66 h/C |
     | PVC-050 / 075 / 100 / 125 / 150 | 3.0 / 3.5 / 4.3 / 5.2 / 6.0 h/C | 3.1 / 3.6 / 4.2 / 5.0 / 5.6 |
     | PVCB-200 (2") | 7.0 h/C | 6.8 |
     | PVC-400 (4", underground) | 15.5 h/C | 13.8 |
     | RGD-100 | 7.5 h/C | 6.2 |
     | THHN-8 | 5.5 h/M | 7.0 |
     | THHN-6 | 7.0 h/M | 8.9 |
     | THHN-2 | 10.5 h/M | 12.4 |
     | THHN-1 | 12.0 h/M | 13.5 |
     | THHN-3/0 | 16.5 h/M | 18.8 |
     | THHN-600 | 34 h/M | 42.4 |

     - Chris has #3 THHN (11.9 h/M), 1" LFMC (5.9 h/C) and FMC 3/4" / 1-1/4" (3.9 / 7.8 h/C), which have no seed item at all.
     - **Note:** if EMT moves to Chris's bare-conduit rate, `ALW-FIT-EMT` must be refit gross (today it is net of the seed's built-in fittings).
3. **Quoted fixture package:** new `est_bid_quotes.fixture_package` flag (default false, so no existing bid changes).
   - When any quote on the bid carries it, fixture lines price library material at $0 and keep their labor, on every pricing path (Phase A, Accubid, save, sync, legacy snapshot).
   - A fixture line is a lighting-category line that reads as a fixture; an exhaust fan or sensor under lighting is not.
   - An estimator-typed material still wins.
   - It is set only by a checkbox on the quote in the Accubid panel and is never inferred.
   - Tests: `fixturePackage.test.ts`, a route test (flag on → material drops and hours hold; off → restored; bad value → 400), and a panel test.
4. **Splices:** stay under wire & MC (as reported).
5. **S1/S2 pole heads:** alias `pole fixture head` on LTG-POLEHEAD (seed + migration 155, untouched seed row only). Both come back as held pole-head suggestions; the sweep pin is updated.

## Deviations / notes
- **Migration 155 holds the C3 and C5 units and the decision-round changes (all unmerged, amended in place).** The round's range was 153–155, and 154 was already used by C2. 155 was also amended in C7 to add ALW-SPLICE. It is insert-only and idempotent. The test DB had already run 155, so its `schema_migrations` row was deleted and 155 was re-applied (test DB only).
- **Splices (twist-on wire connectors) were added as a fourth C3 group.** They were not in the plan's list. The replay showed 15.2 h with no home, so I added them.
- **Held-match threshold:** per library unit (confirmed in the decisions round).
- **Files shared with D:** none edited. C only imports from `ai/reviewItems.ts` and `ai/remodel/demolition.ts` (tests).

## Tests
- **Backend full suite (`npm test`, once):** 2,617 passed, 5 failed, 4 skipped (253 files). All 5 are outside this branch, and all pass when re-run alone:
  - intakeSimilarCache ×2 and integration lead-backfill, both on the known-flake list;
  - intakeSimilar.route ×2, the same intake-similarity family (2/2 pass alone).
- **Frontend full suite (once):** 1,368 passed, 1 failed (`gen-pipeline/SurveyMarkupEditor` Escape timing). It is not touched by this branch and passes alone.
- **Typecheck:** clean on backend and frontend.

## Open questions
1. Material: the next gap is seed material cost (−54% vs Chris's database material on the 36th, like for like). Should seed material be refit from Chris's 2025–26 BOM prices, following the labor-unit rule?
2. Which rows on the wire / MC / conduit follow-up list move next? MC (seed is 64% above Chris) and the large feeder wire sizes are the biggest.
3. `estimatingAccubidBidRoutes` "B6 cost-line / alternate scoping" failed once in a serial estimating run and passed alone (16/16). Treat it as a DB-state flake unless it recurs.
