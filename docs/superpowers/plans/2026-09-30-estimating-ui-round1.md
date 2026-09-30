# Plan: Estimating UI cleanup, round 1

Frontend root: `/Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend` (all paths below are relative to it unless absolute).

## Goal
Make the Estimating workspace less crowded and easier to read for an estimator, without changing any pricing math, how review answers are saved, or any blocking behavior:
1. Both sidebars can be collapsed, and the choice is remembered per browser.
2. Plain-language wording.
3. RFIs get their own step. The order becomes Documents → Takeoff → Scope → RFIs → Labor & Pricing → Review & Proposal.
4. The Scope page is tidied up.

## Audit corrections (checked against the code)
- **Confirmed:** steps.ts contents, the ScopeListPanel placement, the slim bar at tablet width / in Plans view, the right sidebar = BidSummary / AccubidSummaryRows, and every wording location listed in the audit.
- **ScopeListPanel is not just for the proposal.** Agent 2 reads it during the takeoff run: `backend/src/routes/preconstruction.ts:1354` passes `renderScopeListBlock(getBidScopeList)` into Agent 2's prompt. Moving it after Takeoff means a Not-included list typed after the run only reaches Agent 4 and the proposal gate. Task 5 adds a small pre-run hint on the Takeoff step to cover this. **Flag this to Jake.**
- **The autosave does not watch `ws.scopeMeta`.** The effect deps at `PcWorkspaceView.tsx:275-276` list scope and rfis but not scopeMeta. Every scopeMeta write today also changes scope, so this never mattered. The new "No RFIs" flag lives in scopeMeta, so `ws.scopeMeta` must be added to the deps or the flag never saves.
- **All three scopeMeta writers in ScopeTab.tsx rebuild it as `{ ai, recheck }` and drop any other keys** (lines 22, 36, 90). They must spread the existing object.
- **`onGoTakeoff` (PcWorkspaceView.tsx:1236) is dead code.** It only sets `activeTab`, which does not move the new shell, and nothing uses it. BidTab's "View Results" button does the same no-op; leave that alone.
- **Every saved or remembered step form (full list):**
  - URL `?step=<key>`: keys only, read by `useEstimateStepParam`.
  - `ws.activeTab`, which is `bid_workspaces.active_tab` (a PcTabKey). App.tsx:172-183 restricts it to PC_TABS.
  - `ws.step`, which is `bid_workspaces.step`: the old 7-step tracker (`intake`…`submitted`). The new shell never reads it; only OverviewTab (not rendered) and `advanceStep` do.
  - localStorage `apt-estimating-takeoff-view` (List/Plans), which is unaffected.
  - **Nothing saves a numeric step index.** No other page, notification or backend link builds `?step=` (searched frontend/src and backend/src). The only in-app links are `onGoTab('estimating')` / `onOpenBid(id,'estimating')`, with no step.
- **No backend change or migration is needed.** `scope_meta` is stored as-is by `PUT /:bidId/workspace` (preconstruction.ts:2046-2078) and restored by App.tsx:186. The latest migration is `157_time_switch_unit.sql`; 158 would be next, but nothing here needs it.
- **A re-run clears the new flags (intended).** `backend/src/services/rerunReset.ts` `resetScope` returns `meta: { ai: {}, recheck }`, so `noRfis` and `aiRfisImported` are dropped. A new run can suggest new RFIs. The client installs `reset.scopeMeta` in `applyServerReset`.

## Constraints for the builder
- Work in the worktree only. Do not touch `electrical_crm` or any database, and do not start the app, merge or push.
- Do not change pricing math, `useEstimatingBid`, review-answer saving, any backend file, or the stored `pricing_mode` values (`'phase_a'` / `'accubid'`).
- Keep all blocking and warnings:
  - unmatched or duplicate lines still block Save in Labor & Pricing;
  - the proposal is still blocked by open review items or a pending analysis (`reviewBlocked` in ProposalTab is unchanged, and so are the button `disabled` conditions);
  - every BidSummary warning row still renders.
- Match the surrounding style: inline styles where the file already uses them, classes in `estimating.css` for new shell and step chrome, and short "why" comments in the existing "UI cleanup round 1 —" form.
- After each task run `npx tsc --noEmit` plus `npx vitest run src/features/estimating src/features/preconstruction`. At the end run `npx vitest run` (full suite).

---

## Task 1: Step model (steps.ts) and every mapping of legacy step forms

**Files:**
- `src/features/estimating/steps.ts`
- `src/features/estimating/steps.test.ts`
- `src/features/estimating/useEstimateStepParam.test.tsx`

**Changes to steps.ts:**

1. Change the type to `EstimateStepKey = 'documents' | 'takeoff' | 'scope' | 'rfis' | 'pricing' | 'review'`.
2. `ESTIMATE_STEPS`, in this order:
   ```ts
   { key: 'documents', label: 'Documents' },
   { key: 'takeoff', label: 'Takeoff' },
   { key: 'scope', label: 'Scope' },
   { key: 'rfis', label: 'RFIs' },
   { key: 'pricing', label: 'Labor & Pricing' },
   { key: 'review', label: 'Review & Proposal' },
   ```
   Update the header comment ("five steps" becomes "six").
3. `mapLegacyTabToStep`: `'scope'` goes to `'scope'`, and `'rfis'` now goes to `'rfis'`. Everything else is unchanged. Update the doc comment's mapping list.
4. `stepToLegacyTab`: add `case 'rfis': return 'rfis';`. `'rfis'` is a valid `PcTabKey` and is in App.tsx's `validTabs`.
5. Extend `StepStatusInput`:
   ```ts
   /** UI cleanup round 1 — RFI step inputs. */
   analysisRunning: boolean;
   rfiCount: number;
   draftRfiCount: number;      // rfis with !submitted
   pendingAiRfiCount: number;  // AI-suggested questions not yet imported
   noRfis: boolean;            // estimator clicked "No RFIs"
   ```
6. `deriveStepStatus`:
   ```ts
   const takeoff = input.hasTakeoffOutput && input.takeoffConfirmed;
   return {
     documents: input.hasFiles,
     takeoff,
     // Round 1 — a pre-bid import used to turn Scope green before any takeoff.
     scope: takeoff && input.hasScopeText,
     rfis: !input.analysisRunning && input.draftRfiCount === 0
       && (input.noRfis || (input.rfiCount > 0 && input.pendingAiRfiCount === 0)),
     pricing: input.hasSavedPricingLines && !input.hasUnmatchedNonExcluded,
     review: input.proposalFiled,
   };
   ```
7. `stepHint(key, done, opts?: { analysisRunning?: boolean })`:
   - If `opts?.analysisRunning` is true and `key === 'takeoff'`, return `'Running…'`.
   - If `opts?.analysisRunning` is true, the key comes after takeoff in `ESTIMATE_STEPS`, and `!done[key]`, return `'Takeoff running…'`.
   - Otherwise use the existing logic: "Needs {prev.label} first".

**steps.test.ts changes:**
- Add `rfis` to the `ALL_DONE` and `NONE_DONE` records.
- Mapping: `'rfis'` → `'rfis'`, `'scope'` → `'scope'`. The round-trip test keeps working for all six steps.
- Add a test that the step order is exactly `['documents','takeoff','scope','rfis','pricing','review']`.
- Build every `deriveStepStatus` input from a full `BASE` object with all new fields (TS will require them). Add:
  - scope is false when there is scope text but takeoff is not done, and true when both are true;
  - rfis is false while analysisRunning;
  - rfis is false with 0 RFIs and no flag;
  - rfis is true with `noRfis` and 0 drafts;
  - rfis is false with `noRfis` but 1 draft;
  - rfis is true with 2 submitted, 0 drafts and 0 pending;
  - rfis is false with 2 submitted and 1 pending;
  - rfis is true with `noRfis` even if pending > 0 (the estimator dismissed them).
- `stepHint` expectations:
  - `('pricing', NONE)` → `'Needs RFIs first'`
  - `('review', NONE)` → `'Needs Labor & Pricing first'`
  - `('scope', NONE)` → `'Needs Takeoff first'`
  - Change the "predecessor done" case to `stepHint('rfis', { ...NONE, scope: true })` → null.
  - New: with `{ analysisRunning: true }`, `'takeoff'` → `'Running…'`, and `'scope'`, `'rfis'`, `'pricing'`, `'review'` → `'Takeoff running…'` (when not done). `'documents'` → null. A done later step → null.

**useEstimateStepParam.test.tsx:** add a case where `?tab=estimating&step=rfis` resolves to `'rfis'`. Keep the `step=bogus` fallback test.

**Acceptance:**
- [ ] tsc is clean. Every `Record<EstimateStepKey, …>` literal in the repo includes `rfis` (TS will point them out).
- [ ] Old `?step=scope` still lands on Scope, and old `active_tab='rfis'` lands on RFIs. No numeric-step handling is added, because none is ever saved; say so in the steps.ts comment.

---

## Task 2: Collapsible sidebars (EstimateShell + BidSummary)

**Files:**
- New: `src/features/estimating/useStoredToggle.ts`
- `src/features/estimating/EstimateShell.tsx`
- `src/features/estimating/BidSummary.tsx`
- `src/features/estimating/EstimatingWorkspace.tsx`
- `src/features/estimating/estimating.css`
- `src/features/estimating/EstimateShell.test.tsx`
- `src/features/estimating/BidSummary.test.tsx`

### 2a. `useStoredToggle.ts`
```ts
export function useStoredToggle(key: string, fallback = false): [boolean, () => void]
```
- `read`: `try { const v = window.localStorage.getItem(key); return v === '1' ? true : v === '0' ? false : fallback; } catch { return fallback; }`
- State is initialised lazily with `read`.
- `toggle` is `useCallback(() => setValue(v => !v), [])`.
- Write with a `useEffect([key, value])` that skips the first run (`firstRef`) and does `try { localStorage.setItem(key, value ? '1' : '0') } catch { /* private mode — works for this session only */ }`.
- Header comment should reference the `usePlanViewParams.ts` pattern.

### 2b. BidSummary.tsx helpers
Add pure, exported helpers so the strip can never disagree with the panel:

1. `bidSummaryHeadline(a: { recap; pricingMode?; accubid?; proposed; dirty?; savedGrandTotal? })` returns `{ label: 'Selling price' | 'Total'; total: number | null; note: string | null }`.
   - Use the same `shownTotal` and `staleEstimate` logic that is inline today.
   - `note` is `'Unsaved proposal'` if proposed, else `'Unsaved changes'` if dirty, else `'Estimate changed since last save'` if stale, else null.
   - Refactor `BidSummary` itself to call this for `shownTotal`, `staleEstimate` and the label. The JSX and testids stay unchanged.
2. `bidSummaryWarnings(a: { warnings; linesNotVerifiedOnPlansCount?; ambiguousQtyKeys?; reviewFlags? })` returns `Array<{ id: string; text: string; muted: boolean }>`.
   - Rows come in exactly the render order and under exactly the render conditions of the `bs-warnings` section.
   - `id` is the suffix of the row's existing testid: `not-verified-on-plans`, `unmatched`, `fuzzy`, `review-<kind>`, `confirm-match`, `verify`, `zero-material`, `unverified`, `excluded` (muted: true), `ambiguous-qty`.
   - `text` is exactly the row's rendered textContent, e.g. `` `${n} unmatched line${n === 1 ? '' : 's'}` `` and `` `${of.length} ${…} — check the takeoff review` ``.
   - Do not change the existing row JSX. The parity test below enforces agreement.
3. New `BidSummaryStrip(props)`.
   - Props: `recap`, `proposed`, `dirty?`, `savedGrandTotal?`, `pricingMode?`, `accubid?`, `reviewFlags?`, `linesNotVerifiedOnPlansCount?`, `ambiguousQtyKeys?`.
   - It is purely presentational (spans and one Icon only, because it sits inside a `<button>`):
   ```tsx
   <span className="bs-strip" data-testid="bs-strip">
     <span className="est-sr-only">Show bid summary. </span>
     <span className="bs-strip-label">{h.label}</span>
     <span className="bs-strip-total" data-testid="bs-strip-total" aria-hidden="true" title={full}>{h.total != null ? moneyShort(h.total) : '—'}</span>
     <span className="est-sr-only">{h.total != null ? moneyFull(h.total) : 'not priced yet'}</span>
     {h.note && <span className="bs-strip-note" data-testid="bs-strip-note" title={h.note}>●<span className="est-sr-only">{h.note}</span></span>}
     {warn.length > 0 && (
       <span className="bs-strip-warn" data-testid="bs-strip-warnings" title={rows.map(r => r.text).join('\n')}>
         <Icon name="alert" size={12} stroke={2}/>{warn.length}
         <span className="est-sr-only"> warning{warn.length === 1 ? '' : 's'}: {warn.map(r => r.text).join('; ')}</span>
       </span>
     )}
   </span>
   ```
   Here `rows = bidSummaryWarnings(…)` and `warn = rows.filter(r => !r.muted)`. The tooltip lists every row, including the grey "excluded" row.

### 2c. EstimateShell.tsx
**New props:**
- `summaryStrip?: React.ReactNode`. The summary collapse toggle only renders when this is provided, so a caller without a strip can never hide warnings.
- `analysisRunning?: boolean`, passed to `stepHint(step.key, doneByStep, { analysisRunning })` in both the rail and the (unchanged) chip row.

**State:**
- `const [railCollapsed, toggleRail] = useStoredToggle('est-rail-collapsed');`
- `const [summaryCollapsed, toggleSummary] = useStoredToggle('est-summary-collapsed');`
- `const railStepsId = useId(); const summaryPanelId = useId();`

**Rail (desktop and tablet):**
- `<nav className={`est-rail${railCollapsed ? ' est-rail-collapsed' : ''}`} … data-collapsed={String(railCollapsed)}>`.
- Header, expanded: title span + save-state span (as today) + a toggle button.
- Header, collapsed: the toggle button, then a compact save state:
  `<span data-testid="est-save-state" className={`est-save-state-compact${saveState === 'error' ? ' est-save-state-error' : ''}`} title={text || undefined}>`
  containing `{error && <Icon name="alert" size={14} stroke={2}/>}{saving && <span aria-hidden="true">…</span>}<span className="est-sr-only">{text}</span>`.
  An error is never hidden.
- Toggle button: `type="button" className="est-panel-toggle" data-testid="est-rail-toggle" aria-expanded={!railCollapsed} aria-controls={railStepsId} aria-label={railCollapsed ? 'Expand steps' : 'Collapse steps'} title={same}`, containing `<Icon name="chevron-down" size={14} stroke={2} style={{ transform: railCollapsed ? 'rotate(-90deg)' : 'rotate(90deg)' }}/>`.
- Wrap the step buttons in `<div id={railStepsId} className="est-rail-steps">`.
- Collapsed step button: the same button, className and testid, but render only `.est-rail-step-marker` (number or check). Add `aria-label={name}` and `title={name}`, where `name = `${i + 1}. ${step.label}${done ? ' — done' : ''}${hint ? ` — ${hint}` : ''}``. Keep `aria-current`.

**Desktop, not `forceSlimSummary`:**
- If `summaryStrip && summaryCollapsed`:
  ```tsx
  <aside className="est-summary est-summary-collapsed" id={summaryPanelId} data-testid="est-summary-collapsed">
    <button type="button" ref={summaryToggleRef} className="est-summary-expand" data-testid="est-summary-toggle" aria-expanded={false} aria-controls={summaryPanelId} onClick={onToggleSummary}>
      <Icon name="chevron-down" size={14} stroke={2} style={{ transform: 'rotate(90deg)' }}/>
      {summaryStrip}
    </button>
  </aside>
  ```
  Put no `aria-label` on this button; the strip's text, including its sr-only parts, is the accessible name.
- Otherwise use today's `<aside className="est-summary" data-testid="est-summary">`, adding `id={summaryPanelId}`. When `summaryStrip` is set, prepend:
  `<div className="est-summary-head"><span className="est-summary-title">Bid summary</span><button type="button" ref={summaryToggleRef} className="est-panel-toggle" data-testid="est-summary-toggle" aria-expanded={true} aria-controls={summaryPanelId} aria-label="Collapse bid summary" title="Collapse bid summary" onClick={onToggleSummary}><Icon … style={{ transform: 'rotate(-90deg)' }}/></button></div>`.

**Focus:** the summary toggle is a different element in each state, so manage focus. `onToggleSummary = () => { summaryToggledRef.current = true; toggleSummary(); }` and `useEffect(() => { if (summaryToggledRef.current) { summaryToggledRef.current = false; summaryToggleRef.current?.focus(); } }, [summaryCollapsed])`. The rail toggle stays mounted, so it needs nothing extra.

**Unchanged:** the tablet branch, the `forceSlimSummary` branch (`slimSummary`), and mobile. The summary preference is ignored there. The rail collapse does apply at tablet width.

### 2d. EstimatingWorkspace.tsx
- Add prop `analysisRunning?: boolean` and forward it to EstimateShell.
- Pass `summaryStrip={<BidSummaryStrip recap={recap} proposed={proposed} dirty={dirty} savedGrandTotal={savedGrandTotal} pricingMode={…same expression…} accubid={accubid} reviewFlags={reviewFlags} linesNotVerifiedOnPlansCount={linesNotVerifiedOnPlansCount} ambiguousQtyKeys={ambiguousQtyKeys}/>}`.

### 2e. estimating.css (new block, "UI cleanup round 1 — collapsible sidebars")
```css
.est-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.est-rail-header{align-items:center;gap:6px}           /* override baseline */
.est-save-state{margin-left:auto}
.est-panel-toggle{width:26px;height:26px;padding:0;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border2);border-radius:var(--rxs);background:var(--surface);color:var(--text2);cursor:pointer}
.est-panel-toggle:hover{background:var(--surface2);color:var(--text)}
.est-panel-toggle:focus-visible,.est-summary-expand:focus-visible,.est-rail-step:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.est-rail-steps{display:flex;flex-direction:column;gap:2px}
.est-rail-collapsed{width:56px;padding:12px 6px 16px}
.est-rail-collapsed .est-rail-header{flex-direction:column;padding:4px 0 10px}
.est-rail-collapsed .est-rail-step{justify-content:center;padding:9px 0}
.est-save-state-compact{display:flex;justify-content:center;min-height:14px;font-size:11px;font-weight:700;color:var(--text3)}
.est-summary-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.est-summary-title{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text3)}
.est-summary-collapsed{width:76px;padding:8px 6px}
.est-summary-expand{display:flex;flex-direction:column;align-items:center;gap:8px;width:100%;padding:8px 4px;border:none;border-radius:var(--rxs);background:transparent;color:var(--text);font:inherit;text-align:center;cursor:pointer}
.est-summary-expand:hover{background:var(--surface)}
.bs-strip{display:flex;flex-direction:column;align-items:center;gap:6px}
.bs-strip-label{font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);line-height:1.2}
.bs-strip-total{font-size:13px;font-weight:800;font-family:var(--mono);color:var(--text);word-break:break-all}
.bs-strip-note{color:var(--amber);font-size:10px}
.bs-strip-warn{display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:99px;background:var(--amber-soft);color:var(--amber);font-size:11px;font-weight:800}
```
The `.est-rail` gap now applies through `.est-rail-steps`; keep `.est-rail` as it is.

### Tests

**EstimateShell.test.tsx** (add `afterEach(() => localStorage.clear())`):
- Update to six labels: `['Documents','Takeoff','Scope','RFIs','Labor & Pricing','Review & Proposal']`.
- Change `'3 · Labor & Pricing'` to `'5 · Labor & Pricing'` (with `currentStep: 'pricing'`).
- Add `rfis: false` to the records.
- New rail tests at 1400px:
  - clicking `est-rail-toggle` sets `data-collapsed="true"`, `aria-expanded="false"`, and `aria-controls` equals the id of the element that contains `est-step-takeoff`;
  - after collapsing, `est-step-takeoff` has `aria-label` `'2. Takeoff — done'` and a matching `title`, and the rail's textContent no longer contains "Labor & Pricing";
  - `localStorage.getItem('est-rail-collapsed') === '1'`;
  - with `'1'` preset, the rail mounts collapsed;
  - collapsed + `saveState='error'` gives `est-save-state` textContent `'Not saved — retrying'`;
  - collapsed steps are still clickable (`onSelectStep('review')`);
  - rail collapse also works at 1000px.
- Storage failure: `vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('denied'); })` plus the same for setItem. The shell renders expanded, the toggle still collapses, nothing throws. Restore the mocks.
- Summary:
  - without `summaryStrip`, there is no `est-summary-toggle`;
  - with `summaryStrip={<span data-testid="strip">$1K</span>}`, clicking the toggle gives `est-summary` null, `est-summary-collapsed` present containing `strip`, `aria-expanded="false"`, storage `'1'`, and `document.activeElement` equal to the new `est-summary-toggle`;
  - clicking again restores `est-summary` and `summary-content`;
  - with storage preset to `'1'`, at 1000px the slim toggle is shown and there is no `est-summary-collapsed`; at 1400px with `forceSlimSummary` the same holds.
- `analysisRunning` shows `'Takeoff running…'` in `est-step-scope`.

**BidSummary.test.tsx:**
- Parity test: render `BidSummary` with every warning on:
  - `unmatchedCount` 2, `fuzzyMatchCount` 1, `confirmMatchCount` 1, `verifyCount` 3, `zeroMaterialMatchedCount` 1, `unverifiedMaterialShare` .25, `excludedCount` 2;
  - `linesNotVerifiedOnPlansCount` 4, `ambiguousQtyKeys` `['a','b']`;
  - one reviewFlag of each kind.

  Collect `container.querySelectorAll('[data-testid^="bs-warning-"]')` as `[testid.replace('bs-warning-',''), textContent]` and `expect(...).toEqual(bidSummaryWarnings(sameArgs).map(r => [r.id, r.text]))`.
- Strip tests:
  - `bs-strip-total` is `moneyShort(10119)` (import `moneyShort`, never hard-code the string);
  - `bs-strip-warnings` textContent starts with the non-muted count;
  - only `excludedCount` gives no badge;
  - accubid mode with a null recap gives label "Selling price" and "—";
  - `proposed` shows `bs-strip-note` with title "Unsaved proposal".
- Existing BidSummary tests must pass unchanged, which proves the headline refactor is safe.

**Acceptance:**
- [ ] Both toggles are real `<button>`s with aria-expanded/aria-controls, can be reached with Tab and work with Enter/Space.
- [ ] The preference is saved under `est-summary-collapsed` / `est-rail-collapsed`, and a storage failure falls back to expanded.
- [ ] The collapsed strip always shows the total and the badge count, and its tooltip lists every warning row.
- [ ] The tablet and Plans-view slim bar are identical to before (existing forceSlimSummary tests pass untouched).

---

## Task 3: Wording (every user-facing string changed)

Leave comments, identifiers, testids and stored values alone.

| File:line (approx.) | Before | After |
|---|---|---|
| LaborPricingStep.tsx:339 | `'Switch this bid to Phase A pricing?'` | `'Switch this bid to Quick pricing?'` |
| LaborPricingStep.tsx:342 | `…overhead % and profit % (Phase A) instead of…` | delete ` (Phase A)` |
| LaborPricingStep.tsx:348 | `` `Switched to ${… 'Phase A'} pricing` `` | `'Quick'` in place of `'Phase A'` |
| LaborPricingStep.tsx:396 | `Pricing mode: <strong>…'Phase A'</strong>` | `'Quick pricing'` |
| LaborPricingStep.tsx:399 | `Switch to {…'Phase A'…} pricing` | `'Quick'` (reads "Switch to Quick pricing") |
| LaborPricingStep.tsx:504 | `<th>Conf</th>` | `<th title="How sure the AI takeoff is about this quantity: FIRM, APPROX or VERIFY">AI confidence</th>` |
| LaborPricingStep.tsx:~693 | checkbox label ` excl.` | ` Exclude` |
| TakeoffTab.tsx:334 | header `'Conf'` | `'AI confidence'` |
| RfisTab.tsx:35 | `title={… 'Run the 3-agent plan analysis first' …}` | remove the title attribute (the link from Task 5 replaces it) |
| ProposalTab.tsx:100 | `Agent 4 — Proposal Formatter` | `AI proposal` |
| ProposalTab.tsx:133 | `Internal Notes for Agent 4 (optional)` | `Notes for the AI proposal (optional)` |
| ProposalTab.tsx:175 | `'↺ Re-run Agent 4'` / `'Run Agent 4 — Generate Proposal'` | `'↺ Re-run AI proposal'` / `'Generate AI proposal'` |
| ProposalTab.tsx:207-209 | `⚠ Run the 3-agent plan analysis first — Agent 4 needs scope data from Agent 2.` | `<div data-testid="proposal-needs-takeoff" …same style…>⚠ The AI proposal needs a finished takeoff. {onGoTakeoff && <button type="button" className="est-link-btn" data-testid="proposal-go-takeoff" onClick={onGoTakeoff}>Finish the Takeoff step first →</button>}</div>` |
| ProposalTab.tsx:262 | `<strong>↺ Re-run Agent 4</strong>` | `<strong>↺ Re-run AI proposal</strong>` |
| ProposalTab.tsx:294 | `Generating the proposal with Agent 4…` | `Writing the AI proposal…` |
| ProposalTab.tsx:319 | `Agent 4 Did Not Complete` | `AI proposal did not finish` |
| ProposalTab.tsx:323 | `Click <strong>↺ Re-run Agent 4</strong> above` | `Click <strong>↺ Re-run AI proposal</strong> above` |
| BidTab.tsx:46 | `…then run the 3-agent AI pipeline: Agent 1 reads drawings, Agent 2 builds scope & estimate, Agent 3 runs QA review. Results appear in the Plan Review tab.` | `Add the plan set on the bid Overview (Plans & Job Profile), then run the AI takeoff. It reads the drawings, counts devices and fixtures, builds the scope and estimate, and checks its own work. Results appear below.` |
| BidTab.tsx:61 | title `Skip re-reading plans — reuse saved Agent 1 output and run Agents 2 & 3 only` | `Skip re-reading the plans — reuse the saved plan reading and only rebuild the scope and estimate` |
| BidTab.tsx:62 | `Resume from Agent 2` | `Resume (keep the plan reading)` |
| ScopeTab.tsx:57-63 | two Import buttons with "(Agent 2)" tooltip | replaced by the Task 6 menu |
| rerunReset.tsx:118 | `The Agent 4 proposal and the pre-bid draft` | `The AI proposal and the pre-bid draft` |
| TakeoffReviewPanel.tsx:808 | `Removed from Agent 1’s takeoff:` | `Removed from the AI takeoff:` |
| PcWorkspaceView.tsx:781 | toast `'No AI analysis available'` / `'Run the 3-agent analysis first.'` | title `'No AI-suggested RFIs'`, sub `aiResults?.agent2_output ? 'The AI takeoff didn’t suggest any RFIs for this bid.' : 'Finish the Takeoff step first.'` |
| PcWorkspaceView.tsx:883 | `'Failed to start Agent 4'` | `'Could not start the AI proposal'` |
| PcWorkspaceView.tsx:886 | toast title `'Agent 4 error'` | `'AI proposal error'` |
| useAiPoller.ts:174, 186 | toast title `'Agent 4 error'` | `'AI proposal error'` |

**Left alone on purpose** (put this list in the PR description):
- The run-log and progress lines `Agent 1 of 3…`, `Agent 2 of 3…`, `Agent 3 of 3…`, `Resuming from Agent 2…` (PcWorkspaceView 642/662/669-670, useAiPoller 94/98). These mirror the backend's own `setProgress` labels, which show in the same panel and are out of scope.
- TakeoffTab's token-cost table (`Agent {i+1} — …`, admin/cost info).
- All comments and identifiers (`runAgent4Proposal`, `agent4*`, testids like `stop-agent4`).

**Test updates:**
- LaborPricingStep.test.tsx:111: `'Phase A'` → `'Quick pricing'`.
- Add a test: in phase_a mode, the `lp-pricing-mode-row` text contains "Quick pricing" and not "Phase A". Where the existing switch test asserts `pricing_mode: 'phase_a'`, keep that assertion to prove the stored value is unchanged.
- PcWorkspaceProposal.test.tsx:198 → `/Re-run AI proposal/`; lines 345 and 439 → `/Re-run AI proposal|Generate AI proposal/`.
- Grep the test folders for every "Before" string above and update any hits.

**CSS (estimating.css):** `.est-link-btn{background:none;border:none;padding:0;font:inherit;font-weight:700;color:var(--blue);text-decoration:underline;cursor:pointer}` and `.est-link-btn:focus-visible{outline:2px solid var(--blue);outline-offset:2px}`. This is safe because ProposalTab, RfisTab and ScopeTab only render inside EstimateShell, which imports estimating.css.

**Acceptance:**
- [ ] `grep -rn "Phase A\|3-agent\|Agent [0-9]" src --include=*.tsx`, excluding comments and tests, shows only the "left alone" items.
- [ ] `pricing_mode` values are untouched.

---

## Task 4: RFI helpers and workspace flags

**Files:**
- New: `src/features/preconstruction/PcWorkspace/rfiSuggestions.ts`
- New: `rfiSuggestions.test.ts` (same folder)
- `src/features/preconstruction/constants.ts`
- `PcWorkspaceView.tsx`
- `ScopeTab.tsx` (the writer fix only; the rest of ScopeTab is Task 6)

1. `constants.ts` `scopeMeta` type becomes `{ ai?; recheck?; noRfis?: boolean; aiRfisImported?: boolean }` with this comment:
   > UI cleanup round 1 — RFI step state, stored in the free-form scope_meta JSON (no migration). The server's re-run reset (rerunReset.ts resetScope) rebuilds scope_meta without these keys, so a re-run re-opens the RFI step on purpose.
2. `rfiSuggestions.ts`:
   ```ts
   export const normRfiQuestion = (s: string) => s.trim().toLowerCase();
   /** Agent 2's rfis[].question, trimmed, blank-free, deduped (first wins). */
   export function aiRfiSuggestions(agent2Output: string | null | undefined): string[]  // uses parseAgentJson
   /** Suggestions not already on the list (same dedupe the import uses). */
   export function newAiRfiQuestions(agent2Output: string | null | undefined, existing: Array<{ question: string }>): string[]
   ```
3. In PcWorkspaceView:
   - Refactor `importRfisFromAnalysis` to use `aiRfiSuggestions` / `newAiRfiQuestions`. The toasts stay as in Task 3.
   - On "Nothing new to import", `set({ scopeMeta: { ...(ws.scopeMeta ?? {}), aiRfisImported: true } })`.
   - On success, `set({ rfis: [...], scopeMeta: { ...(ws.scopeMeta ?? {}), aiRfisImported: true, noRfis: false } })`.
   - `addRfi`: when `ws.scopeMeta?.noRfis` is true, also clear it: `scopeMeta: { ...ws.scopeMeta, noRfis: false }`.
   - New `const onSetNoRfis = useStableFn((v: boolean) => set(prev => ({ scopeMeta: { ...(prev.scopeMeta ?? {}), noRfis: v } })));`
   - Derived values, placed next to `doneByStep`:
     ```ts
     const aiRfiQuestions = useMemo(() => aiRfiSuggestions(aiResults?.agent2_output as string | undefined), [aiResults?.agent2_output]);
     const pendingAiRfiCount = ws.scopeMeta?.aiRfisImported ? 0
       : aiRfiQuestions.filter(q => !ws.rfis.some(r => normRfiQuestion(r.question) === normRfiQuestion(q))).length;
     ```
     Comment why the flag exists: editing an imported RFI changes its text, which would otherwise make the original look un-imported again.
   - **Critical:** add `ws.scopeMeta` to the autosave effect deps (line 275).
4. ScopeTab writer fix: `withoutAi` returns `{ ...(ws.scopeMeta ?? {}), ai, recheck }`. `importScope` and the textarea `onChange` also spread `...(ws.scopeMeta ?? {})` first.

**Tests:**
- `rfiSuggestions.test.ts`: fenced/bare JSON; blanks dropped; case/whitespace dedupe; the existing-list filter; garbage input returns `[]`.
- Extend PcWorkspaceAutosave.test or PcWorkspaceRfi.test: clicking "No RFIs for this bid" (Task 5) gives a workspace PUT whose `scope_meta.noRfis === true`. Use `waitFor(…, { timeout: 3000 })`. This proves the deps fix.

**Acceptance:**
- [ ] No scopeMeta writer drops unknown keys (grep `scopeMeta:` in src).
- [ ] The "No RFIs" choice survives a reload (it is in the PUT payload).

---

## Task 5: Separate RFI step, ScopeListPanel moved, links wired (PcWorkspaceView, RfisTab, ProposalTab)

**Files:**
- `PcWorkspaceView.tsx`
- `RfisTab.tsx`
- `ProposalTab.tsx`
- New test: `src/features/preconstruction/PcWorkspaceStepOrder.test.tsx`
- Existing tests: `RfisTab.test.tsx` (new), `PcWorkspaceRfi.test.tsx`, `PcWorkspaceRerunReset.test.tsx`

**PcWorkspaceView:**
1. Delete the dead `onGoTakeoff` (line 1236). After `onSelectStep`, add:
   - `const onGoTakeoffStep = useStableFn(() => onSelectStep('takeoff'));`
   - `const onGoScopeStep = useStableFn(() => onSelectStep('scope'));`
2. `doneByStep` gets the new inputs: `analysisRunning: ws.aiRunning`, `rfiCount: ws.rfis.length`, `draftRfiCount: ws.rfis.filter(r => !r.submitted).length`, `pendingAiRfiCount`, `noRfis: !!ws.scopeMeta?.noRfis`.
3. `case 'takeoff'`:
   - Remove the `<ScopeListPanel …/>` line.
   - After `{reviewPanel}`, add, only when `!aiResults?.agent2_output && !ws.aiRunning`:
     ```tsx
     <div data-testid="takeoff-scope-list-hint" style={{ fontSize: 12.5, color: 'var(--text2)', padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10 }}>
       Have an Included / Not included list from the pre-bid review? Add it before you run the takeoff — the AI follows it.{' '}
       <button type="button" className="est-link-btn" data-testid="takeoff-scope-list-link" onClick={onGoScopeStep}>Open the scope list →</button>
     </div>
     ```
     Comment: "Agent 2 reads the scope list during the run (preconstruction.ts Agent 2 block)."
4. `case 'scope'`: `<ScopeListPanel key={`scope-${resultsEpoch}`} bidId={bid.id} showToast={showToast}/>`, then `<ScopeTab … analysisRunning={ws.aiRunning}/>`.
5. New `case 'rfis'`: `<RfisTab …existing props… analysisRunning={ws.aiRunning} pendingAiRfiCount={pendingAiRfiCount} noRfis={!!ws.scopeMeta?.noRfis} setNoRfis={onSetNoRfis} onGoTakeoff={onGoTakeoffStep}/>`.
6. ProposalTab gets `onGoTakeoff={onGoTakeoffStep}`, and EstimatingWorkspace gets `analysisRunning={ws.aiRunning}`.
7. Everything else that references steps was checked and needs no change: `nextAction` is derived from ESTIMATE_STEPS ("Next: Scope", "Next: RFIs", …); BidSummary jumps go to 'pricing'/'takeoff'; `jumpToLineKey` goes to pricing; the review checklist link goes to `jumpToTakeoffPlans`.

**RfisTab:**
- New props:
  - `analysisRunning: boolean;`
  - `pendingAiRfiCount: number;`
  - `noRfis: boolean;`
  - `setNoRfis: (v: boolean) => void;`
  - `onGoTakeoff?: () => void;`
- Compute `draftCount = ws.rfis.filter(r => !r.submitted).length`. This replaces `openCount`; same value.
- Status banner above the toolbar. Show only the first that applies, using amber-soft or surface styling like the existing banners:
  1. `analysisRunning` → `data-testid="rfi-status-running"`: **"RFIs will appear when the takeoff finishes."**
  2. `noRfis` → `rfi-status-none`: **"Marked “No RFIs” for this bid."** plus `<button className="btn ghost" data-testid="rfi-no-rfis-undo" onClick={() => setNoRfis(false)}>Undo</button>`.
  3. `pendingAiRfiCount > 0` → `rfi-status-suggested`: **`The AI suggested ${n} RFI${n===1?'':'s'} — review & import`** plus `<button className="btn" data-testid="rfi-import-suggested" onClick={importRfisFromAnalysis}>Import {n} RFI{s}</button>`. Imported questions land as Draft rows tagged "AI", ready to edit. The button text must not be "Import from AI analysis", because an existing test relies on that text being unique.
  4. `!hasAnalysis` → `rfi-status-no-takeoff`: **"The AI suggests RFIs once the takeoff has run."** plus `{onGoTakeoff && <button className="est-link-btn" data-testid="rfi-go-takeoff" onClick={onGoTakeoff}>Finish the Takeoff step first →</button>}`.
- Toolbar: keep Add RFI, "Import from AI analysis" (still `disabled={!hasAnalysis}`, title removed) and Submit N Open RFIs.
- Add a "No RFIs" button when `!noRfis && !analysisRunning && draftCount === 0`: `<button className="btn ghost" data-testid="rfi-no-rfis" onClick={() => setNoRfis(true)}>{ws.rfis.length === 0 ? 'No RFIs for this bid' : 'No more RFIs'}</button>`.
- Table and "No RFIs yet" empty state: unchanged.

**ProposalTab:** add prop `onGoTakeoff?: () => void` (Task 3 row). Leave the disabled conditions, `reviewBlocked` and the verify panel alone.

**Tests:**
- `RfisTab.test.tsx` (new, happy-dom, render RfisTab directly with vi.fn props). Cover each banner:
  - running: no `rfi-no-rfis` button;
  - no-takeoff: link calls `onGoTakeoff`;
  - suggested with n=3 plural and n=1 singular: button calls `importRfisFromAnalysis`;
  - none: Undo calls `setNoRfis(false)` and `rfi-no-rfis` is hidden;
  - no drafts: clicking calls `setNoRfis(true)`, with label switching on `rfis.length`;
  - a draft present: no `rfi-no-rfis`;
  - running wins over suggested.
- `PcWorkspaceRfi.test.tsx`: existing tests unchanged, since the harness with `activeTab:'rfis'` now lands on the RFI step. Add:
  - with `AI_RESULTS_WITH_RFIS`, `rfi-status-suggested` reads "The AI suggested 2 RFIs — review & import"; clicking `rfi-import-suggested` adds both rows and the banner disappears;
  - after editing an imported question, the banner does not come back (flag);
  - with `{}` results, clicking `rfi-no-rfis` makes `getAllByTestId('est-step-rfis')[0].className` contain `done` and the PUT carries `scope_meta.noRfis`.
- `PcWorkspaceRerunReset.test.tsx`:
  - line 170: `est-step-scope` → `est-step-rfis`;
  - lines 371-374: A is now collapsed, so assert `screen.getByTestId('scope-add-A')` exists and `queryByTestId('scope-text-A')` is null, then keep the `scope-text-B` change (B has text);
  - line 380: `activeTab:'rfis'` is still fine.
- `PcWorkspaceStepOrder.test.tsx` (new; copy the Harness and mocks from PcWorkspaceRfi.test with an `initial` override; `beforeAll(() => import('../estimating/EstimatingWorkspace'))`):
  - `activeTab:'rfis'` → `est-work` text contains "4 · RFIs";
  - `'scope'` → "3 · Scope" plus `scope-list` present;
  - `'takeoff'` → `scope-list` absent and `takeoff-scope-list-hint` present; clicking `takeoff-scope-list-link` gives "3 · Scope";
  - the rail order is the six labels;
  - `scope:{A:'x'}` with `{}` results → `est-step-scope` has no `done` class;
  - `activeTab:'proposal'` with `{}` results → click `proposal-go-takeoff` gives "2 · Takeoff";
  - `activeTab:'scope'`, click "Next: RFIs" → "4 · RFIs".

**Acceptance:**
- [ ] Six steps. RFIs has its own screen. The scope list shows only on Scope.
- [ ] The RFI step turns done only per the Task 1 rule.
- [ ] The takeoff hint shows only before any run.
- [ ] The proposal is still blocked while review is open (PcWorkspaceProposal tests are green).

---

## Task 6: Scope page tidy (ScopeTab.tsx)

**Files:**
- `ScopeTab.tsx`
- `parsing.ts`
- `rerunReset.tsx` (a one-line import swap)
- `estimating.css`
- New: `ScopeTab.test.tsx`
- `PcWorkspaceAutosave.test.tsx`

1. In `parsing.ts`, add `export const scopeTextKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');` with a comment that it must stay identical to backend `rerunReset.ts` `scopeKey`. In `rerunReset.tsx`, replace its private `scopeKey` (line 71) with this import. The behavior is identical.
2. New ScopeTab prop: `analysisRunning?: boolean`.
3. State:
   - `const [openIds, setOpenIds] = useState<Set<string>>(new Set());`
   - `const [justOpened, setJustOpened] = useState<string | null>(null);`
   - `hasText(id) = !!(ws.scope[id] ?? '').trim()`
   - `expanded(id) = hasText(id) || openIds.has(id)`
   - `anyText = SCOPE_SECS.some(s => hasText(s.id))`
   - The textarea `onChange` also adds the id to `openIds`, so clearing a section while typing never collapses it.
4. AI draft tag:
   - `aiText = { ...buildScopeFromAgent2(agent2Scope), ...(ws.scopeMeta?.ai ?? {}) }`. This is the same union `rerunPlan` uses, so it also covers bids from before scope_meta existed. Memoize it on `[agent2Scope, ws.scopeMeta?.ai]`.
   - `isAiDraft(id) = hasText(id) && aiText[id] != null && scopeTextKey(aiText[id]) === scopeTextKey(ws.scope[id])`.
   - Render next to the recheck tag: `<span data-testid={`scope-ai-draft-${id}`} title="Written by the AI takeoff and not edited yet — read it over before it goes on the proposal" style={{ fontSize: 10, fontWeight: 800, color: 'var(--blue)', border: '1px solid var(--blue)', borderRadius: 4, padding: '1px 5px' }}>AI draft</span>`.
   - A pre-bid import removes the AI record (`withoutAi`), so pre-bid text never gets the tag.
5. Layout, in A–G order and interleaved so the letters never jump:
   - An expanded section uses today's panel markup unchanged (testid `scope-text-${id}`, placeholder `Scope notes for ${label}…`), plus `autoFocus={justOpened === sec.id}`.
   - A collapsed section is `<button type="button" className="scope-add-row" data-testid={`scope-add-${sec.id}`} onClick={() => { setOpenIds(p => new Set(p).add(sec.id)); setJustOpened(sec.id); }}><span className="scope-add-letter">{sec.id}</span>+ Add {sec.label}</button>`.
6. Empty state, above the sections, when `!anyText`: `<div className="scope-empty" data-testid="scope-empty"><strong>Nothing imported yet</strong><span>{hint}</span></div>`, where the hint is:
   - pre-bid sections or AI output available: "Use “Fill from…” to bring in the pre-bid package or the AI takeoff, or add a section by hand below."
   - else `analysisRunning`: "The AI takeoff is still running. When it finishes it fills in any empty sections here."
   - else: "No pre-bid package or finished AI takeoff yet. Add a section by hand below, or finish the Takeoff step first."
7. "Fill from…" menu (local component `FillFromMenu` in ScopeTab.tsx; always rendered, right-aligned where the two buttons were):
   - Trigger: `<button type="button" className="btn ghost" data-testid="scope-fill-menu-button" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId}>Fill from… <Icon name="chevron-down" size={13} stroke={2}/></button>`, using `menuId = useId()`.
   - Menu: `<div role="menu" id={menuId} data-testid="scope-fill-menu" className="scope-fill-menu">` with two `<button type="button" role="menuitem" className="scope-fill-item">` items:
     - `scope-fill-prebid`: **"Pre-bid package"**. Sub-line "Replaces the sections the pre-bid covers. Other sections are kept." When disabled (`prebidSections.length === 0`) the sub-line is "No pre-bid package on this bid yet".
     - `scope-fill-ai`: **"AI takeoff"**. Sub-line "Replaces the sections the AI takeoff wrote. Other sections are kept." When disabled (`!agent2Scope`) it is `analysisRunning ? 'The takeoff is still running' : 'Finish the Takeoff step first'`.
   - Behavior:
     - opening focuses the first enabled item;
     - ArrowDown/ArrowUp move between enabled items;
     - Escape closes and puts focus back on the trigger;
     - Tab closes;
     - a `mousedown` outside closes (document listener, removed on close or unmount);
     - choosing an item calls the existing `importPrebid` / `importScope` unchanged, then closes and focuses the trigger.
8. CSS in estimating.css, block "UI cleanup round 1 — Scope step". Keep sizes consistent with the existing panels:
   - `.scope-add-row{display:flex;align-items:center;gap:10px;width:100%;padding:9px 14px;margin-bottom:8px;border:1px dashed var(--border2);border-radius:10px;background:transparent;color:var(--text2);font:inherit;font-size:13px;font-weight:700;text-align:left;cursor:pointer}`
   - `:hover` background `var(--surface)`
   - `:focus-visible` outline blue
   - `.scope-add-letter` is the same 20px blue-soft chip as `.pt-ic`
   - `.scope-empty{display:flex;flex-direction:column;gap:4px;padding:14px 16px;margin-bottom:14px;border-radius:10px;background:var(--surface);color:var(--text2);font-size:12.5px}`
   - `.scope-fill-menu{position:absolute;right:0;top:calc(100% + 4px);z-index:20;min-width:260px;padding:4px;background:var(--panel);border:1px solid var(--border2);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.35)}`
   - `.scope-fill-item{display:flex;flex-direction:column;gap:2px;width:100%;padding:8px 10px;border:none;border-radius:var(--rxs);background:transparent;color:var(--text);font:inherit;font-size:13px;font-weight:700;text-align:left;cursor:pointer}`, with the sub-line at 11.5px/600/`var(--text3)`, `:hover:not(:disabled)`/`:focus-visible` background `var(--surface2)`, and `:disabled` opacity .5 with cursor default
   - wrap the trigger in `position:relative`

**Tests:**
- `ScopeTab.test.tsx` (new, happy-dom, a stateful harness holding `ws` and applying `set` patches):
  - all empty, no sources: `scope-empty` contains "Nothing imported yet", 7 `scope-add-*`, 0 textareas;
  - A has text: `scope-text-A` present, `scope-add-A` absent;
  - clicking `scope-add-C` makes `scope-text-C` appear and become `document.activeElement`; typing then clearing to '' keeps it visible;
  - whitespace-only text counts as empty;
  - AI draft: when `scope.A === scopeMeta.ai.A` the tag shows; editing A removes it; with `scopeMeta.ai` empty but `agent2_output` whose `buildScopeFromAgent2().A` equals `scope.A`, the tag shows;
  - menu: trigger `aria-expanded` goes false → true; with no sources both items are disabled with the right sub-lines (running vs not); with `prebidSections` set, clicking `scope-fill-prebid` fills A and the menu closes; Escape closes and focuses the trigger;
  - key preservation: `scopeMeta = { ai:{}, recheck:[], noRfis:true, aiRfisImported:true }`, then typing in an opened section and running each import keeps `noRfis` and `aiRfisImported` in the patch.
- `PcWorkspaceAutosave.test.tsx`: section A is now collapsed in a blank workspace. Add a helper `const openScopeA = () => { const b = screen.queryByTestId('scope-add-A'); if (b) fireEvent.click(b); };` and call it before every `getByPlaceholderText(SCOPE_PLACEHOLDER)` (lines 151, 167, 197, 216, 317, 331, 358). Keep it synchronous; these tests use fake timers.
- Other tests using `scope-text-*` or the placeholder: only the RerunReset and Autosave suites (grep again to confirm).

**Acceptance:**
- [ ] A section with text is never hidden.
- [ ] Recheck tags still show.
- [ ] Import semantics are identical to before (same overwrite rules and toasts).
- [ ] The menu works with the keyboard only.
- [ ] The "AI draft" tag clears on the first edit.

---

## Task 7: Final verification
- Run `npx tsc --noEmit`, then `npx vitest run src/features/estimating src/features/preconstruction`, then `npx vitest run`.
- Grep checks:
  - `grep -rn "Scope & RFIs" src` shows only comments;
  - `grep -rn "ESTIMATE_STEPS\|EstimateStepKey" src` finds no place that assumes five steps;
  - every `scopeMeta:` writer spreads the existing object.
- The PR description lists: every changed string (the Task 3 table), the strings left alone and why, the scope-list/Agent-2 hint, and the fact that `noRfis` / `aiRfisImported` live in `scope_meta` with no migration and are cleared by a re-run.

---

## Reviewer focus (riskiest spots for Opus)
1. **scopeMeta persistence.**
   - `ws.scopeMeta` must be in the autosave deps (PcWorkspaceView ~275). Without it, "No RFIs" never saves.
   - All ScopeTab writers must spread the existing object.
   - `applyServerReset` intentionally replaces scopeMeta.
   - The backend `resetScope` drops the flags on a re-run; confirm that is acceptable.
2. **Warning parity.** `bidSummaryWarnings` must match the `bs-warnings` rows exactly, in both conditions and text. The parity test is the guard, so check it covers every row including all four review-flag kinds. The strip must show when the total is null (Accubid still calculating) and must not render a collapse toggle when no `summaryStrip` is passed.
3. **Breakpoint branches.** The summary collapse preference must never apply at tablet width or with `forceSlimSummary`. The existing slim-bar tests must pass unmodified. Focus must return to the new toggle after a summary toggle.
4. **Step keys and legacy mapping.**
   - `'rfis'` → the rfis step; `stepToLegacyTab('rfis') === 'rfis'` passes App.tsx's `validTabs`.
   - An old `?step=scope` lands on Scope (accepted).
   - Check every `Record<EstimateStepKey, …>` and every switch over step keys (renderStepContent, stepToLegacyTab).
   - The "Needs X first" hints now read "Needs RFIs first" on Labor & Pricing, which is advisory only.
5. **The scope list moved after the run while Agent 2 still reads it.** Check the pre-run hint shows only when `!agent2_output && !aiRunning`, and escalate to Jake if the hint is not wanted.
6. **The RFI done rule.**
   - Not done while running.
   - "No RFIs" only when there are no drafts.
   - Adding or importing an RFI clears `noRfis`.
   - `pendingAiRfiCount` uses the `aiRfisImported` flag, so editing an imported RFI does not bring the banner back.
   - Known limitation: a supplement pass that adds new AI RFIs will not re-open the banner once the flag is set.
7. **Scope collapse.**
   - Tests that typed into empty textareas must click "+ Add" first; check no test was weakened.
   - `autoFocus` only on a just-opened section.
   - The AI-draft comparison uses the same normalizer as the backend `scopeKey`.
8. **No behavior drift.**
   - ProposalTab's disabled conditions and `reviewBlocked` are untouched.
   - LaborPricingStep save and duplicate blocking are untouched (only label text changed).
   - The stored value is still `'phase_a'`.
   - The run-log "Agent N of 3" strings are intentionally left.

### Critical Files for Implementation
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/estimating/steps.ts
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/estimating/EstimateShell.tsx
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/estimating/BidSummary.tsx
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/preconstruction/PcWorkspace/PcWorkspaceView.tsx
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/preconstruction/PcWorkspace/ScopeTab.tsx
- Also touched: RfisTab.tsx, ProposalTab.tsx, LaborPricingStep.tsx, EstimatingWorkspace.tsx, estimating.css, constants.ts, parsing.ts, rerunReset.tsx, BidTab.tsx, TakeoffTab.tsx, TakeoffReviewPanel.tsx, useAiPoller.ts, and the tests named per task.

---

# Plans view addendum (Tasks 8–11)

These four tasks go after Task 7 of the round-1 plan. The Plans view is the Takeoff step's "Plans" toggle, `frontend/src/features/estimating/plans/*`, fed by `GET /api/estimating/:bidId/sheets`.

## Addendum: what I found in the code
- **Why every sheet shows 4×.** `backend/src/estimating/sheets.ts` `listSheets()` only indexes documents from `getPlanPdfDocuments()`, which already requires `deleted_at IS NULL`. But it then returns `getSheetRows(bidId)`, which is `SELECT … FROM est_sheets WHERE bid_id = $1` with **no document filter**. Rows left over from deleted copies come back. `getIndexStatuses()` and `getIndexErrors()` have the same problem: an old copy can raise an "Indexing…" or "failed" banner.
- **Superseded documents.** `documents.superseded_at` is only set by `backend/src/services/rerunReset.ts` on CRM-generated outputs (`generated = true`). Uploaded plans are never superseded today. Still, the frontend's "current plan set" rule (`isCurrentPlanDoc`: plans category, not generated, not superseded) and `jobProfileRun.eligiblePlanDocs` both exclude generated and superseded files, so the sheet list should too.
- **The server does not know which documents are "selected" for the analysis.** `selectedDocIds` is frontend state only. "Current plan set" (live, plans category, PDF, not generated, not superseded) is the best server-side rule.
- **Other `est_sheets` readers:**
  - `markups.ts buildSheetScaleMap` is a lookup by `document_id::page_index`. It does no listing and needs no change.
  - `footageAllowanceDb.ts:214` only reads the analyzed `count_result` documents. It needs no change.
  - `countRender.ts` does not query `est_sheets`.
- **A second bug the list fix would expose.** `markups.ts getMarkups()` does not filter by document, so markers drawn on a now-deleted copy still count in the rollup. Once those sheets stop being listed, the markers become invisible but still count. Changing the rollup would change quantities, so Task 8 **surfaces** them in a banner instead. The cleanup itself is a Jake decision.
- **How titles are picked today.** `extractPageInfo()` (sheets.ts:258-265) takes the **longest** text item in the right 25% strip. That is why a bid-service stamp such as "Dodge Data & Analytics…" or "For Bidding & Contractors…" wins, along with note fragments.
- **A better title source already exists.** The sheet check (`bid_sheet_check.result.pages[]`, a `CheckedPage` in `backend/src/services/sheetCheck.ts:76`) has, for every page:
  - `sheetNo` and `title` from the Haiku title-block classifier (the same source as the `E-1 "Power Plan & General Notes"` labels);
  - `specBookPage` (from `ai/specBookPages.ts`);
  - `documentId` (optional), `file` (the upload's original name), and `page`, which is **1-based**, so `est_sheets.page_index = page - 1`.
  The check may have run on a copy that has since been deleted, so matching must fall back from `documentId` to `file` name + page.
- **The toolbar "vertical stack" is a missing CSS rule, not a layout choice.** `Toolbar.tsx` renders `.plan-tools`, which has **no CSS rule** in `plans.css`. Each `.plan-toolbar-btn` is `display:flex` (block-level), so the buttons stack.
- "No scale set — measuring disabled" is a small span in `PlanViewer.tsx:644`. The existing suggestion and ambiguous scale banners live in `PlansWorkspace.tsx:1141-1154`.
- The unsaved-estimate banner (`plan-proposed-banner`) renders below the toolbar and index banners (`PlansWorkspace.tsx:1129`).
- Right-hand panel: `ItemsPanel.tsx` gives every line up to three full-width `btn ghost sm` buttons.

## Extra constraints for Tasks 8–11
- A backend change is allowed for these tasks only. **It must be read-only in data terms:** no deletes, no updates to existing rows, no migration.
  - The one write-path change is `extractPageInfo`'s title choice for future indexing and "Refresh sheets". It does not rewrite rows by itself.
  - Stored `est_sheets.title` stays raw. The cleaned title is computed when sheets are read.
- Backend tests must be run as `cd backend && npm test -- <files>`. The script sets `DB_NAME=electrical_crm_test`, and the harness refuses any database not ending in `_test`. **Never run with `DATABASE_URL` set, and never against `electrical_crm`.** DB-backed route tests skip themselves when the test DB is unavailable; say so in the report if they skipped.
- No change to rollup, apply, or any quantity or pricing math. Every existing button's behavior stays the same.

---

## Task 8: Sheet list shows only the current plan set, and markers on deleted copies are surfaced (backend + banner)

**Files:**
- `backend/src/estimating/sheets.ts`
- `backend/src/routes/estimating.ts` (response shape only)
- `backend/src/test/estimatingSheetsRoutes.test.ts`
- `frontend/src/features/estimating/types.ts`
- `frontend/src/features/estimating/plans/PlansWorkspace.tsx`
- `frontend/src/features/estimating/plans/PlansWorkspace.test.tsx`

**Backend changes:**
1. `getPlanPdfDocuments(bidId)`: add `AND coalesce(generated, false) = false AND superseded_at IS NULL` to the WHERE clause. Update its doc comment to say "the bid's current plan set; same rule as the frontend's `isCurrentPlanDoc` and `jobProfileRun.eligiblePlanDocs`". This function also gates `validDocumentIds` for new markers (routes/estimating.ts ~1375). That is intended: no new marker can be drawn on a non-current file.
2. `getSheetRows(bidId, documentIds: string[])`:
   - `if (!documentIds.length) return [];`
   - query `… FROM est_sheets WHERE bid_id = $1 AND document_id = ANY($2::uuid[]) ORDER BY document_id, page_index`.
   - Keep it exported; grep for other callers and update them (only `listSheets` today).
3. `listSheets`: pass `documentIds` to `getSheetRows`. Filter `statuses` and `indexErrors` down to keys in `documentIds` (a plain JS filter; keep the two query helpers as they are).
4. New `getHiddenDocumentMarkers(bidId, liveIds)`:
   ```sql
   SELECT m.document_id, coalesce(d.display_name, d.name, 'a plan file') AS name, count(*)::int AS n
     FROM est_markups m LEFT JOIN documents d ON d.id = m.document_id
    WHERE m.bid_id = $1 AND m.deleted_at IS NULL AND m.status = 'confirmed'
      AND NOT (m.document_id = ANY($2::uuid[]))
    GROUP BY 1, 2 ORDER BY 2
   ```
   `ListSheetsResult` gains `hiddenMarkers: Array<{ documentId: string; name: string; count: number }>`. Add a comment: "still counted by getRollup; surfaced, never deleted — cleanup is a separate decision."
5. The route at `routes/estimating.ts:1170` forwards `hiddenMarkers` as well.

**Frontend changes:**
- `types.ts` `SheetsResponse`: add `hiddenMarkers?: Array<{ documentId: string; name: string; count: number }>`.
- `PlansWorkspace.tsx`: `const hiddenMarkers = useMemo(() => sheetsData?.hiddenMarkers ?? [], [sheetsData]);`
- Render, directly under the unsaved-estimate banner (see Task 11 for placement):
  ```tsx
  {hiddenMarkers.length > 0 && (
    <div className="plan-scale-banner plan-scale-banner-warn" data-testid="plan-hidden-markers-banner">
      {hiddenMarkers.map(h => (
        <div key={h.documentId}>
          {h.count} marker{h.count === 1 ? ' is' : 's are'} on a deleted copy of the plans (<strong>{h.name}</strong>).
          {h.count === 1 ? ' It still counts' : ' They still count'} toward marked quantities, but can’t be shown here.
        </div>
      ))}
    </div>
  )}
  ```

**Tests:**
- `estimatingSheetsRoutes.test.ts` (DB). Setup with direct SQL, following the file's existing `makeBid`/`pool.query` style:
  - two `documents` rows on the bid, both `category='plans'`, `file_type='application/pdf'`, same `name`. Doc A has `deleted_at = now()`; doc B is live;
  - one generated doc C (`generated = true`), plans category;
  - `est_sheets` rows for all three;
  - `est_document_index_status` rows `status='done'` for B (so nothing tries to index or fetch), and `'failed'` with an error for A;
  - two confirmed `est_markups` on A, one on B.

  Assertions for `GET /api/estimating/:bidId/sheets`:
  - `sheets` contains only B's rows;
  - `statuses` has only B's key, and `indexErrors` is `{}`;
  - `documentNames` has only B;
  - `hiddenMarkers` equals `[{ documentId: A, name, count: 2 }]`;
  - no rows were deleted (select-count on `est_sheets` and `est_markups` is unchanged afterwards).
- `PlansWorkspace.test.tsx`: the mocked sheets response carries `hiddenMarkers` → `plan-hidden-markers-banner` shows "2 markers are on a deleted copy of the plans". It is absent when the list is empty.

**Acceptance:**
- [ ] AutoZone Kissimmee would list each sheet once. Checked only by reasoning and the test; do not touch the live database.
- [ ] Old copies can no longer raise "Indexing" or "failed" banners.
- [ ] Nothing is deleted, and rollup math is unchanged.

---

## Task 9: Clean sheet titles, fill missing sheet numbers, and tag drawing / spec / other pages (backend)

**Files:**
- New: `backend/src/estimating/sheetTitle.ts`
- New: `backend/src/estimating/sheetTitle.test.ts`
- `backend/src/estimating/sheets.ts`
- `backend/src/estimating/sheets.test.ts`
- `backend/src/test/estimatingSheetsRoutes.test.ts`
- `frontend/src/features/estimating/types.ts`

**1. `sheetTitle.ts` (pure, no imports from services).**
```ts
/** Bid-service / plan-room stamps printed on every page (never a sheet title). */
export const BID_STAMP_RE = /\b(dodge\s+data|dodge\s*&?\s*analytics|construct\s*connect|building\s*connected|isqft|plan\s*hub|bid\s*clerk|blue\s*book|plan\s*room|for\s+bidding\s*(&|and)\s*contract|for\s+bidding\s+(purposes|only)|not\s+for\s+construction|downloaded\s+(from|by|on)|printed\s+(by|on))/i;
const DATE_ONLY_RE = /^\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{2,4})\s*$/i;
const NOTE_FRAGMENT_RE = /\b(must|shall|should|will\s+be|be\s+verified|verif(y|ied|ie)|signature|signed|sealed|copyright|reproduc|unauthori[sz]ed|this\s+(item|document|drawing)\s+has\s+been)\b/i;
/** Small word list: title-block vocabulary + common English function words. Used ONLY by the garble check. */
export const TITLE_WORDS = new Set([ /* see list below */ ]);
export function caesarShift(word: string, by: number): string   // a-z only, wraps
export function isGarbledText(raw: string): boolean
export function isJunkTitle(raw: string | null | undefined): boolean
export function cleanSheetTitle(raw: string | null | undefined): string | null  // trimmed title, or null when junk
```
- `TITLE_WORDS` must include at least: `plan plans power lighting light electrical site floor roof ceiling reflected general notes note schedule schedules panel panels riser diagram diagrams one line single details detail legend symbols symbol abbreviations cover sheet index title specifications spec fire alarm mechanical plumbing architectural structural civil demolition demo photometric photometrics enlarged elevation elevations section sections level first second third ground building existing new partial overall layout systems system communications data low voltage security equipment kitchen canopy fuel parking grading utility and of the for with to on in at by is are be this his her has have been item items all see from not`.
- `isGarbledText`:
  - `tokens = raw.toLowerCase().match(/[a-z]{2,}/g) ?? []`
  - `hits = (ts) => ts.filter(t => TITLE_WORDS.has(t)).length`
  - garbled when `tokens.length >= 2 && hits(tokens) === 0` and some shift `s` in 1..25 gives `hits(tokens.map(t => caesarShift(t, s))) >= 2`. This catches broken-ToUnicode fonts that print "This item has been" as "5IJT JUFN IBT CFFO".
- `isJunkTitle` is true when the trimmed text:
  - is empty;
  - matches `BID_STAMP_RE` or `DATE_ONLY_RE`;
  - has no letters (`!/[a-z]/i.test(t)`);
  - **starts with a lowercase letter** (`/^[a-z]/.test(t)`; a title block is Title Case or CAPS, while "coverings" is a wrapped note fragment);
  - matches `NOTE_FRAGMENT_RE`;
  - is longer than 70 characters;
  - ends with "." and has 5 or more words;
  - or `isGarbledText(t)`.
- `cleanSheetTitle` returns `t.replace(/\s+/g, ' ').trim()` unless `isJunkTitle`, in which case it returns null.

**2. `extractPageInfo` (future indexing).** In the title loop (sheets.ts:260-265), add `if (isJunkTitle(trimmed)) continue;` before comparing lengths. It still picks the longest remaining candidate. This changes new indexing and "Refresh sheets" only; existing rows are not rewritten.

**3. Read-time display in `listSheets`.**
- Load the sheet-check inventory with a direct query (**do not import `services/sheetCheck.ts`**, it pulls in sharp and the AI modules): `SELECT result FROM bid_sheet_check WHERE bid_id = $1`.
- Type it locally as `{ pages?: Array<{ documentId?: string; file?: string; page: number; sheetNo?: string; title?: string; specBookPage?: boolean }> }`, with a comment pointing to `CheckedPage`.
- Build two maps:
  - `byDoc`: `${documentId}:${page - 1}`
  - `byFile`: `${file.toLowerCase()}#${page - 1}`, used as the fallback when the check ran on a copy that was later deleted. Match it against `documentNames[document_id]`.
- New pure, exported function `decorateSheetRow(row: SheetRow, inv: InventoryPage | undefined): SheetRow`:
  - `raw_title = row.title`
  - `invTitle = cleanSheetTitle(inv?.title)`, `ownTitle = cleanSheetTitle(row.title)`
  - `title = invTitle ?? ownTitle ?? `Page ${row.page_index + 1}``
  - `title_source = invTitle ? 'sheet_check' : ownTitle ? 'title_block' : 'page_number'`
  - `sheet_no = row.sheet_no || (inv?.sheetNo ?? '').trim().toUpperCase()`
  - `discipline`: recompute with `disciplineFromSheetNo(sheet_no)` (export it) **only** when `sheet_no` came from the inventory; otherwise keep the stored value.
  - `page_group = inv?.specBookPage ? 'spec' : sheet_no ? 'drawing' : 'other'`
- `SheetRow` (backend and `frontend/src/features/estimating/types.ts`) gains `raw_title: string`, `title_source: 'sheet_check' | 'title_block' | 'page_number'`, `page_group: 'drawing' | 'spec' | 'other'`. In the **frontend** type make all three optional; treat a missing `page_group` as `'drawing'` so existing fixtures still compile.
- Because the API's `title` is now the cleaned title, every frontend place that shows a sheet title gets the filter automatically:
  - SheetNavigator;
  - PlansWorkspace's find-tag labels (line ~821) and unassigned-marker labels (~971).

  Grep the frontend for other `.title` reads on `SheetRow` and confirm there are none.

**Tests:**
- `sheetTitle.test.ts`, using these exact strings:
  - Junk:
    - `'Dodge Data & Analytics'`, `'Dodge Data & Analytics…'`
    - `'For Bidding & Contractors Use Only'`, `'For Bidding & Contracto…'`
    - `'ConstructConnect'`, `'BuildingConnected'`
    - `'coverings'`, `'05/20/09'`
    - `'Signature must be verified'`, `'Signature must be verifie…'`
    - `'5IJT JUFN IBT CFFO'` (garbled)
    - `''`, `'   '`, `'123-45'`
  - Kept, with `cleanSheetTitle` returning the trimmed text:
    - `'Power Plan & General Notes'`, `'ELECTRICAL SITE PLAN'`, `'LIGHTING PLAN'`, `'PANEL SCHEDULES'`, `'ONE-LINE DIAGRAM'`, `'Reflected Ceiling Plan'`, `'Fire Alarm Riser'`
  - `caesarShift('ijt', -1) === 'his'`, and `isGarbledText('This item has been') === false`.
- `sheets.test.ts`:
  - `decorateSheetRow` cases:
    - an inventory title wins over a stamp title;
    - a stamp title with no inventory entry → `'Page 3'` with `title_source 'page_number'`;
    - an empty `sheet_no` filled from the inventory (`'E-1'`) → `discipline 'E'` and `page_group 'drawing'`;
    - `specBookPage` → `'spec'`;
    - no sheet number anywhere → `'other'`.
  - `extractPageInfo` with `buildSheetPdf` items in the right strip: `'Dodge Data & Analytics Project #12345 Printed For Bidding'` (longer) and `'POWER PLAN'` → `title === 'POWER PLAN'`.
- `estimatingSheetsRoutes.test.ts`:
  - insert a `bid_sheet_check` row with `result.pages = [{ documentId: B, file: name, page: 1, sheetNo: 'E-1', title: 'Power Plan & General Notes' }, { documentId: B, page: 2, sheetNo: '', title: '', specBookPage: true }]` and `est_sheets` titles `'Dodge Data & Analytics'` / `'coverings'`;
  - expect `sheets[0].title === 'Power Plan & General Notes'`, `sheets[0].raw_title === 'Dodge Data & Analytics'`, `sheets[1].page_group === 'spec'`;
  - check the **stored** `est_sheets.title` is unchanged.
  - Fallback-by-file case: an inventory `documentId` equal to the deleted doc A with the same file name still titles B's page.

**Acceptance:**
- [ ] No stamp, date, note fragment or garbled text is ever shown as a sheet title. The fallback is "Page N".
- [ ] Stored data is untouched.

---

## Task 10: Sheet list grouped by discipline, with search, collapsible groups, and spec / other pages tucked away (frontend)

**Files:**
- `frontend/src/features/estimating/plans/SheetNavigator.tsx`
- `SheetNavigator.test.tsx`
- `PlansWorkspace.tsx`
- `PlansWorkspace.test.tsx`
- `plans.css`

**Props:**
- Remove `disciplineFilter` / `onDisciplineFilterChange` (the chips go away).
- Delete the `disciplineFilter` state in PlansWorkspace (line 260) and both prop passes (lines ~1020 and ~1041).
- Add `documentNames: Record<string, string>`.

**Model** (pure, exported for tests):
```ts
export type SheetGroup = { id: string; label: string; kind: 'drawing' | 'spec' | 'other'; sheets: SheetRow[] };
export function groupSheets(sheets: SheetRow[], documentNames: Record<string, string>): SheetGroup[]
export function defaultSheet(sheets: SheetRow[]): SheetRow | undefined // first sheet of the first drawing group, else sheets[0]
export function sheetMatches(s: SheetRow, q: string): boolean
```
- Drawing groups (`page_group` missing or `'drawing'`) go in `DISCIPLINE_ORDER`. Ids are `'E'`, `'A'`, `'M'`, `'P'`, `'other-drawings'`. Labels:
  - `Electrical (E)`
  - `Architectural (A)`
  - `Mechanical (M)`
  - `Plumbing (P)`
  - `Other drawings`

  Sort within each group with the existing `sortSheets` logic.
- Then one group per document for `'spec'` pages (id `spec:<docId>`, label `Spec book — <documentName>`), then one per document for `'other'` pages (id `other:<docId>`, label `Pages without a sheet number — <documentName>`). Both are ordered by `page_index`.
- `sheetMatches`: case-insensitive on `title`, plus `sheet_no` with spaces and hyphens removed on both sides, so "e1" matches "E-1".

**Full list** (> 1279px):
- Top: `<input type="search" className="plan-sheet-nav-search" placeholder="Find a sheet (e.g. E-1 or lighting)" aria-label="Find a sheet" data-testid="sheet-nav-search">`.
- Expanded groups are `useState<Set<string>>`. Initial value: `{'E'}`, or the first drawing group's id when there is no E.
- Effect on `currentKey`: add the group that contains the current sheet to the expanded set.
- While the query is non-empty, show only groups with matches, all expanded (computed, not stored). With no match anywhere: `No sheets match “{q}”.`
- Group header:
  ```tsx
  <button type="button" className="plan-sheet-group-header" aria-expanded={open} aria-controls={listId} data-testid={`sheet-group-${g.id}`}>
    <Icon name="chevron-down" size={12} stroke={2} style={{ transform: open ? undefined : 'rotate(-90deg)' }}/>
    <span>{g.label}</span>
    <span className="plan-sheet-group-count">{g.sheets.length}</span>
  </button>
  ```
  `listId` comes from `useId()` + the group id. Import Icon from `'../../../components/Icon'`.
- Items keep the same button, testid `sheet-${key}`, marker count badge and "Scanned" tag.
  - Replace `role="option"`/`aria-selected` with `aria-current={isCurrent ? 'true' : undefined}`.
  - The container becomes `<nav className="plan-sheet-nav" aria-label="Plan sheets" onKeyDown={…}>` (no listbox role, because it now contains group buttons).
  - Up/Down moves through the **visible** items only (expanded groups, search applied).
  - For spec/other items the number column shows `p.${page_index + 1}`.
  - When the same `sheet_no` appears in more than one document among drawing sheets, add a small `<span className="plan-sheet-nav-doc">{documentNames[doc]}</span>` under the title so the two copies can be told apart.

**Compact dropdown** (≤ 1279px, including view-only):
- Keep the `<select data-testid="sheet-nav-select">`, but render `<optgroup label={g.label}>` per group, in the same order.
- Drawing-group options read as today; spec/other options read `p.N — title`.
- Drop the discipline chips.
- Keep the "Select a sheet…" placeholder logic, indexing into a flattened array.

**PlansWorkspace:**
- The default-sheet effect (lines ~290-300) uses `defaultSheet(sheets)` instead of `sheets[0]`, so it never opens on a spec page.
- Pass `documentNames` to both SheetNavigator renders.

**CSS (plans.css), in a "UI round 1 — sheet list" block:**
- `.plan-sheet-nav-search{margin:10px 10px 6px;width:calc(100% - 20px);font:inherit;font-size:12px;padding:6px 9px;border-radius:8px;border:1px solid var(--border2);background:var(--surface);color:var(--text)}`
- `.plan-sheet-group-header{display:flex;align-items:center;gap:6px;width:100%;padding:7px 10px;border:none;border-top:1px solid var(--border);background:transparent;color:var(--text2);font:inherit;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;text-align:left}`
- `.plan-sheet-group-header:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}`
- `.plan-sheet-group-count{margin-left:auto;font-weight:700;color:var(--text3)}`
- `.plan-sheet-nav-doc{display:block;font-size:10.5px;color:var(--text3)}`
- Delete the now-unused `.plan-sheet-nav-filter` / `-chip` rules only if nothing else uses them (grep first).

**Tests (`SheetNavigator.test.tsx`):** rewrite the chip tests.
- Grouping order and labels for a mixed fixture: E-1, E-2, A-1, a spec page, and an other page from a second document named "2.0 - Kissimmee FL10077 FULL SPEC.pdf".
- E is expanded; A, spec and other are collapsed. `sheet-group-spec:<doc>` reads "Spec book — 2.0 - Kissimmee FL10077 FULL SPEC.pdf" with count 1. Clicking it flips `aria-expanded` and shows the page item as `p.N`.
- Search "e1" shows only E-1. Search "lighting" matches by title. A no-match search shows the empty text.
- A `currentKey` in group A auto-expands A.
- ArrowDown skips items in collapsed groups.
- Compact mode: `<optgroup>` labels are present in order.
- `defaultSheet` returns E-1 when a spec page is first in API order.
- A duplicate `sheet_no` across two documents shows the document-name line.

**`PlansWorkspace.test.tsx`:**
- Update any use of the chips, `aria-selected`, or the listbox role.
- Add: with sheets `[specPage(doc2,0), E-1(doc1,0)]` in API order, the viewer opens on E-1.

**Acceptance:**
- [ ] With the Kissimmee data, the list shows E, A and other sheets once each, grouped. The 55-page spec book sits in one collapsed group and the no-number pages in another.
- [ ] Every sheet is still reachable.
- [ ] Nothing depends on the removed chips.

---

## Task 11: Plans layout — one-row toolbar, clear banners, compact takeoff rows with a filter, collapsible side panels (frontend)

**Files:**
- `plans/Toolbar.tsx`
- `plans/PlansWorkspace.tsx`
- `plans/ItemsPanel.tsx`
- `plans/plans.css`
- `plans/ItemsPanel.test.tsx`
- `plans/PlansWorkspace.test.tsx`
- Reuses `frontend/src/features/estimating/useStoredToggle.ts` from Task 2.

### 11a. Toolbar on one row
- `Toolbar.tsx`: keep every button, label, title, disabled rule and shortcut exactly as they are (tests query `'New line from markup'`, `'Reassign to line…'`, `'Edit drops/slack'` by text).
- Wrap them in three groups with separators between: `<div className="plan-tools-group" role="group" aria-label="Drawing tools">` (Select, Count, Linear, Scale), then `aria-label="Edit"` (Undo, Redo, Delete), then `aria-label="Selected markers"` (New line from markup, Reassign to line…, Edit drops/slack). Separators are `<span className="plan-tools-sep" aria-hidden="true"/>`.
- In PlansWorkspace, the row at line 1045 gets `className="plan-topbar"` in place of its inline style. Its right-hand cluster (Half-size, Refresh sheets, ?) is wrapped in `<div className="plan-topbar-right">`.
- CSS:
  - `.plan-topbar{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--border);background:var(--panel)}`
  - `.plan-tools{display:flex;align-items:center;gap:4px;flex-wrap:nowrap;overflow-x:auto;min-width:0}`
  - `.plan-tools-group{display:flex;gap:4px}`
  - `.plan-tools-sep{width:1px;height:20px;background:var(--border2);margin:0 4px;flex-shrink:0}`
  - `.plan-topbar-right{display:flex;align-items:center;gap:6px;margin-left:auto;flex-shrink:0}`
  - Remove the inline `marginRight: 10` on the two right-hand buttons.

### 11b. Banners: unsaved estimate first, then one scale prompt
- Order inside the center column, top to bottom:
  1. `plan-proposed-banner`, moved **above** `.plan-topbar`;
  2. `plan-hidden-markers-banner` (Task 8);
  3. `.plan-topbar`;
  4. indexing and failed banners (unchanged);
  5. the scale prompt;
  6. SuggestMarkersBar;
  7. autosave status;
  8. the viewer.
- Unsaved-estimate banner:
  - keep its testid and button;
  - change the text to **"This estimate hasn’t been saved yet. Save it to start marking up the plans."**;
  - add an alert icon at the front;
  - CSS: `.plan-proposed-banner` gets amber-soft background, amber text and 1px amber border, font-weight 700, and `position:sticky; top:0; z-index:3`, so it stays visible while scrolling.
- Replace the two scale banners (lines 1141-1154) with one block. It shows only when `currentSheet && currentSheet.ft_per_pt == null && currentSheet.page_group !== 'spec' && currentSheet.page_group !== 'other'` (a missing `page_group` counts as a drawing):
  - Ambiguous: `data-testid="plan-scale-ambiguous-banner"`, text **"This sheet shows more than one scale — measure a known length to set it."**
  - Suggestion (existing condition): `data-testid="plan-scale-suggestion-banner"`, text **"No scale on this sheet yet. The title block says {suggested_label}."** plus the existing **Confirm** button (same handler, same label).
  - Otherwise: `data-testid="plan-scale-needed-banner"`, text **"No scale on this sheet yet — lengths can’t be measured until you set one."**
  - All three also show `<button type="button" className="btn ghost sm" data-testid="plan-set-scale" onClick={() => dispatch({ type: 'SELECT_TOOL', tool: 'scale' })}>Set scale by measuring</button>`.
  - Use class `plan-scale-banner plan-scale-banner-warn` so all three are amber.
  - Leave PlanViewer's small chip at line 644 as it is.

### 11c. Takeoff lines panel (ItemsPanel)
- New local state `const [filter, setFilter] = useState<'all' | 'not_marked' | 'marked'>('all');`
  - `statusOf(l) = computeLineStatus(l, rollupByKey.get(l.line_key))`
  - "marked" means `status !== 'not_marked'`
- Counts come from all lines, before `showOnlyActiveLine`.
- Header gets a second row: `<div className="plan-items-filter" role="group" aria-label="Show lines">` with three `<button type="button" aria-pressed={filter === x} className="plan-items-filter-btn" data-testid={`items-filter-${x}`}>` buttons labeled `All ({n})`, `Not marked ({n})`, `Marked ({n})`.
- Rows are skipped when they don't match the filter. A group left with no rows is hidden entirely, header included.
- When the filter hides everything: `<div className="plan-items-panel-empty">No lines match this filter.</div>`.
- Compact row:
  - Line 1: description with `title={l.description}` (CSS one-line ellipsis) + status badge (unchanged).
  - Line 2: a single `.plan-items-panel-row-qty` with `AI {x} · Marked {y} · Now {qty} {unit}`. Keep the three existing `title` attributes on spans. The label changes from "Current" to **"Now"**; grep the tests for "Current " and update.
  - "Marked on N sheets" is appended to line 2 as ` · {N} sheet{s}`, not given its own line.
  - The partial-rollup warning line stays as it is (a warning, never hidden).
- Row actions, right-aligned in the row's top line:
  - `<button type="button" className="plan-icon-btn" aria-label="Jump to source sheet" title="Jump to source sheet" onClick=…><Icon name="pin" size={14} stroke={1.9}/></button>`
  - `<button type="button" className="plan-icon-btn" aria-label="Suggest markers" title="Suggest markers for this line on the open sheet" onClick=…><Icon name="sparkle" size={14} stroke={1.9}/></button>`
  - Show conditions are unchanged. Keep `e.stopPropagation()`.
  - Keep **"Apply marked qty"** as a small text button on line 2 (tests use that text).
- CSS:
  - `.plan-items-filter{display:flex;gap:4px;padding:6px 10px;border-bottom:1px solid var(--border)}`
  - `.plan-items-filter-btn{font:inherit;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;border:1px solid var(--border2);background:var(--surface);color:var(--text2);cursor:pointer}`
  - `.plan-items-filter-btn[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff}`
  - `.plan-icon-btn{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border2);border-radius:6px;background:var(--surface);color:var(--text2);cursor:pointer;padding:0}`
  - `.plan-icon-btn:hover{color:var(--text);background:var(--surface2)}`
  - `.plan-icon-btn:focus-visible{outline:2px solid var(--blue);outline-offset:2px}`
  - `.plan-items-panel-desc{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}`
  - Reduce row padding to about 6px 10px.

### 11d. Collapsible side panels (desktop, not view-only, width > 1279px)
- In PlansWorkspace:
  - `const [sheetsCollapsed, toggleSheets] = useStoredToggle('est-plans-sheets-collapsed');`
  - `const [itemsCollapsed, toggleItems] = useStoredToggle('est-plans-items-collapsed');`
  - `useId()` for the panel ids.
- Collapse only applies on the full (non-compact) layout. Reuse SheetNavigator's compact media query: export `useIsCompactViewport` from SheetNavigator.tsx.
- Expanded: each panel gets a header toggle, following the Task 2 pattern:
  - sheets: `data-testid="plans-sheets-toggle"`, aria-label **"Collapse sheet list"**, chevron pointing left;
  - items: `data-testid="plans-items-toggle"`, aria-label **"Collapse takeoff lines"**, chevron pointing right;
  - both with `aria-expanded={true}` and `aria-controls` set to the panel id.
  - The sheets toggle sits in a small header row above the search. The items toggle sits at the left of ItemsPanel's header row; pass `onCollapse` as a new optional prop.
- Collapsed: a 40px strip `<div className="plan-panel-strip" id={panelId}>` holding one `<button className="plan-panel-strip-btn" aria-expanded={false} aria-controls={panelId} data-testid="plans-sheets-toggle|plans-items-toggle">`:
  - sheets strip content: chevron + the current sheet's `sheet_no || 'p.N'` + sr-only "Show sheet list";
  - items strip content: chevron + an amber badge with the Not-marked count (`title="{n} lines not marked yet"`) + sr-only "Show takeoff lines".
  - Put `.est-sr-only` in plans.css too, or reuse it; estimating.css is loaded wherever the Plans view renders.
- Focus moves to the new toggle after each switch (same ref/effect pattern as Task 2).
- CSS:
  - `.plan-panel-strip{width:40px;flex-shrink:0;background:var(--panel);display:flex;flex-direction:column;align-items:center;padding-top:8px}`
  - the sheets strip gets `border-right`, the items strip `border-left`;
  - `.plan-panel-strip-btn{display:flex;flex-direction:column;align-items:center;gap:6px;background:transparent;border:none;color:var(--text2);font:inherit;font-size:11px;font-weight:800;cursor:pointer;padding:6px 2px;border-radius:6px}`, plus hover and focus-visible states.

**Tests:**
- `ItemsPanel.test.tsx`:
  - replace `getByText('Suggest markers')` with `getByLabelText('Suggest markers')` (same single-line fixtures);
  - filter counts and filtering, including a category group disappearing when it is filtered empty;
  - aria-pressed state;
  - "Apply marked qty" still works;
  - the partial-rollup warning shows under every filter that includes the line.
- `PlansWorkspace.test.tsx`:
  - `getByText('Jump to source sheet')` → `getByLabelText('Jump to source sheet')`;
  - `plan-proposed-banner` comes before the toolbar in the DOM (`banner.compareDocumentPosition(screen.getByRole('group', { name: 'Drawing tools' })) & Node.DOCUMENT_POSITION_FOLLOWING`);
  - an unscaled sheet with no suggestion shows `plan-scale-needed-banner`; clicking `plan-set-scale` makes the "Scale" tool button get class `active`;
  - the suggestion and ambiguous tests keep their testids and still click "Confirm";
  - no scale banner on a `page_group: 'spec'` sheet;
  - at 1400px, clicking `plans-items-toggle` collapses the panel (the ItemsPanel header is gone and the strip shows the Not-marked count), sets `localStorage['est-plans-items-collapsed'] === '1'`, and focus lands on the new toggle; with `'1'` preset the panel mounts collapsed; same for the sheets panel;
  - `localStorage.clear()` in `afterEach`;
  - at 1000px there is no collapse toggle.

**Acceptance:**
- [ ] The toolbar is one horizontal row at 1400px.
- [ ] The unsaved-estimate banner is the first thing in the center column and stays visible when scrolling.
- [ ] An unscaled drawing sheet always shows an amber "No scale on this sheet yet" prompt with a one-click way to set it.
- [ ] Takeoff rows are two short lines with icon actions, and the Not marked / Marked / All filter works.
- [ ] Both side panels collapse, the choice is remembered, and they are keyboard reachable.
- [ ] Every blocking state is unchanged:
  - Count/Linear stay disabled until the estimate is saved;
  - Linear stays disabled without a scale;
  - Apply still confirms partial rollups.

---

## Reviewer focus (for Tasks 8–11)
1. **The sheet-list filter covers every leak path.**
   - `getSheetRows` must always get the live document ids.
   - The statuses and errors filter must happen before the "failed" and "indexing" banners read them.
   - The tightened `getPlanPdfDocuments` (no generated or superseded files) also gates new marker creation. Confirm no legitimate plan file has `generated = true`.
2. **Markers on deleted copies still count in `getRollup`.** The banner only surfaces them. Get Jake's decision on cleanup (for example "move them to the current copy by matching page", or "exclude from rollup") as a follow-up. Nothing may be deleted in this round.
3. **The junk-title heuristics can hide a real title.** Check `sheetTitle.test.ts` covers real titles:
   - Title Case and CAPS;
   - with "&";
   - long but valid (at most 70 characters).
   Also confirm the Caesar check needs at least 2 dictionary hits after a shift and zero before it. The only fallback is "Page N" (never garbage), and `raw_title` is kept in the response for debugging.
4. **Inventory matching.**
   - `CheckedPage.page` is 1-based; `page_index` is 0-based.
   - The `documentId`-then-file-name fallback must not cross bids; the query is scoped by `bid_id`.
   - Filling `sheet_no` from the inventory changes `discipline` and grouping only. The `document_id:page_index` keys used by markers and scale are untouched.
5. **Default sheet and URL state.** `defaultSheet` must not override a valid `?sheet=` key, and the "That sheet is no longer available" toast still fires for a stale key. Spec and other pages stay reachable through their groups and the dropdown.
6. **Test churn.** Removing the discipline chips and moving to icon buttons changes selectors in SheetNavigator, ItemsPanel and PlansWorkspace tests. Check that assertions were swapped for equivalent ones, not dropped. In particular, "Apply marked qty", the proposed-banner gating and the scale Confirm tests must keep their meaning.
7. **Backend tests ran against `electrical_crm_test` through `npm test`.** Confirm in the builder's output that the DB route tests actually ran and did not skip, or that the skip is reported.

### Critical Files for Implementation (addendum)
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/estimating/sheets.ts
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/estimating/sheetTitle.ts (new)
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/estimating/plans/SheetNavigator.tsx
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/estimating/plans/PlansWorkspace.tsx
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/estimating/plans/ItemsPanel.tsx
- Also touched: Toolbar.tsx, plans.css, frontend estimating/types.ts, backend routes/estimating.ts, backend test/estimatingSheetsRoutes.test.ts, sheets.test.ts.