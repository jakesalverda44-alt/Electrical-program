# Review: fewer-questions round (Tasks 0–8) + Level 2 learning (Tasks 9–16)

**Branch:** `feat/fewer-questions` (`f1c553f..9f4f77e`, 18 commits on main `25dce72`) · **Reviewer:** Opus 5.5, 2026-10-01 · read-only review (no source edits, no merge, no push, app not started, no live AI, `learningEvalLive.ts` not run, live DB not touched).

## Verdict: **MERGE AFTER FIXES**

The fewer-questions half is solid and does what the plan says. Blocking is unchanged. Automatic answers are visible, carry their evidence and can be undone. The Gap 1 fix works. The payload freeze holds. The replay gate is honest.

Level 2 is well fenced off from the counts. Nothing in `learning` reaches the merge, the resolutions or the pricing, and an empty bank is byte-identical. Two things must be fixed before the first non-empty release, and both are small:
- the release check passes when it cannot run (it fails open);
- an Undo that lands in the same harvest pass as its capture does not retire the example.

Merging without them is safe today only because the bank is empty. They are listed as blockers because "Check and release" is already live in the UI.

**What I ran** (test DB `electrical_crm_test` only):
- **Backend:** the round's 21 test files, 149/149 pass. Files: `statedQuantity`, `zeroChecklist`, `finalizeReview`, `autoArea`, `accountMemory`, `spotCheckIndependent`, `scopeStep`, `reviewReplay` and its baseline, all of `ai/learning/*`, `learningGate`, `fewerQuestionsUndo`, `fewerQuestionsChecklist`, `accountMemoryDb`, `learningLessonsRoute`, `learningReleases`.
- **Frontend:** `review/*` and `LearningSection`, 85/85 pass.
- **Type checks:** `tsc --noEmit` is clean in both packages.
- **Parser probe:** a scratch probe of `statedQuantity` (outside the repo). Results are below.
- **Merge check:** a trial merge (`git merge-tree`) of this branch with `feat/gap-closing` is clean.
  - The two branches' `routes/estimating.ts` edits are about 400 lines apart: gap-closing touches `validateQuotePatch` around line 993; this branch adds the import at line 63, the helper near line 1332 and the markups-batch block at lines 1408–1418.
  - Note: `merge-tree --write-tree` leaves unreferenced objects in the object store. No ref was changed.

---

## Blockers

### B1. "Check and release" passes, and activates, when an eval job cannot be checked
**Where:** `backend/src/services/learningCheck.ts:103`

**The failure.** If either eval bid has no stored run, no `agent1_output`, or no loadable plan PDFs, that job is pushed with `ran:false` and the loop `continue`s. `out.passed` stays `true`, so `checkAndRelease` then calls `activateRelease`. For example:
- `loadDocumentBytes` fails for a Drive-stored set;
- Jake deletes or archives one of the two test bids, whose ids are hard-coded at lines 34–37;
- a re-run is mid-flight.

A release with a non-empty bank then goes live with no model-effect check at all. That contradicts L7 and Jake's "nothing goes live until a test on both jobs shows no item got worse".

**Fix.** A job that cannot be checked is a pass only when its leave-one-job-out bank would be empty. Otherwise set `out.passed = false`, with the note "could not check <job>: <why> — not released". Add a test: a non-empty bank plus `loadInputs → null` gives `failed` and no activation.

### B2. An Undo in the same harvest pass as its capture leaves a live example
**Where:** `backend/src/ai/learning/harvest.ts:123-149`

**The failure.** `runHarvest` runs `undo` captures inline, in the planning loop. Examples are inserted only later, in the per-page loop. Take a pending queue of `[marker_confirm M (id 1), undo M (id 2)]`: Jake confirms a marker, then un-confirms it, inside the 30 s debounce.
- The undo retires nothing, because no example exists yet.
- Then the confirm's example is inserted as a `candidate`.

The same thing happens when an `unlisted:` answer is reopened within 30 s. The undone correction becomes a candidate and goes into the next release. That breaks reviewer-focus item "undo retires examples".

**Fix.** Process the undo rows after the insert loop, in id order. Or, when planning, drop any capture whose source (`markupId`, or `itemId` + `memberKey`) has a later `undo` in the same batch. Add a test with both rows pending in one pass.

---

## Should-fix

### S1. The stated-quantity parser reads note and detail references as quantities
**Where:** `backend/src/ai/evidence/statedQuantity.ts:40` (trailing `(N)`), `:51` and `:57` (`#1 and #2` / `#1-#6` after any plural)

**The failure.** Output of the scratch probe:
- `"Exhaust fan, see notes #1 and #2"` → **2**, quote "notes #1 and #2";
- `"EXHAUST FAN EF-1 PER KEYNOTES #3-#5"` → **3**;
- `"Water heater, see note (4)"` → **4**;
- `"RTU-1 disconnect per detail (3)"` → **3**;
- `"Twelve volt transformers"` → **12**.

These become `stated` proposals, and "Confirm all" applies them with one click and a canned reason. That is exactly the S16 exception's risk. The pinned sweep passes only because neither fixture has such a row.

The required traps hold: MB "(2)4#3/0" → none, QC/RELOCK → none, TSTAT → 2, CF1-CF3 → 3, "(2) 20A circuits" → none, "(4) 4"C" → none.

**Fix.**
- Exclude `notes|keynotes|details|sheets|items|refs|references|drawings|specs|sections` as the plural noun.
- Reject a trailing `(N)` when it is preceded within about 3 words by `note|keynote|detail|sheet|ref|see|per`.
- Add `volt` to the number-word exclusions.
- Pin all of the above in `statedQuantity.test.ts`.

### S2. Memory and registration auto-answers hide the estimator's own earlier answer
**Where:** `backend/src/ai/accountMemory.ts:135,146` (and the area auto in `reviewItems.ts` `buildReviewItems`)

**The failure.** When an item's fingerprint changes on a re-run, `carryOverResolutions` puts Jake's answer in `previousResolution`. The fingerprint changes easily: `typicalqty` includes `drawnAtHosts|hostCount`. `applyAccountMemory` checks only `i.resolution`, so another bid's remembered answer is applied on top.

Example: Jake answered `typicalqty:X` = 4 on Kissimmee. A re-run moves `drawnAtHosts`. Lake Mary says 6. The item now shows "6 — From Lake Mary" under Answered for you, and Jake's own 4 is no longer asked for re-confirmation. The precedence was human > … > memory; here a different bid's answer outranks this bid's own.

The same applies to a registration auto when Jake had answered the area question the other way before the fingerprint changed.

**Fix.** Skip memory, and skip the evidence auto too, when `i.previousResolution` (or a member's `previousResolution`) exists and gives a different value. Leave the item open with both lines visible. Add a precedence-matrix test.

### S3. A manual lesson matches by tag letter alone
**Where:** `backend/src/ai/learning/proposeLessons.ts:75`; `reviewHints.ts:12-23`

**The failure.** "Make a lesson from this answer" on, for example, `count:A` creates `match {itemPrefix:'count:', typeKey:'A'}`. Approved with the default scope "all jobs", it puts the hint "Type A: answered 'not on this job' — … on Kissimmee" on every future bid's `count:A`. On other sets "A" is a troffer, a downlight, anything. These are review hints only, never answers, so no count moves. But it breaks the L2 rule "meaning gate never by tag letter" in the one place the estimator reads.

**Fix.**
- Add `meaningFp: fp(item.description)` to the manual match whenever `typeKey` is set.
- In `matchesItem`, require `meaningFp` (or `unlistedSymbolFp`) for any match that carries a `typeKey`.

### S4. The check spends about $12–15 when nothing in the bank matches an eval job
**Where:** `learningCheck.ts:106-122`; `counterLearning.ts:41`

**The failure.** `makeCounterLearning` returns a learner whenever the bank has any example. Take a bank holding only, say, storage-job high-bay examples. No Kissimmee or 36th target matches, so arm B's requests are byte-identical to arm A's. Both arms still run twice: real money for a guaranteed "no change".

**Fix.** Before spending, run the pure `selectExamples` and `selectLessons` over the job's stored `count_result.targets` (by sheet, with `targetsForSheet`). If nothing is selected, report "no change — nothing in the bank applies to this job (no model calls)".

### S5. The examples unique index never fires
**Where:** `database/migrations/163_counting_learning.sql:37`

**The failure.** The index is `(source_kind, polarity, markupId, memberKey, crop_sha256)`. Every row has a NULL in it:
- marker examples have no `memberKey`;
- review examples have no `markupId`.

Postgres treats NULLs as distinct, so `insertExample`'s `ON CONFLICT DO NOTHING` never triggers. Marker duplicates are covered by the retire-older-by-markupId update. Review examples (`unlisted:` marks, pole types) duplicate whenever the same item is captured twice without an undo.

163 has not been applied anywhere (builder deviation 1), so it can still be amended.

**Fix.** `… ((COALESCE(source_ref->>'markupId','')), (COALESCE(source_ref->>'memberKey','')), crop_sha256)`, or `NULLS NOT DISTINCT` if prod is PG ≥ 15. Keep the builder's polarity + member-key amendment, which is right (see Deviations).

### S6. The capture hook can still affect the marker save
**Where:** `backend/src/routes/estimating.ts:1408-1418`

**The failure.**
1. `capturesFromMarkupBatch(...)` runs synchronously inside the handler, which has no `asyncHandler` or try. A throw there turns a committed save into a failed response. One example is a create row whose `points` is not an array: `centre()` reads `.length`.
2. `getMarkups(bidId)` loads every markup of the bid before every batch with updates or deletes, then filters in JS. That adds latency to every Plans-view save on large sets.

The plan's rule was "harvest never blocks marker saves".

**Fix.**
- Wrap the capture build in try/catch, or move it into the `void (async () => …)()`.
- Read the before-rows with `WHERE id = ANY($ids)`.
- Move the two imports at line 63 to the import block. This also lowers the merge-conflict surface with gap-closing.

### S7. "Check and release" can stick at `checking`
**Where:** `routes/learning.ts:169`; `learningCheck.ts:133`

**The failure.** A restart during the background check leaves the release at `status='checking'` forever, and `/check` then answers 409. Two fast clicks can also both pass the 409 check before the first `setReleaseEval` lands.

**Fix.** Claim the release with `UPDATE … SET status='checking' WHERE id=$1 AND status IN ('pending','failed') RETURNING id`. Reset `checking` older than about 2 h on boot, or let `/check` take over a stale one.

---

## Nits
- `reviewItems.ts` `spotCheckFromPrevious`: any earlier human `count`/`confirm` on an item with the same `typeKey` and the same qty counts as an independent check. That includes a `typicalqty:` or `reconcile:` answer whose qty happens to equal the total. Restrict it to `count:<K>` and `spotcheck:<K>` ids. It only affects informational items.
- `reviewItems.ts` `memberLine`: a member resolved with `confirm` and no qty would print "undefined EA". It cannot happen today (members accept only count, markers or not_on_job), but guard it like `legacyLine` does.
- `proposeLessons.ts` pattern 2 (`status-convention`, applies to the counter) has a match that hits every sheet (`lessonHitsTargets` → true). On new-build jobs it adds noise. Gate it on `remodel` (statusMode) runs.
- `learningDb.ts` `rollbackTo`: examples activated by a rolled-back release stay `status='active'` (the bank reads release ids, so behaviour is correct). The Settings "waiting" count and the Examples tab then misreport them. A later `createRelease` re-includes them; that is fine, but say so in the UI.
- `harvest.ts`: more than 200 pending captures wait for the next capture or a restart (the debounce is not re-armed after a capped pass). An estimator-created marker that is later moved keeps its old-position example.
- `LearningUsedStrip.tsx` summary: the plural uses `lessons.length + hintLessons.length` while the number shown de-duplicates them.
- `refreshLessonProposals()` runs after every analysis run and reads every bid's `review_items`. That is fine at today's size; it needs a `LIMIT` or a `created_at` window later.
- `runLearningCheck` passes `accountRuleId: null`, so account-scoped counter lessons are never exercised by the gate. Pass each eval bid's stored `account_terms->>'ruleId'`.
- The routes import `loadAIConfig` from `routes/preconstruction` (a route module importing a route module). Moving it to a config module would be cleaner.

---

## Reviewer focus, item by item

### Fewer questions (Tasks 0–8)
1. **Nothing silent: OK.**
   - Every builder auto answer carries `auto{source, reason, evidence[]}`: area (`reviewItems.ts` `autoAreaAnswer`), spot-check (`spotCheckPlan` / `spotCheckFromPrevious`) and memory (`accountMemory.autoOf`).
   - `AnsweredForYou` lists item-level answers and member answers, with evidence shown inline and Undo going to reopen (with `memberKey` for a member).
   - Undo sets `autoDeclined` (`takeoffReview.ts` reopen branches). `finalizeReview` re-applies the decline by id or member key while the fingerprint is unchanged, and memory honours it. This is tested.
   - Automatic answers are never carried (`carryOverResolutions` filters `auto`).
   - Agent 4: an auto item reads "(answered automatically: …)". A checklist, or a group with any auto member, is printed per member. No path prints "estimator" for an auto answer.
   - Exception, S2: an older human answer can be hidden behind an auto answer.
2. **Blocking unchanged: OK.**
   - `reviewItemIsOpen`, `reviewStatus` and `takeoffGate` are untouched.
   - `step:'scope'` changes only where the item is shown.
   - ProposalTab's `reviewBlocked` is unchanged; only its text changed.
   - `textzero:` gets a resolution only through the all-answered rule. Confirm all leaves rows without a proposal and legend rows open, so the item stays blocking (tested).
3. **S16 exception: OK.**
   - Confirm all filters `!m.resolution && m.proposal && m.rowKind !== 'legend'` (`takeoffReview.ts`) and requires `isRealReason`.
   - A `confirm` with `memberKey` on a legend row or a row without a proposal → 400.
   - A `textzero:` call without `memberKey` for any other action → 400.
   - A multi-item call containing it → the equipment 400, because the item is `category:'equipment'`.
   - The dialog lists every pre-filled row, with value, reason and quote, including the not-on-job rows by name.
   - Covered-tier rows are in Confirm all. They come from a quoted counted line with the same circuit and a shared noun, and need exactly one covering line. That is acceptable.
4. **Parser: the required pins hold; S1 adds the traps it misses.**
5. **Registration: as specified, plus `allMain` on the "same" path (stricter).**
   - 36th reproduces Jake's answers: Same area, keep 1, 1 and 9 (test passes).
   - Kissimmee stays asked: unclear, `allMain=false`, nearest marks 0.58" ≤ 2 × 0.5".
   - See the roof deviation below.
6. **Memory: OK, apart from S2.**
   - Only a non-default `ruleId` counts as an account (`accountIdentityOf`); matching never crosses rules.
   - Sources are human answers only (`human()`), and auto answers are never carried, so nothing chains.
   - Keys are exact `fp()` keys. Sources that disagree are not applied, and the detail line says so.
   - Zero rows give `not_on_job` only. Counts are remembered only for `typical`/`typicalqty`. Scope answers only fill `suggested`.
   - `takeoff_labeled_events` is never read.
7. **Gap 1 + hash: OK.**
   - Member answers carry by member key and fingerprint, including standalone ↔ member. The group resolution is recomputed.
   - `hashScopeSnapshot` appends member tuples only for `textzero:`. For every other item the tuple is literally the same array, so old hashes are byte-identical.
8. **Payload parity: OK.** The frozen `CASES` / `REOPEN` section (lines ≤ 111) is untouched. The new fixtures and cases are after it.
9. **Honest eval: OK.**
   - The baseline JSON was committed first (`f1c553f`).
   - The scripted AutoZone memory bid is labelled SCRIPTED in the fixture `_note` and in the test names.
   - The pin changes in the existing replay tests are listed in the report.

### Level 2 (Tasks 9–16)
1. **No path from `learning` to the counts: OK.**
   - The grep test is meaningful: it is an import allowlist, and the merge, review-answer, pricing, `bidEstimate` and Accubid files plus the body of `enforcedCounts` must not mention learning.
   - Lesson hints are never a resolution. On unlisted items they set `suggested`, which only pre-fills the name box ("Use this name").
   - CI A2 (countResult minus `learning`, review items, enforced counts) is identical.
2. **Empty bank byte-identical: OK.**
   - A1 reproduces the committed per-request hashes for both jobs, and also with a bank where nothing matches.
   - `COUNTER_SYSTEM` is untouched. The prefix goes before `SHEET:`, so tile ids are unchanged. That makes 2 `cache_control` breakpoints, within the limit of 4.
3. **Meaning gate: OK for examples.**
   - `meaningMatches` requires the same category and the same non-null device class, plus Jaccard or a series token. The tag letter is never used.
   - A conflicted cluster needs a strict match. Negatives are matched strictly. A negative names "this sheet's target X" only when its true meaning is a current target.
   - The header sentence is present.
   - For review hints, see S3.
4. **Leakage: OK.**
   - The same bid and the same document sha are excluded in production (`eligible`, with sha256 of the same raw bytes `storeDocument` hashes) and in the gate (`lojoBank` plus `eligible`).
   - SCRIPTED labels are in place.
5. **Budget: OK.** At most 2 positives + 1 negative per target, 12 images, 1,500 image tokens, 1,000 text characters, 5 lessons and 400 tokens. All are enforced in code and asserted.
6. **Lessons: OK.**
   - Only `approved` lessons inside the active passed release are used. Dismissing or retiring takes effect immediately.
   - Edit-and-approve makes a new version and retires the old one; Restore makes a new version.
   - Approval defaults to "all jobs", and the Default rule is refused as a client.
   - A dismissed lesson returns only with a new bid.
   - The per-bid "off" works.
7. **Captures: mostly OK.**
   - Auto answers are skipped (`human()`), as are legend, schedule and detail viewport points and `geometryOk=false` sheets.
   - Creates and deletes are logged.
   - Undo retires, but see B2.
   - The capture hook runs after the transaction and is fire-and-forget (S6).
8. **Release gate: see B1 and S7.**
   - `/activate` refuses without `eval.passed === true`, and `/check` needs admin plus `confirmCost:true`.
   - Rollback works.
   - The worse-of-2 rule, disputed items being only reported, and the "asked must not rise" rule are implemented and tested.
9. **Live script: OK.**
   - `scripts/learningEvalLive.ts` refuses without `LEARNING_EVAL_LIVE=1`, `--i-am-jake`, `--confirm-cost` and an integer `--release`. It is in no npm script and no test glob, and it writes nothing.
   - The tests that touch the check make the Anthropic constructor throw.
10. **Privacy note: OK.** It is present in the L2 report ("Open questions").
11. **Migrations: OK, apart from S5.** 162 and 163 do not collide with gap-closing's 164–169, including the uncommitted 169 in that worktree. Both are idempotent, and 135's write-only semantics are unchanged.

---

## Builder deviations: recommendations

1. **Carried-over human answers count as memory sources** (the plan said to exclude them). **Keep them.**
   - A carried answer is the same bid's own human answer, copied only on an unchanged fingerprint. When the fingerprint changes it moves to `previousResolution`, which is never a source.
   - Automatic answers are never carried and never read as sources. Memory answers are `auto`, so no chain is possible.
   - Excluding carried answers would silently empty a source bid after any re-run.
   - Only a legacy edge case gets through: a member without a fingerprint carries leniently. That is acceptable.
2. **D1 legend rows: labels only, plus a one-click "Same item as TSTAT — not on this job"** (instead of twin and named proposals). **Keep it.**
   - It is the reading that matches D1 ("answered as before, no pre-fill, never in Confirm all").
   - The one-click is a single-row, explicit answer, with a reason that names the twin.
   - The plan text contradicted itself here; the builder chose the conservative side.
3. **A roof-plan title is not a floor for the single-level check.** **Accept, with one tightening (should-fix size).**
   - Today it changes nothing on either eval job: Kissimmee's areas are asked for other reasons, and 36th has no roof page.
   - But a question can come from S15's cross-level path between an unnamed "Electrical Plan" and the ROOF plan itself. That pair could then be auto-answered "same — keep" with no human look.
   - Apply the ROOF exemption only when neither sheet of the question's pairs is the roof sheet (`reviewItems.ts:305`).
4. **Migration 163's unique index includes polarity and member key.** **Keep the amendment.** It is needed: a re-type stores a positive and a negative from one crop, and an unlisted item stores up to 4 crops. But fix the NULL problem (S5).
5. **The "1" quick button on every checklist row without a proposal.** **Narrow it.**
   - Show it only on text rows. Ideally show it only on one-noun rows (D4's intent: "Meter base NEMA 3R").
   - Never show it on D1 legend rows. Their placeholder says "Needs your number", and a one-click 1 next to a symbol the counter found zero of is a nudge.
   - It is also wrong-unit bait on `WIREWAY`, which is a length item.
   - Change at `ChecklistCard.tsx:125`: `!m.proposal && m.rowKind !== 'legend'`.

Other deviations in the reports are accepted as written:
- `reviewCounts` lives in its own file;
- "Use those markers" posts the `alsoDrawn` total, with a reason that names the sheets;
- ScopeQuestionsCard is mounted beside ScopeTab;
- check and activate happen in one step from the button;
- the in-app check does not write a RECORDED-LIVE fixture;
- the status-convention pattern reads `remodel:conventions`;
- there are no statuscrop captures (no positions to crop);
- the visual-hash test glyphs are SVG.

## Merge-risk note (routes/estimating.ts and gap-closing)
- A trial merge with `feat/gap-closing` (`f32e211`) is clean.
- Gap-closing's only edit to `routes/estimating.ts` is two lines in `validateQuotePatch` (~993). This branch edits:
  - the import at line 63;
  - the helper `logMarkerCreatesAndDeletes` (~1332);
  - the markups-batch block (1408–1418).
- Gap-closing's uncommitted work (`routes/bids.ts`, `services/bidStage.ts`, migration 169) does not touch these files.
- Merge order does not matter. Do S6 first, so that the imports sit in the import block and the hunk is one localized block.

---

## Addendum: fix round 1 re-check (`91da4ca`, on the main merge `dfbf31f`)

### Verdict: **MERGE**

**What I ran** (test DB `electrical_crm_test` only; no source edits):
- **Backend:** `tsc` is clean. 28 test files and 261 tests pass. They cover:
  - the round's own tests, plus the new `learningCheckFix` and `markupCaptureGuard`;
  - `reviewItems`, `estimatingReviewAnswers`, and the Kissimmee and 36th replays.
- **Backend estimating routes:** 11 files and 96 tests pass. These are the markups batch, the quote and fixture-package question (gap-closing), Accubid, footage, the takeoff gate and the AI markers.
- **Frontend:** `tsc` is clean. The `preconstruction`, `settings` and `estimating` features pass: 80 files, 1,193 tests.
- **Parser probe:** the scratch `statedQuantity` probe was re-run (results under S1).
- **Migration 163:** run inside a rolled-back transaction in a temporary schema on the test DB (Postgres 16.15). Results are below.

### Blockers
- **B1: fixed.** `learningCheck.ts`: when a job cannot be checked, the check builds the leave-one-job-out bank without the job's drawing hashes. If that bank would feed the counter anything, the release fails with "could not check <job> … not released". Only an empty bank still counts as "no change". There is a test with a non-empty bank and inputs that will not load: the release fails and is not activated.
- **B2: fixed.** `harvest.ts` `undoneLater`: a capture with a later `undo` row in the same pass, for the same bid and source, is skipped. A source is a `markupId`, or an `itemId` plus an optional `memberKey`. Confirm → un-confirm → confirm again still keeps the last confirm (its id is after the undo). A test covers it.

### Should-fix items
- **S1: fixed.** On the probe, these now return none: note, keynote, detail and sheet references; `per` / `see` before a trailing `(N)`; "Twelve volt …". The required pins still hold (MB, QC/RELOCK, TSTAT 2, CF 3; tests pass). "SIGN CIRCUIT A-18 (2)" → 2 remains; it is ambiguous, and it is a confirmable proposal only.
- **S2: fixed for the run that changes the fingerprint.**
  - `carryOverResolutions` → `withPrevious` drops an automatic answer that differs from the earlier human answer and leaves the item open.
  - `applyAccountMemory` skips items and members that have a differing `previousResolution`.
  - **New nit:** `previousResolution` is not carried to the next run. This is the old carry-over behaviour, unchanged. If Jake leaves that item open and re-runs again, the next run's automatic answer applies with no earlier answer to compare. Low risk; consider carrying `previousResolution` forward while the item stays open.
- **S3: fixed.** A manual lesson on a typed item now carries `meaningFp`. Without a description, no lesson is made. `matchesItem` rejects a match that has `typeKey` but no meaning field.
- **S4: fixed.**
  - The check pre-selects examples and lessons against the job's stored targets before spending. If nothing applies, the job reports "no change", with no model calls.
  - `GET /learning/releases/preview` (admin) shows the same result per job before the cost dialog.
  - If a job has no stored targets, the check runs it. That is the safe direction.
- **S5: fixed. Migration 163 is correct and safe.**
  - **Fresh database, which is also live's state** (live has neither 162 nor 163, and the tables do not exist there): the file applies, and applies again unchanged. A duplicate insert with `ON CONFLICT DO NOTHING` returns 1 row, then 0.
  - **The test DB's old-draft state:** the old NULL-blind index let 2 duplicates in. The amended file drops that index, keeps the oldest row and creates the new index: 1 row remains.
  - **The new key:** `(source_kind, polarity, COALESCE(source_bid_id), COALESCE(markupId), COALESCE(itemId), COALESCE(memberKey), crop_sha256)`. Every expression in it is immutable.
  - **The DELETE is a no-op on live**, because the table is new there.
- **S6: fixed.**
  - The capture build and the enqueue sit inside try/catch.
  - The rows before the change are read with `getMarkupsByIds` (`id = ANY`).
  - The imports moved to the import block.
- **S7: fixed.**
  - `claimReleaseForCheck` is one atomic `UPDATE … WHERE status IN ('pending','failed') OR stale 'checking' > 2 h … RETURNING`. The route claims the release before it answers 202.
  - A release that already passed answers 409.
  - On boot, `recoverInterruptedChecks` marks any `checking` release as failed. **Nit:** that assumes one backend instance. With more than one, a booting instance would fail another instance's live check. That is acceptable for today's single Render service; note it if the service scales out.

### Deviations, as recommended
- **Roof exemption:** it now applies only when no sheet of the question itself is a roof sheet (`ownRoof`, with a test).
- **"1" button:** `showOneButton` limits it to text rows that name one thing. It never shows on legend rows, on length items (wireway, conduit, cable, …) or on plurals. Tests cover it.

### Nits
Done:
- the spot-check matcher is limited to `count:`, `recount:` and `spotcheck:`;
- a `confirm` member line without a qty prints "confirmed";
- the pattern-2 lesson applies only on remodel runs (`statusMode`);
- the harvest pass re-arms after hitting its cap, and the boot sweep loops;
- the gate passes each eval bid's account rule.

Left as stated: an estimator-created marker that is later moved does not get a new capture (low value; its old-position example stays until the marker is deleted).

### The main merge (gap-closing) is not broken
- `dfbf31f` is a clean merge with no hand-resolved hunks (`git show --cc` is empty).
- In `routes/estimating.ts`, gap-closing's `fixturePackageDecided` validator (in `validateQuotePatch`) and this branch's capture block, helper and imports sit side by side. Both route test sets pass.
- The review UI: the frontend `preconstruction`, `settings` and `estimating` suites pass. That includes ChecklistCard, ScopeQuestionsCard, the payload-parity cases, LearningSection, and gap-closing's BidSummary, LaborPricingStep and Accubid panels.
- The migrations run 161 → 169 with no gaps or duplicates.
