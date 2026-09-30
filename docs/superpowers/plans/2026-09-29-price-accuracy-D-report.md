# Price accuracy round: Builder D report (D1–D4, AI reading v2)

**Branch:** `fix/remodel-reading-v2` (worktree `../Electrical-program-wt-reading2`), off main `a5ac9cd`
**Commits:**
- `7991180` D1
- `048d1b1` D2
- `d16493e` D3
- `61c00e8` D3 follow-up
- `bebfe45` D4
- plus this report

Not pushed.
**Migrations:** none. 156 and 157 are still free.
**Ground rules:**
- Worktree only; Local Version untouched; no dev servers.
- Tests ran on `electrical_crm_test` only; every model call is mocked.
- The Agent tool was not used.

## Evidence used

- **The new fixture.** `backend/src/test/fixtures/realrun/36th-street-live-2026-09-29b.json` is the live export `calibration-data/36th-street-live-run-2026-09-29b/`, copied read-only.
- **The new replay.** `replay36thB.ts` drives the real `runCountingStage` with:
  - every mark the live counter placed on E1.0, E2.0, A2.0 and A3.0;
  - each mark's live status;
  - E1.0's printed quote;
  - the live titles and the live unlisted tags.
- **Replay check.** With D stashed, the replay reproduces the live run exactly: the same 32 review items in the same order, and the same counts and demolition lines.
- **What is mocked:**
  - the D2 close-up answers (`chrisCrops`, or `liveCrops`, which echoes the live tile statuses);
  - the D3 "marked for removal" flag. The live counter was never asked for it.

## D1: a rule covers only what it names

- **Where:** `ai/remodel/statusScope.ts`, applied in `countingStage.finish()`.
- **Scope comes from the printed quote:**
  - receptacle / recept / outlet / duplex / GFI → receptacles;
  - switch → switches;
  - sensor / control / timer → controls;
  - devices → receptacles, switches, controls and other devices;
  - fixture / luminaire / lighting / lights → fixtures;
  - equipment / disconnect / panel / J-box → equipment;
  - no kind named → everything.
- **Always "everything":** the estimator's answer and a combined DEMOLITION + NEW WORK title.
- **Types outside the scope** behave as on a new build: statuses are stripped, every mark counts as new, and no question is asked. The count is logged in `remodel.scopedOut`.
- **Prompt change:** the STATUS block (remodel only) now says a rule covers only the kinds of item it names.
- **36th:** E1.0's "SHADED SYMBOL DENOTES NEW RECEPTICLE" (misspelt) → receptacles.
  - The 9 `status:` items are gone: DISCONNECT, $, ELECTRICAL PANEL, AHU #1, COMP #1, COMP #2, DISC-A, DISC-B and TRIANGLE.
  - Every count is unchanged; the 15 stripped statuses are logged.

## D2: receptacle status by close-up crop check

- **Where:** `ai/remodel/statusCrops.ts` and `STATUS_CROP_SYSTEM` (`prompts.ts`). It runs in `runCountingStage` between counting and `finish()`, in remodel mode only. It never runs after an "all new" or "I'll correct it" answer.
- **When it runs:** on a counted sheet with a rule, for each type the rule covers, when either:
  - the rule depends on FILL (shaded / filled / solid / hatched vs open / hollow / unshaded), or
  - fewer than 80% of that type's marks got a confident status in the tile pass.
- **The call:**
  - 1" crops at 300 DPI, 10 per call;
  - the sheet's own legend viewport as the example, picked by title (POWER for receptacles, LIGHTING for fixtures);
  - the evidence model at effort low;
  - cached in the evidence cache.
- **Mapping:** "filled" / "open" map through the rule (shaded = new → open = existing). Non-fill rules ask for new / existing / demo / relocated directly.
- **Low confidence:** an answer that is low-confidence or unclear, a failed call, or a mark past the cap (60 crops per run) → status `unknown` with `cropLow`. The mark is counted as NEW for now, never lowered.
- **Review:** ONE blocking `statuscrop:low` item lists those marks, with one member per type (`reconcileMembers`):
  - count = the number of new ones in all; confirm = keep the current count.
  - The answer is enforced in `enforcedCounts`.
  - Member answers carry over on a re-run with the same fingerprint.
  - `takeoffReview.ts` resolves it member by member.
- **Expected 36th result (answers mocked):** 26 receptacle marks checked in 3 calls. With Chris's pattern:
  - duplex 1 → 5, WP GFCI 0 → 2;
  - 19 existing listed and never priced;
  - Chris: 5 duplex + 2 GFCI.
- **What the mock cannot show:** which live duplex marks are really shaded.

## D3: demolition by comparison

- **Where:** `ai/remodel/demolition.ts` (`registerDemolitionSheet` and `buildDemolition(…, newPlans)`), fed from `buildRemodelResult`.
- **The rule:** on a whole demolition sheet, a mark is demolition when either:
  - **(a)** it is marked for removal. The demolition prompt now asks for a sixth element: "demo" only for dashed, crossed-out or keyed-for-removal symbols, or symbols inside an area keyed for removal; "existing" otherwise; or
  - **(b)** it is NOT drawn as existing / relocated at the same place on its registered new-work plan.
- **Registration:** the sheet-pair logic's mark vote (`alignSheets`), run on removal classes.
  - Only a `marks` alignment counts; a bare same-size frame never does.
  - The best-pairing plan wins; at least 3 pairs are needed.
- **A plan showing nothing existing** for a class changes nothing. On 36th, E2.0's fixtures keep today's count.
- **Registration fails:** the line keeps its count, and ONE blocking `demosuggest:<class>` item shows the arithmetic ("40 shown − 25 still there = 15 removed"). The options are use the suggestion / keep all, or a count.
- **Follow-up: a class drawn without a status.** When the registered plan draws the class at the same places WITHOUT a status (no rule covers it, D1), it may stay or be replaced. The line keeps its count, and a blocking `demosuggest:` item asks. Fixtures are excluded.
- **Registered and lowered:** a non-blocking `democompare:<class>` item and the line spec both say so ("25 more on A2.0 still shown as existing on E1.0 — not removed").
- **Both item kinds** carry `typeKey = DEMO-<class>`, `category: 'Demolition'` and `rowItem`, so C2's `demolitionAnswers` applies their qty to the line.
- **36th (live marks):**
  - A2.0 registers with E1.0: "36 shared marks agree on an offset of 0.22", -0.18"" (A2.0 is drawn about 16 × 24 pt off E1.0). A3.0 registers with E2.0.
  - Receptacles: 40 − 25 = **15** (Chris 18). With the mocked D2 answers it is 21: a new device at an old one's place replaces it.

## D4: demolition lines use C5's units

`PRICED_DEMO_CLASSES` is now every class, and the "no demolition labor unit" item no longer fires. The line texts (`DEMO_UNIT_NAMES`):

| Class | Line text | C5 unit (matched by alias) |
|---|---|---|
| DEMO-EQUIPMENT | Demolition — equipment connection / disconnect | DEMO-EQUIP, 0.75 h |
| DEMO-DEVICE | Demolition — device (other) | DEMO-DEVICE, 0.15 h |
| DEMO-CONTROL | Demolition — lighting control device (sensor / timer) | DEMO-CONTROL, 0.25 h |
| DEMO-EXTERIOR | Demolition — building-mounted exterior fixture | DEMO-EXTFIX, 0.5 h |
| DEMO-SITE-POLE | Demolition — site pole light | DEMO-SITEPOLE, 3.0 h |

B's seven classes are unchanged.

I checked C's branch read-only (`4476ac9`). Each of my five line texts is an alias of the matching C5 unit, and C5's tests map two of them exactly. **Merge C5 with D4:** without it, these lines would fuzzy-map.

## 36th replay: before / after

| | Live 9/29b (= replay on `a5ac9cd`) | After D1–D4 (D2 mocked as Chris) | After, D2 = live statuses |
|---|---|---|---|
| Review items (blocking) | 32 (25) | 24 (17) | 25 (17) |
| New receptacles: duplex / GFI / 42 / WP | 1 / 0 / 0 / 0 | 5 / 0 / 0 / 2 | 1 / 0 / 0 / 0 |
| Demo fixture ≤2x4 | 47 | 47 | 47 |
| Demo exit/em | 5 | 5 | 5 |
| Demo receptacle | 40 | **21** | **15** |
| Demo 1-pole switch | 11 | 11 (+ question: 7 if E1.0's 3 stay) | same |
| Demo device (other) | 1 (not a line, "no unit" item) | 1 line (+ question: 0 if it stays) | same |
| Demo equipment / disconnect | 10 (not a line, "no unit" item) | 10 line (+ question: 0 if they stay) | same |

Chris's demolition: 52 / 2 / 2 / 18 / 6 + 2, no equipment.

**Review items, net change:**
- 9 `status:` items removed;
- 2 `demounit:` items removed;
- `count:WP` removed (WP is new now);
- 3 `demosuggest:` items added (switch, device, equipment);
- 1 `democompare:` info item added.

**Kissimmee 9/28:** unchanged. It is a new build, so none of D runs. The existing guards pass: the whole review list is identical to the pre-remodel list, and so are the counts and the 6 calls.

## What the live re-run should show

1. **The status questions are gone.** No `status:` items for disconnects, $, panels, AHU, COMP, DISC or the phone outlet.
2. **The close-up check runs.** The log line `[counting] status close-up check` should show about 26 crops in 3 calls on E1.0, and a per-type tally (`… DUPLEX RECEPTACLE: N new, M existing, K unclear`).
   - Target: about 5 new duplex + 2 GFCI.
   - Any unclear marks appear in ONE `statuscrop:low` item.
3. **Receptacle demolition** is about 15–21 (Chris 18), with an info item "40 shown on A2.0, N still shown as existing on E1.0".
   - If it stays 40 with a `demosuggest:` item, registration failed. Check the item's detail.
4. **Three blocking `demosuggest:` questions** (switch, device, equipment). Answering "keep all" or entering counts reaches the lines through C2.
5. **Demolition lines** for equipment and device (other) map to C5's "(default — confirm)" units.
6. **Added cost of the crop checks** (Opus 5.5, the evidence model, at $4 / $20 per MTok):
   - per call: about 3.5–4k input tokens (a legend image of about 1.5k tokens, ten 300×300 crops of about 120 tokens each, and text) and about 0.3–1k output tokens at effort low;
   - so about $0.02–0.035 per call;
   - 36th (3 calls): **about $0.06–0.10**;
   - the 60-crop cap (6 calls): at most about $0.12–0.20 per run;
   - a cached re-run costs nothing.

## Tests

- **Backend full suite, run once:** 2599 tests, **2592 passed, 3 failed, 4 skipped.** The failures are only the known flakes: intakeSimilarCache ×2 and integration lead-backfill.
- **Frontend full suite:** 1358 / 1358.
- **New tests:**
  - `src/ai/remodel/remodelV2.test.ts`: 15 tests (D1 scope, D2 plan / parse / cap, D3 registration / comparison / rule (a) / suggestion / unstated).
  - `src/test/priceAccuracyD36th.test.ts`: 14 replay tests on the 9/29b export (D1 to D4, including the low-confidence item enforced and carried over, a failed check, and a registration failure).
- **Updated tests:**
  - `remodel36thReplay.test.ts`: the model-call count is +3 crop calls, and the S8 site-pole case is now a line.
  - `remodel.test.ts`: the S8 row list.
  - The A1–A3 replay's mock answers the crop check with its own mocked statuses.

## Shared-file edits (minimal, additive)

- `estimating/takeoffReview.ts`:
  - `statuscrop:` added to the per-member resolution branch;
  - its "keep current count" does not delete gap-fill suggestions.
  - This is C's area. It is one condition each.
- `ai/reviewItems.ts`:
  - the new items;
  - `groupOf` / `riskRank`;
  - the `enforcedCounts` prefix;
  - the carry-over prefix.
- `ai/prompts.ts`: `STATUS_CROP_SYSTEM`.
- `ai/counter.ts`:
  - `cropLow` / `marked` on `PlacedMark`;
  - `splitByStatus` keeps `marked`.
- Frontend `TakeoffReviewPanel.tsx`: the fallback `groupKey` for the new prefixes.
- `test/fixtures/realrun/replay36th.ts`:
  - exported helpers;
  - a crop responder;
  - the demo flag on demolition sheets.

## Open questions

1. **Registered D3 lowers the line automatically**, with a non-blocking item and the reason in the line spec. The unregistered and no-status cases are blocking. Should a registered reduction also need a confirm?
2. **Three new blocking questions on 36th** (`demosuggest:` for switch, device and equipment) overlap the existing `demodup:` questions for switch and equipment. The `demosuggest:` answer is documented as the final count. Should the two be merged into one item per class?
3. **Close-up failures and low answers count as NEW** (26 on a total failure), which raises the count until answered. The alternative is to keep the tile-pass status. Which is preferred?
4. **A new device at an old one's place counts as a removal** (rule b, strictly). With Chris's mocked answers that gives 21, not 15. Is replacement in place a demolition in APT's practice (Chris 18)?
5. **E1.0 draws panels A/B and the disconnects at the same places as A2.0**, and the analysis says "reuse existing panels". The equipment question suggests 0. Should equipment with a reuse note be answered automatically?

---

## Coordinator decisions 1–5

**Commits:**
- `d48f854` decision 3
- `4e04b2a` decision 4
- `4f069a8` decision 5
- `c22c5f4` decision 2
- plus this report update

Decision 1 needed no code. No migrations.

1. **Auto reduction when the plans register: kept as built.** The non-blocking `democompare:` note gives the arithmetic ("40 shown on A2.0, 25 still shown as existing on E1.0 → 15 in the line") and the registration evidence ("36 shared marks agree on an offset of 0.22", -0.18"").
2. **One demolition item per class.**
   - When a class has a "how many are removed?" item (`demosuggest:`), its "same items or more?" item (`demodup:`) is no longer raised. The suggestion item folds that in: the sheets that could not be compared, their sum, and "at most N from the larger sheet".
   - The item is titled "… how many are removed? (final count)" and ends "This answer is the line's FINAL demolition count."
   - A class with only the duplicate question keeps `demodup:` as before.
   - 36th: the switch class has one item, not two.
3. **An unclear close-up answer keeps the tile pass's status.**
   - This covers low-confidence and unclear answers, failed or throwing calls, and marks past the cap. Those marks are not forced to new; they are only flagged `cropLow`.
   - The one `statuscrop:low` item lists them per type, with the tile reading ("kept as the tile pass read them (0 new, 2 existing)").
   - *Tests:* a total failure (every answer unclear) and a call that throws both leave the receptacles exactly as the tile pass read them (1 new duplex; 13 duplex, 7 GFI, 3 "42" and 2 WP existing), with ONE item.
4. **Replacement in place stays a removal.**
   - A demolition-sheet device paired with a NEW device at the same registered place is still removed, since APT pays to pull the old one.
   - The line spec adds "includes N devices replaced in place", and the `democompare:` note explains it.
   - 36th with the mocked close-up answers: 21, including 6 replaced in place (4 duplex + 2 WP). With the live statuses: 15, none replaced.
5. **Equipment drawn at the same place and noted for reuse: 0 demolition, non-blocking.**
   - This applies when the registered plan draws equipment of that class at the same place with no status, and a text in the drawing analysis or a counter note says reuse / to remain / remains in place / ETR.
   - The note must name the same kind of equipment: panel (MLO, MCB), disconnect, switchboard, transformer, meter, wireway or J-box. `reuseQuoteFor` checks this.
   - Those items leave the line. A non-blocking `demoreuse:<class>` item gives the quote, the sheets and the registration, and the line spec says "N more … noted for reuse — not removed".
   - Any equipment without such a note is still asked.
   - 36th: panels A/B (2 on A2.0 and 2 on A3.0) are kept per "Existing Panel A 200A MLO 120/208V 1PH - reuse". The equipment line goes 10 → 6, and the 6 disconnects are still asked (suggestion 0). The "same items or more?" question for equipment disappears, because A3.0 has no equipment left.

### 36th replay after the decisions

| | Live 9/29b | Now, Chris's pattern (mocked) | Now, live statuses |
|---|---|---|---|
| Review items (blocking) | 32 (25) | 23 (15) | 24 (15) |
| Demo fixture / exit / receptacle | 47 / 5 / 40 | 47 / 5 / 21 (incl. 6 replaced) | 47 / 5 / 15 |
| Demo switch | 11 | 11, ONE final-count item (suggestion 7) | same |
| Demo device (other) | 1 (no unit) | 1, ONE item (suggestion 0) | same |
| Demo equipment | 10 (no unit) | 6, ONE item (suggestion 0), plus info: 4 panels reused | same |

- **Demolition items now:** `demosuggest:` for switch, device and equipment (blocking), and `democompare:` for receptacles plus `demoreuse:` for equipment (info).
- **Kissimmee 9/28:** unchanged. It is a new build, so none of this runs.

### Tests (relevant only)

- `priceAccuracyD36th.test.ts`, `remodelV2.test.ts`, `remodel36thReplay.test.ts`, the `src/ai/remodel` tests and `reviewItems.test.ts`: **127 / 127**.
- Frontend `TakeoffReviewPanel.test.tsx`: 41 / 41.

### Follow-up: a hedged reuse note never answers (coordinator)

- **What changed:** a reuse note containing unclear / unknown / verify / confirm / if / may / might / TBD / possibly / perhaps / whether / field verify, or a question ("or …?", "?"), is no longer evidence (`HEDGE_RE`).
- **Result:** the equipment keeps its demolition count and the one final-count question stays. The hedged note is shown in that question as "Context (a hedged note — not taken as an answer): …".
- **Tests:**
  - the nine hedged phrasings, and the context on the suggestion;
  - a 36th replay with every "reuse" in the analysis rewritten as "reuse — field verify": equipment stays 10, there is no `demoreuse:` item, and one equipment item carries the context.
- **Relevant tests:** 130 / 130.

---

## Fix round: review b0c0b5f (NOT READY) → the coordinator's decisions

**Commits:**
- `4e4e7e0` B1
- `bb391ee` B2
- `768efe2` B3 + S3
- `a7e1b39` S1
- `ad38991` S2
- `54e461e` S4 + S5
- `1bdb1f8` S6
- `b6fb492` S7 + S8
- plus this report

No migration; 157 is still free.

**How the repros are tested:** every reviewer repro is a test. The 36th ones go through the real `runCountingStage` via `replay36thB`. The pure ones (typical floors, mirror, 70 − 25) are `buildDemolition` unit tests, plus a counting-stage variant of each where the replay can express it: E1.0 mirrored, and A2.0 on LEVEL 2 against E1.0 on LEVEL 1.

**Overriding principle:** nothing D does lowers a priced count or a demolition count without a blocking item, unless the evidence is unambiguous. The unambiguous cases are:
- a registered, same-level plan with confident statuses (the decision 1 note);
- an unhedged, un-negated reuse clause naming the same equipment (decision 5).

### Blockers

**B1: only symbol-fill rules are checked close up; a lowering is never silent.**
- A fill rule needs a fill word governing a symbol or device noun, e.g. "SHADED / FILLED / SOLID / HATCHED / DARKENED SYMBOL(S)" or "RECEPTACLES SHOWN FILLED".
- These never trigger the check: LINES, DARK, BOLD, HEAVY, SCREENED, CLEAR, HATCHED AREA.
- The "fewer than 80% confident" trigger is gone.
- When a crop moves a tile-pass new mark to existing, ONE blocking `statuscrop:reclassified` item appears: "Close-up check reclassified N as existing — confirm". Its "restore" answer counts them as new again (enforced).
- *Tests:*
  - the reviewer's DARK repro: no crop call, counts unchanged at 14 / 7 / 3 / 2 and 4 disconnects;
  - a real fill rule whose crops lower all 26: one blocking item, and restore gives 14 / 7 / 3 / 2;
  - the reviewer's line-weight phrasings.

**B2: reuse notes are read clause by clause.**
- Clauses are split on sentences, ";" and a comma that starts a new action.
- A clause is evidence only when it names the same equipment kind, and, for a tagged type (PANEL A, DISC-A), that tag or no tag.
- Any relevant clause that removes, demolishes, replaces, relocates or abandons, or that negates or hedges the reuse, cancels the evidence. The question stays, with the note as context.
- An untagged type ("Electrical panel") is cancelled by any clause about its kind.
- The notes read are every analysis text and counter note that names equipment.
- *Tests:*
  - the reviewer's phrasings, plus the "do not reuse, remove and replace" row;
  - the mixed sentence: only PANEL A is zeroed; panel B, the disconnects and an untagged panel are not;
  - the real 36th notes still count;
  - through the counting stage, the reviewer's negated rewrite: equipment stays 10, there is no reuse item, and the context is shown.

**B3: registration.**
- **Same level / area only.** Levels come from the sheet's metadata or the LEVEL / AREA words in its titles. A sheet with no stated level is compared only on a job where no sheet states a level.
- **One voted translation**, needing at least 3 marks and at least half of the shareable marks. It is rejected when:
  - an offset a grid period away scores at least 90% as well, or
  - the plan mirrored left-right or top-bottom scores at least 90% as well, or
  - the refined offset's mean residual is over 0.15".
- **60% per class.** A class is compared only when at least 60% of its demolition marks pair with the plan's marks of that class. Otherwise ONE blocking question with the arithmetic.
- *Tests:*
  - typical floors: level 2 never compares with level 1, giving a question of 20 − 2 = 18;
  - unknown levels on a multi-level job;
  - the reviewer's mirrored regular grid: a question, never auto;
  - through the counting stage: E1.0 mirrored (line 40, question 40 − 24 = 16; one mirrored mark falls in the legend) and A2.0 LEVEL 2 against E1.0 / E2.0 LEVEL 1 (line 40).
  - The unmodified 36th still registers: "36 shared marks agree on an offset of 0.23", -0.32" (mean residual 0.04"; no other offset or mirror fits)", giving 15.

### Should-fixes

- **S1:** reference runs are removed before the class nouns are read (SEE / REFER TO / PER …, ON … PLANS, X PLAN / SCHEDULE). "BOLD INDICATES NEW WORK ON LIGHTING AND POWER PLANS" now covers everything. Through the stage, nothing is scoped out and the tile statuses apply.
- **S2: only confident statuses lower demolition.** A new-plan mark the close-up check could not confirm, or itself lowered, is "uncertain": it is asked about (blocking), never subtracted.
  - Crops all unclear: the receptacle line stays 40, with a question of 40 − 25 = 15.
  - Crops that lowered tile-pass new marks: 40.
  - The stored "All devices are new" answer marks every new-plan mark new, so demolition is recomputed to 40 and nothing is asked.
- **S3:** unregistered sheets of a class subtract the same-level plans' existing list ONCE (70 − 25 = 45, a unit test).
- **S4: one quantity-bearing item per DEMO-* class.**
  - Precedence: demosuggest, then demodup, then democompare, then demoreuse. The others are confirm-only, with no quantity.
  - C's `demolitionAnswers` (copied verbatim from `fix/price-accuracy` 1039dc8) gives the final answer in both resolution orders.
  - Every class has exactly one quantity-bearing item.
- **S5:** "how many are removed?" offers "None removed — 0" (`optionQty`) and accepts a count of 0. The frontend input allows 0 for it.
- **S6:** equipment counted as a new install with no status on the plans, while its reuse evidence stands, raises ONE blocking `remodel:reuse-install`.
  - "Existing (reused)" removes the install line; "new installs" keeps the counts.
  - The kind now comes from the type's own name or the head of its description. "A/C Comp Unit #1, Panel A ckts" is not a panel.
  - 36th: "Electrical panel 2" is asked. With the negated notes there is no item.
- **S7:** each checked type gets the legend's own symbol as its example, cropped at 300 DPI. That is a mark the counter placed for the type inside a legend viewport, preferring the POWER / DEVICE legend for receptacles and switches. With none, there is no image, only text. Marks off the plan viewports are never crop-checked.
  - 36th has no legend marks, so there are no legend images: 26 crop images in 3 calls, down from 29.
  - *Test:* a legend duplex becomes the example and is never cropped itself.
- **S8:** close-up cache hits and errors are added to `evidence.cached` and `evidence.errors`.

### 36th replay now

| | Live 9/29b | Chris's pattern (mocked crops) | Live statuses |
|---|---|---|---|
| Review items (blocking) | 32 (25) | 24 (16) | 25 (16) |
| New duplex / GFI / 42 / WP | 1 / 0 / 0 / 0 | 5 / 0 / 0 / 2 | 1 / 0 / 0 / 0 |
| Demo fixture / exit | 47 / 5 | 47 / 5 | 47 / 5 |
| Demo receptacle | 40 | 21 (incl. 6 replaced) | 15 |
| Demo switch | 11 | 11 (question: 10 if E2.0's one stays) | same |
| Demo device | 1 | 1 (question: 0) | same |
| Demo equipment | 10 | 6 (question: 1); panels 4 reused (info) | same |

- **Remodel items:**
  - `demosuggest:` for switch, device and equipment (blocking);
  - `remodel:reuse-install`: Electrical panel 2 (blocking, new);
  - `democompare:` receptacle and `demoreuse:` equipment, both info and confirm-only where a final count exists.
- **Switch:** A2.0's switches are only 3 of 10 at E1.0's places, under 60%, so they are not compared.
- **Kissimmee 9/28:** unchanged. It is a new build.

### Tests

- **Relevant:** `priceAccuracyD36th.test.ts`, `src/ai/remodel/*`, `remodel36thReplay.test.ts`, `remodelConventionRoute.test.ts` and `reviewItems.test.ts` all pass.
- **Frontend:** `TakeoffReviewPanel.test.tsx` 41 / 41.
- **Backend full suite, run once:** 2632 tests, **2622 passed, 6 failed, 4 skipped**. The six are the same ones the review saw on its HEAD:
  - intakeSimilarCache ×2;
  - integration lead-backfill;
  - estimatingLibrary seeded-item (test-DB state);
  - intakeSimilar.route ×2 (30 s load timeouts; 2 / 2 when re-run alone).

### Open questions

1. **The reuse vs new-install contradiction (S6) is asked, not auto-lowered.** Meanwhile the demolition side zeroes the same panels on the same evidence. Should an "existing (reused)" answer also be implied for the install side when a registered demolition plan pairs them? Today it is asked, per the overriding principle.
2. **A counter note on a demolition sheet such as "verify if removed"** (seen in the live 36th A2.0 notes) cancels panel reuse through B2's removal and hedge words. The live re-run will likely keep the equipment question for that reason.

### Follow-up: one question per reused equipment item (coordinator)

- **One question per item.** Equipment with reuse evidence now gets ONE blocking `reuse:<type>` question, "Electrical panel A/B — new install or existing reused?". It replaces both `demoreuse:` and `remodel:reuse-install`.
- **Its own demolition row.** The equipment's demolition marks are no longer dropped. They move to their own Demolition row (countType `DEMO-EQUIPMENT/ELECTRICAL PANEL`, the same unit name).
- **Nothing is lowered before the answer.** On 36th the class row is 6 and the panels row is 4, so 10 in all.
- **One answer sets both sides:**
  - *Existing, reused:* the install line is removed (`enforcedCounts` null) and the row's qty is 0.
  - *New install:* the install count stays 2 and the row stays 4.
- **Unchanged:**
  - The question keys the row by `typeKey`, so C's `demolitionAnswers` applies it. Every DEMO-* row still has exactly one quantity-bearing item.
  - Negated notes raise no question.
  - The hedged A2.0 "verify if removed" note keeps the question, which the coordinator accepted.
- **Relevant tests:** 159 / 159, plus the frontend panel test 41 / 41.

### Re-check 36dcfc5 fixes

**Commits:** `f7d41e0` R1, `28e1297` N1, `41326ff` N2, plus this report update.

- **R1: the "reclassified" item can now be answered.**
  - Only `statuscrop:low`, the item with per-type members, takes the per-type resolve path. `statuscrop:reclassified` takes its own confirm / restore answer.
  - *Route tests on the test DB (`resolveReviewItems`):*
    - restore gives the 26 back as new (14 / 7 / 3 / 2), and proposal enforcement prices the duplex line at 14;
    - confirm keeps them existing (0);
    - the answer carries over a re-run;
    - `statuscrop:low` still resolves type by type.
- **N1: a missing level on a one-level job.**
  - A sheet with no stated level is compared when the job names at most one level. Probe p9 (E1.0 "First Floor Electrical Plan") now gives 15.
  - A demolition sheet with no same-level plan still gets the blocking question with the arithmetic, using every new-work plan. It is never a silent 40: LEVEL 2 against LEVEL 1 gives 40 plus a question offering 15.
- **N2: tags are read in more forms.**
  - Quoted, parenthesized and hyphenated tags are read: "A", (A), 'A', “A”, LP-1.
  - Plain words after the noun are never tags.
  - "EXISTING PANEL "A" TO REMAIN" matches panel A and never PANEL LP-1.
- **Relevant tests:** `priceAccuracyD36th` + `src/ai/remodel` 98 / 98; route tests 2 / 2.
