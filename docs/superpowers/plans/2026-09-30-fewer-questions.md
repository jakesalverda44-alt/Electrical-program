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
