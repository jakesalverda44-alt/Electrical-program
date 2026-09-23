# Takeoff Accuracy: Adversarial Review

**Branch:** `feat/takeoff-accuracy` (`main..85390b8`, 16 commits, Tasks 1–13, 130 files, +10,766/−339)
**Reviewer:** Opus 5 (independent, read-only)
**Date:** 2026-09-23

**Verdict: MERGE AFTER FIXES.** Blockers B1–B7 must be fixed and re-checked before merge. The Kissimmee eval must run before the pipeline prices a live bid.

## Verification run

| Check | Result |
|---|---|
| `npx tsc --noEmit` (backend) | clean |
| `npx tsc --noEmit` (frontend) | clean |
| `npm test` (backend), run 1 | 1341 passed, 3 failed, 4 not run, of 1348 (138 files; 135 passed, 2 failed, 1 lost to "Worker exited unexpectedly") |
| `npm test` (backend), run 2 | Identical to run 1: the same 3 failures and the same file lost |
| `npx vitest run` (frontend), run 1 | 1213/1214. Failure: `SurveyMarkupEditor` (Escape/fullscreen) |
| `npx vitest run` (frontend), run 2 | 1213/1214. Failure: `ElecProjectsSaveSection` ("a failed PUT toasts…") |
| `npx vitest run` (frontend) on `main` 0b896bb, as a baseline | 1186/1188. Failures: **the same two**, `SurveyMarkupEditor` and `ElecProjectsSaveSection` |

**How each failure was classified.** Every one is a pre-existing flake or load timeout; none is a regression.

- **`notificationsRetention.test.ts`** is the file lost to the worker crash, and its 4 tests are the 4 "not run". It crashes the same way on `main` in a temp worktree ("Worker exited unexpectedly", 4 of 6 tests lost). This is the known flake.
- **`intakeSimilarCache` ×2** failed in both full runs, with a 30 s timeout and a 500 under load. When run alone it passed 2/2 on the branch (twice) and 2/2 on `main` (twice); one standalone branch run while other suites were loading the DB failed 2/2. The branch touches no intake code. This is the known flake.
- **`integration.test` "backfills a follow-up…"** is a 30 s timeout in both full runs and passed alone (31/31 in that file). The branch doesn't touch leads. It's load-only.
- **Frontend `SurveyMarkupEditor` and `ElecProjectsSaveSection`** passed 3/3 when run alone on the branch, and both fail on `main` under the full suite. The branch touches neither `gen-pipeline/` nor `elec-projects/`, only `hooks/useAppSettings.ts` (+4 lines, a settings key). This explains the executor's "4 failures, 5 files" first run: it's pre-existing flakiness, not regression. It also means the frontend flake list should now include `ElecProjectsSaveSection`.
- **The executor's final fix (85390b8)** is covered: `takeoffTruncation.test.ts` passes 4/4 in both full runs.
- **The pdftoppm-backed tests ran and were not skipped** (`counter.test` 19, `countRender.test` 16, `takeoffCountingPipeline.test` 2).

**How findings were reproduced.** Pure vitest scratch files ran against the real modules in throwaway detached worktrees (all removed and pruned):

- counter, merge and geometry: R1–R5 below;
- account rules, hygiene, scope list and verify: "A" repros;
- enforce → compose → validate, amount-in-words, and the soffice pagination sweep: "B" repros;
- counting stage, review items and account terms: "C" repros.

No DB-backed repros were run, so every route/DB finding is marked [reasoned] with the lines cited. There were no Anthropic, Drive or email calls, `evalTakeoff.ts` was not run, and `Local Version` was not touched.

**Hand-verified tile → PDF point.** The case: a 36×24 in page with `/Rotate 90`, origin (10, 20), so the displayed page is 24 in wide by 36 in tall.

- `planCountTiles(24, 36)` gives 3 columns of 7.867 in over the 21.6 in content width, and 5 rows of 8 in (row starts 0, 7, 14, …).
- Tile R2C1 is left 0, top 7, 7.867 × 8 in. The mark (0.5, 0.25) is at displayed (3.933 in, 9 in), which is (283.2 pt, 648 pt).
- pdf.js rotation 90 maps displayed x to rel-y and displayed y to rel-x. So the PDF point is x = 10 + 648 = **658**, y = 20 + 283.2 = **303.2**.
- `tileToPdfPoint` returned exactly (658, 303.2).

The geometry, the 1″ overlap math (tile length ≤ 8″ is guaranteed by n = ⌈(E−o)/(t−o)⌉) and the 196 px/in floor are all correct.

**What holds:**

- The tile geometry and point math.
- Max-tokens detection plus streaming on every pipeline call. The classifier, Agent 1 (single and batched), the counter, Agents 2 and 3, pre-bid comparison, Agent 4 and the draft all use `messages.stream(...).finalMessage()` followed by `assertNotTruncated`. The only remaining non-streaming `create` calls are gens.ts (2,048 tokens) and aiReplyDraft (1,024), both outside the pipeline.
- Bounded counter concurrency (3), with a truncation stopping new work.
- A failed counter sheet marks its allowed types "unreadable".
- Suggested markers never roll up.
- Migrations 112–117 are additive: `IF NOT EXISTS`, and `DROP CONSTRAINT IF EXISTS` before each `ADD`. `main` is still at 111, so the numbers don't collide.
- The Southern Lighting text is gone from all prompts and lives only in the Default seed.
- Amount-in-words: words and figures come from the same integer cents.

**What fails:** the counts and answers are not carried deterministically to the GC document. The last hop is an LLM with no check, and several upstream shapes quietly turn into "clear".

---

## Blockers

### B1. Counted and estimator-resolved quantities reach the GC only as Agent 4 prompt text; nothing checks the final takeoff against them [reasoned]

- **Evidence.**
  - The counter's rows go into `agent1_output.quantities` (`ai/countingStage.ts:117-128`).
  - Resolutions are only a prompt block (`ai/reviewItems.ts:176-186` → `agent4Message.ts`).
  - `composeCurrentBidData` (`routes/preconstruction.ts:2270-2350`) enforces account terms, the scope list, CKT removal, zero-qty, excluded-scope and non-electrical checks. It never reads `count_result` or `review_items` quantities; a grep finds no consumer of `count_result.types` outside the review builder and the markers.
  - `zeroQuantityProblems` (`ai/outputHygiene.ts:173`) only catches a row Agent 4 keeps at 0. An omitted row vanishes, and the docx drops zero rows anyway.
- **Scenario.** The counter finds A = 73, or the estimator resolves "Type A = 73". Agent 4 folds A into B, writes 37, or drops the line. generate-docx passes and the GC receives the wrong fixture count. This is the AutoZone failure again, moved one hop later.
- **Fix.** Add a deterministic `enforceCounts` step in `composeCurrentBidData`, next to `enforceAccountTerms`:
  - For each counted type (status counted) and each resolved count item, locate its takeoff line by tag.
  - Also carry `countType` through Agent 4's schema so the lookup is exact.
  - Force the counted or resolved qty, and insert the line if it is missing. Record a correction.
  - Return 422 when a type can't be mapped.
  - Omit `not_on_job` types.
  - Test: an Agent 4 fake that drops A and writes B = 37 must still produce A 73 / B 52 in the docx.

### B2. No count targets → counting doesn't run, the review is *clear*, and Agent 1's own numbers pass [reproduced: C]

- **Evidence.** `countingStage.ts:134-136` returns `ran:false` with `targets: []`. `buildReviewItems` loops over `types` (`reviewItems.ts:77`), which is empty, so there are 0 items and the status is `clear`. `mergeCountsIntoTakeoff` keeps Agent 1's rows unchanged (`countMerge.ts:355-358`).
- **Scenario.** Agent 1 misses the luminaire schedule. It might sit on a sheet the classifier dropped, or be embedded on the lighting plan. The 0 or omitted fixture rows go straight to Agent 2/4 with a green gate, which is exactly Kissimmee.
- **Fix.**
  - When counting did not run for any reason, and the inventory holds electrical plan pages (or the classifier didn't run), add one blocking review item. Wording: "Counting did not run: \<reason\>. Confirm the fixture/device takeoff." It resolves with an explicit acknowledgement plus a reason.
  - Add a test for `targets.length === 0`.

### B3. Agent 1 fixture rows that match no scheduled type are deleted silently, with no review item [reproduced: C]

- **Evidence.** `countMerge.ts:377-379` moves them to `removedRows`. `buildReviewItems` never reads `removedRows`, and they appear only in a collapsed "Counting details" list.
- **Repro.** Take `kissimmeeAgent1` minus schedule type M, plus the Agent 1 row "Type M … qty 6". The M row is removed, M is absent from the quantities, and the status is clear.
- **Scenario.** A schedule is split across two sheets and Agent 1 reads one of them. Every type on the missing half disappears and the gate stays green. The rule was written to stop the Kissimmee "4 site lights" from stacking, but it also deletes real fixtures.
- **Fix.**
  - Turn each removed row with no `replacedByType` and qty > 0 into a blocking count item. Wording: "Agent 1 found N × \<item\>, not on the schedule — count it / not on this job".
  - The Kissimmee "Site lights 4 (E-7)" row then becomes one "not on this job" click instead of a silent deletion.

### B4. Split-area floor plans are max-kept instead of summed, so the count comes back partial but looks complete [reproduced: R3a, R3b]

- **Evidence.**
  - `countSheets.ts:69` gives any title containing `PARTIAL` or `ENLARGED` the role `enlarged`.
  - `countMerge.ts:231-249` keeps the single largest enlarged count. When no main sheet exists (`mainTotal === 0`, lines 244-247) it adds **no max-keep flag at all**.
  - Same-level main sheets are max-kept too (`countMerge.ts:208-228`), with only a non-blocking flag.
- **Repro.**
  - R3a: "PARTIAL LIGHTING PLAN - AREA A" has 40 A and "- AREA B" has 35 A. The result is status `counted` with count **40**. The only flag is the misleading "No building plan was counted — A was taken from every counted plan sheet."
  - R3b: "LIGHTING PLAN - AREA A/B" has 40 + 35. The result is `counted` with **40**, plus one non-blocking "check whether these sheets show the same area" flag.
- **Scenario.** Any building big enough to need split floor plans ("PARTIAL FLOOR PLAN – AREA A/B", matchlines) gets undercounted by roughly half. No review item is raised, so the gate is green. Decision 7 says same-area sheets are max-kept, but the code treats every same-level (or every PARTIAL) pair as the same area, and it never asked the estimator. The report's limits section describes the opposite risk (summed when it should be max-kept).
- **Fix.**
  - Make every max-keep across two or more sheets a **blocking** review choice ("E-2.1 40 / E-2.2 35 — same area (keep 40) or different areas (sum 75)?").
  - Or detect AREA/PART/NORTH/SOUTH/UNIT tokens and matchline notes (the counter already returns `notes`) and sum.
  - Don't map `PARTIAL` to `enlarged`.
  - Always push a flag in the `mainTotal === 0` branch.

### B5. After a re-analysis, the GC and Chris can receive the previous run's documents while the gate shows green [reasoned: A, B, C]

- **Evidence.**
  - `/analyze` clears only `agent1_output`, `agent2_output` and `agent3_output` (`routes/preconstruction.ts:1950-1953`). It leaves `agent4_output`, `agent4_price`, the `draft_*` columns and `review_status` alone.
  - `takeoffGate` reads `review_status` only, and treats NULL as ungated (`estimating/takeoffReview.ts:32`).
  - A counting-stage or Agent 1 failure sets `status='error'` but leaves the old `review_status` (`preconstruction.ts:852-859`, `903-908`).
  - draft-proposal (`routes/bids.ts:343-372`) checks the gate and then attaches the **most recent filed PDF or docx**, whatever its age.
  - generate-prebid-package (`preconstruction.ts:2632`) never calls `takeoffGate`. It composes with `source:'draft'`, which quietly falls back to `agent4_output` when the draft isn't complete (`:2203`).
- **Scenarios.**
  1. The real Kissimmee bid already has its bad output filed (0 fixtures, "Southern Lighting Source"). Re-analyze and resolve everything, then click "Draft email to GC": the old wrong PDF is attached.
  2. During the re-run, before the counting stage writes (`review_status` is still the old 'clear'), generate-docx renders the old `agent4_output`.
  3. The review is open after the re-run, and "Generate pre-bid package" plus "Email to Chris" send the old wrong scope.
- **Fix.**
  - On `/analyze`, null the `agent4_*` and `draft_*` columns and set `review_status='needs_review'` (or a run id) until the counting stage writes.
  - Gate generate-prebid-package.
  - Store an inputs hash (Agent 1 + `count_result` + review + scope list) with Agent 4 output and with every filed document. generate-* and draft-proposal should return 409 on mismatch and attach only a matching file.

### B6. Account-term enforcement pushes Section C to 4 bullets, so AutoZone generate-docx 422s [reproduced: B, via pure enforce → compose → validate]

- **Evidence.**
  - `bidstd/accountRules.ts:444-458` inserts the lighting bullet at the top of Section C whenever no existing bullet matches `LIGHTING_PROCUREMENT` (`:421`).
  - A Cowork-style "Install all interior and site fixtures per the luminaire schedule (Owner-furnished)" doesn't match, so Section C gets 4 bullets.
  - `validateBidData` then fails: `section "C. Lighting & Controls" must have exactly 3 bullets (got 4)`.
  - The estimator can't edit composed bullets, and re-running Agent 4 can produce the same shape.
  - The committed Kissimmee render fixture never went through enforcement. It has only 2 C bullets and would fail validation itself.
- **Scenario.** The target account's proposal can't be generated.
- **Fix.**
  - Replace or broaden the matching C bullet instead of adding one, and assert C = 3 after enforcement.
  - Test the real Kissimmee Agent 4 shape through enforce → compose → validate → render.

### B7. The seeded AutoZone power-pole `ask` can't be answered correctly, and the answer deletes adjacent EC scope from the GC document [reproduced: A, B]

- **Evidence.**
  - The options are `['APT','GC','Owner']` (`accountRules.ts:248`), and `applyScopeAnswers` sets `furnishBy = installBy = p` (`:312-313`).
  - Enforcement step 2 (`accountRules.ts:463-483`) deletes every bullet and takeoff line matching the term pattern that doesn't name the furnishing party.
- **Repro.**
  - Answering "GC" (the realistic case is GC furnishes, EC installs and wires) removed:
    - "Branch circuits and conduit to the power poles…"
    - the takeoff line "Power pole feed"
    - the whole bullet "Provide all receptacles, retail power poles, and display baseflex floor connections…", so the **receptacles vanished from GC scope**
  - The only trace is a correction line in the preview.
  - Answering "APT" makes the poles ECFECI instead.
- **Scenario.** Every AutoZone job with silent drawings hits this, because the rule is seeded `ask` and so blocks until answered.
- **Fix.**
  - Offer furnish/install pairs ("GC furnishes / APT installs", "Owner furnishes / APT installs", …), or ask two questions.
  - In step 2, strip only the clause that asserts furnish or install of the item itself. Never touch circuits, conduit, feeds or connections *to* it, and never delete a mixed bullet. When unsure, flag instead of delete.

---

## Should-fix

### S1. A counter reply with the wrong top-level shape counts the sheet as zero [reproduced: R1]
- **Evidence.** `counter.ts:109-112`: `parseAIJSON` takes the first `{…}`. A top-level array of mark objects parses as the *first mark*, and `{"symbols":[…]}` parses fine. Both give `marks = []`, a non-null result, and a sheet recorded as `counted` with 0.
- **Repro.** R1a and R1b both returned `{"marks":[],…}`.
- **Scenario.** A type that also appears on another sheet ends up with a partial count and status `counted`. Types that appear only on that sheet are caught by the zero gate, but get the wrong reason ("not found").
- **Fix.**
  - Require `Array.isArray(parsed.marks)`, otherwise fail the sheet.
  - Accept a top-level array explicitly.
  - Treat "every mark rejected" (for example, the model spells the tags differently) as a failed sheet, not a zero.

### S2. Overlap de-dup assumes the model places symbols to within 18 pt [reproduced: R2, simulation]
- **Evidence.** `counter.ts:34` and `169-211` merge duplicates only within 0.25″. The prompt asks the model to report every overlap symbol in every tile (`prompts.ts:441`).
- **Simulation.** 20 distinct symbols in a 1″ band (7.28″ tiles), with Gaussian position error on each report:

  | Position error (sd) | Symbols placed (true count 20) |
  |---|---|
  | 0.5% | 20 |
  | 1% | 21 |
  | 2% | 27 |
  | 3% | 32 |

- **Scenario.** About 20% of a D sheet's area is overlap band, so modest localization error inflates counts by several percent job-wide. All tests use the exact-position `perfectCounter` (`test/fixtures/takeoff/perfectCounter.ts`), so none of this is exercised.
- **Fix.**
  - Give each tile ownership of its core region, splitting overlaps at the midline, and drop marks outside the core. Only half the overlap (0.5″) then needs to be right, not 0.25″.
  - Or tell the model to report only symbols whose centre is in the tile's own region.
  - Add jittered-counter tests.
  - Have the eval report its measured position error.

### S3. Partial sheet coverage goes unflagged [reproduced: R3c + C]
- **Evidence.** `countMerge.ts:175-176,198` lets lighting types be counted from a power plan when no lighting or combined sheet was counted. There's no flag and no review item.
- **Cases that reach this:**
  - The lighting plan is classified `schedule` or `detail`. `cls` defaults to `schedule` for unparsed pages (`pageClassifier.ts:202,207`), and an "ENLARGED …" plan is `detail` by the classifier's own definition.
  - The PDF's classifier failed, so its inventory is `[]` (`preconstruction.ts:351-361`).
- **Repro.** R3c: only "POWER PLAN" counted, 12 background A marks. The result is `counted 12`, with flags `[]`.
- **Fix.**
  - Add a blocking review item when electrical-looking pages weren't counted (unclassified, schedule/detail with PLAN in the title, or a failed classifier file).
  - Add one when a fixture category was counted only on its anti-focus sheet, and when the "No building/site plan was counted" flag fires.

### S4. Disconnects and equipment stack across categories [reproduced: R5]
- **Evidence.** `countMerge.ts:366-376` only replaces rows in lighting, controls and branch-power categories. A counted equipment or legend disconnect lands in Branch Power.
- **Repro.** An Agent 1 row "60A fused disconnect switch, NEMA 3R ×4" under Service & Distribution is kept, and "Fused disconnect switch (DS) ×4" is added. That's 8 disconnects.
- **Scenario.** AutoZone disconnects are APT-furnished, so this is directly priced.
- **Fix.** Match rows against equipment and device targets in every category, or at least Service & Distribution.

### S5. Bids analysed before this branch are never gated, and their `ask` questions never show [reasoned: C]
- **Evidence.** `takeoffReview.ts:32` treats NULL `review_status` as ungated. `accountTermsFor` (`preconstruction.ts:626-633`) builds the questions but never writes review items.
- **Scenario.** Regenerating Kissimmee without re-analysis produces power poles "NOT YET DECIDED", and the document is generated anyway.
- **Fix.** For NULL status, build the snapshot inside `takeoffGate` and block when it has questions. Or require a re-analysis.

### S6. An answered scope question is still rendered as "NOT YET DECIDED" [reproduced: A, C]
- **Evidence.** `accountRules.ts:396` loops over every `snap.questions`.
- **Scenario.** Agent 2, Agent 4 and the draft all see both "furnished and installed by the GC" and "NOT YET DECIDED — do not state who furnishes…".
- **Fix.** Skip questions the estimator has resolved, and add a test.

### S7. Drawing statements are silently lost or misread [reproduced: A, C]
- **Blank furnish/install fields.** `statementParties` (`accountRules.ts:199-207`) applies one "by X" to both halves. "POWER POLES FURNISHED BY GC, INSTALLED AND WIRED BY EC" comes out as GC/GC with source "drawings", and B7's deletion then follows.
- **Multi-word parties.** The conflict answer "Drawings: furnished by the equipment vendor…" is re-parsed by a one-word regex (`:318-321`). The term vanishes from the resolved terms, but the item still shows as answered and the gate clears.
- **Consequence.** Both break the rule that a drawing statement is never silently overridden.
- **Fix.** Parse furnish and install separately, store structured parties on each option instead of re-parsing display text, and reject an answer that doesn't parse.

### S8. Matcher inputs [reproduced: A]
- **GC name treated as the drawings.** `accountRulesDb.ts:155` passes `project.gcName`, which is the bid's own GC after `applyGcHygiene` (`outputHygiene.ts:47-48`). So a GC named "Auto Zone Construction Group" on a Dunkin' bid matches AutoZone, and `matchedBy` says "in the drawings". Pass `gc_extracted`, or don't match on GC names at all.
- **Missing 7-Eleven aliases.** The seed aliases (`migrations/114:69`) lack "7-11" and "711". A bid named "7-11 #41234" silently gets Default: Southern Lighting and APT-furnished fixtures. Add the aliases, show the matched rule in the Takeoff step, and warn when a brand is set but only Default matched.

### S9. The non-electrical gate blocks ordinary electrical lines [reproduced: A]
- **Evidence.** `bidstd/scopeList.ts:139-151`.
- **Lines that 422 generate-docx until overridden:**
  - "Saw cut and patch concrete slab for underground conduit"
  - "Core drill CMU wall…"
  - "Concrete light pole foundations" (only pad and base are exempt)
  - "Roof flashing / pitch pocket for RTU conduit"
  - "Roll-up door motor — 208V"
  - "Landscape lighting fixtures", "Irrigation controller 120V circuit"
  - any line with unit SF
- **Why the override doesn't stick.** Overrides are keyed on wording (`normalizeLineKey`), so an Agent 4 re-run rewords the line and the block comes back.
- **Fix.**
  - Exempt electrical context (conduit, circuit, lighting, motor, operator, feed).
  - Add foundation, pier, penetration and pitch pocket to the concrete and roofing exemptions.
  - Make SF a warning, not a block.

### S10. The "irrelevant spec" check blocks ordinary sentences, with no override [reproduced: A]
- **Evidence.** `outputHygiene.ts:163-165` is enforced in verifyBid (`preconstruction.ts:2364` always sets `projectAddress`).
- **Sentences it blocks:**
  - "Warranty only applies to APT-furnished material"
  - "Deliveries to the site only during business hours"
  - "Coordinate with Duke Energy **Florida**" when `bid.loc` has no state or zip. The project state is then null, so Florida counts as elsewhere.
- **Fix.**
  - Require a named other place or prototype.
  - Warn instead of block when the project state is unknown.
  - Allow an override.

### S11. Banned language misses plurals [reproduced: A]
- **Evidence.** `verifyBid.ts:80,95` use `\bRFI\b` and `\bTBD\b`, so "pending RFIs" passes a GC document.
- **Fix.** Use `\bRFIs?\b` and `\bTBDs?\b`, and add "request for information" and "to be determined".

### S12. A stale draft is used silently for the pre-bid package [reasoned: B]
- **Evidence.**
  - `source:'draft'` never compares `draft_inputs_hash` (`preconstruction.ts:2203`).
  - The auto re-compose on review clear (`:1702-1708`) is skipped while a draft is running, so edits made during that call are lost.
  - The hash is computed across several separate reads (`:576-592`).
- **Scenario.** Scope-list or SOW edits made after the draft never reach Chris.
- **Fix.**
  - Expose `draft_stale` and show "re-compose".
  - Refuse or warn in generate-prebid-package when the draft is stale.
  - Hash the same snapshot the prompt was built from.

### S13. Resolving the last review item starts a paid Opus draft without `run_analysis` [reasoned: B, C]
- **Evidence.** `POST /review/resolve` (`preconstruction.ts:1690`) only requires login. The "not already running" check isn't atomic, so two concurrent resolves can bill two drafts. No activity or usage row is written.
- **Fix.**
  - Auto-start only for users with `run_analysis`.
  - Claim the running state with `UPDATE … WHERE draft_status IS DISTINCT FROM 'running' RETURNING`.
  - Log the activity.

### S14. A takeoff section row can be orphaned at the bottom of a page [reproduced: B, soffice sweep]
- **Evidence.** `utils/proposalDocx.ts:207-221,246-253` sets `cantSplit` on section rows but not `keepNext`.
- **Repro.** The Kissimmee fixture was rendered with 0–24 extra items. In 6 of 25 variants a page ends on a lone "Branch Power", "Lighting Controls" or "Exterior / Site Lighting" band.
- **What passed in the same sweep.** The header row repeated on every continuation page, and the price block stayed with the signature every time.
- **Fix.** Set `keepNext` on the section-row paragraph, and keep the sweep as a test.

### S15. "Use confirmed markers" counts markers from sheets the merge ignored [reasoned: C]
- **Evidence.** `takeoffReview.ts:43-55` has no sheet filter, and AI markers are written for every counted sheet, including anti-focus and ignored ones.
- **Scenario.** The estimator confirms 70 A markers from the power-plan background plus 73 on the lighting plan, and the resolution becomes 143.
- **Fix.** Count only markers on the sheets the merge used for that type, or write markers only for used sheets. Show a per-sheet breakdown.

### S16. The eval harness defaults to the live DB and under-reports cost [reasoned]
- **Evidence.**
  - `scripts/evalTakeoff.ts:61` runs `runMigrations()`. The pool defaults to `electrical_crm` (`db/pool.ts:38`), which is the database the live Local Version app uses, still at migration 111.
  - A pre-merge run from the worktree would apply 112–117 to the live DB and insert (then delete) a bid there.
  - `runPipeline` also awaits the Opus draft (`preconstruction.ts:1005`), but the dry-run text (`:57`) and the cost table (`:98-103`) leave out `usage_draft`.
- **Fix.**
  - Refuse to run unless `DB_NAME` is set explicitly, and recommend `electrical_crm_test`.
  - Add a draft line to the cost table.
  - Mention the draft call in the dry-run text.

### S17. Test integrity: the counter tests prove geometry, not robustness [reasoned]
- **Evidence.**
  - Every counter and pipeline test uses `perfectCounter`, which reports exact positions in exactly the right schema.
  - There is no test for positional jitter (S2), a wrong top-level shape (S1), all marks rejected, split-area plans (B4), no targets (B2), or unscheduled rows (B3).
  - `proposalCoworkStructure.test.ts` and the renders use a hand-built BidData that never went through `enforceAccountTerms` (see B6).
  - The Kissimmee-shaped merge tests (`ai/countMerge.test.ts:38-128`: PH0.1 skipped, E-7 skipped, wall packs 5 not 8, S1×2 + S2×1 = 3 poles / 4 heads, restroom M max-keep) are good and real-shaped.
- **Fix.** Add the tests named in each finding above, including a jittered counter (sd ≈ 2%) whose expected counts are asserted within tolerance.

---

## Nits

- **N1.** `countMerge.ts:326-328`: a type found only on a disallowed sheet reads "not found on any counted plan sheet", although R3d found 5 on E-1. The per-sheet list does show it. Say "found only on \<sheet\> (not counted there)".
- **N2.** `stopReason.ts:38` treats only `max_tokens` as truncation. `model_context_window_exceeded` truncates too. Agents 2–4 don't handle `refusal` the way the counter does (`counter.ts:297`).
- **N3.** `counter.ts:271`: a rendered sheet with 0 tiles stays `counted` with no call. Mark it failed.
- **N4.** `reviewItems.ts:120-128`: carried-over resolutions survive a new drawing set, marked only "from the previous run" inside the collapsed resolved list. Ask for re-confirmation when `count_result` changed.
- **N5.** `preconstruction.ts:893-901`: carry-over reads and writes `review_items` without a lock, so a resolve that commits mid-run is lost. Use one transaction with `FOR UPDATE`.
- **N6.** `reviewItems.ts:167`: "Not on this job" accepts any 3 characters ("..."). Require a word.
- **N7.** `scopeList.ts:88`: an Excluded item can dead-lock against an Included one ("Low voltage" vs "Low voltage: conduit and pull strings only"), and there's no override.
- **N8.** `outputHygiene.ts:65`: `filterMissingSheets` tests only the first sheet token. "Panel schedule on E-5 references E-9" is dropped because E-5 is loaded.
- **N9.** `accountRules.ts:44-45`: "plumbing fixtures by owner" and "fire alarm panel by GC vendor" raise blocking lighting and panel conflicts. They're noise, not leaks.
- **N10.** Near-duplicate check: "Fixture A 2x4 LED troffer" vs "Fixture B …" is flagged because `typeTag` needs the word "Type". It's a warning only.
- **N11.** `proposalDocx.ts:323`: an unparseable legacy price prints without words. Amount-in-words is otherwise correct for every edge case tried: 0, 0.01, 0.5, 11–21, 101, 999.99, 1000, 1001, 1e6, 1,234,567.89, "$12,345", "12,345.00" and the DB maximum. 999999.995, negatives and NaN return null rather than rounding.
- **N12.** `proposalDocx.ts:226`: descriptions repeat the item name ("RTU connection — RTU final connection…", visible in `after-3.png`).
- **N13.** The preview and the docx differ in small ways:
  - bands are left-aligned in the preview, centered in the docx;
  - section-row text is navy in the preview, black in the docx;
  - the preview hides empty Exclusions and Terms bands.
- **N14.** Draft reuse will seldom trigger in Jake's order of work: Chris's scope list and notes arrive after the draft, and any change forces a full Agent 4 run. That's safe, but the report should describe reuse as the uncommon case.
- **N15.** Frontend known-flake list: add `ElecProjectsSaveSection`, which fails under full-suite load on `main` too.

## Renders vs the Cowork PDF

The `after-*` renders match Cowork's order and content:

- header block, bold intro and navy bands;
- bullets, including the bold-lead ones;
- the takeoff table's columns and sections, with numbering restarting in each section;
- the terms, and the price in words and figures, with price and signature kept together.

They run 5 pages in LibreOffice against Cowork's 6. Jake's two corrections are in: change orders are approved by the GC, and disconnects are APT-furnished.

The render fixture is missing Cowork's Section C bullet "Fixture types per schedule: …". The same fixture would fail `validateBidData`, so the renders are not evidence that the app produces this document (B6, S17).
