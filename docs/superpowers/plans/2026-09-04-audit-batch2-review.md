# Adversarial review — Audit Batch 2, Frontend Reliability (`fix/audit-batch2`)

## 1. Merge recommendation: **DO NOT MERGE**

The design is good and the report unusually honest — I checked six disclosed deviations and all six
were true. `useApi`'s cancellation is correct, the migration is faithful at every site I sampled,
backend scope is exactly the three permitted files, and every verification grep passes. But four
defects reach the user. Task 5 moved four hooks *below* `App.tsx`'s `if (!user)` early return; I
reproduced the crash both directions — **signing in throws, and so does the 401 eject Task 2 exists
to deliver**. Task 7's `aliveRef` is never re-armed after StrictMode's dev double-mount, and I
measured all three of its headline fixes doing nothing in the environment the plan says Jake runs.
Task 3's migration of `saveSection` turned a rejecting call into a swallowing one without updating
its five `await`ing call sites, so a failed save marks the draft saved in the parent *and* disarms
the Task 8 guard added in the same batch. And six failure toasts still render green, one titled
"Save failed". All four are small, contained fixes; the architecture under them is sound.

## 2. Blocking findings

### B1 — Four hooks below `if (!user)`: login and logout both crash the app
`frontend/src/App.tsx:257`, then `:282`, `:283`, `:285`, `:292`

```
  if (!user) {                                                       // :257
  const [warningDismissed, setWarningDismissed] = useState(false);   // :282
  useEffect(() => { if (partialFailures.length === 0) ... }, [...]); // :283
  const retryBootstrap = useCallback(() => { ... }, [...]);          // :285
  usePageTitle(view === 'bid' ? null : (VIEW_TITLES[view] ?? null)); // :292
```

On `main` every hook was above the early return (last hook :180, return :191). All four are new.

**Reproduced** with a throwaway test that mounts `App` once and flips `useAuth`'s user in place:
null → user gives `Rendered more hooks than during the previous render`; user → null gives
`Rendered fewer hooks than expected`. So signing in throws instead of rendering the dashboard, and
`App.tsx:218`'s `crm:unauthorized` handler calls `logout()` before `navigate`, so the whole 401
story ends on the root ErrorBoundary. Both new App tests mock a constant signed-in user.

**Fix.** Move the four hook calls above `if (!user)`; the derived values can stay.

### B2 — `aliveRef` never re-armed: Task 7's autosave fixes are inert under StrictMode
`frontend/src/features/preconstruction/PcWorkspace.tsx:399-403`

```
  const aliveRef = useRef(true);
  useEffect(() => () => {
    aliveRef.current = false;
    if (retryTimer.current) clearTimeout(retryTimer.current);
  }, []);
```

`main.tsx:23` renders `<React.StrictMode>`. In dev React mounts→unmounts→remounts, the cleanup
fires once and nothing sets `aliveRef` back, so `saveWorkspace` returns at `:426`/`:430` before any
`setSaveState` or retry. The same double-invoke defeats `didMountRef` (`:441-443`).

**Measured** — the existing autosave harness wrapped in `<React.StrictMode>`:

| Behaviour | Test as written | Under StrictMode |
|---|---|---|
| no-op PUT on open (audit data #16) | 0 PUTs | **1 PUT** |
| chip after a successful save | `Saved` | **`Saving…`** stuck |
| chip after a failed save | `Not saved — retrying` | **`Saving…`** |
| retry 2 s after a failed save | 2nd PUT | **none** |

Because `saveState` never reaches `'error'`, `useUnsavedGuard(pricingDirty || saveState === 'error')`
(`:478`) never fires for a stuck autosave — the exact fallback the struck pricing decision leaned on.
Production strips the double-invoke, but the plan's Environment facts say the live app runs Vite dev.

**Fix.** Set `aliveRef.current = true` in the effect body, and make the mount guard survive a
remount. Add one StrictMode case to `PcWorkspaceAutosave.test.tsx`.

### B3 — `saveSection`: failed saves now update the parent and disarm the unsaved guard
`frontend/src/features/elec-projects/ElecProjectsPage.tsx:409`, call sites `:456`, `:469`, `:490`, `:909`, `:950`

`main:373` had no catch, so a failed PUT **rejected** and the `await` in each handler aborted the
rest. The call sites are byte-identical after the migration:

```
:456  onClick={async () => { await saveSection('overview', ovDraft); onDataChange({ overview: ovDraft }); }}
:950  await saveSection('closeout',payload);  :951  onDataChange({closeout:payload});
```

but `run()` swallows and resolves `undefined`, so `onDataChange(...)` now runs unconditionally.
**Failure scenario:** the PUT 500s; the user sees "Save failed" *and* `data.overview` is overwritten
with the unsaved draft, so the section reads as persisted and the dirty check added at `:404-406`
goes false — the Task 8 guard added in this same batch is silently satisfied and the user walks away
from work that never reached the server. **Fix:** return a truthy value from the mutation `fn` and
gate each site on it.

### B4 — Six failure toasts still render as a green success (Task 4 incomplete)

The sweep caught toasts raised via `useMutation` or a bare `catch`, but not ones inside a status
branch of a `catch`:

```
CustomerHub.tsx:166        { title: 'Save failed', sub: <server message> }        // PATCH threw, edits lost
GenPipelinePage.tsx:162    { title: 'Admin only', … }                             // 403, nothing deleted
SignedContractCard.tsx:209 { title: 'No signature on file', … }                   // 400, not countersigned
SignedContractCard.tsx:143 { title: "Can't rebuild this one", … }
CustomerHub.tsx:259, :273  { title: 'Preview failed', … }
```

`CustomerHub.tsx:166` is the worst: the file was edited in this batch (+48 lines) and a toast titled
"Save failed" still shows the green check — the literal defect audit ux #3 describes. Each is a
one-word `variant: 'error'` fix; two sit beside sibling branches that *were* converted.

## 3. Non-blocking findings

- **`useMutation`'s single-flight guard is per-hook, not per-target** (`useMutation.ts:94` returns
  before `optimistic`/`fn`/`onError`/`onSettled` — a total no-op, no toast). Correct for one form
  with one button, wrong where one hook backs many targets with no `disabled`: `setPhase` (`:190`,
  two quick status clicks — second silently dropped), `saveSection` (`:409`, one hook behind five
  Save buttons), `runLoadProject` (`:203`, open A then B before A settles → B renders empty
  forever), `DocsPage.tsx:131` / `ElecProjectsPage.tsx:1201` deletes, `AIPermissionsSection.tsx:97`
  override matrix, `IntakeInboxPage.tsx:126` `markRead`. `main` issued one request per call at all
  of these. Cheapest fix: key the guard, or `disabled={saving}` on the controls.
- **`?next=` is lost when more than one request 401s at once.** `App.tsx:210-222` recomputes `next`
  from `window.location` and skips it once the path starts with `/login`. The first event navigates
  to `/login?next=/bid/xyz`; the second (bootstrap fires 4–5 parallel gets) reads `/login…`, sets no
  `next` and `replace`s it away. Capture `next` once, or ignore the event when already on `/login`.
- **Storage is not cleared "exactly once":** `clearSession()` per 401 plus `logout()` in the
  listener. Idempotent, so cosmetic, but the plan's wording isn't literally met.
- **`setPhase` rollback can restore `undefined`** (`ElecProjectsPage.tsx:112`): `phases` is a lazy
  initializer never re-synced from `bids`, so for a bid awarded after mount `previous` is `undefined`
  and the rollback renders `'signed'` instead of the true phase.
- **`openNewBid` bypasses the guard's answer** (`App.tsx:246-250`): `setView` is guarded but
  `setOpenAddBid(true)` runs regardless, so "Keep editing" still arms the modal for later.
- **`DocsPage.tsx:82`**: the per-file "exceeds 50 MB — skipped" toast is overwritten by the
  `successToast` at `:105` (one toast slot). All files oversized → green "0 files uploaded".
- Minor: `useMutation` throws before its own `useState` (`:71-73`) when no notifier is present — a
  latent hook-count hazard nothing hits today; `runLoadProject`'s `errorTitle`
  (`ElecProjectsPage.tsx:205`) is unreachable behind `Promise.allSettled`, so the comment at
  `:186-188` is wrong; `/preconstruction/costs` and `/estimates/unit-costs` now fetch once per mount
  rather than per `bid.id`; `PcWorkspace`'s proposal-preview lost its
  `.catch(() => setProposalPreview(null))`.
- **`DocsPage.tsx:115 localStorage.getItem('token')` — confirmed real, and yes, fold it in.** The
  only `getItem('token')` in the tree; everything else uses `crm_token`, so this download has been
  sending `Bearer null` and 401ing forever. Since Task 2 made 401s eject the user, leaving it means
  the button now logs people out. One-word fix; take it here with a test.
- The struck pricing-autosave decision is **correctly justified**: `bid_workspaces` gains only
  `confirmed_service` after `018` (`052_workspace_confirmed_service.sql`), and
  `preconstruction.ts:1340-1357` inserts an explicit 10-column list. Verified.

## 4. Per-task table

| Task | Compliance | Correctness | Notes (all verified independently) |
|---|---|---|---|
| 1 suite green | Full | Good | Right root cause (Node 22's `localStorage` getter defeating happy-dom); `test/setup.ts` + `vite.config.ts`, no per-test shims. |
| 2 `useApi` + 401 | Full | Good; **B1** on the eject | One `AbortController` per fetch, aborted in cleanup and on every `url`/`paramsKey`/`depsKey` change; `then`/`catch`/`finally` all early-return on `signal.aborted`; `reload()` aborts before bumping the nonce; AbortErrors swallowed, never surfaced. `params` serialized so inline literals don't loop; no call site passes a function/Date/fresh array, `deps:` unused. Eight migrations sampled (PcWorkspace's six keyed gets, OverviewTab `/qualify`, CustomerHub, LeadDetailDrawer, CommandCenter, useNotifications, IntakeInbox, UnitCost/AISection): same URLs, same params (`?linked_id=` → `params`), same state shapes, `[bid.id]`/`[lead.id]` keys preserved in the URL, gated effects mapped to `enabled`. No loading regression (CommandCenter's `if (loading && !brief)` guard pre-exists). Polls keep 60 s and call `reload`. No redirect loop. |
| 3 `useMutation` | Full + 4 disclosed options | **B3** + single-flight caveat | Double-run guarded on a **ref**, not `saving` state — correct. Ordering rollback → `setError` → toast → `onError` → rethrow: consistent. `optimistic` on the hook is **not** a stale-closure hazard (`optsRef` re-stamped each render). Deletes remove the row only in `onSuccess`, no `optimistic`; `setPhase` rolls back to `previous` and toasts only on success; `useStagePipeline` keeps its rollback and now names the cause. 12 sites read line by line: no lost or invented success toasts, no lost `if (!ok)` branching. |
| 4 toasts | Partial | **B4** | Default still `'success'` (`types/index.ts:180` optional, `Toast.tsx:18` `?? 'success'`); unmarked toasts render byte-identically to `main`. 41 `'error'` + 3 `'info'`; the `'info'`s are defensible (operation succeeded, one field missing). 7 s / 4.2 s correct, previous timer now cleared. |
| 5 bootstrap/404/titles | Deviates (disclosed) | **B1** | Three independent `useApi` reads instead of `allSettled` — stronger. `/dashboard` fail → `BootError` + working Retry; `/users` or `/workspaces` fail → dismissible amber bar naming each. Page boundary is **inside** `AppShell`'s children (`:445-447`), keyed on pathname; `App.bootstrap.test.tsx:150` already mounts a throwing view and asserts the nav survives. `StubPage` deleted; `NotFound` is `default` and covers `/bid` with no id. `VIEW_TITLES` covers all 11 non-record switch cases. |
| 6 expired JWT | Full | Good | **`exp`-less-as-expired confirmed safe**: `middleware/auth.ts:51 TOKEN_TTL='12h'`, applied at `auth.ts:49` (login) and `:196` (MS exchange); the only other `jwt.sign` (`:241`, `'1h'`) is a password-reset token. Also fixes a real crash on corrupt `crm_user` JSON. |
| 7 autosave + polling | Full on paper | **B2** | Backoff 2/4/8/16 capped 30 s, retries send the *current* payload, `pollCancelled` checked after **every** await (`:492,500,539,552,560,575`), reset `:586`, set by cleanup `:611`, 10-min deadline on both loops with a visible bar. All inert under StrictMode. |
| 8 unsaved guard | Full; 1 struck, 1 excluded, both justified | Good | Dialog is the app's own, not `window.confirm`. `useNavigate` only in `App.tsx`, no `<Link>` anywhere, `AppShell.tsx` **unchanged**, and all its nav points (sidebar `:155`, Settings `:165`, mobile `:226`/`:269`, `SearchBox` `:214`, `NotificationBell` `:215`, logout `:191`) route through `onNav` = guarded `setView`; hub tabs and `onOpenBid` too. All five screens snapshot-compare. `beforeunload` added only while dirty, removed in cleanup. `AwardKickoffModal` really has 0 inputs. |
| 9 client errors | Full, 1 disclosed deviation | Good | `requireAuth` → per-**user** 60/min → 8 KB 413 → Zod → one pino `warn` + `stack.slice(0,2000)` → 204, nothing stored. Route-level rather than parser-level cap because `express.json()` is app-wide at `index.ts:73`. `reportError` never throws (outer try/catch), never awaits, 10/min, `keepalive`, plain `fetch` so no recursion, skips our own aborts, no-ops without `crm_token`. Both boundaries, `useApi:83`, `useMutation:116` call it. |

## 5. Test results measured

| Suite | Result |
|---|---|
| `frontend/ npm run typecheck` | exit 0, clean |
| `frontend/ npm test` | **55 files / 428 tests, 0 failing**, exit 0 — matches the report exactly |
| `backend/ npm run typecheck` | exit 0, clean |
| `backend/ npm test` | 86 files / 781 tests, **4 failing** (`prebid` ×3, `integration` ×1), 3 skipped — both files are on the plan's known-flake list; `clientErrors.test.ts` 6/6 pass |

Plan verification greps, run literally on the branch:

| Grep | Measured |
|---|---|
| `.catch(() => {})` | **1 code hit** — `ProposalPublicPage.tsx:156`, `// optional:` on `:155`; 3 other hits are prose ✔ |
| `try{…} finally` with no `catch` | **0** (scripted brace-matcher, all non-test `.ts`/`.tsx`) ✔ |
| `window.location.href` | **0 anywhere** ✔ |
| `let cancelled = false` | **0** ✔ |
| `api.get(` in `*.tsx` | 29 non-test; the 4 named exceptions are real and commented ✔ |
| `api.get` anywhere | 32 non-test; the 3 `.ts` hits (`push.ts:71`, `useDocPreview.ts:44,60`) are disclosed ✔ |
| `document.title` | `usePageTitle` + 4 call sites; `VIEW_TITLES` covers all 11 top-level views ✔ |
| `variant: 'error'` | **41** non-test ✔ (+3 `'info'`) — but see B4 |
| `navigate(` outside `App.tsx` | **0** ✔ |
| backend files changed | **exactly 3**: `index.ts` (+2 lines), `routes/clientErrors.ts`, `test/clientErrors.test.ts`; no `database/` change ✔ |

`git status --short` in the worktree is **empty** — both throwaway probe files deleted, no tracked
file modified. Nothing under `Local Version` was written; no dev server, Docker, `DATABASE_URL`,
`.env` print, commit or push.

## 6. Could not verify

- **Visual rendering.** Toast colours, the save chip and BootError/NotFound layouts are asserted by
  class name only; happy-dom loads no CSS. The tokens exist in `styles.css`; I did not see them.
- **The `?next=` concurrency bug** is reasoned from the code, not reproduced — B1 crashes `App` on
  `logout()` before that path can be driven in a test.
- **The 4 backend failures are pre-existing by construction** (3 backend files changed, none touched
  by those tests) rather than by my running the suite on `main`.
- ~30 of ~50 migrated call sites audited. Not opened: most of `settings/sections/*`, `PreBid*`,
  `GenProjectsPage`, `ContactsPage`, `FollowupsPage`, `SimilarBidsPanel`, `ActivityTab`,
  `DriveImage`, `RecordFiles`.
- Real-world behaviour of the new route beyond its 6 tests.

---

# Re-review — six commits after `0fab0c7`

`69c6db6` B1 · `016018e` B2 · `c6b1e1f` B3 · `493df01` B4 · `9e727ec` non-blockers · `64d31ae` report.
No backend or `database/` change (`git diff --stat 0fab0c7..HEAD -- backend/ database/` is empty).

## Verdict: **MERGE**

All four blocking findings are fixed, each verified by a test I proved non-vacuous: reverting
`App.tsx`, `PcWorkspace.tsx`, `ElecProjectsPage.tsx` and `useMutation.ts` to `0fab0c7` made the new
suites fail **14 tests across all 5 files** — `App.authTransition` 5/5, the four StrictMode autosave
cases, `saveSection`'s failure case, `toastVariants` 1/3, `useMutation` keyed 3/3. Every non-blocker
was addressed rather than argued away, and two fixes are better than what I asked for: the mount
guard became an idempotent payload snapshot rather than a remount-proof boolean, and
`toastVariants.test.ts` turned a one-off grep into a standing lint. Nothing was lost in the
`App.tsx` re-apply.

## Verification performed

**B1 — fixed.** Re-ran my scan: `if (!user)` is now at `App.tsx:306` and **0** hook-like calls sit
below it. `usePageTitle(user && view !== 'bid' ? … : null)` (`:296`) keeps the last one safe.
`App.authTransition.test.tsx`'s `Host` (`:84-93`) renders `<App/>` with **no `key`** and re-renders
via a `bump` counter, so it mounts once and flips `user` both directions, asserting
`not.toMatch(/Rendered (more|fewer) hooks/)` on a `console.error` spy. All 5 fail on the old file.

**B2 — fixed, and re-probed.** `aliveRef.current = true` is now in the effect **body**
(`PcWorkspace.tsx:399-405`). `didMountRef` is replaced by `lastScheduledRef`, a payload snapshot,
with `useEffect(() => { lastScheduledRef.current = null; }, [bid.id])` declared *before* the autosave
effect so a bid change re-baselines first. Under `<React.StrictMode>` I measured: (a) opening writes
**0 PUTs**; (b) an edit writes one and the chip reaches `Saved`; (c) a failed save reaches **`Not
saved — retrying`** and retries. On suppression: a failed save, then an edit to `B` and straight back
to `A` inside one debounce, **still sends `A`** (puts 1→2); recovery reaches `Saved` (puts 3); an
edit during the backoff is sent (`last = "second"`, chip `Saved`). Suppression fires only when the
payload is byte-identical to the one already scheduled, and `retryTimer` is never cleared without a
replacement armed — no legitimate save can be lost.

**B3 — fixed.** `fn` ends `return true as const` (`ElecProjectsPage.tsx:425`) and **all five** sites
are gated: `:469`, `:482`, `:503`, `:922`, `:963`, e.g.
`if (await saveSection('overview', ovDraft)) onDataChange({ overview: ovDraft })`.
`ElecProjectsSaveSection.test.tsx` asserts on failure that the toast is
`{ variant:'error', title:'Save failed', sub:'Server error' }`, then navigates and finds
`You have unsaved changes` with `navigated === false` — the guard stays armed.

**B4 — fixed.** My six are all `variant: 'error'` now. Spot-checked 6 of the 15 additions:
`Customer name required`, `Subject required`, `Name and GC are required`, `Price required` →
`'error'` (each `return`s before the operation) and `No AI analysis available`, `Nothing new to
import` → `'info'` (neutral no-ops). All correct; no inversions. `toastVariants.test.ts` is a real
source scan, not a snapshot, and its substantive case fails on the pre-fix tree.

**Non-blockers — all seven addressed.** `key?:` at 7 sites (`AIPermissionsSection:107`,
`DocsPage:144`, `IntakeInboxPage:128`, `ElecProjectsPage:161,203,428,1218`); `saving` semantics are
sane — the Map entry is deleted in `finally`, `setSaving(false)` only when `size === 0`, and a
`settled` flag stops a synchronously-throwing `fn` leaving a dead promise in the map. `?next=` reads
`herePathRef` from the router location behind an `ejectedRef` latch re-armed on a new session
(`App.tsx:212-237`). `openNewBid` runs entirely inside `confirmLeave` (`:262-268`). `setPhase`
rollback falls back to `bids.find(...)?.elec_project_phase ?? 'signed'` (`:197-199`). DocsPage
aggregates skips into one `'info'` toast. `crm_token` fixed at `:122` with `DocsPage.upload.test.tsx`.
Proposal-preview has its error branch back (`PcWorkspace.tsx:695`).

**App.tsx re-apply — nothing lost.** All 15 earlier-commit markers are present: the three bootstrap
`useApi` reads, `partialFailures` ×4, `retryBootstrap` ×3, `BootError` ×2, `ErrorBoundary
variant="page"`, `NotFound` ×3, `VIEW_TITLES`, `usePageTitle`, `confirmLeave` ×7,
`UNAUTHORIZED_EVENT` ×3, the `/login` `next` filter, `warningDismissed`, `intakeApi` ×4.

## Test results measured

| Suite | Result |
|---|---|
| `frontend/ npm run typecheck` | exit 0, clean |
| `frontend/ npm test` | **59 files / 453 tests, 0 failing**, exit 0 |
| `backend/ npm test` | 86 files / 781 tests, **4 failing**, 3 skipped |

`git status --short` is **empty**; both throwaway probes deleted. (One `git checkout 0fab0c7 --`
staged the old blobs; I restored with `git checkout HEAD --` plus `git reset` and re-verified.)

## Remaining non-blockers (do not gate merge)

- `toastVariants.test.ts` only matches a `showToast(` call whose copy is on the **same line**. Every
  toast in the tree is single-line today, so no gap now, but a multi-line toast would slip past it.
- The backend flake **set drifted**: `proposalDocxConfidenceGuard.test.ts` failed this run and one
  `prebid` case recovered, total still 4. The backend diff since `0fab0c7` is empty, so this is not
  from these commits — it widens the known-flake list by one file for the backend batch.
- `openNewBid` now calls `navigate` directly rather than `setView`, correctly avoiding a double
  confirm; if `setView` ever gains logic beyond navigation this site will not inherit it.
