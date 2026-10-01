# Plan: "Fewer review questions" round (2026-09-30 planning; build after the accuracy round and UI round 2A merge)

**For Jake (plain summary, under 120 words):**
On the live runs, Kissimmee asked 33 things and 36th Street asked 25. Most of the extra questions were one of two kinds. Some were equipment rows from the notes or schedules that are never drawn as symbols. Others were "same area?" questions that the drawings already answer. This round makes four changes. The notes/schedule rows become one checklist, with counts filled in from the text and the quote shown, and one "Confirm all" button. "Same area?" is answered automatically when the sheets line up, with the evidence and an Undo. Scope questions move to the Scope step and still block the proposal. A spot-check is skipped only when an independent check agrees. Answers you gave on another bid for the same account are offered back, labeled, and can be changed. Nothing changes a count without showing you.

---

**Date:** 2026-09-30 · **Status:** Jake approved reductions 1–5 · **Planned by:** Opus 5.5 (planner, read-only)
**Execution:** Opus builds, because this round changes what gets counted. Sonnet does the fix rounds. Opus reviews.
**Depends on:** main after these merges:
- `feat/accuracy-reading` (R: currently `d152ca7` plus uncommitted B2/B3/B4/C3 work);
- `feat/accuracy-pricing` (P: `b944976`, with C7 and the D3/D4 seeds uncommitted);
- `feat/estimating-ui-round2a` (`457ad69`, Tasks 0–3 committed, 4–6 still to come).

**Migrations:** P used 158 and 159 as planned, then also took **160** (`160_bid_calibration_flag.sql`, already on its branch; the plan had reserved 160 for R). R may take 161. This round needs **no migration**. One optional index gets the next free number, expected **162**. The builder confirms with `ls database/migrations | tail` after the merges.

## Goal
Fewer questions on the Takeoff review list, measured by the replay harness:
- Kissimmee 33 → about 8–10, and 36th 25 → about 8–10 questions that need Jake;
- with no change to what blocks the proposal;
- with no count raised or lowered silently;
- with every automatic answer visible, carrying its evidence and an Undo.

## Constraints (do not relitigate)
- **Never lower or raise a count silently.** Every automatic answer is a normal `resolution` with an `auto` record (why it was answered, the evidence, the source). It is listed under "Answered for you" with an Undo button, and Undo is the existing reopen. Pre-filled checklist values are **proposals**: nothing counts until Jake confirms.
- **Blocking is unchanged.** `reviewItemIsOpen`, `reviewStatus`, `takeoffGate`, ProposalTab's `reviewBlocked` and the PrebidPackagePanel gate keep their meaning. Scope questions still block. A grouped checklist blocks until every member has an answer.
- **No live AI calls** in tests (use `fakeAnthropic` and the replays).
- **No DB writes outside `electrical_crm_test`.** An optional live export must be read-only (`PGOPTIONS='-c default_transaction_read_only=on'`) and needs Jake's OK.
- Worktree only: `../Electrical-program-wt-fewer-questions`, branch `feat/fewer-questions`. No dev servers, no push.
- Standing rules still apply:
  - "By G.C." = APT scope.
  - Owner-furnished = APT installs.
  - The photometric sheet never stacks.
  - Equipment gets no preset reasons (2A).
  - S16 ("equipment is never zeroed in bulk") stays, with one exception Jake approved: the checklist's "Confirm all" (Task 2; see Reviewer focus 3).
- Payload parity: round 2A's `review/payloadCases.ts` cases must not change. New bodies go only in its `NEW_UI_ONLY` section.
- Commit per task, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Report: `docs/superpowers/plans/2026-10-xx-fewer-questions-report.md`. It lists every shared-file edit and every before/after number taken from the baseline file.

## Findings (read-only, with the evidence)

### What the live runs contain (fixtures in the R and P worktrees, `backend/src/test/fixtures/realrun/*-2026-09-30.json`)

**Kissimmee: 33 items, 28 blocking and 5 informational.**
- 15 `count:` zero items. In `countResult.targets`, **13 have `source: 'equipment_schedule'`**: MB, WIREWAY, LCP, QC/RELOCK, PP-OFFICE/CCTV, PP-TEST, DC, PC, AIM, TSTAT, FSC, CF1-CF3, PYLON SIGN.
- **2 are `source: 'legend'`:**
  - `200A FUSED SWITCH NEMA 3R` (legend on E-4);
  - `T` Thermostat (legend on E-1).
- All 15 are `category: 'equipment'`. That is why B6 (`groupLegendZeroItems`, reviewItems.ts:1281) keeps each one on its own.
- `targets[].assignment` is **null** even for "AutoZone furnished, contractor installed". `tradeAssignmentOf` (bidstd/tradeAssignment.ts:58) knows nothing about account names, so "AutoZone furnished" is not read as Owner-furnished.
- CF1-CF3 and PYLON SIGN have reason "found only on E-3/E-7 … not counted there". There are marks to point at: 3 on E-3 and 1 on E-7.
- The other items:
  - `coverage:SITE LIGHT`;
  - `photo:S1`, `photo:S2`, `photo:L`;
  - `typicalassign:PP-1..6`;
  - 3 `typicalqty:`;
  - `area:SIMPLEX RECEPTACLE`, `area:DUPLEX / FLOOR RECEPTACLE`;
  - `legend-zero:` (8 members);
  - 2 `unscheduled:`;
  - `scope:lighting`, `scope:panels`, `scope:disconnects`;
  - `spotcheck:A`, `spotcheck:B`.
- `bid.brand` is **null** (the name is "AutoZone"). So `takeoff_labeled_events.client` is null for this bid. Remembered answers cannot be keyed on it.

**36th Street: 25 items, 17 blocking and 8 informational.**
- 6 zero items:
  - `EQUIPMENT DIRECT POWER`, `J`, `M`, `MOTOR`: `source: 'legend'`, E1.0, equipment;
  - `AHU #2`, `TIMER`: `equipment_schedule`.
- 3 area items: ELECTRICAL PANEL, PANEL B, `$`. **Jake answered all three "Same area — keep" (1, 1, 9).**
- 2 `unlisted:`, 3 `demosuggest:`, 2 `reuse:`, 1 `legend-zero:`.
- Informational items:
  - `count:GFI`, `count:WP`, `count:42` (existing-only, not blocking);
  - `schedule:`, `democompare:`, `remodel:existing`, `remodel:demolition`, `legend-unused:`.

### Where each kind of item is generated (main `cbb0cdf`, `backend/src/ai/reviewItems.ts`)
- **Zero / unreadable `count:<K>`:** the `buildReviewItems` loop, lines 253–282.
  - It is informational when `assignment.aptScope === 'none'` or `existingMarks > 0`.
  - The B6 legend-zero grouping happens at lines 1281–1309. Legend-zero items exclude equipment, keyword equipment and phone-board items.
- **Area `area:<K>`:** lines 283–296, from `TypeCountResult.areaQuestion`. That is set in `ai/countMerge.ts` combineCore (lines ~425–528) in two cases:
  - **(a)** `relateGroup` returns `unclear`;
  - **(b)** S15: the relation is `duplicate`, but one sheet's title names no level (`unparsedLevel`). The question is asked even when the marks pair exactly.
  - Both live cases are now explained (`countResult.types[].relations`):
    - **36th**, all three types: `duplicate`, "1 of 1" / "3 of 3 marks sit in the same places … (building outlines aligned)". They are asked only because of the S15 rule (E1.0 and E2.0 are both titled "Electrical Plan", with no level).
    - **Kissimmee** SIMPLEX and DUPLEX: `unclear`, "0 of 3 [0 of 2] marks line up and the sheets carry similar content (similarity 0.76 / 0.72)". The sheets did align, but zero pairs plus similar content falls through to unclear.
  - The machinery is `ai/evidence/sheetRelation.ts`:
    - `alignSheets` (building box → mark-vote offset → sheet frame);
    - `relateSheets` (`DUPLICATE_FRAC 0.6`, `DIFFERENT_CONTENT_BELOW 0.5`, `PAIR_TOL_IN 0.5`, `FRAME_TOL_IN 1.0`).
  - The demolition comparison uses the same functions.
- **`photo:`** lines 878–888 (informational). **`scope:`** lines 889–904. **`spotcheck:`** lines 942–957 + `spotCheckSamples` 1240–1262 (informational, count ≥ 20, no independent check today).
- **typical / typicalqty / typicalassign:** lines 462–605. The R branch adds the per-pole `perPoleAssignmentItem` and the B4 `pipepoles:` item (non-blocking `area`).
- **Scope questions:** built in `routes/preconstruction.ts:1298` (`scopeQuestionsFor(accountTerms)`).
  - Their kind is `scope_question` with no `blocking:false`, so they **block today** (Agent 4, docx/xlsx, proposal send, pre-bid package).
  - The pipeline order is fresh items → `carryOverWithFollowUps` (1308) → write.

### Gaps found that this round depends on
1. **Group member answers are not carried to a re-run.** `carryOverResolutions` (reviewItems.ts:1659) carries only the item-level `resolution`. `groupedTypes[].resolution` is dropped. A fully answered legend-zero group comes back "resolved", but `enforcedCounts` (1953–1959) only reads member resolutions, so **the member counts and not-on-job answers are lost after a re-run**. A partly answered group loses everything.
   - 36th's `legend-zero:220V-C-D-E1-E3-OS` is exactly this case.
   - The checklist reuses this structure, so Task 1 must prove this with a test and fix it.
2. **`hashScopeSnapshot`** (preconstruction.ts:657) ignores member resolutions, so answering a member does not mark the proposal stale.
   - Fix this for the new `textzero:` item only. Existing hashes stay byte-identical, so no old proposal turns stale.
3. **`reviewResolutionsForAgent4`** (2016) prints a group only as "confirmed by the estimator (every item in the group answered)", without its members. It would also call an automatic answer "confirmed by the estimator", which is untrue.
4. **`takeoff_labeled_events`** says in its migration (135) that "nothing here is read back into the live pipeline". **Remembered answers must not read from it.**
   - The source is instead the other bids' `takeoff_results.review_items`, joined on `takeoff_results.account_terms->>'ruleId'`. That is one row per bid (`UNIQUE(bid_id)`, migration 010).
   - Labeled events stay write-only. New kinds are `auto_answer` and `auto_answer_undo`; `event_kind` is TEXT, so no migration is needed.
5. **Spot-check independent checks on these two jobs:**
   - Kissimmee A/B have `scheduleRows: null` (no quantity column);
   - `loadCheck.ran = false` ("no wattage … E, F, J, K");
   - no earlier run ever answered `spotcheck:` (0924, 0928 and 0930 fixtures all unanswered).
   - **So no approved independent check applies, and the two spot-checks stay** (they are informational). "Exact on 3 runs" is agreement between AI runs, not an independent check. It is offered as Decision D2.
6. **ProposalTab's `openReviewCount`** counts every item without a resolution, informational ones included. Blocking still works because `review_status` is checked too. Leave it alone, but its message must say where the open questions are (Task 4).

### What the accuracy round already removes (assumptions; Task 0 measures them)
- **B4** (R, uncommitted `countMerge.ts:942`, `typicals.ts:351`): `PP-OFFICE/CCTV` and `PP-TEST` fold into the pole types, which removes 2 zero items. B4 also adds one informational `pipepoles:` item.
- **A** (R `d152ca7`): SITE LIGHT is merged into S1/S2 and S1/S2 stop being `photometricOnly`. That should remove `coverage:SITE LIGHT`, `photo:S1` and `photo:S2`. `photo:L` stays.
- **B3** (R, uncommitted): `typicalassign:` becomes one per-pole item. It is still 1 item.
- **F2** (both branches): `src/eval/replayEval.ts` (pricing) and `test/fixtures/realrun/replay0930.ts` (`replayKissimmee0930()` / `replay36th0930()` → `buildReviewItems(cr)`, **without scope questions**).
  - The two branches' copies differ (R 177 lines, P 190). The plan builds on the merged copy.
- **If any of these did not land, the Task 0 baseline shows it.** Then the report's expected numbers shift, and nothing here re-does that work.

### Round 2A frontend this builds on (`Electrical-program-wt-round2a/frontend/src/features/preconstruction/PcWorkspace/`)
- **`review/reviewModel.ts`:** `groupKey`, `GROUP_ORDER`, `groupHeading`, `unitsOf`, `reviewProgress`, `orderedGroups`, `openOrder`, `cardKindOf`, `reasonPresets`, `choiceLabel`.
- **`review/reviewCards.tsx`:** CountCard, QuantityCard, ChoiceCard, ConfirmCard, UnlistedCard, LegendGroupCard, ReconcileCard.
- Also `TypicalAssignCard.tsx`, `ReviewCardShell.tsx` and `ReasonPicker.tsx`.
- **`TakeoffReviewPanel.tsx`** keeps `resolve()`, `reopen()` and the "resolved" list.
- **Mount:** `PcWorkspaceView.tsx` ~1604 for the review panel and ~1716 for ScopeTab (which today gets no review props). `onGoScopeStep` exists at ~1301.

---

## Decisions for Jake (the build defaults are in bold)
- **D1: include legend-symbol equipment zeros in the checklist** (Kissimmee T and 200A switch; 36th Equipment direct power, J, M, Motor).
  - Approval 1 said "not legend symbols". Recommended: **yes, as "enter each" rows with no pre-fill and no Confirm-all**, so how they are answered is unchanged.
  - Without it, 36th stays at about 13 questions and Kissimmee at about 10–12.
  - Builder flag: `CHECKLIST_LEGEND_EQUIPMENT` (default **true** if Jake says yes, else false).
- **D2: spot-check skip when the previous run of the same drawings gave the same count** (AI agreeing with AI, so not independent). Default **no**.
- **D3 (optional, not built unless asked):** fold existing-only zero informational items (36th GFI/WP/42) into `remodel:existing` (−3 informational rows).
- **D4: one-noun wording ("Meter base NEMA 3R") pre-fills 1.** Default **no**: the row shows a "1" quick button instead.

---

## Tasks

### Task 0: Baseline on merged main and a review-count output (no behavior change)
**Files:**
- `backend/src/eval/replayEval.ts`: add `reviewCounts`;
- new `backend/src/eval/reviewReplay.ts`;
- new `backend/eval/review-baseline-<date>.json`;
- new `backend/src/eval/reviewReplay.baseline.test.ts`.

**Changes:**
1. `reviewReplay.ts` (pure orchestration, no model, no DB) has `replayReview(job: 'kissimmee'|'36th', opts)`:
   - the counting replay (`replayKissimmee0930` / `replay36th0930`) → `countResult`;
   - the **scope questions rebuilt from the export's stored `scope_question` items** (term, label, question, options, optionParties, notes, suggested). The export has no `account_terms`; say so in the code comment;
   - `buildReviewItems(cr, scope, { projectType, inventoryTitles })` → `finalizeReview(fresh, { previous: null, memory: [] })`. That is a pure wrapper of today's carry-over; Tasks 1–6 extend it;
   - output `{ items, counts }`.
2. `reviewCounts(items)` returns:
   - `total`;
   - `asked`: blocking, no resolution, not on the Scope step;
   - `scopeStep`;
   - `info`: `blocking:false`;
   - `auto`: resolved with `auto`;
   - `byKind`: id prefix → `{asked, info, auto, scopeStep}`;
   - `members`: rows inside groups.
3. Commit the baseline JSON, made on merged main **before** any change: per job, every item's `{id, kind, group, blocking, typeKey, title}` plus `counts`. It also records the 36th stored answers for the three area items.
4. Characterization test for Gap 1. Answer two legend-zero members (count 6, not on job), call `carryOverWithFollowUps(fresh, prev)`, then `enforcedCounts`.
   - It **fails today**. Mark it `it.fails` and give the reason in the test name, so Task 1 flips it.

**Acceptance:**
- the baseline numbers are printed in the report;
- they match 33/25 minus whatever the accuracy round already removed, with each difference explained by id.

### Task 1: Shared auto-answer plumbing, and carrying group members over
**Files:**
- `backend/src/ai/reviewItems.ts`;
- `backend/src/estimating/takeoffReview.ts`;
- `backend/src/estimating/labeledEvents.ts`;
- `backend/src/routes/preconstruction.ts` (pipeline + `hashScopeSnapshot`).

**Changes:**
1. `ReviewResolution.auto?: { source: 'registration' | 'independent_check' | 'account_memory'; reason: string; evidence: string[]; fromBid?: { id: string; name: string }; memoryKey?: string }`.
   - `export const AUTO_BY = 'CRM (automatic)'`.
   - A memory answer's `by` is `CRM (from <bid name>)`.
2. `ReviewItem.autoDeclined?: string[]`, holding the `auto.source` values Jake undid.
   - `takeoffReview.applyResolution` reopen branch (line ~271): if the resolution being removed has `auto`, push its source into `item.autoDeclined` before deleting it.
3. `finalizeReview(fresh, { previous, memory })` (pure, in reviewItems.ts). This is the pipeline's single entry point, replacing the direct `carryOverWithFollowUps` call at preconstruction.ts:1308. Precedence, in order:
   1. **human:** a previous resolution without `auto` (same id + fingerprint, today's rule) wins;
   2. **declined:** a previous item whose `autoDeclined` includes the fresh auto's source loses that auto resolution and is open again. `autoDeclined` is carried while the fingerprint is unchanged;
   3. **evidence auto** (registration / independent check, set by the builders);
   4. **account memory** (Task 6), only on items still open.
4. **Fix Gap 1:** carry `groupedTypes[].resolution` per member.
   - Key: (group id prefix, member key, member fingerprint). Members gain `fingerprint`, which is the member type's `status|count|sheets`.
   - Not keyed on the group id, so a group whose member set changes still keeps its answers.
   - The group's own `resolution` is recomputed by `applyGroupMemberResolution`'s all-answered rule, never copied.
5. `reviewResolutionsForAgent4`:
   - auto items read `- X: <answer> (answered automatically: <reason>)`;
   - `textzero:` members are listed one per line using the existing per-action wording.
6. `hashScopeSnapshot`: add member tuples **only for `textzero:` items**, so existing hashes stay the same.
7. Labeled events:
   - `LabeledEventKind` gains `'auto_answer' | 'auto_answer_undo'`;
   - log them when the pipeline writes, and on reopen of an auto item;
   - `detail: {itemId, source, memoryKey?, fromBidId?}`;
   - fire-and-forget, after the transaction.

**Edge cases:**
- Undo, then re-run: stays open.
- A changed fingerprint after Undo: auto is allowed again, because the evidence changed. Test it.
- Agent 4 never says "estimator" for an auto item.

**Tests:**
- Task 0's characterization test now passes;
- the precedence matrix (human > declined > evidence > memory);
- the reopen sets `autoDeclined`;
- the hash is unchanged for a fixture with no `textzero`.

### Task 2: One checklist for zero-count items from notes, schedules and equipment lists (approval 1)
**Files:**
- new `backend/src/ai/evidence/statedQuantity.ts` (pure) + test;
- new `backend/src/ai/evidence/zeroChecklist.ts` (pure) + test;
- `reviewItems.ts` (builder, `groupOf`, `riskRank`, `enforcedCounts`);
- `takeoffReview.ts` (member branch + Confirm all);
- `bidstd/tradeAssignment.ts` (an optional `accountAliases` parameter).

**Who joins the checklist:**
- a type with `status 'zero'`, not a host, not merged, not `legendUnused`, not informational (keep today's informational items as they are);
- AND either:
  - the target `source` is `equipment_schedule` | `panel_circuits`, **or**
  - (D1) the target is legend-sourced with `category 'equipment'` or `EQUIPMENT_KEYWORD_RE`;
- `:heads` and `unreadable` stay as they are.

**Item:**
- `id: 'textzero:equipment'` (fixed, so the carry-over is stable), `kind 'count'`, blocking;
- title: `${n} items from the notes / schedules weren't drawn as symbols — confirm counts`;
- `group 'textzero'`, `riskRank 0` (equipment tier);
- `actions ['count','markers','not_on_job','confirm']`;
- `groupedTypes[]` members extended with:
  - `rowKind: 'text' | 'legend'`;
  - `quote: { text, sheet, field }` (the equipment row's description, sheet and field);
  - `proposal?: { action: 'count' | 'not_on_job'; qty?: number; reason: string; tier: 'stated' | 'named' | 'classified' | 'twin' | 'covered' }`;
  - `alsoDrawn?: Array<{ sheet: string; count: number }>`, taken from the type's unused per-sheet counts (CF1-CF3 E-3: 3; PYLON SIGN E-7: 1);
  - `twinOf?: string`;
  - `fingerprint`.

**`statedQuantity(text)`** returns `{ qty, quote } | { conflict: string[] } | null`. Strict rules:
- Matches:
  - `(N)` before a noun, as in "(3) Ceiling fans" or "(5) Battery chargers";
  - a trailing `(N)`, as in "… above electric panels (2)";
  - `#1 and #2` / `#1, #2 and #3` / `#1-#6` after a plural noun;
  - number words two through twelve before a plural noun.
- **Never** matches:
  - `(2)4#3/0` or anything where `#`, `"`, `/`, `A`, `P`, `kcmil`, `W`, `VA` or `gal` follows the number;
  - circuit lists (`ckt`, `A-18`, `B-1,3,5`);
  - "1 and 2 circuit models" (`circuit`/`model` follows);
  - sizes ("12x12").
- Two different quantities → `conflict`, and no pre-fill.
- Tests: **a sweep of every equipment/panel/legend description in both 0930 fixtures**, pinned. Expected:
  - TSTAT → 2 ("#1 and #2" and "(2)" agree);
  - CF1-CF3 → 3;
  - MB → null (the "(2)4#3/0" trap);
  - QC/RELOCK → null.

**Named tier:**
- A tag that names one unit (`AHU #2`, `RTU-1`) → 1, with quote "named unit AHU #2".
- A legend type matched to Agent 1 `panels[]` entries whose `fedFrom` names it. Example: "200A fused switch" ← `DISCON A (200A fused switch)` and `DISCON B (200A fused switch)` → 2, quoting both, but only if the names are distinct.

**Classified tier:** `tradeAssignmentOf(text, { accountAliases })`, where the aliases are the matched rule's `matchAliases`.
- "<alias> furnished" → Owner furnishes, APT installs (`aptScope 'install'`). The row still needs a count, so this sets the label only, never the quantity.
- "installed by AutoZone vendor" → `none` → proposal `not_on_job`, reason "By others per <sheet>: '<quote>'".
- Low-voltage words (data concentrator, alarm/security interface, phone board, thermostat, CCTV) with no stated party → label "low-voltage / controls — usually by others; APT's?" and **no proposal**.
- Account memory (Task 6) is what answers these on the next bid of the same account.

**Twin tier:** a legend row and a text row whose significant words overlap on a non-generic noun (thermostat; fused switch ↔ disconnect) and only that pair. Kissimmee example: T ↔ TSTAT.
- The pair is shown as one row: "T (legend, E-1) = TSTAT 'Thermostats #1 and #2 … (2)' — counted once".
- The proposal is TSTAT = 2 and T = not on job, reason "same item as TSTAT". **No double count.**

**Covered tier:** a row whose circuit or name is carried by a counted line ("PYLON SIGN, circuit A-18" ⊂ SIGNS "pylon sign A-18").
- Proposal `not_on_job`, reason "covered by SIGNS (A-18)".
- **Coordinate** with P's D2 circuit-reference rule, and reuse its matcher if it landed.

**Resolve:**
- Per member: reuse the legend-zero branch (add the `textzero:` prefix at takeoffReview.ts:293 and reviewItems.ts:1954).
- **Confirm all:** `{itemIds:['textzero:equipment'], action:'confirm', reason}` applies each **unanswered member's proposal**.
  - A count proposal resolves as `{action:'count', qty, reason: 'Stated: "<quote>" (<sheet>)'}`.
  - A not-on-job proposal resolves as `{action:'not_on_job', reason}`.
  - Members without a proposal, and every D1 legend row, are untouched, and the response says how many are still open.
  - The reason must pass `isRealReason`. The dialog in Task 7 supplies it.
- `enforcedCounts`: members are applied exactly like legend-zero (`null` or the qty).

**Edge cases:**
- A twin row answered on one key sets the other key to null only through its own proposal.
- A member that becomes counted on a re-run leaves the group, and its earlier answer is carried by member key.
- The `typicalassign` hosts' zero row stays excluded (R's line ~272).
- `reopenOrphanedMerges` already reads `groupedTypes`.

**Tests:**
- Kissimmee 0930 replay → exactly one `textzero` item with 11 members (13 with D1), with the pinned proposals;
- 36th → 2 members (6 with D1);
- Confirm all leaves the no-proposal rows open, and the item stays blocking;
- `enforcedCounts` parity: for every absorbed type, a member answer gives the same `byType` as answering the old `count:<K>` item the same way;
- the bulk-equipment 400 is still returned for multi-item calls.

### Task 3: Answering "same area?" automatically when the sheets line up (approval 2)
**Files:**
- `ai/evidence/sheetRelation.ts` (new `verifyRegistration`);
- `ai/countMerge.ts` (attach the evidence to `areaQuestion`);
- `reviewItems.ts` (`area:` builder);
- `ai/countSheets.ts` (`levelOf`, read only).

**Changes:**
1. `verifyRegistration(a, b, al, typeKey, isHost)` (pure). Under alignment `al`, pair the marks of the **other** shared types and return `{ paired, compared, verified }`.
   - `verified = al.kind === 'building' || (paired >= 3 && paired / compared >= DUPLICATE_FRAC)`.
   - Also return, per mark of the type, the distance in paper inches to the nearest same-type mark on the other sheet, and `allMain` (no enlarged-plan marks).
2. `combineCore` attaches `areaQuestion.registration: Array<{ sheets, relation, alignment, paired, compared, verify, minSepIn, allMain }>` for every pair that led to the question. **No count change** in countMerge: the larger count is still kept provisionally.
3. `buildReviewItems` decides. Auto **"same — keep"** when **all** of these hold:
   - every pair is `duplicate`;
   - `paired === compared`;
   - each pair is `verified`;
   - the question exists only because of S15;
   - **single-level evidence**: `opts.inventoryTitles` (the pipeline passes `countingInventory` titles) contains no title where `levelOf()` is non-empty and no "2ND FLOOR / LEVEL 2 / MEZZANINE" wording.

   Auto **"different — sum"** when **all** of these hold:
   - every pair is `unclear`, with `verified` true and `paired === 0`;
   - `compared >= 2`;
   - `allMain`;
   - every `minSepIn > 2 × al.tol`.

   Anything else → asked, exactly as today.
4. The auto answer is a normal area resolution: `{action:'answer', answer: options[i], qty: keep|sum, by: AUTO_BY, auto:{source:'registration', reason, evidence}}`.
   - The evidence lists the alignment note, "N of N marks sit in the same place", and the verification ("9 receptacles of other types also line up").
   - It also carries the single-level line ("no sheet title names a floor; 14 titles checked").

**Edge cases:**
- an enlarged-plan mark → ask;
- frame alignment without verification → ask;
- a multi-story inventory → ask;
- three or more sheets → every pair must qualify.
- **A count only changes by Jake's Undo**, or by the auto answer itself on the "different — sum" path, which raises the count. That path carries evidence and appears in "Answered for you".

**Tests:**
- **36th 0930 replay → all three answered automatically, matching Jake's stored answers exactly** ("Same area — keep 1/1/9"; qty 1/1/9);
- Kissimmee: pin whatever the replayed registration gives. The report states which path ran;
- the eval gate (Task 8) checks that `receptacles_total` / `gfci` do not get worse;
- synthetic cases: a two-story inventory → asked; an enlarged-plan mark → asked; a mirror / unverified frame → asked.

### Task 4: Scope questions on the Scope step (approval 3; blocking unchanged)
**Backend (`reviewItems.ts`):** `ReviewItem.step?: 'scope'`, set on `kind 'scope_question'`. Nothing else changes: the items stay in `review_items`, still block, and keep the same resolve route.

**Frontend (on top of 2A):**
- New hook `review/useReviewResolve.ts`: `resolve` and `reopen` moved out of `TakeoffReviewPanel.tsx` unchanged, with the same toasts and `signalEstimateStale`. Both panels use it.
- New `review/ScopeQuestionsCard.tsx`, mounted in `ScopeTab.tsx`. It renders open and answered scope items with 2A's `ChoiceCard`, the "Accept the pre-filled answers (N)" bulk bar (same payload as `scopeBulkAccept`), and Reopen.
- `PcWorkspaceView.tsx` ~1716 passes `review` and `onReviewChange` to ScopeTab, the same props the panel gets at ~1606.
- `TakeoffReviewPanel` filters `step === 'scope'` out of its groups and progress. It shows one row: `3 scope questions are on the Scope step — they still need answers before the proposal` with `[Go to Scope]` (`onGoScopeStep`).
- If only scope questions are open, the panel says "Takeoff questions done".
- `reviewModel.reviewProgress(items, { excludeStep: 'scope' })`.
- ProposalTab blocker text: `N questions open — X on Takeoff, Y on Scope`. `reviewBlocked` is unchanged.

**Tests:**
- a scope answer from ScopeTab posts the exact 2A `scopeAnswer` / `scopeBulkAccept` bodies;
- the proposal stays blocked while a scope item is open;
- the Takeoff progress excludes scope items.

### Task 5: Skipping a spot-check when an independent check agrees (approval 4)
**File:** `reviewItems.ts` (`spotCheckSamples` → `spotCheckPlan`).

Each type that qualifies today gets `independent?: { kind, evidence }`, checked in order:
1. **The fixture schedule's quantity column:** `scheduleRows` from a fixture or luminaire table, with Σqty == count exactly.
2. **The panel-schedule load check:**
   - `loadCheck.ran && !discrepancy && |gapPct| ≤ 0.05`;
   - and this type's watts ≥ 40% of `countedWatts`, so a 10% miscount would show;
   - the wattage comes from the target.
3. **A previous confirmed answer:** an earlier `spotcheck:<K>` or `count`/`confirm` resolution by a person with the same count. The carry-over already handles the same fingerprint, so this mainly covers `confirm` items.
4. **Confirmed Plans-view markers ≥ count for this type.** The pipeline passes these in through `opts.confirmedMarkers`.
5. **D2 only:** the previous run had the same count.

A qualifying type becomes an informational `spotcheck:` item, resolved `{action:'confirm', by: AUTO_BY, auto:{source:'independent_check', reason, evidence}}`. It is visible in "Answered for you", and Undo shows the sample.

**Tests:**
- Kissimmee A/B **keep** their spot-checks (none apply; state why);
- synthetic cases for each check, both passing and failing (Σqty off by 1 → kept; load-check share below 40% → kept).

### Task 6: Remembering answers per account (approval 5)
**Files:**
- new `backend/src/ai/accountMemory.ts` (pure) + test;
- new `backend/src/bidstd/accountMemoryDb.ts` (loader);
- `routes/preconstruction.ts` pipeline (after `buildAccountTermsSnapshot`, before `finalizeReview`);
- optional migration `162_takeoff_results_account_rule_idx.sql` (next free number): `CREATE INDEX IF NOT EXISTS … ON takeoff_results ((account_terms->>'ruleId'))`.

**Account identity:**
- `accountTerms.ruleId` is non-null AND that rule is not `isDefault`. The Default rule is never an account.
- Match only bids whose stored `account_terms->>'ruleId'` is the same and `bid_id <> this`. **Never across rules.**

**Sources:**
- the other bids' current `review_items`;
- only answers given by a person: no `auto` and not `carriedOver`, so automatic answers never chain;
- newest first by `takeoff_results.created_at`;
- with `bids.name` for the label.

**Stable keys** (`memoryKey`; exact match only):
- `fp(s)` = lowercase, punctuation removed, stopwords removed, numbers kept, unique tokens sorted.
- Eligible:
  - checklist / legend-zero members: `zero|<TAG>|fp(description)` → `not_on_job` (reason copied, and prefixed "From <bid>:") or a classification label. **Counts are never remembered for these**: quantities are per store;
  - `typical:` / `typicalqty:`: `typical|fp(host)|<deviceType>|fp(quote)` → the per-host quantity (prototype packages, e.g. "Office area power pole — how many simplex outlets");
  - `pipepoles:`: `pipepoles|fp(item)` → the answer;
  - `reuse:`: `reuse|<TAG>|fp(quotes)` → the answer (Jake listed reuse decisions);
  - `scope:`: `suggested` only (pre-filled, never applied), because an `ask` term varies per job by definition.
- Not eligible:
  - `area:`, `unlisted:`, per-pole `typicalassign` members. Pole ids are per site, and the tag binding already covers poles.
  - "AutoZone pole types" are therefore remembered as the pole-type **packages** (typical/typicalqty) plus the pipe-pole decision. State this interpretation in the report.

**Applying:** `applyAccountMemory(items, memories)`:
- only on items still open after the precedence;
- re-validated through `validateResolution` (the option still exists, the qty is valid);
- two source bids that disagree → not applied; the detail line says "AutoZone bids differ: Kissimmee 2, Lake Mary 3";
- the resolution is `by: 'CRM (from <bid name>)'`, `auto:{source:'account_memory', fromBid, memoryKey, reason:'Same account (<rule name>) — answered this way on <bid name>', evidence:[the source's answer + reason]}`;
- Undo = reopen (it sets `autoDeclined`).

**Tests:**
- pure tests for key stability (whitespace and case changes);
- a different `ruleId` → nothing applied; Default → nothing applied;
- an auto source → ignored; a conflict → not applied;
- a DB test on the test DB: two bids with one rule, and a third with another rule.
- Kissimmee replay with a **SCRIPTED** "other AutoZone bid" (labelled in the test name and in the fixture `_note`), built from Jake-style answers to the 0930 items → typicalqty ×3 and legend-zero members pre-answered.
- Note: no real earlier AutoZone answers exist in any fixture (0924, 0928 and 0930 are all unanswered).

### Task 7: Frontend: checklist card, "Answered for you", and the auto-answer label
**Files:** under `frontend/src/features/preconstruction/PcWorkspace/review/`:
- new `ChecklistCard.tsx`;
- new `AnsweredForYou.tsx`;
- `reviewModel.ts`: `cardKindOf` → `'checklist'` for `textzero:`; `groupHeading('textzero')` → `Not drawn as symbols — from notes and schedules`; GROUP_ORDER puts it right after `zero`;
- `TakeoffReviewPanel.tsx`;
- `ReviewCardShell.tsx`: an auto badge.

**ChecklistCard:**
- one row per member, showing:
  - the type and description;
  - the **source quote in quotes, with its sheet**;
  - the proposal chip (`Stated: 2`, `Named: AHU #2 → 1`, `By others`, `Same item as TSTAT`, `Covered by SIGNS`);
  - `alsoDrawn` with a "Use those markers" button.
- Row controls:
  - **[Use 2]**: count, with memberKey;
  - a qty input + Save;
  - **[Not on this job]** (ReasonPicker; equipment has no presets, so the reason is typed);
  - legend rows (D1) show "needs your number" and no proposal.
- **[Confirm all N pre-filled]**: a `useConfirm()` dialog listing **every** row, its value and its quote, including the ones that become "not on this job". It posts `{itemIds:['textzero:equipment'], action:'confirm', reason:'Confirmed the pre-filled checklist against the quotes'}` (the payload goes in `NEW_UI_ONLY`).
- The header shows `answered of total`.

**AnsweredForYou** (just above the groups, collapsed with a count, `data-testid="review-auto"`):
- one row per auto-resolved item: the title, the answer, the reason, the evidence (Details) and the source label `From <bid name> — change`;
- **[Undo]** → the existing `reopen`;
- it is never inside the "resolved" list alone.

**Shell:** a resolved item with `auto` shows the badge `Answered automatically` or `From <bid name>`.

**Tests:**
- every 2A payload case is unchanged;
- new `NEW_UI_ONLY` cases: `checklistUseStated`, `checklistConfirmAll`, `autoUndo` (the reopen body);
- the Confirm-all dialog lists the not-on-job rows by name;
- the strip shows the evidence without opening Details;
- equipment rows get no presets.

### Task 8: Replay gate and report
**File:** `backend/src/eval/reviewReplay.test.ts`, run against `review-baseline-<date>.json`, both jobs.

**No question disappears without a trace.** Every baseline item must end up as one of:
- (a) the same id is present, open or resolved;
- (b) its `typeKey` is a `textzero` member;
- (c) it is resolved with `auto` whose `evidence.length > 0`;
- (d) it has `step 'scope'`.

Anything else fails, with the item listed.

**Blocking is unchanged:**
- `reviewStatus(after) === 'needs_review'` with no answers;
- with a scripted full answer set, `enforcedCounts(after).byType` equals the baseline answered the same way, except that auto answers stand in for the human answers they reproduce;
- 36th: the auto answers equal Jake's stored answers.

**Accuracy:**
- `diffAgainstExpected` on `enforcedCounts` after the auto answers: no non-disputed item goes from pass to fail, and none moves further from the expected value;
- `projected` pricing hours are unchanged compared with the baseline + Jake's answers on 36th.

**Pinned counts** (update only with a report entry):
- Kissimmee `asked ≤ 10` (D1 yes) or `≤ 12` (D1 no);
- 36th `asked ≤ 10` (D1 yes) or `≤ 13` (D1 no);
- and the exact numbers by kind.

**It prints a table** of review items by kind (before / after: asked, info, auto, scopeStep) for the report.

---

## Expected before → after
These are planner estimates. The builder replaces them with replay numbers. "Asked" = blocking and open on the Takeoff list.

| | Before (live 0930) | After accuracy round (assumed) | After this round, D1 yes | D1 no | Next same-account bid (memory) |
|---|---|---|---|---|---|
| **Kissimmee: asked** | 28 | ~25 (−PP-OFFICE/CCTV, −PP-TEST, −coverage SITE LIGHT) | **8–10**: checklist 1, typicalassign 1, typicalqty 3, area 0–2, legend-zero 1, unscheduled 2 | 10–12 | ~4–6 (typicalqty and legend-zero pre-answered) |
| Kissimmee: informational | 5 | ~4 (photo:L, spotcheck ×2, pipepoles) | 4 (spot-checks stay: no independent check) | 4 | 3–4 |
| Kissimmee: Scope step / auto | 0 / 0 | 0 / 0 | 3 (still blocking) / 0–2 | same | 3 / 4–8 |
| **36th: asked** | 17 | 17 | **9**: checklist 1, unlisted 2, demosuggest 3, reuse 2, legend-zero 1 | 13 | unchanged (no other account bids) |
| 36th: informational / auto | 8 / 0 | 8 / 0 | 8 / **3** (the area answers, matching Jake's) | 8 / 3 | – |

- Total list rows: Kissimmee ~15–17, 36th ~20. Informational and "Answered for you" rows are collapsed and are not questions.
- D3 would take 36th's informational rows from 8 to 5.

## Risks
- **Stated-quantity false positives** (conductor sets, circuit numbers, model counts). Mitigations:
  - a strict parser plus the sweep test over every real row;
  - a conflict gives no pre-fill;
  - a proposal is never counted without a confirm.
- **Twin and covered matching:**
  - an over-match zeroes a real item, but only as a confirmed proposal;
  - an under-match double-counts (T + TSTAT).
  - Pairs are restricted to exactly one partner; the reviewer checks both jobs' rows.
- **"Different — sum" registration on look-alike layouts:** verification is required (building box, or ≥ 3 other marks pairing), along with main-plan marks only and a separation of more than 2× the tolerance. The eval guards the receptacle counts.
- **Memory leaking across accounts:** it is keyed on the non-default `ruleId` only. A bid moved to another rule stops matching. Automatic answers never become sources.
- **Changes to shared files:** reviewItems.ts and takeoffReview.ts are heavily edited by R. Rebase onto the merge and keep edits additive, behind id prefixes.

## Reviewer focus
1. **Nothing silent:**
   - every auto resolution has `auto.reason` + `auto.evidence`, shows in "Answered for you", and Undo reopens it;
   - a re-run after Undo stays open (`autoDeclined`);
   - Agent 4 never says "estimator" for an auto answer.
2. **Blocking is unchanged:**
   - scope items still block (server gate + ProposalTab);
   - the checklist blocks until every member is answered;
   - `reviewItemIsOpen`/`reviewStatus` are untouched;
   - the Task 8 gate passes.
3. **The S16 exception is limited:**
   - Confirm all applies only proposals that come from a quote or the account rule;
   - D1 legend rows and rows without a proposal are never bulk-answered;
   - the dialog lists every not-on-job row;
   - multi-item equipment calls still return 400.
4. **The stated-quantity parser:** the sweep pins MB "(2)4#3/0" → none, QC/RELOCK → none, TSTAT → 2, CF1-CF3 → 3.
5. **Registration thresholds:** check them exactly as specified. 36th reproduces Jake's answers. Kissimmee's path is explained, and the receptacle eval does not regress.
6. **Memory scope:**
   - `ruleId` is non-default;
   - sources are human answers only;
   - matching is exact on keys;
   - disagreeing sources are not applied;
   - counts are remembered only for typical packages;
   - scope questions are only pre-filled.
7. **The Gap 1 fix:** member answers survive a re-run (checklist and legend-zero), and the `hashScopeSnapshot` change touches only `textzero` (old hashes are byte-identical).
8. **Payload parity:** 2A's `payloadCases.ts` diff is empty outside `NEW_UI_ONLY`.
9. **Honest eval:** the baseline was committed first, the scripted memory bid is labeled SCRIPTED, and pinned changes carry report entries.

### Critical Files for Implementation
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/ai/reviewItems.ts: builders at 253–296 / 878–957 / 1281; `carryOverResolutions` 1659; `enforcedCounts` 1828; `reviewResolutionsForAgent4` 2016. Merge R's per-pole/pipepoles additions first.
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/estimating/takeoffReview.ts: `applyResolution`, the bulk/equipment guard ~250, the group member branch ~293, reopen ~271, labeled events ~428.
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/ai/evidence/sheetRelation.ts, with /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/ai/countMerge.ts (combineCore area question ~425–528).
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/routes/preconstruction.ts: pipeline 1284–1325 (`scopeQuestionsFor`, carry-over, write); `hashScopeSnapshot` ~657.
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-round2a/frontend/src/features/preconstruction/PcWorkspace/TakeoffReviewPanel.tsx (+ `review/reviewModel.ts`, `review/reviewCards.tsx`), with /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/preconstruction/PcWorkspace/ScopeTab.tsx and the replay harness /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-accuracy-p/backend/src/eval/replayEval.ts / /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-accuracy-r/backend/src/test/fixtures/realrun/replay0930.ts.


---

# ADDENDUM to `2026-09-30-fewer-questions.md`: "Level 2: learning from corrections" (Tasks 9–16)

I did not edit any files. This addendum folds in Jake's mid-task change: symbol examples are GLOBAL by default, the current set's legend wins, conflicts are detected, and client or project-type scope is an optional narrowing for LESSONS only.

**For Jake (plain summary, 98 words):**
When you confirm, move, delete or re-type a marker, or answer an "unlisted tag" question, the CRM saves a small picture of that symbol along with what you said it is. On later bids for any client, the counter is shown a few of those pictures, but only for symbols whose legend description on the new set means the same thing. The prompt tells it "this set's legend wins." The CRM also proposes short written lessons from repeated answers. You approve, edit or dismiss each one. Nothing changes a count by itself. Nothing goes live until a test on both jobs shows no item got worse.

---

**Date:** 2026-09-30 · **Status:** Jake approved Level 2 (examples are global per his change) · **Planner:** Opus 5.5 (read-only)
**Execution:** Opus builds (this affects counting), Sonnet does fix rounds, Opus reviews.
**Depends on:**
- the merges of `feat/accuracy-reading` (R `1b5f171`) and `feat/accuracy-pricing` (P `10822b4` plus uncommitted work);
- the fewer-questions round (Tasks 0–8), specifically `ReviewResolution.auto`, `finalizeReview` precedence, "Answered for you", the `accountTerms.ruleId` identity, the `fp()` key normalizer (Task 6) and the Task 8 replay gate.

**Worktree:** `../Electrical-program-wt-learning`, branch `feat/learning-l2`.

**Migration:**
- One migration: the next free number after the merges. Expected **163** (P has 158 and 160, P's seeds may take 159, R may take 161, fewer-questions' optional index is 162).
- The builder confirms it with `ls database/migrations | tail`.

## Findings (read-only, with the evidence)

### 1. What corrections exist today: almost none
- **Confirmed markers: 0 on both jobs.**
  - Kissimmee 0930 `markupSummary` = 247 rows, `count/suggested/ai_count`.
  - 36th 0930 = 62 rows, `count/suggested/ai_count`.
  - Both runs have `markers.assigned 0` / `unassigned` = all.
  - No marker has been confirmed, moved, deleted or re-typed on either bid.
- **`takeoff_labeled_events`:**
  - Kissimmee: none exported; the bid has 0 of 33 review answers.
  - 36th: **16 events, all `review_resolution`**, from 10 answered items:
    - `unlisted:H` count 13, reason "H surface strip light, 4ft" × 13;
    - `demosuggest:` ×3;
    - `reuse:` ×2;
    - `area:` ×3;
    - six legend-zero members (220V, C, D, E1, E3, OS), all `not_on_job`.
  - Every one of the 16 has `client: null`, `project_type: null` and `crop_ref: null`.
- **Earlier runs:** Kissimmee 0924, 0928 and 36th 0929/0929b have no answers (1 of 32 answered on 0929b).
- **What this means:**
  - The only human-verified, positioned symbol label in the data today is **36th `unlisted:H`**: 13 placed marks on E2.0 (`countResult.unlisted.tags[H].marks`, PDF points), symbol "surface strip fixture (warehouse)", and Jake's count of 13 matches.
  - Kissimmee has **no** human labels.
  - Note: the "Type H = LED high bay 2x4" in the brief is illustrative. The stored answer is "surface strip light, 4ft". Migration 154 only adds a library unit.
- **Where the client name comes from:** `bids.brand` is null on both bids, so `labeledEvents.client` is null. `bids.project_type` is `retail` / `self_storage`, while Agent 1 says `retail` / `warehouse`. Scope keys use `bids.project_type`, stated as such.

### 2. Gaps in what is logged
- `logMarkerLabeledEvents` (routes/estimating.ts ~1277) logs **updates only**: status, points, label.
  - **Deletes are not logged**, but a deleted AI suggestion is exactly a negative example.
  - **Creates are not logged**, but an estimator-placed marker is a missed symbol.
- The event's `typeKey` is `row.label`, which is the tag only for unassigned markers. Assigned markers have a `line_key` and need the line's description.
- Migration 135 says "nothing here is read back into the live pipeline", and this round keeps that true. Examples and lessons get their own tables. Labeled events stay write-only exhaust (new kinds `example_used`, `lesson_used`, `marker_delete`, `marker_create`; `event_kind` is TEXT, so no migration).

### 3. Where crops can be produced (same raster the counter sees)
**The counter's tiles** (`countRender.ts` `renderCountTiles`):
- `pdftoppm -gray -cropbox -r 300`, then sharp grayscale, then `encodeTile`: resized to `fitImageToLimits` and JPEG at quality 85 → 72 → 60 → 48;
- tiles are ≤ 8" wide, so they land at **≥ 196 px/in** (1568 long edge), or higher with Opus 5.5 limits (`imageLimitsFor`);
- each tile records `pxPerIn`;
- `renderCountTiles` already accepts `opts.rects`, so arbitrary rectangles can be rendered from one page raster.

**Existing small-crop renderers** (these use `evidenceStage.renderRegion`, which renders PNG with pdftoppm `-x/-y/-W/-H`):
- gap-fill's "CONFIRMED EXAMPLE" (`gapFillStage.ts`, `EXAMPLE_HALF_IN 0.6`);
- statusCrops (`CROP_HALF_IN 0.5`, `CROPS_PER_CALL 10`, `MAX_STATUS_CROPS 60`).
- The live 36th statusCrops data is the cost reference: **26 crops = 6,488 input tokens, about 250 tokens per crop including text**.
- These are PNG at up to 300 DPI, which is *not* the counter's scale. Examples must instead be resized to the run's tile `pxPerIn` and JPEG-encoded the same way as tiles.

**Coordinates:**
- markers (`est_markups.points`) and counter marks are PDF user-space points;
- `pdfToDisplayedIn` / `screenPosition` (`evidence/viewports.ts`, `estimating/pageGeometry.ts`) convert them to displayed inches;
- `count_result.sheets[].viewports` + `viewportAt` reject points in a legend, schedule or detail.

**PDF bytes:**
- `estimating/sheets.ts` `loadPlanDocumentForBid` / `streamPlanDocument`. Documents are stored Cloudinary → Drive → base64 in the row (`utils/storeDocument.ts`).
- Real plan PDFs are **not** in the repo. The replays use blank raster stand-ins (`replay.ts replayPdfs`). The Kissimmee set exists in OneDrive (`…/Bids/Jake Bids/Summit General Contractors/Autozone Kissimmee, FL/Plans/1.0 - AZ #10077 - Kissimmee, FL FULL SET.pdf`). Spotlight did not find the 36th set.
- **So CI can never measure the model effect.** Only recorded live calls can (see Task 14).

### 4. Prompt plumbing
- `buildCounterContent(sheet, targets, tiles, group, sheetNote)` builds the user content as: text (targets + sheet note) → per tile (text + image) → closing text.
- `runCounter` sends `system: [COUNTER_SYSTEM with cache_control]`. Images cannot go in `system`.
- `sheetNotes` carries the per-sheet text (viewports, remodel notes, the consistency pass).
- `targetsForSheet` changes the target list for photometric and demolition sheets.
- `runCountingStage` gets its input at preconstruction.ts ~1211. `accountTerms` is built **after** counting (~1287, from `stage.agent1`). For lesson scope it must also be computed before counting, from `agent1ForCounting`; `buildAccountTermsSnapshot` is pure on (bid row, agent1).

### 5. Prices (claude-api skill, cached 2026-09-25)
- Opus 5.5: $4/MTok input, $0.20/MTok cache read, $20/MTok output.
- Sonnet 5.5: $2/MTok input.
- Image tokens ≈ w×h/750.

---

## Design decisions (build defaults; Jake can change them)
- **L1. Examples are global** (Jake). Every verified example is in one bank shared by all bids and clients.
  - Use is gated by *meaning agreement with the current set's own legend or schedule*, never by tag letter. "A" or "H" means different things on different sets.
  - Provenance (bid, account `ruleId`, project type) is stored for display and conflict analysis only.
- **L2. The current set wins.** An example is offered only for a target whose `{category, deviceClass, description fingerprint}` matches the example's verified meaning. Every examples block opens with: "Examples are hints from other plan sets. THIS sheet's legend and schedule define every symbol and win over any example."
- **L3. Conflict clusters.** Examples are grouped by a visual hash (dHash). If one cluster holds ≥ 2 distinct verified meanings (hexagon = power-pole tag on AutoZone vs. something else; shaded receptacle = new on 36th vs. unknown elsewhere), the cluster is marked `conflicted`.
  - A conflicted example is used only on a **strict** meaning match (same deviceClass + token Jaccard ≥ 0.8, or a shared catalog series).
  - Its other-meaning siblings are never shown as negatives.
  - The prompt line says "this symbol has different meanings on different sets; use it only if this sheet's legend agrees".
- **L4. Lesson scope:** `all jobs` (default, preselected when approving), `project type`, or `this client` (non-default `ruleId`, the same identity as fewer-questions Task 6). Engineer-of-record scope is out: no reliable field (`agent1.project` has no engineer).
- **L5. Storage:** crops are `BYTEA` in Postgres. About 5–15 KB each; 5,000 examples ≈ 50 MB. This keeps the counting path free of Cloudinary or Drive latency and failures. It mirrors the "base64 in the row" fallback `storeDocument` already uses.
- **L6. Never from the same bid or the same drawings.** Examples whose `source_bid_id` = this bid, or whose source document `content_sha256` matches any PDF in this run, are excluded. Production then matches the eval's leakage rule, and that bid's confirmed markers already stand on their own.
- **L7. Releases.** The counter uses only examples and lessons in the **latest passed learning release** (Task 14). New captures and approvals wait as candidates until Jake runs "Check and release" and the gate passes. Rollback means selecting an earlier release.

---

## Tasks

### Task 9: Data model, meanings and fingerprints (pure core + migration)
**Files:**
- new `database/migrations/163_counting_learning.sql`;
- new `backend/src/ai/learning/meaning.ts` (pure) + test;
- new `backend/src/ai/learning/visualHash.ts` + test;
- new `backend/src/ai/learning/learningDb.ts` (loaders and writers).

**Migration** (idempotent, insert-only):
- `symbol_examples`:
  - `id UUID PK`, `crop BYTEA NOT NULL` (grayscale PNG, 300 DPI, 1.2" square, centered), `crop_sha256 TEXT`, `dhash BIGINT`, `half_in NUMERIC`;
  - `polarity TEXT CHECK IN ('positive','negative')`;
  - `meaning JSONB NOT NULL`: `{label, description, category, deviceClass, meaningFp, statusMeaning?}`;
  - `confused_with JSONB` (negatives: `{label, description, category, deviceClass, meaningFp}` of what the AI wrongly called it), `not_a_device BOOLEAN DEFAULT false`;
  - `source_kind TEXT`: `marker_create | marker_move | marker_confirm | marker_reclass | marker_delete | review_unlisted | review_statuscrop | review_pole_type`;
  - `source_ref JSONB` (markupId / itemId / runId), `source_bid_id UUID REFERENCES bids ON DELETE SET NULL`, `source_doc_sha TEXT`, `page_index INT`, `sheet_label TEXT`, `x_pt NUMERIC`, `y_pt NUMERIC`;
  - `legend_quote TEXT`, `account_rule_id TEXT`, `project_type TEXT` (provenance only);
  - `quality SMALLINT`, `verified_by TEXT`;
  - `status TEXT CHECK IN ('candidate','active','retired') DEFAULT 'candidate'`, `retired_reason TEXT`, `created_at`, `retired_at`;
  - indexes: `(status)`, `((meaning->>'deviceClass'))`, `(source_bid_id)`, unique `(source_kind, (source_ref->>'markupId'), crop_sha256)`.
- `symbol_example_captures`: the queue.
  - `id BIGSERIAL`, `bid_id`, `kind`, `payload JSONB`, `status 'pending'|'done'|'failed'|'skipped'`, `error TEXT`, `created_at`, `done_at`.
- `counting_lessons`:
  - `id UUID`, `lineage_id UUID` (the same across versions), `version INT`, `text TEXT CHECK (length ≤ 300)`;
  - `applies_to TEXT[]` ⊂ `{'counter','review'}`;
  - `scope_kind 'all'|'project_type'|'account'`, `scope_value TEXT`;
  - `match JSONB` (`{deviceClass?, meaningFp?, unlistedSymbolFp?, itemPrefix?}`);
  - `status 'proposed'|'approved'|'dismissed'|'retired'`, `evidence JSONB` (`[{bidId, bidName, itemId, answer, reason, at}]`), `pattern TEXT`;
  - `proposed_at`, `decided_by`, `decided_at`;
  - unique `(lineage_id, version)`.
- `learning_releases`: `id SERIAL`, `example_ids UUID[]`, `lesson_ids UUID[]`, `eval JSONB`, `status 'pending'|'passed'|'failed'|'rolled_back'`, `created_by`, `created_at`.
- `bid_learning_off`: `(bid_id, ref_kind 'example'|'lesson'|'all', ref_id UUID NULL)`, PK `(bid_id, ref_kind, coalesce(ref_id, nil-uuid))`. This is the per-run "turn off".

**`meaning.ts` (pure):**
- `deviceClassOf(text, category)` uses a closed keyword table: `receptacle.duplex|gfci|quad|simplex|floor|weatherproof`, `switch.single|3way|4way|dimmer|occupancy`, `fixture.troffer|highbay|strip|downlight|wallpack|exit|emergency|pole|linear`, `equipment.disconnect|panel|jbox|motor|fan|thermostat`, `tag.powerpole|keynote`, `null`.
- `meaningOf(target | {text, category})` returns `{label, description, category, deviceClass, meaningFp: fp(description)}`. It reuses fewer-questions Task 6 `fp()`: lowercase, punctuation stripped, stopwords dropped, numbers kept, sorted unique tokens.
- `meaningMatches(targetMeaning, exampleMeaning, {strict})` returns true only when **all** of these hold:
  - same category;
  - same non-null deviceClass;
  - one of:
    - (non-strict) token Jaccard on significant tokens ≥ 0.5, or a shared catalog/series token (e.g. `2GTL4`, `DSX1`; reuse `families.ts catalogOf` series logic);
    - (strict) Jaccard ≥ 0.8, or a shared series token.
- **The tag letter never participates.**

**`visualHash.ts`:** `dhash64(png)` (sharp: center 0.6" core → 9×8 grayscale → 64-bit) and `hamming(a,b)`. `clusterOf(examples, maxHamming = 10)` uses union-find. It returns `conflicted` for clusters with more than one distinct `(deviceClass, meaningFp)`.

**Tests:**
- deviceClass for every target description in both 0930 fixtures (pinned table);
- tag-only agreement never matches ("A" troffer vs "A" downlight);
- a Kissimmee 2x4 troffer target vs a 36th `A` "2x4 LED recessed troffer, Lithonia 2GTL4LP840" → match;
- the hash is stable under JPEG re-encode (Hamming ≤ 4) and differs for a duplex vs a GFCI glyph (`test/fixtures/takeoff/buildSymbolPdf.ts`);
- a two-meaning cluster → `conflicted`.

### Task 10: Capturing examples from corrections (the harvester)
**Files:**
- `backend/src/routes/estimating.ts` (`logMarkerLabeledEvents` + the batch route);
- `backend/src/estimating/takeoffReview.ts` (resolve hook);
- new `backend/src/ai/learning/capture.ts` (pure: event → capture payload);
- new `backend/src/ai/learning/harvest.ts` (I/O);
- `backend/src/ai/countRender.ts`: new `renderSymbolCrops`, sharing a refactored `rasterizeGray(pdf, page, dpi)` with `renderCountTiles`, with no behavior change to tiles;
- `backend/src/index.ts`: boot sweep, like `resetStuckIndexingOnBoot`.

**Capture sources** (each one enqueues a `symbol_example_captures` row synchronously, cheaply and fire-and-forget; never in the request's critical path):

| Source | Polarity | Quality | Meaning from |
|---|---|---|---|
| Estimator **creates** a count marker whose label/line maps to a current target (a missed symbol) | positive | 3 | the target (latest `count_result.targets` of that bid) |
| AI marker **moved** (points changed) | positive, at the new point | 3 | the target |
| AI marker **confirmed** unchanged | positive | 2 | the target |
| AI marker **re-typed** X→Y (label/line_key changed) | positive for Y + negative "looks like X, is Y" (same crop) | 3 | Y's target; `confused_with` = X |
| AI marker **deleted** (`source in ai_count, gap_fill`, status was suggested) | negative "not a X" (`not_a_device` unless re-placed nearby as another type within 24 pt in the same batch → re-type) | 2 | X |
| `unlisted:<TAG>` answered `count` with qty == placed marks | positive per placed mark (cap 4) | 1 | the estimator's reason text + the unlisted `symbol` (`meaningOf({text, category: looksLikeFixture ? 'interior_lighting' : 'device'})`) |
| `statuscrop:` reclassified "restore" / confirm (36th shaded receptacles) | positive with `statusMeaning` ('new' filled / 'existing' open) | 2 | the type + the printed fill rule quote |
| Per-pole type assignment (`typicalassign` member answered) | positive for the pole tag mark | 2 | the pole type meaning (`tag.powerpole`) |

- **Not captured:** area, scope, legend-zero not-on-job (no plan instance to crop), and auto answers (`resolution.auto`), so automatic answers never become training data.
- **Undo:** reopening, un-confirming or re-deleting the source retires its examples (`retired_reason 'source undone'`) by `source_ref`.

**Logging:** `logMarkerLabeledEvents` also logs `marker_create` and `marker_delete` (needs the pre-delete row: fetch before `batchMarkups`), still fire-and-forget.

**`harvest(bidId)`** is debounced 30 s per bid in-process, and the boot sweep picks up `pending` rows:
1. load the plan document bytes (`loadPlanDocumentForBid`);
2. group captures by (document, page): **one** `pdftoppm` raster per page;
3. convert PDF points to displayed inches (`pdfToDisplayedIn`);
4. skip a point that lies in a non-plan viewport, using the latest `count_result.sheets[].viewports` + `viewportAt` (`status 'skipped'`, reason);
5. `renderSymbolCrops(raster, centersIn, halfIn = 0.6)` → grayscale PNG at 300 DPI (360×360 px);
6. compute `dhash`, insert `symbol_examples` with `status 'candidate'`, store the legend quote (the target's `symbolHint`/description + sourceSheet) and the provenance (`accountTerms.ruleId` from `takeoff_results.account_terms`, `bids.project_type`, the document `content_sha256`).
- **Failure policy:** a failure marks the row `failed` with the error and never throws to the user.
- **Cap:** at most 200 captures per harvest pass.

**Edge cases:**
- A marker on a deleted plan copy: skip.
- `geometryOk=false` sheets (positions untrustworthy, see `aiMarkers.ts`): skip.
- Two captures of the same marker (confirm, then move): the newest wins, and the older example is retired by the `source_ref.markupId` unique index.
- Assigned markers: the type is resolved through `lineForType`'s inverse (line description → target via `rowMatchScore ≥ 2`). If ambiguous: skip.

**Tests (test DB + synthetic PDF):**
- confirm/move/delete/re-type each produce the right polarity and meaning;
- a legend-viewport point is skipped;
- an auto resolution is never captured;
- undo retires;
- one raster per page (spy on `execFile` count);
- **36th fixture replay (SCRIPTED harvest from the real stored `unlisted:H` answer + its 13 real placed marks, rendered on a blank stand-in PDF, labelled SCRIPTED because the pixels are not the real sheet)** → 4 positive candidates with the meaning "surface strip light 4ft", deviceClass `fixture.strip`.

### Task 11: Choosing examples and adding them to the counter prompt (with a budget)
**Files:**
- new `backend/src/ai/learning/selectExamples.ts` (pure) + test;
- `backend/src/ai/counter.ts` (`buildCounterContent` gains an optional `learning` prefix; `runCounter` input gains `learning?`);
- `backend/src/ai/countingStage.ts` (pass-through + `countResult.learning`);
- `backend/src/routes/preconstruction.ts` (load the release bank before counting);
- `backend/src/ai/learning/learningDb.ts`.

**Selection, `selectExamples(targetsForSheet, bank, ctx)`** (pure and deterministic):
1. Candidate set: examples in the active release, minus same bid, same doc sha, `bid_learning_off`, and retired.
2. Per target (skip generic `DEMO-` targets; hosts are allowed): positives with `meaningMatches(target, ex.meaning, {strict: ex.cluster.conflicted})`.
   - Negatives: `meaningMatches(target, ex.confused_with, {strict: true})`.
   - A negative whose true meaning is *also* a target on this sheet is shown as "this is <that target's tag>". Otherwise it is shown as "not <target>" / "not a device".
3. Rank:
   - quality, then distinct source bids first, then recency;
   - drop near-duplicates (Hamming ≤ 4 to an already chosen example).
4. Caps:
   - **N = 2 positives + 1 negative per target**;
   - **M = 12 images per call**;
   - **target priority:** targets with a negative example first, then targets with a prior correction history, then the rest in target order;
   - **image-token cap 1,500 per call;** text ≤ 1,000 chars.
5. Output: an ordered list, so the cache prefix is stable. Each crop is resized from the stored 300-DPI PNG to the **run's tile `pxPerIn`** (taken from the first rendered tile of the sheet) and JPEG-encoded with `encodeTile`'s quality ladder. The model sees the example at the same scale and encoding as the tiles.

**Prompt format** (inserted as the **first** user-content blocks, before `SHEET:`; the last example block carries `cache_control: {type:'ephemeral'}`, so sheets with the same target set reuse the prefix):
```
EXAMPLES FROM OTHER PLAN SETS — hints only. THIS sheet's legend and schedule define every symbol and win over any example. Never count or mark an example image itself. Each example is a 1.2" close-up at the same scale as the tiles; the symbol is at the center.
Example X1 — for COUNT TARGET "B" (2x4 LED recessed troffer): verified by the estimator on another job as "2x4 LED recessed troffer, Lithonia 2GTL4LP840".
[image]
Example X2 — NOT COUNT TARGET "GFCI": the counter once read this as a GFCI receptacle; the estimator verified it is a duplex receptacle (this sheet's target "DUPLEX RECEPTACLE").
[image]
Example X3 — for COUNT TARGET "PP-1..6" (power pole tag): this symbol has different meanings on different plan sets — use it only if this sheet's legend agrees.
[image]
```
- **COUNTER_SYSTEM is unchanged.** A run with an empty bank sends **byte-identical requests** to today's.

**Budget and cost** (Opus 5.5, $4/MTok input, $0.20/MTok cache read):
- one example: ~235×235 px ≈ 75 image tokens + ~35 text tokens ≈ **110 tokens**;
- the cap of 12 examples ≈ 1.3k tokens, plus lessons ≤ 400 tokens, so ≤ **~1.7k tokens per call ≈ $0.007 uncached**, about $0.0004 when it hits the cache;
- Kissimmee (5 sheets, plus about 5 consistency-pass calls) ≈ **$0.04–0.07 per run**; 36th ≈ $0.03. That is under a cent per sheet-call. A sheet call costs about $0.13–0.25 today (20 tiles).
- The cap is enforced in code. The test asserts it.

**Record:** `countResult.learning = { releaseId, examplesUsed: [{id, targetKey, polarity, sourceBidName, meaning, sheets[]}], lessonsUsed: [...], tokensEst, skipped: [{id, reason}] }`. `logLabeledEvents` kinds `example_used` / `lesson_used`, fire-and-forget.

**Never a count change:** examples only enter the prompt. No code path reads `learning` into `countMerge`, `enforcedCounts`, `reviewItems` resolutions or pricing. A grep test asserts that `learning/` is imported only by counter.ts, countingStage.ts, preconstruction.ts, the review hint builder (Task 13) and routes.

**Tests (fakeAnthropic only):**
- empty bank → requests deep-equal to a baseline capture of today's requests (both 0930 replays);
- with a SCRIPTED bank:
  - the prompt contains the header sentence, X-ids, tags of **current** targets only, and ≤ 12 images beyond the tiles (`imageCount(req) - tiles`);
  - the token estimate ≤ 1,500 for images;
  - photometric/demolition sheets get only examples for their own `targetsForSheet`;
- **leakage:**
  - an example from the same bid or the same doc sha is never included;
  - a tag-letter-only match is never included;
  - a conflicted cluster with a non-strict match is excluded;
- the replayed fake counter returns the same marks with and without examples → `countResult` equal except `learning`, and `buildReviewItems` equal;
- per-bid "off" → no examples.

### Task 12: Proposing lessons, and storing them with versions
**Files:**
- new `backend/src/ai/learning/proposeLessons.ts` (pure) + test;
- `learningDb.ts`;
- new routes in `backend/src/routes/learning.ts`: `GET /api/learning/lessons`, `POST /:id/approve {text?, scope_kind, scope_value?, applies_to}`, `POST /:id/dismiss`, `POST /:id/retire`, `POST /lessons/from-item {bidId, itemId}`, `GET /api/learning/examples?status=`, `POST /examples/:id/retire`;
- admin/estimator auth, like account rules.

**Sources** (the same rule as fewer-questions Task 6):
- other bids' `takeoff_results.review_items` human answers only: no `auto`, not `carriedOver`;
- plus example captures (marker corrections).
- **The labeled-events table is not read.**

**Patterns** (run nightly-free: at the end of each analysis pipeline and on "Check for new lessons"):
1. **Unlisted-tag meaning:** `unlisted:<TAG>` answered `count` with a reason naming a fixture, matched across bids by **(unlisted `symbol` fp + reason deviceClass)**, ≥ 2 bids.
   - Lesson: "An unscheduled tag drawn as '<symbol>' has been <reason> (H on 36th Street, …)."
   - `applies_to ['review']` (a suggested answer), and `['counter']` only if Jake ticks it.
2. **Status convention:** ≥ 2 bids where the fill rule's quote and the estimator's statuscrop answers agree.
   - Example: "Shaded receptacles are new; open ones are existing, when the sheet says SHADED SYMBOL DENOTES NEW."
   - `applies_to ['counter']`, default scope `all`.
3. **Legend symbol usually not drawn:** the same legend entry (fp of the description) answered `not_on_job` on ≥ 3 bids.
   - `applies_to ['review']` only: a hint, never counter text. Telling the counter "usually absent" could make it miss a real one.
4. **Repeated confusion:** ≥ 3 re-type or delete corrections with the same `(confused_with.deviceClass → meaning.deviceClass)` across ≥ 2 bids.
   - Example: "Floor boxes have been mistaken for duplex receptacles."
   - `['counter']`.
5. **Manual:** "Make a lesson from this answer" on any human-answered review item creates a `proposed` lesson from one bid. Today's data yields only this path (36th `unlisted:H`).

**Proposal contents:**
- `text` (≤ 300 chars, plain);
- `pattern`;
- `match`;
- **suggested scope:** always `all`, except project type when every evidence bid shares one `bids.project_type`, or account when every evidence bid shares a non-default `ruleId`. That suggestion is shown, but **`all jobs` is preselected**, per Jake;
- `evidence[]` with bid names, item ids, answers and dates.
- Duplicates of an existing lineage (same pattern + match) append evidence instead of creating a new proposal.

**Versions:**
- Edit+approve inserts `version+1` in the same lineage. The previous version becomes `retired`.
- Retire is reversible ("Restore v2" creates v3 with v2's text).
- `dismissed` proposals are not re-proposed unless new evidence appears from a bid that was not in the dismissed evidence.

**Tests:**
- each pattern with SCRIPTED multi-bid histories (labelled);
- auto answers are ignored;
- a dismissed proposal does not come back without a new bid;
- approve-with-edit creates a version and retires the old one;
- the 36th fixture → zero automatic proposals (only one bid), and `from-item unlisted:H` → one proposal with evidence [36th, `unlisted:H`, 13, "H surface strip light, 4ft"].

### Task 13: Using approved lessons (counter text + review hints), shown on the run, turn-off per bid
**Files:** `selectExamples.ts` (`selectLessons`), `counter.ts`, `reviewItems.ts` (an additive `lessonHints` option), `preconstruction.ts`, `takeoffReview.ts` (no change to resolution logic).

**Matching:** status `approved`, in the active release, scope matches (`all`; `project_type = bids.project_type`; `account = accountTerms.ruleId` non-default, computed pre-count from `agent1ForCounting`), and `match` hits a target meaning on this sheet (counter) or an item (review). Not in `bid_learning_off`.

**Counter:** ≤ 5 lessons, ≤ 400 tokens, after the examples block and before `SHEET:`:
```
APPROVED LESSONS from the estimator's past corrections — this sheet's own notes, legend and schedule win if they disagree:
- L7 v2: When a sheet says "SHADED SYMBOL DENOTES NEW", shaded receptacles are new and open ones are existing.
```

**Review builder:**
- A matching item gets `item.lessonHints = [{lessonId, version, text}]`, plus, for pattern 1, `suggested` (pre-filled only, exactly like fewer-questions' scope `suggested`).
- **Never** a `resolution`, never `auto`, and it does not change blocking, the `fingerprint` or `hashScopeSnapshot`.

**Run display:** `countResult.learning.lessonsUsed` and the review hints feed a strip "Learning used on this run" (Task 15) with "Turn off for this bid" (writes `bid_learning_off`; takes effect on the next run; the strip says so).

**Agent 4:** unchanged. Lessons are not proposal facts.

**Tests:**
- a project-type-scoped lesson is not used on another project type;
- an account-scoped lesson is never used on Default or another `ruleId`;
- unapproved, dismissed or retired lessons are never in the prompt;
- the review hint leaves `reviewStatus`, `enforcedCounts` and the hashes identical (Task 8 gate);
- off-for-this-bid → absent;
- the token cap.

### Task 14: Releases and the eval gate (honest, leave-one-job-out)
**Files:**
- new `backend/src/eval/learningGate.ts` + `learningGate.test.ts`;
- new `backend/scripts/learningEvalLive.ts` (opt-in, never in `npm test`);
- new fixtures `test/fixtures/realrun/learning-ab-<job>-<date>.json` (RECORDED-LIVE);
- routes `POST /api/learning/releases` (create pending) and `POST /api/learning/releases/:id/activate` (only when `eval.passed`).

**Release flow:**
- Candidate examples and approved lessons enter a **pending release**.
- `activate` requires a passed `eval`. Otherwise the counter keeps using the last passed release.
- "Roll back" re-activates an earlier passed release. The counter reads only `status='passed'` with the max id that is not rolled back.

**A. CI gate** (deterministic, no model, `npm test`):
1. With an empty bank, both 0930 replays' counter requests are byte-identical to the baseline. Store a request hash per sheet in `eval/learning-baseline-<date>.json`, committed first.
2. With the pending release's examples and lessons injected and the replay counter answering with the live marks, `countResult` (minus `learning`), review items (minus `lessonHints`/`suggested`) and `enforcedCounts` are identical. **This proves examples and lessons cannot change a count directly.**
3. The prompt budget and leakage assertions from Tasks 11 and 13.
4. The fewer-questions Task 8 gate still passes.

**B. Model-effect gate (RECORDED-LIVE, needs Jake's OK each time; costs real money):**
- **Leave-one-job-out.** The bank used for job J comes only from bids ≠ J and documents ≠ J's sha. Kissimmee and 36th are **eval jobs**, and their own labels are excluded when they are evaluated.
- **Honest current state:** Kissimmee has no labels at all, and 36th's only positioned label is H. So today:
  - the 36th arm B bank is empty;
  - the Kissimmee arm B bank is the 36th H strip examples. These match a Kissimmee target only if one is a strip fixture.
  - **The eval would show "no change", truthfully.**
  - To be meaningful it needs labels from **other jobs**: Decision L-D1.
- **Arms:** A = no learning; B = the pending release. Each runs **twice**, because the counter varies between runs (0924 vs 0928 differ).
- **Procedure:**
  - `learningEvalLive.ts` renders the real PDFs (paths are arguments; read-only; no DB writes; `PGOPTIONS=read_only` for any bank export);
  - it calls the counter only (counting stage with the evidence cache replayed from the export);
  - it records every reply to the RECORDED-LIVE fixture with a `_note` (model, date, bank release id, LOJO bank composition).
- **Cost:** ≈ (Kissimmee ~10 + 36th ~6 calls) × 2 arms × 2 repeats × ~$0.20 ≈ **$12–15 per gate run**.
- **CI then replays** the recorded replies through `runCountingStage` via fakeAnthropic and runs `diffAgainstExpected` against `eval/*.expected.json`.
- **Pass rule:**
  - for every non-disputed expected item, B's worse repeat is no further from the expected value than A's worse repeat;
  - no item goes pass→fail;
  - the review "asked" count (Task 8 `reviewCounts`) does not rise.
  - Any regression fails the release and lists the items. The disputed items (Kissimmee exit_emergency, wall_packs, retail_power_poles; 36th type_H, emergency, demo_*) are reported, not gated.
- **Scripted labels** (if Jake chooses L-D1 b) are labelled SCRIPTED in the fixture and the test names, and the report says the gate ran on scripted labels.

**Tests:**
- the gate math on synthetic recorded pairs: a regression fails, noise within A's spread passes, and a disputed item is reported only;
- `activate` refuses a release without `eval.passed`;
- rollback picks the previous passed release.

### Task 15: Frontend (keep it simple)
**Files:**
- new `frontend/src/features/settings/sections/LearningSection.tsx` (Settings → "Counting lessons & examples", next to AccountRulesSection);
- `PcWorkspace/review/LearningUsedStrip.tsx`;
- a "Make a lesson from this answer" link in 2A's resolved-item row (`TakeoffReviewPanel.tsx`);
- an API client.

**Settings section:**
- **Lessons** tab: Proposed / Approved / Dismissed / Retired.
  - Each row: the text (editable on approve), the scope picker (`All jobs` preselected / `This project type: <type>` / `This client: <rule name>`), the "Use in: Counting / Review questions" checkboxes, the evidence list (bid names with links, answers, dates), and the version history (Restore).
  - Buttons: **[Approve] [Edit & approve] [Dismiss] [Retire]**.
  - Copy: "Lessons are hints to the AI. They never change a count. Every use is shown on the run."
- **Examples** tab: a grid of crops (`GET /api/learning/examples/:id/crop.png`, auth) with the verified meaning, polarity badge ("Is" / "Is not"), source bid, a conflict badge "Means different things on different sets", and **[Retire]**.
- **Releases** row:
  - "N new examples, M approved lessons waiting. [Check and release]". This shows a confirm dialog with the estimated cost ("about $12–15 of AI calls") and the LOJO note.
  - Or, if live eval is run from the CLI by the builder only (Decision L-D2), "Waiting for check".
  - The last release's result table (item, before, after).
- **Run strip** in the review panel, collapsed (`data-testid="learning-used"`):
  - "Learning used on this run: 6 symbol examples, 1 lesson".
  - Rows: "Used lesson: L7 v2 — '…' [Turn off for this bid]" and "Example X1 for B — from 36th Street Warehouse [view]".
  - An "off" toggle says: "Takes effect on the next analysis run."

**Tests:**
- the approve payload carries scope `all` by default;
- the strip lists every `lessonsUsed`/`examplesUsed`;
- 2A `payloadCases.ts` is unchanged outside `NEW_UI_ONLY` (new: `lessonFromItem`, `learningOffForBid`).

### Task 16: Report
`docs/superpowers/plans/2026-10-xx-learning-l2-report.md` contains:
- every shared-file edit (counter.ts, countingStage.ts, countRender.ts refactor, reviewItems.ts, estimating.ts route, preconstruction.ts);
- the CI gate result;
- whether a RECORDED-LIVE gate ran (bank composition, cost, per-item table), or "not run: no cross-job labels yet";
- the token and cost actuals from `usage`.

---

## Decisions for Jake
- **L-D1: where the first cross-job labels come from** (needed for a meaningful eval).
  - **(a, recommended)** Run and label one or two *other* jobs already in the CRM, e.g. North Port Storage and Rockledge Storage (the same type as 36th), or Orlando Clubhouse. Confirm, correct or delete the AI markers in the Plans view, about 20–30 minutes per job. These become the bank. Kissimmee and 36th stay held out as the eval.
  - (b) A SCRIPTED bank from those runs, labelled as such.
  - (c) Ship with the gate in "no-change" mode until labels accrue.
- **L-D2:** may the "Check and release" button make live AI calls from the app (about $12–15 each), or does the builder run it from the CLI only? Default: **CLI only** this round.
- **L-D3:** should lesson pattern 1 also feed the counter? Default: **review only**, and the counter only if ticked at approval.

## Expected effect and how it is measured
- **Short term (today's data):** zero change on both eval jobs. The bank holds only the 36th H strip examples, and the 36th job cannot use its own. The CI gate proves this byte-for-byte.
- **After L-D1(a):**
  - the expected wins are on symbol-confusion items: Kissimmee receptacles_total / gfci and the B/A troffer split; 36th duplex_new / gfci_new via the shaded-receptacle lesson and positives, and switches;
  - and fewer `unlisted:`, `statuscrop:` and spot-check questions on later jobs.
- **Measurement:** the RECORDED-LIVE A/B per release (`diffAgainstExpected` per item, worse-of-2 rule) plus Task 8's `reviewCounts`. Per-run cost is read from `usage` (target +$0.03–0.07 per run).
- **No claim of improvement is made from n=2 jobs.** The gate is a regression guard. Real improvement shows as a trend in the release history.

## Risks
- **A global example misleads on a set where the symbol means something else.** Mitigations:
  - meaning-gated selection (never tag letters);
  - strict matching in conflicted clusters;
  - the "legend wins" header;
  - the review and confirm gates still decide every count;
  - the release gate.
- **The crop does not match what the model sees** (scale or encoding). Mitigation: crops are resized to the run's tile `pxPerIn` and encoded with `encodeTile`. A test asserts the px/in matches within 2%.
- **Prompt cost or cache churn.** Mitigations: hard caps; the examples prefix is stable and ordered; the empty bank is byte-identical.
- **Leakage in the eval.** Mitigations: LOJO by bid and document sha, enforced in `selectExamples` (production) and asserted in the gate; scripted data is labelled.
- **dHash on line-art with nearby walls or text.** Mitigations: hash the 0.6" core only. A false "same cluster" only *restricts* use, which is the safe direction.
- **Harvest load:** one raster per page per pass, capped and debounced. It never blocks marker saves.
- **Privacy:** small symbol crops of one client's drawings are sent to Anthropic while counting another client's bid. They are tiny, with no title block, for APT's internal use. Jake approved global examples; the report states this.
- **Shared files** (counter.ts, countingStage.ts, reviewItems.ts) were heavily edited by R and fewer-questions. Keep edits additive behind the optional `learning` input.

## Reviewer focus
1. **No direct count path:** `learning` is never read by countMerge, `enforcedCounts`, resolutions or pricing (the grep test). Lesson hints are never a `resolution`. CI gate A2 is identical.
2. **Byte-identical when empty:** COUNTER_SYSTEM is untouched, and the empty-bank requests match the committed baseline hashes.
3. **Meaning gate:** tag letters never match; conflicted clusters need a strict match; the header sentence is present; negatives show the true meaning only when it is a current target.
4. **Leakage:** same bid or same document sha is excluded in production and in the gate. The LOJO bank composition is printed. SCRIPTED and RECORDED-LIVE labels are in the fixture `_note` and the test names.
5. **Budget:** ≤ 12 images, ≤ 1,500 image tokens, ≤ 5 lessons / 400 tokens per call. The cost is recorded in `countResult.learning.tokensEst` and the report.
6. **Lessons:** never applied unapproved; versions and Restore work; scope defaults to `all`; account scope uses only a non-default `ruleId`; a dismissed proposal stays dismissed without new evidence; every use is in `countResult.learning` and in labeled events; turn-off works per bid.
7. **Captures:** auto answers are never captured; undo retires examples; legend/schedule-viewport points and `geometryOk=false` sheets are skipped; deletes and creates are now logged.
8. **Release gate:** `activate` without `eval.passed` is refused; rollback works; the worse-of-2 rule is applied; disputed items are reported, not gated.
9. **Migration:** it uses the next free number (confirmed after the merges) and is idempotent. No change to the migration 135 table's semantics (still write-only).

### Critical Files for Implementation
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/ai/counter.ts (`buildCounterContent` ~101, `runCounter`/`countOne` ~472–589)
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/ai/countRender.ts (`renderCountTiles` `opts.rects`, `encodeTile`, tile `pxPerIn`)
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/routes/estimating.ts (`logMarkerLabeledEvents` ~1277, `markups/batch` ~1320)
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/routes/preconstruction.ts (counting input ~1211, `accountTerms` ~1287, pipeline/finalizeReview ~1308)
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/ai/reviewItems.ts, with /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-accuracy-r/backend/src/test/fixtures/realrun/replay0930.ts and /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-accuracy-r/backend/src/eval/takeoffEval.ts (the gate)
- Reference implementations: /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/ai/evidence/gapFillStage.ts (CONFIRMED EXAMPLE crop) and /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/ai/remodel/statusCrops.ts (crop batching and cost caps)
---

## Jake's decisions on the Level 2 addendum (2026-09-30)
- **L-D1:** no labelling session now — ship with the release gate in "no-change" mode; examples/lessons accrue from normal use. Kissimmee and 36th stay the held-out eval jobs.
- **L-D2:** the live A/B check (~$12–15) is run **only by Jake, from the app's "Check and release" button**. The builder and the main session NEVER run `learningEvalLive.ts` or any live model call for it. Build the button (with the cost confirm dialog); the CLI script may exist for development but must not be run.
- **L-D3:** default as planned — unlisted-tag lessons apply to review suggestions only; "Use in counting" is an explicit checkbox at approval.


---

**Correction from Jake (2026-09-30 23:25):** there is no "submitted/existing bids never change price" rule — "I never made that rule. These bids are all for testing purposes." Ignore any stage-gate / price-freeze constraint above; generated rows apply to all bids. Seed-unit and library price changes still go to Jake as decisions because they change every estimate.
