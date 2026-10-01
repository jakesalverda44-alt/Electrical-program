# Review: Estimating UI cleanup, round 2A (takeoff review questions)

Branch `feat/estimating-ui-round2a`, 99f3766..e5204fe on base 7a5c757. Opus review, 2026-09-30.

## Verdict: MERGE AFTER FIXES

The structure is sound. The payload freeze is real, and every request body the old panel could send is still sent byte for byte. Blocking semantics, bulk confirm dialogs, Reopen, the re-run reset, the warnings and the Earlier-answer line are all intact. What blocks the merge is the ready-made reasons: two of them let one click record an attestation that is either false or far bigger than what the estimator checked.

### What I verified
- **The freeze predates the UI change.** I extracted 99f3766 with `git archive` and ran its payload and panel tests against the OLD panel: 79/79 pass. `git diff 99f3766 -- review/payloadCases.ts` changes only the line after the `NEW_UI_ONLY` marker. The parity loop asserts `toStrictEqual` and has a driver-set == CASES-set check.
- **Coverage across kinds and actions.** I listed every `actions:` combination the backend emits in `ai/reviewItems.ts`: [answer], [confirm], [count,markers,not_on_job], [count,not_on_job], [count,confirm], [answer,count], [answer,count,not_on_job], [count,markers,confirm,not_on_job], [markers,confirm,count] and [confirm,count]. Each one maps to a card that renders all of its actions (`cardKindOf`). No action is dropped. `consistency:` and `statuscrop:low` (members) use ReconcileCard, the same code path as gapfill. `legend-unused:` uses LegendGroupCard.
- **Presets pass the backend check.** Every preset passes `isRealReason` (10+ chars, a 3-letter word). `validateResolution` accepts them for `not_on_job` and `confirm`. No backend diff and no PcWorkspaceView diff (the `key={review-${resultsEpoch}}` reset is unchanged).
- **Busy handling.** `busy` disables every choice, preset, Save, Reopen and bulk button during a POST. The flow tests cover focus after an answer, after an error, after a bulk dialog and after Reopen.
- **Test runs.** Panel, payload, flow, cards and model tests plus all of `estimating/`: 903/903 pass. `tsc --noEmit` is clean. The full frontend run was 1581/1581 on one run. Other runs each had one different timing flake in untouched files (SurveyMarkupEditor, PlanViewer), not related to this diff.

---

## Blockers

### B1. One click clears "counts not verified" for the whole job
`review/reviewModel.ts:189`: `if (id.startsWith('counting:')) return ['Checked the fixture and device quantities by hand'];`

- **Failure scenario.** Counting did not run, or no schedule or legend was found (`counting:not_run` / `counting:no_schedule`, kind `confirm`). The entire fixture and device takeoff is Agent 1's unverified reading. The estimator clicks Confirm, then the first preset (it is auto-focused). The gate clears. `reviewResolutionsForAgent4` then injects "confirmed by the estimator (Checked the fixture and device quantities by hand)" into Agent 4's prompt under "AUTHORITATIVE". This is the single largest dollar-risk item in the review, and it now takes the same effort as dismissing a title sheet. Before this branch, it needed a typed reason.
- **Fix.** Return `[]` for `counting:*`, so the reason must be typed like equipment. Generalise the "Equipment needs a typed reason." hint in `ReasonPicker.tsx:56` to "This one needs a typed reason." Add a NEW_UI_ONLY case that asserts no preset buttons appear on `counting:not_run`.

### B2. "Not on this job" presets say things the item itself contradicts
`review/reviewModel.ts:179-181`, used from `reviewCards.tsx:28` (ItemReason) and `:254` (legend members).

- **Failure scenario.** The `not_on_job` presets were written for zero-count items ("Not shown on the plans for this job", "On the legend only — not used on this job"). They are offered on EVERY item that has `not_on_job`, including items that were FOUND on the plans:
  - `unlisted:H`: "Type H drawn 13× on E2.0"
  - `unscheduled:*`: a fixture drawn but not scheduled
  - `typical:*` and `typicalqty:*`
  - `demounit:*`: "12 counted — no demolition labor unit"
  - `count:*:heads`: the poles were counted
  - `coverage:*`: counted on 2 of 3 sheets

  One click stores "Not shown on the plans for this job" on a type the AI saw 13 times. That is a false record in the resolved list and in the job's audit trail, and the type is dropped from the takeoff.
- **Fix.** Return the four `not_on_job` presets only when `notOnJobFirst(item)` is true (zero-count `count:*`, not `:heads`) or for legend-zero members. Return `[]` for every other item, so the reason is typed. Add a NEW_UI_ONLY case that asserts `unlisted:H` and `unscheduled:*` show no presets.

---

## Should-fix

### S1. typicalassign "None of this type" reuses the "keep" preset, and the preset can justify a host-count mismatch
`review/TypicalAssignCard.tsx:52`: `presets={reasonPresets(item, 'keep')}` gives "Checked the plans — keep the current count".

- **Failure scenario.** The button says "None of this type", but the stored reason says "keep the current count", so the two don't match. Worse, the backend passes `input.reason` into `checkHostAssignmentAnswer` (`backend/src/estimating/takeoffReview.ts:384`). When "None" is the LAST member answered and the totals don't add up to the host count, the backend accepts it with this canned text as the mismatch justification. It records "answers add up to 4 of 6: Checked the plans — keep the current count", and the estimator never wrote anything about the mismatch. Before, they had to type it.
- **Fix.** Pass `presets={[]}` here, so the reason is typed. That also keeps this file a clean swap target for B3. Separately, the comment at `TypicalAssignCard.tsx:37-39` says "(confirm, qty 0)", but the backend stores `qty: t.currentQty`. Correct the comment.

### S2. "By others — not in APT's scope" invites the GC-furnished mistake
`review/reviewModel.ts:180`.

- **Failure scenario.** A type is marked "by G.C." on the drawings, which is APT scope under Jake's rule. The estimator reads "by others" as covering it and picks this preset, and an APT line is dropped as not on this job.
- **Fix.** Reword to "Another trade or the owner provides it — not APT’s scope (GC-furnished is ours)", or remove the preset.

### S3. Group "N open" counts information items; the chip and progress don't
`TakeoffReviewPanel.tsx:503` sums `unitsOf` over every item in the group. `reviewProgress` skips `blocking === false`.

- **Failure scenario.** The backend's `groupOf` puts non-blocking items into the same group as blocking ones for `remodel`, `unlisted`, `schedule` and `reconcile`. An example is a stored `remodel:conventions` next to an open `reuse:` item. The heading then says "2 open", the chip says "1 open", and the progress row agrees with the chip. Reviewer focus #5 requires these three to agree. `openOrder` (`reviewModel.ts:151`) also includes those info items, so "Next unanswered" can land on one.
- **Fix.** Use `items.filter(i => i.blocking !== false)` in `openUnits` and in `openOrder`.

### S4. The auto-focused preset can be fired by a held or stray Enter
`review/ReasonPicker.tsx:32` focuses the first preset button when the picker opens.

- **Failure scenario.** A keyboard user presses Enter on "Not on this job" or "Confirm". The picker mounts and focus moves to a preset that saves on activation. Enter auto-repeat, or the next Enter or Space the user presses expecting to land in the box, saves that preset immediately. A mouse user who clicks the trigger also has focus parked on a one-click save. This is the "fires on keyboard focus" case the review was asked to rule out.
- **Fix.** Focus the typed input, or the picker group with `tabIndex={-1}`, instead of a preset. Also ignore `e.repeat` in the input's Enter handler.

### S5. The panel-dup confirm preset doesn't say which answer was chosen
`review/reviewModel.ts:188`: `panel-dup:` (the kind `confirm` variant) gets "Checked the circuits in Labor & Pricing".

- **Failure scenario.** The item asks "two panels or one?" and says both are summed now. The preset tells Agent 4 "confirmed by the estimator (Checked the circuits in Labor & Pricing)". That doesn't say whether these are two panels (keep both) or one panel already corrected, so Agent 4 can't tell whether the summed circuits are right.
- **Fix.** Use two explicit presets: "Two separate panels — both are right" and "Same panel — corrected the circuits in Labor & Pricing". Or make this one typed-only.

### S6. QuantityCard's markers and not-on-job paths have no parity case
`review/payloadCases.ts` and the payload test.

- **Failure scenario.** `coverage:SL` offers markers and not_on_job through QuantityCard (`reviewCards.tsx:106-110`), a separate render branch from CountCard, but only its confirm is driven. `recount:` confirm and the `needs: 'poles'` member are also never driven. The bodies are simple, but these are exactly the paths a future edit can break unnoticed.
- **Fix.** Add NEW_UI_ONLY cases `coverageMarkers` `{itemIds:['coverage:SL'],action:'markers'}`, `coverageNotOnJob` (typed reason) and `recountConfirm` (typed reason).

---

## Nits

- **N1.** `TakeoffReviewPanel.tsx:175`: `if (!card) return;` leaves `focusTarget` set. If the card is not in the DOM yet (the parent applies `onReviewChange` later), the stale target can steal focus on some later render. Clear it after one miss, or key it to `review.items`.
- **N2.** `estimating/LaborPricingStep.tsx:75`: `import { isRealReason } from './reasons'` sits mid-file, after declarations. It is legal but trips `import/first`. Move it to the import block.
- **N3.** `reviewCards.tsx:98`: the "Confirm AI count N" label is keyed on `aiCount != null`. The backend stores the qty only when `kind === 'count'`. Every current count+confirm item is kind `count`, so the label is accurate today. Matching the backend's condition, as `reasonPresets` already does at `reviewModel.ts:190`, would keep it honest.
- **N4.** `reviewCards.tsx:138`: the "Suggested: X: the drawings say “by G.C.”…" line now shows permanently, even after the estimator has seen the buttons. The doubled colon reads oddly. Use "Suggested: APT — the drawings say…".
- **N5.** A flaky full-suite run (one random timing test per run in untouched files) is worth a separate ticket. It is not caused by this branch.

---

## For Jake (decisions, not defects)

1. **One-click choice buttons save immediately.** This covers scope furnish/install, area keep/sum, reuse, demolition and the remodel convention. A misclick on a scope answer goes straight into Agent 4 as AUTHORITATIVE until someone opens "N resolved" and reopens it. Busy-locking makes a double submit impossible. Consider an "Undo" on the success toast.
2. **Presets as attestation.** After B1, B2, S1, S2 and S5, these presets remain:
   - "Checked on the plans — N is right"
   - "Checked the plans — keep the current count" (gap-fill and reconcile)
   - "Checked — nothing on this page is missing from the takeoff" (sheets)
   - "Checked — the takeoff doesn’t need this sheet" (refsheets)
   - "Added the demolition in Labor & Pricing" (demosheet; this matches what the item asks for)
   - the generic "Checked — the takeoff is right as it is"

   Each is honest IF the estimator did it. They are faster to claim than typed reasons. The kind `confirm` ones reach Agent 4.
3. **typicalassign known gap (unchanged from before).** A count answer that leaves the totals short of the host count cannot carry a reason, so the only way through is "None of this type" with a reason. Hand this to the B3 owner. Whoever merges second ports B3's select into `TypicalAssignCard.tsx`.

---

## Addendum: fix re-check (bd2e472)

### Verdict: MERGE

### What I checked
- **Freeze.** `git diff 99f3766 bd2e472 -- review/payloadCases.ts` touches only the NEW_UI_ONLY section. The frozen section is unchanged.
- **New parity cases.** Five cases were added: `coverageMarkers`, `coverageNotOnJob`, `recountConfirm`, `needsPoles` and `countingTypedOnly`. They use the same body shapes the backend accepts.
- **Tests I ran myself.** All of `PcWorkspace/` and `estimating/`: 916/916 pass. `tsc --noEmit` is clean.

### Blockers
- **B1 is fixed.** `counting:*` now has typed reasons only (`reviewModel.ts`, `reasonPresets`).
- **B2 is fixed.** The not-on-job presets now appear only when `notOnJobFirst(item)` is true or the item is a legend group. Every found-on-plans kind gets `[]`.

### Should-fix and nits
- **S1–S6:** all addressed as described:
  - TypicalAssignCard passes `presets={[]}`, and its comment is corrected.
  - The "By others" preset is removed.
  - The group open count and `openOrder` both skip `blocking === false`.
  - The picker focuses the typed box, and Enter ignores `e.repeat`.
  - `panel-dup` is typed-only.
  - The parity cases above were added.
- **N1, N2 and N4:** fixed.

### Undo toast (new in this commit)
On a successful single-item `answer`, the panel shows "Answer saved" with an Undo action that calls the existing `reopen`. Saving the answer does not change. `Toast.tsx` already handles `action`: Undo works once, then its button is disabled.

### Remaining nits (none block the merge)
- **R1. Undo can reopen a newer answer.** If the estimator answers, then re-answers the same item, and then clicks Undo on the older toast, it reopens the newer answer. The worst case is that the item is open again, which is fail-safe. A fix is to capture the resolution's `at` and skip the reopen when it has changed.
- **R2. Unreadable items still get "Not shown on the plans for this job".** `notOnJobFirst` also matches `count:*` items in the "Couldn't be read clearly" group (detail begins "Could not be counted"). For those, the item was not *found*, as opposed to *not shown*. The wording is weaker but not contradicted by the item. A fix is to exclude `/^Could not be counted/` in `notOnJobFirst`.
