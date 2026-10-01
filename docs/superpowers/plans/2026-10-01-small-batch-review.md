# Small-batch review — fix/small-batch-1001 (Opus, blockers + regressions only)

Branch `fix/small-batch-1001` on main `56b4ac9`: 0a26386, feb03c2, 8e66c6d (revert), b5f36fd, 3cd1209, 20b9bf0, 77d4b2e, faddbb9.
Read-only review. No source edits, no merge or push, no app start, no live DB. Probes ran from the scratchpad against the worktree code.

## Verdict: MERGE AFTER FIXES

There are no blockers in items 1, 3 and 5's counting math. Two items fail the "never silently" policy and need small fixes first: the contactor rule (item 2) and how an added pole behaves on a re-run that changes the fingerprint (item 5). Item 4 does not deliver its contract for grouped members. That is a should-fix and could follow in the next batch.

## Tests

- Backend full suite (`npm test`, electrical_crm_test): 325 files / 3288 tests: 3278 passed, 6 failed (plus 1 "worker exited" unhandled error) under full-suite load. In isolation, `estimatingMarkups` and `integration` pass. The 4 `GET /api/intake` similarity tests (`intakeSimilar.route`, `intakeSimilarCache`) time out at 30 s even when run alone. The cause is test-DB bloat: electrical_crm_test holds 83,314 bids and 2,328 pending intake items, so the similarity scan takes about 39 s. That is environmental and not related to this branch: the intake GET reads no body, and no other file in the diff touches intake. All touched-area tests pass, including zeroHourLines, replayPricingGate, serviceGear, extraPole, getBodyIgnored, capture, harvest and autoArea, plus the Kissimmee replay and eval baseline suites.
- Frontend vitest (`src/api/client.test.ts` + `src/features/preconstruction/PcWorkspace/`): 19 files / 250 tests passed.
- Frozen section of `review/payloadCases.ts` (lines 1–111, through `REOPEN`) is byte-identical. The diff only touches lines 132+ (`ASSIGN_POLES_EXTRA`) and `NEW_UI_ONLY`.

## F1 (should-fix, fix before merge): the contactor rule prices any "contactor"-mentioning Lighting Controls row as LC-CONTACTOR, with no hold

`backend/src/estimating/serviceGear.ts:82-85`. The test is `CONTACTORS_COUNTED_RE = /\bcontactors?\b/` plus `/lighting|controls?/` on category+text. The only exclusion is "relay/control panel" and "lcp … install". Scratch probe output (`decideServiceGear`, qty 2 EA, category "Lighting Controls" unless noted):

| row | result |
|---|---|
| Time clock controlling lighting contactors | **LC-CONTACTOR** |
| Photocell for exterior lighting contactor | **LC-CONTACTOR** |
| HOA switch for lighting contactor | **LC-CONTACTOR** |
| Contactor control wiring | **LC-CONTACTOR** |
| Motor starter / contactor for EF-1 (category Mechanical, "controls" in text) | **LC-CONTACTOR** |
| Lighting contactors (Work, Sales, Sign x2, Site x2) | LC-CONTACTOR (intended) |
| Lighting relay panel LRP-1 with contactors | not coded (correct) |

A `libraryCode` set here maps with `confirmReason: null` (the new test asserts exactly this). So a time clock, photocell or motor starter on an estimating bid is silently priced at $180 / 2 h each instead of being held. This is the "never silently" class of bug.

**Fix:** require the row to *be* contactors, not merely mention them. For example, the item starts with the noun (`/^\s*(?:lighting\s+)?contactors?\b/i` on `r.item`), and add an exclude such as `/time ?clock|photo ?cell|\bhoa\b|switch|starter|motor|wiring|\bwire\b|conduit|coil|sensor|relay/i`. Add the five probe rows above as negative cases in `serviceGear.test.ts`.

Pin moves (zero-hour 21/9/11 → 22/9/10, replay `k.heldCount` 11 → 10) are justified. They come from exactly the one Kissimmee "Lighting contactors … x6" row moving from hold to LC-CONTACTOR. The rule runs only in `decideServiceGear`, which `bidEstimate.ts:780` skips when `priced === false`, so submitted/sold bids are untouched. The matcher-level attempt that moved the submitted pin was reverted (8e66c6d). The rest of the full suite, including every Kissimmee replay, eval gap/baseline and submitted-bid pin, passed unchanged.

Not a blocker, but note for Jake: library LC-CONTACTOR is $180 / 2 h, so 6 = $1,080 / 12 h. The comment and evidence at `serviceGear.ts:76-77` say Chris carried "6 contactors = $800 / 6 h = LC-CONTACTOR per contactor", which does not match ($133 / 1 h each). One of the two is wrong. Also, the evidence string at line 84 hard-codes "$180 / 2 h" and will drift if the library changes.

## F2 (should-fix, fix before merge): an added pole is silently dropped when a re-run changes the assignment's fingerprint

`backend/src/ai/reviewItems.ts` in `carryOverResolutions`, at the `extraKeys` computation (`pa.fingerprint === i0.fingerprint` guard). Extras survive only on an unchanged fingerprint. Scratch probe: an assignment with one found pole plus `pole:extra:1` typed has line 2. After a re-run with a changed fingerprint, the fresh item has members `['pole:E-2:1']` only. Its `previousResolution` is the generic "every type in this finding answered", and the line is `null` (the carried combined count applies). The item does reopen (blocking), so the count change is not fully invisible. But nothing tells the estimator that a pole *they added by hand* is gone. Re-answering the listed poles closes the item one pole short, and that is a silent lowering of the count.

**Fix (pick one):**
- Always carry `pole:extra:*` members into the fresh per-pole item (they are the estimator's own assertion, not derived from the evidence), *unanswered* when the fingerprint changed, with the old answer shown on the member (e.g., in its description: "you typed it #3 Parts pod before the plans changed"). This is the preferred fix.
- Or, at minimum, append to the fresh item's `detail`: "You had added N pole(s) not shown on the plans; add them again if they still apply."

Add a test next to `extraPole.test.ts › survives a re-run` for the changed-fingerprint case.

Everything else in add_pole checks out:

- **No double count.** An extra is `unlocated: true`, so `perPoleHostLine` / `perPoleHostDelta` give +1 only when it is typed with a type and 0 for "not a pole". `hostAssignmentAdds` adds the type's devices once.
- **typicalalign.** "Same poles" ignores only poles whose `sheetLabel` is on a repeat sheet. An extra has no sheet, so it is never dropped and never counted twice. The align answer's qty is overridden by the per-pole line as before.
- **Held poles and stated totals.** A held pole and an extra are each +1 when typed. A line above the stated total raises the existing non-blocking `typicalassignover` warning, which is regenerated on re-run by `carryOverWithFollowUps`. The warning text talks about an enlarged-plan pole and a "not found" one. Optional nit: mention added poles too.
- **Follow-ups.** Adding drops `item.resolution`, so `syncHostAssignmentFollowUps` removes `typicalassignat:` follow-ups until the item closes again, then re-asks them on a changed fingerprint.
- **Validation and transport.** Validation is in place: exactly one item; only `typicalassign:` with `perPole` (`typicalassignat:` / `typicalassignover:` do not match the prefix); cap of 20; unknown id → 404. The add runs in a `FOR UPDATE` transaction. Learning capture skips an extra pole (no `pdf`). Unchanged-fingerprint carry keeps the extras and their human answers (`carriedOver`).

## F3 (should-fix, can follow): the previousResolution carry does not hold for grouped members when the fresh run auto-answers them

`backend/src/ai/reviewItems.ts`, `carryGroupMembers`: `if (m.resolution) return m;` runs before the new `prevMemberOpen` lookup. Scratch probe:

1. Run 1: the member's human answer moves to `previousResolution` (fingerprint changed). This works.
2. Run 2: the fresh member has an `auto` answer. The auto answer stands, the group auto-closes ("every item answered automatically"), and the estimator's `previousResolution` is lost for good.

For non-grouped items, `withPrevious` drops a differing auto answer correctly (the autoArea test covers it). The commit's contract ("an auto / memory answer must never replace it") therefore holds for items only, not for members. The same line also lets a fresh auto member answer beat a *same-fingerprint human* member answer. That predates this branch (it is on main), but it is the same root cause.

**Fix:** in `carryGroupMembers`, when `m.resolution?.auto`, consult `prevMember` (same fingerprint: the human answer wins and is carried; different fingerprint: drop the differing auto answer and set `previousResolution`) and `prevMemberOpen` (drop a differing auto answer and keep `previousResolution`). Mirror `withPrevious`, then recompute `withGroupResolution`.

Item-level carry review: the carry cannot resurrect a stale answer as current. It only ever sets `previousResolution` (shown as "Earlier answer … check it again"), never `resolution`. It does not block auto answers forever in a harmful way: a differing auto or memory answer is held back only until the estimator answers once, and a matching auto answer still closes the item. An open item is visible and blocking, so this is by design. Minor: reopen does not clear `previousResolution`, so after "Undo" of a human answer the older pre-change answer can resurface as "Earlier answer". This is harmless.

## Item 1: GET/HEAD bodies (OK)

- **Backend** (`backend/src/index.ts`): JSON parsing is skipped for GET/HEAD. With express 4.22 / body-parser 1.20, `req.body` is now `undefined` on GET instead of `{}`. I swept every `req.body` reader in `backend/src` (route handlers by method, `utils/validateBody`, `routes/clientErrors.ts`, app-level middleware). No GET/HEAD/`use` path reads `req.body`, and no other body parser is mounted. pino-http does not serialize the body. No GET relied on a body.
- **Frontend** (`frontend/src/api/client.ts`): axios 1.20 lowercases `config.method` before interceptors run. Only `data` and Content-Type are removed; `params` and the other headers (Authorization) are untouched. No `api.get` in `src` passes `data` or a Content-Type. POST, PUT, PATCH and DELETE bodies are unaffected.

## Item 3: moved estimator-created marker recaptures (OK)

`capture.ts:67`: any moved count marker now emits `marker_move` at the new centre. `learningDb.ts` retires the older example of the same `markupId` ("a newer capture of the same marker"), and the harvest test proves that end to end. A label change plus a move on an estimator marker falls through to `marker_move` with the new type, and the old example retires. This is consistent.
