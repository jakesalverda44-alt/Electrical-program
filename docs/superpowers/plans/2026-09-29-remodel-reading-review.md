# Remodel reading round (Builder A): adversarial review

**Branch:** `feat/remodel-reading`, range `7a69928..e5969ce` (A1 `d74d019`, A2 `b015daf`, A3 `82edf6d`, names `2b3c438`, report `e5969ce`)
**Reviewer:** Opus 5.5, 2026-09-29. Read-only except this file. No model calls, no Agent tool, no push. Tests only on `electrical_crm_test`.

## Verdict: **NOT READY**

The plumbing is careful and the tests are green: `remodel.test.ts` + `remodel36thReplay.test.ts` gave 33/33 on a re-run here. But four things break the round's own standing rules on realistic input:

1. A new build can enter remodel mode.
2. Counts drop while the item says "nothing was changed".
3. The estimator's answer is never applied on a re-run.
4. The legend collapse hides evidence-backed zeros.

All repros below use the branch's own code. The probe scripts are in the session scratchpad and are not committed. The replay probes drive `runCountingStage` with the same fakes as `replay0928.ts`.

---

## Blockers

### B1. One word "Existing" in a sheet title puts a new build into remodel mode (a)

`remodelSignal` (`status.ts:109-113`) tests `REMODEL_TITLE_RE = /\b(ALTERATIONS?|EXISTING|RENOVATIONS?|REMODEL…)\b/` against every inventory page of discipline electrical, architectural, other, unknown, cover or fuel. It does not look at the page class, so project-manual pages count too. The text regex (`status.ts:74`) has the same problem. It fires on:

| Input | Result |
|---|---|
| Survey `V1 "Boundary & Existing Conditions Survey"` (other) | remodel |
| `D0.1 "Existing Conditions and Demolition Plan"` | remodel |
| Spec page `"DIVISION 02 - EXISTING CONDITIONS"` (other). CSI Division 02 is literally named that, and every spec book has it. | remodel |
| `E0.1 "Electrical Site Plan - Existing Utility"` | remodel |
| Scope note `"Demolition of existing building by sitework contractor"`. The negative lookahead only covers "to be demolished/removed". | remodel |
| Scope note `"No alterations to the design without engineer approval"` | remodel |
| Flag `"Future tenant build-out by others; stub only"` | remodel |

`bids.build_type` is only set once a job profile is accepted, so it is usually null and the text decides.

**Repro (real Kissimmee 9/28 replay).** Change one inventory title: V0.1 "Survey Sheet 1" → "Boundary & Existing Conditions Survey". Pass `remodel: { buildType: null, answer: null }`, exactly as the route does. Result:

- `[counting] remodel mode`
- 12 titles calls; they all fail in the fake, so the non-blocking `remodel:titles` item appears.
- D0.1 "Demolition Plan" (site demolition) is counted as a **demolition sheet**: 7 counter calls against a baseline of 6.
- New **blocking** item: "How are new vs existing devices shown on these plans?"
- Every E-sheet counter call gets the STATUS block. With the counter labelling one mark in three "existing", the install counts fall:

  | Type | Baseline | Now |
  |---|---|---|
  | A | 73 | 45 |
  | B | 52 | 36 |
  | E | 13 | 8 |
  | GFCI | 7 | 4 |

  90 marks in all are "listed, never priced".

  On a real run the model does this whenever it sees dashed or light-line site items.

**Fix direction:**
- Titles: consider only `cls === 'plan'` pages of the electrical or architectural disciplines.
- Drop bare `EXISTING` from the title regex, or require it next to a floor, reflected-ceiling or electrical plan and not next to survey, conditions, utility, site or grade.
- Drop bare `alterations` and `build-out` from the text regex.
- Treat "existing building … demolish/remove/raze" in any word order as a new-build signal.
- Better still: have a text-only signal raise a non-blocking "Is this a remodel?" item and leave remodel mode to `build_type`, or to that item's answer.
- Add these cases, plus a Kissimmee replay with the V0.1 title changed, as regression tests.

### B2. With no convention, counts ARE lowered, and the blocking item says they are not (b, A1.4)

`splitByStatus` (`counter.ts:452-459`) moves every mark the model tags `existing` or `demo` out of `placed`, whether or not any rule was found. Plan A1.4 says "the count stays unchanged until answered". The `remodel:conventions` detail (`reviewItems.ts` `remodelItems`) says "Every counted device is counted as NEW for now — nothing was changed".

The prompt only *asks* the model to use "new" when no rule is found. The replay test `no printed rule found… the counts stay as they are` passes only because its mock answers "new" for every mark (`replay36th.ts` `counter36th`, `conventions === false`). It is tautological.

**Repro:** see the third B1 run above. `conventionQuestion` is true and A goes 73 → 45. The "existing" item even claims "Read as EXISTING to remain by … the sheet's legend", yet no legend rule exists.

**Fix:** in `finish()`, when `conventionQuestion` would be true, put the existing and demo marks back into install (or make them `unknown`: counted, with the `status:` item). Add a replay case where the mock returns "existing" with no conventions.

### B3. The answer to "How are new vs existing shown?" is never applied on a re-run (A1.4 plumbing)

`routes/preconstruction.ts:1208` reads `takeoff_results.review_items` inside `runPipelineStages`. But `beginAnalysisRun` (`preconstruction.ts:689-700`) has already set `review_items=NULL` in the transaction that starts every re-run. That is Jake's "clean slate" rule, and the comment above it says so.

As a result `priorConventions` is always undefined in production:

- The estimator answers, for example, "Shaded / filled symbols are new… re-run the analysis to apply".
- They re-run, and the same blocking question comes back, forever.
- Every option except "All new" and "Something else" tells the user to re-run.

The replay test passes the answer straight into `runCountingStage`, so it never exercises the route.

**Fix:** persist the answer outside `review_items`, for example `bids.remodel_convention`, or capture it in `beginAnalysisRun` before the reset and pass it along. Add a route-level test: answer → `beginAnalysisRun` → pipeline input has `remodel.answer`.

**Related (should-fix, same area):** after the answer "All devices on these plans are new — count everything", or "Something else — I will correct the counts myself", remodel mode and `statusMode` stay on. The counter can still move marks to existing, and no question is raised any more.

Repro, same Kissimmee replay with `buildType: 'remodel'` and that answer:
- A 73 → 45;
- no blocking item;
- only the non-blocking "90 existing devices… never priced".

Those two answers must switch status splitting off.

### B4. Legend collapse hides evidence-backed zeros (d)

`mentionOf` (`legendUnused.ts:51-65`) matches a tag as a whole word only when it has 2–6 characters. Otherwise it needs half of the description's *distinctive* words. The GENERIC stop-list (`legendUnused.ts:14-18`) removes receptacle, duplex, switch, single, pole, light and fixture.

So a single-letter or `$` legend tag whose description is all generic words ("Single pole switch", "Duplex receptacle") has zero distinctive words and **can never be matched**. It collapses whatever the evidence says. Its COUNT PENDING row is also dropped from Agent 2 (`countingStage.ts` finish, the `unusedTypes` filter), and Agent 1's own row for it was already moved to `removedRows` by the merge.

**Repro** (`legendUnusedKeys` + `evidenceCorpus`):

```
agent1.quantities = [{item:'Single pole switch', qty:16}, {item:'Duplex receptacle 20A', qty:24}]
agent1.panelCircuits = [{panel:'A', circuit:'12,14', description:'EVSE-1'}]
legend targets: S "Single pole switch", DUPLEX "Duplex receptacle", C "EV charger receptacle" (all zero, "not found on any counted plan sheet")
→ [{"key":"S","unused":true},{"key":"DUPLEX","unused":true},{"key":"C","unused":true}]
```

Each of the three has evidence (an Agent 1 qty row, or a panel circuit), and each ends up in the non-blocking "Legend symbols not used on this job". The C / EVSE case is the chargers-style case the plan names: a panel circuit and no symbol. Kissimmee's replay is unaffected only because its charger is an equipment row.

**Fix:**
- Any Agent 1 `quantities` row with qty > 0 in the same category family counts as evidence.
- An all-generic description falls back to matching the full description phrase, not "no words".
- For panel circuits, also match known abbreviations (EV/EVSE/charger, WH/water heater, and so on), or never collapse a type whose category has any panel circuit on the job.
- Add tests with S, DUPLEX and C as above.

---

## Should-fix

### S1. Combined titles make a counted new-work sheet demolition-only (b)

`isDemolitionTitle` matches "ELECTRICAL DEMOLITION AND NEW WORK PLAN" and "DEMO / NEW WORK POWER PLAN". Both are classified `demolition` (not `mixed`), because `otherPlanTitles` excludes any demolition title.

In `prepareRemodel`, a counted sheet whose only title is such a string gets `demolition: true`. That can come from the text layer, the viewport reader, or the title-block fallback `[c.title]`. The sheet is then:
- asked only the DEMO targets;
- dropped from `mergeInputs`;
- turned wholly into Demolition lines.

A text-layer run like "REFER TO ARCHITECTURAL DEMOLITION PLAN FOR EXTENT" also classifies as a whole `demolition` sheet when no other plan-title run is found (probe output: `{"kind":"demolition",…}`).

**Fix:** a title that also says NEW / PROPOSED / REMODEL / RENOVATION → `mixed`. Ignore runs that start with SEE, REFER or REFERENCE. Never turn a sheet selected for install counting into demolition-only without a blocking confirm.

### S2. Demolition de-duplication assumes same page size means aligned drawings (b)

`buildDemolition` (`demolition.ts:127-190`):
- It compares positions whenever the two sheets are the same size, and raises `demodup:` only when the sizes differ.
- An E-sheet demolition viewport and an architectural demolition sheet are nearly always the same page size, but drawn at different placements or scales.

**Repro:** two sheets of 2592×1728 pt, with the same 10 fixtures offset by 900 pt → `{"qty":20,"deduped":0,"questions":0}`. That is a silent double count.

**Fix:** dedup only when the two drawings' viewport rects (or scale and origin) match, or when a meaningful share of marks pair up. Otherwise raise the `demodup:` question, which is what the plan specified: "otherwise raise a review item".

### S3. The "Same as Type X" merge is overwritten by legend group answers (c)

`enforcedCounts` applies `unlisted:` answers before the `legend-zero:` / `legend-unused:` member loop. That loop does `byType.set(m.key, …)` and overwrites the merge.

**Repro:** legend member WL answered count 4, and `unlisted:H` (13) answered "Same as Type WL" → WL = **4** (expected 17). If WL is answered "not on job" → WL = null, and H's 13 disappear without any message.

**Fix:** apply the unlisted merges after every per-type setter, adding onto the final value. When the target type is "not on job", keep the unlisted item open, or blocking, with a message.

### S4. Unlisted-tag guard gaps: blocking noise on every job, new builds included (c)

These are never counted without a human, so this is noise, not wrong counts. Still, each one is a new blocking item on new builds. Repro with `unlistedTagRejection(tag, 'fixture symbol', {panels, targetKeys:{A,B}})` → `null` (accepted) for:

- `A10` / `A20` / `A26` when Agent 1's `panels` is empty. Only `A0x` is caught without a panel list; the 36th circuits A01–A20 are rejected only because panels A and B were read. The `panelCircuits[].circuit` values (36th: A01…A10) are not used as a guard.
- Circuits on panels whose names contain digits: `LP1-5` (panel LP1), `L1-12` (L1), `H1-3` (H1).
- Equipment tags `RTU-1` and `AC1`. The prompt forbids them, but there is no code guard.
- Modifiers `EM`, `WP`, `GFI`, `NL`, and a lone `X`.

`A26,28`, `DISC-A`, room names and numbers, and 3-digit door numbers are correctly rejected.

**Fix:**
- Reject any tag that equals a `panelCircuits` circuit, or `<panel>-<n>` for any panel name.
- Reject tags that match `equipment[].tag` or the `^[A-Z]{2,4}-\d+$` equipment shape.
- Keep a small modifier stop-list (EM, WP, GFI, GFCI, NL, X, E, N, R, D).

### S5. A titles-reader truncation fails the whole run (e)

`titleReader.ts:130,139`: `assertNotTruncated` throws and the catch rethrows `AgentTruncatedError`, which propagates through `prepareRemodel` into `runCountingStage`. Titles are optional input, and losing them only loses a demolition candidate, which is already reported through the `remodel:titles` item.

It matches the evidence-reader policy, but the brief for this round says a titles failure must not fail the run. **Fix:** treat truncation like any other titles error (push to `errors`, continue).

Streaming (`messages.stream().finalMessage()`), `callWithRetry` with the run signal, the cache and effort `low` are all consistent with the evidence readers.

### S6. Cost: no cap on demolition sheets counted (e)

- The titles cap (12) bounds only the *titles* calls.
- Every sheet whose titles classify as demolition then gets a full counter pass plus a consistency pass. No cap applies, and no estimate is logged.
- A multi-floor remodel with 8–10 architectural demolition plans, or a false-positive remodel with a site demolition plan (B1), adds about $0.3–0.5 per sheet unseen.

**Fix:** cap the number of demolition sheets, for example at 4, and put the rest into the `remodel:titles`-style item. Log the added counter calls in the `remodel mode` line.

### S7. A legend type drawn only as existing is mislabelled "not used on this job" (d)

In `finish()`, `legendUnused` is computed while the type's reason is still "not found on any counted plan sheet", before the existing-only loop rewrites that reason. `buildReviewItems` checks `legendUnused` first. So a legend type drawn only as EXISTING goes into "Legend symbols not used on this job… found on no counted sheet", which is false, instead of the "shown only as existing" item.

**Fix:** skip `legendUnused` when `existingMarks > 0`, or compute it after the existing loop.

### S8. Site demolition sheets price as "fluorescent fixture up to 2x4" (b)

On a remodel with site work:
- `DEMO_DISCIPLINES` includes architectural, other and unknown, so a "SITE DEMOLITION PLAN" is counted.
- Site poles have no class of their own. They map to `DEMO-FIXTURE` (0.31 h/E), or to `DEMO-EQUIPMENT`.

**Fix:** skip titles containing SITE, or add a `DEMO-SITE-POLE` class that stays unpriced until B has a unit for it.

---

## (f) Replay honesty

- **Production path: yes.** Both replays drive the real `runCountingStage`, including `prepareRemodel`, `countSheets`, the consistency pass, `finish()` and `buildReviewItems`, with only the Anthropic client faked. The 36th fixture's real and mocked parts are listed accurately in `replay36th.ts`.
- **Not exercised: the route.** `preconstruction.ts:1208`, the `build_type` / prior-answer query, is never run by a test. That is how B3 got through.
- **Tautological mocks.**
  - The no-convention test's mock answers "new" for every mark, so B2 is invisible.
  - The Kissimmee guard's counter mock never returns `unlisted`, so it cannot show new-build blocking noise from A2 (S4). "Kissimmee unchanged" proves only that the code tolerates an empty channel.
  - The demolition numbers are Chris's BOM rows by construction (the report says so).
- **Report inaccuracies.**
  - "A new build … its counter prompt … byte-for-byte as before" is not true. `COUNTER_SYSTEM` changed for every job: the UNLISTED rule and the new output example. The *sheet notes* are unchanged for new builds.
  - "The pipeline reads the resolved answer before the next run's counting" is not true in production (B3).
  - "Counts stay unchanged" under no convention is not true when the model returns existing (B2).
- The tests are gated on `isPdftoppmAvailable()` and silently skip without it. That is acceptable locally, but CI should report the skip.

## What is right

- New/relocated/unknown feed install and existing never does. Demo marks on demolition sheets never feed install; `mergeInputs` excludes demolition sheets, so a failed demolition sheet never makes an install type unreadable.
- `unknown` stays counted, with a blocking `status:` item.
- Outside remodel mode, a status the model volunteers is stripped (`statusMode`).
- `build_type = 'new'` switches everything off; the test passes.
- The unlisted channel never produces marks, a count without a name is refused, the tags are shape-validated, and the per-call cap is 20.
- Unlisted symbol text reaches only the UI. Titles-reader conventions are sanitized before they go into the counter prompt. Counter-read conventions are never fed back into prompts.
- Fixture-schedule targets can never collapse (`source !== 'legend'` → skip). Equipment and panel-circuit categories are skipped.
- Tests run here: `npx vitest run src/ai/remodel/remodel.test.ts src/test/remodel36thReplay.test.ts` gave 33/33 pass on `electrical_crm_test`. The full suites were not re-run.

---

# Addendum: re-check of fix rounds `6500b4a..bc55bc6` (B1–B4, S1–S8, Q1, Q2)

**Reviewer:** Opus 5.5, 2026-09-29. Read-only except this file.

## Verdict: **NOT READY**

**Two blockers remain, both new** (details below):
- N1: a printed-label pattern makes a new build a remodel.
- N2: the Q1 matcher still hides the chargers-style zero.

All twelve original findings are fixed and re-verified with my original scratch repros. I did not finish the check of real new-build sheet text: every new-build electrical PDF under OneDrive/Bids (7-Eleven #10319, #42859, El Car Wash) is cloud-only and timed out on read. So N1 is shown at function level and through the code path, not on a real sheet.

**Tests run:**
- The full backend suite ran once on `electrical_crm_test`: 2465 tests, **2457 passed, 4 failed**. These are the known intakeSimilarCache ×2 and integration lead-backfill flakes, plus `estimatingLibrary` "editing a SEEDED item", which the report says fails the same way on base `7a69928` (test-DB state).
- The remodel tests were part of that run and all passed: `remodel.test.ts`, `remodel36thReplay.test.ts` and `remodelConventionRoute.test.ts`.

## Original findings: re-verified

| # | Repro re-run | Result |
|---|---|---|
| B1 | Kissimmee 9/28 replay, V0.1 → "Boundary & Existing Conditions Survey", `buildType: null`, and again with the counter tagging a third of the marks existing | **Fixed.** No remodel mode, 6 calls, every count equal to baseline (A 73, B 52, GFCI 7). |
| B2 | Kissimmee, `buildType: 'remodel'`, no answer, a third of the marks tagged existing | **Fixed.** All counts equal baseline, ONE blocking question, and the ignored tags are stated in its detail. With the "All new" answer: no question, counts unchanged, no STATUS block. |
| B3 | Code path: resolve → `saveRemodelConvention` (same transaction) → `beginAnalysisRun` → `loadRemodelInput` | **Fixed.** `remodelConventionRoute.test.ts` covers it end to end. See S-new-1 for what remains. |
| B4 | S "Single pole switch" row 16, DUPLEX row 24, C "EV charger receptacle" + EVSE-1 | **Fixed** for these three. N2 is a neighbouring case that still collapses. |
| S1 | "ELECTRICAL DEMOLITION AND NEW WORK PLAN", "DEMO / NEW WORK POWER PLAN", "REFER TO … DEMOLITION PLAN" | **Fixed.** The first two classify as combined / `mixed` and are never demolition-only; the third is `none`. See S-new-3. |
| S2 | Two same-size sheets, the same 10 fixtures offset 900 pt | **Fixed.** Qty 20 **plus a blocking question**, no silent double count. |
| S3 | Legend member WL count 4, then H 13 "Same as Type WL" | **Fixed.** WL = 17. With WL not on the job, `reopenOrphanedMerges` reopens `unlisted:H`, which is blocking again with its earlier answer kept. The same holds for a `count:` not-on-job. |
| S4 | A01, A20, A26,28, LP1-5, L1-12, RTU-1, AC1, EM, WP, X, DISC-A, BREAKROOM, 12 | **Fixed.** All rejected, and **H / H1 / H2 / HB still allowed**. See S-new-2 for the over-reach. |
| S5 | Code: truncation is caught in `titleReader.ts` | **Fixed.** Only `RunCancelledError` propagates. |
| S6 | Code: `MAX_DEMOLITION_SHEETS = 6` | **Fixed.** Sheets over the cap are removed from counting and listed in a blocking `demosheets:cap` item. A failed demolition sheet still gets its blocking `demosheet:` item. The log gives the added counter sheets and titles calls. |
| S7 | Code: `legendUnused` is computed after the existing marks; `existingMarks > 0` never collapses | **Fixed.** |
| S8 | Code: site pole, exterior and J-box classes; only `PRICED_DEMO_CLASSES` become lines, the rest become blocking `demounit:` items | **Fixed.** A counted `demounit:` answer adds a Demolition line. |

Also fixed: the migration 148 authorization matches every other review item (`loadAccessibleBid`). Reopening goes through `applyResolution` with a null resolution and deletes the row. Only a real option is ever stored.

## New blockers

### N1. A printed LABEL on a new-build electrical sheet switches remodel mode on (a)

B1 made "a printed rule on an electrical sheet's text layer" a remodel signal. The counted sheets' text layers are now read before the signal on **every** job with a remodel input (`countingStage.ts` `runCountingStage`, `pre = readSheetTitles(counted)` → `remodelSignal({conventions})`).

But `textConventions` treats any `(E) … EXISTING …`, `(N) NEW …` or `BOLD|HEAVY LINE… NEW` run as a rule. On a new build's site or power plan, these are ordinary labels.

**Repro** (`remodelSignal({ buildType: null, electricalTitles: [{sheet:'E0.1', title:'SITE POWER PLAN'}], conventions: textConventions(note, …) })`):

| Note on E0.1 | Result |
|---|---|
| `"(E) EXISTING UTILITY POLE TO REMAIN"` | remodel: E0.1 prints "(E) EXISTING UTILITY POLE TO REMAIN" |
| `"CONNECT TO (E) EXISTING FPL TRANSFORMER"` | remodel |
| `"(N) NEW 200A SERVICE"` | remodel |
| `"BOLD LINES INDICATE NEW WORK"` | remodel |

Once remodel mode is on (the Kissimmee replay with `buildType: 'remodel'` shows the rest of the chain):
- up to 12 titles calls;
- a plain "Demolition Plan" (Kissimmee D0.1, a site demolition sheet, architectural) is counted as a demolition sheet: +1 counter pass;
- Demolition lines or blocking `demounit:` items appear;
- that sheet's model statuses filter its counts (a rule "exists" for it).

**Not verified on real text:** the 7-Eleven and car-wash sets are cloud-only here. Kissimmee's E-sheets have only about 600 text characters.

**Fix:**
- Accept a printed convention as a signal only when it is legend-shaped: `SYMBOL|SYMBOLS|DEVICES|LINES|ITEMS` + `DENOTES|INDICATES|REPRESENTS|=`, or `(E) =` / `(E) DENOTES` with no noun phrase after EXISTING.
- Never accept `(E) EXISTING <noun>` as a signal. Keep it as a per-sheet rule only once remodel mode is on for another reason.
- Add the four notes above as negative tests.

### N2. The Q1 matcher still hides the chargers-style zero (d)

Q1 requires ALL distinguishing words of a phrase. Non-generic words such as station, electric, vehicle, ratings (20A, 125V) and number words (two, three) become mandatory. Panel-circuit labels are terse.

**Repro** (`legendUnusedKeys` + `evidenceCorpus`, legend category `device`, status zero, "not found on any counted plan sheet"):

| Legend | Evidence | Result |
|---|---|---|
| EV1 "EV charging station" | panel circuit "EV CHARGER" | **unused (collapsed)**: `station` is required |
| C "Electric vehicle charger" | panel circuit "EV CHARGER" | **collapsed**: `electric`, `vehicle` required |
| $3 "Two/three way switch" | Agent 1 row "3-way switch" (qty 4) | **collapsed**: `two`, `three` ≠ `3` |
| AF "Duplex receptacle AFCI" | Agent 1 row "AFCI receptacles" (qty 12) | **collapsed**: `duplex` required |
| D "Duplex receptacle, 20A, 125V" | Agent 1 row "Duplex receptacle 20A" (qty 24) | **collapsed**: `125v` required |

The first two are exactly the case the brief says must never collapse (a panel circuit and no symbol).

**Fix, within the Q1 decision:**
- Treat ratings and numbers (`\d+[av]?`, `nema`, `5-20r`, `2x4`) as non-distinguishing.
- Fold number words (two/three/four → 2/3/4) and "electric vehicle" → ev.
- Add station, connection, outlet, supply and the like to the generic nouns.
- Or: any panel circuit that matches the type's synonym group (ev / evse / charger) on its own is evidence.

Add these five as tests.

## New should-fixes

- **S-new-1: the persisted answer becomes invisible and permanent.**
  - After the re-run that applies it, `remodel:conventions` is no longer generated, so there is nothing to reopen. The only delete path is a reopen of that item, so `bid_remodel_convention` can never be changed or cleared from the UI.
  - The answer also silently applies to later addenda.
  - This matters most for "All new" and "I will correct the counts myself", which turn status reading off for the bid for good.
  - **Fix:** while an answer is stored, emit a non-blocking `remodel:conventions` item showing it as resolved (its reopen deletes the row), or show it on the bid card.
- **S-new-2: the S4 guard now rejects hyphenated and two-digit FIXTURE tags.**
  - `F-1`, `SL-1`, `HB-1`, `EX-1`, `L-2`, `F12` and `D10` are all rejected as "a circuit number (or equipment tag)" by the no-panel-list shape rules.
  - These are common fixture-type spellings, so a missing schedule row for them (the 36th type-H problem) would again go unreported.
  - **Fix:** apply the shape rules only to prefixes that are a known panel name or a circuit letter seen in `panelCircuits`. Otherwise accept the tag, and reject it only when it equals a real circuit or equipment tag. Add F-1, SL-1 and HB-1 as allowed tests.
- **S-new-3: a combined title counts as a status "rule" (B2 principle).** `prepareRemodel` pushes a `source: 'title'` convention for every combined title. So `hasRule` is true and the model's existing/demo tags filter that sheet's counts, although nothing printed says how existing is drawn. It also suppresses the no-convention question. **Fix:** a combined title makes the sheet a status sheet, but splits should still need a printed or answered rule; otherwise raise the question.
- **Note:** Q2 (an explicit "Demolition Plan" title survives a failed titles call) is correct as built. With N1 open, though, it is what turns a new build's site demolition plan into a counted demolition sheet.

---

# Addendum 2: final check of `3210544..ca35a24` (N1, N2, S-new-1..3)

**Reviewer:** Opus 5.5, 2026-09-29. Read-only except this file.

**Tests:** the four remodel files only (`remodel.test.ts`, `remodel36thReplay.test.ts`, `remodelConventionRoute.test.ts`, `remodelNewBuildLabels.test.ts`), on `electrical_crm_test`: **56/56 passing**.

## Verdict: **NOT READY**

There are two blockers:
- **Q-B1:** the new tag-guard "series of 3+" rule rejects a real fixture family. The coordinator defined this case as a blocker.
- **Q-B2:** the builder's "≥200 V stays distinguishing" interpretation hides evidence-backed zeros, including a panel-circuit case.

Everything else checks out.

## Re-verified

| Item | Repro | Result |
|---|---|---|
| N1 | `remodelSignal({buildType:null, electricalTitles:[E0.1 "SITE POWER PLAN", D0.1 "Demolition Plan"]})`. Printed conventions are no longer an input. `remodelNewBuildLabels.test.ts` runs a real text-layer PDF with the four labels, plus a D0.1 site "Demolition Plan", through the counting stage. | **Fixed.** `remodel:false`, no extra calls, D0.1 never counted. The test confirms the labels ARE read as conventions, so it is not vacuous. |
| N2 | The five repros: EV station and electric vehicle charger vs "EV CHARGER", $3 vs "3-way switch", AF vs "AFCI receptacles", D 20A/125V vs "Duplex receptacle 20A". Also the three earlier ones (S, DUPLEX, C/EVSE-1). | **Fixed.** All eight stay review items. |
| S-new-1 | Code and route test | **Fixed.** A stored answer shows as a resolved, non-blocking "New vs existing: … — change". A reopen turns it back into the blocking question and deletes the row in the same transaction. |
| S-new-2 | `unlistedTagRejection` | F-1, SL-1, HB-1, EX-1, L-2, F12 and D10 are allowed. A01 (panel A), A26,28 and LP1-5 (panel LP1) are rejected. H is kept next to the A01/A05/A08 circuits. **But see Q-B1.** |
| S-new-3 | Code (`prepareRemodel`) | **Fixed.** A combined title no longer adds a `source:'title'` convention. |
| Earlier | S2, S3 and reopen-merge repros re-run | Still fixed: 20 plus a question; WL = 17; orphaned merges reopen. |

## The builder's three N2 interpretations

1. **"Duplex" is generic: OK.** It only shrinks what must be named, so fewer types collapse. "Duplex receptacle" is kept by any receptacle row; "Quadplex receptacle" still needs quadplex.
2. **Two/three-way handling: OK.**
   - $3 "Two/three way" is kept by "3-way switch" and by "Three-way switches".
   - $4 "Three/four way" is kept by "4-way switch", "Four way switches" and "3-way / 4-way switches".
   - $4 collapses against a bare "3-way switch" row. That is correct: a 3-way row is not evidence for a 4-way device.
3. **A rating of 200 V or more stays distinguishing: HIDES evidence-backed zeros.** See Q-B2.

## Blockers

### Q-B1. The "series of 3+" rule rejects real fixture families (c)

`aggregateUnlisted` (`unlisted.ts`) builds, per sheet, the letter prefixes that have 3 or more numbered tags among the *reported* tags. It then rejects every such tag as "a circuit series".

**Repro:** `aggregateUnlisted([{ sheetKey: 'E2', items: tags.map(t => ({ tag: t, symbol: '2x4 LED troffer', marks: [{x:1,y:1}] })) }], {panels:['A','B'], targetKeys:{A,B,F1}, …})`:

| Tags on one sheet | Kept | Rejected |
|---|---|---|
| F1, F2, F3 (schedule not read) | none | all three, "a circuit series (F…)" |
| F5, F6, F7 (schedule lists F1–F4) | none | all three |
| SL-1, SL-2, SL-3 (site lights) | none | all three |
| F1 (listed, misreported) + F2 + F3 | none | all three. The listed tag counts toward the series. |
| H + A01, A05, A08 | H | the circuits, by panel name. The series rule is not needed here. |
| F2 alone | F2 | none |

A missing or partial fixture schedule is exactly when unlisted tags matter, and a family of 3+ is common. The 36th type-H problem comes back silently: the rejected tags go only into `unlisted.rejected`, with no item.

**Fix:**
- Drop the series rule; circuits are already caught by panel name, `panelCircuits` and comma lists.
- Or require the series to look like circuits: zero-padded numbers (A01), or numbers well past fixture range (≥ 10), or a symbol description containing "circuit". Never count listed targets toward it.
- Or report a rejected series as ONE non-blocking item ("F1, F2, F3 not in the schedule — circuits or fixture types?").
- Add F1/F2/F3 and SL-1/2/3 as allowed tests.

### Q-B2. "≥200 V is distinguishing" hides evidence-backed zeros (d)

`isRating` keeps `2xx–9xx` + `v` as a required word, so a legend "220V receptacle" needs the exact token `220v`. Using `mentionOf`, a legend zero `{type:'220V', description:'220V receptacle'}` is treated as having **no** evidence (collapsed) against each of these:
- Agent 1 row "208V receptacle";
- Agent 1 row "240V receptacle for ice machine";
- Agent 1 row "Receptacle 208V 1PH";
- Agent 1 row "220 volt receptacle";
- panel circuit "WELDER RECEPT 208V". This is the chargers-style case: a panel circuit and no symbol.

208, 220, 230, 240 and 250 V are one nominal class on these drawings. Kept only by "220V receptacle" verbatim.

**Fix:**
- Fold 208/220/230/240/250 V, and "N volt", into one token (e.g. `hv`); 120/125/277 V stay ratings.
- Add the five rows above as tests.

## Should-fix (not blocking; the same class as N2)

These abbreviations still collapse against evidence:
- S "Single pole switch" vs "Switch, 1-pole 20A";
- OS "Occupancy sensor" vs "Occ sensor";
- J "Junction box" vs "J-box for RTU".

Suggested folds: single ↔ 1-pole / sp, occ → occupancy, j-box → junction box.

WH "Water heater connection" vs "Water htr" is normally an equipment row, which is skipped, so it is not an issue.

---

# Addendum 3: final check of `cadd457..14d7009`

**Reviewer:** Opus 5.5, 2026-09-29. Read-only except this file.

**Tests:** the four remodel files only, on `electrical_crm_test`: **60/60 passing**.

## Verdict: **NOT READY**

One blocker is left: the builder's new rule that drops paired voltages also drops them from device rows, which hides evidence-backed zeros. Everything else is fixed.

## Re-verified

**Q-B1 (fixed).** The series rule is gone.

| Tags on one sheet | Result |
|---|---|
| F1, F2, F3 (F1 listed) | F2 and F3 are items; F1 is rejected as a listed type, which is correct |
| F5, F6, F7 | all three are items |
| SL-1, SL-2, SL-3 | all three are items |
| H + A01, A05, A08 with panel A | H is an item; the circuits are rejected by panel name |

**Q-B2 (fixed for the five rows).** The "220V receptacle" legend zero is kept against:
- "208V receptacle";
- "240V receptacle for ice machine";
- "Receptacle 208V 1PH";
- "220 volt receptacle";
- panel circuit "WELDER RECEPT 208V".

**Abbreviations (fixed).** Each is kept against its evidence row:
- "Single pole switch" vs "Switch, 1-pole 20A";
- "Occupancy sensor" vs "Occ sensor";
- "Junction box" vs "J-box for RTU".

## The builder's extra choices

**1. Only zero-padded tags (A01) count as circuit-like: OK.**
- With no panel read, A01, F01, F02 and X01 go to ONE non-blocking "Possible unlisted tags (rejected as circuit-like)" item. They are not counted, and not dropped silently.
- L1 and LP1-5 stay real items.
- A zero-padded fixture family (F01, F02) is therefore visible but not asked. That is an acceptable trade, since padded fixture tags are rare.
- **Suggestion:** give that item a "count" action, so a real type does not have to be typed into Labor & Pricing by hand.

**2. Voltage pairs (120/208V) are dropped: HIDES evidence-backed zeros (blocker).**

`foldPhrases` removes every `\d{3}(y/|/|y)\d{3}` pair, with or without a unit, from every corpus entry, before the high-voltage fold. That is right for service and panel rows. But on a device row, a pair IS the device voltage. With `mentionOf` and `evidenceCorpus`, these legend zeros count as having **no** evidence (collapsed):

| Legend zero | Evidence | Result |
|---|---|---|
| R "240V receptacle" | Agent 1 row "Range receptacle 120/240V" | COLLAPSED |
| 220V "220V receptacle" | Agent 1 row "Dryer receptacle 120/240V 30A" | COLLAPSED |
| 220V "220V receptacle" | panel circuit "OVEN RECPT 208/240" | COLLAPSED (the chargers-style case) |

**Fix:**
- Drop a pair only when the entry is about the service (it names panel, service, MLO, MCB, feeder, main, PH/phase-with-wire-count or kAIC and no device noun).
- Otherwise fold the pair's higher voltage into `volthigh`.
- Add "recpt" to the receptacle synonyms.
- Add the three rows above as tests. The existing service-row test (`remodel.test.ts:287`) keeps 36th's 220V collapsing.
