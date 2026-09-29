# Typical-expansion fix: untyped power poles (AutoZone #10077 Kissimmee, live run 2026-09-28)

Branch `fix/typical-expansion`, off `main` a62bf7e. Commits:

| Commit | What |
|---|---|
| 242a504 | test: the 2026-09-28 live run as a fixture, plus a replay harness (the baseline, before the fix) |
| 37c3655 | fix(typicals): the legend multiplier is bound per host TYPE, never the shared host count; a guard |
| bde9f41 | feat(review): one blocking "assign a type to each pole" item, resolved type by type |
| (this report) | docs |

No migration was needed. No model was called: this is a free replay.

## 1. The bug

- The live run read all six E-2 power poles as ONE equipment row: `PP-1..6`, 6 counted tags.
- The poles are not typed on the plan.
- All five `#9 POWER POLE LEGEND` packages bound to that one host:
  - office: 2 duplex + floor simplex;
  - checkout: 1 duplex;
  - parts pod: 1 duplex;
  - test station: 1 simplex + 1 duplex;
  - commercial counter: 2 duplex.
- `expandTypicals` then multiplied EACH package by the same `hostCount` of 6. That added 42 duplex and 5 simplex.

The earlier run (2026-09-24) did not show this. There, Agent 1 split the poles into PP#1..PP#6, the tags were bound by circuit, and each package had its own host.

## 2. The fix

### Binding per host type (`backend/src/ai/evidence/typicals.ts`)

- **Shared host.** `sharedHostTypes` finds one host target that carries 2+ distinct legend types.
  - A type is identified by its tag, or else by its host words.
  - Assemblies (the baseflex) and packages with no stated quantity are left out.
- **Identifying each host's type.** `identifyHostTypes` tries these sources in order:
  - **(a) Tag per marker.** Every host mark carries a tag, so each type counts only the marks with its tag. `HostMark.tag` is passed through from `countMerge` when the counter reports one.
  - **(b) Schedule or note.** A schedule row (the evidence tables, excluding panel and fixture schedules) maps hosts to types, and the mapped counts add up to the host count exactly.
    - `allocateFromText` requires every listed item to match exactly one type.
    - "counter" alone, which matches both checkout counter and commercial counter, returns null.
  - **(c) One-to-one legend.** There are as many hosts as legend entries, and there is one entry per host tag in the host's own tag range (`hostTagRange`: "PP-1..6", "#1-#6").
    - Kissimmee does not qualify: tags 1, 2, 3, 4, 6 against a range of 1..6.
- **Bound hosts.** Each type expands by its own count, and `binding` records the source.
  - With tags, devices drawn at a type's own hosts are subtracted as before.
  - With (b) or (c), the source does not say which host is which. A device drawn at a host is therefore asked about (`possibleAtHosts`), never subtracted.
- **Unidentified hosts.**
  - Every stated device gets the new status `host_unassigned` and adds 0.
  - One `HostAssignmentGroup` is emitted. It holds each type's outlet package and the devices drawn near some host (which host is unknown).
  - It also holds a **suggestion that is never counted**:
    - the host target's own note, when it maps hosts to types (AI-read, and labeled that way);
    - otherwise one of each type, with the extra hosts left to ask;
    - no suggestion when there are fewer hosts than types.
- **No host count at all.** Unchanged: each package asks for its own count (`no_multiplier`).

### The guard (item 3)

- `guardSharedHostCounts` runs on every result of `expandTypicals`.
- Suppose 'expanded' entries of 2+ distinct host types sit on one host key, and any of them is not bound per type. All of them become `host_unassigned` with 0 added.
- Tested on its own, both ways.

### The review item (`backend/src/ai/reviewItems.ts`)

- There is ONE blocking item per group. Its id is `typicalassign:<hostKey>`, it sits in group `typical`, and it has the same risk rank as the other typical multipliers.
- **Title:** "6 power poles, 5 power pole types in #9 POWER POLE LEGEND — assign a type to each power pole".
- **Detail:**
  - each type's outlet package;
  - "SUGGESTION ONLY — not counted: office 1, checkout 1, parts pod 2, test station 1, commercial counter 1 — from the drawing analysis's note '(6) power poles #1-#6 (office, checkout, 2 parts pods, tester, commercial counter)…' (AI-read, not a schedule)";
  - the 1 simplex drawn within 0.75" of some pole, with nothing subtracted.
- **Members.** The item has one member per type, in `reconcileMembers`. The review panel already renders these member by member, so no frontend change was needed. Each member takes:
  - a **count** of hosts of that type; or
  - **confirm** ("keep current count 0", with a reason) = none of that type.
- The item closes only when every type has an answer.

### Resolution flow

- The existing flow did not support this item, so I added a minimal handler.
- `takeoffReview.ts` routes `typicalassign:` through the per-member reconcile branch:
  - a count without `memberKey` is refused (400, never one number for every type);
  - an unknown type returns 404;
  - `not_on_job` is refused;
  - the gap-fill markup delete is skipped.
- `enforcedCounts` adds perHost × answered hosts for each answered type. A device type marked not on this job stays off.
- `carryOverResolutions` carries the member answers to a re-run when the fingerprint is unchanged (same host count, same packages).
- `countMerge` also adds a flag: "6 power poles, 5 power pole types … Needs review."

## 3. Replay (item 5): what could and could not be replayed

`backend/src/test/kissimmeeLive0928Replay.test.ts` runs the whole `runCountingStage` and then `buildReviewItems` on the 2026-09-28 export. It reuses the replay harness from the real-run fix round (`fixtures/realrun/replay.ts`). The fixture is `fixtures/realrun/kissimmee-live-2026-09-28.json`: agent1, inventory, count_result without `skippedSheets`, and review_items.

**Replayed from stored data (deterministic):**
- target building and consolidation (from `agent1_output`);
- sheet selection (from `prep_inventory`);
- counting: the counter is answered with the live run's own marks and circuit tags, including the enlarged-plan-excluded ones, in every tile that contains them;
- the enlarged / main-plan resolution;
- cross-sheet relations;
- schedule ownership and counts (from the stored tables);
- the consistency pass (answered with the same E-3 marks; the live pass agreed 73/73 and 52/52);
- typical expansion;
- families and legend equivalence;
- review items and `enforcedCounts`.

**Fidelity check (before the fix):** the replay reproduced the live count and status of **every** type, including duplex 48 and simplex 12. A test keeps this for every type except the two the fix changes.

**Not replayed:**
- the model calls themselves: the evidence readers (viewports, typicals, tables) are served from their stored parsed output through the evidence cache, and the counter from its stored marks;
- E-4 / E-5 viewport rectangles, rebuilt as in the 09-24 replay (E-4 measured, E-5 placeholders; titles only);
- the B-32 class conflict. The dropped E-2 simplex mark is not in the stored data, so that item is not reproduced. It does not change any count here.
- Agent 2/3/4 and the scope questions, which are not part of the count.

### Before / after (`diffAgainstExpected`)

**Before (live count_result of 2026-09-28):**
```
ITEM                                   EXPECTED  ACTUAL   DELTA  VERDICT
Type A / B / M / C                     73/52/6/2  same       0  pass (x4)
Linear LED total (A+B+M+C)                  133     133       0  pass
Recessed downlights (G)                      11      11       0  pass
Exit / emergency (E, F, J, K)                22      24      +2  reported
Wall packs (D + L)                            9       6      -3  reported
Site poles                                    3       3       0  pass
Site pole-top heads                           4       4       0  pass
Retail power poles                            8       6      -2  reported
Receptacles (all)                            38      71     +33  fail
GFCI receptacles                             16      11      -5  fail
RTU connections                               2       2       0  pass
Battery charger connections                   5       5       0  pass
Display baseflex floor connections            8       3      -5  fail
10 pass · 3 fail · 4 reported
```

**After (replayed through the fix, before any answer):**
```
Receptacles (all)                            38      24     -14  fail   (simplex 7, duplex 6, GFCI 7, WP GFI 4)
GFCI receptacles                             16      11      -5  fail
Display baseflex floor connections            8       3      -5  fail
every other row identical to "before"; 10 pass · 3 fail · 4 reported
+ ONE blocking item: typicalassign:PP-1..6 (the five blocking typicalat: items are gone)
```

**After the estimator confirms the suggestion** (office 1, checkout 1, parts pod 2, test station 1, commercial counter 1):
```
Receptacles (all)                            38      33      -5  fail   (duplex 6 + 8 = 14, simplex 7 + 1 = 8, GFCI 7, WP GFI 4)
```
This matches the 09-24 replay (33). The remaining −5 is all GFCI (below).

**Targets met:**
- Receptacles are no longer +33: −14 before confirmation, −5 after.
- The untyped poles are one blocking item.
- No regression: a test asserts every row that passed before still passes with the same number (A 73, B 52, M 6, C 2, total 133, G 11, site poles 3, heads 4, RTU 2, chargers 5).
- The expected file is unchanged.

## 4. GFCI and display baseflex (item 4): no deterministic cause, so no code change

### GFCI: 11 against 16

- The live count is GFCI 7 plus WP GFI 4:
  - 1 GFCI on the main plan (B29, the break-room fridge);
  - 6 from the #3 RESTROOM enlarged plan, which replaces the main plan's 2 in that area (`enlarged_replaces_area`, correct per the evidence-round review);
  - 4 WP GFI, all on E-1.
- The panel cross-check agrees with the drawn marks. B13 "MAINT & OX-BLUE RECEPTACLE" is 900 VA, which is 5 outlets at 180 VA. Exactly 5 marks carry B13: 3 WP GFI, 1 GFCI and 1 duplex.
- The evidence-round review rendered E-1 and found the other 5 GFCIs are not drawn on E-1.
- No stored mark, schedule row or note accounts for them. This is not a binding or merge bug.
- **Root cause:** the 5 are either on a sheet or detail the counter did not read as GFCI, or they are the estimator's own additions.
- **Proposed fix (needs vision and Chris):**
  - First ask Chris where his 16 come from. RTU service receptacles are already among the WP 4.
  - If they are drawn, use a targeted crop read of E-2's under-counter and break-room areas (E-1 note: "Under-counter power requirements referenced to sheet E2"), with the results as suggestions only.

### Display baseflex: 3 against 8

- FLEX J counted 3 on E-1: two on B30, one with no circuit.
- Panel B-30 "GENERAL RECEPTACLE" is 900 VA, which is 5 outlets. On B30 there are 2 FLEX J plus the E-2 #11 duplex, which is noted "mount in fixture kick plate" (arguably a baseflex drawn as a duplex). The untagged FLEX J makes 4.
- Agent 1's own pre-count row said 4. Nothing in the stored data supports 8.
- **Root cause:** vision. Coil+J symbols along the display fixtures were probably missed, and the #11 kick-plate duplex is a classification question.
- **Proposed fix (needs vision, never counted without confirmation):**
  - a panel-VA reconcile suggestion ("B30 900 VA ≈ 5 outlets, 4 drawn");
  - a crop-check / gap-fill pass for the coil+J symbol on the E-1 sales floor;
  - a type question for the E-2 #11 B30 duplex.
  - Each would be a review suggestion only.

## 5. Tests

- **New:**
  - `evidence/typicalsHostTypes.test.ts` (14): sharing, (a)/(b)/(c) and their refusals, allocation, suggestion, guard;
  - `typicalAssignReview.test.ts` (5): the item, nothing counted before an answer, member answers, not on job, carry-over;
  - `test/typicalAssignRoute.test.ts` (2, test DB): per-member route, gate;
  - `test/kissimmeeLive0928Replay.test.ts` (7): fidelity, before/after, the item, confirmation to 33, no regression.
- **Full backend suite:** `npm test` gave 2380 passed, 3 failed, 4 skipped (2387), across 227 files. The 3 failures are the known flakes: `intakeSimilarCache` ×2 and the integration lead-backfill. The 09-24 replay (`kissimmeeLiveReplay.test.ts`) and every existing typical, merge and review test pass unchanged.

## 6. Open questions

1. **The suggestion source.** It comes from Agent 1's `PP-1..6` equipment description, an AI paraphrase. It is shown and never counted. Should a verbatim evidence-table row that says the same thing auto-count (source b, as built)? Or should a schedule mapping also require confirmation?
2. **Drawn-near-pole devices** (1 simplex here) are listed and never subtracted from a confirmed assignment, because which pole they sit at is unknown. Is that right, or should the estimator be asked per device?
3. **The counter does not report the hexagon number at each pole.** Source (a) is implemented and tested, but it only fires when marks carry `tag`. Adding "report the tag number at each host marker" to the counter prompt would resolve Kissimmee automatically. That is a prompt change, so I left it for a live run.
4. **UI wording.** The member row reuses the reconcile UI: "Enter correct count" / "No more on this job — keep current count 0". It works, but a dedicated label ("poles of this type" / "none of this type") would read better. That is a frontend-only change.
5. **Carry-over gap in gap-fill/reconcile items.** Their member answers are not carried to a re-run by `carryOverResolutions` (top-level only). I fixed this only for `typicalassign:`, to stay in scope. Worth checking.
6. **Retail power poles.** The estimator has 8 and the plan shows 6. The tag-5 host (data/security pipes on 09-24) may not be a power pole with outlets. The assignment item lets the estimator enter only the typed poles, and nothing forces the answers to add up to 6.

## Fix round (review 06dfdce: NOT READY)

Commits `30577d6..c44f6d6`, plus this report update. Each review repro is now a test.

| Commit | Fixes |
|---|---|
| 30577d6 | **B1**, and **S3** (both live in the rewritten type identification, so one commit) |
| 44c63b9 | **S1** and **S2** |
| 018d45f | **S4** |
| c44f6d6 | **S5** |

- **B1: host types split only on positive evidence.**
  - `hostTypesOf` splits packages on one host only when there are 2+ distinct tags, or when the host words have no overlap. Before comparing words, two things are dropped: the words every package shares (the host noun) and filler words. The filler list is TYP / TYPICAL / TYPE / INTERIOR / EXTERIOR / ALL / SIMILAR / EQUAL / EXISTING / NEW / LOCATION / SEE / PER / NOTE.
  - With 2+ tags, an untagged note joins the one tagged type its words match.
  - Otherwise the packages are ONE type and all of them add up, exactly as on main.
  - The review's 3 repros are now tests: tagged + untagged "Vacuum island", "Vacuum island (typ.)", and "Storage unit" / "Storage unit interior". Each gives +8, no assignment item, and both packages `expanded`.
  - Kissimmee (tags 1, 2, 3, 4, 6) still splits into 5 types.
  - The review's scratch probe also passes.
- **S3: automatic expansion only from a real host schedule.**
  - That means a table titled SCHEDULE that has a tag/mark column and a type column (`hostScheduleSources` in `countMerge`), with the rows adding up to the pole count.
  - Every other non-panel, non-fixture table row (notes, keyed notes, legend) is only a SUGGESTION on the item (source `table_note`, labeled with its table).
  - Repro test: the review's KEYED NOTES row expands nothing and suggests 1, 1, 2, 1, 1.
- **S1: every action on `typicalassign:` must name its type.** A bare `confirm` is now a 400. Route test.
- **S2: answers are checked server-side** (`checkHostAssignmentAnswer`, inside the route transaction).
  - Each answer must be between 0 and the pole count.
  - When the last type is answered, the answers must add up to the pole count, or that last answer must carry a reason. The reason is recorded on the item ("answers add up to 3 of 6: …").
  - Route tests cover: 7 of 6 refused; 6 + 6 + 6 refused (the 18-pole repro); 2 + 2 + 2 accepted; 1 + 2 + 0 accepted with a reason.
- **S4: per-device question after the assignment.**
  - Once every type is answered, each device drawn within 0.75" of an unknown pole, and also added by the assignment, gets its own blocking question: `typicalassignat:<host>:<device>`, "…the same outlet as the power pole package, or additional?".
  - "Same" subtracts min(drawn, added). "Additional" keeps the device.
  - The route keeps these questions in sync with the assignment. A re-run brings them back with their answers (`carryOverWithFollowUps`, now used by the re-run path).
  - The "enter one power pole less" advice is gone.
- **S5: route-level test with the real Kissimmee item.**
  - The replay moved to `fixtures/realrun/replay0928.ts`.
  - `typicalAssignRealRoute.test.ts` stores the replay's own review items and answers the real member keys through `POST /review/resolve`. It then answers the simplex follow-up and scores the stored items with `enforcedCounts` + `diffAgainstExpected`.

### Before / after (fix round)

| Item | Expected | Before (live 09-28) | Replayed, unanswered | Suggestion confirmed via the route, simplex "additional" | …simplex "same" |
|---|---|---|---|---|---|
| Receptacles (all) | 38 | 71 (+33) | 24 (−14) | **33 (−5)** | 32 (−6) |
| Duplex / floor | — | 48 | 6 | 14 | 14 |
| Simplex | — | 12 | 7 | 8 | 7 |
| GFCI + WP GFI | 16 | 11 | 11 | 11 | 11 |
| Display baseflex | 8 | 3 | 3 | 3 | 3 |
| A / B / M / C / linear total | 73 / 52 / 6 / 2 / 133 | pass | pass | pass | pass |
| G / site poles / heads / RTU / chargers | 11 / 3 / 4 / 2 / 5 | pass | pass | pass | pass |

**Review items (replay):** the 5 blocking `typicalat:` items are replaced by 1 blocking `typicalassign:PP-1..6`. After the assignment, 1 blocking `typicalassignat:PP-1..6:SIMPLEX` follows.

**Full backend suite** (`npm test`, one run, machine on AC): 2396 passed, 3 failed, 4 skipped (2403), across 228 files. The 3 failures are the known flakes: `intakeSimilarCache` ×2 and the integration lead-backfill. The 4 files that timed out in the review's sleeping run all passed here.

**Still open:**
- The S2 total-mismatch reason can be the same text as a "none of this type" confirm reason (one field).
- The member UI labels are still the reconcile wording.
- Questions 3 and 5 above still stand.

### Fix round 2 (re-check 3b683f6: NOT READY, N1)

Commits `29fbe1d..d7be5e0`, plus this report update. Each repro from the re-check is now a test. The scratch probe `zzReviewProbe2` passes 8/8; it was run and removed, not committed.

| Commit | Fixes |
|---|---|
| 29fbe1d | **N1** and **N4** (both are one rewrite of `hostTypesOf`) |
| 1582a78 | **N2** |
| d7be5e0 | **N3** |

- **N1 (blocker): merge only on a subset.**
  - Two untagged packages merge ONLY when one's remaining words are empty or a subset of the other's. Remaining words means after dropping the words shared by every package, filler words and abbreviations.
  - A partial overlap, such as "checkout counter" and "commercial counter", is two types.
  - A package that is a subset of two different types is its own type, so it gets asked about.
  - Tests: the untagged Kissimmee-shaped legend gives 5 types, 0 added and 1 group. The 2-pole checkout/commercial repro adds 0. "Office pole" merges with "Office pole north". Climate-controlled and drive-up storage stay separate (0).
- **N2: abbreviations.** VAC → VACUUM, RCPT/RECEPT → RECEPTACLE, STOR → STORAGE, EQUIP → EQUIPMENT and ELEC → ELECTRICAL are expanded before comparing.
  - "Vac island" + "Vacuum island" gives +8.
  - Any other abbreviation still fails closed: "Vcm island south" gives 0.
- **N3: reopen.** Reopening the pole assignment now runs the follow-up sync.
  - Route test with the exact repro: resolve every type, answer the simplex follow-up, then reopen. The follow-up leaves `review_items` and the gate blocks again.
  - Closing the assignment again brings the follow-up back unanswered.
- **N4: every-host note.** An untagged package with no words left ("Power pole (typ.)" on the tagged legend) applies to EVERY host.
  - It expands × all 6 hosts, with binding `every_host` and the reason "…names no type, so it applies to every one of the 6".
  - It is never an extra assignment type, and the guard ignores it.
  - Test: Kissimmee plus that note gives the note +6, the same 5 types, and the same suggestion. Kissimmee on its own is unchanged.

**Before/after:** unchanged from the fix-round table. On Kissimmee the receptacles are 71 before, 24 unanswered, and 33 once the suggestion is confirmed through the route (32 if the drawn simplex is answered "same"). Every row that passed before still passes.

**Relevant tests:** 12 files, 386 tests, all passed. They cover `evidence/*`, `countMerge`, `reviewItems`, `typicalAssignReview`, `typicalAssignRoute`, `typicalAssignRealRoute`, both Kissimmee replays and `kissimmeeEvidence`.

**Full backend suite** (one run): 2401 passed, 4 failed, 4 skipped (2409 tests, 228 files).
- `intakeSimilarCache` ×2 and the integration lead-backfill test are the known flakes.
- The 4th failure is a 30 s timeout in the same integration lead-backfill block ("flags a lead follow-up overdue…"). Run on its own, `integration.test.ts` passes 31/31.
