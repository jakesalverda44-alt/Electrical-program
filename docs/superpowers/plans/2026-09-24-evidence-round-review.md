# Evidence Round: Adversarial Review

**Branch:** `feat/evidence-round`, reviewed range `main(67a2e5e)..71bfccd`: 18 commits. Parts 1–3 were executed by Opus, Parts 4–5 by Sonnet. Migrations 133–136.
**Reviewer:** Opus 5.5 (independent, read-only). Two areas were swept in parallel: Part 3, and 4.1/Part 5/migrations. I re-checked every blocker from those sweeps; items marked "sweep-reproduced" were reproduced by the sweep and read through by me.
**Date:** 2026-09-24

**Verdict: DO NOT MERGE AS IS. Merge after the blockers are fixed.**
- **Parts 1–3.** The architecture is right: viewports, typicals, schedule rows and families, all switched by one input and all with evidence. The E-2 pole-legend mapping is correct against the real sheet. But two merge rules still over-count on real sets:
  - the complementary-sheet sum (a real double count on Kissimmee, and true duplicates are summed whenever the footprint falls back to the mark bounding box);
  - the schedule-row matcher (sibling tags, and "MAX 30" read as a quantity).
- **Part 4 is not safe to price with.**
  - Gap-fill searches the whole sheet with an exclusion list that leaves out the marks Part 1 deliberately excluded.
  - Its accepted marks are never attributed to a viewport.
  - A model's crop-check "accept" changes GC-facing quantities without any review item.
  - Reconciliation findings never reach the estimator.
- **The headline Kissimmee results are not real.** "GFCI 16" and "receptacles 42" rest on a synthetic reply that the real E-1 sheet contradicts. The fixture now locks in an over-count.
- **The evidence gate has no UI.** Manual lines and hand-typed quantities lock the GC documents with no way out in the app.

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit` backend / frontend | clean / clean |
| Backend `npm test` (1 full run) | **1965 passed, 3 failed, 4 not run** of 1972 (186 files: 183 passed, 2 failed, 1 lost to "Worker exited unexpectedly"). Same totals as the report. |
| Frontend `npx vitest run` | **1287 / 1287** (128 files) |
| Scratch runs | The Kissimmee fixture was re-run with a probe that captures the gap-fill requests (file deleted afterwards). Pure repros ran via `tsx` from the scratchpad. The worktree was left clean. |
| Real drawings | E-1 (p.49) and E-2 (p.50) rendered at 50–200 DPI; the baseline marks were plotted onto them. |

**How the failures were classified.** All are known flakes that are also on the baseline, and none is in code this branch touches:
- `intakeSimilarCache` ×2;
- the `integration` lead follow-up backfill timeout;
- the worker crash that loses 4 tests (the `notificationsRetention` pattern documented in earlier reviews).

I ran the full backend suite once.

## Receptacle trace (focus 1), against the real sheets

Fixture AFTER: 42 = SIMPLEX 11 + DUPLEX 15 + GFCI 12 + WP GFI 4. The expected total is 38, of which 16 are GFCI.

| Component | Count | Verdict on the real sheet |
|---|---|---|
| E-1 main, simplex | 5 | 3 on the north wall (B-21 area), **B-32** on the west wall at 18'-9", B-13 (OxBlue camera) |
| E-2 #11 office plan, simplex | 5 | A30, A32, A36, A38 (the office pole's "simplex outlets in junction boxes on floor", correctly *not* expanded as a typical) and **B32 at the kneewall, 18'-9"**. **This is the same outlet as E-1's B-32: same circuit, same wall, same dimension. It is counted twice.** |
| E-1 main, duplex | 3 | A-31 "duplex outlet at deck", two at the A-34 door. OK. |
| E-2 #11, duplex | 1 | B30 "mount in fixture kick plate". A real device, but arguably a baseflex (see S1). |
| Pole typicals (legend #9) | 8 duplex + 1 simplex | The mapping is correct against the real legend and the #2–#5 pole elevations: tags 1 / 2 / 3 / 3 / 4 / 6, and tag 5 is data/security pipes. No pole outlet is drawn anywhere as a plan symbol, so there is no double count with drawn marks. |
| Coil+J typical (E-1 #5) | 3 duplex | "Receptacle mounted to base plate" is part of the **display baseflex** assembly. The eval scores that assembly separately (`baseflex`, expected 8). It is a likely double price (S1). |
| GFCI drawn | 1 main + 6 restroom | Correct. The restroom plan (#3) shows 6 (note-3 mop sink, B-26, B-13, and 3 at the phone board). The main plan's 2 in that area are correctly replaced. |
| WP GFI | 4 | Correct: two at the RTUs and two exterior. |
| **Gap-fill GFCI** | **+5** | **Not on the sheet.** The real E-1 west portion has no GFCI symbols; I rendered both halves at 110 DPI. The baseline's marks come from the full real sheet, not the fixture crop. Two of the five synthetic marks even fall inside the POWER SCHEDULE legend and the restroom enlarged plan (B1). |

Net: the traceable real total is **36** (42 − 5 synthetic − 1 B-32 double), before the baseflex question. The 5 GFCIs still "missing" against the audited 16 are not on E-1 at all. Gap-fill on E-1 cannot and should not find them.

## Blockers

### B1. Gap-fill double-counts marks Part 1 excluded, and its accepted marks are never attributed to a viewport. **Reproduced.**
- **Where:**
  - `backend/src/ai/countingStage.ts:323`: `existingMarks` is `countResult.marks`, which holds only *counted* marks. `searchRect` and `legendRect` are never set.
  - `backend/src/ai/evidence/gapFillStage.ts:175`: the search area defaults to the whole sheet.
  - `gapFillStage.ts:193-199`: the "already counted" list holds same-type counted marks only.
  - `backend/src/ai/evidence/viewportResolve.ts:128-147`: replaced main-plan marks, legend marks and detail marks go to `excluded`.
  - `gapFillStage.ts:274-287`: `applyGapFillResults` adds every accepted candidate with no viewport check.
  - The prompt (`backend/src/ai/prompts.ts:538-553`) says nothing about legends, schedules, details or enlarged plans.
- **Scenario (the Kissimmee fixture probe).**
  - The GFCI gap-fill request's "ALREADY-COUNTED POSITIONS" list omits the two main-plan restroom GFCIs at (0.487, 0.213) and (0.488, 0.246). Those two were excluded because the enlarged plan replaced them.
  - On the real sheet they are labelled "GFCI". A real gap-fill call is told not to re-report only the *other* positions, so it will report these two. `dedupeAgainstExisting` compares only counted marks, and a 1.2" crop of a real GFCI gets "accept". Result: GFCI +2, the exact enlarged-vs-main double count Part 1 was built to prevent.
  - The same applies to legend symbols, e.g. the WP GFI symbol in E-1 #5 POWER SCHEDULE for the WP GFI job, and to detail viewports.
  - The fixture already shows it: the accepted synthetic marks at (0.71, 0.52) and (0.44, 0.80) fall inside **#5 POWER SCHEDULE** (legend) and **#3 RESTROOM** (enlarged plan), and both were counted.
- **Fix:**
  - Pass *all* the sheet's marks (counted **and** excluded, any type) as the exclusion list.
  - Run every candidate through `viewportAt`, and reject candidates in never-counted, detail or enlarged-replaced areas.
  - Limit `searchRect` to the main-plan viewport, or to the viewport the type is counted from, and pass `legendRect`.
  - Add a test using the fixture's own excluded restroom GFCIs.

### B2. A model's crop-check accept changes GC-facing counts with no review item, no tolerance and no cap. Reconciliation findings never reach the estimator. **Reproduced (grep, fixture).**
- **Where:**
  - `gapFillStage.ts:274-287` bumps `count` and the takeoff `qty` on any `accept`, up to 8 per job, never limited to the finding's `shortfall`;
  - `backend/src/ai/evidence/reconcile.ts:73-74` has no tolerance, and only shortfalls are checked;
  - `backend/src/ai/reviewItems.ts` has no item for `evidence.gapFill.findings` or for gap-fill additions. `grep gapFill|findings` finds nothing in reviewItems or the frontend.
- **The plan requires otherwise (4.2):** "each mismatch = one diff item showing both sides … blocking when > tolerance".
- **Scenario: the S1+S2 finding is not a real discrepancy.**
  - The LUMINAIRE SCHEDULE's QTY 4 counts **luminaires (heads)**. `actual` sums the S1/S2 **pole** counts (3). The audit says 3 poles / 4 heads, and E-1 note E says "two 209W fixtures per pole".
  - So reconciliation compares heads against poles and tells gap-fill "the schedule says 4; the plans account for 3". That runs two whole-sheet searches (S1 and S2), each able to add up to 8.
  - One "accept" makes the audited 3 poles into 4, silently. The fixture passes only because its synthetic reply says "nothing found".
  - This fails the "must not change a correct count" requirement.
- **Fix:**
  - Emit one `reconcile:<type>` review item per finding, showing both sides with jump links, blocking above a stated tolerance.
  - Hold gap-fill marks as *suggested* (a review item per job with Accept/Reject) rather than auto-counting. At minimum, cap accepted marks at `shortfall`, and flag any gap-fill addition in review.
  - Compare the schedule QTY against heads (`count × headsPerPole`) for site families.
  - Flag the over-count direction too (plans > schedule).

### B3. The fixture's GFCI 16 and receptacles 42 come from a synthetic reply that the real sheet contradicts, and the test locks in an over-count. **Reproduced (rendered E-1).**
- **Where:**
  - `backend/src/test/fixtures/evidence/kissimmeeReplies.ts` (GFCI_GAPFILL_MARKS, "west portion");
  - `backend/src/test/kissimmeeEvidence.test.ts` (`gfci` 16, `receptacles_total` 42, `gapFill.accepted` 5, and the same in the supplement test).
- **Scenario.**
  - The baseline marks being answered are the live Opus run's marks from the **whole real E-1**, not from the fixture crop. The west portion has no GFCI symbols. One of the notes describes a mop-sink GFCI, which is the restroom note-3 GFCI already counted.
  - The report presents GFCI 16 as "hitting the audited figure exactly". It also turns receptacles from 37 (inside the round's own ±2 goal) into 42 (outside it) and calls the goal status unchanged ("was already fail at 37").
  - The only thing this test proves is that `applyGapFillResults` adds what a fake crop check accepts. It proves nothing about recovering missed marks.
- **Fix:**
  - Replace the GFCI gap-fill reply with an honest "nothing new" (or with the two restroom repeats, to exercise B1's exclusion).
  - Assert GFCI 11 / receptacles ≤ 37, and correct the report.
  - Keep a separate unit test for "a real miss is recovered", with a candidate on a symbol that the fixture's crop genuinely carries and the counter's marks omit.

### B4. The sheet-pair rule sums true duplicates, and on Kissimmee it double-counts B-32. **Reproduced (pure repro and real sheets).**
- **Where:**
  - `backend/src/ai/evidence/sheetRelation.ts:80-89`: the footprint falls back to the bounding box of *all* marks;
  - `sheetRelation.ts:119-136`;
  - `backend/src/ai/evidence/viewports.ts:319`: the text-layer path never sets `buildingIn`, so every text-layer CAD sheet uses the fallback;
  - `backend/src/ai/countMerge.ts:391-395`.
- **Scenario A (pure).**
  - Two same-level sheets with **identical** 10 duplex positions and no building box.
  - Sheet 1 also has 2 site WP receptacles far out in the lot plus 5 J-boxes; sheet 2 has 8 data outlets.
  - `relateSheets` → `complementary`, "only 2 of 10 marks line up", **20 duplexes**. The two bounding boxes differ, so identical points never align.
- **Scenario B (Kissimmee).**
  - E-2 #11 is an enlarged plan whose `area_on_main` maps onto E-2's main plan.
  - The pairing compares it against E-1 through two independently estimated building boxes. B-32 lands 17% apart ("0 of 5 line up"), so the office outlet shown on both sheets is summed.
  - The relation is decided per sheet pair from the whole-sheet histogram, while the duplication lives in one enlarged viewport.
- **Fix:**
  - Never use the mark bounding box as a footprint. Unknown footprint → `unclear`.
  - Require a building box from both sheets, or register the sheets by their shared grid/wall geometry.
  - Before summing, pair marks of the type at a tighter tolerance on the *raw displayed position* whenever the two sheets share the same scale and size. Kissimmee E-1/E-2 are the same drawing at the same position.
  - Any pair found (B-32) should drop that mark or ask, not sum.

### B5. The 4.1 evidence gate has no UI to supply a reason, so manual lines lock GC documents. **Reasoned (grep); from the 4.1 sweep, re-checked.**
- **Where:**
  - `backend/src/ai/evidence/evidenceGate.ts:54-57` and `backend/src/estimating/takeoffReview.ts` `evidenceGate`, wired at `backend/src/routes/preconstruction.ts:2905, 3409, 3551` and `backend/src/routes/bids.ts:386`;
  - `grep evidence_note frontend/src` returns nothing.
- **Scenario.**
  - The estimator adds a line in Labor & Pricing (`source:'manual'`) or types over a qty (`qty_source:'manual'`).
  - After that, run-agent4, generate-docx, generate-takeoff-xlsx and the GC draft-proposal all return 409, telling them to add a reason "in Labor & Pricing", where no such field exists.
  - Hand-typed quantities are routine, so this blocks real bids on day one.
- **Fix:**
  - Add `evidence_note` to the frontend `EstimateLine` type, with a reason input on manual/overridden rows (Labor & Pricing, and the Plans add-line dialog).
  - Or put the manual-line half behind a setting until the UI ships.
- **Confirmed correct:**
  - the pre-bid package (`generate-prebid-package`, `email-prebid-chris`, draft composition) is exempt;
  - host and merged types are skipped (`evidenceGate.ts:34`).

### B6. The grouped "legend items not found" item lets one click zero equipment that is on the job, and it demotes that equipment in the $-risk order. **Reproduced (fixture).**
- **Where:**
  - `backend/src/ai/reviewItems.ts:454-477`: `isGroupable` ignores category, and the only action is `not_on_job`;
  - `reviewItems.ts:485-494`: individual equipment ranks at tier 0, the group at 33;
  - `reviewItems.ts:729-734`: one resolution zeroes every member.
- **Scenario (Kissimmee's actual group).**
  - The group includes **MB (meter base), WIREWAY, LCP, DATA CONCENTRATOR, the 200A fused disconnect** (LOAD TOTALS shows DISCON A and DISCON B at 200/3 on this job), the thermostat, and the 6 phone-board handy-box duplexes on E-4 #1.
  - The fixture's own test resolves the group "not on job" and asserts that every member becomes null.
  - The item's text offers "resolve one alone by entering a count", but the members' own items are removed and the group has no count action. The only way out is to zero all 12.
  - This hides several real blockers behind one bulk confirm, and it is how the "≤ 12 review items" goal was met.
- **Fix:**
  - Never group `equipment` or equipment_schedule types; keep them as individual tier-0 items.
  - Give the group per-member actions (count / not on job), and require per-member acknowledgement before it counts as resolved.
  - Report the review count honestly: 8 blocking plus the members.

### B7. Schedule rows: sibling equipment tags pick up each other's rows. **Sweep-reproduced; I reproduced the matcher.**
- **Where:** `backend/src/ai/evidence/schedules.ts:284-290` (`rowNamesTarget`) and `schedules.ts:306-313`.
- **Scenario.**
  - The description fallback ("EXHAUST FAN" words) matches a row that names a different tag. `rowNamesTarget('EF-2 EXHAUST FAN', {type:'EF-1', description:'Exhaust fan, roof mounted'})` returns `true`.
  - EF-1/2/3 each get 3 rows: **9 instead of 3**. RTU-1/RTU-2 give 4 instead of 2. WH-1/WH-2 double the same way.
  - These quantities are VERIFIED and are never sent to the counter.
- **Fix:** a row that names any other equipment target's tag as whole words belongs to that tag only. Give each row to exactly one target.

### B8. `multiplierOf` reads numbers that are not quantities, and it runs on whole equipment-schedule rows. **Reproduced.**
- **Where:** `backend/src/ai/evidence/schedules.ts:258-263`, used at `:313` and `:322`.
- **Scenario.**
  - `multiplierOf('WH-1 WATER HEATER 208 1 MAX 30 (2)#10,(1)#10G')` = **30**: the X of "MAX" matches `[x×]\s*\d`.
  - `'LTG 2X4 TROFFERS'` = 4.
  - For equipment/load rows without a QTY column it runs on `r.cells.join(' ')`, so a mechanical schedule row gives WH-1 qty 30, which is VERIFIED.
- **Fix:**
  - Drop the `[x×]` form, or require `\bx\s*\d` preceded by whitespace and followed by an end or space.
  - Ignore "(n)" followed by `#`.
  - For equipment rows, apply it to the description cell only.

### B9. A two-sided panel read from the text layer silently loses its even side. **Sweep-reproduced.**
- **Where:** `backend/src/ai/evidence/schedules.ts:103-135` (`tableFromRuns`), `:167-175` and `:203-215`.
- **Scenario.**
  - On a CAD set with a text layer, left and right circuits share one line, and only the first CKT/DESCRIPTION columns are read. A 1–42 panel yields only the odd circuits.
  - The incompleteness check is skipped for one parity.
  - `circuitSummaryRows` then replaces Agent 1's circuit rows with half the count, marked VERIFIED.
- **Fix:**
  - Split repeated CKT/DESCRIPTION header groups into two rows per line.
  - Flag the panel incomplete when either parity is entirely absent.
  - Never replace Agent 1's row for that panel (see S9).

## Should-fix

- **S1. The coil+J typical likely double-prices the baseflex.** Reasoned; the real E-1 #5 and #7 were checked.
  - Where: `kissimmeeReplies.ts` TYPICALS_REPLIES[49], plus the general mapping in `backend/src/ai/evidence/typicals.ts`.
  - "Receptacle mounted to base plate" belongs to the display-baseflex assembly: J-box, 6' flex and receptacle in an owner kick plate. The eval scores `baseflex` (8) as its own line, and the host count (3 coil+J) disagrees with the estimator's 8.
  - Expanding into the generic DUPLEX line adds 3 commodity receptacles next to the baseflex line.
  - Fix: map receptacles that are part of an assembly into the host's assembly (or a distinct "baseflex receptacle" type), not DUPLEX. Raise the host count mismatch against the schedule/legend as a review item.
- **S2. A typical device with an unstated quantity is skipped silently.** Reasoned.
  - Where: `typicals.ts:224` (`if (d.qty == null) continue;`).
  - The plan says "never guess; missing multiplier = blocking review". An unstated per-host quantity whose device is *not* drawn anywhere produces nothing and no item.
  - Fix: when no drawn marks of that target exist near or at any host, raise a `typical:` confirm item.
- **S3. Drawn-at-host subtraction only works on the same sheet within 30 pt of the tag.** Reasoned.
  - Where: `typicals.ts:236-240`, `HOST_RADIUS_PT = 30`.
  - Pole tags sit on a leader 0.5–1" (36–72 pt) away from the pole, so a device drawn at the pole is not subtracted. A device drawn in an enlarged plan or on the complementary sheet is never subtracted either.
  - Fix: measure from the host glyph, not the tag; widen to ~0.75"; map enlarged-plan marks through `areaOnMain` before measuring.
- **S4. Only the first used sheet is searched, nothing is cached, and there is no cap on jobs.** Reasoned.
  - Where:
    - `gapFillStage.ts:51` searches only `t.sheets.find(s => s.used)`, the first used sheet;
    - `runGapFillStage` has no cache, so every re-run pays again and can change counts non-deterministically;
    - there is no cap on job count (one job per fixture-schedule QTY row, per device named on a circuit, per GFCI type).
  - Each job is ≤ 2 calls, and candidates are capped at 8 (`gapFill.ts:9`), so a call is bounded. The run is not.
  - Fix: cache by (file sha, page, type, finding, model/prompt version) in `sheet_evidence_cache`; cap jobs per run (e.g. 12, ranked by $ risk); search each used sheet or the one the shortfall points to.
- **S5. The GFCI "confirm" pass is always biased toward finding more.** Reasoned.
  - Where: `reconcile.ts:123-143`.
  - Every GFCI type on a raster sheet gets a gap-fill whose WHY says "known undercount risk". The only check is the same model family on a 1.2" crop.
  - Fix: run it as a suggestion-only pass (B2) and cap it. Better still, drop it until a real undercount is demonstrated on a real crop.
- **S6. Migration 134's placeholder passes the gate forever.** Sweep-reproduced.
  - Where: `database/migrations/134_evidence_gate.sql:19-22`, `evidenceGate.ts:57`.
  - The 104-character placeholder satisfies `>= 10`, and nothing clears it when the line is later re-edited. It is one-time (migrations run once, `migrate.ts:48-51`), so it is acceptable as a grandfather clause only if a qty change clears it.
  - Also, `'..........'` passes. Reuse `isRealReason` (`reviewItems.ts:621`).
  - Fix: clear the note on a qty change of a placeholder line, or have the gate reject the exact placeholder on lines updated after the migration.
- **S7. finish-bid stores raw AI counts as the "confirmed" answer key.** Sweep-reproduced.
  - Where: `backend/src/estimating/finishedBidEval.ts:24-35`, route `preconstruction.ts:2172`.
  - A `counted` type whose `count:` item is still open is included as `source:'confirmed'`, so the eval set grades the AI against its own guesses.
  - Fix: exclude types with an open item, or return 409 unless `takeoffGate` is clear.
- **S8. finish-bid's `bomImportDocumentId` is unchecked and mislabels the source.** Reasoned.
  - Where: `preconstruction.ts:2181, 2194-2196`.
  - Any string relabels the case as `bom_import`, while `expected` still comes from confirmed counts.
  - Fix: validate that the document belongs to the bid, and keep `confirmed_counts` until the BOM is actually parsed.
- **S9. Agent 1's circuit rows are removed for panels the parser didn't read.** Sweep-reproduced.
  - Where: `countMerge.ts:730-734`.
  - Once one panel is read completely, every Agent 1 circuit row is removed, including those for an incomplete panel. The fix is per panel.
  - Related: `isCircuitCountRow` (`schedules.ts:341-345`) misses "20A/1P breakers" and "Dedicated circuits (20/1)", which then stay alongside the parser's rows (sweep S8).
- **S10. Other schedule-parser overcounts (sweep S1–S6, reproduced there):**
  - "BATT CHGR (5)" repeated on each of B-15..23 gives 25;
  - multi-pole loads are counted per pole row when the description repeats (`schedules.ts:186`);
  - the same panel on two sheets is counted twice (`:295`, `:351`);
  - `panelNameOf` returns "SCHEDU" for "PANEL SCHEDULE A" (`:159-162`);
  - "1,3,5" is read as circuit 135 (`:180`);
  - "SPARE 20A" / "(SPARE)" / "--" count as circuits (`:307`, `:354`).
- **S11. Family merge edge cases (sweep S9–S13, reproduced there):**
  - voltage or hyphenated catalogs ("…T4M 277", "DSX1-LED-P8-…") break the equivalence, and Kissimmee-style stacking returns (`backend/src/ai/evidence/families.ts:42-43`);
  - an **unreadable** series-only member is folded, and its review item disappears (`:108-109`, `:127-137`);
  - "different schedules" compares raw `sourceSheet` strings, so "E-7" and "E-7 SITE PLAN" merge two tagged types silently (`:69-71`);
  - the schedule→legend fold merges "FDS-1 fused disconnect 200A" into the legend's "Disconnect switch" (`:193-206`);
  - the symbol-definition fold lets unreadable entries through (`:155`).
  - I found no wrong merge between DSX1 P8 and P3 when both are counted; the risky paths are zero or unreadable members.
- **S12. The Agent 1 schedule-quantity ban applies even when nothing replaces the quantities.** Reasoned.
  - Where: `prompts.ts:14` (always on).
  - When counting doesn't run, or the evidence stage fails, the panel circuits have no source.
  - Fix: add a blocking "no circuit source" item whenever `circuitRows` is 0 and the job has panels.
- **S13. The 5–10% random QA sample (plan 4.5) is not implemented, and the report doesn't mention it.**
  - Fix: implement it, or list it as a deferral.
- **S14. The evidence gate ignores review resolutions.** Sweep-reproduced.
  - Where: `evidenceGate.ts:33-36`.
  - A counted type with no evidence that the estimator resolved as "not on job" still blocks. A qty that reaches the GC only through a resolution is never checked.
  - Fix: gate over `enforcedCounts(...)`.

## Nits

- **N1.** The crop check is told to "give that type's tag" for a reclass but is never given the list of targets (`gapFillStage.ts:212-214`, `prompts.ts:562`). A reclassified candidate is also never deduplicated against existing marks of its new type (`gapFillStage.ts:275`). Reasoned.
- **N2.** A whole-sheet search image at the model's limit (~64 px/in on Opus 5.5) is the resolution the counter tiles to avoid; small GFCI glyphs are near illegible. Tile, or crop to the viewport. Reasoned.
- **N3.** The Part 4 cost ($0.061/bid) is computed from the fake client's made-up usage numbers (2,600 / 1,800 input tokens), not from rendered image sizes. The pricing itself is right: Opus 5.5 is $4 / $20 per MTok, matching `eval/takeoffEval.ts:115`. A whole-sheet image plus 8 crops probably costs 2–4× that, which is still small. The model choice (`DEFAULT_EVIDENCE_MODEL = 'claude-opus-5-5'`, effort `medium`, streamed, thinking not disabled) is correct for Opus 5.5. Reasoned.
- **N4.** finish-bid has no duplicate protection (no unique `(bid_id, run_id, source)`). It uses `requireAuth` + `loadAccessibleBid`, like its review neighbours, but not `requireAIPermission('view_results')` like `/results`. Reasoned.
- **N5.** `evidenceGate` open-item ids are built from the description (`takeoffReview.ts:102`), so identical descriptions collide. Use `line_key`. Reasoned.
- **N6.** Labeled events:
  - only positives are logged; `crop_check` is declared but never written;
  - model decisions (`gapfill_accept`) sit alongside human labels, told apart only by `created_by = null`;
  - `detail.answer` is uncapped.
  - Privacy is fine: no image bytes and no emails. Every call site runs after COMMIT and swallows its errors, so a failure never breaks the main flow (`labeledEvents.ts`, `takeoffReview.ts:224-240`, `estimating.ts:1325`, `preconstruction.ts:1294`). Reasoned.
- **N7.** `sheet_evidence_cache` (migration 133) has no retention. Migrations 133–136 are otherwise idempotent (`IF NOT EXISTS`) and non-destructive; 134's UPDATE only fills NULLs, and the 135/136 foreign keys cascade on bid delete with indexes. Reasoned.
- **N8.** The frontend `GROUP_ORDER` (`TakeoffReviewPanel.tsx:173`) orders groups by cause, not by the backend's $-risk rank, so the ordering from 4.5 is partly undone in the UI. Reasoned.

## Focus-area answers in one line each

1. **Receptacles.** 42 is 6 over the real traceable 36: 5 synthetic GFCIs and the B-32 double (B3, B4). The pole typicals are right. The coil+J 3 is doubtful (S1).
2. **Gap-fill.** The tests prove only the bookkeeping. A crop-check "accept" auto-counts without a human. Candidates are bounded (8 per call) but jobs are not (B1, B2, S4).
3. **Part 1.**
   - Viewport attribution and "enlarged shows more → replaces the area" are correct on the real restroom plan (6 vs 2).
   - Legend, schedule and detail marks are excluded by the counter path but **not** by gap-fill (B1).
   - The sheet-pair rule sums true duplicates (B4).
   - AREA A/B titles still take the named-area path and are summed correctly across areas (`countMerge.ts:377-398`).
4. **Part 2.** The pole mapping matches the real legend #9 and the elevations. Multipliers come from counted tags ("never guess" holds for stated quantities). The unstated-quantity and subtraction gaps are S2 and S3.
5. **Part 3.** Battery chargers ×5 are correct on Kissimmee. The matcher and multiplier over-count elsewhere (B7, B8, B9, S10). Family merges are safe for counted members, with the risks listed in S11. The Agent 1 ban needs a fallback item (S12).
6. **4.1.** The pre-bid package is exempt, and host and merged types are skipped. There is no UI (B5). The placeholder is acceptable only if an edit clears it (S6).
7. **4.2.** There is no tolerance and no diff item. The S1+S2 finding compares heads with poles and can change the correct 3 (B2).
8. **4.5.** The grouping hides equipment blockers. Confirming it needs no per-item acknowledgement. The "≤ 12" figure depends on it (B6). The QA sample is missing (S13).
9. **Part 5.** Capture is failure-safe and privacy-safe (N6). finish-bid's auth is OK, but its answer key is polluted (S7, S8).
10. **Cost.** The model and pricing are correct. The readers are cached; gap-fill is not, and its job count is unbounded (S4, N3).
11. **Migrations 133–136.** Idempotent and non-destructive (N7).
12. **Tests.** Totals match the report, and every failure is a known flake. But `kissimmeeEvidence.test.ts` asserts the synthetic 16 / 42 (B3).
