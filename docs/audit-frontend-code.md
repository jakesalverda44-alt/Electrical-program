# Frontend Code Quality / State Management / Robustness Audit
APT Electrical CRM — `frontend/src` (32,137 LOC, 42 test files). Read-only audit. All counts are real grep counts against the tree.

---

## HIGH

### 1. 27 `try { … } finally { … }` blocks with no `catch` — saves fail silently
`features/bid-hub/OverviewTab.tsx:178-186`
```
      onBidUpdated(data.bid ?? data);
      setEditMode(false);
    } finally {
      setSaving(false);
    }
```
Same shape at `LeadDetailDrawer.tsx:108,148,167,180,216`, `EmailSection.tsx:65`, `GenDetailDrawer.tsx:112,170`, `AIPermissionsSection.tsx:92,104`, `UnitCostSection.tsx:72`, `CompanySection.tsx:41`, `GenPricingSection.tsx:55`, `ElecProjectsPage.tsx:1124,1232`, `PcWorkspace.tsx:770`, and 12 more (27 total, verified by AST-ish scan).
**Why it matters:** when the PATCH fails (offline, 500, validation reject), the spinner stops, the drawer stays open, and *nothing else happens*. The user assumes it saved. Given the known explicit-save model, this is the highest-frequency data-loss path in the app. It also produces an unhandled promise rejection on every failure.
**Fix:** add `catch (e) { showToast({ title: 'Save failed', sub: apiErrorMessage(e) }); }` to each. Better: one shared `useMutation(fn)` helper that owns `saving`, error toast, and rollback, and replace all 27 sites.

### 2. App bootstrap has no `.catch` — one failed request renders an empty app
`App.tsx:94-145`
```
    Promise.all([api.get('/dashboard'), api.get('/users'), api.get('/preconstruction/workspaces')])
      .then(([dash, users, workspaces]) => { … })
      .finally(() => setLoading(false));
```
**Why it matters:** `Promise.all` rejects if *any* of the three fails. `loading` flips false, `bids`/`gens`/`wonJobs` stay `[]`, and every page renders a legitimate-looking "no records" state. A user could conclude their pipeline was deleted.
**Fix:** `.catch(err => setBootError(err))` and render a retry banner instead of the empty shell; consider `Promise.allSettled` so a failing `/preconstruction/workspaces` doesn't blank the dashboard.

### 3. Zero request cancellation app-wide — stale responses win the race
`grep -rn "AbortController\|CancelToken\|signal:"` → **0 hits**. 37 files call `api.get`; only 6 use a `let cancelled = false` guard (`AddBidModal`, `SimilarBidsPanel`, `SurveyMarkupEditor`, `PreBidQuantityCompare`, `PreBidScopeCompare`, `FilePreviewModal`). **35 files fetch inside an effect with no guard at all.**
`features/bid-hub/OverviewTab.tsx:113-120`
```
  useEffect(() => {
    api.get(`/bids/${bid.id}/qualify`).then(({ data }) => { … setWinProb({ pct, label }); }).catch(() => {});
  }, [bid.id]);
```
**Why it matters:** click bid A → bid B quickly and A's slower response lands last, so B's hub shows A's win probability, with the GC's name in the label. Same class of bug in `CustomerHub.tsx:125-128`, `PcWorkspace.tsx:534-547` (6 parallel gets keyed on `bid.id`), `LeadDetailDrawer`, `CommandCenterPage`.
**Fix:** the guard is 3 lines; apply it everywhere, or wrap it once: `useApi(url, deps)` returning `{data, error, loading}` with an `AbortController` in the cleanup. That single hook would also fix findings 1, 12 and 17.

### 4. `xlsx@0.18.5` — unpatched CVEs, parsing user-uploaded files, in the main bundle
`frontend/node_modules/xlsx/package.json` → `"version": "0.18.5"` (the last version ever published to npm). `components/filePreview.ts:1` `import * as XLSX from 'xlsx';` — a **static** import, reached from `CustomerHub.tsx:5`, `PcWorkspace.tsx:8`, `RecordFiles.tsx:4`, `useDocPreview.ts:3`, all eagerly loaded.
`components/filePreview.ts:88-95` runs `XLSX.read(buf, { type: 'array' })` on whatever spreadsheet a user uploads.
**Why it matters:** 0.18.5 carries the known prototype-pollution and ReDoS advisories that were only ever fixed on SheetJS's own CDN, not npm — `^0.18.5` can never resolve to a fix. Untrusted-workbook parsing is exactly the exposed path.
**Fix:** the backend already depends on `exceljs@^4.4.0`. Either (a) move sheet preview to a backend endpoint that uses exceljs and returns rows as JSON — removes ~400KB from the bundle *and* the CVE, or (b) swap the frontend to `exceljs` directly. Note `fixSheetRange` (`filePreview.ts:74-86`) is SheetJS-specific and would need porting.

### 5. Optimistic write with a `catch(() => {})` and an unconditional success toast
`features/elec-projects/ElecProjectsPage.tsx:173-178`
```
  const setPhase = (id: string, phase: ElecPhase) => {
    setPhases(prev => ({ ...prev, [id]: phase }));
    api.patch(`/bids/${id}/phase`, { phase }).catch(() => {});
    showToast({ title: 'Status updated', sub: STATUS_META[phaseStatus(phase)].label });
```
**Why it matters:** the phase changes on screen, the toast says "Status updated", and the server never got it. On next refresh the project silently reverts. `SalesByRepPage.tsx:28-33` does this correctly with a rollback — copy that.
**Fix:** `await` it, roll `setPhases` back in `catch`, and only toast on success.

### 6. Workspace autosave swallows every failure
`features/preconstruction/PcWorkspace.tsx:380-392`
```
      api.put(`/preconstruction/${bid.id}/workspace`, {
        step: ws.step, active_tab: ws.activeTab, notes: ws.notes,
        scope: ws.scope, rfis: ws.rfis, files: ws.files, …
      }).catch(() => {});
```
**Why it matters:** this is the *only* persistence for estimator notes, scope text and RFIs. A dropped connection loses an afternoon of pre-construction work with zero indication.
**Fix:** track a `saveError` state, show a persistent "Not saved — retrying" chip, and retry with backoff.

### 7. Session token in `localStorage` with no expiry check on restore
`hooks/useAuth.ts:30-31`
```
    const s = localStorage.getItem('crm_user');
    return s ? JSON.parse(s) : null;
```
The `?mstoken=` branch (line 22) *does* check `payload.exp * 1000 > Date.now()` — the ordinary restore path does not.
**Why it matters:** two issues. (a) `crm_token` in `localStorage` is readable by any injected script; the app renders server HTML via `dangerouslySetInnerHTML`, so the blast radius is real (mitigated — see Done Well #2). (b) With an expired JWT the app boots fully "logged in", fires the bootstrap requests, gets 401s, and only then hard-redirects — a confusing flash-then-eject.
**Fix:** decode `exp` on restore and treat an expired token as logged-out. Longer term, move to an httpOnly refresh cookie so the access token never touches `localStorage`.

---

## MEDIUM

### 8. No code splitting anywhere
`grep -rn "React.lazy\|Suspense"` → **0 hits**. All 20 top-level pages are static imports in `App.tsx:6-24`.
**Why it matters:** every user downloads Settings, PcWorkspace (2799 lines), the proposal builder, and `xlsx` before the login form paints. Field techs on LTE feel this.
**Fix:** `const SettingsPage = React.lazy(() => import('./features/settings/SettingsPage'))` for the switch cases in `renderView()`, wrapped in one `<Suspense>`. Highest-value splits: `SettingsPage`, `PcWorkspace`, `BuilderPage`, `ElecProjectsPage`.

### 9. Opening one project downloads every document and every communication in the org
`features/elec-projects/ElecProjectsPage.tsx:133-134, 148-149`
```
      api.get('/documents'),
      api.get('/comms'),
…
        docs: … (docRes.value.data as ProjDoc[]).filter(d => (d as any).linked_id === id) : [],
```
**Why it matters:** an 11-request fan-out per project open, two of which are unbounded org-wide lists filtered client-side. This degrades linearly with company age and leaks unrelated records into the client.
**Fix:** `api.get('/documents?linked_id=' + id)` — `PcWorkspace.tsx:545` already uses that exact filtered form.

### 10. `PcWorkspace.tsx`: 2,799 lines, 43 `useState`, 7 `useEffect`, one component
`PcWorkspace.tsx:299-369` is an unbroken run of 43 `useState` declarations in `PcWorkspaceView`.
**Why it matters:** every keystroke in any field re-renders the whole 2,799-line tree; no state is testable in isolation; the import/takeoff/proposal/AI concerns are entangled.
**Fix:** the tabs are already logically separated — extract `<TakeoffTab>`, `<PricingTab>`, `<ProposalTab>`, `<ImportPanel>` as sibling components, and collapse the ~12 `importX` states into one `useReducer`. Comparable: `ElecProjectsPage` 1345 lines / 19 useState, `OverviewTab` 570 / 18, `LeadDetailDrawer` 569 / 16, `CustomerHub` 510 / 16.

### 11. Declared types disagree with the wire format for money
`types/index.ts:20` `amount: number | null;` and `:159` `value: number;`
`database/migrations/002_create_bids.sql:8` `amount NUMERIC(12,2) DEFAULT 0` — and `grep -rn "setTypeParser" backend/src` → **0 hits**, so node-postgres returns NUMERIC as a **string**.
**Why it matters:** the types are wrong, so TypeScript will never catch a missing coercion. The codebase currently survives by defensive `Number()` at 12 call sites (`ElecPipelinePage.tsx:50`, `divisionStats.ts:30`, `HomeKpis.tsx:100`, …) — a single omitted one produces `"15430.00" + 200 === "15430.00200"` on a contract value.
**Fix:** declare these as `string | number` (forcing coercion at every use), or set `pg.types.setTypeParser(1700, parseFloat)` in the backend once and keep the frontend types honest.

### 12. Three incompatible role vocabularies
`hooks/useAuth.ts:7` `export const PRIVILEGED_ROLES = ['owner', 'administrator', 'manager'];`
`features/contacts/CustomerHub.tsx:52` and `features/command-center/HomeKpis.tsx:9` (duplicated) `const MANAGER_ROLES = ['owner', 'administrator', 'sales_manager'];`
`hooks/useAppSettings.ts:134-147` `DEFAULT_ROLE_PERMS` — a third list, including both `sales_manager` and legacy `manager`.
**Why it matters:** `'manager'` is not in the `User['role']` union (`types/index.ts:7`), so `PRIVILEGED_ROLES` gates on a role that cannot exist, while `sales_manager` — a real role — is denied Settings but granted customer-merge. That inconsistency reads as a bug to the sales manager who hits it.
**Fix:** one exported `ROLE_CAPABILITIES` map in `hooks/useAuth.ts`, typed against `User['role']` so a typo fails the build. Note `App.tsx:288` gates Settings correctly on the client — this is a correctness/consistency issue, not a bypass, *provided* the backend enforces the same (unverified).

### 13. No axios timeout, and 401 does a full page reload
`api/client.ts:3` `const api = axios.create({ baseURL: '/api' });` — no `timeout`.
`api/client.ts:14-18` — 401 → `window.location.href = '/login'`.
**Why it matters:** a hung request spins forever with no way out (only four call sites pass a per-request timeout: `IntegrationsSection`, `SignedContractCard`). And the 401 hard-navigates, discarding in-memory form state and dropping the user on a bare login with no "return to where you were".
**Fix:** `timeout: 30_000` on the instance (with per-request overrides for the long AI/backfill calls, which already pass their own). Replace the `location.href` with a React-Router navigate that preserves `?next=`. Also add a network-error branch — right now a down backend and a 500 are indistinguishable to callers.

### 14. Format helpers reimplemented across the tree despite `lib/money.ts` existing
`lib/money.ts` is a proper single source (Intl, currency-aware). Yet:
- `fmt(n)` — byte-identical implementations at `features/builder/BuilderPage.tsx:19`, `features/builder/EvBuilderPage.tsx:17`, `features/builder/proposalChrome.tsx:25`
- `dayOf(d)` — 4 copies: `HomeKpis.tsx:15`, `LeadsPage.tsx:23`, `ElecOverviewTab.tsx:18`, `GenOverviewTab.tsx:18`
- `fmtDate` — 7 independent definitions; `fmtSize` — 4; `toLocaleString` across 14 files
**Why it matters:** the currency setting in `lib/money.ts` is ignored by all three `fmt()` copies, so a non-USD tenant gets `$` on every proposal. Any format fix has to be made 3-7 times.
**Fix:** move `fmt`/`fmtDec`/`fmtDateLocal` out of `proposalChrome.tsx` into `lib/money.ts` and `lib/date.ts`; delete the copies.

### 15. `.catch(() => {})` × 35 — errors discarded, not logged
By file: `PcWorkspace.tsx` 11, `AddBidModal.tsx` 3, `LeadsPage.tsx` 3, `push.ts` 2, `AIPermissionsSection.tsx` 2, `ElecProjectsPage.tsx` 2, `DocsPage.tsx` 2, `OverviewTab.tsx` 2, plus 8 singletons.
**Why it matters:** combined with `console` being used exactly **twice** in non-test code (`ErrorBoundary.tsx:19` and a string literal in `AISection.tsx:118`), a production failure leaves *no* trace — not in the UI, not in the console, not on a server.
**Fix:** a `swallow(err, context)` helper that at minimum `console.warn`s in dev and posts to a `/client-errors` endpoint in prod. Keep the silent behaviour only where it's genuinely optional (badge polling, `push.ts`).

### 16. Per-project data is cached for the session and never invalidated
`features/elec-projects/ElecProjectsPage.tsx:123` `if (projData[id]) return; // already loaded`
**Why it matters:** the opposite of the "navigating back refetches everything" problem — here nothing ever refetches. A change order added by a colleague, or the app's own mutations that don't route through `updateProjData`, stay invisible until a hard refresh. `loadProject`'s `useCallback` also lists `[projData]`, so its identity churns on every load.
**Fix:** store a `loadedAt` per id and refetch beyond a TTL / on window focus.

### 17. No 404 route — unknown URLs render a fake "coming soon"
`App.tsx:298-299`
```
      default:
        return <StubPage title={view.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}/>;
```
A typo'd URL like `/electrcal` renders "**Electrcal** — coming soon". Route params are unvalidated too: `App.tsx:268` only checks `viewParam` is truthy before handing it to `BidHubPage` (which does at least render a "Bid not found" card — good).
**Fix:** keep `StubPage` for the genuinely-planned views (enumerate them) and add a real `NotFound` for everything else.

### 18. Full-list refetch after every mutation
`CustomerHub.tsx:159,164,179,218` and `IntakeInboxPage.tsx:140,188,204` call `load()` after each write; `CustomerHub`'s `load()` (`:125-128`) re-pulls the entire customer aggregate — bids, gens, wonJobs, communications, documents, tasks — to reflect one added task.
**Why it matters:** a visible flash-to-`Loading…` (`:130` returns a full-page spinner whenever `detail` is null) and 7 backend queries per keystroke-sized action.
**Fix:** merge the mutation's response into local state (the endpoints already return the created row), as `SalesByRepPage` and `App.handleNewBid` do.

### 19. `ErrorBoundary` only wraps the root
`main.tsx:18-22` — a single boundary around `<BrowserRouter>`.
**Why it matters:** one render throw in, say, `ProposalPreview` blanks the entire application instead of one panel. Given `ProposalPreview.tsx` renders deeply-nested optional server data, this is reachable.
**Fix:** add a boundary around `renderView()`'s output in `App.tsx:320` so a page crash keeps the shell and nav alive.

### 20. `eslint-disable-next-line react-hooks/exhaustive-deps` × 5, one with a computed dep
`features/bid-hub/BidHubPage.tsx:45-50`
```
  React.useEffect(() => {
    if (!pcData[bidId] && bid) { onPcUpdate(bidId, blankWorkspace(bidId, bid.name, bid.amount ?? 0)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidId, bid, pcData[bidId]]);
```
Also `LeadSiteSurvey.tsx:137`, `SurveyMarkupEditor.tsx:108`, `PcWorkspace.tsx:576`, `PreBidAnalyze.tsx:39`. `bid` is a fresh object identity from `bids.find(...)` on every `bids` change, so this effect re-runs on unrelated pipeline updates.
**Fix:** depend on `bid?.id`/`bid?.name`/`bid?.amount` rather than the object, and drop the disable.

---

## LOW

### 21. 49 array-index keys; one on an editable, removable list
`features/gen-pipeline/SiteVisitChecklist.tsx:235-240`
```
          {data.acUnits.map((u, i) => (
            <div key={i} …>
              <input … value={u.size} onChange={e => setAc(i, { size: e.target.value })}/>
              <ToggleGroup options={[...AC_TYPES]} value={u.type} …/>
              <button type="button" onClick={() => removeAc(i)} …>✕</button>
```
The other 48 are on read-only render lists (bullets, AI output lines, static table rows) where index keys are fine. This one reorders on delete.
**Fix:** give each AC unit a `uid` on creation and key on that. Focus and any `ToggleGroup`-internal state currently jump a row when a middle unit is removed.

### 22. Unused exports
`getCurrencyCode` (`lib/money.ts:15`) and `PRIVILEGED_ROLES` (`hooks/useAuth.ts:7`) are exported but referenced in no other file. `MANAGER_ROLES` is defined twice rather than exported once (see #12).
**Fix:** drop the `export`, or export `MANAGER_ROLES` from `useAuth.ts` and delete the duplicate.

### 23. `any` usage — 33 occurrences, mostly one pattern
`grep -rnE ": any\b|<any>|as any|any\[\]"` → 33. Concentrated in `ElecProjectsPage.tsx` (6) as `(d as any).linked_id` — a field the declared `ProjDoc` type omits — and `CalendarPage.tsx:85` `(g as any).signed_at`, which *is* declared on `Gen` (`types/index.ts:132`) and needs no cast.
**Fix:** add `linked_id` to `ProjDoc`; delete the two `CalendarPage` casts. `as unknown as` appears 30 times but 22 are in `.test.*` files building fixtures — legitimate.

### 24. Domain state is prop-drilled 4 levels deep
`bids`/`setBids`: `App.tsx:245` → `ElectricalHubPage.tsx:54,67` → `BidHubPage.tsx:106` → `OverviewTab.tsx:24`. `AppContext.tsx` already solved this for `user`/`showToast`/`settings` — the domain lists were left out.
**Fix:** a `BidsContext` following the same pattern would remove ~12 prop declarations and the `React.Dispatch<SetStateAction<Bid[]>>` types that leak React internals into page props.

---

## Done well (with evidence)

1. **Real test coverage on the money-critical paths.** 42 test files, 5,241 LOC. `features/builder/genCalc.test.ts` (434 lines) and `evCalc.test.ts` (214) cover builder pricing math; `features/preconstruction/PcWorkspacePricing.test.tsx` (349) covers estimate totals; `ProposalPreview.test.tsx` (394) and `EvProposalPreview.test.tsx` cover the proposal document. The three flows named in this audit's brief all have tests.
2. **Server HTML is properly sanitized.** Only 3 `dangerouslySetInnerHTML` sites: `Icon.tsx:59` (static const map), and `FilePreviewModal.tsx:93`, fed exclusively from `sanitizeDocHtml` (`FilePreviewModal.tsx:38`). `filePreview.ts:24-31` adds an `afterSanitizeAttributes` hook restricting `<a href>` beyond DOMPurify's own allowlist, with 6 XSS regression tests in `filePreview.test.ts:35-78`.
3. **Every heavy PDF/canvas dependency is dynamically imported.** `html2canvas`, `jspdf`, `pdfjs-dist` and `mammoth` are all behind `await import(...)` (10 sites incl. `ProposalPreview.tsx:88`, `sizerParse.ts:10`, `filePreview.ts:100`). Only `xlsx` breaks the pattern (finding #4).
4. **One optimistic update is done exactly right** — `SalesByRepPage.tsx:28-33` applies, then restores the prior `commission_status` in `catch`. This is the template the other sites need.
5. **`lib/money.ts` is a genuine, currency-aware single source** with an `Intl.NumberFormat` fallback (`:22-25`) so a bad currency code can never throw in render.
6. **Date-only strings are handled correctly where it counts** — `dayOf()` appends `'T00:00:00'` to force local parsing (`HomeKpis.tsx:15`, `LeadsPage.tsx:23`), `proposalChrome.tsx:39-45` constructs from parts, `CustomerHub.tsx:10` branches on `ts.length <= 10`. The classic UTC-shift bug is absent from the paths I checked.
7. **Zero `TODO`/`FIXME`/`HACK` comments, zero `@ts-ignore`/`@ts-expect-error`, `strict: true`** in `tsconfig.json`. Comment quality is unusually high — `App.tsx:128-137` and `PcWorkspace.tsx:552-560` explain *why* the code is shaped as it is, not what it does.
8. **`Promise.allSettled` with per-request fallbacks** in `ElecProjectsPage.tsx:124-152` — one failing section doesn't blank the workspace.

---

## Unverified — needs a run, not a read

- **Bundle size numbers.** I did not run `npm run build`; the code-splitting and `xlsx`-weight claims are from import-graph reading, not from a measured bundle.
- **NUMERIC-as-string at runtime.** Inferred from `NUMERIC(12,2)` in `002_create_bids.sql:8` + zero `setTypeParser` calls in `backend/src` + the defensive `Number()` wrappers. Confirm by logging `typeof bid.amount` from a live `/dashboard` response.
- **Backend role enforcement.** I audited client-side gating only. Whether `/settings`, `/admin/*` and `/customers/:id/merge` re-check the role server-side was out of scope — if they don't, finding #12 escalates to a real authorization bypass.
- **Whether `exceljs` covers the read path.** The `fixSheetRange` workaround (`filePreview.ts:74-86`) targets a SheetJS-specific `!ref` quirk; the equivalent in exceljs is untested here.
- **Race-condition frequency in practice.** The stale-response window is real but its user-visible rate depends on latency I didn't measure.
- **Effect-dependency hazards beyond the 5 explicit `eslint-disable` lines.** No ESLint config is present in the repo (`react-hooks/exhaustive-deps` is referenced by the disables but I found no `.eslintrc`), so there is no lint pass to compare against; other missing-dep bugs may be latent.
