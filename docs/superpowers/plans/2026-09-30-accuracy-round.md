# Accuracy Round (2026-09-30): Site-pole de-dup, power poles, automatic feeder lengths, zero-hour lines, site/underground, replay eval gate

**For Jake (plain language, 150 words max):**
The live AutoZone run priced $42.9k and 364 h. Chris priced $79.1k and 799 h. I found four things wrong. (1) The site poles were counted twice. The photometric sheet and E-7 describe the same 3 poles with different catalog numbers, and the code merges them only when the catalog numbers match exactly. The result was 6 poles and 10 heads instead of 3 and 4. (2) Only 2 of the 6 store power poles became "hosts", so their outlets never got added. (3) Feeders had no lengths at all. (4) 41 lines were priced at $0 without any warning. In this round the CRM will estimate each feeder's length from the drawings and show the math. It asks when a location or the scale is missing. It gives equipment connections Chris's own units, and every line it can't price gets a visible "needs a price" flag. A replay test will check both jobs against Chris, with no AI calls.

---

**Date:** 2026-09-30 · **Status:** Jake approved "plan the accuracy round" · **Planned by:** Opus 5.5 (planner)
**Execution:** two Opus builders in parallel (R = reading: Task 0 shared, A, B, C3; P = pricing: C, D, E, F). Sonnet does fix rounds. Opus reviews.
**Depends on:** main `d8951a8`. **Migrations: P uses 158–159; R uses none (160 is reserved if R turns out to need one).**

## Evidence and diagnoses (done by the planner, read-only)

### Live Kissimmee run
- Bid `041c6d48`, run `11ff4565`: $42,917, 364.5 h, material $19.1k.
- Chris: $79,112, 798.9 h, database material $25,842.56, equipment $4,350, GE $3,770.

### A. Site poles: cause confirmed by arithmetic
- In `backend/src/ai/evidence/families.ts`, `applyFamilies` picks the PRIMARY by rank:
  - a tagged type gets +4;
  - a type counted on the electrical plans gets +2.
  - So the photometric-only S1/S2 (tagged, from the PH0.1 schedule) outrank E-7's untagged "SITE LIGHT".
- Then `catalogOf()` compares full catalog strings:
  - PH0.1 gives `DSX1 LED P8 40K T4M`;
  - the E-sheet SITE LIGHT gives `D-Series … DSX1 LED 60C 1000 40K T3M` (the 09-24 fixture's note: "E-3 lists DSX1 LED 60C 1000 40K T3M 209W"), or just `DSX1`.
- They do not match, so the branch at lines 127–130 runs because the member counted more than 0: "shares the DSX1 series … but not the catalog number — kept as its own type".
- A series-only member is folded only when it counted 0. That is exactly why the 09-24 run (full catalog on SITE LIGHT) and the 09-28 run (SITE LIGHT counted 0) both came out right.
- Today's numbers reproduce exactly:
  - poles: S1 2 + S2 1 + SITE LIGHT 3 = **6**;
  - heads: 2×1 + 1×2 + 3×hpp 2 (SITE LIGHT's headsPerPole was 2 in 09-28) = **10**.
- `combineSheetCounts` (countMerge.ts:304) guarantees "a photometric sheet is never stacked" for ONE type. Nothing guarantees it for a FAMILY.
- Pricing side (to verify in D0): the site pole rows are fuzzy matches to `LTG-POLE` ($950) and `LTG-POLEHEAD` ($385). Both are above the C1 limit (`FUZZY_CONFIRM_MATERIAL = 250`), so they are held at $0. This is why "site pole, 28'-0" MH ×2" shows 0 h.

### B. Power poles: hypotheses (confirm on the export)
- The host count for `PP-1..6` was 2. It comes from `countMerge.ts:805-838` (`hostCounts`): the host type's marks on its used sheets, plus the `tag_legend` "possible" marks.
- Candidate causes, in order. Task B1 must prove which:
  1. The six E-2 hexagon tags were split between `PP-1..6` and the legend's "POWER POLE TAG 1-6" (or the E-1 `P` symbol). Only 2 landed on the host key.
  2. Marks in E-2's pole detail viewports (#2 CHECK OUT, #3 PARTS POD, #4 TESTER, #6 COMMERCIAL COUNTER, all `detail` kind) or in the #11 enlarged plan were excluded. Also check `dropCircuitRepeats`.
  3. `consolidateTargets` aliasing left `PP-OFFICE/CCTV` and `PP-TEST` as separate zero-count types. This matches what was reported.
  4. `identifyHostTypes` (typicals.ts:515) tag binding (a) needs every host mark tagged and `marks.length === total`, so it cannot bind a partly tagged set.
- Chris's 8 power poles × 3.5 h may be the 6 retail poles plus the 2 "3" PVC data & security poles" (office/CCTV). The expected file keeps this item disputed (8 vs 6).

### C. Feeders: what exists now
- `footageAllowance.ts` `collectFeeders` turns Agent 1's `panels[].fedFrom`, `equipment[]` and feeder notes into **0-qty "MEASURE FEEDER" rows**. It knows the destination names only. It has no source endpoint, no location and no length.
- `wiringScopes.ts` already applies "one source per feeder identity" (an estimator's measured or typed feeder replaces only that feeder).
- The Plans-view measure tool:
  - frontend `features/estimating/plans/` (Toolbar, PlansWorkspace, DropsSlackPopover);
  - backend `estimating/markups.ts` + `markupMath.ts` (`computeRunLengthFt` = (polyline ft + drops×dropFt)×(1+slack)).
- Scale:
  - `est_sheets.ft_per_pt` + `scale_source` (`calibrated` | `titleblock` accepted);
  - `suggested_ft_per_pt` from the text-layer title block;
  - `count_result.sheets[].viewports[]` carry a vision-read `scale` / `inPerFt` per viewport. On Kissimmee: E-1, E-2 and E-3 main plans are 1/8" = 1'-0"; E-7 SITE LIGHTING PLAN is "Not to Scale".
- Kissimmee E sheets are raster: 1728×2592 pt, /Rotate 270, no text layer.
- **C4.1 "Composite Utility Plan" (page 15, 2592×1728, rot 0) HAS a text layer** (checked with pdftotext on the local PDF):
  - "Graphic Scale in Feet" with labels 20 / 0 / 20 / 40 at x≈1362.8 / 1434.8 / 1506.8 / 1579. That is 72 pt per 20 ft, i.e. **1" = 20', 0.2778 ft/pt**;
  - the label "ELECTRICAL TRANSFORMER, CONTRACTOR TO COORDINATE" at ≈(390–506, 1044);
  - "BLDG. AREA = 7,381 SQ. FT." at ≈(739–811, 1042);
  - the note: "POWER CO. TO PROVIDE UNDERGROUND 120/208/3 PHASE SERVICE. GENERAL CONTRACTOR TO PROVIDE AND INSTALL TWO 4" DIA. CONDUIT W/ SECONDARY WIRE". Standing rule: "By G.C." = APT scope.
  - The words "METER" on C4.1 are the legend and the water meter. They are not usable.
- Panels A/B are not count targets on Kissimmee, so they have no marks. DISCON A/B and RTU-1/2 are counted from the schedule and have no marks. Only `M (BOX)` (the HVAC disconnect, 2 marks) has positions.
  - **So the endpoints on Kissimmee need either new "locate-only" targets (C3) or estimator pins.**
- Chris's Kissimmee feeder material:
  - #3/0 872 LF;
  - 2" PVC 474 LF (with a 25% labor adjustment);
  - #6 black 498 LF, which is the RTU circuits: 2 × 3 × ~83 ft;
  - #6 green 66 LF (the panel feeder grounds);
  - 8 Polaris taps; service gutter 6 h; 2 × 200A fusible switches at 3.1 h.
  - A likely split of the 872 LF, to verify against E-4/E-5: xfmr→meter 2 sets × 4 × ~76 ft ≈ 608, plus disconnect→panel feeders 2 × 4 × ~33 ft ≈ 264. **The service lateral dominates.**

### D. Zero-hour lines: known classes
- These examples reach the mapper with no unit or a held unit:
  - circuit lists that `isCircuitListRow` does not catch ("Panel A 20/1 circuits per E-4 schedule ×31");
  - circuit-reference-only rows ("A-6,A-14,A-16 ×3");
  - equipment connections with no amperage unit;
  - the RTU circuit row "60/3, Panel B ckt 1,3,5, 3#6,#10G,3/4"C";
  - "HVAC disconnect with unit ×2";
  - items with no library unit: simplex, exhaust fan, power pole, 3" PVC data pipes, ceiling fans;
  - fuzzy matches held at $0 (poles and heads);
  - LS/LOT/RUN unit rows (the "Service conductors … ×2 RUN" and "Feeder 4#3/0 … ×2 RUN" rows).
- The seed library has **no** units for: equipment connections by amperage, terminations, simplex/single receptacle, exhaust fans, ceiling fans, or power poles.
- Chris's BOMs have them:
  - Motor Termination: #10 0.72 h, #8 0.79, #6 1.12, #2 1.75, #1 2.08.
  - Safety switch: 30A NEMA 3R NF 1.10 h, 60A 3R NF 1.55, 200A fusible NEMA 1 3.1 (+ fuses 0.1 each).
  - Other: meter socket 200A 1.5; 225A panel 3.6 (surface) / 4.5 (recessed); single receptacle 20 h/C; power poles 3.5 h/E; hang fans 2.5 h/E.
  - Poles: pole 20' 4.8 h / 30' 6.8 h; pole-top head 2.2 h; anchor bolt template 0.7 + 4 × anchor bolt 0.12.
  - Pole base: auger 0.2 h/LF, auger setup 0.3, concrete pour setup 0.4.

### E. Defaults
- Box/fitting/hardware rows (`footageAllowanceDb.ts:238`) and the equipment/GE defaults (`costLineDefaults.ts` `PRE_SUBMISSION_STAGES = ['due']`) apply **only to bids in stage `due`**.
- The live Kissimmee category list has no "Boxes, Fittings & Hardware (allowance)". That suggests bid 041c6d48 is not in `due`, which would also explain part of the Branch Wiring gap (177 h vs ~405 h). E0 must confirm this.
- Chris's Kissimmee breakdown itemizes:
  - Equipment: mini excavator $2,150, towable boom lift $950, scissor lift $1,250;
  - GE: permits $270, temporary power $1,800, temporary lighting $950, camera pole $750.

### Chris's Kissimmee hours by CRM category
The planner's rough split of the BOM (±10 h per group). F computes the exact figures in code.

| Category | Chris ≈ | CRM live |
|---|---|---|
| Branch Wiring (allowance): EMT, #12/#10, MC, boxes, rings, fittings, hardware, splices, misc | ~405 | 177 |
| Interior Lighting | ~112 | 98 |
| Exterior / Site Lighting: wall packs, G, poles, heads, anchor bolts | ~50 | 15 |
| Branch Power: devices, power poles, fans, RTU switches and terminations | ~51 | 54 |
| Service & Distribution: meter, panels, 200A switches, fuses, gutter, taps, grounding, plywood | ~42 | 16 |
| Feeders: #3/0, 2" PVC and fittings, #6 | ~79 | 0 |
| Site / Underground: 1" PVC and fittings, cement | ~44 | 0 |
| Lighting Controls: contactor, CMP cable | ~15 | 3 |

## Standing rules (do not relitigate)
- AI finds never count without a human confirm when they are new or inferred. **Never lower a count silently.** Every change is visible with its reason.
- Existing or submitted bids never change price. **New priced rows (feeder lengths, equipment units, site geometry, itemized defaults) apply only to bids in `PRE_SUBMISSION_STAGES`.** Other bids keep today's 0-qty MEASURE rows and today's defaults.
- The evidence gate applies to GC-facing outputs; the pre-bid package is exempt. "By G.C." = APT scope. Owner-furnished = APT installs.
- Chris's six Accubid recap reproductions stay exact to the cent. Pricing percentages come from 2025–26 jobs.
- The photometric sheet is a fallback. It is never stacked. **This round extends that rule from one type to a family.**
- One host count never feeds several host types (`guardSharedHostCounts`).

## Constraints / ground rules (both builders)
- Worktrees only:
  - R: `../Electrical-program-wt-accuracy-r`, branch `feat/accuracy-reading`;
  - P: `../Electrical-program-wt-accuracy-p`, branch `feat/accuracy-pricing`.
  - Never edit Local Version. No dev servers. No push. No Agent tool.
- **No live AI calls in tests** (`test/fixtures/takeoff/fakeAnthropic`). No real Anthropic calls at all.
- Tests run only on `electrical_crm_test`. The live DB is **read-only**: only for the Task 0 export, only with `PGOPTIONS='-c default_transaction_read_only=on'`, and never a sync, save or re-run on a live bid. After merge, Jake decides whether to re-sync the two bids.
- Migrations are numbered, idempotent and insert-only unless a task says otherwise: P 158–159. A change to an existing seed row's labor needs Jake's OK (see "Approvals").
- Commit per task, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run the full suites once per builder at the end: `npm test` in backend, `npx vitest run` in frontend.
  - Known flakes: intakeSimilarCache ×2, integration lead-backfill, estimatingLibrary seeded-item, notificationsRetention OOM.
- Fixtures must be real exports. Anything hand-measured, such as a scripted estimator pin, is labeled `SCRIPTED` in the fixture's `_note` and in the test name.
- Reports:
  - `docs/superpowers/plans/2026-09-30-accuracy-R-report.md`
  - `docs/superpowers/plans/2026-09-30-accuracy-P-report.md`
  - Each lists every shared-file edit.
- Shared files (keep edits minimal and additive, and name them in the report):
  - `ai/countingStage.ts` (R adds `locate[]`; P only reads it);
  - `ai/reviewItems.ts` (R);
  - `estimating/mapper.ts` (P);
  - `estimating/footageAllowance.ts` (P);
  - `test/fixtures/realrun/*` (Task 0 lands first, on main, before both branches).

---

## Task 0: Fixture export and baseline (P does this first; merged to main before R and P branch)

1. **Export** read-only into `backend/src/test/fixtures/realrun/`:
   - `kissimmee-live-2026-09-30.json`, from `takeoff_results` WHERE `bid_id::text LIKE '041c6d48%'` AND `run_id::text LIKE '11ff4565%'`. Contents:
     - `agent1` (agent1_output), `agent2` (agent2_output parsed), `inventory` (prep_inventory);
     - `countResult` (count_result minus `skippedSheets`; keep `sheets[].viewports`, `marks`, `evidence`, `markers.sheetDocuments`);
     - `reviewItems`;
     - the bid's `stage` and `sq_ft`;
     - `est_sheets` rows for its documents (`document_id, page_index, width_pt, height_pt, rotation, ft_per_pt, scale_source, suggested_ft_per_pt, suggested_label, half_size, has_text_layer`);
     - confirmed `est_markups` of kind count whose label starts with panel;
     - `est_bid_cost_lines` and `est_bid_lines` (to show whether lines were saved).
   - `36th-street-live-2026-09-30.json`: the same for bid `0cd39e74` / run `ec90ce29`, plus the resolved review answers.
   - `_note` follows `kissimmee-live-2026-09-28.json`'s wording ("exported read-only … nothing transcribed").
   - Loaders go in `kissimmeeLive.ts` (`loadKissimmeeLive0930`) and `replay36thB.ts`-style (`load36th0930`).
2. **Text-layer extract** for the vector sheets the feeder machinery needs:
   - Kissimmee C4.1 page 15 and PH0.1 page 19: pdfjs text runs `{str,x,y,w,h}` in PDF points, same as `viewports.ts` `TextRun`, filtered to words within 400 pt of the words SCALE / TRANSFORMER / XFMR / METER / SERVICE / BLDG / PANEL, and the numeric labels near "Graphic Scale".
   - Stored as `kissimmee-2026-09-30-textruns.json`. It is real extracted text, not transcription.
3. **Baseline:** run the new F harness (written in F2, first commit) on `d8951a8` code and commit `backend/eval/replay-baseline-2026-09-30.json`. It holds the "before" numbers: count diff rows, hours by CRM category and by BOM group, selling price, material, feeder LF, held-line count. **Every before/after in the reports comes from this file.**

**Acceptance:** replaying the fixture's own stored lines reproduces the live proposal to within $1 and 0.1 h ($42,917 / 364.5 h). If it doesn't, the report explains the difference (library drift, settings) before anything else is built.

---

## Builder R: reading

### A. Site-pole de-dup across the photometric and electrical sheets

**A1. Diagnosis test** (`ai/evidence/realRunSitePoles.test.ts`):
- On the 0930 fixture, assert the live cause: S1 counted 2 and S2 counted 1 (both `photometricOnly`), SITE LIGHT counted 3 from an E-sheet schedule, and the family decision carries the "shares the DSX1 series … not the catalog number — kept as its own type" flag.
- Reproduce the same on the 0928 fixture by setting SITE LIGHT's count to 3 (a mutation, labeled as one).

**A2. Family-level photometric fallback** (`ai/evidence/families.ts`, new `applySitePoleFamilies` called from `applyFamilies` before the catalog comparison; categories are `isSiteFixtureCategory`).
- **Group:** types of one series (`SERIES_RE`) and one site category, defined in ≥2 different schedules (`scheduleIdOf`).
- Let **E** = members counted on the electrical plans (`status counted`, `count > 0`, `!photometricOnly`). Let **P** = photometric-only counted members.
- **Rule 1: the photometric sheet never adds poles.** When E and P are both non-empty:
  - **Pole counts reconcile** (ΣP.count == ΣE.count):
    - P's types stay the line structure (S1 ×2, S2 ×1, heads from P's `headsPerPole`).
    - Their evidence becomes the E marks (`photometricOnly = false`, evidence 'marker').
    - E members fold in as `merged`, with the reason: "same 3 site poles as S1/S2: E-7 shows 3, PH0.1's S1 2 + S2 1 = 3 — types and heads from PH0.1, positions from E-7".
    - E's own `headsPerPole` is ignored, with a flag.
  - **Counts differ:**
    - The count stays at E's total, grouped under E's types.
    - P's types go to `merged` with a count of 0.
    - ONE blocking question reuses `FamilyDecision.question`: "E-7 shows N site poles; PH0.1 shows S1 a + S2 b = M. Which is right, and which pole types?" It has both counts and jump links.
    - Nothing is ever summed.
- **Rule 2:** two site types of one series from different schedules, both counted on the electrical plans:
  - merge as duplicates only when A3 registration pairs ≥ 60% of the smaller set;
  - otherwise one non-blocking "same poles?" review item showing both counts;
  - never silently stacked. Today's behavior (kept separate with a flag) stays the default count.
- Rules 1 and 2 do not change the existing full-catalog path (D/L vs W1/W2).

**A3. Registration check** (`ai/evidence/siteRegistration.ts`, pure):
- For two point sets of ≤ 7 marks each and ≥ 3 each, fit a similarity transform (scale, rotation in multiples of 90° plus a small angle, translation) over all pairings (permutations with pruning).
- **Accept** when the residual ≤ 0.5" of paper on the smaller-scale sheet, AND the scale ratio matches the two sheets' viewport scales within 10% when both are known.
- The output pairs each E mark with a P type, so the report can say which E-7 pole is the S2 twin.
- With fewer than 3 marks: no registration. Rule 1 still holds on counts alone, flagged "not registered".
- A registration that contradicts the reconciled counts (residual too large) turns Rule 1's merge into the question.

**A tests:**
- 0930 → **3 poles / 4 heads**. SITE LIGHT merged; review has no new blocking item.
- 0924 and 0928 still give 3/4 with identical `families` decisions, apart from the new reason text. Pin both.
- Synthetic: E 4 vs P 3 → question, count 4.
- Registration unit tests: a permutation, a 90° rotation, a mirror (rejected), noise.
- W1/W2 → D/L unchanged.
- `takeoffEval` diff on 0930: `site_poles` pass, `site_heads` pass.

### B. Power poles as hosts

**B1. Diagnosis test** (`ai/evidence/realRunPoles0930.test.ts`):
- Trace, for every mark on E-1/E-2 whose type is PP*, P, POWER POLE*, or a legend pole tag:
  - counter mark → viewport kind → `resolveSheetMarks` excluded reason → `dropCircuitRepeats` → `consolidateTargets` merges/aliases → `bindHostTagMarks` → `scheduleCounts` → the `hostCounts` entry for the shared host.
- The test first asserts the live outcome (host count 2). The report names which of hypotheses 1–4 (or another) is the cause, with the numbers.

**B2. Distinct physical hosts** (`ai/countMerge.ts` hostCounts block, new helper `hostFamilyMarks` in `ai/evidence/typicals.ts`):
- A shared host's count = **distinct physical poles** across its whole alias family:
  - the host key;
  - the `tag_legend` marks (`mergeKind 'tag_legend'`);
  - the legend symbol (`P` on E-1);
  - every equipment row consolidation tied to it.
- Marks are placed in one main-plan frame (existing `mainPos` + `sheetRelation.alignSheets` for E-1↔E-2, same level) and deduped within 0.5" of paper.
- Marks in `detail` / `legend` / `schedule` viewports are never hosts. The #2–#6 pole details are pictures of the same poles.
- A stated total is a reconciliation target, never the count. Stated totals: the host row's own "(6) power poles #1-#6", or the tag range from `hostTagRange`.
  - found < stated → one blocking diff item: "E-2 states 6 power poles (#1–#6); 2 found on the plans", listing the unlocated tag numbers.
  - The count used = found, plus the poles the estimator adds in B3. It is never raised silently.

**B3. Per-pole type assignment** (`ai/evidence/typicals.ts`, `ai/reviewItems.ts`, `estimating/takeoffReview.ts`, frontend `features/preconstruction/PcWorkspace/TakeoffReviewPanel.tsx`):
- **Tag binding may be partial.** A host mark whose read tag equals a legend entry's number (#1 office … #6 commercial counter) is bound to that type (`binding 'tag'`). Only the untagged or unmatched hosts are asked.
- `HostAssignmentGroup` gains `hosts: Array<{ id: 'pole:<sheet>:<i>', sheetKey, x, y, tag?, circuit?, suggestedType? }>` plus `unlocated: Array<{ id: 'pole:unlocated:<tag>', tag }>`.
- The `typicalassign:` item's members become **one per unbound pole**:
  - options: the legend types + "not a power pole";
  - a jump link to the mark;
  - the suggestion shown but not counted.
  - Unlocated stated poles are members too ("tag #3 not found — which type, or not on the job?").
- **Resolution:** `memberKey = pole id`, `answer = typeId`. `takeoffReview.ts` sums them into the per-type counts the current enforcement already uses (`enforcedCounts`), so there is no downstream change.
- Old type-count members (items from earlier runs) still resolve by the current path. Branch on the member-key prefix.

**B4. Pole-type aliases:**
- A zero-count equipment-schedule row whose significant words match exactly ONE legend pole type folds into that type as its schedule row, with the reason shown. It is not a separate zero-count review item:
  - `PP-OFFICE/CCTV` → office type #1;
  - `PP-TEST` → tester #4.
- "3" PVC data & security poles" rows get one non-blocking question: "2 data/security pipe poles at pole #1 — price them as power poles? (Chris carried 8 = 6 + 2)". The default is not.

**B tests:**
- 0930 → 6 distinct hosts. The type binding is by tag where tags were read. The review has exactly one `typicalassign` item, with members only for unbound poles. No `PP-OFFICE/CCTV` / `PP-TEST` zero items.
- 0924 and 0928 unchanged (pin the expansions).
- `guardSharedHostCounts` still passes.
- Route tests for per-pole answers: a bad pole id → 404; one number for every type → 400.
- Frontend test: the member select renders and posts `{memberKey, answer}`.

### C3. Locate-only targets (AI reading; R owns it, P consumes it)

- `ai/countTargets.ts` adds `role: 'locate'` targets, built from the P1 feeder-graph node names. The node list comes from Agent 1 (`panels[]`, `service`, `equipment[]` with a feeder-size spec); R re-implements only the name normalizer or imports P's `feederNodes()`, whichever lands first, and says which in the report.
- `ai/counter.ts` prompt section: "LOCATE ONLY — place ONE mark at each item's symbol or label; never count, never report as a device".
- `ai/countingStage.ts` stores `count_result.locate: Array<{ node, sheetKey, x, y, viewportId, viewportKind, confidence }>`.
- Locate targets never enter `types`, the takeoff, zero-count gates, legend-noise collapse, or AI markers.
- **Budget:** at most 20 per sheet; existing tiles only (no extra calls).

**C3 tests:** a mocked counter reply containing locate marks → stored in `locate[]` and absent from `types` and review items. The Kissimmee replay with the live counter answers is unchanged. The report states the **live-run expectation**: on E-1, Panel A/B, DISCON A/B, METER and WIREWAY located; on the roof or E-1, RTU-1/2.

---

## Builder P: pricing

### C. Automatic feeder lengths (Jake's priority)

**C1. Feeder graph** (`estimating/feederGraph.ts`, pure; replaces `collectFeeders` as the feeder source).
- **Nodes:** normalized names (PANEL A, DISCON A, METER, WIREWAY, XFMR (utility transformer/pad), MDP, RTU-1 …).
- **Edge sources:**
  - Agent 1 `panels[].fedFrom` ("DISCON A (200A fused switch)" → DISCON A→PANEL A);
  - `equipment[]` descriptions ("feeds Panel A 4#3/0,#6G,2"C", "parallel (2)4#3/0 2"C service");
  - `service` (utility, mainAmps);
  - `panelCircuits` rows ≥ 40A or with conductors ≥ #8 naming equipment ("B-1,3,5 60/3 3#6,#10G,3/4"C RTU-1" → PANEL B→RTU-1, kind 'equipment');
  - Agent 2 takeoff rows that parse as feeder specs with "X to Y" / "X-Y" endpoints ("Xfmr-meter and meter-wireway" → XFMR→METER and METER→WIREWAY, each (2)4#3/0 2"C).
- **Edge shape:** `{ id, from, to, spec: parseConductorRun(...), sets, kind: 'service_lateral'|'service'|'feeder'|'equipment', quotes[] }`.
- "existing" feeders are skipped, as today.
- A spec that can't be read becomes a 'needs size' hold. It is never guessed.
- **Tests:** Kissimmee (0928 + 0930 agent1/agent2) produces exactly: XFMR→METER; METER→WIREWAY; DISCON A→PANEL A; DISCON B→PANEL B; PANEL B→RTU-1; PANEL B→RTU-2.
  - WIREWAY→DISCON A/B are tap connections: a "Polaris taps" note, no length edge unless a spec is stated.
  - 36th: the riser feeder "2"C (4)3/0 #6G" gets its endpoints from the 36th agent1/agent2 text (pin whatever the data gives). The COMP/AHU 40A/2P 3#6 circuits become 'equipment' edges from PANEL A.

**C2. Sheet scale tiers** (`estimating/sheetScale.ts`, pure + a loader in `footageAllowanceDb.ts`). In priority order:
1. `confirmed`: `scale_source` 'calibrated' or accepted 'titleblock'.
2. `suggested`, from:
   - `suggested_ft_per_pt` (text title block), or
   - a **graphic scale bar**: text runs of ≥ 3 numeric labels on one row within 150 pt of "GRAPHIC SCALE"/"SCALE"; monotonic values, linear fit residual < 2%. C4.1 → 0.2778 ft/pt, or
   - the **main-plan viewport's vision scale** from `count_result.sheets[].viewports` (`inPerFt` → ft/pt = 1/(inPerFt×72), respecting `half_size`).
   - The scale-bar and viewport sources must pass the **building-area check** when a building box is known: area × ftPerPt² within ±30% of `bids.sq_ft`, the job profile SF, Agent 1's SF, or a text "BLDG. AREA = N SQ. FT." (Kissimmee: 7,381). No box → suggested, flagged "area not checked".
3. `unverified`: "NOT TO SCALE"/"NTS", tiers that disagree by more than 5%, or a failed area check. **Never priced.** It becomes a hold: "confirm the scale on <sheet>".

- The branch v2 geometry keeps its existing confirmed-only rule. This round does not change it.
- **Tests:** C4.1 text runs → 0.2778; E-1 viewport "1/8" = 1'-0"" → 0.1111 ft/pt; E-7 "Not to Scale" → unverified; half-size doubles; area check both ways.

**C4. Endpoint resolver** (`estimating/feederEndpoints.ts`, pure + loader). Per node, first hit wins, each with a confidence:
1. **Estimator pin:** a confirmed `est_markups` count marker whose label normalizes to the node ("Panel B", "RTU-1", "XFMR", "Transformer"). The existing `^panel` pins still work. Confidence: exact.
2. **Locate mark** from `count_result.locate[]` (C3). Confidence: high/low as the counter reports.
3. **Counted mark** of a type identified as the node:
   - the tag equals the node, or
   - an equipment-connection type tied to exactly one node family: the `M (BOX)` "HVAC disconnect with unit" marks count as the RTU nodes' positions, assigned by circuit tag if read; otherwise the two are interchangeable, stated as such.
4. **Text-layer label** on a vector sheet:
   - the exact node words (TRANSFORMER / XFMR / PAD-MOUNT / "PANEL A" / MDP), excluding legend and notes blocks (a line of > 6 words, or inside the legend column of stacked single-word entries);
   - exactly one candidate is required;
   - confidence 'approximate (label)'. Kissimmee C4.1 "ELECTRICAL TRANSFORMER, …" qualifies.
5. None → a hold: "Pin <node> on the Plans view".

**C5. Route and length** (`estimating/feederRoute.ts`, pure):
- **Frame:**
  - both endpoints on one sheet → that sheet;
  - different sheets of one level → `alignSheets` (E-1↔E-2);
  - site↔building → building-box mapping when both sheets have one;
  - otherwise a hold: "endpoints on different sheets — pin both on one sheet".
- **Horizontal:**
  - interior: Manhattan in PDF points (L route: x then y), × ftPerPt;
  - site/underground: straight line × `siteRouteFactor` (default 1.15).
- **Vertical** (settings `est_feeder_estimate`, migration 159, editable):
  - panel/gear conduit exit 7 ft AFF;
  - deck height from Agent 1 / the job profile, else a default of 14 ft (flagged);
  - wall equipment mount 5 ft;
  - roof penetration +3 ft;
  - underground: burial 2 ft + stub-up 3 ft at each end;
  - makeup 3 ft per end.
- **Slack:** `est_default_slack_pct` (10%).
- **Quantities:**
  - conduit-ft = route × sets;
  - conductor-ft per size = route × count (already × sets);
  - ground per the spec.
- **Output per edge:** `{ lengthFt, math, tier, endpoints (with confidence), frame sheet, routePoints[] }`.
- **The math string is always shown,** e.g.: "PANEL B (E-1, located by counter) → RTU-1 disconnect (E-1, counted M (BOX)): Manhattan 612 pt × 0.1111 ft/pt (E-1 main plan 1/8"=1'-0", vision-read; area 7,210 vs 7,381 SF ✓) = 68.0 ft + rise 7 ft (deck 14 ft default − 7 ft) + roof 3 ft + makeup 2×3 ft = 84.0 ft × 1.10 slack = 92 ft → 3/4" EMT 92 ft, #6 276 ft, #10 G 92 ft."

**C6. Rows and integration** (`estimating/footageAllowance.ts`, `footageAllowanceDb.ts`, `wiringScopes.ts`, `mapper.ts`):
- **An edge resolved at tier confirmed or suggested** becomes:
  - a conduit row "Feeder — <from> → <to>: <conduit>" plus one row per conductor size;
  - `FEEDER_CATEGORY`. Service laterals and site edges → `Site / Underground / Allowances`, with PVC underground items;
  - `confidence 'APPROX'`, evidence = the math + tier + "suggested — confirm";
  - `feeder` meta extended with `{ estimate: { lengthFt, tier } }`.
- **Raceway choice:**
  - interior/roof → EMT of the stated size;
  - underground/site → the `PVC … underground` items (2" = `PVC-200`);
  - wire → `#<size> THHN/THWN copper conductor` (the seed has #6 … 600 kcmil).
  - Every part must resolve (all-or-nothing, as today). Otherwise the edge stays a hold.
- **An unresolved edge** keeps today's 0-qty MEASURE FEEDER rows, with the specific missing piece in the evidence ("needs: XFMR location; C4.1 scale ✓").
- **No double counting:**
  - Agent 2's own RUN/LOT/LS feeder rows with the same feeder identity (`feederIdentity`) become notes: "replaced by the feeder estimate <edge>", 0 contribution, visible.
  - 'equipment' edges remove their equipment points from the ratio's `countPoints`.
  - An estimator's typed or measured feeder line still wins, per feeder identity (wiringScopes source 1).
  - A typed qty on an old "MEASURE FEEDER — …" line carries over to the new row through `carryOverride`/`carrySource` (test it).
- **Stage gate:** priced feeder rows (qty > 0) only on `PRE_SUBMISSION_STAGES` bids. Other bids get exactly today's rows.

**C7. API and UI:**
- `GET /api/estimating/:bidId/feeders` (`routes/estimating.ts`) → edges with math, tier, status, endpoints and `routePoints` per sheet (documentId, pageIndex).
- **Labor & Pricing** (`features/estimating/LaborPricingStep.tsx` + a new `FeedersPanel.tsx`): one card per feeder showing the math, status and holds. Buttons:
  - **Show on plans**;
  - **Adopt as run**, for a same-sheet route: creates a confirmed linear markup on that line with the route points, drops = 2 and dropFt = (vertical + makeup)/2 per end, slack from settings, through the existing markups batch + apply-markups;
  - **Confirm length**, for a cross-sheet route: sets qty_overridden with an evidence note;
  - **Pin endpoint**: opens the Plans view in count mode with the node name as the label;
  - **Type length**.
- **Plans view** (`plans/PlansWorkspace.tsx`, `PlanViewer.tsx`, `overlay.ts`): a read-only dashed "Suggested feeder routes" layer. Test the coordinates on /Rotate 270 sheets.
- **Sidebar** (`BidSummary.tsx`): "N feeder lengths suggested — confirm" and "N feeders need a location/scale".

**C8. Expected accuracy and how it is measured:**
- An interior feeder with located endpoints on a verified scale: **±20% per run**. Route style and heights are the error.
- A site lateral from a text-label endpoint: **±35%**. A label sits on a leader line, 10–30 ft from the pad. A pin gives ±15%.
- **Eval:**
  - expected-file items `feeder_3_0` (872 LF), `rtu_6awg` (498 LF) and `site_pvc_1in` (750 LF), measure `feeder_lf`;
  - reported, not pass/fail, until one live run confirms the locate step;
  - **pass band ±25%**.
- **Two numbers are reported:**
  1. automatic, no answers. Expected #3/0 ≈ 250 LF (−70%), because the service lateral is held unless C4.1's transformer label and the meter are both resolved.
  2. with `SCRIPTED` pins: XFMR and METER on C4.1, and Panel A/B and DISCON A/B on E-1, measured once from the local PDF and documented. Expected ≈ 780–960 LF (within ±10–15%).
- RTU #6: expected ≈ 450–560 LF once the panel is located.

### D. Equipment connections, circuit lines, and "needs a price" holds

**D0. Classify all 41 lines** (`estimating/zeroHourLines.test.ts` on the 0930 fixture):
- Put every priced line with 0 contribution into a table with a reason code:
  - `circuit_list`, `circuit_ref`, `equip_no_unit`, `disconnect_no_size`, `held_fuzzy`, `unit_unknown` (LS/LOT/RUN), `no_unit` (simplex, fan, power pole, pipe pole), `feeder_run`, `scope_note`.
- The report shows the before/after class of every one of the 41.

**D1. Circuit lists** (`mapper.ts` `isCircuitListRow`):
- Extend it to the live wording: "Panel A 20/1 circuits per E-4 schedule", "Panel B 20/1 circuits", "20/1 circuits", "(N) 20A/1P circuits".
- Treatment: a **note** (qty kept, never priced, not a hold). `footageAllowance.countPoints` and `computeBoxFittingRows` skip them.
- A circuit list never maps to an assembly while the branch allowance carries the bid.
- **Tests:** the exact live strings, and a regression sweep of every Kissimmee and 36th row.

**D2. Circuit-reference-only rows** (`mapper.ts` new `isCircuitReferenceRow`):
- These are rows whose text is only circuit refs plus panel words, with no device or equipment noun ("A-6,A-14,A-16").
- If another row names ≥ 1 of the same circuits (SIGNS "A-6, A-14, A-16, pylon A-18") → a note "circuit reference of <row>".
- Otherwise → hold `circuit_ref`: "what is on circuits …?".
- The RTU circuit row "60/3, Panel B ckt 1,3,5, 3#6,#10G,3/4"C" → a note "wiring carried by the feeder estimate PANEL B → RTU-1" (C1 edge), never an item.

**D3. Equipment connections, Accubid style** (`mapper.ts` `isEquipmentConnectionRow` branch; new `estimating/equipmentConnection.ts`; seeds in `seed/laborUnits.ts` + migration **158**):
- **Units** are Chris's rows, marked "(Chris BOM)". Material is Chris's net where he had it, else $0 with "confirm".
  - Termination by conductor: ≤#10 0.72 h, #8 0.79, #6 1.12, #4 1.45 (interpolated, "default — confirm"), #2 1.75, #1 2.08, #1/0 2.4 ("default — confirm").
  - Safety switches: 30A 3P NF 3R 1.10, 60A 3P NF 3R 1.55, 100A 2.1 ("default — confirm"), 200A 3P fusible 3.1 + 3 fuses × 0.1.
- **Rules:**
  - The conductor size comes from the row, or from the equipment's `panelCircuits` entry.
  - Motor/HVAC/hard-wired loads → termination by size, plus a safety switch when a disconnect is stated or implied (the RTU with "HVAC disconnect with unit").
  - Cord-connected appliances (fridge, drink machine, anything "on receptacle") → a note: "served by a receptacle — no connection unit".
  - A hard-wired ≤ 30A 1Ø load (WH, exhaust fans, signs, ALC, tester J-box, mini-tune) → a ≤#10 termination.
  - A disconnect with no amperage takes it from the equipment it serves when exactly one equipment family matches in count ("M (box) ×2" ↔ RTU-1/2 60/3 → 60A 3R). Otherwise → hold `disconnect_no_size`.
- **Tests:** real rows from both jobs.
- **36th check:** its 4 COMP/AHU 40A/2P 3#6 → #6 terminations 4 × 1.12. Report whether Chris's 36th BOM (no terminations; "1" EMT & Wire 300 ft" quoted at 2.5 h/C) makes this an over-count, and show the hours.

**D4. Missing units** (migration **158**, insert-only, `ON CONFLICT (code) DO NOTHING`, following 157's pattern):
- Power pole, furnished by others: set and wire, 3.5 h (Chris).
- Single (simplex) receptacle 20A: 0.20 h, plus plate 0.03 h. Aliases: simplex, single receptacle.
- Ceiling fan: hang and connect, 2.5 h (Chris).
- Light pole 20–25 ft set on base: 4.8 h. ≥ 30 ft: 6.8 h.
- Pole-top LED head: 2.2 h (Chris).
- Pole anchor-bolt set + template (base by others): 1.18 h.
- Pipe pole / raceway riser 3" PVC to deck: 1.5 h ("default — confirm").
- Give exact aliases for "site pole", "light pole", "pole (site lighting)", "fixture heads", so the Agent 2 pole/head rows alias-match and are no longer held as fuzzy > $250.
- Existing `LTG-POLE` / `LTG-POLEHEAD` rows are **not** modified (see Approvals).

**D5. Holds instead of a silent $0** (`estimating/pricing.ts` warnings, `bidEstimate.ts` `resolveLines`, frontend `LaborPricingStep.tsx`, `BidSummary.tsx`, `AccubidPricingPanel.tsx`):
- `PricingWarnings.holds: Array<{ id, description, qty, reason }>` covers every takeoff line with qty > 0, not excluded, and 0 material and 0 hours with no override, unless it is a classified note (circuit list, circuit reference, served-by-receptacle, replaced-by-feeder-estimate).
- Reasons: `no_unit`, `confirm_match`, `unit_unknown`, `needs_length`, `needs_size`, `needs_endpoint`, `needs_scale`.
- The UI shows a badge per line, a "Needs a price/unit (N)" filter, and the sidebar line "Total excludes N held lines". Holds do not block (same as C1's confirm lines).
- **Tests:** a unit test per reason; the Kissimmee 0930 sweep gives 41 → the new count, with every line classified.

**D6. Report only; no change without Jake's OK:**
- The "…receptacle circuit, complete" assemblies (`ASM-DUPLEX`/`GFCI`/`WPGFCI`: 0.25 C EMT + 0.075 M #12 each) carry branch raceway and wire that the footage allowance also carries. The box is already skipped (`pointHasBox`).
- Measure the double count in hours on both jobs (≈1 h per receptacle) and report it.

### E. Site / underground and defaults

**E0. Check read-only on the export and report:**
- both bids' `stage` and saved lines;
- whether the box/fitting rows and the equipment/GE defaults applied to the live $42,917 proposal;
- if the stage gate removed them, the hours that would have been added.
- Do not change the gate.

**E1. Site pole circuits by geometry** (reuses C2/C4/C5; `footageAllowance.ts` site section):
- LCP/panel → poles, as a nearest-neighbor chain on a scaled site sheet (PH0.1 has a text layer; confirm the graphic scale in Task 0's text runs. E-7 is NTS).
- Building entry = the building-box edge point nearest the first pole. The interior part is panel → that wall on E-1 (flagged "approximate").
- Per pole: stub-ups at 2 × (2 + 3) ft.
- Conductors from the site circuits in `panelCircuits` (e.g. A-12,13 / A-15,17,19), else 2#10 + #10G ("default — confirm").
- Result: `Site / Underground / Allowances` lines (1" PVC underground + wire). These replace the ratio's `pvcSitePerPole` row when resolved (one source; the ratio carries it otherwise, now × 3 poles after A).
- **Expected:** Chris 1" PVC 750 LF. Report the difference.

**E2. Pole bases:**
- base by others/GC (notes, specs, account rule) → anchor-bolt set per pole (D4);
- APT pours → `ACB-POLE-BASE-FOUNDATION` if imported;
- otherwise one non-blocking question: "Who pours the pole bases?"

**E3. Trenching:** trench LF = the site route LF, as a visible line **excluded by default**: "Chris carries no trenching on 5 of 5 BOMs — include if EC trenches". Never priced silently.

**E4. Itemized equipment/GE defaults** (`estimating/costLineDefaults.ts`, migration **159** settings v2; parse falls back to v1):
- **Equipment:**
  - scissor lift always ($1,250 in 2026; $890 before);
  - towable boom lift when there are site poles or exterior mounting over 20 ft ($950);
  - mini excavator when there is underground site work, i.e. site poles or underground feeders ($2,150).
- **GE:**
  - permits ($270);
  - temporary power ($1,800) + temporary lighting ($950) when the job is new build or over 300 h.
- These are the 2025–26 breakdowns (pricing window). Show the fit against all 10 breakdowns.
- Kissimmee reproduces $4,350 exactly and $3,020 of Chris's $3,770. The $750 camera pole is AutoZone-specific: an account-rule follow-up, not a default.
- Same seeding rules as today: `due` stage only, never over user lines, never re-seeded after a delete.

### F. Replay eval gate (both jobs, no live AI)

**F1.** The fixtures from Task 0.

**F2. `backend/src/eval/replayEval.ts`** (pure orchestration), per job:
1. The **counting replay**: fake Anthropic answered by the live run's own marks, evidence cache and titles, the `replay36thB.ts` / `replay0928.ts` pattern, with the 0930 fixtures → `countResult` → `diffAgainstExpected`.
2. **Count→rows projection**: `enforceCountsOnTakeoff` with `enforcedCounts(countResult, [])`. Document it as the replay's stand-in for Agent 2 reading the new counts; if `enforcedCounts` needs answers, write a replay-only `projectCountsOntoRows`.
3. Review answers: 36th uses the real stored answers. Kissimmee is scored twice: `unanswered`, and a `SCRIPTED` answer set (pole types by tag, typicals, pins for C8).
4. Generated rows (footage, feeders, box/fitting, site): `due` stage assumed and stated.
5. Mapper → `priceBid` → Accubid recap with the app defaults and E4 defaults.
- **Output:**
  - hours by CRM category;
  - hours by BOM group (shared classifier);
  - material;
  - selling price;
  - feeder LF by conductor size;
  - hold count;
  - a pass/fail table.

**F3. `backend/src/estimating/hoursGroups.ts`:**
- One classifier used for BOTH the CRM lines and Chris's BOM rows (`parseAccubidBom`):
  - wire & MC; branch conduit; fittings; boxes & rings; hardware; splices; fixtures; devices; equipment connections; service gear; feeders (≥ #8 or ≥ 1-1/4" power raceway in the feeder scope); site / underground; controls; demolition; misc.
- Chris's reference numbers are **computed from `accubid/*-bom.txt`**, never typed by hand.

**F4. Expected files** (`backend/eval/*.expected.json`):
- Add the `feeder_lf` items (C8).
- Add `reference_estimate.hours_source: "computed from accubid BOM by hoursGroups.ts"`.
- Add an `ExpectedItem.measure` value `'feeder_lf'` with a `conductor` field to `takeoffEval.ts`, plus validation.

**F5. The gate** (`backend/src/eval/replayEval.test.ts`), compared with `replay-baseline-2026-09-30.json`:
- no non-disputed item goes pass → fail, and none gets a larger |delta|;
- Kissimmee `site_poles` / `site_heads` now pass;
- per job, |hours − Chris| is not worse than baseline by more than 2% of Chris;
- **36th: hours and selling price within ±15% of 189.21 h / $23,230.14**;
- Kissimmee total hours ≥ baseline;
- no priced line with 0 contribution that is neither a hold nor a note.
- It prints the tables the reports quote.
- Pinned numbers are updated only with a report entry saying why.

---

## Expected before → after
The builders replace these with measured numbers in their reports.

**Kissimmee (automatic = no review answers; scripted = pole types + typicals + C8 pins):**

| Category (h) | Before | After, automatic | After, scripted | Chris ≈ |
|---|---|---|---|---|
| Branch Wiring (allowance) | 177 | ~160 (site ratio 6→3 poles −17; circuit refs no longer points) | ~165 | ~405 |
| Interior Lighting | 98 | 98 | 98 | ~112 |
| Exterior Site Lighting | 15 | ~30–35 (3 poles + 4 heads priced) | same | ~50 |
| Branch Power | 54 | ~80–90 (6 power poles × 3.5; RTU 2 × 2.67; hard-wired ~6 × 0.72; simplex) | ~95–105 (typical outlets; 8 poles if answered) | ~51 |
| Service & Distribution | 16 | ~28–32 (DISCON A/B, meter, wireway) | same | ~42 |
| Feeders | 0 | ~15–20 (interior feeders + RTU circuits; service lateral held) | ~40–45 | ~79 |
| Site / Underground | 0 | ~5–20 (pole bases; site geometry if PH0.1 scale resolves) | ~20–25 | ~44 |
| Lighting Controls | 3 | 3–9 | same | ~15 |
| **Total hours** | **364.5** | **~430–470** | **~500–540** | **798.9** |
| Selling price | $42,917 | ~$52–58k | ~$58–64k | $79,112 |
| Site poles / heads | 6 / 10 | **3 / 4** | 3 / 4 | 3 / 4 |
| Power poles (hosts) | 2 | 6 | 6 (8 if the pipe poles are answered yes) | 8 (disputed) |
| #3/0 LF | 0 | ~250 | ~780–960 | 872 |
| Held-at-$0 lines | 41 (silent) | ≤ 12, all visible holds | ≤ 5 | – |

The remaining gap is almost all Branch Wiring: boxes, fittings, hardware and splices (E0 checks the stage gate), and MC/connectors. That is the next round, unless E0 or F finds a code bug.

**36th Street** (stored answers; Chris $23,230 / 189.2 h):
- **Before:** ~$20,955 / 164 h.
- **After:**
  - + 4 × #6 terminations (4.5 h);
  - + HVAC equipment circuits by geometry (~12–15 h, if the E1.0 panel and unit marks and the scale resolve; else holds);
  - + the riser feeder (~10–13 h, if its endpoints resolve).
  - Result ≈ **180–198 h, ~$22.5–25k** (−5% … +5%).
- **Gate:** within ±15% of both hours and price, and no expected item regresses. If equipment connections over-count against Chris (D3 check), the report says so, with hours.

## Approvals needed from Jake (do not build without a yes)
1. Changing existing seed rows to Chris's units: DISC-30/60/200 labor (1.5/2.0/4.5 → 1.10/1.55/3.1), `LTG-POLE` 4.5 → 4.8, `LTG-POLEHEAD` 1.2 → 2.2. Until then, D4 adds new rows and aliases only.
2. D6: removing the raceway/wire double count in the complete-circuit assemblies.
3. Re-syncing the live Kissimmee and 36th bids after merge.

## Risks
- **A over-merge:** a job with separate parking-lot and building poles of one series. Rule 1 needs ΣP == ΣE, or a registration, to merge; otherwise it asks. Test a synthetic 2+2 case.
- **B partial tags:** hexagon numbers misread (a "4" read as "1") bind the wrong type. Tag binding requires the tag to be a legend entry number AND unique among the hosts; duplicates → asked.
- **C scale from vision:** a wrong viewport scale (e.g. E-1's 3/32" notes viewport) gives a wrong length. Only the main-plan viewport is used, the area check is applied, and the tier is shown. "Never silently priced" holds because every feeder card shows the math and the sidebar counts the suggestions.
- **C cross-sheet framing:** E-1/E-2 alignment may fail. Then it's a hold, never a guess.
- **C label endpoints** on civil sheets are approximate (leader lines). They are marked 'approximate (label)', always in the confirm group, and the eval reports ±35%.
- **Double counting** feeders among Agent 2 RUN rows, MEASURE rows, the estimator's lines, the equipment ratio points, and D3's RTU circuit note. Reviewer focus #3.
- **The Agent 2 stand-in** (F2 projection) may differ from what a live Agent 2 writes. It is stated in every replay table; one live re-run of each job is recommended after merge (Jake's call, ~$5–6 each).
- **The 36th over-count** from terminations Chris did not carry.
- **The stage gate** means the live proposal won't show the change until the bid is in `due`. This is intentional.
- **Migration 159** changes the settings version. The v1 parse fallback must keep old bids exact. Chris's six recap reproductions stay to the cent.

## Reviewer focus
1. **Nothing priced silently:** every qty > 0 generated row (feeder, site, equipment unit) has evidence math. Every $0 line with qty > 0 is a hold or a classified note. The sidebar shows both counts.
2. **Photometric never stacks, at family level:** 0924, 0928 and 0930 all give 3/4. The count-mismatch path asks and never sums. The registration can't pair a mirror.
3. **Feeder one-source-per-identity:** an Agent 2 RUN row, a MEASURE row, a generated feeder, an estimator's typed or measured line, and a D2 RTU-circuit note never price the same run twice. The typed-qty carry-over works.
4. **Host counts:** distinct physical poles only. Detail-viewport pictures are never hosts. Stated totals are reconciliation targets only. Old `typicalassign` answers still resolve. `guardSharedHostCounts` is intact.
5. **Scale tiers:** confirmed / suggested / unverified are computed as specified. Branch v2 stays confirmed-only. Half-size and /Rotate 270 are right in the math and in the overlay.
6. **Stage gating and live safety:** no priced change on non-`due` bids. Exports were read-only. No live sync.
7. **Units:** D3/D4 values match Chris's BOM rows exactly (cite the row). Assumed values are labeled "default — confirm". The seed TS and migration 158 agree (`seedUnitsVsChris.test.ts` extended).
8. **Eval honesty:** fixtures are real exports. Scripted pins and answers are labeled. The baseline was committed before the changes. Chris's reference hours are computed, not typed. The gate thresholds are as specified.
9. **Mapper regressions:** a before/after fuzzy-match sweep on every row of both jobs (as C1 did). No new cross-family match.

### Critical Files for Implementation
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/ai/evidence/families.ts
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/ai/evidence/typicals.ts (with /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/ai/countMerge.ts hostCounts at ~805–838 and /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/ai/reviewItems.ts ~485–520)
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/estimating/footageAllowance.ts (with footageAllowanceDb.ts and wiringScopes.ts; new feederGraph.ts / feederEndpoints.ts / feederRoute.ts / sheetScale.ts beside them)
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/estimating/mapper.ts (with /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/estimating/seed/laborUnits.ts and pricing.ts)
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/eval/takeoffEval.ts (with /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/estimating/priceAccuracyReplay.test.ts as the pricing-replay pattern and /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/test/fixtures/realrun/ for fixtures)


---

**Correction from Jake (2026-09-30 23:25):** there is no "submitted/existing bids never change price" rule — "I never made that rule. These bids are all for testing purposes." Ignore any stage-gate / price-freeze constraint above; generated rows apply to all bids. Seed-unit and library price changes still go to Jake as decisions because they change every estimate.
