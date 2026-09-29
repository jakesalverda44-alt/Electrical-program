# Adversarial review: fix/typical-expansion (a62bf7e..3337b72)

Reviewed 2026-09-29. Read-only except for this file. Tests were run on `electrical_crm_test` only, with no model calls.

## Verdict: NOT READY

There is one blocker. It is a regression in typed-host expansion (hunt b): two packages for the SAME host type on one bound host no longer expand. The Kissimmee fix itself is correct, and the replay proves it. The blocker is a narrow change to `hostTypeId` / `sharedHostTypes`, followed by re-running the tests.

## Test runs

- **Relevant files, run on their own: 7 files, 55 tests, all passed.**
  - `typicalsHostTypes`, `typicalAssignReview`, `typicalAssignRoute`
  - `kissimmeeLive0928Replay`, `kissimmeeLiveReplay` (09-24)
  - `kissimmeeEvidence`, `fixRound1Staleness`
- **Full `npm test` (one run): 26 failures in 4 files.**
  - The files were `fixRound1Staleness`, `kissimmeeEvidence`, `kissimmeeLive0928Replay` and `kissimmeeLiveReplay`, mostly failing at file level.
  - That run overlapped with the Mac sleeping, and it ran past 600 s.
  - All 4 files pass when re-run on their own (above), so I read these as timeouts rather than code failures. They should still be re-run once on an awake machine before merge.

## Blocker

### B1. Two packages for the same host type on one bound host are now blocked and add 0 (regression)

**Cause**
- `hostTypeId` identifies a type as `tag:X` when the package has a host tag, or else as `host:<words>`.
- Two packages for ONE type on the same `hostTargetKey` get different ids when:
  - one is tagged and the other is not, or
  - the host wording differs by any non-stop word. For example, `TYP` is not in `TYPE_STOP` (only `TYPICAL` is), and neither are `INTERIOR` or `EACH`-style qualifiers.
- A typical case is a legend row plus a notes line for the same host.
- `sharedHostTypes` then treats them as 2 types. `identifyHostTypes` cannot identify them, so every device becomes `host_unassigned` (0 added). A bogus "N vacuum islands, 2 vacuum island types — assign a type" item is raised.
- On `main`, both packages expanded × the host count, which is correct.

**Why it matters**
- It is fail-closed: it blocks rather than overcounts. But the item it raises invites an undercount.
- Answering "4" for one "type" and "none" for the other silently drops the second package's devices, because the two "types" are really the same hosts.
- Car wash vacuum islands and storage units commonly have a legend typical plus a "(typ.)" note on the same host.

**Repro** (a scratch test, now removed; saved at `scratchpad/zzReviewProbe.test.ts`)
- Host target `VAC` (equipment), count 4, with no marks.
- Package A: host "Vacuum island", tag "V", 1 × DUP.
- Package B: host "Vacuum island", untagged, 1 × GFI.
  - Result: `DUP:host_unassigned:0`, `GFI:host_unassigned:0`, 1 host group. Expected +8 (4 + 4), which is what main gives.
- The same happens when both are untagged with hosts "Vacuum island" and "Vacuum island (typ.)".
- The same happens with "Storage unit" and "Storage unit interior".

**Suggested fix**
- Only treat packages as different types when there is positive evidence of distinct types. For example:
  - 2+ DISTINCT non-empty hostTags; or
  - host words that are disjoint after removing the shared host noun.
- An untagged package whose words are a subset or superset of a tagged one's should merge with it.
- Add the three repros above as regression tests.
- The Kissimmee case (tags 1, 2, 3, 4, 6) stays shared under this rule.

## Should-fix

### S1. One bulk "confirm" closes the whole assignment with 0 poles

**Cause**
- `takeoffReview.ts` lets `confirm` without `memberKey` apply to every unanswered member. That branch was inherited from gapfill/reconcile.
- For `typicalassign:` this means a single "keep current count 0" with any 10-character reason marks every type as "none".
- The blocking item then closes, and none of the 6 poles' outlets are counted.
- It is a human action, but it is exactly the one-click shortcut the per-type design is meant to prevent.

**Repro**
- Use the ITEMS from `typicalAssignRoute.test.ts`.
- POST `{itemIds:['typicalassign:PP-1..6'], action:'confirm', reason:'none of these here'}` with no memberKey.
- Result: 200, `item.resolution` is set, and `takeoffGate` is null.

**Fix:** require `memberKey` for every action on `typicalassign:`.

### S2. Answers are not checked against the host count

- Each member accepts `count` values from 1 to 100000, with no cap and no total check.
- Repro: with hostCount 6, answer office = 6, parts pod = 6, counter = 6. That is 18 poles, and it is accepted. The same 1-pole-per-type case in reverse (sum 3 of 6, rest "none") is also silent.
- Fix, at minimum: reject any member value greater than `hostAssignment.hostCount`.
- Fix, preferably: when the item closes, either require the sum to equal `hostCount`, or require a reason when it does not. The report's open question 6 (8 vs 6 retail poles) shows this happens in practice.

### S3. Source (b) auto-counts from a vision-read table row with no confirmation (hunt a)

**Cause**
- `mergeCountsIntoTakeoff` passes every non-panel, non-fixture evidence-table row to `identifyHostTypes`.
- Those tables are AI-read (`source: 'vision'` in `schedules.ts`).
- Any row that `allocateFromText` maps and whose sum equals the host count binds and EXPANDS with no review item. The only trace is the `reason` text.
- Nothing restricts this to a schedule that is really a host schedule: keyed-note and general-note tables qualify too.
- The AI note on the host target itself is correctly kept as suggestion-only. But an identical sentence in a notes TABLE would be counted.
- None of the Kissimmee data triggers this.

**Repro:** `expandTypicals(packages, hc(six()), [], targets, {scheduleTexts:[{text:'(6) power poles (office, checkout, 2 parts pods, tester, commercial counter)', label:'E-2 KEYED NOTES'}]})`. All 5 types expand, with 0 review items.

**Fix, either of:**
- surface a schedule binding as a non-blocking "check" item listing the mapping; or
- only accept rows from tables whose kind is a real equipment/device schedule.

This is the report's own open question 1. I recommend requiring confirmation until the table reader is calibrated.

### S4. A drawn device at a pole can be double-counted after confirmation (hunt e)

- `drawnNearHosts` (1 simplex at Kissimmee) is shown and never subtracted.
- `enforcedCounts` then adds perHost × answered hosts on top of the drawn count. If that simplex is the test-station pole's own outlet, it is counted twice.
- The detail's advice, "enter one power pole less", is wrong: it drops that pole's other outlets too.
- Repro: the replay in `kissimmeeLive0928Replay.test.ts` gives simplex 7 + 1 = 8 after confirming the suggestion, and the drawn simplex near the pole is still in the 7.
- Fix: after the assignment, emit a `typicalat`-style question per device type drawn near the hosts ("same outlet or different"). The existing `typicalDevices: perHost -k` mechanism already enforces that answer. At minimum, correct the advice text.

### S5. The replay's confirmation step bypasses the route (hunt d)

- The counting, merge, `buildReviewItems` and `enforcedCounts` paths in `kissimmeeLive0928Replay` are production code (`runCountingStage` with a fake client). That part is good.
- The "confirm to 33" step calls `applyReconcileMemberResolution` directly.
- The route test (`typicalAssignRoute`) uses a hand-built 3-member item rather than the one `buildReviewItems` produced.
- So nothing tests that the real item's member keys, for example `#1 Office area power pole`, round-trip through `/review/resolve` → `enforcedCounts`.
- Fix: in the route test, insert the item from the replay (or from `buildReviewItems` on the fixture), answer through the route, and assert that `enforcedCounts` gives 33.

## Checked and OK

**(a) Suggestion never counted**
- `suggested` lives only in the detail text, member descriptions and `hostAssignment.members[].suggested`. `enforcedCounts` reads only `m.resolution.qty` where the action is `count`.
- Guard `guardSharedHostCounts` converts any unbound multi-type expansion on a shared host.
- There is no path from the AI note (ai_note) to a count. The exception is S3 (schedule tables).

**(c) Resolution handler**
- **Per type:** a count without memberKey returns 400, an unknown member returns 404, and `not_on_job` / `markers` return 400 (from `actions: ['count','confirm']`).
- **Blocking:** the item only gets `resolution` when every member is answered (`applyReconcileMemberResolution` allAnswered). Otherwise it stays open.
- **Gap-fill DELETE** is correctly skipped for `typicalassign:`.
- **Carry-over:** members are carried only when the fingerprint (host key, host count, types and per-type devices) is identical. When it changes, the members are dropped and the item gets `previousResolution` (the stale answer is not applied).
  - Minor gap: the fingerprint does not include the host marks or positions, so "the same 6, moved" carries over. That is acceptable.
- **Authz / IDOR:** the route is unchanged. `requireAuth` + `loadAccessibleBid(bidId)` apply, and items are loaded `WHERE bid_id = $1 FOR UPDATE`. An item id from another bid returns 404. No new surface.
- **Validation:** count is an integer from 1 to 100000, and confirm needs a real reason. See S2 for the missing upper bound per host count.

**(b) Tagged / one-to-one cases still expand**
- Source (a) tag per mark, (c) one-to-one legend, and the 09-24 replay (`kissimmeeLiveReplay`, 9/9) pass.
- A single-type host is not in `sharedHostTypes`, so it keeps the old path unchanged.
- The regression is only B1.

**(e) Consistency pass**
- It is untouched by this diff, and `enforcedCounts` for `typicalassign:` only adds.
- `host_unassigned` entries add 0 and create no `typical:` / `typicalat:` items.
- A device type marked not on this job (`null`) stays null.
