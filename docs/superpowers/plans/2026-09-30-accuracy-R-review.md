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
