# Price accuracy round: Builder C adversarial review

**Branch:** `fix/price-accuracy` at `08e0029` (range `a5ac9cd..08e0029`, including the decisions commits `2beff1d`, `60524ff`, `6b9daf8`). Re-pulled before the verdict.
**Reviewer:** Opus (read-only; scratch worktrees only, now removed). Tests ran on `electrical_crm_test` only. No live DB, no Local Version, no Anthropic calls, no push.

## Verdict: NOT READY

There is one blocker. C1's new family classifier creates a cross-family fuzzy match that did not exist before, and prices it silently. The fix is small (see B1). Everything else is should-fix or nit. The integration merge is clean and green.

---

## Blocker

### B1. A fixture that mentions a sensor, photocell or timer now fuzzy-matches the occupancy sensor and prices silently (C1)
`equipmentFamily()` checks `CONTROL_RE` before `FIXTURE_RE_FAM`. So a fixture line that names its integral sensor is classed `control`:
- The fixture candidates now "conflict" and are skipped.
- The line fuzzy-matches `LC-OCCSW` ($35 / 0.4 h), which is under the hold threshold, so it auto-prices.

Before C1, these lines matched the right fixture. This is the exact failure C1 exists to stop: a cross-family match priced with no flag.

**Repro** (seed library, `toLibraryCandidates`):
```ts
mapTakeoffLine({ category: 'Interior Lighting', description: 'Type H — LED high bay with sensor', qty: 5, unit: 'EA' }, candidates)
// a5ac9cd: fuzzy LTG-HIBAY ($210 / 1.4 h)   HEAD: fuzzy LC-OCCSW ($35 / 0.4 h), confirmReason null
mapTakeoffLine({ category: 'Interior Lighting', description: 'Type S — LED strip with integral motion sensor', qty: 5, unit: 'EA' }, candidates)
// a5ac9cd: fuzzy LTG-STRIP4                 HEAD: fuzzy LC-OCCSW
mapTakeoffLine({ category: 'Interior Lighting', description: 'Type F — LED high bay w/ integral occupancy sensor', qty: 5, unit: 'EA' }, candidates)
// a5ac9cd: fuzzy LTG-HIBAY                  HEAD: fuzzy LC-OCCSW
```
`equipmentFamily('Exterior wall pack w/ photocell', 'Interior Lighting', 'EA')` returns `control` too. That one survives only because the `wall pack` alias hits first.

**Fix direction:**
- Make a fixture noun that leads the text win, the same way `equipmentLoadLeads` works for HVAC loads.
- Or treat control/fixture as "no auto-price" rather than "no match".
- Add these three rows to `matcherSafety.test.ts`.

---

## Should-fix

### S1. Legitimate disconnect alias matches are broken when an HVAC or motor word leads (C1)
`isEquipmentConnectionRow` fires on "RTU-1 disconnect…", because `EQUIPMENT_LOAD_RE` matches before `disconnect`. The equipment-connection path then keeps a normal match only when its family is `equipment_connection`. So a correct `disconnect` alias is dropped. The line becomes unresolved with a misleading note, "Equipment connection (60A) — no equipment-connection unit…". The line is visible and $0, not silent, but it is a regression of alias matches.

| Row | a5ac9cd | HEAD |
|---|---|---|
| `RTU-1 disconnect, 60A NEMA 3R` | alias DISC-60 | none |
| `Condenser disconnect 30A` | alias DISC-30 | none |
| `Motor disconnect 30A` | alias DISC-30 | none |
| `Pump disconnect 30A` | alias DISC-30 | none |

**Fix:** in the equipment-connection branch, also accept an exact or alias normal match whose family is `disconnect`. Or make `disconnect` a competing noun that wins when the row has no "(connection)" marker.

### S2. "Panel" makes a fixture into gear; "security" makes it low voltage (C1)
`GEAR_RE` (`\bpanels?\b`) and `LOW_VOLTAGE_RE_FAM` (`security`) run before `FIXTURE_RE_FAM`. So common fixture descriptions lose their match. They are unresolved and visible, but this is a regression.

| Row | a5ac9cd | HEAD |
|---|---|---|
| `Type A — 2x4 LED flat panel, Lithonia CPX` | fuzzy ASM-TROFFER-24 | none |
| `Type P — LED panel light 2x4` | fuzzy LTG-TROF24 | none |
| `Type T — LED troffer, circuit to Panel A` | fuzzy ASM-GFCI (was wrong) | none (should be a troffer) |
| `Type EF — Exhaust fan / light combo` | fuzzy LTG-EMCOMBO | none |

`equipmentFamily('Security light wall pack', …)` returns `low_voltage`.

The same classifier feeds decision 3's `isFixtureLine`. It is safe there only because the matched library name is read first.

**Fix:**
- Read "flat panel", "panel light" and "LED panel" as fixture before gear.
- Strip "Panel X" and "ckt" circuit references before classifying.

### S3. C5's new `demolitionClass` classes break working demolition lines
The `exterior` pattern (and `timer` via `control`) is added as a second class on non-luminaire lines. Two classes means `null`, which means lump-sum or unresolved.

| Line | a5ac9cd | HEAD |
|---|---|---|
| `Demolition — exterior GFCI receptacle` | receptacle | null |
| `Demolition — exterior WP receptacle` | receptacle | null |
| `Demolition — exterior light switch` | switch | null |
| `Demolition — exterior junction box` | jbox | null |
| `Demolition — canopy junction box` | jbox | null |
| `Demolition — receptacle on timer` | receptacle | null |

`isLumpSumDemolition` then treats them as lump-sum. They are unpriced, and C3's drivers skip them.

Also, DEMO-DEVICE's aliases `demolition — telephone outlet` and `demolition — data outlet` can never be used. `demolitionClass('Demolition — telephone outlet')` is `receptacle`, and the class filter runs before alias scoring, so phone and data outlet demolition still prices as DEMO-RECEPT.

D's own 12 line names are unaffected (all map exactly; see Integration). This hits Agent 2's free-text demolition rows on other jobs.

**Fix:**
- Apply the site-pole and exterior checks only when no device, jbox or equipment class was found.
- Put telephone and data before the `outlet` receptacle test.

### S4. C2 drops the enforcement's own warnings, so an answer can double-count silently
`applyReviewAnswers` uses `fix.takeoff` and `fix.corrections`. It discards `fix.possibleDoubles`, `fix.ambiguous` and `fix.conflicts`, which the proposal path relies on. The estimate now carries answers in dollars with no second look.

**Repro 1** (36th 9/29b export):
- Answer `count:WP` with qty 2.
- Result: a new line "Duplex receptacle weather protected (WP)" × 2 is added (countType WP).
- The existing "WP GFCI receptacle exterior at condensers" × 2 (no countType) stays.
- Total: 4 WP GFCIs (Chris 2).
- `enforceCountsOnTakeoff` does return `possibleDoubles` for this takeoff, but the estimate never shows them.

**Repro 2** (the next run includes the answer):
- Add an Agent 2 row `Type H - LED high bay 2x4 - warehouse (per Chris)` × 13, with a hyphen instead of the em dash, to the rows.
- Run `applyReviewAnswers` with Jake's answers.
- Result: two H lines, 13 + 13. Extra lines match only on the exact normalized item text.
- An identical name is idempotent, and count and demolition answers are absolute sets, so they are idempotent too.

**Fix:**
- Surface `possibleDoubles`, `ambiguous` and `conflicts` on the proposed and synced lines (an evidence note plus a sidebar warning).
- Normalize dashes and whitespace in the extra-line match.

### S5. C4: after a save in Accubid mode, the sidebar says "Estimate changed since last save"
`useEstimatingBid.save()` and `syncTakeoff()` still call `setSavedGrandTotal(res.recap.totals.grandTotal)`, which is the Phase A total. `BidSummary` now compares the Accubid selling price with it (`shownTotal` vs `savedGrandTotal`). So right after every save or sync, the stale tag shows until a reload. On reload, the value comes from `bid_estimates.grand_total`, which is the selling price.

**Repro:** Accubid-mode bid, edit, save. `bs-stale-tag` renders.

**Fix:** set `savedGrandTotal` from `res.bidEstimate.grand_total`, or from the refreshed Accubid selling price.

**Related, older than this branch, but in (d)'s scope:**
- `PcWorkspaceView` pre-fills the proposal price (`propPrice`) and `engineTotal` from `estimatingBid.recap.totals.grandTotal`, which is Phase A, even in Accubid mode.
- The GC proposal price therefore disagrees with the sidebar's selling price.
- It should use the Accubid selling price in Accubid mode.

### S6. Migration 155's THHN UPDATE also overwrites Accubid-reconciled rows
The update is `WHERE code = 'THHN-12' AND source = 'seed'`. But `applyAccubidItemUpdate` (review round 2, N-R2-2) deliberately keeps `source = 'seed'` on a row it reconciled from Chris's BOM, and only stamps `accubid_reconciled_at`. So a THHN-12 reconciled from a real BOM is silently moved to 5.15.

**Repro** (in a rolled-back transaction):
1. `UPDATE est_items SET labor_hours=4.8, accubid_reconciled_at=now() WHERE code='THHN-12'` on a `seed` row.
2. Run the 155 UPDATE.
3. Result: labor_hours becomes 5.15.

**Fix:** add `AND accubid_reconciled_at IS NULL`. Do the same to the LTG-POLEHEAD alias update for consistency. That one is harmless, since it only adds an alias. Add the reconciled case to `estimatingWireUnitsMigration.test.ts`.

### S7. Migration 155 was amended in place four times
The runner tracks by filename only, so any DB that ran an earlier 155 silently misses:
- ALW-SPLICE;
- the THHN units;
- `est_bid_quotes.fixture_package` (the quote queries would then 500);
- the pole-head alias.

Today only `electrical_crm_test` ever ran it, and the builder re-applied it there. Main has no 155, so the live DB cannot have run it.

**Action:**
- Freeze 155 now.
- Any further change goes in a new file (D uses none of 156–157, so 156 is free).
- The merger should confirm that no other DB ran an earlier 155.

---

## Nits
- **Fixture package** (decision 3) zeroes the whole assembly's material. `ASM-TROFFER-24`'s THHN-12 component is included, so a little wire material leaves with the fixtures.
- **C6:** `optIntoDefaultCostLines` deletes the never-seed marker before seeding.
  - If nothing is seeded (0 h), it returns 409 but the marker is gone.
  - The next save then seeds the default without a click.
  - Delete the marker only when a line was written.
- **C1 root cause of the S1/S2 pole-head loss:** demolition candidates still count in `buildTokenDocFreq` for non-demolition lines. Decision 5's alias patches the symptom. Excluding demolition, as is already done for ALW-*, fixes the cause.
- **Saved bogus matches stay:** a saved `due` bid with a pre-C1 bogus fuzzy line (e.g. XFMR-15 × 17) keeps it on sync, because it is not re-matched unless its description changed. This is by design ("existing bids never change"). It shows only as a "check match" badge, so say so in the release note.
- **Report cleanup:** the report's plan-level hardware figure (11.8 h vs 24.0 h) uses different groupings. Fine, but pick one grouping before the eval gate.

---

## Checked and OK
- **(a)**
  - Both culprits are fixed.
  - Every fuzzy match in both runs (36th 9/29b, 36th 9/29, Kissimmee 9/28) was classified and diffed against a5ac9cd. The only changes are removals of cross-family matches, the three held matches (METERCT, DISC-200 ×2, LC-RELAYPANEL ×2), and AHU #2's bad BOX-4SQ alias.
  - No exact or alias match was lost on either run.
  - The 73 Kissimmee strips (and B/C/M/N) still auto-price to LTG-STRIP4.
  - Held lines price $0 and 0 h on every path (resolveLines feeds Phase A, the Accubid recap and the save). They show a "confirm match" chip and a sidebar count in both modes.
- **(b)**
  - Jake's H answer gives 13 × LTG-HIBAY24 (1.0 h).
  - "Same as" adds, and count, status, not-on-job and demolition (demodup, demounit, D's demosuggest via keepQty) answers apply.
  - GET on a saved bid reads saved lines only. Generated and box rows reach a saved bid only via an explicit sync, and box rows only at `due`. Submitted bids get no preview defaults and no opt-in.
  - The new endpoints use `loadAccessibleBid`, like their siblings.
- **(c)**
  - ALW-* rows are exact-name only.
  - Units: fittings and raceway hardware are LF against C items (÷100 via libraryUnit); box, fixture hardware and splice are EA.
  - Estimator fitting, hardware and splice lines replace their group. Box lines and box-carrying assemblies subtract.
  - No overlap with the wiringScopes rows: their EMT/PVC parts carry built-in fittings, and the calibration nets them.
- **(d)**
  - The recap on unsaved lines equals the saved recap after save (route test, re-run green).
  - The `accubid` field is null in Phase A mode.
  - Preview defaults are never written.
- **(e)**
  - 153, 154 and 155 are idempotent (DROP/ADD constraint, ON CONFLICT DO NOTHING, ADD COLUMN IF NOT EXISTS, a guarded alias UPDATE).
  - Seed-only updates skip `manual` and `calibrated` rows. S6 is the reconciled gap.
- **(f)** Opt-in happens only by POST or button. Old bids keep their markers, so they get no preview and no seed on save.
- **(g)** `accubidRecap.ts` and its test are untouched by the branch. Chris's reproductions pass to the cent: Bubble Down $10,911.68, Seminole $7,483.66, Kissimmee and Golf within $0.05, Autozone $79,112.23, Gulf $36,429.57.

---

## Tests (C head `08e0029`, alone)
- **Typecheck:** clean.
- **Backend:** `src/estimating`, `src/test/estimating*`, `src/test/kissimmee*` and `remodel36thReplay` gave 57 files and 695 tests, all passing.

## Integration check
**Merge:** a trial merge in a scratch detached worktree of main `a5ac9cd`, then `fix/remodel-reading-v2`, then `fix/price-accuracy`.
- First done at D `98edf8b`, then **re-done at D `61855fc`** after D moved.
- Both merges were clean, with no conflicts. D adds no migrations. The worktree is removed.

**Typecheck:** backend clean, frontend clean.

**Backend tests:**
- `src/estimating`, `src/test/estimating*`, `src/test/kissimmee*` (Kissimmee replays), `remodel36thReplay`, `priceAccuracyD36th` (D's 36th replay), `src/ai/remodel` and the C 36th replays (`thirtySixthStreetReplay`, `priceAccuracyReplay`): 61 files, 766 tests, all passing at D `61855fc`.
- `src/ai`, `src/bidstd`, `src/test/review*`, `takeoffReview*` and `remodel*`: 69 files, 1,068 tests, all passing at D `98edf8b`.

**Frontend tests:** `features/estimating` and `features/settings`, 36 files and 667 tests, all passing.

**D's demolition line names → C5 units (merged library):** all 12 map **exact**.
- DEMO-FIXTURE→DEMO-FLUOR24
- DEMO-HIGHBAY→DEMO-HIDHB
- DEMO-EXIT→DEMO-EXITEM
- DEMO-RECEPTACLE→DEMO-RECEPT
- DEMO-SWITCH→DEMO-SW1P
- DEMO-SWITCH3→DEMO-SW3W
- DEMO-JBOX→DEMO-JBOX
- DEMO-CONTROL→DEMO-CONTROL
- DEMO-DEVICE→DEMO-DEVICE
- DEMO-EQUIPMENT→DEMO-EQUIP
- DEMO-EXTERIOR→DEMO-EXTFIX
- DEMO-SITE-POLE→DEMO-SITEPOLE

**Combined 36th, end to end.** The inputs:
- D's `replay36thB()` (live marks, D2 crops mocked as Chris) gives D's count_result and review items, with Jake's live answers carried over.
- The live Agent 2 rows are used with their Demolition rows replaced by D's demolition quantities.
- That feeds C2 `applyReviewAnswers`, then the footage allowance and one-source rule, then C3 box/fitting/hardware/splice, then the C1 mapper, then `priceBid`, then the Accubid recap with app defaults.

D's demolition lines: fluorescent 47, exit/em 5, **receptacle 21**, single-pole 11, **device (other) 1**, **equipment/disconnect 6**. The last two are new lines priced at C5's defaults. The 6 is pending D's blocking demosuggest question; Chris has 0.

| | Selling price | Hours | Material |
|---|---|---|---|
| Chris | $23,230.14 | 189.2 | $3,399 + $4,467 quotes |
| **C + D combined** | **$18,722.65 (−19.4%)** | **177.1 (−6.4%)** | $6,223 (fixtures in lines) |
| C + D, lighting package quoted (decision 3) | $17,789.37 (−23.4%) | 177.1 | $1,723 + quote |
| (C report, D hand-applied) | $18,050.30 | 167.8 | $6,143 |

- **Combined hours by group:**

  | Group | Hours |
  |---|---|
  | Wire & MC (incl. splices) | 41.0 |
  | Fixtures | 32.0 |
  | Demolition | 25.9 |
  | Hardware | 21.2 |
  | Conduit | 19.0 |
  | Boxes & rings | 13.3 |
  | Devices & other | 12.5 |
  | Fittings | 12.3 |

- One held line remains: the meter.
- New receptacles come out at 5 duplex and 2 WP GFCI, as Chris has them.
- **The S4 double shows up here too.** D's count_result makes WP a counted type (2). C2's enforcement then adds "Duplex receptacle weather protected (WP)" × 2 (ASM-DUPLEX, about 3.5 h) next to Agent 2's "WP GFCI receptacle exterior at condensers" × 2, and nothing warns. Take about 3.5 h and $59 material off the combined figures for a like-for-like number.
- Answering the equipment demosuggest with the suggestion (0) removes 4.5 h.
- The combined hours are about 10 h above the C report's hand-applied estimate, because D's real output keeps switches at 11 and adds the equipment and device lines.

---

# Addendum: fix-round re-check (`ceba1a4..70f0169`)

**Verdict: NOT READY.** Every item from the first review is fixed. But the new "lighting category + fixture noun → fixture" rule adds a new blocker of the same kind as B1: a cross-family match that prices with no flag.

**How this was checked:**
- Three probe worktrees: a5ac9cd, ceba1a4 and 70f0169, all removed afterwards.
- Every real line of the 36th 09-29b, 36th 09-29 and Kissimmee 09-28 runs, plus about 120 common phrasings.
- Tests on `electrical_crm_test` only.

## The first review's findings

| # | Result |
|---|---|
| **B1** | **Fixed.** "LED high bay with sensor" → LTG-HIBAY; "LED strip with integral motion sensor" → LTG-STRIP4; "LED high bay w/ integral occupancy sensor" → LTG-HIBAY. |
| S1 | **Fixed.** RTU-1 / condenser / motor / pump disconnects → DISC-60 / DISC-30 (alias). "A/C Comp Unit #1 with disconnect 40A/2P" stays an equipment connection. |
| S2 | **Fixed.** LED flat panel and LED panel light → LTG-TROF24. Security wall pack → LTG-WPACK. "Exhaust fan / light combo" is back to its a5ac9cd match. "LED troffer, circuit to Panel A" is unresolved (no size given); accepted. |
| S3 | **Fixed.** Exterior GFCI / WP receptacle → receptacle. Exterior light switch → switch. Exterior and canopy j-box → jbox. Receptacle on timer → receptacle. Telephone / data / data-phone outlet → DEMO-DEVICE. All 26 demolition phrasings checked; none regressed. |
| S4 | **Fixed.** count:WP = 2 → one line, "WP GFCI receptacle exterior at condensers" × 2 (tagged WP), not 4. H with a hyphen, a shorter name or "Type H:" → one line of 13, not 26. |
| S5 | **Fixed.** In Accubid mode the saved total is the selling price after save, sync and install. `engineTotal` (the selling price in Accubid mode) pre-fills the proposal price, "use engine total" and the mismatch check. |
| S6 | **Fixed.** 156's UPDATEs are guarded by `source='seed' AND accubid_reconciled_at IS NULL`. The migration test covers reconciled, calibrated and plain seed rows. |
| S7 | **Fixed.** See the migration judgement below. |
| Nits | **Fixed.** The fixture package zeroes only the fixture component (ASM-TROFFER-24 keeps its THHN). A refused C6 opt-in restores the never-seed marker. Demolition units now weigh only on demolition lines' token frequencies. |

**S4 flags are visible:**
- On the live 36th with Jake's answers, `applyReviewAnswers(...).flags` returns 2 possible-double warnings: WP GFCI vs Duplex, and H vs Type A.
- They reach the page three ways:
  - GET `/estimating/:bid` and sync-takeoff return `reviewFlags`.
  - `useEstimatingBid` passes them through `EstimatingWorkspace` to `BidSummary`, which shows `bs-warning-review-flags` with the text in a tooltip.
  - The flagged line's evidence gets a `⚠ …` prefix.

**Migration judgement: moving the seed UPDATEs from 155 into a guarded 156 is correct and better.**
- The live DB has not run 155, and main has no 155. So on merge, live runs 155 (inserts and the column only) and then 156 (guarded updates), in order.
- The test DB already ran an older 155 that included the unguarded UPDATEs. Its THHN and pole-head rows are `manual` there, so nothing moved, and 156 is idempotent there too.
- The plan had reserved 156–157 for D. D ships no migrations (checked at D `bb391ee`), so there is no clash. The coordinator should record that 156 is now C's.

## New blocker

### N1. A control, disconnect, sensor or transformer under a lighting category that says "… lights" becomes a fixture and matches one
The new first rule in `equipmentFamily` is: lighting category + `FIXTURE_NOUN_RE` anywhere in the text → `fixture`. `FIXTURE_NOUN_RE` includes `\blights?\b`, `\bexit\b`, `emergency`, `canopy` and `flood`. `familyText` removes "with / w/ / integral" clauses, but not "for … / at …" purpose clauses. So the item's real noun loses to the thing it serves.

**Repro** (seed library; results on 70f0169, with ceba1a4 in brackets):

| Category | Row | 70f0169 | ceba1a4 |
|---|---|---|---|
| Exterior Site Lighting | `Disconnect for sign lights` | **fuzzy LTG-EXIT, auto-priced** | none |
| Interior Lighting | `Wall switch sensor for lights` | **fuzzy LTG-WPACK ($145 / 1.0 h), auto-priced** | fuzzy LC-OCCSW |
| Interior Lighting | `Transformer for low voltage track lights` | **fuzzy LTG-TRACK, auto-priced** | none (transformer) |
| Exterior Site Lighting | `Fused disconnect at pole light` | held ASM-POLE-LIGHT ($0, flagged) | none |
| Exterior Site Lighting | `Time switch for canopy lights` | held LTG-CANOPY ($0, flagged) | none |
| Exterior Site Lighting | `Contactor for pole lights` | none (match lost) | fuzzy LC-CONTACTOR |
| Interior Lighting | `Occupancy sensor for lights` | none (match lost) | fuzzy LC-OCCSW |
| Interior Lighting | `Receptacle for display lights` | family is now `fixture` | family was `device` |

The first three are new silent cross-family prices, the same class as B1. The AI does put site-lighting controls and sign disconnects under Exterior / Site Lighting.

The real runs are unaffected: no mapping changed on any of the three (diffed). The risk is on the next jobs.

**Fix direction:**
- Apply the lighting-category override only when no disconnect, control, device, box or transformer noun comes before the fixture noun. In other words, the first noun decides.
- Or strip purpose clauses (`for …`, `at …`, `serving …`, `feeding …`) in `familyText`, as is already done for accessory clauses.
- Add the eight rows above to `matcherSafety.test.ts`.

## Should-fix
- **N2. Panel feeders and tie-ins now read as equipment connections.** `familyText` removes "Panel X" even when the panel *is* the item. So "Panel B feed (connection)", "PANEL B FEED — Panel B sub-feed from Panel A ckts 27,29 (connection)" (a real 36th row), "Sub-panel B connection" and "Tie-in to existing Panel A (connection)" change from `gear` to `equipment_connection`. They are unresolved today, but they could now fuzzy-match a cheap equipment-connection unit (SPEC-*) with no hold. Remove panel references only when another noun remains, or only in "circuit/ckt"-anchored form.
- **N3. Pre-tagging can change a row's count with only a line note (S4).** When a counted type has no line of its own, the one plausible untagged row now takes the answer's qty. That qty can be lower than Agent 2's. The change lands in `corrections` and in a "Takeoff review answer: a → b" evidence note, but not in `flags`. Under "never lower a count silently", push a flag when a pre-tagged row's qty goes down.

## Nit
- The sidebar label says "(possible double count)" for ambiguous and conflict flags too. Word it per kind.

## Tests on 70f0169 (relevant only)
- **Typecheck:** clean on backend and frontend.
- **Backend:** `src/estimating`, `src/test/estimating*`, `src/test/kissimmee*` and `remodel36thReplay` gave 710 tests: 709 passed, 1 failed. The failure is `estimatingLibrary` "editing a SEEDED item sets source=manual", which is on the known-flake list (test-DB state).
- **Frontend:** `features/estimating` and `features/preconstruction/PcWorkspace`, 52 files and 796 tests, all passing.
