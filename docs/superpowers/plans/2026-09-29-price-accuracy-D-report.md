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

### Open question

**A negated reuse note** ("reuse scope unclear") still counts as a reuse note when it names the same kind of equipment. On 36th that phrase is only about a pendant fixture, so it does not apply. Should negations such as "unclear", "verify" or "if" void a reuse note?
