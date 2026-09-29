# Review: feat/footage-allowance (Builder B, B1–B5 + Q3/Q4/Q5)

**Range:** `7a69928..7d93db9` · **Reviewer:** Opus 5.5 (adversarial) · **Date:** 2026-09-29
**Read first:** `2026-09-29-remodel-footage-round.md` (Builder B section) and `2026-09-29-footage-allowance-report.md`.
**Method:**
- I read the code.
- I ran repro probes in a throwaway merged worktree (A + B on top of main, detached HEAD, now removed).
- DB probes ran on `electrical_crm_test` only. There were no model calls and nothing was pushed.

## Verdict: **NOT READY**

The pure math is sound, and so are the Q3 scale gate, the demolition units, the migrations and Chris's recap reproductions. Four pricing blockers remain:

1. Existing and submitted bids change price on the first unrelated edit.
2. Typed footage and the ratio lines double-count.
3. An Agent 2 branch footage drops the wire.
4. A re-sync adds the allowance on top of wiring the estimator already entered.

All four are small, local fixes.

---

## Blockers

### BL-1: Equipment/GE defaults are seeded onto existing (even SUBMITTED) bids on any unrelated edit
**Where:**
- `accubidBidData.ts` `saveAccubidRecapForBid` → `costLineDefaults.ts` `syncDefaultCostLines`.
- It runs from every mutation path: PUT `/:bidId`, accubid settings, quote/cost-line/alternate CRUD (`persistPriceForBid`) and sync.

**Cause:**
- There is no bid-stage gate.
- Migration 151 doesn't backfill `est_bid_cost_line_seeds` for bids that already exist.

So every Accubid-mode bid that carries no equipment or GE line gets `Equipment — default` and `General expenses — default` the next time anyone touches it, and `bids.amount` moves. That includes jobs where Chris deliberately carried $0 (Gulf Simulator and Seminole equipment, Bubble Down GE).

Loading is safe: GET `/:bidId/accubid` only computes and never seeds.

**Repro** (DB, electrical_crm_test):
1. Create an Accubid bid with a 208 h labor line.
2. Delete its cost lines and seed rows, to simulate a pre-151 bid.
3. Set `stage='submitted'`.
4. The recap loads at $11,382.85.
5. POST a **$0** budget quote → `bids.amount` = $13,171.25 (**+$1,788.40**). Two auto lines were inserted: equipment $1,518.40 and GE $270.

**Fix:**
- In 151, insert `(bid_id, kind)` seed rows for every existing bid (both kinds), so defaults only ever seed on bids created after the migration.
- Also gate `syncDefaultCostLines` to `bids.stage = 'due'`. This covers both seeding a default and making an auto default follow the hours.
- Add a DB test: a pre-existing submitted bid plus a $0 quote keeps its amount.

### BL-2: Typed footage on a branch/site "NEEDS FOOTAGE" line double-counts with the ratio lines
**Where:**
- `footageSpecPricing.ts` (Q4) prices `NEEDS FOOTAGE — Branch circuit conduit/wire 1/2" EMT 2#12 1#10G` per foot once a qty is typed. Its evidence even invites this.
- `computeFootageAllowance` never sees that typed qty. `planFootageGiven` only looks at Agent 2's own `footage > 0`.

**Repro** (pure, stored 36th run, seed library, app defaults):
- Baseline after B1–B4: $14,263.10.
- Type 670 ft on the branch NEEDS FOOTAGE line → $16,700.38 (**+$2,437.28**).
  - That line prices at $0.79/ft + 0.0462 h/ft, i.e. 1/2" EMT + 2×#12 + 1×#10.
  - The ratio lines still carry 521 ft EMT, 1,531 ft #12, 1,358 ft #10 and 213 ft MC.

The same shape exists on Kissimmee 9/28:
- `NEEDS FOOTAGE — Site lighting underground conduit and wire to poles S1/S2` sits beside `Site lighting conduit allowance — PVC` (3 poles × 130 = 390 ft).

**Fix (pick one):**
- (a) `loadGeneratedTakeoffRows` reads the bid's current lines. If a branch-scope allowance line (`/branch/i`) has `qty > 0` (typed, or Agent 2's), emit the ratio EMT/#12/#10 at 0 with the existing "superseded" note. Do the same for site/pole allowances vs the PVC line.
- (b) Don't auto-price a branch-scope NEEDS FOOTAGE line. Point its evidence at the ratio lines instead.

Add a test that types a qty on the 36th branch line and asserts the total rises by at most the difference between the two quantities.

### BL-3: Agent 2 branch footage > 0 zeroes the ratio wire, and the allowance prices conduit only
**Where:**
- `allowanceRows`: footage > 0 → spec = the bare text, so the Q4 run-spec pricing (NEEDS FOOTAGE prefix only) no longer applies.
- `planBranchFootage` → the ratio EMT and wire go to 0.

**Repro** (pure, 36th run, allowances[0].footage = 670 and allowances[1].footage = 100):
- `Branch circuit conduit/wire 1/2" EMT 2#12 1#10G` maps **fuzzy → EMT-050** (1/2" EMT only).
- The ≈2,010 conductor-ft of #12/#10 is priced nowhere, because the ratio wire lines are 0.
- `HVAC feeders 3/4" 3#6 1#10G` at 100 ft is unmatched ($0).
- Total: $13,368.27. That is **lower** than the no-footage run ($14,263.10), even though the plans gave *more* information.

This is exactly the partial price Q4 forbids, reached by the sibling path.

**Fix:**
- Run `priceRunSpec` on every B1 allowance line that carries a conduit + conductor spec, not only the ones with the NEEDS FOOTAGE prefix. For example, test the takeoff key prefix `Allowance — `, or keep a marker in `spec`.
- When not every part resolves, leave the line unmatched (visible as unresolved), never fuzzy-matched to one part.
- Test both allowances above.

### BL-4: A re-sync adds the allowance on top of branch wiring the estimator already carries
**Where:** `computeFootageAllowance` ignores:
- the bid's existing manual lines;
- LF conduit/wire rows already in Agent 2's `takeoff[]` (`planFootageGiven` only checks `allowances[]` whose item says "branch").

**Repro** (DB, electrical_crm_test, Phase A bid):
1. Set up a takeoff of 20 duplex + 30 troffers.
2. Add the estimator's manual lines: `3/4" EMT` 670 LF and `#12 THHN` 3,660 LF.
3. POST sync-takeoff → 4 lines are added: 330 ft EMT, 969 ft #12, 859 ft #10 and 237 ft MC. The grand total goes up by **+$1,629.78**, while the hand-entered 670 ft / 3,660 ft stay.

Every existing bid whose branch wiring was typed by hand, which is how Chris-style jobs are carried today, double-counts on its next re-sync or re-run.

**Fix:** when the bid already has non-generated LF lines in the branch raceway/wire families, emit the ratio lines at 0 with a "superseded by your own lines: …" note. Do the same when Agent 2's takeoff has such rows. The rows stay visible, so nothing is silently lost.

---

## Should-fix

- **SF-1: Demolition detection keys only on the literal word "Demolition"** (`mapper.ts` `isDemolitionText`).
  - Repro: `{category:'Demo / Removals', spec:'Demo existing 2x4 fluorescent fixtures'}` maps **fuzzy → LTG-TROF24**, a *new* 2x4 troffer: a demolition line priced as an install.
  - `Remove existing receptacle` maps to nothing, which is safe.
  - Fix: widen the regex to `\bdemo(lition)?\b` and "remove/removal … existing" / "existing … to be removed", for both the line and the candidate. Keep "never pair across".
- **SF-2: v2 wire model disagrees with v1.**
  - v1 wire = EMT × 5.54 × (conductors/3). That is Chris's conductor-ft per conduit-ft, which exceeds 3 because homeruns share raceway.
  - v2 wire = route × conductors (3), while v2 EMT gives every circuit its own homerun (no shared raceway).
  - So when v2 is accepted, EMT runs high and wire runs about 46% low at equal footage.
  - The 40% gate hides this today (36th: 3,456 vs 541, rejected). Fix it before v2 is trusted:
    - share the trunk (a Steiner-ish union per panel) for EMT;
    - keep wire = circuit-ft × conductors.
- **SF-3: A measured EMT (apply-markups on the EMT allowance line) doesn't move the wire lines.** They stay at ratio EMT × 5.54. Derive wire from the measured conduit, or say in the wire evidence that it is still ratio-based.
- **SF-4: Settings validation.**
  - `PUT /api/settings` stores `est_footage_ratios` / `est_cost_line_defaults` unvalidated. Bad JSON silently falls back to defaults at use time, and a non-string value 500s on `.trim()`, which is the pre-existing pattern.
  - The UI (`JsonNumberSettingPanel`) silently skips negative or blank fields but still shows "Saved".
  - Validate server-side (parses, known numeric fields finite and ≥ 0, `wire10Share` ≤ 1) → 400. Show field errors in the UI.
  - Authz is fine: `requireAdmin` = owner/administrator/manager, and all three have `manage_settings`.
- **SF-5: Calibration report drift.** `recapForCalibration` prices proposed lines, which now include the allowance lines, so per-category deviations gain a "Branch Wiring (allowance)" bucket. Exclude it, or call it out on the report.
- **SF-6: Report hygiene.** `2026-09-29-footage-allowance-report.md` repeats "B1" and "B2" twice (lines ~101–185 duplicate the section above). The duplicated v2 paragraph still says "then the larger is used and flagged", which contradicts Q3.

## Verified OK
- **(a) Chris's reproductions:** `accubidRecap.test.ts` (six jobs, to the cent) passes unchanged on the merged tree.
- **(a) No price change on load:** `resolveLines`'s Q4 path only fires on `NEEDS FOOTAGE — ` descriptions, which no pre-existing line has. Saved item/assembly matches aren't re-mapped on load. GET routes never seed.
- **(b) Units:**
  - Qty is raw feet throughout.
  - `pricing.ts` divides by the library unit's divisor (LF 1 / C 100 / M 1000).
  - `priceRunSpec` divides `item.material_cost`/`labor_hours` by the item unit's divisor.
  - Demo per-C rates are stored per EA (13.2 h/C → 0.132).
- **(b) Math:**
  - MC = fixtures × 7.89.
  - Site PVC = poles × 130; poles are excluded from EMT points.
  - Wire (v1) = EMT × 5.54 × conductors/3, with conductors parsed from the branch text (36th: `2#12 1#10G` → 3).
  - Demolition rows never count as points: combined 36th devices = 5 + 2 + 9 + 6 = 22, and the 18 demo receptacles are excluded.
- **(b) Overrides:**
  - `qty_overridden` survives sync, because the takeoff key is `category||item` and the item never carries footage.
  - A markup-confirmed qty keeps its qty and gets the "Measured on the plans … replaces the allowance" evidence.
  - A manual override keeps the estimator's reason.
- **(c) Q3:** `ft_per_pt`/`scale_source` are written only by `setSheetScale` (confirm or calibrate). Migration 109 moved every old indexer guess into `suggested_ft_per_pt`. `geometryFromCount` reads only `calibrated`/`titleblock`, and rejects v2 above 40% (ratio kept, flagged).
- **(d) Q4:** all-or-nothing on NEEDS FOOTAGE lines (exact/alias item matches only, else null). `match_source === 'manual'` is respected; the only values are `auto` and `manual`. Line material/hours overrides still win in `pricing.ts`.
- **(e):** a normal install line never maps to a DEMO-* item (`Duplex receptacle` → DEV-DUP exact). Chris's 36th demolition prices to 21.734 h, $0 material.
- **(f) Migrations 150/151:**
  - Idempotent: `ON CONFLICT (code) DO NOTHING` on the UNIQUE `est_items.code`, insert-if-absent settings, `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, drop+add CHECK.
  - Safe on the live shape: no rewrites of existing rows.
  - The only live-data gap is the missing seed backfill (BL-1).

---

## Integration check (A `e5969ce` + B `7d93db9` on main `7a69928`)
**Setup:**
- Scratch worktree `../Electrical-program-wt-ab-trial`, **detached** off main. main is checked out in Local Version, so a branch checkout was not possible, and no real branch was touched.
- Both merged with `--no-ff`.
- The worktree was removed afterwards.

**Conflicts:** none. The two branches touch **zero common files**. A left mapper.ts, reviewItems.ts and the migrations alone; B touched none of A's counter/countTargets/reviewItems/legend files. Migrations: A added none (148–149 still free), B added 150–151.

**Typecheck:** backend `tsc --noEmit` clean; frontend `tsc --noEmit` clean.

**Tests** (electrical_crm_test):

| Suite | Result |
|---|---|
| `src/estimating/**` + `src/test/estimating*` + both 36th replays + Kissimmee replays/evidence | 42 files / 576 tests, all pass |
| `thirtySixthStreetReplay` (B), `remodel36thReplay` (A), `accubidRecap`, `kissimmeeLive0928Replay`, `kissimmeeLiveReplay` | 5 files / 55 tests, all pass |
| Frontend `src/features/settings` + `src/features/estimating` | 36 files / 653 tests, all pass |

**A's Demolition lines → B's demolition units, end to end:**
- I ran A's real replay (`replay36th()`, remodel mode, mocked counter).
- Its 6 `Demolition` rows came out as they are emitted: item = B's unit name; spec = A's evidence text, e.g. "Existing to be removed — counted A3.0 52 (DEMO-FIXTURE 52)".
- Through `fromLegacyTakeoff` + B's mapper, all **6/6 map exact** to DEMO-FLUOR24 / HIDHB / EXITEM / RECEPT / SW1P / SW3W, via the item text as altText.
- They price at 0.31 / 0.58 / 0.50 / 0.132 / 0.128 / 0.155 h, $0 material: 21.734 h, Chris's exact demolition hours.

**Combined 36th replay:**
- **Inputs:** B's stored Agent 2 takeoff with A's real replay counts applied (duplex 14→5, 42 3→0, GFI 7→0; everything else unchanged), plus A's 6 demolition rows, plus B1–B4.
- **Recap:** full Accubid recap at app defaults, on the seed library.

| Scenario | Selling | vs $23,230.14 | Hours |
|---|---|---|---|
| A + B, H still a pending suggestion (A2 never counts it unconfirmed) | **$13,301.85** | −42.7% | 99.3 |
| A + B, H confirmed as A's mocked answer "4ft LED strip, surface mounted" | $15,346.76 | −33.9% | 115.6 |
| A + B, H confirmed as a LED high bay (Chris's BOM: 2'x4' LED high bay, 1.0 h/E, quoted) | **$18,245.48** | −21.5% | 125.36 |

- The last row equals B's hand-estimated "after A" to the cent, which confirms B's estimate of A's effect.
- The price depends heavily on how the estimator names H.
- The ±20% target is still missed by 1.5 points for the reasons B lists: unmeasured feeders, unmatched equipment connections, box/fitting hours, and the seed labor units.

## Merge order
Fix BL-1…BL-4 on this branch, with a test for each. Then merge A, then B. No conflict work is expected. After merging, re-run the combined probe above. The rows should not change, except that BL-3/BL-4 may add a note.

---

# Addendum: fix round re-check (`7bb9df9..6d7bab1`)

**Verdict: NOT READY.**
- BL-1…BL-4 and SF-2…SF-6 are fixed as claimed.
- The new one-source-per-scope rule (`wiringScopes.ts`) adds three pricing blockers of its own.
- SF-1 now over-matches.

I re-ran my scratch repros and new probes in a throwaway merged worktree (removed afterwards). They ran on `electrical_crm_test`, with no model calls.

## Original findings: status
| Finding | Status | Evidence |
|---|---|---|
| BL-1 | Fixed | Submitted bid + $0 quote: `bids.amount` $11,382.85 → $11,382.85, 0 cost lines. A `due` bid with backfilled seed rows: 0 lines. The stage gate `['due']` matches the only bid stages (`due/submitted/awarded/lost`, migration 002). |
| BL-2 | Fixed | 36th, typed 670 ft on the branch NEEDS FOOTAGE line: $14,052.29 (was $16,700.38). Ratio EMT/#12/#10 = 0; MC 213 ft kept. |
| BL-3 | Fixed | Agent 2 branch 670 ft + HVAC 100 ft → full conduit + wire sets, $14,628.69 (was $13,368.27). A NEEDS FOOTAGE line with no resolvable spec now stays unresolved instead of fuzzy-matching. |
| BL-4 | Fixed | My DB repro: manual 670 ft EMT + 3,660 ft #12 → the EMT/#12/#10 allowances are 0; MC 237 ft kept (its own scope). |
| SF-1 | Fixed, but over-broad | See NSF-1. |
| SF-2 / SF-3 / SF-5 / SF-6 | Fixed | Code read + B's tests pass. |
| SF-4 | Fixed | `estimatingRuleSettingsValidation` (400, nothing stored) and the UI tests pass. |

## New blockers

### NB-1: A re-sync of an existing bid wipes the estimator's override on an Agent 2 combined run
An LF takeoff row that reads as a full run (conduit + conductors) is now expanded into parts with **new keys** (`Branch Power||9.1 — conduit`, `— #12 wire ×2` …).

**Repro (DB):**
1. Agent 2 row `9.1` "Branch circuits 3/4" EMT w/ 2#12 1#12G", 500 LF.
2. The bid's existing line on key `Branch Power||9.1` has `qty_overridden`, 650 ft (the estimator's measured number).
3. **Sync 1:**
   - The 650 ft line becomes `[No longer in takeoff]` and excluded.
   - It still counted as the estimator's branch footage when the scope was decided, so the new parts are **0** and the ratio EMT/#12/#10 are **0**.
   - Branch wiring prices at **$0**.
4. **Sync 2:** the excluded line no longer counts, so the parts jump to Agent 2's 500 ft (and 1,000 + 500 ft #12). The estimator's 650 ft is gone for good, and the price flips between syncs.

**Fix:** don't expand a row whose existing line is overridden, markup-measured or manually matched; keep it as one line. Alternatively, carry the override onto the parts (part qty = override × per-ft). In either case, never count a line as the scope's source in the same sync that vanishes it.

### NB-2: Low-voltage lines count as branch, and any user LF line zeroes the whole branch ratio
- `scopeOfText` puts all of these in **branch**: "1" EMT telecom", "3/4" EMT for Cat6", "CCTV conduit 3/4" EMT", "Intercom wire", "Speaker wire", "Thermostat wire 18/2", "Audio/visual conduit", "TV conduit", "Doorbell wire", "Nurse call conduit", "EMS/BAS conduit", "0-10V dimming wire #18".
- The exclusions do catch data, telephone, security, fire alarm, "low voltage", grounding/bonding/rod/electrode, and control/access control.
- Separately, **any** user LF line in branch scope zeroes the entire ratio. On the stored 36th run:
  - a manual 40 ft "1" EMT telecom" line takes the price from $14,263.10 to **$11,723.15 (−$2,539.95)**;
  - a manual 20 ft "3/4" EMT" extra run gives the same result.

**Fix:**
- Widen the exclusions: telecom|tel/data|cat ?\d|cctv|camera|intercom|speaker|audio|a/?v|\btv\b|thermostat|doorbell|nurse call|bas|ems|0-10v|dimming low-voltage.
- Make the user source **subtract**, not zero: ratio − user footage, floor 0, with the evidence saying so. An alternative is to zero the scope only on the scope's own lines (the ratio lines, or the NEEDS FOOTAGE / markup-measured branch line). A small extra run then never deletes hundreds of feet, and a full re-take still never double-counts.

### NB-3: The feeder scope is multi-run, but it is decided scope-wide
Feeders are discrete runs. The estimator typing 80 ft on one MEASURE FEEDER line (e.g. `2" conduit, 4#3/0 + 1#6G — Panel B`) zeroes Agent 2's footage for a **different** feeder.

**Repro:** HVAC `3/4" 3#6 1#10G` at 100 ft → conduit 100, #6 300, #10 100 all go to 0. The price drops $576.42 ($14,839.52 → $14,263.10 in the pure recap) and the note says "replaced by your entered/measured footage".

Kissimmee 9/28 emits 3 separate feeder groups (DISCON A/B, METER, RTU-1/2), so this will happen on real jobs.

**Fix:** decide the feeder source per feeder (the `parseFeederSpec` key and destination), not per scope.

## New should-fix
- **NSF-1: The SF-1 regex now flags some new work and relocations as demolition.**
  - Relocations and replacements become demolition:
    - "Relocate existing receptacle (remove and reinstall)" → **DEMO-RECEPT** (alias);
    - "Duplex receptacle, replace removed device" → **DEMO-RECEPT**.
  - A's rule says relocated = install. These now price at 0.132 h / $0.
  - "Demo kitchen pendant (Demonstration kitchen)" → DEMO-RECEPT (fuzzy).
  - No real 36th or Kissimmee line is flagged, and no seed item is mis-flagged.
  - Fix:
    - exclude relocate / reinstall / replace;
    - anchor "remove" to the start of the text or to the category;
    - allow only exact/alias matches for DEMO-* items, never fuzzy.
- **NSF-2: `scopeOfText` stray classifications** (these matter only for LF lines):
  - "Single pole switch" → site (`\bpoles?\b`);
  - "#4 CU GEC to water main" and Kissimmee's "GEC #2 CU to water pipe and building steel" → feeder (a GEC is grounding);
  - "#8 THHN branch (voltage drop)" → feeder;
  - "(6) power poles #1-#6" → feeder.
- **NSF-3: Migrations 150/151 were amended in place, but the runner keys on filename** (`schema_migrations.filename`).
  - A DB that already ran the earlier versions never receives the amendments. `electrical_crm_test` ran both today (20:21 / 20:26): its DEMO-* aliases are still the old ones, and only 205 of 60,415 bids have seed rows (no backfill).
  - **Live is unaffected:** Local Version's migrations stop at 147, so live will run the final 150/151 once.
  - Either put the amendments in an idempotent `152_…` (the alias UPDATE for the DEMO-* codes plus the seed backfill, `ON CONFLICT DO NOTHING`), or re-apply them to the test DB by hand. As written, both SQL files are idempotent on a fresh DB.
- **NSF-4:** typing a footage on an unresolvable NEEDS FOOTAGE line without picking a match zeroes that scope's ratio. Meanwhile the line itself is unresolved at $0. It is visible as unresolved, but the price drops until a match is picked. Keep the ratio until the line resolves.

## Integration (re-run)
- **A:** feat/remodel-reading's fix round had landed. I merged its head at the time, **`41734f4`** (31511ca…41734f4, including migration 148). Two more A commits landed afterwards and are **not** in this merge: `286c6b0` S6 and `1321890` S7. They touch only A's counting stage and review items, none of B's files.
- **B:** `6d7bab1`.
- **Merge:** onto main `7a69928` in a detached scratch worktree. **No conflicts**, and no files in common. Migrations 148, 150, 151.
- **Typecheck:** backend and frontend clean.
- **Tests:**
  - `src/estimating/**`, `src/test/estimating*`, `rerunReset`, the calibration tests, both 36th replays and the Kissimmee replays/evidence: 46 files, 628/629 pass.
  - The one failure is `estimatingLibrary` "editing a SEEDED item". The test DB has no `source='seed'` items left (837 manual, 150 calibrated) because of earlier test runs. It is not caused by either branch.
  - accubidRecap (Chris's 6 jobs, to the cent), thirtySixthStreetReplay, wiringScopes and ruleSettingsValidation: 40/40.
  - Frontend settings + estimating: 36 files, 655/655.
- **A's Demolition rows → B's units:** 6/6 exact. They price at Chris's rates (21.734 h, $0 material).
- **Combined 36th replay** (A's real replay counts: duplex 14→5, 42 3→0, GFI 7→0, H 13 unlisted/pending; plus A's demolition rows; B fix round):

  | Type H | Price | vs Chris's $23,230.14 |
  |---|---|---|
  | Not counted (pending the estimator's confirm) | $13,301.85 | −42.7% |
  | Confirmed as A's mocked "4ft LED strip" | $15,346.76 | −33.9% |
  | Confirmed as an LED high bay (Chris's BOM) | $18,245.48 | −21.5% |

  These are unchanged from the first round: the fix round doesn't affect a run with no footage and no user lines.

---

# Addendum 2: final re-check (`9982606..cbab656`)

**Verdict: NOT READY. One blocker remains (NB-4), and it is new in this round.**
- Everything from the last addendum is fixed: NB-1, NB-2, NB-3 and NSF-1…NSF-4.
- Migration 152 is correct.
- Changing the precedence to "Agent 2's run beats the estimator's generic lines" creates a double count that the previous round did not have.

I re-ran the scratch repros in a throwaway merged worktree (removed afterwards). They ran on `electrical_crm_test`, with no model calls.

## Earlier findings: status
| Finding | Status | Evidence |
|---|---|---|
| BL-1 | Holds | Submitted bid + $0 quote: $11,382.85 → $11,382.85, 0 cost lines. |
| BL-2 | Holds | 36th, 670 ft typed on the branch NEEDS FOOTAGE line: $14,363.98. Subtraction leaves EMT 0, #12 466, #10 413; MC 213. |
| NB-1 | Fixed | DB: an Agent 2 run of 500 ft, overridden to 650 ft. Three syncs, the third after Agent 2 re-reads 520 ft: the parts stay at 650 / 1,300 / 650 (`qty_overridden`, source manual) every time, the total is stable at $1,888.25, and the ratio lines are 0. |
| NB-2 | Fixed | A manual 40 ft "1" EMT telecom" line leaves the allowance untouched (EMT 521). A manual 20 ft 3/4" EMT line takes EMT from 521 to 501, and the price stays at $14,263.10. The whole low-voltage battery gets no scope: telecom, Cat6, CCTV, intercom, speaker, thermostat, A/V, TV, nurse call, EMS/BAS, 0-10V, GEC. "Single pole switch" also gets no scope. |
| BL-4 | Holds | The manual lines take the EMT/#12/#10 allowances to 0; MC 213 ft stays. |
| NB-3 | Fixed | Typing 80 ft on the Panel B MEASURE FEEDER leaves Agent 2's HVAC feeder at 100 / 300 / 100. Kissimmee's feeders stay three separate runs (DISCON A/B, METER, RTU-1/2). |
| NSF-1 | Fixed | "Relocate … (remove and reinstall)" → no match (unresolved, visible). "…, replace removed device" → DEV-DUP. "Demo kitchen pendant (Demonstration kitchen)" → LTG-PENDANT. "2x4 LED troffer (replaces existing)" → LTG-TROF24. "Demo / Removals" 2x4 fluorescent → DEMO-FLUOR24. A's six real rows → 6/6 exact. |

## Migration 152
- The test DB ran 150 at 20:21, 151 at 20:26 and 152 at 21:28.
- I ran 152's 9 statements twice more inside a rolled-back transaction, with fixtures:
  - one DEMO row set to `source='seed'` with old aliases;
  - one DEMO row set to `manual` with custom aliases;
  - the cost rule set back to the old 151 value.
- **First run:**
  - The seed row gains the aliases; the manual row is untouched.
  - The old rule is moved to 7.3 / 270 / 2500.
  - 1,690 seed rows are inserted: the 843 bids created since, × 2 kinds, less existing rows.
- **Second run:** every statement affects 0 rows.
- **With an edited rule:** 0 rows; the edited value is kept.
- **A bid inserted after 152:** has no seed row, so it still gets defaults, and only on stage `due`.

152 is idempotent, never touches edited rows, and marks only the bids that exist when it runs.

## NB-4 (blocker, new): Agent 2's run and the estimator's generic lines are both priced
When a scope has a complete Agent 2 run, the decision is now `source 2` even if the estimator has their own LF lines in that scope. The ratio lines go to 0, but:
- Agent 2's run parts are priced in full;
- the estimator's manual lines are still priced too.

The only warning is a note on the zeroed ratio lines. The Agent 2 parts and the manual lines carry none.

**Repro (DB, sync-takeoff):**
- Setup: Agent 2 `9.1` "Branch circuits 3/4" EMT w/ 2#12 1#12G" 500 LF, plus the estimator's manual 670 ft 3/4" EMT and 3,660 ft #12. This is the BL-4 bid shape.
- Result:
  - 500 ft EMT + 1,500 ft #12 from Agent 2;
  - **and** 670 ft EMT + 3,660 ft #12 manual;
  - both priced.

**Pure recap on the 36th run:**
| Setup | Price |
|---|---|
| Manual lines only | $14,790.45 |
| Agent 2 run only | $13,635.99 |
| **Both** | **$16,826.06** |

The same thing happens when the estimator marked up the ratio EMT line itself (670 ft, `markup`). That line keeps its 670, and Agent 2's 500 ft run is added on top: $15,614.26. That line's evidence says "replaces the allowance" and nothing about Agent 2.

**Fix:**
- Apply the NB-2 subtraction to whichever source carries the scope. If Agent 2 wins, take the estimator's generic conduit-ft / conductor-ft off Agent 2's run parts (floor 0, with the arithmetic in the evidence).
- Alternatively, restore "estimator > Agent 2" for generic lines. Keep NB-1's run-own overrides as they are.
- In the same pass, count a measured ratio-EMT line as the estimator's branch footage.

## Should-fix (non-blocking)
- **Parallel sets.**
  - `(2)4#3/0 2"C` → 8#3/0 in **one** 2" conduit. Kissimmee's METER feeder is `2"|8#3/0`. Each parallel set runs in its own raceway, so the MEASURE conduit line needs ×sets (two 2" runs); the wire math is right.
  - `(3) 3#12 1#12G 3/4" EMT` → 9#12 + **1** ground (ambiguous).
- **kcmil sizes.** `4#500kcmil` parses as **#50**: `WIRE_SIZE` tries `\d{1,2}` before `\d{3}\s*kcmil`. This was already there in round 1. The part never resolves, so it is visible, not mispriced. `(2) sets …` isn't recognized.
- **Scope edges.**
  - "Motor control center feeder 2" EMT 4#1/0" → **no scope**: `\bcontrols?\b` fires on "motor control center".
  - "Controls power 120V …", "Fire alarm panel 120V circuit …", "Security system power circuit …", "Data rack dedicated circuit …" and "TV receptacle circuit …" → no scope. These are power circuits. The effect is conservative: they neither subtract nor expand. An Agent 2 LF run row worded that way prices through the plain mapper, i.e. possibly partially.
  - "EV charger circuit 1-1/4" EMT 3#6" → branch, so its #6 would come off the #12/#10 allowance.
  - Real Kissimmee lines classify sensibly. The RTU photocell → feeder is harmless, since it is EA.
- **Demolition edge.** A lot line "Demo all existing lighting, receptacles and switches" → DEMO-RECEPT (fuzzy): one receptacle's 0.132 h for a lot. Consider "no class when more than one class is named".
- **Test DB drift.** The test DB has no `source='seed'` items (`estimatingLibrary` "editing a SEEDED item" fails on either branch).

## Integration (re-run)
- **A:** feat/remodel-reading **current head `bc55bc6`**, "docs: report — decisions Q1 / Q2 …", which includes `b278866` Fix Q2 and `45dfd14` Fix Q1.
- **B:** `cbab656`.
- **Merge:** onto main `7a69928`, detached scratch worktree. **No conflicts**; migrations 148, 150, 151, 152.
- **Typecheck:** backend and frontend clean.
- **Tests:**
  - estimating, the replays, rerunReset and calibration: 46 files, 643/644 pass. The one failure is the `estimatingLibrary` test-DB drift above.
  - accubidRecap (Chris's six jobs, to the cent), thirtySixthStreetReplay, wiringScopes and demolitionPricing: 53/53.
  - Frontend settings + estimating: 655/655.
- **A's Demolition rows:** 6/6 exact to DEMO-* at Chris's rates.
- **Combined 36th** (A duplex 14→5, 42 3→0, GFI 7→0, H 13 pending):

  | Type H | Price | vs $23,230.14 |
  |---|---|---|
  | Not counted | $13,301.85 | −42.7% |
  | Confirmed as a 4ft LED strip | $15,346.76 | −33.9% |
  | Confirmed as an LED high bay | $18,245.48 | −21.5% |

  Unchanged, since this path has no user lines and no Agent 2 footage.

---

# Addendum 3: final check (`ce9150f..9e7deb3`)

**Verdict: READY.**
- NB-4 is fixed, and NB-1 still holds.
- No blocker remains.
- The parser and scope changes are right on every real 36th Street and Kissimmee line.
- Three should-fixes remain. Each is visible to the estimator, none double-counts, and none silently zeroes anything. They can go in a follow-up.

I re-ran the scratch repros in a throwaway merged worktree (removed afterwards). They ran on `electrical_crm_test`, with no model calls.

## NB-4: fixed
Setup: Agent 2 run `9.1` "Branch circuits 3/4" EMT w/ 2#12 1#12G" 500 LF, on the 36th run (pure recap).

| Setup | Before this round | Now |
|---|---|---|
| The estimator's manual 670 ft EMT + 3,660 ft #12 only | $14,790.45 | $14,790.45 |
| Agent 2's run only | $13,635.99 | $13,635.99 |
| **Both** | $16,826.06 | **$14,790.45**. Agent 2's parts are reduced to 0 / 0 / 0, with the arithmetic in the evidence. |
| A 100 ft manual EMT line + Agent 2's run | — | Agent 2 conduit 500 → 400, wire unchanged, $13,635.99 (100 in, 100 out) |
| The measured ratio-EMT line (670 ft, `markup`) + Agent 2's run | $15,614.26 | **$14,130.49**. Agent 2 conduit → 0; the wire (1,000 + 500) stays. The measured line replaces conduit only, as it should. |

**DB sync repro** (the same bid shape, two syncs): only the estimator's 670 ft / 3,660 ft lines carry a qty. Agent 2's parts and the ratio lines are 0. The total is stable across syncs.

**NB-1** still holds: three syncs, the parts stay at 650 / 1,300 / 650 (`qty_overridden`), and the total is stable.

## Spot checks
**Parallel sets and kcmil: correct.**
- `(2)4#3/0 2"C` → 2" conduit ×2, 8#3/0. This is Kissimmee's METER feeder (`2"×2|8#3/0`, sets 2).
- `(2) sets 4#500kcmil 1#1/0G 4"C` → ×2, 8#500 kcmil, 2#1/0G.
- `2 sets of 4#350 MCM` → 350 kcmil.
- `4#250kcmil` → #250 kcmil, no longer #50.
- Unchanged, as they should be: `4#3/0,#6G,2"C`, `2"C (4) 3/0 CU #6 G` and `(2)#10 1#10G`.
- Kissimmee's DISCON A/B feeder and RTU-1/2 are unchanged. The 36th has no feeders (the HVAC feeder is Agent 2's allowance).
- MEASURE-derived wire uses the route: conduit-ft ÷ sets.

**MCC and equipment scope:**
- "Motor control center feeder 2" EMT 4#1/0" → feeder; "MCC 2" EMT 4#1/0 1#6G" → equipment.
- These go to equipment, never branch: "EV charger … 3#6", "Range 50A … 3#6", "Equipment circuit … 3#8".
- These stay branch: "Water heater … 2#10", "Pump … 3#10", "Kitchen equipment circuits … 3#10".

**Real lines:**
- Every scoped real 36th and Kissimmee line lands where it did before this round, or better.
- The Venstar and control lines that now pick up a scope ("Conduit only Venstar HVAC control" → feeder, "Conduit and wire Venstar lighting control system" → branch) are all LS/EA/LOT/RUN on Kissimmee, so they're inert: scopes act only on linear lines.

**Demolition:** A's six real row shapes still map 6/6 exact. "Demo all existing lighting, receptacles and switches" is unresolved and asks for a breakdown, as intended.

## Should-fix (non-blocking)
- **SF-A: the low-voltage power-circuit exception is too wide.**
  - A conductor spec alone makes an LV line count as power. These now go to **branch**:
    - "Fire alarm conduit 3/4" EMT 2#14 THHN (NAC)";
    - "Fire alarm 3/4" EMT, #14 THHN, FPLP";
    - "Low voltage lighting control 3/4" EMT #14 THHN".
  - An estimator's manual LF line like these is subtracted from the branch EMT/wire allowance, so branch is under-carried by that footage. It is visible in the ratio lines' evidence and is not a double count.
  - Fix: require a real power marker (a breaker "20A/1P", "120V … circuit", "dedicated/power circuit"). Or never count #14 on an LV-named line. Consider also excluding by line category (Low Voltage / Fire Alarm / Telecom).
  - "Security cameras power … 20A/1P breaker" → branch is correct.
- **SF-B: lump-sum / multi-class demolition over-fires on common wording.** These are now **unresolved** (visible, $0 until the estimator picks a unit):
  - "Remove existing light switch": "light" + "switch" reads as two classes. Last round it mapped to DEMO-SW1P.
  - "Remove existing 2x4 fluorescent fixture complete with lamps": "complete" reads as lump-sum.
  - "Existing to be removed — all 18 on A2.0 (Duplex receptacle 18)": "all" reads as lump-sum.
  - "Remove existing duplex receptacle and cover plate at switch height" also goes unresolved.

  Fix:
  - Treat "light switch" as a switch.
  - Match lump-sum words only at the start ("demo all …", "lump sum", "lot") and not for "complete with" or "all N".
  - Add a test with A's spec template containing "all".
- **SF-C (older, visible): `(2) 20A/1P circuits 2#12 1#12G` parses a "(2) 20" as 2 #20 conductors.** The spec then doesn't resolve, so the line isn't priced (visible, not a misprice). `(3) 3#12 1#12G` is read as 3 raceways; that's arguable.

## Tests and merge
**Tests:**
- estimating, the replays and rerunReset: 45 files, 643/644 pass. The one failure is the known `estimatingLibrary` test-DB drift: no `source='seed'` items are left.
- This includes accubidRecap (Chris's six jobs, to the cent), the 36th replay, wiringScopes, demolitionPricing and footageAllowance.

**Merge:**
- feat/remodel-reading had moved beyond `bc55bc6`. Its current head is **`84938e1`** ("Re-check N2: normalize the legend matcher …"; `a2012ac` came before it).
- I merged `84938e1` + B `9e7deb3` onto main. **No conflicts.** Backend and frontend `tsc` clean.
- As requested, I ran no tests on the merge.
