# Real-Run Fix Round (Kissimmee live run): Adversarial Review

**Branch:** `fix/real-run-kissimmee`, range `8724d30..76b3f01` (7 commits).
**Reviewer:** Opus 5.5, independent and read-only.
- Two areas were swept in parallel: consolidation (focus 1), and the consistency pass, sheet references and review count (focus 3–5).
- Every blocker from the sweeps was re-checked by the lead against the code or by re-running the repro.
- I did poles, replay integrity and the receptacle trace against the live data and the real E-1/E-2 myself.
**Date:** 2026-09-24

**Verdict: MERGE AFTER FIXES (3 blockers).**
- The power-pole fix, the panel-schedule fix and the panel-row counts are right on the real sheets.
- Two parts of this round can still change quantities silently on real bids:
  - the dense-sheet consistency pass counts only the marks both passes agree on, so counts go *down*;
  - consolidation merges distinct items through a generic bridge name, and it merges letter-suffixed siblings.
- The 14/23 review count holds up, but two downgrades hide real questions (S11).

## Verification

| Check | Result |
|---|---|
| Backend `npm test` (1 full run) | **2118 passed, 3 failed, 4 not run** of 2125 (198 files). Matches the report. The failures are the known flakes: `intakeSimilarCache` ×2, the `integration` backfill timeout, and one worker crash. |
| Backend `tsc --noEmit` | clean |
| Repros | Run via `tsx` in the scratchpad against the real modules and the real live fixture. No repo files were edited, no DB was touched, and no API calls were made. |
| Live data | `calibration-data/kissimmee-live-run-2026-09-24/count_result.json`: marks, targets and tables |

## Focus-area answers

1. **Consolidation.**
   - DISCON A/B, RTU-1/RTU-2, PP#n, T against T-1/T-2, EF against EF-1/EF-2, and WH/EWH on different circuits do **not** merge wrongly.
   - The 5 types counted from panel rows are right against E-4 Panel A/B:
     - ALC PANEL B-25 = 1;
     - WH A-27 = 1;
     - FRONT WALL SIGN A-6 = 1;
     - SIDE WALL SIGN A-14 + A-16 = **2**. E-3 shows separate "J-BOX FOR WALL SIGNAGE" callouts on both long walls, and SIGN-JB's 3 plan marks equal 1 + 2;
     - PYLON SIGN A-18 = 1.
   - Merge failures are listed under B2, B3 and S2–S7.
2. **Power poles.** Verified on the real E-2 legend #9 and the main plan:
   - 8 duplex + 1 simplex;
   - parts pod ×2: tag 3 is drawn twice, on A-33 and A-35;
   - checkout A-29, tester B-20,24, counter A-40,42;
   - tag 5 is the data/security pipes, with no outlets.
   - Subtract-drawn-at-host is still applied; `drawnAtHosts` is 0 for every pole.
   - E-1's "duplex outlet at deck" sits **0.16"** from checkout pole #2 after alignment, but it is on A-31 (CCTV MONITOR) and the pole is on A-29. Not subtracting it is correct.
   - No pole outlet doubles a drawn duplex.
3. **Consistency pass.** Single-pass marks are only ever suggestions. But the count becomes the *agreed* subset (B1), and the matching and bounds need work (S8).
4. **Sheet references.** A real sheet can now be silently **dropped**, and a missing M-101 style sheet is downgraded to information (S9).
5. **Review 14/23.**
   - SGN101 as information is fine.
   - The legend-zero group holds no equipment.
   - Two downgrades hide real questions: the 209W note, and EF at zero (S11).
6. **Replay.**
   - The replay is faithful: it uses the live counter's own marks and circuits, and the readers' parsed output via the cache. Fidelity is asserted for every unfixed type.
   - E-4's viewport rectangles are measured.
   - E-5's rectangles are **invented** placeholders (`replay.ts` `rebuiltViewports` fallback `[58 + i*300, 500, …]`). That is harmless here, since only their titles matter to fix 4, but the report should say so (N1).
   - The consistency "second pass" is the earlier real run, not a shifted-grid read. The report says so.

## Blockers

### B1. The consistency pass counts only the marks both passes found, so a weaker second read lowers a correct count. **Reproduced (sweep, and code re-checked).**
- **Where:**
  - `backend/src/ai/countingStage.ts:663`: `placed = [...others, ...rec.agreed]`;
  - `backend/src/ai/evidence/consistency.ts:26`: `CONSISTENCY_MIN_AGREEMENT = 0.5`, compared with `<`;
  - `backend/src/ai/reviewItems.ts` "keep counted number" (`confirm`) keeps the agreed number;
  - `consistency.test.ts:91` codifies it (25 first, 24 agree → counted 24).
- **Scenario:**
  - First pass counts 70 type-A fixtures, and the shifted pass finds 50 of them. The count becomes **50**, and 20 real fixtures become "suggested".
  - At 35 of 70 (agreement exactly 0.5, not below the limit) the count is **35**. At 34 it is inconclusive and 70 stands: a cliff.
  - The shifted pass also uses the first-pass tile size, not the retry tile size (S8), so it predictably sees fewer on exactly the dense sheets it checks.
  - Kissimmee "stays 70/45" only because the replayed second read was a superset of the first.
  - The item is blocking, but its "keep" answer keeps the deflated number.
- **Fix:**
  - Count the first pass (agreed + onlyFirst). Suggest only the onlySecond marks, as possible additions.
  - Report onlyFirst marks as "not re-seen" information.
  - "Keep counted number" must mean the first-pass count.
  - Measure agreement as agreed ÷ first, and make the limit strict.

### B2. Consolidation chains two distinct items through a generic bridge name (transitive union). **Reproduced.**
- **Where:**
  - `backend/src/ai/evidence/consolidate.ts:256-289` (`union` over every compatible pair, then whole clusters are folded);
  - the comment at `:271` ("a cluster member whose phrase ALSO restates an entity outside its cluster is ambiguous: take it out") has no code behind it.
- **Scenario:**
  - FRONT WALL SIGN "Front wall sign", SIDE WALL SIGN "Side wall sign" and SIGN "Wall sign", with no circuits cited (a typical legend-only set).
  - The result: `SIDE WALL SIGN -> FRONT WALL SIGN [synonym]`, and SIGN is folded too. **3 signs become 1**, and the SIDE rows go to nobody.
  - The same chain through "Exhaust fan" folds a kitchen exhaust fan (KEF) into EF-A.
  - Kissimmee escaped only because its signs cite different circuits.
- **Fix:**
  - Merge a cluster only when **every pair** in it matches directly.
  - A name that restates two or more entities is never a bridge. It goes to the uncertain or `synonym:` question path.

### B3. Letter-suffixed siblings with a hyphen, or with a 1–2-letter base, are not treated as numbered, so they merge. **Reproduced (sweep, and the regex re-checked).**
- **Where:** `consolidate.ts:123`.
  - `numbered` only accepts a digit suffix, or "BASE X" with a base of 3+ letters and a space.
  - "EF-A", "EF-B", "WH-A", "DISCON-A" and "EF A" all get `num: null`.
- **Scenario:** EF-A and EF-B with identical schedule descriptions ("Exhaust fan, roof"), which is common. EF-B folds as a synonym of EF-A, **2 fans become 1**, and EF-B's rows go to nobody.
- **Fix:**
  - Accept `/^([A-Z]{1,8})\s*[-#]\s*([A-Z])$/` and `/^([A-Z]{2,}) ([A-Z])$/` as numbered.
  - More generally, two tags with the same base and different suffixes are never synonyms.

## Should-fix

- **S1. B-32 is still counted twice when the two sheets classify it as different receptacle types. Reproduced from the live marks.**
  - Where: `backend/src/ai/evidence/sheetRelation.ts` pairs per type only.
  - The live counter put B-32 as **DUPLEX** on E-1 (4.54", 9.37", circuit B32) and as **SIMPLEX** on E-2 #11 (circuit B32).
  - The replay's duplex drawn count of 6 (E-1 5 + #11 1) and simplex drawn count of 8 (E-1 3 + #11 5) both include it, so receptacles are **34, with the true figure 33**.
  - Fix: pair across the receptacle family (simplex/duplex/floor, never GFCI/WP) whenever the marks coincide after alignment **and** carry the same circuit tag. Count one, and raise a type question.
- **S2. A combined tag that cites its circuits counts 1** (`schedules.ts:619`, "circuits its own description cites feed ONE item"). Reproduced.
  - "RTU-1/RTU-2", citing B-1,3,5 / B-2,4,6 with no "(2)", gives qty **1**. The same happens when the RTU class folds into it.
  - Fix: for a target with `tag.members`, the floor is the member count. Better, expand it into member targets.
- **S3. Partial and 3-way combined tags.** Reproduced.
  - With only RTU-1 present, "RTU-1/RTU-2" is not merged (`consolidate.ts:230`). Its plan count stacks on RTU-1's schedule qty: **3**.
  - "RTU-1/2/3" is not parsed, so it folds as `restates` into RTU-1 + RTU-2. RTU-3 and "(3)" are dropped silently.
  - Fix: merge into the members that are present and create the missing ones. Parse `/n/m` and `& n`. Compare the alias's multiplier with the candidate count, and raise a question on a mismatch.
- **S4. Silent folds of different loads.** Reproduced.
  - Head phrase (`consolidate.ts:176-182, 267`):
    - CP "water heater circulating pump" → WH;
    - IWH "instantaneous water heater" → WH;
    - HOOD "kitchen hood exhaust fan interlock" → EF.
  - Same circuit (`:262`):
    - ICE MACHINE and DRINK MACHINE on A-6;
    - "Lighting contactor for pylon sign circuit A-18" → PYLON SIGN.
  - Union of circuits (`:233-243`): "TC time clock, controls sign circuits A-6, A-14" → FRONT + SIDE WALL SIGN, so the time clock is lost.
  - Fix:
    - Two equipment-schedule rows are two items by default. Fold only a legend or notes restatement.
    - Require compatible words as well as equal circuits.
    - Leave out circuits cited as controlled or served ("controls", "for … circuit").
    - Raise `synonym:` rather than fold when in doubt.
- **S5. `circuitRefs` phantom circuits.** Reproduced.
  - Where: `backend/src/ai/evidence/schedules.ts:498`.
  - "ckt A-6, 180 VA" gives A180; "A-1, 3 phase" gives A3; "circuit A-12, 3 fixtures" gives A3.
  - With no panel list, T-1, SP-1, CU-1 and P-4 all parse as circuits (the 2-letter fallback, `consolidate.ts:132`).
  - These feed the same-circuit and union rules in S4.
  - Fix: accept a continuation number only when a delimiter follows it, cap circuits at 84, and require a known panel.
- **S6. A generic legend symbol whose candidates have no marks is kept as a "different device".** Reproduced.
  - Where: `consolidate.ts:419-427`.
  - If P ("power poles") counts 6 on the plan and PP#1–6 are schedule-owned with no bound tag marks, then coincident = 0, "different", and **6 more pole lines stack on the PP#n quantities**. Live P counted 0.
  - Fix: when the candidates have no marks, or any is schedule-owned, raise `synonym:`.
- **S7. The "same device" answer drops the marks that did not coincide.**
  - Where: `reviewItems.ts:284-285` (`sumQty: 0`), enforced at `:1210`.
  - In the existing test (`consolidate.test.ts:121-141`), 1 of 2 sensors coincides, and "same device" drops both.
  - Fix: set the qty to count − coincident.
- **S8. Consistency pass mechanics:**
  - Greedy nearest-first matching at a 0.4" radius against 0.61" fixture spacing loses up to about 3 per 70 with 25 pt jitter, and up to 10 at 30 pt (reproduced). Use maximum matching, and a radius tied to the nearest-neighbour spacing.
  - A truncated second-pass call fails the whole run (`counter.ts:434/475` rethrows). Catch it and note it.
  - Suggestions come from raw marks before `resolveSheetMarks`, so legend, detail and enlarged-duplicate marks become suggested markers (`countingStage.ts:651-667`).
  - "Confirm the found marks" sets the count to the bid-wide confirmed tally. If only the suggestions are confirmed, the count becomes their number. Make it current count + confirmed consistency markers.
  - It uses `spec.tileIn`, not the retry tile size, on dense retried sheets (`countingStage.ts:625` against `:695`).
  - A supplement pass drops the consistency entries and the item's answer (`priorSheetResult`, `countingStage.ts:783`).
  - It is uncapped and uncached: one bounding box over every dense type means every shifted tile, and re-runs are nondeterministic.
  - Reproduced or reasoned per the sweep; I re-checked B1 and the tile-size lines.
- **S9. Sheet-reference filter.** Reproduced.
  - Where: `reviewItems.ts:1053` looks 12 characters **ahead** of the id for SPEC/SECTION/DIV and 8 ahead for 5–6 digits.
  - "E-9 (Div 16)", "E-9 Division 26 electrical", "Sheet E-8 SECTION 2 of plans" and "E-8, E-9 (spec div 16)" **drop the real sheet completely**, not even as information.
  - A Kissimmee-style learned pattern (1-digit E-sheets) downgrades a missing **M-101, P-201, A-201 or E-101** to information, with text calling it "another party's drawing". Mechanical sheets carry RTU/EF connection scope. "E4.1", "Sheet E 8" and "Refer to sheet E8" also become information in some sets.
  - Fix:
    - Anchor the spec test to text *before* or *at* the id.
    - An id with a known discipline prefix (A, C, E, FP, M, P, S, T …) and a separator stays blocking whatever its digit count.
    - Use the learned pattern only for unknown prefixes such as SGN.
- **S10. The pole-spec rule removes rows that are not light poles.** Reproduced.
  - Where: `backend/src/ai/countMerge.ts:902-913`.
  - The only test is a quantity equal to the counted site poles. "30' aluminum flag pole" ×3 and "20' camera pole" ×3 are removed as "the site light poles".
  - Fix: also require light/luminaire/site-lighting/photometric context or a PH source.
- **S11. Two downgrades that hide real questions:**
  - **The 209W note** (`reviewItems.ts:436-445`) becomes information whenever every site type has schedule heads, and the numbers are never compared. On Kissimmee the note says 2 per pole × 3 = 6 heads, the schedule 4, and S1 has 1 head per pole. The note conflicts; it does not restate. Reproduced. Fix: downgrade only when the note's per-pole quantity equals heads ÷ poles for every site type.
  - **EF at zero** is information because the new shorthand rule (`backend/src/bidstd/tradeAssignment.ts:72`, "HVAC install, EC wire") marks it a `connection` type, which is treated as outside APT scope. But the connection is APT's to price, so a zero there is missing labour. Reasoned. Fix: only `aptScope === 'none'` goes to information.
- **S12. A supplement on a pre-fix run can double a canonical count.** Reasoned.
  - Where: `countingStage.ts:275-277` remaps the prior marks' aliases, and `countMerge.ts:301/340` counts the raw marks.
  - If an old run counted both names on the same symbols, both sets become canonical.
  - Fix: remove duplicate remapped marks within the dedupe radius.

## Nits

- **N1.** E-5's rebuilt viewport rectangles in the replay are invented placeholders (`backend/src/test/fixtures/realrun/replay.ts`, `rebuiltViewports` fallback). Say so in the report.
- **N2.** PP#5 ("Two 3in PVC pipes labeled DATA and SECURITY") is counted as a PP# equipment line (1). It is not a power pole and has no power connection. Make sure it doesn't price as a pole connection.
- **N3.** Confirming a consistency suggestion logs a `gapfill_accept` labeled event, which mislabels the training data. Use a `consistency_accept` kind.
- **N4.** A non-legend class name folds without checking (`consolidate.ts:321`). A schedule row "DISCONNECT, NEMA 3R" folds into DS-1 + DS-2 even when there are untagged disconnects.
- **N5.** The baseflex notes-restatement absorption also swallows an unrelated "additional outlet in fixture base" note that has no quantity. This is narrow.

---

## Round 2: fix range 361f259..8ab3a7a

**Scope:** blockers and regressions only. Reviewed by Opus 5.5, read-only.
- The targeted run passed 25 files, **303/303**: `src/ai/evidence/*`, `realRunRefs`, `realRunReview`, `reviewItems`, the live replay, `kissimmeeEvidence`, `kissimmeeReviewNoise`, `consistencyEndToEnd` and `classConflict`.
- The Round 1 repros were re-run unchanged against the fixed modules: `repro1-4`, `cons1-2`, `refs`, `refs2`, `pole2` and `heads`, all in the scratchpad.
- No full suite was run. The worktree is clean.

**Verdict: MERGE.**
- All 3 blockers and every Round 1 should-fix are closed.
- There are no new blockers.
- Three new should-fix items (S13–S15) come from this round's own fixes. Each is narrow and has a small fix. They are best done before the next live run.

### Round 1 repros, re-run

| Finding | Result |
|---|---|
| B1 | **Closed.** Pass-1 marks always stay counted (`countingStage.ts:762-767`). 70 counted and 50 re-found gives **70**, plus a blocking item under 85%. Only pass-2-only marks are suggested. "Keep" keeps pass 1's count. |
| B2 | **Closed.** FRONT and SIDE WALL SIGN plus a generic "Wall sign" give 1 + 2 rows. SIGN is uncertain (counted by its marks) and never a bridge. KEF stays separate. |
| B3 | **Closed.** EF-A/EF-B, "EF A"/"EF B", WH-A/WH-B, DISCON-A/DISCON-B and UH-1A/UH-1B are all distinct: **2**. |
| S1 | **Closed.** B-32 is counted once, with an enforced class question. Receptacles are **33** (asserted in the replay). |
| S2/S3 | **Closed.** "RTU-1/RTU-2" citing circuits → 2. With only RTU-1 present, the combined tag folds into RTU-1 + a created RTU-2, never stacked. "RTU-1/2/3" gives RTU-3 as a member. RTU still folds into RTU-1/RTU-2 as a class, and PP into PP#n. |
| S4 | **Closed.** The circulating pump, the ice machine on the drink machine's circuit, the contactor for the pylon sign and the time clock controlling the signs all stay separate. See S13 for a new side effect. |
| S5 | **Closed.** "A-6, 180 VA", "2 HP", "3 phase" and "3 fixtures" give no phantom circuit. "A-2, 4-#12" still gives A4 (nit). |
| S6/S7 | **Closed.** P against schedule-owned PP#1–6 with no marks becomes a `synonym:` question. "Same device" drops only the coinciding marks. |
| S8 | **Closed.** Maximum matching (Kuhn's augmenting paths) with an adaptive radius: a 70-mark grid at 25–30 pt jitter is re-found 70/70. A truncated second pass is skipped with a warning. It is capped (3 sheets × 16 tiles) and cached. "Confirm" adds. |
| S9 | **Closed.** The real references I tried stay blocking. "E-9 (Div 16)", "Sheet E-8 SECTION 2", "E-8 (12345)", M-101, P-201, A-201, E-101, E4.1, "Sheet E 8" and "Refer to sheet E8" are all blocking. SGN101 is the only information item, and callouts ("1/E-5", "DETAIL 3/E4") give nothing. |
| S10 | **Closed.** Flag and camera poles are kept as unscheduled questions. |
| S11 | **Closed.** The 209W note is blocking, with 6 vs 4. EF at zero blocks. |

### Regression scan

- **The direct-evidence merge rule** still merges true synonyms: RTU → RTU-1/RTU-2 and PP → PP#n (class), PYLON/PYLON SIGN and ALC/ALC PANEL/LCP (replay-asserted). POWER POLES against PP#n is now uncertain (N4) and resolves through its marks or the `synonym:` question. No double count reappears on Kissimmee: RTU 2, pole outlets 8 + 1.
- **The Hungarian/Kuhn matching** is correct maximum-cardinality matching. Pass 1 always stands, so it cannot lower a count. Its only inflation path is a human confirming a suggestion (see S15 and N6).
- **Cache key:** `consistency:<types>:<tileIn>` plus `model|cs1` on the sheet's content hash. See N7.
- **Cross-type location + circuit pairing:** see S14.

### Should-fix (new in this round)

- **S13. An instantaneous water heater can now be counted twice: its panel row goes to WH, and IWH is counted from the plans. Reproduced (`repro2` "IWH vs WH").**
  - Where: `backend/src/ai/evidence/schedules.ts` `assignRow`/`rowNamesTarget`, via the S4 split in `consolidate.ts`.
  - Before this round, IWH folded into WH, so WH = 2 was right.
  - Now IWH ("Instantaneous water heater at hand sink") stays separate. But the Panel A row "INSTANT WATER HEATER" (A-29) matches only WH's lead words, because INSTANT ≠ INSTANTANEOUS. So WH = **2** from the rows, and IWH is sent to the counter as well. One drawn IWH symbol gives 3 heaters for 2 real ones.
  - Fix: a row whose description has qualifier words beyond a target's own (INSTANT, CIRC, PUMP …) is not that target's, or goes to the best-scoring target. When a split-off sibling exists, raise the ambiguous row as a `schedqty:` question.
- **S14. The class-conflict question cannot say "two receptacles". Reasoned.**
  - Where: `backend/src/ai/reviewItems.ts:648-656`. The options are only kept-class or dropped-class.
  - The pairing fires on the same circuit within 0.75" (1.0" through an enlarged plan). A counter duplex on E-1 and a floor simplex on E-2 #11 at one desk, both on B30, are two real devices, but the answer can only relabel one.
  - Fix: add a third option, "two receptacles — count both", that restores the dropped mark. Add the circuit to the fingerprint too (N8).
- **S15. Confirmed consistency markers outlive a re-run and are added again. Reasoned.**
  - Where: `backend/src/estimating/takeoffReview.ts:174-185` (`confirmedConsistencyMarkers` counts every confirmed `Consistency check` marker, of any age), and `:333` (`currentQty + confirmed`).
  - Re-run and reset clear only *suggested* markers.
  - Scenario: an estimator confirms 3 consistency suggestions (70 + 3 = 73), then re-runs. The new first pass finds 72, so it now includes 2 of those fixtures. The new item's "Confirm the found marks" gives 72 + 3 (stale) + any new ones, about **75**.
  - Fix: tally only markers whose `recheck_run_id` or created run matches the item's run, or those that don't coincide with a current first-pass mark.

### Nits

- **N6.** A second-pass double report of one symbol leaves an unmatched `onlySecond` mark about 0.1" from an agreed mark, and it is suggested. A careless confirm adds 1. Drop onlySecond marks within the radius of any first-pass mark.
- **N7.** The consistency cache key leaves out the cover rectangle and the first pass's marks. After a re-run whose first pass differs, a cached second pass over the old cover is reused, and the agreement figures come out stale. Add a hash of the cover tiles.
- **N8.** The `classconflict:` fingerprint leaves out the circuit, so two conflicts between the same sheet pair share one fingerprint.
- **N9.** "A-2, 4-#12" still reads A4. "E-8 thru E-10" yields E-8 and E-10 but not E-9, which is older behaviour.
- **N10.** A "12' pedestrian bollard light pole" row whose quantity happens to equal the counted site poles is still removed as "the site light poles". Compare the pole height or catalog as well as the quantity.
