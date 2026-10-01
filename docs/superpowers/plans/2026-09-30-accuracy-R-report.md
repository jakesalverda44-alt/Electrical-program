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

- B2: a host shared by several legend types (`sharedHostTypes`) is **never schedule-owned** (full run and supplement pass); the counter is asked for it with "EACH ONE NUMBERED … put "#<number>" first in the circuit field" (`CountTarget.hostTags`; `hostTagOf` parses "#3 A-33"). Its count = the distinct physical hosts across its alias family (host key + its pole-tag legend + generic legend symbols that may be it), placed in one main-plan frame (the sheet with most marks; same-level sheets aligned with `alignSheets`; an unalignable sheet is not added on top, with a note) and de-duped within 0.5" (`distinctHosts`). Detail / legend / schedule marks never reach it (`resolveSheetMarks`). A stated total (`statedHosts`: tag range or "(6) power poles") is a reconciliation target only: fewer found → the missing poles become members of the assignment item, the count is never raised silently.
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
