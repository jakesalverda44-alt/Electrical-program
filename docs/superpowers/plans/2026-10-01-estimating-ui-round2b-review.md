# Review: Estimating UI cleanup, round 2B (Labor & Pricing)

Branch `feat/estimating-ui-round2b`, commits `4682037..5928256` on main `19eca44`. Reviewer: Opus, 2026-10-01.

## Verdict: MERGE AFTER FIXES

There are no blockers. Payloads, the Save-disabled condition and the fixture-package answer path are all unchanged. Before merging, fix S1–S3 below. All three are CSS or markup only and don't touch payloads. Also do the browser check of the sticky bar (S4); jsdom can't test it and I didn't start the app. Fix the pricing-mode PUT bug (S5) on its own branch right after this merge, not in this one.

## What I verified

- **The payload freeze predates the UI.**
  - `4682037` adds only `pricing/payloadCases.ts` and `pricing/pricingPayloads.test.tsx`.
  - I ran that commit's tree in a scratch copy (git archive, no worktree): 39/39 pass on the unchanged components.
  - `git diff 4682037..HEAD` is empty for **both** files. The drivers needed no extra steps, because closed cards are `hidden`, not unmounted.
  - Bodies are compared as an exact `JSON.stringify` string and with `toStrictEqual`. The set of driver keys equals the set of CASES keys.
- **Every request the page can make is covered.**
  - I grepped every `api.*` call reachable from LaborPricingStep, AccubidPricingPanel, FeedersPanel, useAccubidPricing and useEstimatingBid: PUT/POST of `/estimating/b1`, `/price`, `/sync-takeoff`, `/markups/batch`, `/apply-markups`, `PATCH /bids/b1`, and Accubid settings/quotes/cost-lines/use-defaults/alternates (POST, PUT, DELETE).
  - Each one has a case. The one exception is `PUT /accubid/alternates/:id` (`updateAlternate`), which no UI calls: AlternatesSection never calls `onUpdate`.
  - Quote amount/tax/markup edits don't exist in the UI. The quote status, fixture flag, both fixture-question answers and the cost-line amount are covered.
  - `acbFixtureYesViaStep` proves the lifted hook sends the same PUT.
  - One weakness (N1): the freeze checks the n-th matching call but never asserts that no *extra* request is made. The single-GET check lives in LaborPricingStep.test instead.
- **The backend and frozen hooks are untouched.** `git diff 19eca44..HEAD` is empty for `backend/`, `useEstimatingBid.ts`, `useAccubidPricing.ts`, `types.ts` and `useStoredToggle.ts`.
- **Tests and types are clean.** `npx tsc --noEmit` is clean, and `npx vitest run` gives 154 files and 1815/1815 tests.
- **No assertions were dropped (test churn).** The only `-` lines in the four existing test files are two import lines and one `beforeEach` line that gained `localStorage.clear()`. Every existing assertion is still there.
- **Blocking behaviour is unchanged.**
  - Save stays `disabled={saving || openDups.length > 0}` with the same `title` (LaborPricingStep.tsx, action bar). Nothing new was added to the condition; unmatched lines still don't block Save.
  - `lp-duplicates`, `accubid-blocks-send`, `accubid-error`, `accubid-fixture-package-question`, `lp-unmatched-banner` and `lp-recheck-banner` all live in `lp-status`, outside every card.
  - `lp-save-error` is in the action bar, and `lp-calibration` is in the Feeders card's `pinned` slot. None of them can get a `[hidden]` ancestor.
  - `accubidStatusActive` matches `FixturePackagePrompt`'s own `open.length` rule exactly, so the question can't be suppressed when the prompt would have shown.
- **The fixture-package question is never auto-answered.** Yes and No are still click-only, and No still loops over every open quote. The loop keeps running after the `reload()` unmounts the prompt, because the closure holds `open` and `onUpdate`, the same as before. Case `acbFixtureNo2` covers this.
- **One Accubid fetch.**
  - LaborPricingStep owns `useAccubidPricing(bidId && accubid ? bidId : null)`, and the panel's own instance gets `null`.
  - The test asserts exactly one `GET /accubid`. Status and panel share one instance, so there is no stale state between them after Yes/No.
  - The separate `GET /accubid` in useEstimatingBid's `refreshAccubid` was already there and is a different consumer.
- **Job-conditions math matches the backend.** `jobConditionsSummary` follows `effectiveFactorPct` (pricing.ts:296) and `compoundLaborFactorMultiplier` (accubidRecap.ts:88): first factor per group wins, multistory pct × max(0, floors), and every library factor is looked up by id as in `resolveFactors` (bidEstimate.ts:600). It is display-only.
- **Calibration is unchanged.** It's the same `CalibrationToggle`, the same PATCH and label, and it's always visible, even with zero feeders or the card folded.
- **Collapsed-state keys and defaults match the plan:**
  - `est-lp-conditions-open`, `est-lp-rates-open`, `est-lp-acb-crew-open`, `est-lp-acb-equipment-open`, `est-lp-acb-ge-open`, `est-lp-acb-price-open` and `est-lp-feeders-open` all default to open.
  - Quotes and Alternates default to open only when the list is non-empty.
  - `est-lp-table-compact` defaults to off.
  - Nothing is stored until a click. These keys are per browser, not per bid (decision 11a).
- **Filters never edit lines, and no line becomes unreachable.**
  - "All" is always rendered, and the active chip stays even at count 0.
  - Under a filter, collapsed categories are shown, the same as with the old holds toggle.
  - `focusLineKey` and Add manual line reset the filter.
  - The holds count reads line ids in `holdById` (old code: `holdById.size`). The two agree unless the recap holds a stale id.
  - "Changed" is "ever overridden or kept from the previous run", not "unsaved" (see N3).
- **Compact rows** only change padding and font size; no column or badge is hidden.
- **Undo, delete and reset are visible.**
  - Undo is now an `est-link-btn` in the bar, and delete is `lp-link-btn`. Both were previously `display:none`.
  - The reset button appears through `.lp-cell-edited:focus-within`. It is a sibling of the input inside the same `td`, so Tab from the input reaches it.

## Blockers

None.

## Should-fix

**S1. The sidebar "held lines" jump scrolls the filter bar under the sticky action bar.**
- Where: `LaborPricingStep.tsx:205` (`filterBarRef.current?.scrollIntoView?.({ block: 'start' })`) together with `estimating.css:622` (`.lp-actionbar{position:sticky;top:0}`).
- Failure: on a long bid (desktop or tablet, where `.est-work` is the scroller), clicking "needs a price/unit" in the Bid Summary puts `lp-filter-bar` at the top of `.est-work`. The stuck action bar, about 50px tall or about 90px when wrapped on tablet, covers it. Jake lands on the filtered rows but can't see the active chip or "Showing X of Y", the cue that a filter is on.
- The same overlap affects any focus-driven scroll upward, such as Shift+Tab into a row that is under the bar.
- Fix (CSS only): add `.est-work{scroll-padding-top:64px}` or `.lp-filterbar{scroll-margin-top:64px}` under the round-2B block. The first option also covers focus scrolling.

**S2. The new global `.lp-hint` rule restyles markup that already existed, including the fixture-package question.**
- Where: `estimating.css:646` (`.lp-hint{font-size:12px;color:var(--text3);margin:0 0 8px}`). Before this branch `.lp-hint` had **no** CSS rule, but it was already used on `accubid-fixture-package-question` (AccubidPricingPanel.tsx:224), the per-quote fixture-package label (:262) and the cost-line hints (:313, :326, :336).
- Failure: the fixture-package question is the one decision Jake must make before sending. It now renders in muted `--text3` grey. The in-table "fixture package" `<label>` also gains an 8px bottom margin.
- This doesn't hide anything, but it lowers the prominence of a blocking prompt, which runs against the round's "blocking stays prominent" rule.
- Fix: scope the new rule to the new hints, for example `.lp-card .lp-hint, .lp-page > .lp-hint`. Or give the fixture prompt an explicit `color: var(--text)` in its existing inline style.

**S3. On phones (≤700px) "Not saved" on the folded Crew & markup card disappears.**
- Where: `estimating.css:659` hides every `.lp-card-summary`. AccubidPricingPanel.tsx:132 puts the `lp-card-summary-warn` " · Not saved" span *inside* the summary.
- Failure: Jake types crew rates on a phone, then folds the card. Nothing on screen says those values are unsaved, and the main Save doesn't send them.
- Fix: `@media (max-width:700px){ .lp-card-summary{display:none} .lp-card-summary:has(.lp-card-summary-warn){display:inline} }`. Or render the warn span as a sibling of `.lp-card-summary` inside the toggle.

**S4. The sticky bar doesn't stick on phones ≤768px. That's harmless, but the plan assumes it does, so check it in a browser.**
- Why, from the CSS:
  - At ≤768px `styles.css:521` sets `.app{height:auto;overflow:visible}`, so the document scrolls rather than `.est-work`.
  - `.est-work` keeps `overflow:auto` (estimating.css:125). It is still the bar's nearest scroll container, but it never scrolls, so `position:sticky` never engages and the bar scrolls away like the old button row did.
  - From 769 to 899px (shell "mobile", app still `100dvh`/`overflow:hidden`) and on tablet and desktop, `.est-work` is the scroller and the bar sticks inside it.
- What can't go wrong:
  - It can't collide with `.est-summary-bottom`, which is outside `.est-work`.
  - Its z-index of 4 is below the app nav (200), modals (150 or 240), full-screen Plans (340, `plans.css:656`) and toasts (350). The table has no z-indexed children above 4.
  - Plans is a different step, so nothing in the pricing step overlaps it.
- To do: check in a browser at 1280+, about 1000 and 375px. If sticking on phones matters, you could add `@media (max-width:768px){ .lp-actionbar{position:static} }` to make the fallback explicit. Making it truly sticky there would need `top` to clear the mobile topbar, so it's a separate decision.

**S5. Pre-existing bug, confirmed: "Switch pricing mode" PUTs the OLD `pricing_mode`.**
- How it happens:
  - `LaborPricingStep.tsx:364-366` calls `setSettings(prev => ({...prev, pricing_mode: next}))` and then `await save()`.
  - `save` is the `useCallback` from the click-time render. It closes over the old `settings` (`useEstimatingBid.ts:316` `{ lines: linesToSave, settings }`).
  - The freeze recorded this: `CASES.switchToAccubid` has `"pricing_mode":"phase_a"`.
- Knock-on effects in the same call:
  - `useEstimatingBid.ts:331` sets the saved grand total using the old mode.
  - `:332` records the old settings as persisted, so the page now looks dirty.
  - `:334` refreshes Accubid for the old mode.
- Failure: Jake confirms the switch and gets the green "Switched to Accubid pricing" toast. The page and the live sidebar show Accubid, but the server, `bids.amount` and `bid_estimates` still hold the Quick number until some later Save. If he leaves and discards unsaved changes, the switch is lost.
- Minimal correct fix (a follow-up branch, because it touches frozen `useEstimatingBid.ts` and must change `CASES.switchToAccubid`):
  1. `useEstimatingBid.ts:60`: `save: (linesOverride?: EstimateLine[], settingsOverride?: EstimateSettings) => Promise<…>`.
  2. In `save` (:292): add `const settingsToSave = settingsOverride ?? settings;` and use it at :316 (PUT body), :331, :332 and :334.
  3. `LaborPricingStep.tsx:364-366`: `const nextSettings = { ...settings, pricing_mode: next }; setSettings(prev => ({ ...prev, pricing_mode: next })); await save(undefined, nextSettings);`.
  4. Update `CASES.switchToAccubid` to expect `"pricing_mode":"accubid"`, as a deliberate, reviewed change to the freeze. Add a test that the PUT carries the new mode.
- Does it block this merge? **No.** It's pre-existing, not made worse here, and recorded in the freeze. The fix needs exactly the files this round promised not to touch. Do it as the next small branch.

## Nits

- **N1** (`pricingPayloads.test.tsx:153-156`): `nth()` checks only that the n-th call exists. A refactor that sent an extra duplicate PUT/POST would still pass. Consider asserting `callsTo(method,url).length === n+1` after a short settle for the single-shot cases.
- **N2** (`EstimatingWorkspace.tsx:124`): `setLineFilterRequest('holds')` is set even if `onSelectStep('pricing')` is blocked, for example by a dirty guard on another step. The request then applies on a later, unrelated visit to Labor & Pricing. It's harmless (All is one click away). You could clear it when the step doesn't change. This path has no test, as the builder noted.
- **N3** (`laborPricingModel.ts:93-100,109`): the "Changed" title says "Lines you added or edited". Resolver re-matches, confirmed matches, keep-both and evidence notes are edits that don't count. Either reword the title to the exact list, which it nearly is already, or accept this. Decision 11d (kept lines count) is fine.
- **N4** (`LineFilterBar.tsx:22,30`): clicking an active chip whose count is 0 returns to All and removes that chip from the DOM, so keyboard focus drops to `<body>`. You could move focus to the All chip in `chooseFilter` when the chosen chip will disappear.
- **N5** (`LineFilterBar.tsx:35-37`): the `aria-live` "Showing X of Y" span is mounted together with its text, so most screen readers won't announce the first change. Keep the span mounted and empty when the filter is All.
- **N6** (`LaborPricingStep.tsx`, category toggle): under a filter, `isCollapsed` is forced false. Clicking the ▾ toggle flips stored state but nothing visibly changes and `aria-expanded` stays true. This was already so with the old holds toggle.
- **N7** (`PricingCard.tsx:33-37`): the summary sits inside the toggle button, so the button's accessible name is the whole summary, which is long for Crew & markup. You could add `aria-describedby` for the summary and keep the name to the title. This is what the plan specified, so it's optional.
- **N8** (AccubidStatus, LaborPricingStep `hasStatus`): every quote action calls `reload()`, and `accubidStatusActive` returns false while loading. On a bid where the only status is Accubid's, the whole `lp-status` region unmounts and remounts on every quote click, so the page jumps about one banner height. Before this branch the whole panel flashed "Loading…", so this isn't a regression. You could keep showing the last status while reloading.
- **N9:** the hold banner and fixture question in the standalone panel moved above Crew (builder deviation). That's fine and matches the step.
