# Plan: Estimating UI cleanup, round 2A: takeoff review questions

## For Jake (plain summary, under 120 words)
The review list on the Takeoff step gets easier to work through, and nothing it saves changes. At the top you'll see "12 of 25 answered", a progress bar and a "Next unanswered" button. Each kind of question gets its own simple card with plain buttons. Examples: "Same area — keep the larger (40)" / "Different areas — add them (75)", "New install" / "Existing reused", "Confirm AI count 12". "Not on this job" becomes a button that offers ready-made reasons like "Not shown on the plans for this job", and you can still type your own. Only the first group with open questions starts expanded. Sheet lists and notes move behind "Details". When an answer folds away, the cursor moves to the next open question. The proposal stays blocked exactly as it is today.

Frontend root: `/Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend`. Paths below are relative to it unless absolute. Work on the new branch `feat/estimating-ui-round2a` in a worktree off main `11e510e`.

## Goal
Make the Needs-review panel (`src/features/preconstruction/PcWorkspace/TakeoffReviewPanel.tsx`) quick to work through on a real run of 25–33 items, with no change to:
- what is POSTed to `/preconstruction/:bidId/review/resolve`, `/review/reopen` or `PUT /count-types`;
- what blocks the proposal;
- any backend file.

Scope:
1. A progress header with "Next unanswered".
2. One card component per item kind, using buttons where the answer is a choice.
3. Collapsible groups with short headings and open counts.
4. A "Details" disclosure for technical text.
5. A reason picker with preset reasons wherever the backend requires a reason.
6. Focus moves to the next open item after an answer.

## What I found (checked against the code)

### Where reasons are required, and why (backend, never weakened)
- `backend/src/ai/reviewItems.ts:1758` `isRealReason(reason)` means `reason.trim().length >= 10 && /[A-Za-z]{3,}/.test(reason)`. `validateResolution` (1765-1814) applies it to:
- `not_on_job`: always required. Error: "Say why this is not on this job (at least 10 characters)."
- `confirm`: always required. When `item.kind==='count' && aiCount!=null`, the saved resolution gets `qty: item.aiCount`.
- `count` on `unlisted:` items only: the reason is the **name** of the new type ("Say what Type H is…"). `reviewItems.ts:2001` turns it into the takeoff line name `Type H — <reason>`, and `reviewAnswers.ts:59` matches on it. It is a line name, not an audit note.
- `count` on anything else: **no reason is required.** A typed count that differs from the AI's is accepted without one. Decision: **we do not add a reason for overrides.** The backend doesn't ask for one, and adding it would change payloads.
- `answer`: no reason. It is stored only if sent, and the UI never sends one.
- `typicalassign:` (`checkHostAssignmentAnswer`, 1402-1424): when the **last** type is answered and the answers don't add up to the host count, that call needs a real reason. See the pre-existing gap below.
- Where a reason goes afterwards:
- it is stored on the resolution and shown in the resolved list;
- for `kind:'confirm'` items it goes into Agent 4's prompt as "confirmed by the estimator (<reason>)" (`reviewResolutionsForAgent4`, 2024);
- it is included in the run snapshot tuple at `routes/preconstruction.ts:657`.
- Labeled events (`takeoffReview.ts:447-457`) log the action, qty and answer, but **not** the reason.
- So preset reasons are allowed if every preset is an honest statement the estimator picks, and passes `isRealReason`. `features/estimating/LaborPricingStep.tsx:74` already mirrors `isRealReason` on the frontend. Reuse it; don't write a third copy.

### Resolve route (reference only)
`routes/preconstruction.ts:2166` accepts `{ itemIds, action, qty, reason, answer, answerIndex, useSuggested, memberKey }`. `takeoffReview.ts applyResolution`:
- a bulk call (2+ ids) must be one group, except `not_on_job` across `kind:'count'` items;
- equipment in any bulk call returns 400;
- `legend-zero:` resolves per member through `memberKey`; with no memberKey it applies to every unanswered member;
- `gapfill:` / `reconcile:` / `consistency:` / `typicalassign:` / `statuscrop:low` resolve per member. `typicalassign` **requires** memberKey. With 2+ members, `count`/`markers` require memberKey, and `confirm` without one applies to all.

### Mount
`PcWorkspaceView.tsx:1601-1616` mounts `<TakeoffReviewPanel key={review-${resultsEpoch}} …>` above the List/Plans toggle. **No change is needed there.** The key already resets local state (expanded groups, pickers) on a re-run, which is what we want. Only `TakeoffReviewPanel.test.tsx` renders the panel; no other test or consumer reads its DOM (searched).

### Every item kind, how it renders today, and its current payload
Today one generic renderer (TakeoffReviewPanel.tsx:364-664) switches on `groupedTypes`, then `reconcileMembers`, then `actionsOf(item)`. `B = { itemIds:[id] }` below. Reason values are sent **untrimmed**, as typed; the backend trims.

| Kind (id prefix) | actions (backend) | Controls today | Payload(s) today |
|---|---|---|---|
| Zero / unreadable `count:<K>` (group `zero`/`unreadable`) | count, markers, not_on_job | qty + Save count, Use confirmed markers, reason text, Not on this job; checkbox unless equipment | `{…B, action:'count', qty:N}` (plus `reason` if the shared reason box had text); `{…B, action:'markers'}`; `{…B, action:'not_on_job', reason}` |
| Heads `count:<K>:heads` | count, not_on_job | as above, without markers | count / not_on_job as above |
| `unscheduled:`, `typical:`, `typicalqty:`, `demounit:`, `photo:` (info) | count, not_on_job | as zero | same |
| `coverage:` | count, markers, confirm, not_on_job | qty, markers, reason, "Confirm N", Not on this job | count / markers / not_on_job; `{…B, action:'confirm', reason}` |
| `recount:`, `status:`, `democompare:` (info) | count, confirm | qty, reason, "Confirm N" | count; confirm |
| Area `area:` | answer, count | radios + Save answer, qty + Save count | `{…B, action:'answer', answer:<exact option>}`; count |
| `viewport:`, `schedqty:`, `demodup:` (kind area) | answer, count | same | same |
| `demosuggest:` (options "Use the suggestion — N removed" / "Keep all 11 — every one shown is removed" / "None removed — 0") | answer, count (min 0) | same | same; `qty:0` allowed |
| `synonym:`, `family:` (answer form), `classconflict:`, `typicalat:`, `typicalassignat:`, `panel-dup:` (answer form), `statuscrop:reclassified` (Confirm / Restore), `reuse:` ("Existing, reused — no new install, no demolition" / "New install — the old one is removed"), `remodel:conventions` | answer | radios + Save answer | `{…B, action:'answer', answer}` |
| Scope `scope:` (kind scope_question, optional `suggested`) | answer | radios (suggested pre-checked) + Save answer | `{…B, action:'answer', answer}` |
| Unlisted `unlisted:<TAG>` | answer (if pool), count, not_on_job | "Same as Type X" radios + Save answer; qty + Save count (name typed in the shared reason box); Not on this job | `{…B, action:'count', qty, reason:<name>}`; `{…B, action:'answer', answer:'Same as Type A'}`; `{…B, action:'not_on_job', reason}` |
| Confirm-only: `counting:`, `sheet:`, `file:`, `refsheet:`, `schedule:`, `panel-dup:`, `family:` (confirm form), `typicalheads:`, `combined:`, `demosheet:`, `demosheets:cap`, info items (`spotcheck:`, `remodel:existing`, `remodel:demolition`, `remodel:titles`, `unlisted-possible`, `checklist:`, `typicalnote:`, `panel-load:`) | confirm | reason + Confirm (+ upload for `refsheet:`, + type entry for `counting:`) | `{…B, action:'confirm', reason}` |
| Legend-zero group `legend-zero:` (`groupedTypes`) | per member | per member: qty + Save count, reason + Not on this job; "Mark all N remaining" (typed reason + confirm dialog) | `{…B, action:'count', qty, memberKey}`; `{…B, action:'not_on_job', reason, memberKey}`; all remaining: `{…B, action:'not_on_job', reason}` (no memberKey) |
| `legend-unused:` (info, groupedTypes) | same | same | same |
| Reconcile members: `gapfill:`, `reconcile:`, `consistency:`, `statuscrop:low` | markers?, confirm, count | per member: "Confirm the found marks on the plans" (if markers), qty + "Enter correct count", reason + "No more on this job — keep current count N"; half-done "needs" row + Save heads/poles | `{…B, action:'markers', memberKey}`; `{…B, action:'count', qty, memberKey}`; `{…B, action:'confirm', reason, memberKey}` |
| **typicalassign** `typicalassign:<host>` (reconcileMembers, actions count+confirm, no markers) | count, confirm | the reconcile branch above | `{…B, action:'count', qty, memberKey:'#1 Office power pole'}`; `{…B, action:'confirm', reason, memberKey}` |
| Group bulk: area | answer | "All the same area — keep the larger" / "All different areas — sum" | `{itemIds:[…], action:'answer', answerIndex:0|1}` |
| Group bulk: scope | answer | "Accept the pre-filled answers (N)" | `{itemIds:[…suggested], action:'answer', useSuggested:true}` |
| Group bulk: not on job (2+ non-equipment) | not_on_job | reason + "Mark all N not on this job" + confirm dialog | `{itemIds:[…], action:'not_on_job', reason}` |
| Group bulk: confirm (2+ confirm, ≤1 noj, not area/scope) | confirm | reason + "Confirm all N" + dialog | `{itemIds:[…], action:'confirm', reason}` |
| Multi-select bar (2+ checked) | not_on_job | reason + "Mark selected not on this job" + dialog | `{itemIds:[…], action:'not_on_job', reason}` |
| Reopen | n/a | Reopen | `POST /review/reopen {itemId}` |
| Count types | n/a | textarea + Save types | `PUT /count-types {types}` |

A real run (fixture `feat/accuracy-reading:backend/src/test/fixtures/realrun/kissimmee-live-2026-09-30.json`, 33 items) has:
- 15 `count:` zero items. 4 of them are equipment (200A fused switch, MB, WIREWAY, PYLON SIGN may be equipment).
- 1 coverage item.
- 3 `photo:` (info).
- 1 typicalassign and 3 typicalqty.
- 2 area items.
- 1 legend-zero group (8 members).
- 2 unscheduled items.
- 3 scope items.
- 2 spotcheck items (info).

### Other findings
- **Answered items already fold away.** `open = items.filter(i => !i.resolution)`. After `onReviewChange(data)` the item leaves its group and appears under "N resolved" with Reopen. A member answer keeps the card open until every member is answered (`applyGroupMemberResolution`/`applyReconcileMemberResolution` set the item's resolution only then). This is correct. Task 6 adds a test for it.
- `groupTitle` has no case for `recount` (the backend `groupOf` returns it), so those items land under "Other (n)". Fix this in Task 1.
- **Pre-existing gap (don't fix here; flag it):** a `typicalassign` answer whose totals don't add up needs a reason on the **count** call, but the UI's "Enter correct count" never sends one. The only way through is "No more on this job" (confirm, qty 0). The accuracy branch replaces these members anyway.
- **Parallel branch:** `docs/superpowers/plans/2026-09-30-accuracy-round.md` B3 makes typicalassign members one per pole, with a select that posts `{memberKey, answer}`, and plans to edit TakeoffReviewPanel.tsx. `feat/accuracy-reading` has not touched the frontend yet (`git diff main...feat/accuracy-reading --stat` shows backend only). This round moves typicalassign into its own file, so B3 only replaces that file's body.

## Constraints for the builder
- Use the worktree only. Don't touch any DB, and don't start the app, merge or push. **No backend file changes.** `git diff main --stat -- backend` must be empty.
- **Payload parity.** Every POST/PUT body listed above keeps the same shape. `review/payloadCases.ts` is written in Task 0 and **must not change after Task 0.** The reviewer checks `git diff <task0-sha> -- src/features/preconstruction/PcWorkspace/review/payloadCases.ts` is empty. Only additions are allowed, in a clearly marked `NEW_UI_ONLY` section, for preset-reason bodies (same shape, different reason text).
- **Blocking is unchanged.** Don't touch `ProposalTab`'s `reviewBlocked`, the server gate or `blocking` handling. Info items (`blocking === false`) never count as open.
- **Bulk actions keep their confirm dialogs** (group not-on-job, group confirm, legend-zero "mark all remaining", multi-select), and keep **typed** reasons. Presets are for single items only.
- Equipment (`category === 'equipment'`) gets **no** preset reasons (typed only), in the spirit of fix S16. It still never gets a checkbox.
- Never hide a warning: the account-rule `warning`, "Counting did not run: …", and "Not counted: E-1…" stay visible.
- Match the surrounding style: classes in `takeoffReview.css`, short "why" comments in the form `// UI cleanup round 2A — …`, and `btn primary sm` / `btn ghost sm` buttons.
- After each task run `npx tsc --noEmit` and `npx vitest run src/features/preconstruction`. At the end run `npx vitest run`.
- In parity tests, use `expect(post.mock.calls[n][1]).toStrictEqual(expected)`, **not** `toHaveBeenCalledWith`, so stray `undefined` keys fail. Also assert the URL `post.mock.calls[n][0] === '/preconstruction/b1/review/resolve'`.

## New file layout
All new files go under `src/features/preconstruction/PcWorkspace/review/`:
- `payloadCases.ts`: frozen fixtures and expected bodies (Task 0).
- `reviewModel.ts` + `reviewModel.test.ts`: pure helpers (Task 1).
- `ReasonPicker.tsx`: shared reason chooser (Task 2).
- `ReviewCardShell.tsx`: the card frame, Details disclosure and earlier-answer line (Task 2).
- `reviewCards.tsx`: CountCard, QuantityCard, ChoiceCard, ConfirmCard, UnlistedCard, LegendGroupCard, ReconcileCard (Task 3).
- `TypicalAssignCard.tsx`: **typicalassign only, self-contained** (Task 3).

`TakeoffReviewPanel.tsx` keeps: the default export, the `TakeoffReview` / `ReviewItem` / `ReviewResolution` / `ResolutionAction` type exports (PcWorkspaceView imports `TakeoffReview`), and `parseCountTypes` (tests import it). It re-exports `groupKey` from reviewModel so the export surface is unchanged. It becomes the orchestrator: fetching extras, `resolve`/`reopen`, grouping, progress, focus, bulk bars and the resolved list.

---

## Task 0: Freeze the payloads (characterization tests on the CURRENT UI)

**Files (new):** `review/payloadCases.ts`, `TakeoffReviewPanel.payloads.test.tsx` (next to the panel; same mocks as the existing test file).

**Do not change TakeoffReviewPanel.tsx in this task.** Commit it alone. Every test must pass on unchanged main code.

`payloadCases.ts` exports `const CASES` (typed `Record<string, { items: ReviewItem[]; expected: Record<string, unknown> }>`) with these entries:

| key | items (minimal) | expected body |
|---|---|---|
| `zeroCount` | `count:G` (kind count, group zero, aiCount 0, actions count/markers/not_on_job) + `count:OS` | `{ itemIds:['count:G'], action:'count', qty:11 }` |
| `zeroMarkers` | same | `{ itemIds:['count:G'], action:'markers' }` |
| `zeroNotOnJob` | same | `{ itemIds:['count:OS'], action:'not_on_job', reason:'No sensors on this prototype' }` |
| `headsCount` | `count:S1:heads` (actions count/not_on_job) | `{ itemIds:['count:S1:heads'], action:'count', qty:4 }` |
| `coverageConfirm` | `coverage:SL` kind count aiCount 9, actions count/markers/confirm/not_on_job | `{ itemIds:['coverage:SL'], action:'confirm', reason:'Checked E-1 by hand: 9 poles' }` |
| `recountCount` | `recount:A` aiCount 70, actions count/confirm | `{ itemIds:['recount:A'], action:'count', qty:68 }` |
| `areaAnswer` | `area:A` options `['Same area — keep 40','Different areas — sum 75']`, actions answer/count | `{ itemIds:['area:A'], action:'answer', answer:'Different areas — sum 75' }` |
| `areaCount` | same | `{ itemIds:['area:A'], action:'count', qty:60 }` |
| `areaBulkSum` | `area:GFI` + `area:DUPLEX`, group `area:E-2 / E-2.1` | `{ itemIds:['area:GFI','area:DUPLEX'], action:'answer', answerIndex:1 }` |
| `areaBulkKeep` | same | `{ …, answerIndex:0 }` |
| `scopeAnswer` | `scope:power_poles` options APT/GC/Owner | `{ itemIds:['scope:power_poles'], action:'answer', answer:'GC' }` |
| `scopeSuggested` | `scope:power_poles:furnish` suggested 'APT' | `{ itemIds:['scope:power_poles:furnish'], action:'answer', answer:'APT' }` |
| `scopeBulkAccept` | two suggested scope items, group scope | `{ itemIds:[…both], action:'answer', useSuggested:true }` |
| `reuseAnswer` | `reuse:PANEL` kind area, the two reuse options, actions answer | `{ itemIds:['reuse:PANEL'], action:'answer', answer:'New install — the old one is removed' }` |
| `demosuggestAnswer` | `demosuggest:LIGHT` options `['Use the suggestion — 4 removed','Keep all 11 — every one shown is removed','None removed — 0']`, actions answer/count | answer `'Keep all 11 — every one shown is removed'` |
| `demosuggestZero` | same | `{ itemIds:['demosuggest:LIGHT'], action:'count', qty:0 }` |
| `reclassifiedRestore` | `statuscrop:reclassified` with its two options | answer `'Restore — count them as new, as the tile pass read them'` |
| `assignAtAnswer` | `typicalassignat:PP-1..6:SIMPLEX` kind confirm, 2 options, actions answer | answer = option[1] |
| `conventionAnswer` | `remodel:conventions`, first 2 CONVENTION_OPTIONS | answer = option[0] |
| `unlistedCount` | `unlisted:H` aiCount 13, type 'H', options `['Same as Type A']`, actions answer/count/not_on_job | `{ itemIds:['unlisted:H'], action:'count', qty:13, reason:'4ft LED strip, surface mounted' }` |
| `unlistedSameAs` | same | `{ itemIds:['unlisted:H'], action:'answer', answer:'Same as Type A' }` |
| `unlistedNotOnJob` | same | `{ itemIds:['unlisted:H'], action:'not_on_job', reason:'Title block tag, not a fixture' }` |
| `legendMemberCount` | the B6 group (MS/OS/PC) | `{ itemIds:[GROUP_ID], action:'count', qty:6, memberKey:'OS' }` |
| `legendMemberNoj` | same | `{ itemIds:[GROUP_ID], action:'not_on_job', reason:'Design-build scope, not this job', memberKey:'MS' }` |
| `legendAllRemaining` | same | `{ itemIds:[GROUP_ID], action:'not_on_job', reason:'Design-build scope, not this job' }` |
| `gapfillMarkers` | GFCI_ITEM from the existing test | `{ itemIds:['gapfill:GFCI'], action:'markers', memberKey:'GFCI' }` |
| `gapfillReject` | same | `{ itemIds:['gapfill:GFCI'], action:'confirm', reason:'Suggested marks are dimension ticks, not GFCI receptacles', memberKey:'GFCI' }` |
| `reconcileCount` | S1S2_ITEM | `{ itemIds:['reconcile:S1+S2'], action:'count', qty:3, memberKey:'S1' }` |
| `needsHeads` | gapfill:S2 needs heads (existing test) | `{ itemIds:['gapfill:S2'], action:'count', qty:3, memberKey:'S2' }` |
| `assignCount` | `typicalassign:PP-1..6`, kind count, actions count/confirm, reconcileMembers `[{key:'#1 Office power pole', type:'#1 Office power pole', description:'1 × SIMPLEX', unit:'count', currentQty:0, headsPerPole:null}, {key:'#4 Tester power pole', …}]` | `{ itemIds:['typicalassign:PP-1..6'], action:'count', qty:1, memberKey:'#1 Office power pole' }` |
| `assignNone` | same | `{ itemIds:['typicalassign:PP-1..6'], action:'confirm', reason:'No tester pole on this job', memberKey:'#4 Tester power pole' }` |
| `confirmOnly` | `counting:not_run` kind confirm actions confirm | `{ itemIds:['counting:not_run'], action:'confirm', reason:'Checked E-3 by hand: 40 troffers' }` |
| `zeroBulkNoj` | `count:L`, `count:OS` group zero | `{ itemIds:['count:L','count:OS'], action:'not_on_job', reason:'Not in this remodel scope' }` |
| `sheetsBulkConfirm` | `sheet:a.pdf#2`, `sheet:a.pdf#3` kind confirm, group sheets | `{ itemIds:['sheet:a.pdf#2','sheet:a.pdf#3'], action:'confirm', reason:'Both are title sheets only' }` |
| `multiSelect` | `count:G`, `count:OS` (no group field) | `{ itemIds:['count:G','count:OS'], action:'not_on_job', reason:'Generic legend' }` |

Also export `REOPEN = { url:'/preconstruction/b1/review/reopen', body:{ itemId:'count:G' } }`.

`TakeoffReviewPanel.payloads.test.tsx` has one `it` per case, driving the **current** UI (radio + Save answer, shared reason box, etc.) and wrapping in `ConfirmProvider` for dialog cases. Each asserts `toStrictEqual(CASES.x.expected)` and the URL, plus `post` called exactly once.

**Acceptance:**
- [ ] All cases pass on unchanged main code.
- [ ] Committed on its own. Record the SHA in the commit message ("payload freeze").

---

## Task 1: Pure model (`review/reviewModel.ts`)

Move or define these (with a header comment: `// UI cleanup round 2A — pure helpers for the takeoff review panel.`):

1. `export { isRealReason } from '../../../estimating/LaborPricingStep'`. If that import would drag heavy modules into the panel, move `isRealReason` to `src/features/estimating/reasons.ts`, re-export it from LaborPricingStep, and import it in both places.
2. Move here unchanged: `resolutionText`, `actionsOf`, `groupKey` (add `if (i.id.startsWith('recount:')) return 'recount';` before the `:heads` line), and `GROUP_ORDER` (insert `'recount'` right after `'unreadable'`). Export them all.
3. `groupHeading(key: string): string`, the short headings:
 - zero → `Not found on the plans`
 - unreadable → `Couldn’t be read clearly`
 - `area…` → `Same area? ${key.replace(/^area:?/, '') || 'two plans of one level'}`
 - scope → `Scope questions`
 - legend-zero → `Legend items not found`
 - unscheduled → `Not on the fixture schedule`
 - remodel → `Remodel — new, existing, demolition`
 - unlisted → `Tags not on the schedule`
 - legend-unused → `Legend symbols not used — for information`
 - coverage → `Partly covered`
 - viewport → `Enlarged plans`
 - typical → `Typicals`
 - family → `Same fixture on two schedules`
 - gapfill → `Possible missed marks`
 - reconcile → `Schedule and plans don’t match`
 - synonym → `Same device, two names?`
 - consistency → `Dense-sheet second count`
 - classconflict → `One receptacle, two types?`
 - spotcheck → `Spot-checks — for information`
 - schedule → `Schedules not fully read`
 - heads → `Pole heads`
 - sheets → `Pages not counted`
 - refsheets → `Referenced sheets missing`
 - counting → `Counting`
 - recount → `Recount found fewer`
 - photometric → `Photometric sheet only — for information`
 - checklist → `Facility checklist — for information`
 - info → `By others — for information`
 - anything else → `Other`
 
 Delete `groupTitle` (no importers besides this file).
4. `unitsOf(item): { total: number; answered: number }`:
 - `groupedTypes?.length` → total = members, answered = members with `resolution`;
 - `reconcileMembers?.length` → answered = members with `resolution && !resolution.needs`;
 - otherwise 1 / `resolution ? 1 : 0`;
 - if `item.resolution` is set, answered = total.
5. `reviewProgress(items): { total; answered; open }` sums `unitsOf` over `items.filter(i => i.blocking !== false)`, with `open = total - answered`.
6. `orderedGroups(openItems): Array<{ key; items; info: boolean }>`: the existing Map + sort code (lines 665-668) moved here, with `info = items.every(i => i.blocking === false)`.
7. `openOrder(openItems): string[]` flattens `orderedGroups`, **non-info groups only**.
8. `cardKindOf(item): 'legendGroup' | 'typicalAssign' | 'reconcile' | 'unlisted' | 'choice' | 'quantity' | 'count' | 'confirm'`, checked in this order:
 - `groupedTypes?.length` → legendGroup;
 - `id.startsWith('typicalassign:') && reconcileMembers?.length` → typicalAssign;
 - `reconcileMembers?.length` → reconcile;
 - `id.startsWith('unlisted:')` → unlisted;
 - `acts.includes('answer')` → choice;
 - `acts.includes('confirm') && acts.includes('count')` → quantity;
 - `acts.includes('count')` → count;
 - else confirm.
9. `notOnJobFirst(item)` is `actionsOf(item).includes('not_on_job') && item.id.startsWith('count:') && !item.id.endsWith(':heads')`.
10. `reasonPresets(item, action: 'not_on_job' | 'confirm' | 'keep'): string[]`. Returns `[]` when `item.category === 'equipment'`. Otherwise:
  - `not_on_job` → `['Not shown on the plans for this job', 'On the legend only — not used on this job', 'By others — not in APT’s scope', 'Existing to remain — no new work']`
  - `keep` (reconcile/typicalassign confirm, "keep current count") → `['Checked the plans — keep the current count']`
  - `confirm`, by prefix:
    - `spotcheck:` → `['Checked these marks on the plans — they are right']`
    - `sheet:` / `file:` → `['Checked — nothing on this page is missing from the takeoff']`
    - `refsheet:` → `['Checked — the takeoff doesn’t need this sheet']`
    - `demosheet` → `['Added the demolition in Labor & Pricing']`
    - `schedule:` / `panel-dup:` → `['Checked the circuits in Labor & Pricing']`
    - `counting:` → `['Checked the fixture and device quantities by hand']`
    - kind count with `aiCount != null` → ``[`Checked on the plans — ${item.aiCount} is right`]``
    - default → `['Checked — the takeoff is right as it is']`
11. `choiceLabel(item, option, index): { label: string; hint?: string }`:
  - `area:`: `/^Same area — keep (\d+)$/` → `Same area — keep the larger ($1)`; `/^Different areas — sum (\d+)$/` → `Different areas — add them ($1)`.
  - `reuse:`: an option starting `Existing, reused` → `{label:'Existing reused', hint:'no new install, no demolition'}`; one starting `New install` → `{label:'New install', hint:'the old one is removed'}`.
  - otherwise `{label: option}`. If a regex doesn't match, fall back to the option text.
  - **The payload always uses `option`, never the label.**

**Tests (`reviewModel.test.ts`):**
- every string from every `reasonPresets` branch passes `isRealReason`, and equipment gets `[]`;
- `cardKindOf` for one sample of every row in the "What I found" table;
- `unitsOf` / `reviewProgress`: a legend group with 1 of 3 answered gives 1/3; a reconcile member with `needs` is not answered; info items are excluded; a carried-over resolution counts as answered;
- `groupKey('recount:A')` is `'recount'`, and it sorts after `'unreadable'`;
- `orderedGroups` order matches the existing N8 expectations;
- `choiceLabel` for area and reuse, plus the fallback.

**Acceptance:**
- [ ] The panel imports these helpers. No behavior change yet, so all old tests and the Task 0 tests still pass.

---

## Task 2: ReasonPicker and ReviewCardShell

### 2a. `ReasonPicker.tsx`
```ts
interface ReasonPickerProps {
idBase: string;            // testid prefix, e.g. `groupmember-noj-${mid}`
inputLabel: string;        // aria-label of the typed box, keep the existing wording ("Why X is not on this job", "Why you confirm X", "Why no more X on this job")
inputTestId?: string;      // keep the existing testids: groupmember-reason-input-…, reconcilemember-reason-input-…
presets: string[];
busy: boolean;
onSave: (reason: string) => void;
onCancel: () => void;
}
```
- Render `<div className="tr-reason" role="group" aria-label="Why?">` containing:
- a label `Why?`;
- one `btn ghost sm tr-reason-preset` button per preset. A click calls `onSave(preset)` directly;
- a text input: placeholder `Or type your own reason`, `aria-label={inputLabel}`, `data-testid={inputTestId}`;
- a `btn primary sm` button "Save reason" (`data-testid={`${idBase}-save`}`), disabled until `isRealReason(text) && !busy`, sending `onSave(text)` with the text **untrimmed**;
- a `tr-link` "Cancel" button.
- After the user has typed something (touched) and it fails `isRealReason`, show `<span className="tr-sub">A few more words, please (at least 10 characters).</span>`.
- With `presets.length === 0`, show `<span className="tr-sub">Equipment needs a typed reason.</span>`. The only way this happens is an equipment item.
- Focus: on mount, focus the first preset, or the text input if there are none. Escape inside the group calls `onCancel`, and the **caller** returns focus to the trigger (keep a ref).
- The trigger button that opens it gets `aria-expanded` and `aria-controls` pointing at the picker id.

### 2b. `ReviewCardShell.tsx`
Props: `{ item; selectable?: { checked: boolean; onChange: (v: boolean) => void }; children }`. Render:
```
<li className="tr-item tr-card" data-testid={`review-item-${id}`} data-review-id={id} tabIndex={-1} aria-labelledby={titleId}>
<div className="tr-item-head">[checkbox aria-label={`Select ${title}`}] <strong id={titleId}>{title}</strong> {chips}</div>
<div className={`tr-detail${long && !open ? ' tr-detail-clamp' : ''}`}>{detail}</div>
{hasMore && <button type="button" className="tr-link" aria-expanded={open} aria-controls={moreId} data-testid={`review-details-toggle-${id}`}>{open ? 'Hide details' : 'Details'}</button>}
<div id={moreId} hidden={!open} data-testid={`review-details-${id}`}>AI saw: … · notes list</div>
{previousResolution && <div className="tr-sub tr-earlier" data-testid={`review-previous-${id}`}>Earlier answer (the drawings or counts changed — check it again): {resolutionText(...)}</div>}
{children}
{refsheet upload block (unchanged, moved here)} {counting type-entry block (unchanged, moved here)}
</li>
```
- `long = detail.length > 180`. `hasMore = long || sheets.length > 0 || notes.length > 0`.
- The details region is **always rendered**, using `hidden`, so its text stays in `textContent`. The existing test that looks for "AI count: 8 power poles" keeps working.
- The earlier-answer line is **always visible**.
- Chips are unchanged: Scope question, Same area?.
- The count-types entry needs `typesText` and `saveTypes` from the panel. Pass them as props (`onSaveTypes`) or keep that block in the panel and pass it in as `extra`. Either is fine; keep its markup and copy.

**Tests:** these arrive with Task 3's card tests (`ReviewCardShell` covered via the panel):
- the Details toggle flips `aria-expanded` and removes `hidden`;
- a long detail gets the `tr-detail-clamp` class until the toggle is opened;
- the earlier-answer line shows without opening Details;
- ReasonPicker: a preset click sends the exact preset text; typed text shorter than 10 characters keeps Save disabled and shows the hint; Cancel returns focus to the trigger.

---

## Task 3: One card per kind (`reviewCards.tsx`, `TypicalAssignCard.tsx`) and wiring

Common card props:
```ts
interface CardProps {
item: ReviewItem;
busy: boolean;
resolve: (itemIds: string[], body: Record<string, unknown>, key: string) => Promise<boolean>;
}
```
`resolve` in the panel now returns `true` on success and `false` on error (the error toast is unchanged). Local input state (qty, typed name, open picker) lives **inside each card** with `useState`. Remove the panel-level `qty`, `reason` and `answer` maps. The panel keeps `selected` (multi-select), `groupReason`, `bulkReason`, `busy`, `extras` and `typesText`. The panel renders `cardFor(item)` by switching on `cardKindOf(item)` inside `ReviewCardShell`. Pass `selectable` only when the old checkbox condition holds: `actionsOf(item).includes('not_on_job') && !item.groupedTypes?.length && item.category !== 'equipment'`.

In the copy below, "trigger" is a button that opens a ReasonPicker (Task 2a) under the row.

**CountCard** (count, not_on_job, markers?):
- If `notOnJobFirst(item)`, the row is:
- `[Not on this job]`: `btn primary sm`, trigger;
- `<span className="tr-sub">or it’s here:</span>`;
- `[qty input aria-label={`Count for ${title}`} placeholder="Count"]` and `[Save count]` (ghost; disabled while `!qty || busy`);
- `[Use confirmed markers]` (ghost; only if acts includes markers).
- Otherwise (heads, typical, typicalqty, unscheduled, demounit, photo):
- qty input and `[Save count]` (primary);
- `[Use confirmed markers]` if allowed;
- `[Not on this job]` (ghost trigger).
- Payloads:
- count: `{action:'count', qty:Number(qty)}`, **with no reason key**;
- markers: `{action:'markers'}`;
- picker: `{action:'not_on_job', reason}`.
- Keep `min={item.id.startsWith('demosuggest:') ? 0 : 1}`.
- Busy keys are unchanged: `count:${id}`, `markers:${id}`, `noj:${id}`.
- The picker's `inputLabel` is `Why ${title} is not on this job`, and its presets are `reasonPresets(item,'not_on_job')`.

**QuantityCard** (count + confirm: recount, status, coverage, democompare):
- primary trigger `[Confirm AI count {aiCount}]` (just `Confirm` if `aiCount == null`), opening a picker with `reasonPresets(item,'confirm')` and inputLabel `Why you confirm ${title}` → `{action:'confirm', reason}`;
- `<span className="tr-sub">or enter the right count:</span>`, then qty and `[Save count]`;
- coverage also gets `[Use confirmed markers]` and a `[Not on this job]` trigger.

**ChoiceCard** (any `answer` item):
- `<div className="tr-actions tr-choices" role="group" aria-label={item.question ?? item.title}>` with one `<button type="button" className={o === item.suggested ? 'btn primary sm' : 'btn ghost sm'}>` per option:
- label from `choiceLabel`, and the hint as `<span className="tr-choice-hint">`;
- if the option is suggested, add a `<span className="tr-chip tr-chip-q">Suggested</span>` after the label;
- a click posts `{action:'answer', answer:o}` **immediately**, with busy key `ans:${id}`.
- If `item.suggested`, add the line `<span className="tr-sub">Suggested: {suggested}: the drawings say “by G.C.”, which is APT’s scope.</span>`.
- If acts also includes count (area, viewport, schedqty, demodup, demosuggest), add a secondary row: `<span className="tr-sub">or enter a different count:</span>`, qty (min 0 for `demosuggest:`) and `[Save count]` → `{action:'count', qty}`.
- If `options` is empty but acts includes answer, render the count row only, or nothing plus `<span className="tr-sub">No choices were sent for this item — re-run the analysis.</span>`.

**ConfirmCard** (confirm only): a single `[Confirm]` trigger (ghost) with a picker using `reasonPresets(item,'confirm')` and inputLabel `Why you confirm ${title}` → `{action:'confirm', reason}`.

**UnlistedCard**:
- Row 1, "It’s a new type":
- text input `aria-label={`What is Type ${item.type ?? ''}?`}`, placeholder `What is it? e.g. 4 ft LED strip, surface mounted`;
- qty `aria-label={`Count for ${title}`}` with placeholder `${aiCount ?? 'Count'}`;
- `[Save count]` (primary), disabled until `qty && isRealReason(name) && !busy`, → `{action:'count', qty:Number(qty), reason:name}`;
- hint when the name is touched and too short: `Say what it is in a few words (at least 10 characters). It becomes the line name.`
- Row 2 (only if acts includes answer and options exist): `Or it’s the same as:`, then `<select aria-label="Same as which type?">` with a first empty option `Pick a type…` and one option per item option, then `[Save]` (`data-testid={`unlisted-same-save-${id}`}`, disabled until picked) → `{action:'answer', answer}`.
- Row 3: a `[Not on this job]` ghost trigger with not_on_job presets → `{action:'not_on_job', reason}`.

**LegendGroupCard** (the B6 markup moved over; testids kept):
- Head line: `{answered} of {total} answered` (`tr-sub`).
- Each unanswered member `<li data-member-key data-member-open="true" tabIndex={-1}>` has:
- `[Not on this job]` trigger, `data-testid={`groupmember-noj-${mid}`}`; its picker uses `inputTestId={`groupmember-reason-input-${mid}`}` and `idBase={`groupmember-noj-${mid}`}`, so Save is `groupmember-noj-${mid}-save`; presets are the not_on_job ones;
- qty `groupmember-qty-${mid}` and Save count `groupmember-count-${mid}`.
- Payloads keep `memberKey: m.key`.
- An answered member shows the `review-groupmember-done-${mid}` line, as today.
- "Mark all N remaining" stays as it is: typed reason (testids `group-noj-all-reason-…` / `group-noj-all-button-…`) plus the confirm dialog. The card calls `useConfirm()` itself.

**ReconcileCard** (gapfill, reconcile, consistency, statuscrop:low; the existing markup moved over):
- `[Confirm the found marks on the plans]` (if markers) → `{action:'markers', memberKey}`;
- qty and `[Enter correct count]` → `{action:'count', qty, memberKey}`;
- `[No more on this job — keep current count N]`, now a **trigger** keeping `data-testid={`reconcilemember-reject-${mid}`}`; its picker uses `inputTestId={`reconcilemember-reason-input-${mid}`}`, `reasonPresets(item,'keep')` and inputLabel `Why no more ${m.type} on this job` → `{action:'confirm', reason, memberKey}`;
- the needs-heads/poles row is unchanged.
- Member rows get `data-member-open`/`tabIndex={-1}` like LegendGroupCard.

**TypicalAssignCard.tsx**:
- A self-contained file with the header comment: `// UI cleanup round 2A — typicalassign only, kept in its own file on purpose: feat/accuracy-reading B3 turns these members into one-per-pole selects ({memberKey, answer}); that change replaces this file's body and nothing else.`
- It renders exactly the current reconcile-branch controls for these members (no markers, since the actions don't include it), with plainer labels:
- qty `aria-label={`How many ${m.type}`}` with `[Save]` → `{action:'count', qty, memberKey}` (busy key `rcmember:${mid}`);
- `[None of this type]` trigger (testid `assign-none-${mid}`) with `reasonPresets(item,'keep')` → `{action:'confirm', reason, memberKey}`.
- It shows `m.description` (package and suggestion) as-is.
- Don't try to fix the "answers don't add up needs a reason" gap. Leave a `// Known gap (see plan 2A):` comment.
- It imports only `ReviewItem`, `ReasonPicker`, `reasonPresets` and `isRealReason`, so the accuracy branch can swap it cleanly.

**Payload test migration:** rewrite each driver in `TakeoffReviewPanel.payloads.test.tsx` for the new UI. The **expected bodies come from `CASES`, unchanged.** Add a `NEW_UI_ONLY` section to `payloadCases.ts` (additive) with:
- `zeroNotOnJobPreset`: `{itemIds:['count:OS'], action:'not_on_job', reason:'Not shown on the plans for this job'}`;
- `coverageConfirmPreset`: reason `'Checked on the plans — 9 is right'`;
- `gapfillRejectPreset`: reason `'Checked the plans — keep the current count'`;
- `equipmentNoPresets`: an equipment `count:MB` item whose picker shows no presets, only the typed path.

**Existing test file updates (`TakeoffReviewPanel.test.tsx`):** swap drivers only; keep what each test proves.
- "Not on this job is disabled until a reason is typed": click the OS card's trigger, then check `Save reason` is disabled, type, check it is enabled, and check the payload.
- Scope, A6 and B4 now click option buttons. A6 checks the APT button has class `primary` and a `Suggested` chip. B4 clicks `Different areas — add them (75)` and expects answer `'Different areas — sum 75'`. Where the group is collapsed (from Task 4), use `fireEvent.click` on hidden elements, or expand the group first.
- S16 equipment: open the MB trigger. The typed input `Why Type MB — Meter base is not on this job` exists and no presets render. Save through `Save reason`.
- B2 `counting:not_run`: click `Confirm`, type in `/Why you confirm/`, click `Save reason`.
- B6 member not-on-job: open the trigger `groupmember-noj-…`, type in `groupmember-reason-input-…`, save with `groupmember-noj-…-save`.
- B10: click `No more on this job — keep current count 7`, type in `reconcilemember-reason-input-…`, save with `reconcilemember-reject-…-save`.
- Remodel/unlisted: `getByPlaceholderText(/What is it\?/)` still matches. `getByText('Same as Type A')` matches the `<option>`.

**Acceptance:**
- [ ] Every Task 0 case passes against the new UI with identical expected bodies.
- [ ] A zero card shows at most three buttons plus a qty box, with no text box until "Not on this job" is clicked.
- [ ] Equipment never shows presets and never shows a checkbox.
- [ ] `TypicalAssignCard.tsx` imports nothing from `reviewCards.tsx`, and nothing else renders typicalassign.

---

## Task 4: Groups: collapsed by default, short headings, open count

In the panel, use `orderedGroups(open)`:
- `const [expanded, setExpanded] = useState<Record<string, boolean>>({});`
- `firstKey` = the first non-info group key. `isExpanded(k) = expanded[k] ?? k === firstKey`. When the first group is emptied, it drops out of `open`, so the next one becomes `firstKey` and opens by default. A group the user collapsed on purpose stays collapsed.
- Blocking group markup:
```
<section className="tr-group" data-testid={`review-group-${key}`}>
  <h4 className="tr-group-title">
    <button type="button" className="tr-group-toggle" aria-expanded={x} aria-controls={bodyId} data-testid={`review-group-toggle-${key}`} onClick={() => setExpanded(e => ({ ...e, [key]: !x }))}>
      <Icon name="chevron-down" size={14} stroke={2} style={x ? undefined : { transform: 'rotate(-90deg)' }} />
      <span>{groupHeading(key)}</span>
      <span className="tr-group-count">{openUnits} open</span>
    </button>
  </h4>
  <div id={bodyId} hidden={!x}>{bulk}<ul className="tr-list">…</ul></div>
</section>
```
- `openUnits` = the sum of `unitsOf(i).total - unitsOf(i).answered` over the group's items.
- `bodyId` = `${useId()}-g${index}`, because keys contain spaces and slashes.
- Bodies render with `hidden`; they are not unmounted, so typed values and state survive a collapse.
- Info groups stay `<details>` (tests check the tag), with the summary `${groupHeading(key)} (${items.length})`.
- Bulk bars stay inside the group body with the same testids and logic. Relabel only:
- `All same area — keep the larger` and `All different areas — add them`;
- the reason placeholder `Reason for all of them (a short sentence)`, with aria-label `Reason for all of ${groupHeading(key)}`;
- keep `Accept the pre-filled answers (N)`, `Mark all N not on this job` and `Confirm all N`, and their dialogs.

**Tests:**
- Only the first blocking group has `aria-expanded="true"`, and the others have their body `hidden`.
- A toggle click flips it, and a typed qty survives collapse and re-expand.
- Answering the last item of the first group, with the harness from Task 6, auto-expands the next group.
- The heading text shows `Not found on the plans` and `2 open`.
- A legend group of 3 with 1 answered shows `2 open`.
- The info group is still `DETAILS`.
- Update the heading expectations in these existing tests: "evidence round", "N8 order" (needles `Not found on the plans`, `Same fixture`, `Possible missed marks`, `Schedule and plans`, `Scope questions`, `Spot-checks`), "Real-run fixes 2/5", "Remodel A1-A3" and A7 (`Same area? E-2 / E-2.1`). `.tr-group-title` textContent now includes the count, so use `startsWith(heading)`.

**Acceptance:**
- [ ] The 33-item run shows about 10 group headings, with only the first open.
- [ ] Headings fit on one line at 1280px.

---

## Task 5: Progress header, "Next unanswered", panel Details

- Header:
- the status chip is unchanged, but `open` now comes from `reviewProgress(items).open` (units). The existing tests' 4 / 6 still hold;
- `Counted on …` moves into the panel Details;
- `Counting did not run: …` and ` · Not counted: E-1, …` stay **visible** (`tr-summary tr-warn-text`).
- The "Counting details" button becomes `Details` (`data-testid="takeoff-review-details-toggle"`, `aria-expanded`, `aria-controls="…-panel-details"`). It renders when `countResult || extras.accountRule`. The region is always rendered with `hidden` and contains:
- `Counted on …`;
- `<div data-testid="takeoff-review-rule">Account rule: {name} ({matchedBy})</div>`;
- the existing `takeoff-count-details` block (unchanged content).
- The account rule warning stays visible under the header: `<div className="tr-warn" data-testid="takeoff-review-rule-warning">`.
- Progress row (when `status === 'needs_review' && total > 0`):
```
<div className="tr-progress" data-testid="takeoff-review-progress">
  <span aria-live="polite" data-testid="takeoff-review-progress-text">{answered} of {total} answered</span>
  <div className="tr-progress-bar" role="progressbar" aria-label="Review questions answered" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered}><div className="tr-progress-fill" style={{ width: `${Math.round(answered / total * 100)}%` }} /></div>
  {open > 0 && <button type="button" className="btn ghost sm" data-testid="takeoff-review-next" onClick={goNext}>Next unanswered</button>}
</div>
```
- The blocking note becomes: `The proposal can’t be made or sent until every question here is answered.` (keep `tr-note`).
- `goNext`:
- `order = openOrder(open)`;
- `cur` = the `data-review-id` of `document.activeElement?.closest('[data-review-id]')`;
- target = the first id in `order` after `cur`, else `order[0]`;
- then `setFocusTarget({ id: target })` (Task 6 does the expand, focus and `scrollIntoView?.({ block: 'center' })`).
- Pending and clear states: no progress row and no next button.

**Tests:**
- `2 of 5 answered` with 1 resolved item and a legend group of 3 with 1 answered: units = 1 + 3 + … Build the fixture so the numbers are exact.
- The progressbar `aria-valuenow` is right.
- Next unanswered focuses the first open item's card and expands its group.
- A second click moves to the next item, and it wraps around.
- The counting-details test clicks `Details` and still finds all four strings.
- S8 checks `takeoff-review-rule-warning` contains "matched no account rule", and the rule name is in `takeoff-review-rule`.

---

## Task 6: Focus after an answer folds away

- The panel has `const [focusTarget, setFocusTarget] = useState<{ id: string } | null>(null)` and `const panelRef = useRef<HTMLElement>(null)` on the `<section>`.
- In `resolve(itemIds, …)`:
- before the POST, snapshot `before = openOrder(open)`;
- on success, with `data.items`: `stillOpen = new Set(data.items.filter(i => !i.resolution && i.blocking !== false).map(i => i.id))`;
- if `itemIds[0]` is still open (a member answer), set the target to `{ id: itemIds[0] }`;
- otherwise take the last index in `before` of any of `itemIds`; the target is the first id after it in `before` that is in `stillOpen`, else the first of `openOrder(new open)`, else `{ id: '__status' }`.
- Effect on `[focusTarget, review.items, expanded]`:
- find the target's group key (`groupKey(item)`). If that group is collapsed, `setExpanded(e => ({ ...e, [k]: true }))` and return; the effect runs again.
- Otherwise find the card by looping over `panelRef.current.querySelectorAll('[data-review-id]')` and matching `dataset.reviewId`. Don't use CSS.escape; ids have spaces and slashes.
- Focus `card.querySelector('[data-member-open="true"]') ?? card`, call `scrollIntoView?.({ block: 'center' })`, then `setFocusTarget(null)`.
- For `__status`, focus the status chip, which gets `tabIndex={-1}`.
- Reopen doesn't move focus.
- An error doesn't move focus. The picker stays open with its typed text.

**Tests** (use a harness `function Harness({ initial })` that holds `review` in state and passes `onReviewChange={setReview}`, with `post` resolving to the next review):
1. Answer `count:G` → the card is gone from the open list, it shows in `N resolved`, and `document.activeElement` is the `count:OS` card.
2. Answer the last item of group 1 → focus lands on the first card of group 2, and that group is now expanded.
3. Answer a legend-group member → the card stays, and focus is on the next unanswered member row.
4. Answer the last open item → focus is on the status chip, which reads `Takeoff review clear`.
5. A server error → no focus change, and the picker text is kept.
6. A bulk "Mark all 2 not on this job" (through the dialog) → focus moves to the next item after the group.

---

## Task 7: CSS and final pass

Add to `takeoffReview.css` under `/* UI cleanup round 2A — review cards, groups, progress. */`:
- `.tr-card:focus-visible{outline:2px solid var(--blue);outline-offset:2px}` and `.tr-card[data-member-open]:focus-visible` the same.
- `.tr-detail-clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}`
- `.tr-link{background:none;border:none;padding:0;font:inherit;font-size:12px;font-weight:700;color:var(--blue);text-decoration:underline;cursor:pointer}` and `.tr-link:focus-visible{outline:2px solid var(--blue);outline-offset:2px}`
- `.tr-group-toggle{display:flex;align-items:center;gap:6px;width:100%;background:none;border:none;padding:4px 0;font:inherit;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--text2);cursor:pointer;text-align:left}`, plus `.tr-group-count{margin-left:auto;text-transform:none;letter-spacing:0;color:var(--amber);font-weight:800}`
- `.tr-progress{display:flex;align-items:center;gap:10px;margin-top:10px;font-size:12.5px;font-weight:700;color:var(--text2)}`, `.tr-progress-bar{flex:1;height:6px;border-radius:999px;background:var(--surface2);border:1px solid var(--border2);overflow:hidden}`, `.tr-progress-fill{height:100%;background:var(--green)}`
- `.tr-choices .btn{height:auto;min-height:32px;flex-direction:column;align-items:flex-start;gap:0;padding:6px 12px}` and `.tr-choice-hint{font-size:11px;font-weight:600;opacity:.8}`
- `.tr-reason{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px;padding:8px;border:1px dashed var(--border2);border-radius:8px}`
- Mobile (≤700px): `.tr-choices .btn{width:100%}` and `.tr-reason input{width:100%}`.
- Remove the old `.tr-radio` class if nothing uses it any more.

Final: `npx tsc --noEmit`, `npx vitest run` (full suite), and `git diff main --stat -- ../backend` is empty.

**Acceptance (whole round):**
- [ ] The 33-item real run fits in about one screen when collapsed, and the progress bar and Next unanswered work by keyboard only.
- [ ] Every Task 0 body is unchanged, and `payloadCases.ts`'s frozen section diff since the Task 0 SHA is empty.
- [ ] Every confirm dialog is still in place, the proposal is still blocked, and warnings are still visible.

---

## Reviewer focus
1. **Payload parity.** `git diff <task0-sha> -- review/payloadCases.ts` shows only additions under `NEW_UI_ONLY`. Parity tests use `toStrictEqual`. Plain counts no longer carry an accidental `reason` (before, typing in the shared box leaked it into `count`). That is the one intended difference, and only in that edge case. Unlisted counts still send `reason: <name>`.
2. **Preset reasons are a Jake decision point.** They are stored on the resolution, shown in the resolved list, and for `kind:'confirm'` items they reach Agent 4's prompt. Check that every preset is an honest thing the estimator is attesting to, and that each passes `isRealReason`. Equipment and all bulk actions still need typed reasons. Nothing in `isRealReason` or the backend changes.
3. **One-click choice buttons save immediately** (there was a Save answer step before). Confirm `busy` disables every button during the POST and that Reopen is reachable. Flag this to Jake.
4. **Collapsed means `hidden`, not unmounted.** Check no test relies on `getByRole` inside a collapsed group. Check the focus effect expands a group before focusing, because a `hidden` element can't take focus.
5. **The open count is now in units** (legend and reconcile members). Check the chip, heading counts and progress agree, and that no other consumer parses "Needs review — N open" (searched: none).
6. **typicalassign isolation.** `TypicalAssignCard.tsx` stands alone. Record the known gap: a count answer that doesn't add up can't carry a reason. Hand this to the accuracy-reading B3 owner; whoever merges second ports B3's select into this file.
7. **Warnings stay visible:** the account-rule warning, "Counting did not run", "Not counted: …", and the earlier-answer lines.
8. **No backend diff, no PcWorkspaceView diff.** The mount is unchanged, and the `key={review-${resultsEpoch}}` reset of expanded state on a re-run is intended.

### Critical Files for Implementation
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/preconstruction/PcWorkspace/TakeoffReviewPanel.tsx
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/preconstruction/PcWorkspace/TakeoffReviewPanel.test.tsx
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/preconstruction/PcWorkspace/takeoffReview.css
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/ai/reviewItems.ts (reference only: `validateResolution`, `isRealReason`, item builders)
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/estimating/takeoffReview.ts (reference only: `applyResolution` per-member and bulk rules)
