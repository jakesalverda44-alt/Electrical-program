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
