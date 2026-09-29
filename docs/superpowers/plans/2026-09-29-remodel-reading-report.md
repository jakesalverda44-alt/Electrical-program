# Remodel round: Builder A report (A1 new/existing/demolition, A2 unscheduled tags, A3 legend noise)

**Branch:** `feat/remodel-reading` (worktree `../Electrical-program-wt-remodel`), off main `7a69928`
**Commits:**
- `d74d019` A1
- `b015daf` A2
- `82edf6d` A3
- `2b3c438` A1 follow-up (demolition line names)
- plus this report

Not pushed.
**Migrations:** none. The reserved slots 148–149 are still free.
**Ground rules:**
- Worktree only; Local Version untouched; no dev servers.
- Tests ran on `electrical_crm_test`; the live DB was never touched.
- Every model call is mocked.
- The Agent tool was not used.

## What was built

### A1: new / existing / demolition (accuracy-critical)

**Remodel mode** switches on only when there is a remodel signal (`ai/remodel/status.ts` `remodelSignal`). A new build never enters it, so its per-sheet counter notes, marks and counts are as before. **Correction (review 6500b4a):** the counter's SYSTEM prompt did change for every job (A2's unlisted rule); see "What changed for new builds" in the fix round below. **Superseded by fix B1:** the signals below were too broad. The original signals were:
- the bid's build type: `new` forces remodel mode off; `remodel` or `tenant` turns it on;
- a sheet title that says ALTERATIONS / EXISTING / RENOVATION / REMODEL;
- the drawing analysis's own words: remodel, renovation, alteration, tenant improvement / build-out, interior build-out, change of occupancy, or existing building / shell / suite.

The word "demolition" alone never counts. Kissimmee has a site demolition plan (D0.1) and the note "confirm demo of existing electrical is by sitework sub", and it must stay a new build. A test on the real Kissimmee 9/24 and 9/28 exports proves it does.

**Conventions (A1.1 / A1.2).** In remodel mode, every counted sheet's counter call gets a STATUS block:
- The counter reads the sheet's legend and notes at full resolution. It returns each printed rule as `conventions: [{status, rule, quote}]`, which is stored with its sheet and quote in `count_result.remodel.conventions`.
- Every mark gets a sixth element: `new | existing | demo | relocated | unknown`.
- Rules known before counting are passed in as KNOWN RULES. They come from a sheet's text layer (a regex reader, no model call) or from the estimator's answer on a re-run.

I chose to have the counter read the conventions itself, rather than Agent 1 or a separate reader. On a scanned set like 36th Street, the legend text is about 4 px tall in an overview image. The counter already sees it at 300 DPI and costs no extra call.

**How each status is used:**

| Status | What happens |
|---|---|
| new | Counts toward install lines. |
| relocated | Counts toward install lines. |
| existing | Moves to `statusMarks`. Never priced. Listed in a non-blocking "N existing devices shown on the plans — listed, never priced" item. |
| demo | Goes to the Demolition lines. |
| unknown | Stays **counted** (a count is never lowered silently) and raises a blocking `status:<type>` item: "N of M could not be told new or existing". The answer is enforced in `enforcedCounts`. |

- A type drawn only as existing (36th Street: GFI, 42) is no longer "not found on any counted sheet". It becomes a non-blocking `count:<type>` item and no longer produces a 0-qty "COUNT PENDING" row.
- Outside remodel mode, any status the model volunteers is stripped (`statusMode`).

**Demolition sheets (A1.3).** Candidates are plan-class sheets of any electrical, architectural, other or unknown discipline, whether or not they are included in the analysis. Their **drawing titles** decide:
- Where the sheet has a text layer, the titles come from it (no call).
- On counted sheets, the viewport reader's titles are used.
- Otherwise it takes ONE cheap vision call per scanned candidate (`SHEET_TITLES_SYSTEM`, evidence model, cached, capped at 12 per run).

This was necessary because 36th Street's A2.0 and A3.0 read "Interior Build-Out Floor Plan" in the title block. Only the drawing titles say "EXISTING FLOOR PLAN - DEMOLITIONS". Civil, structural, mechanical and plumbing plans are not read.

- **Whole demolition sheet:** every plan title on the sheet is a demolition title. The sheet is counted for demolition only. Its targets are the job's fixture-schedule and legend types plus generic removal classes (`DEMO-FIXTURE`, `DEMO-HIGHBAY`, `DEMO-EXIT`, …); other sheets never see those classes. Every mark is `demo`. The sheet never feeds an install count, and a failed demolition sheet never makes an install type "unreadable".
- **Mixed sheet:** a demolition drawing beside a new-work drawing on a counted sheet. The marks inside the demolition viewport move to demo.

**De-duplication.** Across two same-size sheets (A2.0 floor plan and A3.0 ceiling plan), marks of the same class within 0.5" are counted once. When two sheets can't be compared by position, the class raises a blocking `demodup:` question ("same items or more?") and the line carries the sum in the meantime.

**No convention found (A1.4).** ONE blocking item: "How are new vs existing devices shown on these plans?" It has 5 options. **Correction (review 6500b4a):** as first built, counts could drop when the model tagged marks existing without a rule (fixed in B2), and the answer was never applied, because the re-run wiped it before it was read (fixed in B3).

**Demolition lines (A1.5).** They are added to the drawing analysis's quantities as counted rows (`category: 'Demolition'`, `countedBy: 'counter'`, `countType: DEMO-*`). Each row's spec gives the evidence: sheets, per-type counts, and how many were de-duplicated. Agent 2 copies counted rows; its TAKEOFF CATEGORIES now list "Demolition".

The line names are Builder B's seeded unit names. I checked this read-only against B's mapper and seed (`1737cb8`); all six map **exact**:
- Demolition — fluorescent fixture up to 2x4
- Demolition — HID high bay fixture
- Demolition — exit/emergency light
- Demolition — receptacle
- Demolition — single-pole switch
- Demolition — 3-way switch

A non-blocking "Demolition counted on …" item summarizes them.

### A2: unscheduled tags

- The counter has a new `unlisted` channel for tagged fixture or device symbols that are not count targets: `{tag, symbol, marks: [[tile, x, y]]}`. These are never marks, and the hard rejection is kept for marks.
- They are de-duplicated across tiles like marks.
- A guard (`remodel/unlisted.ts`) drops tags that are never fixture tags: circuit numbers (A01, A-5, a panel name followed by a number), room names and numbers, keyed-note numbers, door tags, listed types and status markers. It is tested with real 36th Street tags.
- ONE blocking item per tag: "Type H drawn 13× on E2.0 — not in the fixture schedule. What is it?". The count is a **SUGGESTION ONLY**. The estimator can:
  - **Name and count it:** it becomes its own line. A count without a name is refused.
  - **Answer "Same as Type X":** the suggested count is added to X.
  - **Mark it not on this job.**
- Agent 1's own `unscheduled:` row for the same tag is folded into this item (no second item).
- This applies to **every job**, new builds included.

### A3: legend noise

A zero-count **legend** type with no other evidence collapses into ONE non-blocking, expandable group: "Legend symbols not used on this job (N)". Each member can still be answered, and answers are enforced like legend-zero. Evidence means any of:
- a panel circuit, schedule row or equipment row;
- excluded marks or a furnish statement;
- a mention in the drawing analysis: the tag as a word, or at least half of the description's distinctive words in one entry.

What does not change:
- The type's 0-qty "COUNT PENDING" row no longer reaches Agent 2.
- Fixture-schedule zeros and zeros with evidence stay review items exactly as before.
- It is switched by the evidence round, so a legacy run without it is unchanged; the existing "evidence round off" baseline test still passes.
- The Kissimmee chargers-style case (a panel circuit with no symbol) is equipment or has evidence, so it is untouched.

## Kissimmee 9/28 replay diff (`src/test/remodel36thReplay.test.ts`, run with the remodel input passed)

- **Counts, statuses and model calls:** identical. Every type's count and status is unchanged, the 6 model calls are unchanged, remodel mode is off, and there are no unlisted tags.
- **Review items:** every item is identical except the legend grouping. The list goes from 22 to 23 items:
  - Before: `legend-zero:AUTOMATIC-LIGHTING-CONTROL-ALARM-INTERFACE-MODULE-6-E6-DUPLE`, 10 members, blocking.
  - After: `legend-zero:DUPLEX-RECEPTACLE-IN-SHALLOW-2X4-HANDY-BOX-EM-EXIT-EXT-EM-M2`, 9 members, still blocking.
  - After, new: `legend-unused:AUTOMATIC-LIGHTING-CONTROL-ALARM-INTERFACE-MODULE-6-E6`, 1 member (the alarm interface module), **non-blocking**.
  - The other 9 stay because they have evidence: EXIT, EM and EXT EM are fixture-schedule rows, and Quad, T, the pushbutton and the others are mentioned in the analysis. This is the "~0 on Kissimmee" the plan expected.
- The group id changes because it is built from its members. On an existing Kissimmee bid, the old group's answers will not carry over; that is a one-time re-answer.
- The pre-round review list is committed as `fixtures/realrun/kissimmee-0928-review-before-remodel.json`, and the test compares against it.

## 36th Street replay (real export; model answers mocked; `replay36th.ts` says which)

| | Live run 9/29 | Replayed now |
|---|---|---|
| Model calls | E1.0 and E2.0 counter | counter on E1.0, E2.0, A2.0 and A3.0, plus 4 titles calls (A1.0, A2.0, A3.0, A6.0) |
| Receptacles counted | 26 (duplex 14, 42" 3, GFI 7, WP 2) | duplex 5 + WP GFI 2 new; 19 existing listed and not priced |
| A / B / E2 / G / $ / $3 | 14 / 2 / 3 / 8 / 9 / 6 | unchanged |
| Demolition lines | none | 52 fixture, 2 HID, 2 exit/em (drawn on both sheets, counted once), 18 receptacle, 6 single-pole, 2 3-way |
| Type H | Agent 1 flag + `unscheduled:` row | ONE blocking "Type H drawn 13× on E2.0 — not in the fixture schedule. What is it?"; A01 / A05 / BREAKROOM / 12 dropped; "Same as Type A" → A 27; named count → its own line |
| Legend noise | 12 blocking legend items | $4, $D, 220V, AF, fourplex → "Legend symbols not used on this job (5)" (info); OS, TC, S + C, D, E1, E3 stay blocking |

**What is mocked, and why this proves plumbing, not model accuracy:**
- The statuses: 5 of the 14 duplex marks and 2 WP are answered "new"; the rest "existing".
- The unlisted H marks.
- The drawing titles.
- The demolition-sheet counts. These are Chris's BOM rows by construction, so the demolition numbers only show the path from counter reply to takeoff line.

## What the live 36th Street re-run should show (the real test of A1 / A2)

1. **Remodel mode fires.** The log line `[counting] remodel mode` should give its reason: the project name "…Interior Build-Out", or "Existing building alteration". It should list demolition sheets `A2.0 "EXISTING FLOOR PLAN - DEMOLITIONS"` and `A3.0 "EXISTING REFLECTIVE CEILING PLAN - DEMOLITIONS"`. If it doesn't, the titles reader missed them: check `count_result.remodel.titleReads.pages`.
2. **Model calls:**
   - 4 small titles calls (evidence model; A1.0, A2.0, A3.0, A6.0).
   - Counter calls on E1.0, E2.0, A2.0 and A3.0, plus any consistency or retry calls.
   - Expect roughly +$0.5–1.0 over the 9/29 run's $2.37, mostly the two extra counter sheets.
3. **E1.0's rule is read.** `count_result.remodel.conventions` should hold a quote like "SHADED SYMBOL DENOTES NEW RECEPTACLE" from E1.0.
   - If it is empty, the blocking "How are new vs existing devices shown on these plans?" appears instead and the counts stay as today. Answer "Shaded / filled symbols are new…" and re-run.
4. **Receptacles.**
   - Expected: about 5 new duplex + 2 GFCI (Chris), against the live run's 26.
   - The rest go into the info item "N existing devices shown on the plans — listed, never priced".
   - GFI and 42 may show as info "shown only as existing".
   - Any `status:<type>` item means the counter marked some symbols "unknown": they are counted until answered.
5. **Demolition lines** in the Agent 2 takeoff under **Demolition**, near Chris's figures:
   - 52 fluorescent up to 2x4
   - 2 HID high bay
   - 2 exit/em
   - 18 receptacles
   - 6 single-pole + 2 3-way switches

   Each should map "exact" to B's units. A `demodup:` question should NOT appear: the two sheets are the same size.
6. **Type H** appears as ONE blocking item, "Type H drawn ~13× on E2.0 — not in the fixture schedule. What is it?". No A01 / A05 / room-name items should appear. Answering it adds the fixtures to the takeoff.
7. **Legend noise:** a non-blocking "Legend symbols not used on this job (5)" holding $4, $D, 220V, AF and fourplex. The blocking legend group keeps OS, TC, S (+ C, D, E1, E3 if still 0).

**Risks that only the live run can show:**
- the counter may miss or misread the shading rule, or mark many symbols "unknown";
- the architectural demolition sheets are busy (walls, keyed notes), so over- or under-counting is possible;
- the counter may count "H" as type A instead of reporting it.

## Tests

- **Backend full suite** (`npm test`, electrical_crm_test), once at the end: 2446 tests, **2436 passed, 6 failed**. Re-run in isolation:
  - known flakes: intakeSimilarCache ×2 (fail even alone); integration lead-backfill (passes alone);
  - load flakes: estimatingMarkups linear rounding, intakeSimilar.route timeout, typicalAssignRoute "bare confirm" ("socket hang up" / "worker exited" under load). All three pass alone: 35/35.
- **Frontend full suite** (`npx vitest run`): **1352 / 1352 passed**, 131 files.
- **New tests:**
  - `src/ai/remodel/remodel.test.ts`: 21 tests. Statuses, the remodel signal on real 36th and Kissimmee data, titles, demolition classes on real 36th types, dedup and questions, the unlisted guard with real tags, counter reply parse and split, and A3 on real 36th data. Also mixed sheets, unknown statuses and demolition questions through `remodelItems` / `enforcedCounts`.
  - `src/test/remodel36thReplay.test.ts`: 12 tests. The 36th Street replay (A1–A3, the no-convention question and its answer on re-run, build type new = off) and the Kissimmee 9/28 guard.
  - Frontend: 1 test for the group titles and for an unlisted count sent with its name.
  - The intermediate commits (A1-only, A1+A2) were each type-checked and their key tests run green.
  - The last commit (`2b3c438`, names only) was verified with the remodel tests (33 / 33) after the full runs.

## Shared-file edits (minimal, additive; none of B's files)

- `ai/prompts.ts`:
  - COUNTER_SYSTEM: the unlisted rule, the output shape, and the sixth element "only when asked". The "counting symbols on ONE electrical plan sheet" phrase the fakes key on is kept.
  - AGENT2: "Demolition" added to TAKEOFF CATEGORIES.
  - New: `SHEET_TITLES_SYSTEM` and `REMODEL_PROMPT_VERSION`.
- `ai/reviewItems.ts`:
  - new items: `remodel:*`, `status:*`, `demodup:*`, `demosheet:*`, `unlisted:*`, `legend-unused:*`;
  - `groupOf` and `riskRank` entries;
  - `validateResolution`: an unlisted count needs a name;
  - `enforcedCounts`: `status:`, `unlisted:` and `legend-unused` members;
  - Agent 4 text for "answer" on non-area items.
- `ai/countMerge.ts`: two optional fields on the type result (`legendUnused`, `existingMarks`).
- `ai/countSheets.ts`: two optional fields on `CountSheet` (`demolition`, `demolitionTitles`).
- `ai/counter.ts`: status parse, conventions, the unlisted channel, `statusMode`, `splitByStatus`, and `targetsForSheet` for demolition sheets.
- `ai/countingStage.ts`: the remodel input, `prepareRemodel`, and `finish()` integration.
- `routes/preconstruction.ts`: one query. It reads `bids.build_type` and the prior `remodel:conventions` answer, and passes them as `remodel`.
- `estimating/takeoffReview.ts`: one condition, so `legend-unused:` resolves member by member like `legend-zero:`.
- `frontend/.../TakeoffReviewPanel.tsx`: group titles and order; the count button sends the reason (the name); a placeholder.
- `test/fixtures/realrun/replay0928.ts`: an optional `remodel` parameter.

## Open questions

1. **Unknown statuses** are counted as new, with a blocking item. The alternative is to exclude them until answered, but that would lower a count before anyone confirms it. Is that the right default?
2. **Existing-only types** (all marks existing) are information, not blocking. Should they block instead?
3. **Title reading** costs one call per scanned candidate plan sheet on remodel jobs (electrical, architectural, other and unknown disciplines, capped at 12). Is the discipline scope right? A mechanical or plumbing demolition plan is not read.
4. **Review answers and estimating lines.** Answers to `demodup:`, `status:` and `unlisted:` reach the proposal through `enforcedCounts` and the Agent 4 block. The Estimating (est) lines only change on a re-sync or edit. Demolition classes are not count types, so `enforceCountsOnTakeoff` ignores a `demodup:` answer and only the Agent 4 text carries it.
5. **Plans-view markers:** demolition marks and unlisted marks are stored with positions (`count_result.remodel.demolition.marks`, `count_result.unlisted.tags[].marks`), but they are not yet written as Plans-view markers. Follow-up?
6. **Three extra demolition classes** have no seeded unit in B's library, so they fuzzy-map: lighting control, device (other), and equipment connection / disconnect. B should add units, or these can be folded into the junction box / switch units.
7. **The A2 counter prompt applies to every job.** New builds may now surface `unlisted:` items too (by design).
8. **Build type source:** remodel mode reads `bids.build_type` (the card), not an unaccepted job-profile suggestion.

---

## Fix round: review 6500b4a (NOT READY) → the coordinator's decisions

**Commits:** `31511ca..702e443`, one commit per fix, plus this report update.

Every reviewer repro is now a test. Each one runs through the real `runCountingStage` with the fake client, or through the real review route, as the reviewer did. The replays are the 36th Street export and Kissimmee 9/28. **Migration used:** 148 (`bid_remodel_convention`); 149 is still free.

### Blockers

**B1 (`31511ca`): remodel signal.** Remodel mode turns on ONLY from:
1. the bid's build type remodel or tenant (`new` switches it off);
2. an ELECTRICAL plan sheet's title, or a drawing title on a counted electrical sheet (viewport reader or text layer), saying ALTERATIONS / RENOVATION / REMODEL or EXISTING … DEMOLITION|REMOVAL; titles with SITE / SURVEY / CIVIL / UTILITY / GRADING / CONDITIONS never count;
3. a printed status rule on an electrical sheet's text layer, read before the signal with no model call;
4. the estimator's persisted answer.

Free text from the drawing analysis, and spec, survey and architectural pages, are never signals. 36th Street still enters remodel mode through E1.0 / E2.0's "ELECTRICAL POWER PLAN - ALTERATIONS".

*Test:* the reviewer's Kissimmee repro. V0.1 renamed to "Boundary & Existing Conditions Survey", plus the site demolition plan D0.1, plus a counter tagging every 3rd mark existing. Result: no remodel mode, 6 calls, every count identical. The reviewer's title table is also covered.

**B2 (`c5d30d5`): statuses need a rule.** A counted sheet's mark statuses are applied (in `finish()`) only where a rule with evidence exists:
- the counter's printed quote;
- the text layer;
- a combined title (S1);
- the estimator's chosen convention.

Otherwise every mark counts as new, whatever the model tagged. The question then says how many tags were ignored. The answers "all new" and "I will correct the counts myself" switch status asking off entirely.

*Tests:* the 36th replay's no-rule mock now tags every 3rd mark existing, so it is no longer tautological, and every count equals the base run. Kissimmee with build type remodel and the same tagging: all counts unchanged and ONE blocking question. With "all new": no STATUS block and no question.

**B3 (`52c0e0e`): the answer survives the re-run.** The answer now lives in `bid_remodel_convention` (migration 148):
- the review-resolve route writes it, in its own transaction;
- reopening the item deletes it;
- only a real option is ever stored;
- the pipeline's `loadRemodelInput` reads it.

*Test:* real resolve route → `beginAnalysisRun` (review_items is NULL afterwards) → loader → counting stage. The rule reaches the counter as a KNOWN RULE, the question does not come back, and a reopen removes the answer.

**B4 (`1f778e4`): legend collapse.** A legend zero collapses only when:
- it has no marks (counted, excluded or existing);
- it has no schedule row;
- nothing on the job names its tag or ANY significant word of its description. "Nothing" means any Agent 1 row (any qty), panel circuit, note, flag, furnish statement, equipment row or schedule cell. Words are normalized with synonyms: EV / EVSE / charger, receptacle / recept / outlet, switch / SW.

A one-letter or `$` tag is never matched on its own; its description decides. Placeholder rows stay whenever the item stays.

*Tests:* the reviewer's three repros (S, DUPLEX, C with EVSE-1) all stay. **Effect:** on 36th Street and Kissimmee nothing collapses any more; every legend zero shares a word such as switch, receptacle, lighting or control with some row. A3 is now effectively dormant on both real jobs.

### Should-fixes

| Fix | Commit | What changed | Test |
|---|---|---|---|
| S1 combined titles | `d23a5c3` | "…DEMOLITION AND NEW WORK PLAN" / "DEMO / NEW WORK…" is counted for both, with status per mark. The title is the sheet's rule, and the sheet never becomes demo-only. Runs starting SEE / REFER / REFERENCE are never titles. | 36th replay with E1.0 retitled: STATUS block, not DEMOLITION SHEET |
| S2 demolition de-duplication | `bbcde8e` | De-duplication only between REGISTERED sheets: same size AND shared-class marks pair up (≥2 pairs, ≥60% of the smaller side). Otherwise ONE blocking question with both counts. | reviewer repro (10 fixtures offset 900 pt → 20 + question); stage: A3.0 exits shifted 300 pt → question |
| S3 same-as merge | `355da54` | Unlisted merges are applied LAST and add onto X's final value. If X is not on the job, the unlisted item reopens (blocking, earlier answer shown), both in the route and in the re-run carry-over. | 36th replay items (C 4 + H 13 → 17; C not on job → H reopens); real route |
| S4 tag guard | `41734f4` | Rejected with no panel list: LP1-5 / L1-12 / H1-3 / A-5 / A26,28 / A10…A26 shapes, Agent 1 panel-circuit numbers, Agent 1 equipment tags (RTU-1, AC1, F2), and EM / WP / GFI / GFCI / X / TYP / NL. H stays allowed. | reviewer tokens; stage: 36th counter also reports LP1-5, A26, RTU-1, F2, EM, X, all rejected |
| S5 titles truncation / failure | `9bbb4ff` | A truncation or failure is recorded; the sheet is treated as NOT demolition (non-blocking note). Only a stop fails the run. | stage: A2.0's titles call returns max_tokens; the run completes |
| S6 demolition cost cap | `286c6b0` | At most 6 demolition sheets are fully counted per run. The rest go in ONE blocking item. The log line gives the added counter sheets and titles calls. | stage: 10 demolition sheets → 6 counted, 4 listed |
| S7 existing-only label | `1321890` | The label now reads "shown as existing only — not priced (N on the counted sheets)". This is information, never "not used on this job". | 36th GFI / 42 |
| S8 demolition classes | `702e443` | New classes: site pole light, building-mounted exterior fixture, junction box (B's unit). Only classes with a seeded unit become lines. Site pole / exterior / control / device / equipment → ONE blocking "no demolition labor unit" item; the estimator's count adds a Demolition line. Never a wrong unit. | classes; stage: 3 site poles → no line, one item, answer → line |

### What changed for new builds (correcting the report)

- **The counter's system prompt changed for every job.** It now has the UNLISTED TAGS rule, a new output example containing `"unlisted"`, and the sentence "only when the sheet's instructions ask for STATUS, a sixth element…". The reply parser accepts `unlisted` and `conventions`.
- **Unlisted tags** (A2) can produce blocking `unlisted:` items on any job, new builds included, now with the S4 guard.
- **Model statuses on new builds:** any status the model volunteers is stripped (no remodel mode), so counts are unaffected.
- **Agent 2's prompt** lists "Demolition" among its takeoff categories.
- **The A3 legend collapse** applies to any job with the evidence round, but after B4 it is dormant on both real jobs.
- **Remodel only:** the per-sheet STATUS / DEMOLITION notes, the titles calls and the demolition-sheet counting happen only in remodel mode, which a new build never enters.

### Kissimmee 9/28 replay diff (after the fix round)

Every count and every status are identical, as are the 6 model calls, with no remodel mode. The **whole review list is identical** to the pre-round list (`fixtures/realrun/kissimmee-0928-review-before-remodel.json`). The one legend symbol that collapsed before no longer does (B4).

### Live 36th Street re-run: what changes from the section above

- Remodel mode is justified by the E-sheets' "…PLAN - ALTERATIONS" drawing titles, not by the analysis text.
- If E1.0's shading rule is NOT read, receptacle counts stay as today (26) and ONE question appears. Answering it persists; re-running applies it.
- Legend noise: no collapsed group. $4, $D, 220V, AF and fourplex stay in the blocking legend group with OS, TC and S.
- The demolition lines are as before. Site poles or other unpriced demolition items (if any) arrive as blocking "no demolition labor unit" items.

### Tests (fix round)

- **Backend full suite, once:** 2464 tests, **2456 passed, 4 failed**:
  - intakeSimilarCache ×2 and integration lead-backfill: the known flakes.
  - `estimatingLibrary` "editing a SEEDED item": fails identically on base `7a69928` against the shared `electrical_crm_test` DB. There are no `source='seed'` library items in the DB right now, which is test-DB state, not this branch.
- **Frontend full suite:** 1352 / 1352.
- **Remodel tests:** `remodel.test.ts` 28, `remodel36thReplay.test.ts` 20, `remodelConventionRoute.test.ts` 3 (51 in all, all passing), and the frontend panel test.

### Open questions (updated)

1. **B4 makes A3 dormant on both real jobs.** Every master-legend line shares a device noun with some row. Should device nouns (receptacle, switch) be allowed to match only together with a second word? Either way, the decision as given is implemented.
2. **S5:** a sheet whose titles call failed is not demolition, even if its title-block title says "DEMOLITION PLAN". Should an explicit inventory title still count?
3. **Unpriced demolition classes** (site pole, exterior fixture, control, device, equipment) need units from B before they can be lines automatically.
4. **Still open from the first report:** demolition and unlisted marks are not written as Plans-view markers, and `demodup:` answers reach the proposal only through the Agent 4 text.

---

## Decisions Q1 / Q2 (coordinator)

**Commits:** `45dfd14` (Q1) and `b278866` (Q2), plus this report update.

### Q1: legend evidence means the tag, or ALL distinguishing words

A mention counts as evidence only in two cases:
- it names the tag (2+ characters, never a one-letter or `$` tag);
- it names ALL the distinguishing words of the description, in one entry.

The details:
- **Generic nouns never count on their own:** receptacle / recept / outlet, switch / SW, light, fixture, luminaire, box, device, unit, mounted.
- **No distinguishing word:** a description with none is kept by any mention of its generic noun.
- **Alternatives:** descriptions like "Time clock / VP24 timer switch" match on either alternative.
- **Same test everywhere:** panel circuits, notes and Agent 1 rows use it, with the synonyms folded (EV / EVSE / charger).
- **Reviewer repros:** all three stay review items: S "Single pole switch" (row 16), DUPLEX "Duplex receptacle" (row 24), and the EV charger with EVSE-1.

**Collapsed ("Legend symbols not used on this job"), before and after:**

| Job | Before the round (live) | A3 as first built (`82edf6d`) | After B4 (`1f778e4`) | **Now (Q1)** |
|---|---|---|---|---|
| 36th Street | none (12 blocking legend items) | $4, $D, 220V, AF, fourplex | none | **$4 "Three/four way switch", $D "Single pole dimmer switch", 220V "220V receptacle", AF "Duplex receptacle AFCI", fourplex "Fourplex receptacle"** |
| Kissimmee 9/28 | none | Automatic lighting control alarm interface module (6/E6) | none | **Automatic lighting control alarm interface module (6/E6)** |

**36th Street, what stays blocking:** OS, TC and S keep their real evidence:
- OS: "Occupancy sensor Hubbell…";
- TC: "…timer switch Leviton VP24", through the VP24 alternative;
- S: "Smoke detector 120V circuit".

They stay in the blocking legend group with the fixture-schedule zeros C, D, E1 and E3, and keep their placeholder rows.

**Kissimmee:** every other item is identical to the pre-round list. The blocking group keeps its 9 members: Duplex receptacle in shallow 2x4 handy box, EM, EXIT, EXT EM, M2, N, Quad, Store open/close pushbutton, and T.

### Q2: an explicit DEMOLITION title survives a failed titles call

When a candidate's titles call fails or is truncated, the sheet is still a demolition sheet if its sheet-check or title-block title itself says DEMOLITION. This applies to electrical or architectural sheets only, never to a SITE or CIVIL title. The non-blocking "not checked" note still appears.

*Test:* in the 36th replay, A2.0's titles call is truncated:
- titled "Existing Floor Plan - Demolitions", it is counted (18 receptacles and so on);
- titled "Site Demolition Plan", it is not.

### Follow-ups (Q3 / Q4, not done in this round)

- **Q3:** the demolition classes with no seeded labor unit (site pole light, building-mounted exterior fixture, lighting-control device, other device, equipment connection / disconnect) need units from Builder B. Until then, each is a blocking "no demolition labor unit" item.
- **Q4:** demolition marks and unlisted-tag marks are stored with positions but not yet written as Plans-view markers. `demodup:` answers reach the proposal only through the Agent 4 text, not through `enforceCountsOnTakeoff`.

### Tests

The relevant tests only: `remodel.test.ts` 28 and `remodel36thReplay.test.ts` 21, all passing.
