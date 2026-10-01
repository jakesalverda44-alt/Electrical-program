# Plan: Estimating UI cleanup, round 2B: Labor & Pricing

## For Jake (plain summary, under 100 words)
Labor & Pricing gets tidier. Prices, saves and what blocks you stay exactly the same. Save, Sync and Add manual line stay pinned at the top. Anything that blocks Save or sending stays right under them and never folds away: possible duplicates, budget-pending quotes and the fixture-package question. Below that, in order: pricing mode, Job conditions (closed it reads like "2 factors, +25% labor hours"), Rates & markups or the Accubid sections, Feeders, then the lines. Every section folds, and your browser remembers how you left it. Empty Quotes and Alternates start closed. The table gets filter buttons and a "Compact rows" option.

Frontend root: `/Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend`. Paths below are relative to it unless absolute. Build on a new branch `feat/estimating-ui-round2b`, in a worktree off main `c2a3469`. No other branch touches `frontend/src/features/estimating`. I checked `fix/estimate-refresh`, `fix/sheet-check-no-rerun-on-open`, `feat/accuracy-reading` and `feat/accuracy-pricing`.

## Goal
Restructure the Labor & Pricing step (`src/features/estimating/LaborPricingStep.tsx`, `AccubidPricingPanel.tsx`, `FeedersPanel.tsx`) into clear, collapsible sections in a fixed order, with a sticky action bar and a line filter bar. None of these may change:
- the bodies of `PUT /estimating/:bidId` (Save), `POST /sync-takeoff`, `POST /price`, the Accubid settings/quote/cost-line/alternate requests, the feeder markup/apply requests, or `PATCH /bids/:id` (calibration);
- what disables Save, what blocks sending, and how the fixture-package question is answered;
- any backend file, `useEstimatingBid.ts`, `useAccubidPricing.ts` or `types.ts`.

## What I found (checked against the code)

### Current page order (LaborPricingStep.tsx:406-833)
1. `lp-pricing-mode-row`: "Pricing mode: Quick pricing / Accubid" and the Switch button (confirm dialog, then `setSettings` and an immediate `save()`).
2. `factorsRow`: the "Floors above 2" input (`lp-floors-above-2`) in its own row, then `lp-factor-chips`. Each group is an unlabelled flex div, and chips are mutually exclusive inside a group (`toggleFactor`). Both render in both modes (S17).
3. `FeedersPanel` (only when `bidId` is set).
4. Quick mode: one `lp-settings-row` holding 8 inputs (Labor rate ($/hr), Crew size, plus the 6 `SETTINGS_PCT_FIELDS`). Accubid mode: `AccubidPricingPanel`.
5. `lp-duplicates` (DuplicatePairControl per open pair).
6. `lp-recheck-banner` (one long sentence).
7. `lp-unmatched-banner` with a Resolve button.
8. Button row: Sync (`lp-sync-button`), Add manual line (`lp-add-manual`), Save (`lp-save-button`), the holds filter (`lp-holds-filter`), the save error (`lp-save-error`) and Undo (`lp-undo-delete`).
9. `lp-table`: category rows with a ▸/▾ toggle, then the line rows. Badges per row:
 - resolve
 - confirm match
 - hold
 - furnish
 - fuzzy
 - re-check
 - 🔒 qty
 - evidence note
10. The resolver Modal.

### Corrections to the brief
- **Only open possible duplicates disable Save.** The condition is `disabled={saving || openDups.length > 0}` (line 485), mirrored by the server's 409 at `backend/src/routes/estimating.ts:845`. Unmatched, fuzzy, confirm-match and held ($0) lines are warnings only: banners, badges and sidebar rows. They never block Save. Round 1's constraint text ("unmatched or duplicate lines still block Save") was inaccurate. **This round keeps the exact current condition.** Other blocks:
- The Accubid budget-pending hold (`accubid-blocks-send`) blocks *sending*.
- The evidence gate blocks generate/send.
- All of these must stay visible and must never sit inside a collapsible body.
- **The Calibration checkbox is not in a header.** `CalibrationToggle` is the first row inside `FeedersPanel`. It renders whenever `/feeders` has loaded, even with zero feeders. Its label is long, and `FeedersPanel.test.tsx:120` asserts its text.
- **The fixture-package question** (`FixturePackagePrompt`, `accubid-fixture-package-question`) shows only in Accubid mode, inside AccubidPricingPanel just above Vendor Quotes. Yes sends `PUT {fixturePackage:true, fixturePackageDecided:true}`. No sends `PUT {fixturePackageDecided:true}` for every open quote. It is never auto-answered, and nothing here changes that.
- **The Accubid panel has its own Save.** "Save crew & pricing" (`accubid-save-settings`, PUT `/accubid/settings`) covers both Crew and Overhead & Markup. The main Save never sends Accubid settings. Quotes, cost lines and alternates save immediately on each click (POST/PUT/DELETE).
- **The Accubid "Selling price breakdown"** comes from `useAccubidPricing`'s GET `/accubid` (saved lines). It is not refreshed by the main Save. The sidebar uses `useEstimatingBid`'s live POST `/price`, so the two can differ during a session. This is pre-existing and **not fixed here**. Task 5 only adds a factual hint.
- **Job-condition math differs by mode.** Quick mode adds the pcts (`backend/src/estimating/pricing.ts` `effectiveFactorPct`): first factor per `group_key` wins, and `multistory` pct × `floors_above_2`. Accubid mode compounds them (`accubidRecap.ts:88` `compoundLaborFactorMultiplier`, same group and per-floor rule). `resolveFactors` (`bidEstimate.ts:600`) uses every library factor by id, whether active or not. The closed summary must mirror the active mode, and it is display-only.
- Seeded factor groups (`backend/src/estimating/seed/laborUnits.ts:922`): `height` (3 chips), `occupied`, `congested`, `schedule`, `multistory`, `access`, `wage`.

### Pre-existing bugs found (fixed in this round, UI only)
- **`.lp-reset-btn { display:none }`** (estimating.css:501) only shows inside `.lp-cell-edited:hover`. So:
- the Undo button (`lp-undo-delete`) and the manual-line "delete" button (`lp-delete-N`) **are never visible** (no inline `display` override);
- the "reset" buttons are mouse-hover only. A `display:none` element can't take focus, so keyboard users can never reach them.
- The delete toast says "re-add it from the Add manual line button", which is wrong: Undo is the way back.
- Enter-to-next-row (`onKeyDown` on the table) looks up `data-row={idx+1}`. With the holds filter on, the next index is often hidden, so focus goes nowhere.
- With the holds filter on, a row disappears while you type its price: the recap reprices, the hold clears, and the row is filtered out under the cursor.
- `btn sm` and `btn primary` have no CSS rules. Plain `.btn` is the blue primary and `.btn.ghost` is the secondary. Use that.

### Shared pieces
- `useStoredToggle(key, fallback)` returns `[value, toggle]` and stores only after the first change. AppShell, EstimateShell and PlansWorkspace use it. **Don't change its signature.**
- `.est-work` (estimating.css:125) is `overflow:auto`, so a `position:sticky; top:0` bar sticks inside it. On mobile, `.est-summary-bottom` is sticky at the **bottom**, so a top bar doesn't collide with it.

### External consumers of this page's DOM (keep these working)
- `src/features/preconstruction/PcWorkspacePricingDirtyGuard.test.tsx`: `lp-row-0`, `lp-save-button`.
- `src/features/preconstruction/PcWorkspaceRerunReset.test.tsx`: `lp-recheck-banner`; `lp-recheck-badge-0` text contains "From previous run — re-check"; `lp-recheck-done-0`.
- `EstimatingWorkspace.tsx` mounts LaborPricingStep. In BidSummary, `onJumpToHolds` only selects the pricing step today.

### Existing tests that constrain markup
- `LaborPricingStep.test.tsx` uses:
- `getByDisplayValue('40')` / `('10')` on rate inputs;
- `getByText('Labor rate ($/hr)')` (and `queryByText` null in Accubid mode);
- `getByText(/Branch Power/)` (it must stay the only match);
- the `lp-holds-filter` textContent `'Needs a price/unit (1)'`, with a second click restoring all rows;
- `lp-floors-above-2` and `lp-factor-chips` present in Accubid mode even when the library has only `height` factors;
- mode-row text checks (`'Quick pricing'`, not `'Phase A'`).
- `AccubidPricingPanel.test.tsx` uses `within(getByTestId('accubid-quotes'))`, the placeholders `'Switchgear'`/`'0.00'`, `getByText('12.500', {exact:false})`, and Remove buttons found by text inside row testids.
- `FeedersPanel.test.tsx` checks `lp-feeders-summary`, the status, math and calibration text.
- None of them use `getByRole` on these controls. **Collapsed bodies use the `hidden` attribute, never unmounting.** `getByText`, `getByDisplayValue`, `getByLabelText` and `fireEvent` still reach hidden elements. `getByRole` does not (pass `{ hidden: true }` if you need it).

## Constraints for the builder
- Work only in the worktree. Don't touch any DB, don't start the app, don't merge or push. `git diff main --stat -- ../backend` must be empty. Also leave `useEstimatingBid.ts`, `useAccubidPricing.ts`, `types.ts` and `useStoredToggle.ts` unchanged.
- **Payload parity:**
- `src/features/estimating/pricing/payloadCases.ts` is written in Task 0 and **must not change afterwards**. The reviewer checks `git diff <task0-sha> -- src/features/estimating/pricing/payloadCases.ts` is empty.
- Drivers in `pricingPayloads.test.tsx` may only gain extra steps (e.g. opening a card). Their expected values are never edited.
- Run `npx vitest run src/features/estimating/pricing/pricingPayloads.test.tsx` after every task.
- **Blocking unchanged:** Save stays `disabled={saving || openDups.length > 0}` with the same `title`. These are never inside a collapsible body:
- `lp-duplicates`
- `accubid-blocks-send`
- `accubid-fixture-package-question`
- `accubid-error`
- `lp-unmatched-banner`
- `lp-recheck-banner`
- `lp-save-error`
- Calibration: same checkbox, same label text, same PATCH. It only moves into an always-visible slot of the Feeders card.
- Testids: keep every existing one on an equivalent element (list in the Reviewer focus section). Add new ones as specified.
- Accessibility:
- real `<button type="button">`;
- every toggle has `aria-expanded` plus `aria-controls` pointing at the body id from `useId()`;
- pressed-state buttons (factor chips, filter chips, compact toggle) get `aria-pressed`;
- grouped inputs use `<fieldset><legend>`.
- Style: new classes go in `estimating.css` under `/* UI cleanup round 2B — Labor & Pricing. */`. Comments follow the form `// UI cleanup round 2B — …`. Keep inline styles where a block already uses them.
- After each task run `npx tsc --noEmit` and `npx vitest run src/features/estimating src/features/preconstruction`. At the end run `npx vitest run`.
- Every test file that renders a collapsible gets `beforeEach(() => window.localStorage.clear())`. That covers LaborPricingStep, AccubidPricingPanel, FeedersPanel, the payload tests and the new tests.

## New file layout
- `src/features/estimating/useStoredDisclosure.ts` (+ `.test.tsx`)
- `src/features/estimating/pricing/payloadCases.ts`, `pricing/pricingPayloads.test.tsx` (Task 0)
- `src/features/estimating/pricing/laborPricingModel.ts` (+ `.test.ts`): pure helpers
- `src/features/estimating/pricing/PricingCard.tsx` (+ `.test.tsx`)
- `src/features/estimating/pricing/JobConditionsCard.tsx`
- `src/features/estimating/pricing/QuickRatesCard.tsx`
- `src/features/estimating/pricing/LineFilterBar.tsx`

---

## Task 0: Freeze the payloads (characterization tests on the CURRENT code)

**Files (new):** `pricing/payloadCases.ts`, `pricing/pricingPayloads.test.tsx`. **Do not change any component in this task.** Commit it alone, with "payload freeze" in the commit message.

**Mocks:** mock `../../../api/client` with `get`/`post`/`put`/`patch`/`delete` spies. Route `get` by URL:
- `/estimating/library` → LIBRARY (items i1 EA, i2 EA, assembly a1, factors HEIGHT-10-14/HEIGHT-14-20/HEIGHT-20-PLUS (group height), OCCUPIED, MULTI-STORY (group multistory, pct 3));
- `/estimating/b1` → ESTIMATE (or ESTIMATE_DUP);
- `/estimating/b1/feeders` → FEEDERS;
- `/estimating/b1/accubid` → ACCUBID.

`post`/`put` resolve to small valid responses:
- `/price` → `{data:{recap}}`;
- `/sync-takeoff` → a SyncTakeoffResponse with the same lines;
- PUT `/estimating/b1` → `{data:{recap}}`;
- `/markups/batch` → `{data:{}}`;
- `/apply-markups` → `{data:{skipped:[], save:{lines, recap}}}`.

**Determinism:**
- `vi.spyOn(crypto, 'randomUUID')` returns `'uuid-1'`, `'uuid-2'`, … in order;
- in the keep-both case, `vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-10-01T12:00:00.000Z')`.

**Fixtures:**
- **ESTIMATE lines:**
- `l1` Duplex (takeoff, item i1, UUID line_key);
- `l2` "Some unmatched thing" (takeoff, no ids);
- `l3` "Type A troffer" (takeoff, item i2, `match_confidence:'confirm'`);
- `l4` "Old duplex" (takeoff, i1, `recheck_run_id:'r1'`);
- `l5` feeder conduit (`takeoff_key 'Feeders (allowance)||Feeder — PANEL B → RTU-1: 3/4" EMT'`, UUID line_key, qty 0);
- `l6` feeder conduit for a cross-sheet edge `'XFMR → MDP'`.
- **ESTIMATE settings:** DEFAULT_SETTINGS with `pricing_mode:'phase_a'`.
- **ESTIMATE_DUP:** adds a `duplicates` pair over `l1` and a new `l7`.
- **FEEDERS:** a same-sheet estimated edge (route of 3 points, verticalFt 10, makeupFt 6, sets 1) and a cross-sheet estimated edge (`route:null`, `quantities.conduitFt 80`). `slackPct` 10, `calibration` false.
- **ACCUBID:**
- quotes `q1` (budget_pending) and `q2`;
- cost lines `eq1` equipment and `ge1` general_expense;
- alternates `alt1` manual;
- `fixturePackageQuestion {quoteIds:['q1','q2'], …}`;
- `defaultOptIns:['equipment']`.

**Harness:**
```tsx
function StepHarness() {
const eb = useEstimatingBid('b1');
if (eb.loading) return null;
return <ConfirmProvider><LaborPricingStep bidId="b1" lines={eb.lines} settings={eb.settings} recap={eb.recap} saving={eb.saving}
syncing={eb.syncing} saveError={eb.saveError} dirty={eb.dirty} duplicates={eb.duplicates} setLines={eb.setLines}
setSettings={eb.setSettings} save={eb.save} syncTakeoff={eb.syncTakeoff} /></ConfirmProvider>;
}
```
Read `UseEstimatingBidResult` for the exact field names. Accubid cases render `<AccubidPricingPanel bidId="b1" />` alone, plus one case through StepHarness in Accubid mode.

**`payloadCases.ts`:** `export const CASES: Record<string, { method: 'put'|'post'|'patch'|'delete'; url: string; body: string | null }>`.
- `body` is the **exact `JSON.stringify` output** (byte identity, key order included);
- `null` means the call had only a URL argument.

Fill each `body` by running its driver once against unchanged main with a temporary `console.log(JSON.stringify(call[1]))`, then delete the log. Hand-check each against the code path. For example, a qty edit appends `qty_overridden:true, qty_source:'manual'`, and exclude appends `sync_excluded:false`.

| key | driver (current UI) | request |
|---|---|---|
| `saveUntouched` | click `lp-save-button` | PUT `/estimating/b1` |
| `saveFactors` | click `lp-factor-HEIGHT-14-20`, `lp-factor-OCCUPIED`, `lp-factor-HEIGHT-20-PLUS`; type `3` in `lp-floors-above-2`; click `lp-factor-MULTI-STORY`; Save | PUT |
| `saveQuickRates` | `getByLabelText('Labor rate ($/hr)')` → 85; Crew size → 4; each pct label → a new value; clear `Profit %` (reverts to default); Save | PUT |
| `saveLineEdits` | row 0 qty → 12, material override → 7.5, hours override → 0.4, then click hours "reset"; check `lp-exclude-3`; Save | PUT |
| `saveManualLine` | `lp-add-manual`; set description "Owner allowance", qty 2, `lp-evidence-note-N` "Owner allowance per spec 26 05 00"; Save | PUT |
| `saveDeleteUndo` | add a manual line, `lp-delete-N`, `lp-undo-delete`; Save | PUT |
| `saveConfirmMatch` | `lp-confirm-match-btn-2`; Save | PUT |
| `saveRecheckDone` | `lp-recheck-done-3`; Save | PUT |
| `saveResolverPick` | `lp-resolve-1` → `lp-resolver-candidate-i1`; Save | PUT |
| `saveResolverManual` | `lp-resolve-1` → `lp-resolver-manual-material` 15 → `lp-resolver-keep-manual`; Save | PUT |
| `saveFeederTypeLength` | `lp-feeder-length-<edge1>` 60 → `lp-feeder-length-set-<edge1>`; Save | PUT |
| `saveFeederConfirmLength` | `lp-feeder-confirm-<edge2>`; Save | PUT |
| `saveDupKeepBoth` | (ESTIMATE_DUP) type into `lp-dup-reason` → `lp-dup-keep-both`; Save | PUT |
| `saveDupRemoveNew` | (ESTIMATE_DUP) `lp-dup-remove-new`; Save | PUT |
| `switchToAccubid` | `lp-switch-pricing-mode` → dialog "Confirm" | PUT |
| `syncNoBody` | `lp-sync-button` | POST `/estimating/b1/sync-takeoff`, body `null` (assert `call.length === 1`) |
| `livePrice` | row 0 qty → 11; wait for the debounced recalc | POST `/estimating/b1/price` (the last such call) |
| `feederAdoptBatch` / `feederAdoptApply` | `lp-feeder-adopt-<edge1>` | the two POSTs, in order |
| `calibrationOn` | `lp-calibration-checkbox` | PATCH `/bids/b1` |
| `acbSettings` | `accubid-shift` → night; "Night journeyman $/hr" → 42; "Labor overhead %" → 45; `accubid-save-settings` | PUT `/estimating/b1/accubid/settings` |
| `acbAddQuote` | in `accubid-quotes`: placeholder Switchgear "Gear", 0.00 "4500", `accubid-add-quote` | POST `/quotes` |
| `acbQuoteFirm` | the status select in `accubid-quote-q1` → firm | PUT `/quotes/q1` |
| `acbQuoteFixtureFlag` | `accubid-quote-fixture-package-q2` | PUT `/quotes/q2` |
| `acbRemoveQuote` | Remove in `accubid-quote-q2` | DELETE, body `null` |
| `acbFixtureYes` | `accubid-fixture-package-yes` (default pick q1) | PUT `/quotes/q1` |
| `acbFixturePickSecond` | `accubid-fixture-package-pick` → q2, then Yes | PUT `/quotes/q2` |
| `acbFixtureNo1` / `acbFixtureNo2` | `accubid-fixture-package-no` | the two PUTs, in order |
| `acbAddEquipment` / `acbAddGe` | the add row in `accubid-costlines-<kind>`, then "Add" | POST `/cost-lines` |
| `acbCostAmount` | `accubid-costline-amount-eq1` → 1250, blur | PUT `/cost-lines/eq1` |
| `acbRemoveCostLine` | Remove in `accubid-costline-ge1` | DELETE |
| `acbUseDefault` | `accubid-use-default-equipment` | POST `/cost-lines/use-defaults` |
| `acbAddAlternate` | in `accubid-alternates`: select → Add, description, amount, `accubid-add-alternate` | POST `/alternates` |
| `acbRemoveAlternate` | Remove in `accubid-alternate-alt1` | DELETE |
| `acbFixtureYesViaStep` | StepHarness, ESTIMATE settings `pricing_mode:'accubid'`; `accubid-fixture-package-yes` | must equal `CASES.acbFixtureYes` |

**Each `it` asserts:**
- the spy call's URL equals `CASES.x.url`;
- `JSON.stringify(call[1]) === CASES.x.body` (or `call.length === 1` for `null`);
- `call[1]` `toStrictEqual(JSON.parse(body))`.

Add one test that checks the set of driver keys equals `Object.keys(CASES)`.

Drivers use only testids, placeholders and label texts that this plan keeps.

**Acceptance:**
- [ ] Every case passes on unchanged main. Committed alone; record the SHA.

---

## Task 1: Building blocks (no visible change yet)

### 1a. `useStoredDisclosure.ts`
```ts
// UI cleanup round 2B — an open/closed section remembered per browser. Unlike
// useStoredToggle, nothing is stored until the estimator clicks: until then the
// section follows `defaultOpen` live (Quotes opens by itself once a quote exists).
export function useStoredDisclosure(key: string, defaultOpen: boolean): { open: boolean; toggle: () => void }
```
- State: `stored: boolean | null`, read once from localStorage (`'1'` → true, `'0'` → false, anything else or a throw → null).
- `open = stored ?? defaultOpen`.
- `toggle` sets `stored = !open` and writes `'1'`/`'0'` inside try/catch, in the click handler itself (not an effect).

### 1b. `pricing/PricingCard.tsx`
```ts
interface PricingCardProps {
storageKey: string; defaultOpen: boolean; title: string; testId: string;
summary?: React.ReactNode;     // always shown in the header
pinned?: React.ReactNode;      // always visible, between header and body — never folded away
collapsible?: boolean;         // default true; false = plain heading, body always shown
children?: React.ReactNode;
}
```
Markup:
```
<section className="lp-card" data-testid={testId}>
<h3 className="lp-card-title">
{collapsible
  ? <button type="button" className="lp-card-toggle" aria-expanded={open} aria-controls={bodyId} data-testid={`${testId}-toggle`} onClick={toggle}>
      <Icon name="chevron-down" size={14} stroke={2} style={open ? undefined : { transform: 'rotate(-90deg)' }} />
      <span className="lp-card-name">{title}</span>
      {summary != null && <span className="lp-card-summary" data-testid={`${testId}-summary`}>{summary}</span>}
    </button>
  : <span className="lp-card-static"><span className="lp-card-name">{title}</span>{summary != null && <span className="lp-card-summary" data-testid={`${testId}-summary`}>{summary}</span>}</span>}
</h3>
{pinned != null && <div className="lp-card-pinned">{pinned}</div>}
{children != null && <div id={bodyId} className="lp-card-body" data-testid={`${testId}-body`} hidden={collapsible && !open}>{children}</div>}
</section>
```
- `bodyId = useId()`.
- `Icon` comes from `../../../components/Icon`.

### 1c. `pricing/laborPricingModel.ts` (pure, with header comment `// UI cleanup round 2B — display-only helpers for Labor & Pricing. Nothing here is sent to the server.`)

1. Move `numberOrDefault` here from LaborPricingStep, unchanged, and export it.

2. `factorGroupLabel(key)`:
 - height → `Working height`
 - occupied → `Occupied building`
 - congested → `Ceiling space`
 - schedule → `Work hours`
 - multistory → `Multi-story`
 - access → `Site access`
 - wage → `Wage rate`
 - else: underscores to spaces, first letter capitalised.

3. `jobConditionsSummary(factorIds, libraryFactors | undefined, floorsAbove2, mode: 'phase_a'|'accubid'): string`:
 - Library undefined: `factorIds.length ? `${n} selected` : 'None selected'`.
 - Resolve like the backend: walk `factorIds` in order, look each up by id in **all** library factors (active or not), skip unknown ids, keep the first per `group_key`.
 - Per-factor pct: `group_key === 'multistory' ? pct * max(0, floors) : pct`.
 - Quick: total = sum. Accubid: total = (product of (1 + p/100) − 1) × 100.
 - Format: round to 1 decimal and drop `.0`.
 - Text: `${n} factor${s}, +${pct}% labor hours`, plus ` (compounded)` in Accubid mode.
 - `n === 0` → `None selected`. If floors > 0, append ` · ${floors} floor${s} above 2 (Multi-story not picked)`.
 - Multistory picked with floors ≤ 0: append ` · Multi-story needs floors above 2`. Picked with floors > 0: append ` · ${floors} floor${s} above 2`.

4. `ratesSummary(s)` returns `Labor $${s.labor_rate}/hr · Crew ${s.crew_size} · Overhead ${s.overhead_pct}% · Profit ${s.profit_pct}% · Tax ${s.material_tax_pct}%`.

5. `takeoffItemOf(key)`: the same stripping as `FeedersPanel.keyItem` and `feederSidebarCounts` (text after `||`, drop a trailing `::n`). Add a comment pointing at both.

6. `isFeederLine(l)` is `/^Feeder — /.test(item) || /^MEASURE FEEDER — /.test(item)`. That includes wire lines.

7. `isChangedLine(l)` is true for any of:
 - `l.source === 'manual'`
 - `!!l.qty_overridden`
 - `l.qty_source === 'manual'`
 - `l.material_unit_override != null`
 - `l.labor_hours_override != null`
 - `!!l.recheck_run_id`

8. `type LineFilterKey = 'all'|'holds'|'furnished'|'feeders'|'changed'|'excluded'` and `LINE_FILTERS` (label / title):
 - all: `All`, "Every line, excluded ones included"
 - holds: `Needs a price/unit`, "Lines with a quantity that price at $0 — the total leaves them out until they get a price or a unit." (the current button title)
 - furnished: `Owner-furnished`, "Owner-furnished (labor only) and furnish-disputed lines"
 - feeders: `Feeders`, "Feeder conduit and wire lines"
 - changed: `Changed`, "Lines you added or edited: manual lines, typed quantities, price or hours overrides, and lines kept from the previous run"
 - excluded: `Excluded`, "Lines left out of the price"

9. `lineMatchesFilter(key, line, ctx: { holdIds: { has(id: string): boolean }; furnishIds: { has(id: string): boolean } })`:
 - holds/furnished use `!!line.id && ctx.….has(line.id)`;
 - feeders → `isFeederLine`;
 - changed → `isChangedLine`;
 - excluded → `!!line.excluded`;
 - all → true.

10. `lineFilterCounts(lines, ctx): Record<LineFilterKey, number>` (all = `lines.length`).

11. Accubid and feeder summaries:
  - `crewSummary(form, dirty)` returns `${jc} journeyman, ${ac} apprentice${s}, ${fc} foreman/foremen · ${Day|Night} shift · Labor overhead ${laborOverheadPct}% · Markup ${materialMarkupPct}% material / ${laborMarkupPct}% labor`, with ` · Not saved` appended when dirty.
  - `quotesSummary(quotes)`: empty → `None`; else `${n} quote${s} · ${money(sum)}`, plus ` · ${p} budget-pending` when p > 0.
  - `costLinesSummary(lines)`: empty → `None`; else `${n} line${s} · ${money(sum)}`, plus ` (default added on save)` if any `preview`.
  - `alternatesSummary(alts)`: empty → `None`; else `${a} add, ${d} deduct`.
  - `feedersSummary(data)`: zero edges → `None found on this job`; else `${edges} feeder${s}`, plus ` · ${suggested} to confirm` / ` · ${holds} need a location / scale / size` when > 0, plus ` · Calibration job` when `calibration`.
  - Use `toLocaleString('en-US', {style:'currency', currency:'USD'})` for money, the same as AccubidPricingPanel's `money`.

**Tests:**
- `laborPricingModel.test.ts`:
- none → `None selected`;
- HEIGHT-10-14 + OCCUPIED in Quick mode → `2 factors, +25% labor hours`, and in Accubid mode → `2 factors, +26.5% labor hours (compounded)`;
- two height ids → count 1 (first wins);
- MULTI-STORY with floors 0 → `1 factor, +0% labor hours · Multi-story needs floors above 2`; with floors 4 → `+12%` and `· 4 floors above 2`;
- an unknown id is ignored, and an inactive factor still counts;
- `ratesSummary` gives the exact string;
- `isFeederLine` covers conduit, wire, MEASURE FEEDER and a non-feeder;
- `isChangedLine` for each trigger;
- `lineFilterCounts`;
- every summary helper, including the empty cases.
- `useStoredDisclosure.test.tsx`:
- follows `defaultOpen` on rerender until toggled;
- toggle writes `'1'`/`'0'`;
- a remount reads it back;
- a throwing localStorage still toggles.
- `PricingCard.test.tsx`:
- `aria-controls` points at the body id;
- a closed body has `hidden`, and `pinned` is visible when closed;
- `collapsible={false}` renders no button;
- the summary is inside the toggle.

**Acceptance:**
- [ ] Nothing imports these yet except tests. The payload tests are green.

---

## Task 2: Page order, status region, pricing mode card, recheck "Why?"

**Files:** `LaborPricingStep.tsx`, `AccubidPricingPanel.tsx`, `LaborPricingStep.test.tsx`, `AccubidPricingPanel.test.tsx`.

### 2a. Lift the Accubid hook (so its warnings can sit at the top)
- AccubidPricingPanel props: `{ bidId; showToast?; pricing?: UseAccubidPricingResult; showStatus?: boolean /* default true */ }`.
- Inside it: `const own = useAccubidPricing(pricing ? null : bidId); const p = pricing ?? own;` and use `p` everywhere. With `null` the hook never fetches (`useAccubidPricing.ts:56`).
- Export `AccubidStatus({ pricing }: { pricing: UseAccubidPricingResult })`:
- returns `null` while `pricing.loading`;
- otherwise renders, **unchanged** in markup, copy and testids: the `accubid-blocks-send` banner, the `accubid-error` banner and `<FixturePackagePrompt question quotes onUpdate={pricing.updateQuote} />`;
- it returns `null` when none of them apply.
- The panel renders `{showStatus && <AccubidStatus pricing={p} />}` first, which keeps standalone tests working.
- In LaborPricingStep: `const accubidPricing = useAccubidPricing(bidId && settings.pricing_mode === 'accubid' ? bidId : null);` (with a comment: one fetch, shared). Then `<AccubidPricingPanel bidId={bidId} showToast={showToast} pricing={accubidPricing} showStatus={false} />`.

### 2b. New render order in LaborPricingStep
The root becomes `<div className="lp-page" data-testid="labor-pricing-step">`:
1. *(Task 8 puts the sticky action bar here; until then the old button row stays just above the table.)*
2. **Status region**, only when something is in it: `<div className="lp-status" role="region" aria-label="Needs attention" data-testid="lp-status">`, in this order:
 - `lp-duplicates` (unchanged block);
 - `{settings.pricing_mode === 'accubid' && bidId && <AccubidStatus pricing={accubidPricing} />}`;
 - `lp-unmatched-banner` (unchanged);
 - `lp-recheck-banner` (2c).
3. **Pricing mode card** (not collapsible): `<section className="lp-card lp-mode-card" data-testid="lp-pricing-mode-row">`. It keeps "Pricing mode: **Quick pricing|Accubid**" and the `lp-switch-pricing-mode` button. Add `<span className="lp-mode-desc" data-testid="lp-mode-desc">`:
 - Quick: `Price comes from the labor rate, crew size and the markups below.`
 - Accubid: `Price comes from crew rates, overhead & markup, and vendor quotes (Chris’s Accubid setup).`
4. Job conditions (`factorsRow` for now; Task 3).
5. Quick: the rates row for now (Task 4). Accubid: `AccubidPricingPanel` (Task 5).
6. FeedersPanel (moved below the pricing sections; Task 6).
7. Button row + table + modal (Tasks 7–8).

### 2c. Recheck banner
```
<div className="lp-banner lp-banner-wrap" data-testid="lp-recheck-banner">
<span>{N} line{s} kept from the previous analysis run (you had edited {it|them}) — re-check {it|them} against the new takeoff.</span>
<button type="button" className="est-link-btn" aria-expanded={whyOpen} aria-controls={whyId} data-testid="lp-recheck-why" onClick={…}>{whyOpen ? 'Hide' : 'Why?'}</button>
<div id={whyId} className="lp-banner-more" hidden={!whyOpen} data-testid="lp-recheck-why-text">Sync from takeoff re-binds {it|them} to the new run only on the same category, unit and description; a line it can’t match is left as is (it may duplicate a new takeoff line) — mark each one checked when done.</div>
</div>
```
Both sentences keep today's wording, so the full original text stays in the banner's textContent.

**Edge cases:**
- Mode switch to Accubid: the hook's key goes from null to bidId and fetches once.
- Switch back: the status block isn't rendered. The panel unmounts as today, so the form resets.
- `bidId` undefined in Accubid mode: no hook fetch and no panel, as today.

**Tests:**
- Order helper `expectOrder(...testids)` using `compareDocumentPosition`. With a dup and an unmatched line in Quick mode: `lp-status`, then `lp-pricing-mode-row`, then `lp-factor-chips`, then `lp-table`. Extend it in Tasks 3–8.
- No `lp-status` when nothing applies.
- Why?:
- `aria-expanded` flips, and `hidden` is removed;
- before opening, `lp-recheck-banner` textContent already contains "Sync from takeoff re-binds".
- Accubid mode (get routed as in the existing test, with `fixturePackageQuestion` and `blocksSend: true`):
- `accubid-fixture-package-question` and `accubid-blocks-send` are inside `lp-status` and not inside `accubid-pricing-panel`;
- `closest('[hidden]')` is null for both;
- `get` was called exactly once with `/estimating/bid1/accubid`.
- AccubidPricingPanel tests are unchanged and still green (`showStatus` defaults true).
- PcWorkspaceRerunReset is still green.

**Acceptance:**
- [ ] Payload tests are green, including `acbFixtureYesViaStep`.
- [ ] Every blocking element listed in the constraints renders above the first card.

---

## Task 3: Job conditions card

**Files:** new `pricing/JobConditionsCard.tsx`; `LaborPricingStep.tsx`; tests.

- Props: `{ library: Library | undefined; settings; setSettings; mode: 'phase_a'|'accubid' }`.
- Move `factorsByGroup` and `toggleFactor` over **verbatim** (same updater logic).
- Wrap in `<PricingCard storageKey="est-lp-conditions-open" defaultOpen title="Job conditions" testId="lp-conditions" summary={jobConditionsSummary(settings.factor_ids, library?.factors, settings.floors_above_2, mode)}>`.
- Body:
- Hint: `<p className="lp-hint">Pick at most one in each row. {mode === 'accubid' ? 'In Accubid pricing they multiply together (compound).' : 'Each one adds to the labor hours.'}</p>`
- `{factorsByGroup.length > 0 && <div className="lp-cond-groups" data-testid="lp-factor-chips">…</div>}`. Per group: `<div className="lp-cond-group" role="group" aria-labelledby={labelId}>` containing `<span id={labelId} className="lp-cond-group-label">{factorGroupLabel(group)}</span>`, then the chips **unchanged** (same class, testid, text, onClick), plus `aria-pressed={selected}`.
- Retired factors: any id in `settings.factor_ids` that is in `library.factors` but not active gets `<div className="lp-hint" data-testid="lp-factor-retired">Also applied: {label} (+{pct}%) — no longer offered in the library.</div>`.
- Floors: always rendered, as its own row: `<label className="lp-settings-field" title={unchanged title}>Floors above 2 <input … data-testid="lp-floors-above-2" (unchanged handler)/></label>` with `<span className="lp-hint">Only used by the Multi-story factor.</span>`.

**Tests:**
- The summary reads `None selected`. After rerendering with `factor_ids ['f1']` (Height 10–14, +10%) it reads `1 factor, +10% labor hours`.
- Toggle `lp-conditions-toggle` → `aria-expanded="false"`, the body is `hidden`, and `localStorage['est-lp-conditions-open'] === '0'`. A remount stays closed.
- Chips have `aria-pressed`. The existing mutual-exclusivity, N3 floors and S17 Accubid tests still pass unchanged.
- A retired factor shows `lp-factor-retired`.
- Group label `Working height` renders.

**Acceptance:**
- [ ] `saveFactors` parity is green.

---

## Task 4: Rates & markups card (Quick mode)

**Files:** new `pricing/QuickRatesCard.tsx`; `LaborPricingStep.tsx`; tests.

- Move the 8 inputs, their `onChange` handlers (`numberOrDefault` + `DEFAULT_SETTINGS`) and `SETTINGS_PCT_FIELDS` **verbatim**. Labels stay exactly the same.
- Use `<PricingCard storageKey="est-lp-rates-open" defaultOpen title="Rates & markups" testId="lp-rates" summary={ratesSummary(settings)}>`, with two fieldsets:
- `<fieldset className="lp-rate-group"><legend>Labor</legend><div className="lp-settings-row">Labor rate ($/hr), Crew size</div></fieldset>`
- `<fieldset className="lp-rate-group"><legend>Markups</legend><div className="lp-settings-row">Material tax %, Consumables %, Small tools %, Supervision %, Overhead %, Profit %</div></fieldset>`
- Render it only in Quick mode, as today. It is open by default. Once Jake closes it, it stays closed in this browser (decision note below).

**Tests:**
- The summary is `Labor $40/hr · Crew 3 · Overhead 10% · Profit 15% · Tax 7%`.
- The legends `Labor` and `Markups` exist.
- After collapsing, `getByDisplayValue('40')` still exists and a change still calls `setSettings` (hidden ≠ removed).
- Accubid mode: `queryByTestId('lp-rates')` is null.
- R2-N1 tests are unchanged and green.

**Acceptance:**
- [ ] `saveQuickRates` parity is green.

---

## Task 5: Accubid sections as cards

**File:** `AccubidPricingPanel.tsx`, plus tests. Section components get their card wrapper. All handlers, inputs, add rows and testids stay the same.

| Card | storageKey | defaultOpen | title | testId (outer `section`) | summary |
|---|---|---|---|---|---|
| Crew & markup | `est-lp-acb-crew-open` | true | `Crew & markup` | `accubid-crew-card` | `crewSummary(form, dirty)` |
| Vendor quotes | `est-lp-acb-quotes-open` | `quotes.length > 0` | `Vendor quotes` | `accubid-quotes` (kept) | `quotesSummary(quotes)` |
| Equipment | `est-lp-acb-equipment-open` | true | `Equipment` | `accubid-costlines-equipment` (kept) | `costLinesSummary(…)`, plus ` · default available` when `onUseDefault` |
| General expenses | `est-lp-acb-ge-open` | true | `General expenses` | `accubid-costlines-general_expense` (kept) | same |
| Alternates | `est-lp-acb-alternates-open` | `alternates.length > 0` | `Alternates` | `accubid-alternates` (kept) | `alternatesSummary` |
| Selling price breakdown | `est-lp-acb-price-open` | true | `Selling price breakdown` | `accubid-price-card` | `money(recap.sellingPrice)` |

- **Crew & markup body:**
- `<fieldset className="lp-rate-group"><legend>Crew</legend>` holds the shift row, the night row (still only on Night) and the burden/fringe/total-hours row.
- `<fieldset className="lp-rate-group"><legend>Overhead & markup</legend>` holds the 7 fields.
- Then the `accubid-save-settings` button, unchanged.
- When `dirty`, add `<span className="lp-hint" data-testid="accubid-crew-dirty-note">Not saved yet — this button saves crew & markup (the main Save doesn’t).</span>`.
- The header summary also ends in ` · Not saved` (wrap that part in `<span className="lp-card-summary-warn">`).
- **Selling price body:** the table is unchanged (`accubid-recap-table`), followed by `<p className="lp-hint" data-testid="accubid-price-hint">The Bid summary on the right is the live total, including unsaved changes.</p>`.
- The `accubid-pricing-panel` wrapper div and the `accubid-loading` early return stay.
- With `showStatus` (standalone use), the status block renders first, outside every card.
- The fixture-package prompt is **never** inside the Quotes card.

**Edge cases:**
- Closed Quotes + the first quote: the add row is inside the body, so Jake opens the card first, which stores `'1'`.
- A budget-pending quote stays visible through the status hold and the Quotes summary ("1 budget-pending").
- Unsaved crew edits stay in `form` state when the card closes (hidden, not unmounted).

**Tests (AccubidPricingPanel.test.tsx):**
- Add `localStorage.clear()` in `beforeEach`.
- Empty quotes and alternates: `accubid-quotes-toggle` and `accubid-alternates-toggle` have `aria-expanded="false"`, and their bodies are `hidden`. With quotes present, Quotes is open.
- Toggle Quotes → `localStorage['est-lp-acb-quotes-open'] === '1'`.
- Summary: two quotes with one pending → `2 quotes · $9,500.00 · 1 budget-pending`.
- Editing "Labor overhead %" shows `Not saved` in `accubid-crew-card-summary` and `accubid-crew-dirty-note`.
- `accubid-fixture-package-question` has no `[hidden]` ancestor when Quotes is closed.
- Every existing test passes unchanged: placeholders are reached through `within(getByTestId('accubid-quotes'))`, and `'12.500'` text is still present.

**Acceptance:**
- [ ] All `acb*` parity cases are green.

---

## Task 6: Feeders card (Calibration always visible)

**File:** `FeedersPanel.tsx`, plus tests.

- Keep `if (!data || !Array.isArray(data.edges)) return null;`.
- Render `<PricingCard storageKey="est-lp-feeders-open" defaultOpen title="Feeders" testId="lp-feeders" summary={feedersSummary(data)} collapsible={data.edges.length > 0} pinned={<CalibrationToggle … unchanged />}>`.
- The body holds the existing `lp-feeders-summary` line and the cards, unchanged. With zero edges there are no children.
- `CalibrationToggle` is untouched: same label, checkbox, PATCH and toast.
- Remove the `.lp-feeders` wrapper class from the outer element. The card provides the frame, so keep `.lp-feeders` only if it is used for gaps inside the body.

**Tests:**
- Zero edges: no `lp-feeders-toggle`, summary `None found on this job`, and `lp-calibration` is visible.
- With edges: collapse it, and `lp-calibration` has no `[hidden]` ancestor.
- Summary: `2 feeders · 1 to confirm · 1 need a location / scale / size`. With `calibration: true` it ends in `· Calibration job`.
- Existing C7 tests are green.

**Acceptance:**
- [ ] `feederAdopt*`, `calibrationOn`, `saveFeederTypeLength` and `saveFeederConfirmLength` parity are green.

---

## Task 7: Line filter bar, compact rows, keyboard fixes, sidebar "held lines" jump

**Files:** new `pricing/LineFilterBar.tsx`; `LaborPricingStep.tsx`; `EstimatingWorkspace.tsx`; tests.

### 7a. State (LaborPricingStep)
Replace `holdsOnly` with:
```ts
const [lineFilter, setLineFilter] = useState<LineFilterKey>('all');
// Rows that matched when the filter was picked stay listed until the next pick, so a
// row never vanishes under the cursor when its price clears the hold.
const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(() => new Set());
const chooseFilter = (k: LineFilterKey) => {
const next = k === lineFilter && k !== 'all' ? 'all' : k;
setLineFilter(next);
setPinnedKeys(new Set(lines.flatMap((l, i) => lineMatchesFilter(next, l, ctx) ? [lineKey(l, i)] : [])));
};
```
- `ctx = { holdIds: holdById, furnishIds: furnishById }`.
- `shownCategories` filters rows with `lineFilter === 'all' || lineMatchesFilter(lineFilter, line, ctx) || pinnedKeys.has(lineKey(line, idx))`, and drops empty categories.
- `isCollapsed = !!collapsed[category] && lineFilter === 'all'`.

### 7b. LineFilterBar (directly above the table)
```
<div className="lp-filterbar" role="group" aria-label="Show lines" data-testid="lp-filter-bar">
{LINE_FILTERS.filter(f => f.key === 'all' || counts[f.key] > 0 || f.key === active).map(f =>
<button type="button" className={`lp-filter-chip${f.key === active ? ' lp-filter-chip-active' : ''}`} aria-pressed={f.key === active}
  title={f.title} data-testid={f.key === 'holds' ? 'lp-holds-filter' : `lp-filter-${f.key}`} onClick={() => onChoose(f.key)}>
  {f.key === 'all' ? 'All' : `${f.label} (${counts[f.key]})`}
</button>)}
{active !== 'all' && <span className="lp-filter-count" aria-live="polite" data-testid="lp-filter-count">Showing {shown} of {total} lines</span>}
<button type="button" className={`lp-filter-chip lp-density${compact ? ' lp-filter-chip-active' : ''}`} aria-pressed={compact} data-testid="lp-density-toggle" onClick={onToggleCompact}>Compact rows</button>
</div>
```
- The holds chip text stays `Needs a price/unit (N)` (same as the sidebar's "needs a price/unit"), so the D5 test is unchanged.
- Remove the old holds button from the button row.
- Compact: `const [compact, toggleCompact] = useStoredToggle('est-lp-table-compact');` and the table className becomes `lp-table${compact ? ' lp-table-compact' : ''}`.
- Empty state: when the filter isn't `all` and no rows show, render `<tbody>` with `<tr><td colSpan={10} data-testid="lp-filter-empty">No lines match this filter. <button type="button" className="est-link-btn" onClick={() => chooseFilter('all')}>Show all lines</button></td></tr>`.

### 7c. Edge cases
- `focusLineKey` effect: before the timeout, `if (lineFilter !== 'all') setLineFilter('all')`. The un-collapse logic is unchanged.
- `addManualLine`: if `lineFilter` is not `'all'` or `'changed'`, call `chooseFilter('all')`. The manual-line object is unchanged.
- Enter key: replace the `data-row={row+1}` lookup with "the next rendered element with the same `data-field`":
```ts
const all = Array.from(table.querySelectorAll<HTMLElement>(`[data-field="${field}"]`)); all[all.indexOf(target) + 1]?.focus();
```
Keep `e.preventDefault()` and the early returns.
- Category toggle: add `aria-expanded={!isCollapsed}` and `aria-label={`${isCollapsed ? 'Show' : 'Hide'} ${category} lines`}`. Keep the testid and the ▸/▾ text.

### 7d. Sidebar jump
- New optional props on LaborPricingStep: `requestedLineFilter?: LineFilterKey | null; onLineFilterApplied?: () => void`. An effect on `requestedLineFilter`: when set, call `chooseFilter` with it (if it isn't already the active filter, pick it as a fresh choice), scroll `lp-filter-bar` into view (`scrollIntoView?.({ block: 'start' })`), then call `onLineFilterApplied()`.
- In EstimatingWorkspace: `const [lineFilterRequest, setLineFilterRequest] = useState<LineFilterKey | null>(null);`, `onJumpToHolds={() => { onSelectStep('pricing'); setLineFilterRequest('holds'); }}`, and pass the two props. `onJumpToUnmatched` is unchanged.

**Tests (LaborPricingStep.test.tsx):**
- Counts for a fixture with one hold, one furnished, one feeder, one changed and one excluded line. Zero-count chips are absent. `aria-pressed` flips.
- Clicking the active chip returns to All.
- Pinning: with the holds filter on, rerender with a recap without the hold. The row is still shown and the chip reads `(0)` while active. Clicking `lp-filter-all` gives the normal list.
- `lp-filter-empty` shows for Excluded once its rows have been un-excluded and the filter is re-picked.
- `focusLineKey` with the Excluded filter active resets to All and focuses the field.
- Add manual line under holds switches to All.
- A collapsed category shows its rows under a filter.
- Compact toggle sets the class and `localStorage['est-lp-table-compact'] === '1'`.
- Enter skips filtered-out rows.
- `requestedLineFilter='holds'` applies once and calls `onLineFilterApplied`.
- The existing D5 and "no holds → no filter button" tests are unchanged and green.

**Acceptance:**
- [ ] All `save*` parity cases are green, and the filter never alters `lines`.

---

## Task 8: Sticky action bar (Save primary), visible Undo and delete, reset buttons reachable by keyboard

**Files:** `LaborPricingStep.tsx`, `estimating.css`, tests.

Replace the button row with this, as the **first child** of `.lp-page`:
```
<div className="lp-actionbar" role="group" aria-label="Save and sync" data-testid="lp-action-bar">
<button type="button" className="btn ghost" onClick={onSync} disabled={syncing} data-testid="lp-sync-button">{syncing ? 'Syncing…' : 'Sync from takeoff'}</button>
<button type="button" className="btn ghost" onClick={addManualLine} data-testid="lp-add-manual">Add manual line</button>
{lastDeleted && <span className="lp-actionbar-note">Line deleted. <button type="button" className="est-link-btn" data-testid="lp-undo-delete" onClick={undoDelete}>Undo</button></span>}
<span className="lp-actionbar-status" aria-live="polite">
{saveError && <span className="lp-actionbar-error" data-testid="lp-save-error">{saveError}</span>}
{openDups.length > 0 && <span data-testid="lp-save-blocked">{openDups.length === 1 ? 'Resolve the possible duplicate below before saving.' : `Resolve the ${openDups.length} possible duplicates below before saving.`}</span>}
</span>
<button type="button" className="btn" onClick={() => void save()} disabled={saving || openDups.length > 0} data-testid="lp-save-button"
title={openDups.length ? 'Resolve the possible duplicate first' : undefined}>{saving ? 'Saving…' : 'Save'}</button>
</div>
```
- The Save condition, `title`, `onSync`, `addManualLine` and `undoDelete` are all unchanged.
- Delete toast `sub` becomes `'Use Undo next to Save to bring it back.'`.
- Manual-line delete button: `className="lp-link-btn"`. Keep the testid and the "delete" text.
- Fix the reset buttons with CSS only: `.lp-cell-edited:focus-within .lp-reset-btn { display:inline; }`.

**Edge cases:**
- Save error and the dup-blocked note can both show.
- Undo and the error can both show.
- The bar wraps on narrow screens. Save stays last in DOM and tab order and is pushed right with `margin-left:auto`.
- The confirm dialog for Sync with unsaved changes is unchanged.

**Tests:**
- `lp-action-bar` is the first element of `labor-pricing-step`. It contains `lp-sync-button`, `lp-add-manual` and `lp-save-button`, in that order. Save has class `btn` and not `ghost`.
- With a dup: Save is disabled and `lp-save-blocked` reads `Resolve the possible duplicate below before saving.` The existing A7 tests are green.
- `lp-save-error` still reads `Network error`.
- `lp-undo-delete` is inside `lp-action-bar` and has class `est-link-btn`. `lp-delete-N` has class `lp-link-btn`.
- The existing N8 and B5 sync tests are green, and `PcWorkspacePricingDirtyGuard` is green.

**Acceptance:**
- [ ] `saveDeleteUndo` and `syncNoBody` parity are green.

---

## Task 9: CSS, BidSummary wording, final pass

**`estimating.css`**, under `/* UI cleanup round 2B — Labor & Pricing. */`:
- `.lp-page{display:flex;flex-direction:column;gap:12px}`
- `.lp-actionbar{position:sticky;top:0;z-index:4;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 0;background:var(--bg);border-bottom:1px solid var(--border)}`
- `.lp-actionbar .btn{height:34px;padding:0 14px;font-size:12.5px}`
- `.lp-actionbar-status{display:flex;flex-direction:column;font-size:12px;color:var(--text3)}`
- `.lp-actionbar-error{color:var(--red)}`
- `.lp-actionbar [data-testid="lp-save-button"]{margin-left:auto}`
- `.lp-status{display:flex;flex-direction:column;gap:8px}`
- `.lp-banner-wrap{flex-wrap:wrap}`
- `.lp-banner-more{flex-basis:100%;font-weight:600}`
- `.lp-card{border:1px solid var(--border);border-radius:var(--rs);background:var(--panel)}`
- `.lp-card-title{margin:0;font-size:13px}`
- `.lp-card-toggle,.lp-card-static{display:flex;align-items:center;gap:8px;width:100%;padding:10px 12px;background:none;border:none;font:inherit;font-weight:800;color:var(--text);text-align:left;cursor:pointer}` (`.lp-card-static{cursor:default}`)
- `.lp-card-toggle:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}`
- `.lp-card-summary{margin-left:auto;font-size:12px;font-weight:600;color:var(--text3);text-align:right}`
- `.lp-card-summary-warn{color:var(--amber);font-weight:800}`
- `.lp-card-pinned,.lp-card-body{padding:0 12px 12px}`
- `.lp-mode-card{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 12px}`
- `.lp-mode-desc{font-size:12px;color:var(--text3)}`
- `.lp-rate-group{border:none;margin:0 0 8px;padding:0}`
- `.lp-rate-group legend{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--text3);margin-bottom:4px}`
- `.lp-cond-groups{display:flex;flex-direction:column;gap:6px}`
- `.lp-cond-group{display:flex;flex-wrap:wrap;align-items:center;gap:6px}`
- `.lp-cond-group-label{min-width:130px;font-size:11.5px;font-weight:700;color:var(--text2)}`
- `.lp-hint{font-size:12px;color:var(--text3);margin:0 0 8px}`
- `.lp-filterbar{display:flex;flex-wrap:wrap;align-items:center;gap:6px}`
- `.lp-filter-chip{padding:4px 10px;border-radius:99px;border:1px solid var(--border2);background:var(--surface2);color:var(--text2);font:inherit;font-size:11.5px;font-weight:700;cursor:pointer}`
- `.lp-filter-chip-active{border-color:var(--blue);background:var(--blue-soft);color:var(--text)}`
- `.lp-filter-chip:focus-visible,.lp-factor-chip:focus-visible{outline:2px solid var(--blue);outline-offset:2px}`
- `.lp-density{margin-left:auto}`
- `.lp-filter-count{font-size:12px;color:var(--text3)}`
- `.lp-table-compact{font-size:12px}`
- `.lp-table-compact td{padding:2px 6px}`
- `.lp-table-compact input{padding:1px 4px}`
- `.lp-link-btn{display:inline;margin-left:6px;background:none;border:none;padding:0;font:inherit;font-size:10px;color:var(--text3);text-decoration:underline;cursor:pointer}`
- `.lp-cell-edited:focus-within .lp-reset-btn{display:inline}`
- Mobile, `@media (max-width:700px)`: `.lp-card-summary{display:none}` (the toggle stays one line) and `.lp-cond-group-label{min-width:0;width:100%}`.

**BidSummary.tsx:** `fixturePackageText()` becomes `'A vendor quote may be the fixture package — answer it at the top of Labor & Pricing'`. In BidSummary.test.tsx add `expect(fixturePackageText()).toBe(…)`. The parity test already uses the function. No other BidSummary change: the strip and warning rows stay as they are.

**Final:**
- `npx tsc --noEmit`;
- `npx vitest run` (full suite);
- `git diff main --stat -- ../backend` is empty;
- `git diff <task0-sha> -- src/features/estimating/pricing/payloadCases.ts` is empty.

**Acceptance (whole round):**
- [ ] In both modes, top to bottom: action bar → status → mode → Job conditions → Rates & markups / Accubid cards → Feeders → filter bar → table.
- [ ] Every card works by keyboard. `aria-expanded` and `aria-controls` are correct. Closed state survives a reload (localStorage keys `est-lp-*`).
- [ ] Every Task 0 body is byte-identical. Save's disabled condition and every blocking banner are unchanged and never inside a hidden body.

---

## Reviewer focus
1. **Payload parity.**
 - Confirm the Task 0 commit predates any component change (run its tests against `c2a3469`).
 - `payloadCases.ts` has no diff since then.
 - Bodies are compared as exact JSON strings and `toStrictEqual`.
 - The driver-set equals the CASES-set.
 - `acbFixtureYesViaStep` proves the lifted Accubid hook sends the same PUT.
2. **Blocking is visible and unchanged.**
 - `lp-save-button` stays `disabled={saving || openDups.length > 0}`.
 - None of these has a `[hidden]` ancestor in any state: `lp-duplicates`, `accubid-blocks-send`, `accubid-fixture-package-question`, `accubid-error`, `lp-unmatched-banner`, `lp-recheck-banner`, `lp-save-error`, `lp-calibration`.
 - The fixture-package question is still answered only by Jake's click, and No still marks every open quote.
3. **The brief's claim was wrong: unmatched lines never blocked Save.** Don't let a "fix" add that block. That would be a behavior change.
4. **One Accubid fetch.** `useAccubidPricing` runs in LaborPricingStep (null unless Accubid mode with a bidId). The panel's own hook gets `null` when `pricing` is passed. Check there's no second GET `/accubid` and no stale state after Yes/No, since status and panel share one hook instance.
5. **Display-only math.** `jobConditionsSummary` mirrors `effectiveFactorPct` (Quick, additive) and `compoundLaborFactorMultiplier` (Accubid). That means first-per-group, multistory × floors, and every library factor by id. It uses `/estimating/library`, which can differ from the bid's dated library (`getLibraryForBid`), so the % is a label, never sent. The reviewer should compare the summary with the sidebar labor hours on one real bid.
6. **Filters never edit lines.** Pinned rows stay until the next pick. `focusLineKey` and Add manual line reset the filter so the target row is visible. The Enter-key change only affects which row gets focus.
7. **Hidden, not unmounted.** Typed-but-unsaved Accubid crew values survive a collapse, and the header says "Not saved". No test relies on `getByRole` inside a closed card.
8. **Sticky bar.** jsdom can't test it. Check in a browser at desktop, tablet and mobile that it sticks inside `.est-work`, doesn't cover the first row, and doesn't collide with the mobile bottom summary.
9. **Pre-existing fixes in this round:** Undo and delete were invisible (`.lp-reset-btn{display:none}`), and reset was hover-only. Confirm they're now visible and reachable by keyboard.
10. **Testids kept:**
  - Step: `labor-pricing-step`, `lp-pricing-mode-row`, `lp-switch-pricing-mode`, `lp-floors-above-2`, `lp-factor-chips`, `lp-factor-<CODE>`.
  - Banners: `lp-duplicates`, `lp-dup-*`, `lp-recheck-banner`, `lp-unmatched-banner`.
  - Actions: `lp-sync-button`, `lp-add-manual`, `lp-save-button`, `lp-save-error`, `lp-undo-delete`, `lp-holds-filter`.
  - Table and rows: `lp-table`, `lp-category-toggle-*`, `lp-row-*`, every row badge and input testid.
  - Resolver: `lp-resolver-*`.
  - Feeders: `lp-feeders`, `lp-feeders-summary`, `lp-feeder-*`, `lp-calibration`, `lp-calibration-checkbox`.
  - Accubid: `accubid-pricing-panel`, `accubid-loading`, `accubid-blocks-send`, `accubid-error`, `accubid-shift`, `accubid-save-settings`, `accubid-fixture-package-*`, `accubid-quotes`, `accubid-quote-*`, `accubid-add-quote`, `accubid-costlines-*`, `accubid-costline-*`, `accubid-use-default-*`, `accubid-alternates`, `accubid-alternate-*`, `accubid-add-alternate`, `accubid-recap-table`, `accubid-selling-price`.
11. **Decisions for Jake:**
  - (a) Rates & markups and Job conditions start open, and once closed they stay closed in that browser for every bid.
  - (b) The filter chip keeps the sidebar's wording "Needs a price/unit" rather than "Needs a price".
  - (c) The Accubid "Selling price breakdown" can lag the sidebar during a visit (pre-existing). This round only adds a hint and doesn't fix it.
  - (d) "Changed" includes lines kept from the previous run.

### Critical Files for Implementation
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/estimating/LaborPricingStep.tsx
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/estimating/AccubidPricingPanel.tsx
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/estimating/FeedersPanel.tsx
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/estimating/estimating.css
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/estimating/LaborPricingStep.test.tsx (plus the reference-only `useEstimatingBid.ts`, `useAccubidPricing.ts`, `useStoredToggle.ts`, `EstimatingWorkspace.tsx`, `BidSummary.tsx`, and `backend/src/estimating/pricing.ts` / `accubidRecap.ts` for the factor math)