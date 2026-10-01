# Accuracy round (2026-09-30) — Opus review of Builder R (reading: A, B, C3)

Branch `feat/accuracy-reading`, commits d152ca7, afa7b8b, 147730f, 1b5f171 on e884e9b. Reviewed against the plan (Tasks A, B, C3, F gate, Standing rules, Reviewer focus #2 and #4) and the R report.

## Verdict: MERGE AFTER FIXES

The Kissimmee numbers hold up. Replay gives 3 / 4 site poles / heads. The B1 diagnosis is right (PP-1..6 was schedule-owned through its cited circuits, and its qty of 2 came from "(2)"). 36th Street is byte-identical to the baseline. Locate marks are isolated, and old `typicalassign` answers still resolve.

Three paths can still lower a count with only a buried flag. That breaks "never lower a count silently". Two of them are reachable on ordinary layouts. All three fixes are small.

### What I verified (no source edits)
- **R test files:** all 11 green (107 tests): siteRegistration, realRunSitePoles, realRunPoles0930, locateTargets, replayReading, replayEval.baseline, kissimmeeLive0928Replay, kissimmeeLiveReplay, remodel36thReplay, typicalAssignRealRoute, families. They use the fake Anthropic client only. The route test uses `electrical_crm_test`.
- **Hidden diffs (INTENDED_COUNT_CHANGES):** I re-ran the baseline harness on this branch from a scratch copy (it never writes the committed file) and deep-diffed the output against `eval/replay-baseline-2026-09-30.json`.
  - **36th Street:** zero differences in any field, including `counting` and every `projected@*` scenario.
  - **Kissimmee `replayTypeDiffs`:** exactly the 4 intended keys (SITE LIGHT, PP-1..6, PP-OFFICE/CCTV, PP-TEST).
  - **Kissimmee count rows:** site_poles 6→3 and site_heads 10→4 now pass. power_poles 2→0 moves |delta| from 6 to 8, but that row is disputed.
  - **Kissimmee projected scenarios:** only the PP-1..6 held line (qty 2) drops out, plus the Branch Wiring footage-ratio change. Nothing else moves. The re-scoping hides nothing.
- **`guardSharedHostCounts`:** untouched and still applied (`typicals.ts:896`). Partial tag binding marks every expansion with `binding: 'tag'`, so the guard does not fire on it.
- **B1 fix scope:** `sharedHostTypes` only covers hosts with 2+ legend types that state per-host quantities. On 0928 and 0930 it covers only PP-1..6; on 36th Street it covers nothing. No other schedule-owned equipment loses ownership. Generic `P` / `PP` stay `merged` ("restates …").
- **Locate marks:** stripped from `placed` right after the first pass, before consistency (`countingStage.ts:980-987`). The consistency pass only re-asks types still in `placed`. They are excluded from photometric and demolition sheets, never `unreadable`, not in `allTargets`, and not in gap-fill. The test asserts none in types, targets, marks or review items.
- **Per-pole route validation:**
  - unknown pole → 404;
  - `count` → 400;
  - no `memberKey` → 400;
  - a type not in the legend → 400;
  - a per-pole key on an old item → 404;
  - a per-type key on a new item → 404.
- **Scripted data:** labeled `SCRIPTED` in the fixture helper and in the test names.

## Blockers

### B-1. Rule 2 registration merges separate poles: 6 → 3 with no review item
**Where:** `backend/src/ai/evidence/families.ts:266-273` (Rule 2 merge), `marksOf` at :122, and `siteRegistration.ts` (scale is free when viewport scales are unknown; no degeneracy check).

**Repro (scratch test, run against this branch):** two series-only site types from different schedules (SA from E-3, SB from E-7), both counted on E-7.
- SA: 3 poles in a row at y=100.
- SB: 3 poles in a row at y=1200 on the same sheet.
- Result: `SB merged into SA — "3 of 3 marks line up … (scale 1, rotation 180°)"`. Site poles go 6 → 3, with **no review item** (merged types skip the item loop).
- The same happens across two sheets with rows of different spacing: it was accepted at **scale 6.667**, because no viewport scales were known.

Poles set in evenly spaced rows are the most common parking-lot layout. Any two rows register exactly under a similarity transform.

**Fix:**
- (a) Two point sets on the **same sheet** are duplicates only when the identity transform pairs them within 0.5". Otherwise they are distinct, never merged.
- (b) Rule 2 accepts only when both viewport scales are known and match. If not, the result is "not registered", which keeps today's count and adds the `family-same:` item.
- (c) Reject degenerate sets: collinear points, or a minimum triangle area relative to the spread.
- (d) Even an accepted Rule-2 merge emits a non-blocking `family-same:` item ("treated as the same N poles — the marks line up; correct if not"), so the lower count is visible.
- Add the two-row synthetic case as a test.

### B-2. Shared-host count drops poles from another level or an unalignable sheet
**Where:** `backend/src/ai/countMerge.ts:711-718` (`hostFamilyCount`), and :870 (`ty.count = r.marks.length` replaces `combineSheetCounts`' count for every shared host).

**Scenario:**
- A shared host has marks on two sheets.
- If the sheets are on **different levels** (a mezzanine or second floor), the second sheet goes to `notAligned` and its marks are not counted. Different levels are by definition different physical hosts.
- If two same-level sheets show disjoint areas (a split plan, E-1 north / E-2 south), `alignSheets` has no common hosts. That sheet is dropped too.
- Before this branch, the host used `ty.count` (the type's own cross-sheet combination).
- With no stated total, the count drops with only a flag in the hidden details list. With a stated total, the missing ones at least become `pole:unlocated:*` members.

**Fix:**
- A sheet on a different level is **added** (distinct hosts).
- An unalignable same-level sheet: fall back to the type's combined `ty.count` (today's behavior) and raise a question ("E-2's N hosts could not be lined up with E-1's M — same poles or more?"). Put the note in the `typicalassign` item's detail, not only in `ty.flags`.
- Add a two-level synthetic test.

### B-3. Rule 1 with fewer than 3 marks per side merges with nothing in the review list
**Where:** `families.ts:166-182` (the reconciled path when `!registered`), and `realRunSitePoles.test.ts:105`.

**Repro (scratch):** S1 2 (photometric only) + SITE LIGHT 2 (E-7), 2 marks per side.
- Result: SITE LIGHT is merged, site poles 4 → 2.
- `buildReviewItems` returns **no item** about it.
- The only trace is the `DSX1 site poles: … not registered …` flag, inside the collapsed "details" `tr-notes` list (`TakeoffReviewPanel.tsx:837`).

The plan does allow "flagged not registered". But the same plan's Risks section says this case "asks", and reviewer focus #2 needs it visible. A note in a collapsed list is not visible.

The test is also mislabeled. It is titled "2 parking-lot + 2 building poles … -> asked, never merged", but its 2+2 half only asserts `registered === false`, and the code merges. Only the 3+3 half asks.

**Fix:**
- When Rule 1 reconciles **without** a registration (fewer than 3 or more than 7 marks, or marks not on one sheet each), emit one **non-blocking** `family:` confirm item: "E-7's 2 site poles and PH0.1's S1 2 taken as the same 2 poles (positions not compared) — confirm, or correct with markers".
- Retitle the test and assert that item.
- Kissimmee 09-30 registers, so this adds nothing there. 09-28 and 09-24 would gain one informational item each. That is acceptable, and pinned as an intended change.

## Should-fix

1. **Two real poles within 0.5" collapse into one.**
   - **Where:** `typicals.ts` `distinctHosts` (`HOST_DEDUPE_IN = 0.5`).
   - **Problem:** it de-dups marks of the **same key on the same sheet**, which the counter's `placeAndDedupe` has already de-duplicated. On a 1/8" plan, 0.5" is 4 ft. Two parts-pod poles ("#3 parts pod (2)") or adjacent checkout poles closer than that become one, with only a "was N before de-duplication" flag.
   - **Fix:** de-dup only across different keys (tag legend vs host) or across aligned sheets, never two same-key marks of one sheet. Or make the radius scale-aware (ft) and smaller.
   - Kissimmee's six 09-28 poles are more than 1" apart, so the fixtures don't show it.
2. **"More found than stated" is never said.**
   - **Where:** `reviewItems.ts` `perPoleAssignmentItem` (`short`).
   - **Problem:** the title and detail mention the stated total only when found < stated. If found > stated (a detail picture not excluded because viewport detection failed), the item says "8 power poles found on the plans" and nothing tells the estimator that E-2 states 6.
   - **Fix:** always show "E-2 states 6; 8 found" when they differ, and flag it.
3. **Registration accepts mirrors and unrelated layouts too often with 3 marks.**
   - **Where:** `siteRegistration.ts`.
   - **Evidence (Monte Carlo, 400 trials each, 0.64 scale):**

     | Spread | Mirrored sets accepted | Unrelated random layouts accepted |
     |---|---|---|
     | 3 marks, 8" | 11% | 9% |
     | 3 marks, 20" | 9.5% | — |
     | 4–5 marks, 8" | 3–7% | — |

   - A near-isosceles triangle is accepted mirrored, with the S1/S2 twin pairing swapped (`twinOf` would name the wrong pole as the twin).
   - In Rule 1 an acceptance does not change the count. In Rule 2 it does (B-1).
   - **Fix:** also fit the mirrored similarity, and accept only when the proper fit's residual is clearly better (for example under half of the mirrored one). Require 4 or more points before Rule 2 may merge. Add the isosceles-mirror case to the unit tests (the current mirror test uses one asymmetric 4-point set).
4. **An addendum supplement drops `count_result.locate`.**
   - **Where:** `countingStage.ts` `runSupplementCounting`, about line 1356.
   - **Problem:** it carries `prior.unlisted` and `prior.remodel` but not `prior.locate` / `prior.locateAsked`. After an addendum, P's feeder endpoint resolver loses every located node, so feeders fall back to holds.
   - **Fix:** carry `locate` / `locateAsked` from the prior when the new result has none, the same way as `unlisted`.
5. **Dead code, and the report overstates B2.**
   - **Where:** `countMerge.ts:857-868`, the alias family and the "a generic legend symbol whose marks were taken as these hosts" merge loop.
   - **Problem:** at this point no type has `synonymQuestion` yet (it is set later in `finish()`). So `fam` only gains uncertain symbols that are **not** counted, and the loop's `g.status === 'counted'` guard can never pass. `tag_legend` targets are alias targets and are never counted.
   - **Effect:** in practice the family is the host key alone. The report's claim ("generic legend symbols that may be it … de-duplicated") is not what runs.
   - **Fix:** remove the loop, or make it real. If it is made live, it must not silently settle a synonym question: the symbol's marks would join the poles and the question would vanish.
6. **When nothing is found, the members are labeled by the stated tags.**
   - **Where:** `typicals.ts`, the `unlocated` builder.
   - **Problem:** with found = 0 and the range 1..6, the members are "tag #1" … "tag #6". On Kissimmee, #5 is not a pole type (pipes) and #3 is two poles. The estimator can still reach 6 by answering "tag #5 — not found" as `tag:3`, but the label sends them the wrong way. Report item 4 says this "cannot be expressed"; it can, just not obviously.
   - **Fix:** when the stated tags don't match the legend's types one-to-one, use generic members ("stated power pole n of 6") and put the tag list in the detail.

## Nits

- `counter.ts` `hostTagOf`: "#A-33" parses as tag "A", circuit "33". Require the tag to be numeric, or to match `hostTags`, when the target has `hostTags`.
- `reviewItems.ts`, the Rule-1 `family:` question: the plan asks for "jump links". The item has sheet labels only, no mark positions. The data is in `registration.pairs` and the types' sheets.
- `countMerge.ts`, the `pipePoles` loop: it runs once per shared host for every matching Agent 1 row. With two shared hosts, the same row produces two `pipepoles:` items. Bind the row to the host whose tag it names ("#5").
- The `pipepoles:` answer is enforced only if `answer === options[1]` exactly (`reviewItems.ts` `enforcedCounts`). Fine with the current options. Note it for the port: the UI must post the option string verbatim.
- `families.ts` `register()`: for Rule 2 the reason says "fewer than 3 (or more than 7)" even when the real cause is "marks on more than one sheet". Use `why` from `marksOf`.

## Port spec check: what `review/TypicalAssignCard.tsx` must send (main e2f1328)

The backend contract, verified against `checkHostAssignmentAnswer`, `perItemInput` (member item gets `options: item.options` when `perPole`), and the route tests:

- **Branch on `item.hostAssignment?.perPole`.** When it is absent (items stored by earlier runs), keep the current per-type body unchanged:
  - `{ itemIds:[item.id], action:'count', qty:N, memberKey }`
  - `{ itemIds:[item.id], action:'confirm', reason, memberKey }`
- **Per-pole branch:** one row per `item.reconcileMembers[m]` (its key is `pole:<sheet>:<i>` or `pole:unlocated:<tag|nK>`).
  - A `<select>` of `perPole.types` (value = `typeId`, e.g. `tag:2`; text = `label`), plus `not_a_host` ("Not a power pole / not on this job").
  - Save POSTs **exactly** `{ itemIds: [item.id], action: 'answer', answer: <typeId | 'not_a_host'>, memberKey: m.key }` to `/preconstruction/:bidId/review/resolve`. No `qty`, no `reason`, no presets.
  - The server returns 400 for `action:'count'`, for a missing `memberKey`, and for an answer not in `item.options`. It returns 404 for a `memberKey` not on the item.
- **Display:**
  - Hide "currently 0 count": `currentQty` is always 0 on these rows.
  - Show the pole's place from `perPole.poles.find(p => p.id === m.key)`: `sheetLabel` + `pdf` (`unlocated: true` has no `pdf`).
  - Show `suggestedType` as a suggestion only, never pre-selected and never auto-posted.
  - The done text must map `resolution.answer` through `perPole.types` to its label (`not_a_host` → the "not a power pole" text). `resolutionText` would otherwise print the raw `tag:2`.
- **Keep** `data-member-key` / `data-member-open` / `tabIndex` on each `<li>`, so "Next unanswered" still works.
- **Types and payload freeze:**
  - Add `hostAssignment?: { hostNoun?: string; perPole?: { types: {typeId,label}[]; poles: {id,sheetLabel?,pdf?,tag?,suggestedType?,unlocated?}[] } }` to the frontend `ReviewItem`.
  - Add a NEW_UI_ONLY case to `payloadCases.ts`: `assignPoleAnswer` → `{ itemIds:['typicalassign:PP-1..6'], action:'answer', answer:'tag:2', memberKey:'pole:E-2:1' }`.
  - Do not touch the frozen section.
- **Other new items (no new card needed, but check them at the port):**
  - `pipepoles:*` (kind `area`, non-blocking, `options`) must post `{ itemIds, action:'answer', answer: options[i] }` verbatim.
  - `family-same:*` (confirm, non-blocking) and the Rule-1 `family:*` (confirm, blocking, no options) go through the existing confirm path, with a reason.

## Addendum: fix round 1 re-check (9311d5f, 1569325, bfeabb6, ca46d18)

**Verdict: NOT READY.** One new blocker, introduced by the B-2 fix. Everything else I flagged is fixed and verified.

### What I re-ran
- **The 13 key test files:** 140 tests, all green. Files: siteRegistration, families, fixRound1Hosts, realRunSitePoles, realRunPoles0930, locateTargets, replayReading, replayEval.baseline, kissimmeeLive0928Replay, kissimmeeLiveReplay, kissimmeeEvidence, remodel36thReplay, typicalAssignRealRoute.
- **Full baseline deep-diff** (scratch harness copy; the committed file was not rewritten):
  - 36th Street: identical to the baseline.
  - Kissimmee `replayTypeDiffs`: still only the 4 intended keys.
  - Kissimmee site poles / heads: 3 / 4, pass.
  - Kissimmee projected@due-fresh: $65,479.92 / 599.0 h, unchanged from the first round.
- **My original repros, re-run:**
  - B-1, two rows on the same sheet: SA 3 + SB 3 both kept, plus `family-same:SB`.
  - B-1, two sheets at a free scale: kept, plus `family-same:SB`.
  - B-3, the 2+2 case: merged to 2, but a non-blocking `family:S1` item now shows it.
- **My own Monte Carlo** (400 trials each). The builder's Rule-2 random case is rejected mostly by the scale check, because its random sets are not drawn at the 0.64 scale. So I re-ran it with scale-matched random layouts:

  | Settings | Mirrored sets accepted | Scale-matched random layouts accepted | True matches accepted |
  |---|---|---|---|
  | Rule 2, 4–7 marks, 8" and 20" spread | 0 | 0–1.25% | 87–95% |
  | Rule 1, 3 marks, 8" spread | 0 | 5% | 73% |

  - In Rule 1, a false accept only drops the `family:` assumed-same item. The count is the same either way, because the counts were already equal.
  - A false reject goes to the question, or to the assumed-same item. Both are the safe direction.
  - The builder's test is still a fair floor for the mirror check and for Rule 2.
- **Can the `typicalalign:` item be bypassed?** No.
  - It has no `blocking: false`, so `reviewItemIsOpen` keeps it open.
  - `takeoffGate` blocks on it.
  - `actions` is `['confirm']` only.
- **Other fixes verified:**
  - S1: two same-type marks on one sheet are kept as two poles.
  - S2: the item says "states N; M found" in both directions.
  - S4: `locate` survives a supplement (tested).
  - S5: the dead merge loop is removed.
  - S6: unlocated members carry generic labels.
  - Nits: `hostTagOf`, the `pipePoles` loop and answer matching are fixed.
  - The builder's correction stands: 09-24 and 09-28 take the same-catalog path and gain no `family:` item. That is asserted in `kissimmeeLiveReplay.test.ts`.

### "Never lower a count silently": each path I flagged
| Path | Now |
|---|---|
| B-1 Rule 2 merge | Holds. Same-sheet sets merge only when they coincide in place. Two sheets need both scales known and matching, 4+ marks, and 80% paired. Collinear sets are rejected, and a mirror must be beaten by 2×. Every merge emits `family-same:` (non-blocking). |
| B-3 Rule 1 without registration | Holds. Non-blocking `family:<P key>` "taken as the same N poles — positions not compared". |
| B-2 other level | Holds. Those hosts are added. |
| B-2 unalignable same-level sheet | **Fails once the per-pole question is answered** (see the blocker below). The carried count and the blocking `typicalalign:` item are right on their own. |
| S1 same-type de-dup | Holds. |

### Blocker (new): the per-pole answers are applied to the wrong base when a sheet can't be lined up
**Where:**
- `countMerge.ts`, the B-2 fallback: `ty.count = carried`, but `hostCounts.set(hk, { … marks: r.marks })` keeps the **union** of both sheets' marks.
- `typicals.ts` `expandTypicals`: `found = hc.marks.length`, and there is one member per mark.
- `reviewItems.ts` `enforcedCounts`: `perPoleHostDelta` is applied to `base = byType.get(hk) ?? type.count`, which is the **carried** count.

**Repro** (scratch; real `buildReviewItems` / `applyReconcileMemberResolution` / `enforcedCounts`):
- Setup: E-1 shows 4 poles and E-2 the same 4, which could not be lined up. The carried count is 4. The `typicalassign:` item has **8** members, titled "8 power poles found on the plans".
- The estimator types E-1's 4 poles and answers E-2's 4 duplicates "not a power pole". PP goes **4 → 0**, while the devices of 4 typed poles are added.
- The opposite answer (all 8 typed, because the poles really are different) adds devices for 8 poles while the pole line stays at 4.
- Either way the takeoff ends up inconsistent, with no warning.

**Fix (small):**
- Once the per-pole item has answers, the host line should be `found − (found poles answered not_a_host) + (unlocated poles given a type)`. That is, use `perPole.found` as the base, not the line count. The carried count applies only until then.
- And/or: answering `typicalalign:` "same poles" drops the unaligned sheet's members from the per-pole item, and "different poles" sets the line to `ifMore`.
- Make `typicalalign:` an answerable item (options *Same poles — keep {carried}* / *Different poles — {ifMore}*, enforced like `area:`). Today it is confirm-only, and its detail says "correct the count with markers", but `markers` is not one of its actions.
- Add the repro as a test: 4 + 4 unaligned, answered both ways.

### Port spec
Unchanged. `typicalalign:` is a plain blocking confirm (or a two-option answer, after the fix above). It routes to the `typical` group and needs no special card.

## Addendum: fix round 2 re-check (171cb5f)

**Verdict: NOT READY.** The fix-round-1 blocker is fixed. The builder's stated "known limit" is real and silently raises the count of devices on tag-bound poles. It is a blocker with a small fix.

### Verified
- **Tests:** the 11 key test files pass, 117 tests: typicalAlign, fixRound1Hosts, siteRegistration, realRunSitePoles, realRunPoles0930, replayReading, replayEval.baseline, kissimmeeLive0928Replay, kissimmeeLiveReplay, typicalAssignRealRoute, remodel36thReplay.
- **My fix-round-1 repro (4 + 4 unaligned) now resolves correctly:**

  | Answers | PP line | Devices added for |
  |---|---|---|
  | E-2's 4 answered "not a power pole" | 4 | 4 poles |
  | All 8 typed | 8 | 8 poles |
  | `typicalalign` "same" | 4 | E-2's per-pole answers ignored |
  | `typicalalign` "different" | 8 | all 8 |

  The per-pole line never double-applies with the `typicalalign` answer.
- **The `typicalalign:` item:**
  - It is blocking and has only an `answer` action, with `optionQty` [carried, ifMore].
  - The route accepts a listed option (200, its qty is stored and enforced). It returns 400 for other text and 400 for `confirm`.
  - It cannot be bypassed.
- **Monte Carlo:** the random layouts are now drawn at the matching scale. This agrees with my own run (0–1.25% at the Rule-2 settings).

### Blocker: tag-bound poles on the unaligned sheet are counted twice after "same poles"
**Repro** (scratch; real `partialTagBinding` → `expandTypicals` → `buildReviewItems` → `enforcedCounts`):
- E-1 shows 4 poles with no legible tags. E-2 is the same 4 poles, could not be lined up, and reads hexagon tags #1 and #2 on two of them.
- Each of those tags is read only once in the union of both sheets, so `partialTagBinding` binds the two **E-2** poles to #1 and #2. `expandTypicals` adds their devices right away (2 + 1 duplex).
- The estimator answers `typicalalign` "Same poles — keep 4" and types E-1's 4 poles (#1, #2, #1, #1).
- Result: **DUP = 20**, where 17 is correct (10 drawn + the 4 E-1 poles' 2+1+2+2). The PP line is a correct 4.
- The 3 duplex of the two E-2 poles stay in, with no item and no flag. That is a silent raise.

**Fix (choose A):**
- **A, the simplest and the one I recommend:** in the B-2 fallback, never tag-bind a mark on an **unaligned** sheet.
  - Run `partialTagBinding` only on the marks of each level's reference frame (plus aligned sheets).
  - Marks on an unaligned sheet are always per-pole members, with their read tag shown as `suggestedType`.
  - Keep counting tag uniqueness over the whole union. A tag read on both copies of a pole then stays ambiguous.
  - With this change, "same" drops E-2's members cleanly, and "different" asks for their types. The suggestion pre-fills nothing.
- **B:** keep the binding, but when "same" is answered, `enforcedCounts` subtracts `perHost` × (bound marks on `unalignedSheets`) from each tag-bound expansion. That needs the bound marks' sheets in the expansion evidence. It is more moving parts.
- **Test:** add this repro to `typicalAlign.test.ts`: tags #1 and #2 read on E-2 only, answer "same", and assert DUP 17. Run it once more with "different", where E-2's 4 are typed and the result is drawn + 8 poles.

### Should-fix (not blocking)
**The "same" option's number can change after per-pole answers.**
- **Where:** `typicalalign` option 1 is labeled with `carried` (`combineSheetCounts`' result). Under "same", once per-pole answers exist, the line becomes the reference sheet's distinct marks (`found − unalignedHosts`).
- `combineSheetCounts` can carry a value between the two. For example, `complementary` sums minus the paired marks: 4 + 3 − 2 = 5, with ifMore 7. In that case "Same poles — keep 5" turns into 4 after the poles are answered, which contradicts the option the estimator chose.
- **Fix:** label and enforce option 1 with `refHosts`, or put both numbers in the detail.
- Related: the same host can also get `combineSheetCounts`' own `area:<host>` question. Confirm that the `area:` answer and `typicalalign` can't both set the PP line, or suppress `area:` for a host that has `hostAlign`.

### Other
Port spec unchanged. `typicalalign:` is now an `area` item: post `{ itemIds, action:'answer', answer: options[i] }` with the option string verbatim (the existing area card).
