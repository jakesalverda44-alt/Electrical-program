# Accuracy round (2026-09-30) — Builder R report (reading: A, B, C3)

Branch `feat/accuracy-reading` (worktree `Electrical-program-wt-accuracy-r`), from Task 0 head `e884e9b`.
No live AI calls (fake Anthropic only); tests on `electrical_crm_test` only; the live DB was not touched.
No migration was needed (161 unused).

## Commits

| Commit | Task |
|---|---|
| `d152ca7` | A — site-pole family de-dup across the photometric and electrical sheets |
| `afa7b8b` | B — power poles as distinct hosts, per-pole type assignment, pole-type aliases |
| `147730f` | C3 — locate-only targets → `count_result.locate[]` |
| (this commit) | R replay gate (`src/eval/replayReading.test.ts`) + this report |

## Before / after (replay, no model)

"Before" = `eval/replay-baseline-2026-09-30.json` (never rewritten). "After" = `src/eval/replayReading.test.ts` on this branch.
Automatic = the live run's own counter marks. SCRIPTED = the same plus the **09-28 live counter's own PP-1..6 marks on E-2** (real counter output of the same sheet, cross-run, labeled `SCRIPTED` in `replay0930.scriptedPoleMarks0928`).

### Kissimmee (bid 041c6d48, run 11ff4565)

| | Before | After, automatic | After, SCRIPTED poles |
|---|---|---|---|
| Site poles / heads | 6 / 10 (fail / fail) | **3 / 4 (pass / pass)** | 3 / 4 |
| Power-pole hosts (PP-1..6) | 2 (from the schedule, see B1) | **0 found of the 6 E-2 states — all 6 asked** (one blocking item) | **6 distinct** (6 asked, none bound — no number read) |
| `retail_power_poles` (disputed, reported) | 2 | 0 | 6 |
| Review items (buildReviewItems, scope/refsheet items excluded) | 30 items, 25 blocking | 26 items, 22 blocking | 26 items, 21 blocking |
| projected@due-fresh price / hours / held | $65,657.33 / 601.4 h / 42 | $65,479.92 / 599.0 h / 41 | $66,012.66 / 606.0 h / 42 |

Review changes on Kissimmee: gone — `count:PP-OFFICE/CCTV`, `count:PP-TEST` (B4), `coverage:SITE LIGHT`, `photo:S1`, `photo:S2` (A); added — `pipepoles:PP-1..6:…` (non-blocking, default "not power poles"). The `typicalassign:PP-1..6` item is now per pole. No new blocking item.
Prices: the hour change is Branch Wiring only (the footage ratio's points follow the projected PP-1..6 count: −2.3 h / +4.7 h). Exterior / Site Lighting hours do not move (14.6 h) because the site pole/head rows are still held at $0 as fuzzy matches above $250 — that is P's D4. Power poles have no labor unit yet (P's D4), so Branch Power does not move either.

All other count items are unchanged on both jobs (gate: no non-disputed item goes pass → fail or gets a larger |delta|).

### 36th Street (bid 0cd39e74, run ec90ce29)

Unchanged: no site poles, no shared hosts; counts, review items and projected price ($21,225.28 / 164.1 h, held 10) identical to the baseline. Only addition: `locateAsked` = PANEL A, PANEL B, COMP-1, AHU-1, COMP-2, AHU-2 (the existing service is never a node).

## A — site poles

- Rule 1 (family-level photometric fallback) in `families.ts` (`siteRule1`, called from `applyFamilies` before the catalog comparison): a site-category family with members counted on the electrical plans (E) and members counted only on the photometric sheet (P), from different schedules, whose catalog numbers share only the series. The full-catalog path (W1/W2 → D/L, and 09-24's same-catalog SITE LIGHT) is untouched.
  - ΣP = ΣE and the drawings register (or cannot be compared): P's types stay (heads from P's heads-per-pole), `photometricOnly` cleared, E's sheets added; E folds in as `merged` with the reason "same 3 site poles as S1/S2: E-7 shows 3, PH0.1's S1 2 + S2 1 = 3 — types and heads from PH0.1, positions from E-7"; E's own heads-per-pole is flagged as not used.
  - Counts differ (or the registration is broken): E's total stands under E's types, P's types go to `merged` (0); ONE blocking `family:<P key>` confirm item: "E-7 shows N site poles; PH0.1 shows S1 a + S2 b = M. Which is right, and which pole types?" with both sheets. Never summed.
- Rule 2: two series-only site types both on the electrical plans merge only when ≥ 60% of the smaller set registers; otherwise today's count stays and a non-blocking `family-same:<key>` item asks "same poles?".
- A3 `siteRegistration.ts` (pure): similarity fit (scale + rotation, **no mirror**), every ordered anchor pair, greedy match, least-squares refit; accepted at ≤ 0.5" worst residual on the smaller-scale sheet, rotation within 10° of a multiple of 90°, fitted scale within 10% of the viewport scales when both known. 3..7 marks a side, else "not registered" (Rule 1 still holds on counts).
- Kissimmee 09-30: E-7's 3 SITE LIGHT marks register onto PH0.1 at 0.058" (scale 0.638, −0.3°): E-7 (1496, 1395) = S1, **(1131, 1346) = S2 (the twin-head pole)**, (1132, 932) = S1.
- 09-24 and 09-28: 3 / 4 with family decisions identical to their live runs (pinned in `kissimmeeLiveReplay.test.ts` and `realRunSitePoles.test.ts`).

## B1 diagnosis — which hypothesis

**None of hypotheses 1–4.** Proven on the run's own stored output (`realRunPoles0930.test.ts`):
1. The counter placed **no** power-pole mark anywhere (none counted, none excluded on E-1 / E-2). So there was nothing for hypothesis 1 (tags split), 2 (detail viewports / `dropCircuitRepeats`) or 4 (all-or-nothing tag binding) to act on.
2. The cause: Agent 1's `PP-1..6` row on 09-30 cites its circuits ("Ckts A-29,A-33,…"), so `scheduleCounts` took ownership of it through real-run fix 3's rule ("the circuits its own description cites feed ONE item") — and schedule-owned types are never sent to the counter. Its quantity: 1 × `multiplierOf("#3 parts pod (2)")` = **2**. `evidence.scheduleOwned` contains `PP-1..6`; `hostAssignments[0].hostCount` = 2.
3. Hypothesis 3 is true but secondary: PP-OFFICE/CCTV and PP-TEST were separate zero-count items.
(On 09-28 the same row had no circuits and was `uncertainOf` — not owned — so the counter was asked and found 6.)

## B — what was built

- B2: a host shared by several legend types (`sharedHostTypes`) is **never schedule-owned** (full run and supplement pass); the counter is asked for it with "EACH ONE NUMBERED … put "#<number>" first in the circuit field" (`CountTarget.hostTags`; `hostTagOf` parses "#3 A-33"). Its count = the distinct physical hosts across its alias family (host key + its pole-tag legend; see Fix round 1 / S5 — generic legend symbols were NOT actually folded in, contrary to this report's first draft), placed in one main-plan frame (the sheet with most marks; same-level sheets aligned with `alignSheets`; an unalignable sheet is not added on top, with a note) and de-duped within 0.5" (`distinctHosts`). Detail / legend / schedule marks never reach it (`resolveSheetMarks`). A stated total (`statedHosts`: tag range or "(6) power poles") is a reconciliation target only: fewer found → the missing poles become members of the assignment item, the count is never raised silently.
- B3: partial tag binding (`partialTagBinding`: a read tag that is a legend number AND unique among the hosts binds and expands; duplicates are asked, shown as a suggestion). `HostAssignmentGroup` gains `hosts[]`, `unlocated[]`, `found`, `stated`, `bound`. The `typicalassign:` item has one member per unbound pole (`pole:<sheet>:<i>`) and per stated pole not found (`pole:unlocated:<tag>`); options = the legend type ids + `not_a_host`; answered `{memberKey, action: 'answer', answer: typeId}`. `hostAssignmentAdds` adds that type's devices per pole; `perPoleHostDelta` adjusts the host line (a found pole answered "not a power pole" leaves, an unlocated pole given a type is added). Items from earlier runs (per-type members, no `perPole`) still resolve by their counts (route test). Route checks: unknown pole → 404; a `count` (one number for every type) → 400; no pole named → 400; a type not in the legend → 400.
- B4: `hostTypeAliases` — a zero-count equipment-schedule row whose significant words (host noun dropped) match exactly ONE legend type folds into it as `merged` with the reason (PP-OFFICE/CCTV → #1 office, PP-TEST → #4 tester); a generic-name synonym question whose candidates are all such rows is dropped (09-28's `synonym:PP-1..6`). Data/security pipes at a pole (`3" PVC data/security pipes at pole #5` × 2 — the row says #5, not #1 as the plan text has it) get one non-blocking `pipepoles:` question, default "No — raceway only"; "Yes" adds 2 to PP-1..6.

## C3 — locate-only targets

- `buildLocateTargets(agent1)` in `countTargets.ts`: panels[] names and what they are fed from, a NEW service's METER and XFMR, equipment[] with a feeder-size conductor spec; ≤ 20; key `@<NODE>`, `role: 'locate'`, `node`.
- **Normalizer: R's own** (`normalizeFeederNode`) — P's `feederNodes()` was not available; P can swap it in.
- Counter: a separate "LOCATE ONLY — place ONE mark at each item's symbol or label; never count, never report as a device" section in the existing calls (no extra calls); a locate reply carries `"low"` in the circuit field when unsure; never "unreadable". Marks leave `placed` right after the first pass (`countSheets`), so they never reach consistency, viewports, merge, gap-fill, types, the takeoff, review items or AI markers. Stored as `count_result.locate: Array<{ node, sheetKey, x, y, viewportId, viewportKind, confidence }>` plus `locateAsked`.
- Kissimmee 09-30 replay: asked PANEL A, PANEL B, DISCON A, DISCON B, WIREWAY, METER, XFMR, RTU-1, RTU-2; located none (the live replies hold no locate mark); every count unchanged.
- **Live-run expectation:** on E-1, Panel A/B, DISCON A/B, METER and WIREWAY located (the service wall); RTU-1/2 on E-1 or the roof plan if counted; XFMR usually not on an E sheet (C4.1's text label is P's tier 4). WIREWAY and MB (meter base) are also ordinary count targets on 09-30 (both found 0); they are asked as locate items too, on purpose — a locate mark never counts.

## Shared-file edits (all additive)

- `ai/countingStage.ts` (shared, R adds locate[]): `CountResult.locate` / `locateAsked`, `LocateMark`, `locateMarksOf`; locate targets passed to `countSheets` only; locate marks stripped from `placed` in `countSheets`; shared hosts removed from `schedCounts` (+ `hostTags`) in the full run and the supplement pass; `CountMark.tag`; `evidence.hostTypeAliases` / `pipePoles`; the uncertain-synonym list filtered by B4 aliases.
- `ai/reviewItems.ts` (R): `family-same:` items and the Rule-1 `family:` confirm item; per-pole `typicalassign:` (`perPoleAssignmentItem`), `isPerPoleMember`, `perPoleHostDelta`, `hostAssignmentAdds` / `checkHostAssignmentAnswer` per-pole branches, `pipepoles:` item and its enforcement; no `count:` zero item for a shared host whose stated poles are asked; `ReviewItem.hostAssignment.perPole`, `ReviewItem.pipePoles`.
- `test/fixtures/realrun/replay0930.ts`: `scriptedPoleMarks0928()` and an `extraMarks` option (SCRIPTED, labeled).
- `eval/replayEval.baseline.test.ts`: the pin and the fidelity test now exclude the counting the round changes on purpose (`INTENDED_COUNT_CHANGES`: SITE LIGHT, PP-1..6, PP-OFFICE/CCTV, PP-TEST — each with its task) and the `projected@*` scenarios; the committed baseline JSON is **not** changed. Those parts are compared in `replayReading.test.ts`.
- Other R-owned edits: `ai/evidence/families.ts`, `ai/evidence/siteRegistration.ts` (new), `ai/evidence/typicals.ts`, `ai/countMerge.ts` (applyFamilies context; shared-host block `hostFamilyCount`; B4 aliases; pipe poles), `ai/counter.ts`, `ai/countTargets.ts`, `ai/prompts.ts` (COUNTER_SYSTEM: the LOCATE rule), `estimating/takeoffReview.ts` (per-pole member options), frontend `TakeoffReviewPanel.tsx` (+ test).
- Updated tests for the intentional changes: `kissimmeeLive0928Replay.test.ts`, `typicalAssignRealRoute.test.ts`, `remodel36thReplay.test.ts` (09-28 new-build section: the B items are the documented exceptions), `families.test.ts` unchanged and green.

## Tests

- Backend full `npm test`: 267 files, 2,805 tests — 2,796 passed, 5 failed, all known flakes (intakeSimilar.route ×2, intakeSimilarCache ×2, integration lead-backfill; each a ~30 s timeout, unrelated to this branch).
- Frontend `npx vitest run`: 133 files, 1,380 tests, all passed.
- New: `siteRegistration.test.ts` (7), `realRunSitePoles.test.ts` (11), `realRunPoles0930.test.ts` (14), `locateTargets.test.ts` (8), `replayReading.test.ts` (4), route cases in `typicalAssignRealRoute.test.ts` (+2), frontend per-pole select (+1).

## Open questions / follow-ups

1. **Frontend rebase (blocked here):** the coordinator asked to merge main `11e510e` / `e2f1328` first and put the per-pole select in `review/TypicalAssignCard.tsx`. The merge was refused by the permission system in this session, so the select was built in the pre-round `TakeoffReviewPanel.tsx` (small, localized hunk). After merging main, port it: `TypicalAssignCard` → if `item.hostAssignment?.perPole`, render per member a `<select>` of `perPole.types` (`typeId` value, `label` text) + `not_a_host` ("Not a power pole / not on this job"), Save → `resolve([item.id], { action: 'answer', answer, memberKey: m.key }, …)`, the pole's place (`perPole.poles[].sheetLabel` + `pdf`), the answered type's label; else the current per-type body. Add `ReviewItem.hostAssignment` to the type, and under `payloadCases.ts` NEW_UI_ONLY a case `assignPoleAnswer: { items: [<per-pole item>], expected: { itemIds: ['typicalassign:PP-1..6'], action: 'answer', answer: 'tag:2', memberKey: 'pole:E-2:1' } }`. No reason presets are involved.
2. A real jump link to the pole on the Plans view needs a deep link the review panel does not have yet; the member shows the sheet and PDF position (the data is in `perPole.poles[].pdf`).
3. Automatic Kissimmee host count is 0 until a live re-run (the 09-30 counter was never asked). The 09-28 run, asked, found 6. The live re-run should show 6 distinct hosts and, if the counter reads the hexagon numbers, tag-bound types.
4. A stated tag range is a crude target when one tag is two poles (#3 parts pod ×2) and one is not a pole (#5 pipes). With 0 found, the unlocated members are one per tag (1..6); "#3 = 2 poles" cannot be expressed per member. Fine once the counter marks the poles.
5. Rule 1 with fewer than 3 marks a side merges on equal counts alone ("not registered" flag): a job with 2 building-mounted and 2 parking-lot poles of one series would merge. The plan accepted this; the flag is in the count result's flags.
6. The `pipepoles:` question answered "yes" adds to the PP-1..6 line count; pricing those 2 like power poles depends on P's D4 power-pole unit.
7. P can replace `normalizeFeederNode` with `feederNodes()`; WIREWAY / METER are asked both as count targets and as locate items on Kissimmee (intentional).

## Fix round 1 (Opus review 39af8a2) — commits 9311d5f, 1569325, bfeabb6 (+ this report commit)

Replay numbers are unchanged by the fix round (no model, same fixtures): Kissimmee 09-30 3 / 4 site poles / heads, 0 found of 6 stated (automatic), 6 found (SCRIPTED); 26 items / 22 blocking (automatic), 26 / 21 (SCRIPTED); projected@due-fresh $65,479.92 / 599.0 h held 41 and $66,012.66 / 606.0 h held 42; 36th Street identical to the baseline ($21,225.28 / 164.1 h, 24 items). 09-24 and 09-28 replays: 3 / 4.

**Correction of the review's expectation (B-3):** 09-24 and 09-28 do NOT gain an informational item. Both runs take the full-catalog path (SITE LIGHT shares S1/S2's whole catalog number), never Rule 1, so no `family:` assumed-same item appears; the replay pins now assert exactly that (`kissimmeeLiveReplay.test.ts`, `realRunSitePoles.test.ts`). The only paths that gain the item are Rule-1 reconciles without a registration (2 marks a side, collinear, ambiguous mirror, not one sheet each).

| Item | Before | After |
|---|---|---|
| B-1 Rule 2 | two rows of 3 on one sheet, or two rows on two sheets (no viewport scales): merged 6 -> 3 at scale 6.667, no review item | same-sheet sets merge only when they coincide in place (identity, 0.5"); different-sheet sets need both viewport scales known and matching (10%), >= 4 marks a side, >= 80% paired, non-collinear. Collinear/unknown scales -> kept at today's count + `family-same:` question. Both repros are tests (6 stays 6; 8 stays 8). Every ACCEPTED merge now also emits a non-blocking `family-same:` item ("Treated as the same site poles: X (n) merged into Y (m)", with the line-up evidence and both counts). The "not registered" reason names the real cause (marks not on one sheet each / fewer than 4 or more than 7 marks on a side / collinear / scales unknown). |
| B-2 shared hosts | other-level sheet dropped; unalignable same-level sheet dropped; `ty.count = marks.length` | other-level sheets ADD their hosts (distinct); an unalignable same-level sheet keeps its marks listed (own frame) and the type's own combined count is carried (never lower) + blocking `typicalalign:<host>` confirm ("E-2's 3 could not be lined up with E-1's 4 — same poles or more?", carried vs if-all-different counts) + a flag. Tests: two-level and unalignable synthetics. |
| B-3 Rule 1, < 3 marks | silent merge, flag only | one non-blocking `family:` item: "taken as the same N poles — positions not compared", both counts, sheet labels, the reason it could not be compared. `realRunSitePoles` 2+2 case retitled and asserts it. |
| S1 | same-key marks on one sheet within 0.5" merged | marks carry `typeKey` + source sheet; a cluster never takes a second mark of the same type from the same sheet (test: 0.1" apart stay 2; cross-key and cross-sheet still merge). |
| S2 | "found > stated" silent | title "E-2 states 6 power poles (#1–#6); 8 found on the plans" both directions, detail says more were found, count flag. |
| S3 | mirrors 11% / random 9% accepted (3 marks, 8") | the mirror is fitted too; the proper fit must beat a fitting mirror by 2x (stated in the evidence text: "proper fit r x the mirror's, margin 0.5"); candidates needing a non-90°-multiple rotation are no longer allowed to mask a proper pairing. Monte Carlo tests (400 trials, seeded): Rule 2 settings (4–5 marks, scales known, >= 80% paired) mirrored <= 0.5%, random <= 1% (asserted); Rule 1 settings (3 marks) mirrored <= 0.5%, random < the old 9% (it does not change a count there). |
| S4 | supplement dropped `locate` / `locateAsked` | carried from the prior like `unlisted`; asserted in `kissimmeeEvidence.test.ts`. |
| S5 | dead synonym-merge loop; the alias family also took uncertain (uncounted) symbols' marks | loop removed; the family is the host key + its pole-tag legend only, so no open synonym question is ever settled silently. The B2 claim above is corrected. Replay host counts are unchanged (0 / 6). |
| S6 | unlocated members "tag #n" | when nothing is found, or the stated tags are not the legend's pole tags one-to-one: "stated power pole n of 6 — not found on the plans", the tag caveat (one tag can be two poles, one may not be a pole) in the member text; tag-labelled ("stated power pole tag #5 — not found on the plans") only when the tags match the legend one-to-one. Member keys unchanged. **Follow-up (not done): adding an extra unlocated pole (e.g. "#3 is two poles") needs a new `resolve` action + frontend control; larger than small.** Today it can still be reached by answering a stated pole with the type, as the review noted. |
| Nits | `#A-33` read tag "A"; pipePoles once per shared host; answer matched exactly; reason text | `hostTagOf` needs a numeric (or lone-letter-not-before-a-circuit) tag, `#A-33` = circuit A-33; each pipes row once overall, bound to the host whose tag it names else the first shared host; the `pipepoles:` "yes" matches without regard to case / whitespace / dash style (the UI should still post the option verbatim); the Rule-2 reason text fixed (see B-1). Jump links: skipped (no deep link). |

New tests: `siteRegistration.test.ts` +8 (15), `realRunSitePoles.test.ts` +6 (17), `fixRound1Hosts.test.ts` 10 new. Gate: replayReading / replayEval.baseline unchanged and green.

Full backend suite after the fix round: 268 files, 2,829 tests, 2,820 passed, 5 failed — all known flakes (intakeSimilar.route x2, intakeSimilarCache x2, integration lead-backfill). Tests added this round: 8 + 6 + 10 + 1 assertion block (S4) = 24+.

## Fix round 2 (re-check addendum 996123a)

**Blocker fixed — the per-pole answers were applied to the carried count.** With E-1 and E-2 showing the same 4 poles, unalignable: carried count 4, the per-pole item lists 8. Before: answering E-2's 4 "not a power pole" took PP 4 -> 0 while 4 poles' devices were added; typing all 8 added devices for 8 with the line at 4.

Rules now (`reviewItems.ts`: `perPoleHostLine`, `enforcedCounts`):
- Once any per-pole member is answered, the host line = `perPole.found` − (found poles answered not_a_host) + (unlocated poles given a type). The carried combined count applies only while the item is unanswered. Devices come from the same answered members, so line and devices always agree.
- `typicalalign:<host>` is now an answerable `area` item: options "Same poles — keep {carried}" / "Different poles — {ifMore}" (`optionQty`, action `answer` only; the "correct with markers" wording is gone). Still blocking until answered.
- Interaction (documented in the item's detail): the typicalalign answer sets the line (carried / ifMore). "Same" additionally drops the unaligned sheets' per-pole members from the line and from the devices (members answered on them are ignored, not deleted). "Different" keeps the union; with no per-pole item it also adds the typical devices of the extra poles (`ifMore − carried`). Whenever per-pole answers exist they set the line themselves, so the two never double-apply.
- Known limit: poles on the unaligned sheet that were bound to a type by their read tag are expanded before any question and are not removed by "same".

Tests (`src/test/typicalAlign.test.ts`, 8): the reviewer's repro (a) E-2's 4 not_a_host -> line 4, devices for 4; (b) all 8 typed -> 8 / devices for 8; (c) "same" -> 4 with E-2 members collapsed; (d) "different" -> 8; plus no double-apply and the route test (listed option 200 with its qty enforced, other text 400, confirm 400). The Monte Carlo random layouts now draw at the matching 0.64 scale (still <= 1%).

## Fix round 3 (re-check addendum 6f0eb09; Opus)

**Blocker fixed — tag-bound poles on an unaligned sheet were expanded before any question** (reviewer's fix A).
- `partialTagBinding` takes a `bindable` predicate. In `expandTypicals` a mark on a same-level sheet that could not be lined up with the level's main sheet (`hostCounts.unalignedSheets`, the frame keys from `hostFamilyCount`) is never bound. It is always a per-pole member, and its read tag is only a `suggestedType` ("from the tag read there — this sheet could not be lined up; not counted").
- Tag uniqueness is still counted over every sheet, so a tag read on both copies stays undecided.
- In the fallback the full bindings (`identifyHostTypes`: all-tagged / schedule / one-to-one) are skipped as well. They were checked against the carried count, which is not a physical count. The per-pole path now applies even without a stated total.
- Repro through the real pipeline (`mergeCountsIntoTakeoff` → `buildReviewItems` → `enforcedCounts`, `typicalAlign.test.ts`):

  | E-1 4 untagged + E-2 the same 4 (unaligned), #1/#2 read on E-2 | Before | After |
  |---|---|---|
  | Expanded before any answer | 3 duplex (2 + 1) | nothing |
  | "Same poles" + E-1's 4 typed | duplex 20 | **duplex 17**, line 4 |
  | "Different poles" + all 8 typed | — | line 8, devices for 8 |

**Should-fix 1 — the "same" option is the line it gives.**
- The options are now "Same poles — {the main sheets' distinct poles}" / "Different poles — {every listed pole}". `optionQty` enforces those same numbers, so the line equals the chosen option before and after per-pole answers.
- The carried combined count stands only until the item is answered, and the detail shows it.
- "Same" is recognised by the option chosen, not by comparing numbers. `hostAlign` gains `same` and `unalignedHosts` (the distinct count).
- Complementary 4 + 3 − 2 case, tested: carried 5. Options are Same 4 / Different 7. "Same" gives 4 both with no poles typed and with E-1's poles typed. "Different" gives 7, with devices for all 7.

**Should-fix 2 — `area:<host>` vs `typicalalign`.**
- When the type's own sheet combining raised an `areaQuestion` on a shared host, the host-family count no longer aligns those sheets itself. Before, a sheet-frame "alignment" took the line from 4 to 8 "distinct" while `area:PP` was still open.
- They take the unaligned path (one `typicalalign` question), and the `areaQuestion` is removed with a flag. So `area:PP` is never asked alongside it.
- A stale stored `area:PP` answer cannot win either: in `enforcedCounts`, `typicalalign` is applied after it. Tested.

**Audit of the unaligned / typicalalign path (other silent raises or lowers found and fixed):**
1. With no per-pole item, "different" used to add `perHost × (ifMore − carried)` to **every** bound type's devices — one count feeding several types. A shared host on an unaligned sheet is now always per pole, so that branch was removed. Devices come only from answered poles.
2. Stated poles not found were counted against the union. E-1 4 + E-2 the same 4 = 8 ≥ 6 stated, so 2 missing poles disappeared after "same". They are now counted against the main sheets' poles: 2 are still asked. Tested.
3. The fallback with no stated total fell to the per-type path, so counts had to add up to the carried count. It is now per pole.
4. Left as is (noted): a `viewport:<host>` enlarged-plan question on a shared host sets the line, and per-pole answers then override it. Enlarged-plan poles held pending are not per-pole members. Not reachable on Kissimmee (its #11 marks are repeats, not pending). It is a follow-up if a real job shows it.

**Re-run:**
- R files + replay gate: 35 files, 413 tests, all passed.
- Replay numbers are unchanged: Kissimmee 3/4, hosts 0 of 6 (scripted 6), $65,479.92 / 599.0 h; 36th unchanged.
- Full backend: 2,846 tests, 2,837 passed, 5 failed, all known flakes (intakeSimilar.route ×2, intakeSimilarCache ×2, integration lead-backfill).

## Fix round 4 (re-check addendum f42983e; Opus)

**Blocker fixed — a `viewport:<host>` "adds" answer was overridden by the per-pole line** (the reviewer's preferred fix (a)).
- Before: E-2 has 6 PP poles and 2 more held on enlarged plan #11. Answering "adds — 8" set PP to 8. Typing the 6 poles then set it silently back to 6, and the 2 held poles were never asked, so their outlets were never added.
- Now, for a shared host answered pole by pole (it has a stated total, or unaligned sheets), `countMerge` turns the enlarged-plan marks held for "repeats or adds?" (`pendingEnlarged` of the host's family keys) into `hostCounts.held`. The `viewportQuestion` is removed with a flag, so `viewport:<host>` is not asked alongside the per-pole item.
- `expandTypicals` makes each held mark a per-pole member `pole:held:<sheet>:<i>`: "on enlarged plan #11 — may repeat a main-plan power pole: its type, or 'not a power pole'". The held marks are not in `found`. Typed, a held pole is added to the line; "not a power pole" means it is a repeat. Devices come from the same answered members.
- Held marks also count against the stated total, so the same pole is never asked twice, once as held and once as "not found".
- Apply order: `enforcedCounts` ignores a stored `area:` or `viewport:` answer for any host that has a per-pole `typicalassign` item. A stale answer from an earlier run cannot set the line.
- Every other type keeps today's viewport question and enforcement (tested).

Tests (`src/test/typicalAlign.test.ts`, +4, through `mergeCountsIntoTakeoff`):
- No `viewport:PP` item. The 2 held poles are members.
- Line before any answer: 6.
- 6 typed: 6. Held answered "not a power pole": 6, devices for 6. Held typed: 8, devices for 8.
- A stale stored "adds — 8": the line is still 6, and 8 once the held poles are typed.
- A non-host DUP type keeps its viewport question, and an answer of 11 is enforced as 11.

Re-run:
- R files + replay gate: 35 files, 417 tests, all passed.
- Kissimmee and 36th replays unchanged (3/4; hosts 0 of 6, scripted 6; $65,479.92 / 599.0 h; 36th $21,225.28 / 164.1 h).
- Full backend: 2,850 tests, 2,841 passed, 4 skipped, 5 failed. The 5 are all known flakes: intakeSimilar.route ×2, intakeSimilarCache ×2, integration lead-backfill.

## Fix round 5 + frontend port (after the fix-round-4 re-check 8609be5 and the main merge 6d2b68c)

**Backend should-fix (commit d5fd072).**
- Held poles no longer reduce the stated not-found poles: `missing = stated − found` again.
- When held poles exist, the stated not-found members are worded "— if it is not one of the enlarged-plan power poles above (if it is, answer 'not a power pole' here)".
- A non-blocking `typicalassignover:<host>` warning appears when the per-pole line is above the stated total: "8 power poles answered — E-1 states 6". It is kept in step with the answers by `syncHostAssignmentFollowUps` (route, reopen, and carry-over of partly answered items).
- Tests: stated 6, 4 found, 2 held.
  - The 2 not-found members stay.
  - Held answered "not a power pole" + the 2 not-found typed → 6, devices for 6.
  - All typed → the warning appears. Answering one held pole and one not-found pole "not a power pole" → it goes away.

**Backend nit.**
- A shared host answered per type (no stated total, every sheet lined up) keeps `viewport:<host>`, but its keep / add now come from the distinct count.
- Test: 6 PP marks plus a pole-tag legend mark at a 7th place, and 2 held → "keep 7 / add 9", not 6 / 8.

**Frontend port into the round-2A structure (this commit).** The merge took main's `TakeoffReviewPanel`, so my old-panel edits are gone; the per-pole select now lives in `review/TypicalAssignCard.tsx`.
- `TypicalAssignCard`:
  - An item with `hostAssignment.perPole` renders one row per pole (`pole:<sheet>:<i>`, `pole:unlocated:…`, `pole:held:<sheet>:<i>`), each with a select of `perPole.types` + `not_a_host`.
  - Save posts exactly `{ itemIds:[item.id], action:'answer', answer, memberKey }`. No qty, no reason, no presets.
  - "currently 0 count" is hidden.
  - The row shows the pole's place (`sheetLabel` + `pdf`, or "on E-2 enlarged plan #11 — may repeat a main-plan power pole").
  - `suggestedType` is a hint only: never pre-selected, never posted.
  - The done text shows the type's label.
  - `data-member-key` / `data-member-open` / `tabIndex` are kept, so Next unanswered still works.
  - Old items without `perPole` keep the per-type body unchanged.
- Frontend `ReviewItem` gains `hostAssignment.perPole` (poles with `held` / `viewportLabel`).
- Card kinds:
  - `typicalalign:` and `pipepoles:` are area-style choice buttons posting the option verbatim.
  - `family:` / `family-same:` use the confirm path.
  - No ready-made reasons for `family` / `family-same` / `typicalalign` / `typicalassign` / `typicalassignover` / `pipepoles` (`reasonPresets` returns `[]`). Their reasons are typed.
  - `ChoiceCard`'s "the drawings say 'by G.C.'" line is now shown only on `scope:` items (it had been printing on `pipepoles:`).
- `payloadCases.ts`, NEW_UI_ONLY only (frozen section untouched): `assignPoleAnswer`, `assignHeldPole`, `typicalalignAnswer`, `pipepolesAnswer`, `familyConfirmTyped`, with drivers in `TakeoffReviewPanel.payloads.test.tsx`. Plus a `reviewCards.test.tsx` case: label done text, `data-member-open`, and the old per-type body.

**Runs:**
- Frontend: tsc clean; `npx vitest run` 145 files, 1,660 tests, all pass.
- Backend: tsc clean; R files + replay gate 35 files, 421 tests, all pass.
- Replays unchanged: Kissimmee 3/4, hosts 0 of 6 (scripted 6), $65,479.92 / 599.0 h; 36th $21,225.28 / 164.1 h.
