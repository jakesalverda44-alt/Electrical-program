# Report: "Fewer review questions" round (Tasks 0–8)

**Branch:** `feat/fewer-questions` (worktree `Electrical-program-wt-fewer-questions`), based on main `25dce72`.
**Built by:** Opus 5.5, 2026-10-01. **Not merged, not pushed, app not started.** No live AI call was made; no live DB was touched.

## For Jake (plain summary)
On the two 2026-09-30 jobs, replayed through this branch:

- **Kissimmee:** the Takeoff list asked **25 → 10** things.
  - The 13 zero-count equipment rows are now one checklist. Each row quotes its own text and shows what it proposes.
  - The 3 scope questions moved to the Scope step. They still block the proposal.
- **36th Street:** the list asked **16 → 8** things.
  - The 6 zero-count equipment rows are one checklist.
  - The 3 "same area?" questions are answered automatically. Each answer is exactly the one you gave: keep 1, keep 1, keep 9. Each shows its evidence and has an Undo.

Nothing changes a count without showing you. Every automatic answer is listed under "Answered for you", with Undo. Answers from another bid of the same account are labelled "From <bid>".

## Commits (in order)
| Task | Commit | What |
|---|---|---|
| 0 | `f1c553f` | review replay, `reviewCounts`, committed baseline, Gap 1 pinned (`it.fails`) |
| 1 | `8143249` | `auto` record, `AUTO_BY`, `autoDeclined`, `finalizeReview` precedence, group members carried (Gap 1 fixed), member reopen, Agent 4 wording, `textzero` hash tuples, labeled events |
| 2 | `cf523a9` | `textzero:equipment` checklist, `statedQuantity`, proposals, Confirm all, `tradeAssignmentOf` account aliases |
| 3 | `05ee6cf` | registration evidence on `areaQuestion`, automatic "same area" / "different areas" |
| 4 | `4f974b7` | `step: 'scope'`, ScopeQuestionsCard, `useReviewResolve`, Takeoff/Proposal wording |
| 5 | `b955790` | spot-check skipped only on an independent check |
| 6 | `4f5daa5` | account memory (non-default rule), migration 162 |
| 7 | `683067f` | ChecklistCard, AnsweredForYou, auto badge, new NEW_UI_ONLY payloads |
| 8 | `25961f2` | replay gate against the baseline |

## Task 0: baseline (main `25dce72`, before any change)
The file is `backend/eval/review-baseline-2026-10-01.json`. It is never rewritten.

| | Live 09-30 | Baseline replay | Why they differ (by id) |
|---|---|---|---|
| Kissimmee | 33 items (28 blocking) | **29 items, 25 asked, 4 info** | The accuracy round removed `count:PP-OFFICE/CCTV`, `count:PP-TEST` (B4 folded into the poles), `coverage:SITE LIGHT`, `photo:S1` and `photo:S2` (A merged SITE LIGHT into S1/S2). It added `pipepoles:PP-1..6:…` (B4, info). |
| 36th Street | 25 items (17 blocking) | **24 items, 16 asked, 8 info** | `reuse:PANEL B` is missing in the replay. Its reuse quote ("Panels A and B existing to remain per keynote 02") came from the live counter's sheet note, and the replay counter returns `notes: []`. This is a replay artifact, not a change made by this round. |

- The replay passes no `projectType`, because the pipeline does not pass it either (facility checklists never reach a live list).
- Scope questions are rebuilt from the export's stored `scope_question` items, because the export has no `account_terms`. The code comment says so.

## Before → after, by kind (replay, Task 8 gate output)
Cells are asked / info / auto / scopeStep.

**Kissimmee** (total items 29 → 17; asked **25 → 10**; scope step 0 → 3; rows inside groups 14 → 27)

| kind | before | after |
|---|---|---|
| count (zero) | 13/0/0/0 | – (all 13 → 1 checklist) |
| textzero | – | 1/0/0/0 (11 text rows + 2 legend rows) |
| typicalassign | 1/0/0/0 | 1/0/0/0 |
| typicalqty | 3/0/0/0 | 3/0/0/0 |
| area | 2/0/0/0 | 2/0/0/0 |
| legend-zero | 1/0/0/0 | 1/0/0/0 |
| unscheduled | 2/0/0/0 | 2/0/0/0 |
| scope | 3/0/0/0 | 0/0/0/3 |
| photo / pipepoles / spotcheck | 0/1, 0/1, 0/2 | unchanged |

**36th Street** (total items 24 → 19; asked **16 → 8**; auto 0 → 3)

| kind | before | after |
|---|---|---|
| count | 6/3/0/0 | 0/3/0/0 (the 3 informational existing-only rows stay; D3 not built) |
| textzero | – | 1/0/0/0 (2 text rows + 4 legend rows) |
| area | 3/0/0/0 | 0/0/**3**/0 |
| unlisted / demosuggest / reuse / legend-zero | 2, 3, 1, 1 | unchanged |
| info rows (schedule, democompare, remodel ×2, legend-unused) | 5 | unchanged |

**Next same-account bid (Task 6, SCRIPTED other AutoZone bid):** Kissimmee asked **10 → 6**.
- The three `typicalqty:` items are answered from the other bid.
- The 8 legend-zero members and `pipepoles` are answered from it too.
- `scope:lighting` is only pre-filled.

### Pinned proposals
**Kissimmee checklist:**
- CF1-CF3 → Stated 3 (alsoDrawn E-3: 3).
- TSTAT → Stated 2 ("Thermostats #1 and #2 above electric panels (2)").
- PYLON SIGN → Covered by SIGNS (A-18) → not on this job (alsoDrawn E-7: 1).
- AIM and DC get the low-voltage label.
- LCP and QC/RELOCK get "Owner furnishes, APT installs" (from "AutoZone furnished").
- MB, WIREWAY, PC and FSC have no proposal; the row shows a "1" button.

**Kissimmee legend rows (D1):**
- 200A FUSED SWITCH has no proposal. Its label says the panels name 2 (DISCON A and DISCON B, "200A fused switch").
- T has no proposal. Its label says "the same item as TSTAT?", with a one-click "not on this job" answer.

**36th Street:**
- AHU #2 → Named 1.
- TIMER has no proposal ("3-way" is never read as a quantity).
- Legend rows: EQUIPMENT DIRECT POWER, J, M and MOTOR ("needs your number").

### Automatic answers
**36th Street** — `area:ELECTRICAL PANEL`, `area:PANEL B` and `area:$`:
- Each is "Same area — keep 1 / 1 / 9". This equals Jake's stored answers exactly: same answer, same qty.
- Evidence: building outlines aligned; 1/1, 1/1 and 3/3 marks paired; 4/4, 4/4 and 2/2 other-type marks also paired; no title names a floor (17 titles checked).

**Kissimmee** — both area questions stay asked, for these reasons:
- Path: `unclear`, building alignment (verified).
- 0 of 3 SIMPLEX and 0 of 2 DUPLEX marks paired.
- `allMain = false`: a mark is on E-2's enlarged plan.
- The DUPLEX nearest marks are only 0.58" apart, which is not more than 2 × 0.5".

**Spot-checks:** Kissimmee A and B keep theirs. Neither has a schedule quantity column; the load check did not run ("no wattage … E, F, J, K"); there are no earlier answers and no confirmed markers. D2 is not built.

## Task 8 gate (CI, `backend/src/eval/reviewReplay.test.ts`): passes on both jobs
- Every baseline item is one of: the same id, a checklist row, an automatic answer with evidence, or on the Scope step.
- An unanswered list is `needs_review`. With a scripted full answer set, `enforcedCounts` equals the baseline-shaped list answered the same way.
- The expected-file diff on the enforced counts is identical: no pass → fail, and no larger |delta|.
- 36th Street's automatic answers equal Jake's stored answers. Its projected hours and material are unchanged against Jake's answers.
- Pinned: Kissimmee asked ≤ 10 (exactly 10), 36th asked ≤ 10 (exactly 8). The exact by-kind numbers are pinned.

## Per task: what was done and what to check
**Task 1**
- `ReviewResolution.auto {source, reason, evidence, fromBid?, memoryKey?}`, `AUTO_BY = 'CRM (automatic)'`, `memoryBy()`.
- `autoDeclined` on items and on grouped members, set by reopen (Undo).
- `finalizeReview` precedence: human > declined > evidence auto > memory.
  - An automatic answer is never carried; the next run re-derives it.
  - `autoDeclined` is carried while the fingerprint is unchanged. A changed fingerprint allows the automatic answer again (tested).
- **Gap 1 fixed.** Member answers of `legend-zero:`, `legend-unused:` and `textzero:` carry by member key and fingerprint. They also carry between a standalone `count:<K>` and member K. The group resolution is recomputed. The Task 0 `it.fails` now passes.
- Reopen takes an optional `memberKey` (Undo of one member).
- Agent 4:
  - Automatic answers read "(answered automatically: <reason>)" and never "estimator".
  - `textzero` members are listed one per line.
  - A legend-zero group with an automatic member is listed per member too (an addition).
- `hashScopeSnapshot` adds member tuples for `textzero:` only. Old hashes are byte-identical, and a test computes the old formula.
- Labeled events `auto_answer` and `auto_answer_undo` are fire-and-forget, after the transaction.

**Task 2**
- `textzero:equipment` is one blocking item, `category 'equipment'` (risk tier 0). Its member fields are `rowKind`, `quote`, `proposal`, `label`, `alsoDrawn`, `twinOf` and `fingerprint`.
- `statedQuantity` is strict. "(N)" and number words count only when they open the row: "(6) contactors" mid-row and "light with two heads" were both caught by the sweep.
- The sweep over every equipment, legend, panel and fixture description in both exports is pinned to 4 hits: BATT CHGR 5, TSTAT 2, EF 2, CF1-CF3 3. MB "(2)4#3/0" and QC/RELOCK → none.
- Confirm all is `{itemIds:['textzero:equipment'], action:'confirm', reason}` with no memberKey. It applies only unanswered text rows that have a proposal; legend rows and rows without a proposal are untouched, and the response returns `checklistOpen`.
- Anything else without a memberKey → 400. A multi-item call that includes it → 400 (S16).

**Task 3**
- `registrationOf` / `verifyRegistration` in `sheetRelation.ts`.
- `areaQuestion.registration[]` records the cause (`s15` / `unclear`). The count in countMerge is unchanged.
- `autoAreaAnswer` uses the thresholds exactly as specified, with one judgement: a ROOF plan title does not count as a floor (Kissimmee has two roof-plan pages).

**Task 4**
- `step: 'scope'` on `scope_question`. Blocking is unchanged.
- `useReviewResolve` hook. `ScopeQuestionsCard` is mounted on the Scope step in `PcWorkspaceView` (not inside `ScopeTab`, to leave ScopeTab's memo/props alone).
- Takeoff list: one row with "Go to Scope", and "Takeoff questions done".
- ProposalTab: "N questions open — X on Takeoff, Y on Scope". `reviewBlocked` is unchanged.

**Task 5**
- `spotCheckPlan` runs checks 1, 2 and 4.
- Check 3 (an earlier human answer with the same count) runs in `finalizeReview`.
- The pipeline tallies confirmed markers with the run's own count result (`confirmedMarkersForType` gained an optional count-result argument).

**Task 6**
- `ai/accountMemory.ts` (pure).
- `bidstd/accountMemoryDb.ts` (sources, account identity; the Default rule is never an account).
- Migration **162** (index on `account_terms->>'ruleId'`).
- "Counts are never remembered" holds for zero rows. Typical packages remember their quantity. Scope answers are only pre-filled.
- **AutoZone pole types** are remembered through the pole-type packages (typical / typicalqty) and the pipe-pole decision, never per pole.

**Task 7**
- ChecklistCard: quote, proposal chip, [Use N], qty + Save, "1", Not on this job (typed reason only), the twin quick answer, "Use those markers", and Confirm all behind a dialog that lists every pre-filled row with its value and quote.
- AnsweredForYou (`data-testid="review-auto"`): evidence shown inline, the source label, and Undo (with memberKey for a member).
- Automatic answers are left out of the person's "resolved" list.
- The shell shows a badge.

## Shared-file edits (all additive, behind id prefixes / optional inputs)
- `backend/src/ai/reviewItems.ts`
  - types `AutoAnswer` and `GroupedMember`, plus `autoDeclined`, `step`, `memoryText`, `lessonHints`;
  - `finalizeReview`, `withGroupResolution`, `autoAnswersOf`, `autoAreaAnswer`, `spotCheckPlan`, `spotCheckFromPrevious`;
  - the checklist hook before `groupLegendZeroItems`;
  - `groupOf('textzero')`, the `textzero:` prefix in `enforcedCounts`;
  - Agent 4 wording;
  - `carryOverResolutions` (excludes automatic answers, carries members);
  - `memoryText` on typical / typicalqty / pipepoles / reuse.
- `backend/src/estimating/takeoffReview.ts`: the textzero branch and Confirm all, `autoDeclined` on reopen, member reopen, `checklistOpen`, the `confirmedMarkersForType` optional count-result argument, undo events (plus the Level 2 capture hooks).
- `backend/src/routes/preconstruction.ts`:
  - `finalizeReview` replaces `carryOverWithFollowUps`;
  - `inventoryTitles`, `accountAliases`, `agent1Panels` and `confirmedMarkers` options;
  - the memory applier; the auto events;
  - `hashScopeSnapshot` (`textzero` tuples only);
  - reopen `memberKey`.
- `backend/src/ai/countMerge.ts`: `areaQuestion.registration` (evidence only).
- `backend/src/ai/evidence/sheetRelation.ts`: `registrationOf` and `verifyRegistration`.
- `backend/src/bidstd/tradeAssignment.ts`: optional `accountAliases` (unchanged without it).
- `backend/src/estimating/labeledEvents.ts`: new kinds.
- Tests that pinned the standalone equipment items now assert the same rows inside the checklist:
  - `reviewItems.test.ts` (2 tests);
  - `kissimmeeLiveReplay.test.ts` (blocking 17 → 9, items 25 → 17);
  - `kissimmeeEvidence.test.ts` (21 → 16, 15 → 10);
  - `remodel36thReplay.test.ts` (Q1: the checklist members are exactly the before list's `count:<K>` items).
- Frontend:
  - `TakeoffReviewPanel.tsx` (the hook, the scope filter, AnsweredForYou, ChecklistCard);
  - `review/reviewModel.ts` (`textzero` heading / order / card kind, `reviewProgress` `excludeStep`);
  - `review/ReviewCardShell.tsx` (auto badge);
  - `review/payloadCases.ts` (**frozen section byte-identical**; only appended after `NEW_UI_ONLY`);
  - `PcWorkspaceView.tsx` (ScopeQuestionsCard mount, `onGoScopeStep`);
  - `ProposalTab.tsx` (text only).
- Test fixtures: `replay0930.ts` and `replay36thB.ts` gain an optional `learning` pass-through (Level 2).
- **Not touched:** `eval/replayEval.ts` (left to the gap-closing round), pricing / mapping / footage / library / units files, LaborPricingStep / BidSummary / AccubidPricingPanel, migrations 164–168.

## Deviations and judgement calls (please check)
1. **D1 legend rows carry no proposal**, so how they are answered is unchanged.
   - The plan's twin example ("T = not on job") and named example ("200A switch ← DISCON A/B = 2") are shown as labels on the legend row.
   - T also gets a one-click "Same item as TSTAT — not on this job" answer.
   - Confirm all never touches them.
2. **`reviewCounts`** lives in `eval/reviewCounts.ts`, re-exported by `eval/reviewReplay.ts`, instead of `replayEval.ts`. This avoids a conflict with the gap-closing round's additive edits there.
3. **Kissimmee alias:** the replay passes `accountAliases: ['AutoZone']`. The export's scope notes name the rule "AutoZone"; the live rule's real alias list is only in the live DB. This only affects labels; no proposal depends on it.
4. **Memory sources include carried-over human answers.** The plan text said "not carriedOver". Its stated reason was that automatic answers must never chain, and that is guaranteed because automatic answers are never carried. Excluding carried answers would make a source bid useless after any re-run. **Decision for Jake: keep it, or exclude them?**
5. **"Use those markers"** on a checklist row posts a count equal to the `alsoDrawn` total, with a reason naming the sheets. The `markers` action would not tally marks on a sheet the type is not counted from.
6. **Single-level check:** a roof plan title does not count as a floor.
7. **Scope questions card** is mounted next to ScopeTab, not inside it.

## Open questions for Jake
- Deviation 4 (carried-over answers as memory sources).
- D3 (fold 36th's 3 existing-only rows into `remodel:existing`) is still not built. 36th would go from 8 → 5 informational rows.
- The "1" quick button shows on every row without a proposal (D4 = no pre-fill). Should it show only on one-noun rows ("Meter base NEMA 3R")?

## Test counts
- New backend tests in this round: `reviewReplay.baseline`, `finalizeReview` (19), `fewerQuestionsUndo` (2), `statedQuantity` (21), `zeroChecklist` (5), `fewerQuestionsChecklist` (3), `autoArea` (19), `scopeStep` (2), `spotCheckIndependent` (9), `accountMemory` (13), `accountMemoryDb` (2), `reviewReplay` gate (8).
- New frontend tests: `ScopeQuestionsCard.test` (6), `ChecklistCard.test` (7).
- **Full suites, one run at the end of both rounds:**
  - Backend: 3,162 tests. 3,157 pass after `ee6ea5c`, which fixed 2 real misses (an allowlist entry and the Q1 snapshot's new additive fields). The other 5 are the known timeout flakes in untouched intake / integration files.
  - Frontend: 1,694/1,694 pass.
  - Details are in `2026-10-01-learning-l2-report.md`.

## Fix round 1 (after the Opus review, 3f3160b)

Fixed exactly what the review listed. No live AI, `learningEvalLive.ts` not run, live DB not touched, `payloadCases.ts` frozen section untouched.

- **S1 parser.** `statedQuantity` now rejects note / keynote / detail references: the plural nouns notes, keynotes, details, sheets, items, refs, drawings, specs, sections and the like; a trailing `(N)` within 3 words of note / detail / sheet / ref / see / per; and number words before units (volt, amp, watt, inch, foot, ton, hp). The five review probes are pinned as "never" cases. The pins hold: MB none, QC/RELOCK none, TSTAT 2, CF1-CF3 3, BATT CHGR 5, EF 2. A new sweep walks every description string anywhere in both exports (agent1 and count targets): only those same real rows match.
- **S2 precedence.** An automatic answer never hides the estimator's own different earlier answer. Memory (item and group member) is skipped when a differing `previousResolution` exists. A registration auto answer whose fingerprint changed under a different human answer is dropped: the item stays open with the earlier answer shown. Tests cover the matrix.
- **Roof-plan exemption (deviation 3).** The roof no longer counts as "not a floor" when the roof is one of the question's own sheets (`autoAreaAnswer`). Test added.
- **"1" quick button (deviation 5).** Narrowed to text rows with no proposal that name one thing: never a legend row, never a length item (wireway, conduit, cable and so on), never a plural. Test added.
- **Deviations 1 and 2** kept as the review recommended (carried-over memory sources, D1 labels).
- **Nits.** The previous-answer spot-check matcher accepts only `count:`, `recount:` and `spotcheck:` answers. A checklist member confirmed without a quantity no longer prints "undefined EA" for Agent 4. Tests added.
- **Check dialog (S4).** The confirm dialog now lists, per eval job, "will run" or "no change, nothing in the bank applies (no model calls)" (new admin `GET /api/learning/releases/preview`).

Tests: full backend 3,264 pass; the only failures are the known flakes (intakeSimilar.route x2, intakeSimilarCache x2, integration lead-backfill). Frontend `tsc` clean, full vitest 1,699/1,699. Details in `2026-10-01-learning-l2-report.md`.
