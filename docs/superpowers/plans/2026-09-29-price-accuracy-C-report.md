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

## Fix round (review `ceba1a4`, NOT READY → fixes)

**Commits:** `c5b5922` B1/S1/S2 (+ demolition token-weight nit) · `4532788` S3 · `b3a1a50` S4 · `e2f35ce` S5 · `992d145` S6/S7 + nits · (this report). Every review repro is a test.

- **B1, fixture with a sensor (blocker):** the primary noun decides the family.
  - `familyText` removes three kinds of text before classifying:
    - circuit references (`Panel A ckts 15,17`, `circuit to Panel A`, `ckt 2`);
    - schedule references (`not in fixture schedule`);
    - accessory phrases (`with …`, `w/ …`, `integral …`, `incl. …`).
  - A lighting category plus a fixture noun is always a fixture. So "LED high bay with sensor", "LED strip with integral motion sensor" and "LED high bay w/ integral occupancy sensor" map to LTG-HIBAY / LTG-STRIP4, never LC-OCCSW.
  - Strong fixture nouns win over control, low-voltage and gear words: flat panel, panel light, troffer, wall pack, security light, pole head.
- **S1, disconnect vs load:** disconnect words win.
  - `RTU-1 disconnect, 60A` maps to DISC-60, and condenser, motor and pump disconnects at 30A map to DISC-30.
  - The equipment-connection branch also keeps a disconnect alias.
  - A unit's own connection "… with disconnect" is still an equipment connection.
- **S2, "panel" and "security" words:**
  - LED flat panel, LED panel light and "LED troffer, circuit to Panel A" are fixtures, and so is "Security light wall pack".
  - "Panel" is gear only on its own. A panel circuit reference never sets the family.
  - The un-sized troffer stays unresolved, because every troffer unit names a size. It no longer hits the GFCI circuit.
  - `20A/1P branch circuits …` counts as a circuit list.
- **Nit, demolition token weights:** demolition units now weigh only on demolition lines' token frequencies. The Kissimmee pole heads are held suggestions even without the alias.
- **Real runs:** no mapping changed on the three real runs (36th 09-29b and 09-29, Kissimmee 09-28; diffed).
- **B5 replay:** it now prices held matches at $0, as the app does. It used to price them.
- **S3, demolition classes:** "exterior" is a location, not a class.
  - Exterior GFCI / WP receptacle map to receptacle, exterior light switch to switch, exterior and canopy junction boxes to jbox, and receptacle on timer to receptacle.
  - Telephone and data outlets map to device (other), so the DEMO-DEVICE aliases are reachable.
  - D's 12 demolition names were re-checked read-only on `fix/remodel-reading-v2`; unchanged, and all map exactly.
- **S4, review answers and doubles:**
  - A counted type with no line of its own takes the one untagged row that plausibly is that type. The 36th count:WP repro gives **2 WP, not 4**, on the existing "WP GFCI receptacle exterior at condensers" line.
  - An answer's extra line lands on the row that already is that item: the same name ignoring case, dash style and punctuation, or the row carrying the type or class key. The hyphen vs em-dash H case gives **13, not 26**.
  - The enforcement's possible-double, ambiguous and conflict warnings are no longer dropped. They appear as `⚠` on the line's evidence, as `reviewFlags` in GET and sync-takeoff, and as a Bid Summary warning.
- **S5, saved total in Accubid mode:** the saved total is the Accubid selling price after save, sync and install, so there's no false "changed since last save".
  - `engineTotal` (the selling price in Accubid mode) now pre-fills the proposal price, "use engine total" and the mismatch check.
- **S6 and S7, migrations:**
  - 155 is frozen. Its seed-row UPDATEs (THHN units, pole-head alias) moved into **156**, guarded by `source = 'seed' AND accubid_reconciled_at IS NULL`.
    - A DB that hasn't run 155 never overwrites a reconciled row.
    - Only the test DB ever ran 155, so nothing is missed.
  - Tests cover the reconciled and calibrated rows untouched, a plain seed row moved, and 153–156 re-run as a no-op.
- **Nits:**
  - The fixture-package flag zeroes only a fixture assembly's fixture component. ASM-TROFFER-24 keeps its #12 wire material.
  - A refused C6 opt-in puts the never-seed marker back, so a later save never seeds the default without the click.
- **36th table:** unchanged by the fix round, re-run and pinned in `priceAccuracyReplay.test.ts`.

  | | Selling price | Hours | Material |
  |---|---|---|---|
  | After C1–C7 + decisions | $17,704.87 (−23.8%) | 163.8 (−13.4%) | $6,063 |
  | After + D (expected) | $18,050.30 | 167.8 (−11.3%) | $6,143 |
  | Lighting package quoted | $16,771.59 (−27.8%) | 163.8 | $1,563 + quote |
  | + D, lighting package quoted | $17,117.02 | 167.8 | $1,643 + quote |

- **Release note:** a saved `due` bid keeps any pre-C1 bogus fuzzy line (e.g. XFMR-15 × 17) on sync, unless its takeoff description changed. This is by design, since existing bids never change. It shows as a "check match" badge; the estimator re-resolves it.
- **Report grouping:** the hardware figures here use this report's grouping throughout (Chris 24.0 h on the 36th). The plan's 11.8 h used a narrower grouping. Pick one before the eval gate.
- **Tests (fix round):**
  - Relevant suites green: `src/estimating` 445/445, the estimating route tests, and `features/estimating` + `features/preconstruction` 843/843.
  - Typecheck clean on backend and frontend.
  - **Full backend suite (once):** 2,638 passed, 8 failed, 4 skipped. None of the 8 is in C's code:
    - on the known-flake list: intakeSimilarCache ×2, integration lead-backfill, and estimatingLibrary seeded-item (test-DB state);
    - the same intake-similarity family: intakeSimilar.route ×2;
    - also failed: accountRulesRoutes migration-114 seed and stopAnalysis S2.
    - accountRulesRoutes, stopAnalysis and intakeSimilar.route pass alone (24/24); the shared test DB was also in use by D.

## Fix round 2 (re-check `e565ae3`)

**Commits:** `64d4fef` N1/N2 · `6bad24a` N3 + nit · (this report).

- **N1:** the head noun decides the family.
  - `familyText` drops object and location clauses (`for` / `at` / `serving` / `feeding` / `to` / `on` / `in` …), the same way it drops accessory clauses.
  - `headFamily`: the first family noun starts the phrase, and a compound runs on to its head. So "wall switch sensor" is a sensor, "lighting contactor" a contactor, "relay/control panel" a control, and "disconnect switch" a disconnect.
  - A low-voltage system word makes the phrase low voltage ("data outlet rough-in").
  - The category is only the tiebreak when no family noun is recognized. The lighting-category override is gone.
  - The reviewer's rows, as tests:

    | Row | Result |
    |---|---|
    | Disconnect for sign lights | disconnect, unresolved |
    | Wall switch sensor for lights | LC-OCCSW |
    | Transformer for low voltage track lights | transformer, unresolved |
    | Fused disconnect at pole light | disconnect, unresolved |
    | Time switch for canopy lights | **LC-TIMESW** (new unit) |
    | Contactor for pole lights | LC-CONTACTOR |
    | Occupancy sensor for lights | LC-OCCSW |
    | Receptacle for display lights | device |

  - **New unit:** `LC-TIMESW` "Time switch, 24-hour", 1.65 h / $150. It is Chris's own 36th BOM row, added to the seed and migration 156.
  - **No-change diff on all three real runs:** one line changed. The 36th 09-29 row "Time clock / VP24 timer switch (TC)" now maps to LC-TIMESW; it was unresolved. Nothing else moved.
- **N2:** a panel reference is stripped only after a circuit or feed word ("circuit to Panel A", "fed from Panel A", "sub-feed from Panel A ckts 27,29"), or when it carries its circuits ("Panel A ckts 15,17"). These stay gear:
  - the real 36th row "PANEL B FEED — Panel B sub-feed from Panel A ckts 27,29 (connection)";
  - "Panel B feed (connection)";
  - "Sub-panel B connection";
  - "Tie-in to existing Panel A (connection)".
- **N3:** a row that takes a counted type's answer and comes out *lower* than Agent 2 had it raises a `count_lowered` review flag. It appears in `reviewFlags` and the sidebar, and as a `⚠` line note.
  - Test: WP answered 1 on the 2-count WP GFCI line gives "Count lowered … 2 → 1".
- **Nit:** review flags are now `{kind, message}`. The Bid Summary shows one labeled row per kind (count lowered, possible double count, type on more than one line, review answer in conflict), with the messages in a tooltip.
- **36th table:** unchanged. The replay pins pass: $17,704.87 · 163.8 h · material $6,063; with the lighting package quoted, $16,771.59.
- **Tests (relevant only):**
  - `src/estimating` plus the review-answer and sidebar route tests: 460/460.
  - The estimating route tests: 213/214. The failure is `estimatingLibrary` seeded-item, on the known-flake list.
  - `features/estimating` + `features/preconstruction`: 843/843.
  - Typecheck is clean on both.

## Fix round 3 (re-check `1602517`)

**Commits:** `b986c84` N4/N5 · `cba25d6` structural safety net · `d37832f` N6/N7 · (this report). Backend only; no frontend change.

- **Safety net (structural):** `fuzzySafetyHold`. A fuzzy match prices on its own only when all three hold:
  - the line's family is read from its own words, not just its category (`confidentLineFamily`);
  - the library row is that same family;
  - the line's category can hold that family (`CATEGORY_FAMILIES`), for example:

    | Category | Families it can hold |
    |---|---|
    | Branch Power | device, box, equipment connection, disconnect, wire, conduit, fitting |
    | Interior / Exterior Lighting | fixture, control |
    | Lighting Controls | control, device |
    | Low Voltage | low voltage, box, conduit |
    | Service & Distribution | gear, transformer, disconnect, wire, conduit, equipment connection |
    | Site | site, conduit, wire, box |
    | Grounding | grounding, wire |

  - Anything else is **held** (`confirm`, $0) with a "Check match: …" reason, shown on the line's confirm chip.
  - **Property-style test:** every real line of the three runs plus every reviewer repro row (222 lines, 46 fuzzy, 9 held). No auto-priced fuzzy match is cross-family, unconfidently read or category-incompatible. "NEEDS FOOTAGE" runs price from their own spec, never from the fuzzy item.
- **N4:** a compound runs on only within one family. A device may run on to its box, plate or cover, or to the control it is, but never to a fixture word.
  - "strip" is a fixture word only as strip light, strip fixture, LED strip or striplight.
  - Receptacle and outlet strips, plugmold and multi-outlet are devices. They map to a plugmold unit when one exists, else stay unresolved with a note; never LTG-STRIP4.
  - The 5 repros are tested. "Light switch" is a switch, and bare "lighting" is not a fixture noun.
- **N5:** when phrases overlap, the longer, more specific one wins. "Access control (panel)" and "card access" map to LV-ACCESS.
- **N6:** 156 is final as the test DB ran it. LC-TIMESW moves to **157**. 153–157 re-run as a no-op (test).
- **N7:**
  - LC-TIMESW's aliases are now: time switch, time clock, 24-hour time switch, astronomic, astronomic time switch, and Chris's own row name. The bare "timer switch" is gone.
  - A countdown, fan or minute timer never matches a time switch.
  - A timer, time switch, astronomic or VP24 line never matches a plain wall switch.
- **No-change diff on the three real runs since this round began:** two lines changed, both qty 0.
  - 36th 09-29b "TC — Leviton VP24 … astronomic timer switch (VPOSR for 3-way)": SW-3W → **LC-TIMESW**.
  - Kissimmee "DATA-CONC — Venstar data concentrator" (low voltage under Branch Power): LV-DATA is now **held**.
- **36th table:** unchanged. The replay pins pass.
- **Tests (relevant only):**
  - `src/estimating` + the migration test: 460/460.
  - Review-answer and sidebar route tests: 10/10.
  - Estimating route tests: 48/48.
  - Typecheck clean.

## Fix round 4 (re-check `b9a3089`)

**Commits:** `65ae9f6` N8/N9 · (this report). Backend only.

- **Structural fix: the safety net now covers alias matches too** (`aliasSafetyHold`). An alias (non-exact) match prices on its own only when all of these hold:
  - the line says more than one word (a size or gauge counts, so "3/4" EMT" and "#12 THHN" pass);
  - its family is read from its own words;
  - the library row is the same family;
  - the category can hold that family.

  Anything else is held ($0, "Check match: …"). Exact description matches are unchanged.
- **N8:** the timer rules apply only when the line itself reads as a control. The rules are: never a plain wall switch, and allow the 24-hour time switch.
  - "Duplex receptacle on timer" → ASM-DUPLEX and "Single pole switch with timer" → SW-1P, both priced.
  - "Duplex receptacle, switched via time switch", "GFCI receptacle on time clock circuit", "Receptacle controlled by time clock" and "LED troffer on time clock" never price as LC-TIMESW.
  - A real control line ("Time clock, 7-day") still maps to LC-TIMESW.
- **N9:** Panel, Pole, Sign, Emergency, Cover, Ring, Head and Pull box are unresolved or held; none auto-prices via alias.
- **Family table:** Branch Power now also holds gear and control, because Agent 2 files sub panels, lighting-control panels and time switches there. This keeps legit real-run aliases priced. A demolition line is allowed in any category.
- **Property test** now covers alias as well as fuzzy matches: 236 lines (all three real runs plus every reviewer repro, including the 6 N8 and 8 N9 rows). 63 alias matches, 15 held; 46 fuzzy, 9 held.
- **No-change diff on the three real runs (vs fix round 3):** one newly held alias.
  - Kissimmee "J-box with 6' flex at wall & HP counters (Flex J)" → ASM-DUPLEX, qty 3.
  - The item says J-box and the spec says receptacle on flex, so the row is genuinely mixed. It is held rather than priced as a receptacle circuit.
  - No other alias match moved. The 36th table is unchanged.
- **Tests (relevant only):**
  - `src/estimating`: 460/460.
  - Estimating route tests (review answers, sidebar, bid, footage): 53/53.
  - Typecheck clean.

## Follow-up N10 (review `da65a13`, READY; older than this branch)

A fixture word followed by a trailing relay / panel / switch / inverter / ballast / driver / base noun that ends the item phrase is that thing, not the fixture. The new family is:

| Trailing noun | Family |
|---|---|
| relay | control |
| panel, inverter | gear |
| switch | device |
| base | site |
| ballast, driver | the new `accessory` family |

"LED / flat panel" stays a fixture.

**Rows tested:**
- Emergency lighting relay, transfer relay and bypass relay; emergency lighting panel.
- Emergency battery inverter, emergency ballast, "Emergency driver for troffer".
- "Emergency light test switch", "Exit sign test switch".
- "Light pole base", "Pole light concrete base".

None reads as or auto-prices as a fixture.

**No-change diff on the three real runs:** nothing moved.

**Tests:**
- `src/estimating`: 462/462.
- Estimating route tests: 48/48.
- Typecheck clean.
