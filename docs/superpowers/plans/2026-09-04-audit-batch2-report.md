# Audit Batch 2 — Frontend Reliability — Feature Report

**Plan:** `docs/superpowers/plans/2026-09-04-audit-batch2-frontend-reliability.md` (Local Version, read-only reference)
**Branch:** `fix/audit-batch2` (worktree: `../Electrical-program-wt-audit2`)
**Execution:** Opus 5
**Commits:** 9 (one per task), plus this report commit — 10 total.
**Base:** `bca2495` (local main, batch 1 merged)

## Summary

All 9 tasks done. The batch's premise was that the frontend hand-rolls every
fetch and every save, so the same three defects repeat across ~60 sites. Two
small primitives now own those paths and every site has been migrated onto
them:

- **`useApi`** — one AbortController per request, aborted on unmount and on
  every key change, with late responses dropped rather than applied. Before
  this, `AbortController|CancelToken|signal:` returned **zero** hits across the
  whole tree.
- **`useMutation`** — owns the busy flag, the failure toast and the rollback.
  Before this, 30 save handlers had a `finally` and no `catch`, so a failed
  PATCH stopped the spinner and did nothing else.

On top of those: failures now look like failures (toast variants), the app
bootstrap says so instead of rendering an empty pipeline, an expired token is
treated as logged out before any request goes out, the estimating workspace's
autosave retries visibly instead of swallowing, its polls can no longer outlive
the component or run forever, the screens that hold work in memory ask before
discarding it, and browser-side errors have somewhere to go.

**Frontend:** 45 files / 359 tests with 9 failing → **55 files / 428 tests, 0
failing**. Typecheck clean.
**Backend:** 85 files / 775 tests → **86 files / 781 tests** (+6 = the new
`clientErrors` tests). The failing set is the pre-existing flakes the plan lists
as out of scope, and it varies run to run: across four runs it was `prebid` and
`integration` every time, `jobNumberCollision` and `bidStandardGeneration` in
two, and `bidstd/verifyBid` in one. **This branch touches exactly three backend
files** — `routes/clientErrors.ts` (new), `test/clientErrors.test.ts` (new) and
one import + one `app.use` line in `index.ts` — so every other failure is
pre-existing by construction:

```
$ git diff --name-only main -- backend/ database/
backend/src/index.ts
backend/src/routes/clientErrors.ts
backend/src/test/clientErrors.test.ts
```

---

## Per-task status

### Task 1 — Make the frontend suite green — **done**
Commit `6667f68`.

All 9 pre-existing failures had **one** root cause, not two. Node 22 defines its
own experimental `localStorage` getter on `globalThis` that resolves to
`undefined` without `--localstorage-file`. Vitest's happy-dom environment only
copies a window property onto `globalThis` when the key is *absent*, and Node's
getter makes `'localStorage' in globalThis` true — so happy-dom's real Storage
never landed and every app-code `localStorage.getItem(...)` threw. That is why
the 2 `CustomerHub` failures looked unrelated to the 7 `useInstallPrompt` ones:
`CustomerHub.tsx:233` reads `localStorage` in `viewDoc`.

- **New:** `frontend/src/test/setup.ts` — a spec-shaped in-memory `Storage` for
  `localStorage` and `sessionStorage`, installed only when the global is not
  already a usable Storage. Setup files run once per test file, so each file
  starts from an empty store.
- `frontend/vite.config.ts`: a `test.setupFiles` block. No `environment` is set,
  so the per-file `// @vitest-environment` docblocks still decide.
- `frontend/src/hooks/useAuth.test.ts`: dropped the per-file shim batch 1 added
  for the same reason (Task 1 asked for a root fix, not per-test workarounds).

**Result:** 45 files / 359 tests, 0 failures (was 2 files / 9 failures). No
per-test try/catch anywhere.

---

### Task 2 — `useApi` with cancellation — **done**
Commit `608d73e`. Audit code #3, #13.

**`frontend/src/api/client.ts`**
- `timeout: 30_000` on the instance; the long AI/backfill calls keep their own
  per-request override.
- `normalizeApiError` / `apiErrorMessage` turn anything axios throws into
  `{ status, message, isNetwork }`: 5xx → `'Server error'` (never the raw body),
  no response → `'Cannot reach the server'` or `'Request timed out'`, 4xx → the
  server's message when there is one, else per-status copy. An HTML error page
  is ignored rather than rendered as markup. The response interceptor attaches
  the result as a non-enumerable `crmError`, so downstream `apiErrorMessage` is
  a lookup, not a re-parse.
- 401 clears storage and dispatches a `crm:unauthorized` window event instead of
  assigning to `location.href`. `App.tsx` listens once and routes to
  `/login?next=<current path>`, which `handleLogin` honours after signing in. A
  401 from `/auth/*` is left to the caller, so a wrong password is no longer
  read as an expired session (it used to hard-reload the login page and discard
  the inline error).

**Split out during Task 3** (see below): the pure parts moved to
`api/errors.ts` and `api/session.ts`, with `client.ts` re-exporting them.

**`frontend/src/hooks/useApi.ts`** — `useApi<T>(url, { params?, enabled?, deps?,
timeout?, responseType? })` → `{ data, error, loading, reload }`. One
AbortController per fetch, aborted by the effect cleanup and on every key
change; a response whose controller is aborted is dropped rather than applied;
`reload()` aborts the in-flight request first. `params` is compared by value
(serialized), so an inline object literal does not loop. No cache, no dedup, no
retry — dedup is a Batch 3 item.

`url` accepts `null` for a conditional read, and `responseType` was added
because `DriveImage` fetches a blob through the same hook; both are pass-throughs,
not new concepts.

**Migration:** every effect that called `api.get` and set state, in 30 files.
Six hand-written cancellation flags deleted. `App.tsx`'s bootstrap `Promise.all`
became three independent `useApi` reads. The three polls (`/brief`,
`/notifications`, `/intake/unread-count`) keep their interval and call `reload`.
`FilePreviewModal`'s boolean flag became the same AbortController idiom (its
async work is local parsing, not a request, but the app now has one cancellation
pattern rather than two).

**Tests:** `hooks/useApi.test.ts` (7), `api/errors.test.ts` (8).
**Fails on unfixed code:** removing the abort checks and the effect cleanup from
`useApi` fails 3 of the 7 — the two-rapid-url-changes race, unmount-mid-flight,
and reload-cancels-previous. Verified by editing the hook and re-running.

**Missed and caught later:** the initial grep was `api\.get(`, which does not
match `api.get<Lead>(...)`. Eight generically-typed effect fetches
(`SignatureSection`, `SurveyFromCalendarModal`, `SignedContractCard`,
`CalendarEventPickerModal`, `LeadsPage` ×2, `LeadDetailDrawer`) were migrated in
the Task 3 commit. The final grep numbers below cover them.

---

### Task 3 — `useMutation` — **done**
Commit `9509074`. Audit code #1, #5, #15; ux #2.

**`frontend/src/hooks/useMutation.ts`** — `useMutation(fn, opts)` → `{ run,
saving, error }`. `run(...args)` keeps `fn`'s own signature and owns the busy
flag, the failure toast (error variant, message from `apiErrorMessage`) and the
rollback. Errors are swallowed after toasting unless `rethrow: true`. A second
`run` while one is in flight returns the first promise rather than firing again
— guarded on a ref, because two clicks in the same tick both read the stale
`saving` state.

Options beyond the plan's list, each earning its place:
- `optimistic(...args) => rollback` — the plan put this on `run`; it is on the
  hook instead, as a function of the same arguments. An options object cannot be
  mixed into a variadic `run(...args)` and stay typed. Modelled on
  `SalesByRepPage`, the one site already doing this correctly.
- `onSettled` — the `finally` a caller would otherwise write. Without it, four
  thin `try { await run() } finally { reset() }` wrappers would have kept the
  `finally`-without-`catch` grep non-zero for no behavioral reason.
- `errorToast: false` — for the writes that report inline (`RecordFiles`,
  `LeadDetailDrawer.createGen`) or are genuinely optional (intake mark-read).
- `showToast` — `PcWorkspace` takes the notifier as a prop rather than from
  context, and its 7 test files render it without the providers.
  `useOptionalShowToast` (new, in `AppContext`) is the non-throwing accessor
  that makes both paths work; `useShowToast` still throws as before.

**Migration:** all 30 `finally`-without-`catch` handlers across 20 files, plus:
- `DocsPage.deleteDoc` and `ElecProjectsPage`'s `DocsTab.remove` — the row is
  removed and "Document removed" shown only on success; on failure the row stays
  and "Delete failed" shows with the normalized reason (audit ux #2).
- `ElecProjectsPage.setPhase` — optimistic with rollback, "Status updated" only
  on success (audit code #5).
- `SalesByRepPage.togglePaid` — already rolled back correctly, but said nothing;
  now toasts the reason.
- The intake read/unread optimistic writes.
- Every user-triggered GET that is an *action* rather than keyed state: document
  downloads and previews, "Score This Bid", the compare drill-down,
  `ElecProjectsPage`'s 11-way project load, `SiteVisitChecklist.finalize`.
- `useStagePipeline` keeps its own rollback — it was the template — but now
  names the cause (`apiErrorMessage`) and renders as a failure.

**Also in this commit:** `api/errors.ts` and `api/session.ts` split out of
`api/client.ts`. 24 test files mock `../api/client` with only a `default`
export; once `useApi`/`useMutation` imported named helpers from it, every one of
those mocks would have had to be rewritten. Moving the pure normalization and
the session teardown into their own modules is better separation *and* leaves
those mocks correct. `client.ts` re-exports both, so existing imports still work.

**Tests:** `hooks/useMutation.test.tsx` (7), `features/docs/DocsPage.delete.test.tsx` (2).
**Fails on unfixed code:** the DocsPage failure case fails against the pre-fix
`deleteDoc` (the row vanishes and "Document removed" fires anyway) — verified by
restoring the old function and re-running. The `useMutation` suite is new
behavior with no pre-image.

**Test files updated, and why:** 6 files that `vi.mock` `contexts/AppContext`
gained `useOptionalShowToast` (a mock must match the module's surface);
`LeadSiteSurvey.test.tsx` and `BidCompare.test.tsx` now render inside
`AppProviders`, which is where those components live in the app; 6 PcWorkspace
test files' `/documents?linked_id=` mock became `/documents` (the linked_id is
an axios `params` object now); `AddBidModal.test.tsx`'s
`toHaveBeenCalledWith(url)` became `(url, expect.anything())`.

---

### Task 4 — Toasts that tell success from failure — **done**
Commit `4dc2a9f`. Audit ux #3.

- `types/index.ts`: `Toast.variant?: 'success' | 'error' | 'info'`, default
  `success` — what every existing caller meant.
- `components/Toast.tsx`: variant picks the icon and the accent, and sets
  `role="alert"` / `aria-live="assertive"` for errors so a screen reader hears
  it too.
- `components/Icon.tsx`: new `alert` (triangle + exclamation) and `info` glyphs.
- `styles.css`: a `--red-soft` token matching the existing
  `--green-soft`/`--amber-soft` pattern, plus `.toast.t-error` / `.toast.t-info`.
- `hooks/useToast.ts`: an error toast holds 7 s instead of 4.2 s, and showing a
  toast now clears the previous timer. **A latent bug fixed on the way:** the old
  hook never cleared the old timeout, so a second toast inherited the first's
  remaining time and could vanish almost immediately.
- **41** failure toasts across 15 files now carry `variant: 'error'`. Three were
  reclassified `'info'` instead, because the action they report actually
  succeeded: "Sizer uploaded / auto-fill failed", "No amount found", "No sq ft
  found". `useMutation` stamps the variant on the toasts it raises.

The plan said 19 "failed" toasts; the real count is higher because the audit's
grep was `title: '.*[Ff]ail` and missed "Couldn't …" / "Could not …" phrasings.

**Tests:** `components/Toast.test.tsx` (5). All five fail on the pre-change
`Toast`/`useToast`.

---

### Task 5 — Bootstrap that fails loudly, page boundary, 404, titles — **done**
Commit `dd49410`. Audit ux #1, #17, #18; code #2, #17, #19.

1. **`Promise.allSettled` → better.** The three bootstrap reads are already
   independent `useApi` calls (Task 2), which is stronger than `allSettled`:
   each one fails, reports and retries on its own. This commit adds the
   branches. A failed `/dashboard` replaces the shell with
   `components/BootError.tsx` — the normalized message, a Retry that re-runs all
   three, and copy that says the records are not gone. A failed `/users` or
   `/preconstruction/workspaces` keeps the app up behind a dismissible amber bar
   naming exactly what did not load, with its own Retry.
2. **`components/ErrorBoundary.tsx`** gains `variant="page"` ("This page hit an
   error" + Reload page) and a `resetKey`, so navigating away clears it.
   `App.tsx` wraps `renderView()` in one keyed on the pathname. The root
   boundary in `main.tsx` is untouched.
3. **`components/NotFound.tsx`** is the `default` case. **`StubPage` is deleted**
   rather than kept behind an empty `PLANNED_VIEWS` set: every view in the
   switch is shipped, so it had nothing left to represent — which is exactly what
   the plan said to do if none were genuinely planned. `/bid` with no id gets
   the 404 too, instead of "Bid — coming soon".
4. **`hooks/usePageTitle.ts`** sets `"<Page> · APT CRM"` and restores the
   previous title on unmount. `App.tsx` maps all 11 top-level views;
   `BidHubPage`, `CustomerHub` and `ElecProjectsPage`'s project detail pass the
   record name instead.

**Tests:** `src/App.bootstrap.test.tsx` (7). Every one fails on main — there was
no BootError, no warning bar, no page boundary and no NotFound to find.

---

### Task 6 — Expired session handled on restore — **done**
Commit `0597d15`. Audit code #7.

`api/session.ts` gains `isTokenExpired(token, now?)`: decodes the JWT payload
without verifying the signature (the server's job — the client only needs `exp`)
and returns true for a missing, malformed, or `exp`-less token. A token with no
`exp` is treated as expired because the server always sets one, so a token
without it is not one we issued.

`useAuth`'s initializer now clears storage and returns null for an expired,
undecodable **or unparseable** session, and `logout` reuses `clearSession()`.
The unparseable case was a real crash: corrupt `crm_user` JSON threw inside the
`useState` initializer, taking the app down before any boundary could help.

**Plan detail corrected:** the plan says "the `?mscode` path already checks
expiry; share the helper". It does not — batch 1 replaced that branch's
URL-token check with a POST exchange, so there was no existing helper to share.
Written fresh.

**Tests:** `hooks/useAuth.test.ts` grows a "session restore" block (5; file 4 →
9). 3 of the 5 fail on the unfixed initializer; the other two describe behavior
it happened to get right. The existing "falls back to a stored session" case now
stores a valid token alongside the user, because a stored user with no token is
not a session.

---

### Task 7 — Workspace autosave and bounded polling — **done**
Commit `6d14c53`. Audit code #6; data #5, #16.

**Autosave** (`PcWorkspace.tsx`, the `:378-394` region)
- `saveState: 'idle' | 'saving' | 'saved' | 'error'`, rendered as a chip at the
  end of the tab strip ("Saving…" / "Saved" / "Not saved — retrying" in red).
- On failure, retry with backoff 2 s, 4 s, 8 s, 16 s, capped at 30 s, until it
  succeeds or the component unmounts. Each retry sends the **current** payload,
  not the one that failed, so an edit made while a retry was pending is not
  dropped; a fresh edit supersedes the pending retry and resets the backoff.
- A `didMount` ref skips the first effect run, so opening the workspace no
  longer writes a no-op PUT 800 ms later (audit data #16).
- An `aliveRef` stops both the state updates and the retry chain at unmount.

**Polling** (`:411-477`, cleanup `:507-510`)
- A `pollCancelled` ref, set by the effect cleanup and checked after **every**
  `await` before touching state or rescheduling. Clearing the timeout alone —
  which is all the old cleanup did — does nothing for a continuation already
  entered, and that continuation scheduled a fresh timeout nothing owned.
- A 10-minute deadline on both loops. Past it they stop and set a visible state:
  an amber bar under the tab strip ("Analysis timed out — check status in the
  Plan Review tab", or the Agent 4 equivalent) plus a line in the AI log.
  `pollAgent4` takes a `startMs` for this, as `pollForResults` already did.

The component is **not** split (Batch 3). The diff stays inside the autosave and
poll regions plus the two pieces of chrome that render their new state.

**Tests:** `features/preconstruction/PcWorkspaceAutosave.test.tsx` (7). Verified
against the pre-fix code one defect at a time: no-op-PUT-on-open, the error chip
and the 2/4/8 s backoff, and the 10-minute deadline each fail without their fix;
the unmount-mid-flight case fails with the poll cancellation removed. That last
test holds the second `/results` open **across** the unmount on purpose — an
earlier version of it passed against the buggy code because it only left a
pending timeout, which `clearTimeout` already handled.

---

### Task 8 — Unsaved-changes guard — **done** (with one item struck, below)
Commit `9ff0e20`.

- **`contexts/UnsavedGuardContext.tsx`**: screens register a dirty predicate;
  `confirmLeave(proceed)` runs `proceed` when nothing is dirty and otherwise
  raises the app's own dialog. Outside the provider it degrades to "just go", so
  a component rendered in isolation still works.
- **`hooks/useUnsavedGuard.ts`**: registers the predicate plus a `beforeunload`
  handler while dirty.
- **`main.tsx`** mounts the provider above `<App/>`, and `App.tsx` routes its
  `setView` through `confirmLeave`. **This is the complete coverage claim:**
  `useNavigate` is used in exactly one file (`App.tsx`), and `setView` is the
  single primitive behind the sidebar and mobile nav (`AppShell`'s `onNav` *is*
  `setView`), the hub tab switches, global search and notification deep links.
  So `AppShell` itself needed no change.
- **Modals with typed content** (`hooks/useDirtyDismiss.tsx`): the same dialog on
  backdrop click, Escape and close-x — `LogGenJobModal`, the intake add pane,
  Bid Hub edit mode and Customer Hub edit mode (the last two on the edit toggle
  rather than Escape, since they are inline panels, not overlays).
- **Every** guarded screen compares against the last saved snapshot, never a
  keystroke flag. `OverviewTab`'s two byte-identical form literals collapsed
  into one `bidForm(bid)` helper, which is also the dirty-check baseline.
- `ElecProjectsPage.saveSection` was `await api.put(...)` then an unconditional
  "Saved" with no catch — a Task 3 miss, fixed here.

**The product decision is struck, and here is why.** Folding `overheadPct`,
`profitPct` and `estimateOverrides` into the workspace autosave payload cannot
be done inside this batch's ground rules. `bid_workspaces` has no columns for
them (`018_workspace_and_file_storage.sql`, `052_workspace_confirmed_service.sql`)
and `PUT /preconstruction/:bidId/workspace`
(`backend/src/routes/preconstruction.ts:1340-1360`) inserts an explicit column
list, so it needs a migration **plus** a route change — and the ground rules
confine backend changes to Task 9's one route. Sending the fields anyway would
have looked like a fix and stored nothing. The plan's own fallback applies: the
guard covers the Pricing tab, keyed off the saved `bid_estimates` row *and* off
an autosave stuck in `error`. **Jake's call for a follow-up.**

**`AwardKickoffModal` deliberately unchanged.** The plan lists it among the
modals with typed content, but it has zero input/textarea/select elements — its
content is `DocSlot` uploads, each persisted the moment a file is chosen. There
is nothing to discard, so a discard dialog would only be a lie.

**Known limitation (as the plan asked to note):** browser back/forward is a
history event, not a call into `setView`, so it is covered only by
`beforeunload` on a full unload. An in-app back press is not intercepted;
fixing that needs the data router (Batch 3).

**Tests:** `hooks/useUnsavedGuard.test.tsx` (9) and `src/App.unsavedGuard.test.tsx`
(3). The second drives the **real** `BuilderPage` and a **real** sidebar click
through App's `setView`: dirty blocks and then proceeds on confirm, clean goes
straight through, and "Keep editing" leaves the builder and its text untouched.
All 12 fail on main, where there is no guard to invoke.

---

### Task 9 — Client errors are no longer invisible — **done**
Commit `dc65c4b`. Audit code #15.

**`frontend/src/lib/reportError.ts`** — `reportError(err, context)`. Three rules,
in order: never throws, never awaits, rate limited to 10/minute client-side so a
render loop cannot turn one bug into a flood. In dev the console is the sink;
otherwise it POSTs `{ message, stack, context, url, userAgent }` with
`keepalive: true`. Plain `fetch`, not the api client, so it can be called from
inside that client's own failure path without recursing and so it survives the
unload a crash often precedes. A request we cancelled ourselves is not reported.

Under vitest the console branch is skipped (otherwise every deliberately-failing
test prints a stack) and the transport path runs, which is what the tests drive;
with no `crm_token` in storage it returns immediately, so it stays a no-op in
the other 54 test files.

**`backend/src/routes/clientErrors.ts`** (+ its mount in `index.ts` — the only
backend change in this batch) — `POST /api/client-errors`: `requireAuth`,
`express-rate-limit` 60/min keyed **per user** (an office behind one NAT must not
share a bucket), an 8 KB body cap, Zod field limits, and one pino `warn` line
carrying `{ user, context, message, url, userAgent }` plus the first 2 KB of
stack. Nothing is stored — this is log-stream telemetry, and a table would need
retention, indexes and a purge job of its own (the audit already flags six
unbounded tables).

**One deviation worth flagging:** the 8 KB cap is enforced by the route as a 413,
not by a parser limit. `index.ts` applies `express.json()` app-wide at line 73,
before any router, so its 100 KB default has already parsed the body by the time
a route-level parser could run. Getting a true parser-level cap would mean
mounting this router above shared middleware, which is outside the batch.

**Callers wired up:** both `ErrorBoundary` variants, `useApi`, `useMutation`, and
every surviving optional `.catch` (service-worker registration, both push
unsubscribes, the LeadsPage deep-link lookup, PcWorkspace's poll reconnect).

**Tests:** `frontend/src/lib/reportError.test.ts` (9) — the posted shape and
keepalive, never throwing when fetch rejects / is missing / throws synchronously,
silence with no session token, ignoring our own cancellations, the 10/minute
limit, the axios-rejection message matching what the UI shows, and truncation.
`backend/src/test/clientErrors.test.ts` (6) — 401 unauthenticated and on a junk
token, 204 plus exactly one warn line for a good report, 413 over 8 KB, 400 with
no message, and the 2 KB stack cap. All 6 fail with the route unmounted
(verified: they 404).

---

## Verification checklist

Before-numbers are `git grep` against `main`, excluding `*.test.*`; after-numbers
are the same greps on the branch.

| Check | Before | After | Notes |
|---|---:|---:|---|
| `npm test` frontend | 9 failing | **0 failing** | 55 files / 428 tests |
| `npm run typecheck` frontend | clean | **clean** | |
| `npm run typecheck` backend | clean | **clean** | |
| backend suite | 85 files / 775 | **86 files / 781** | +6 = the new `clientErrors` tests; failing set is the plan's known flakes, and this branch touches only 3 backend files |
| `.catch(() => {})` | 35 | **1** | see below |
| `} finally {` with no `catch` in the same try | 30 | **0** | scripted, see below |
| `window.location.href` | 2 | **0** | |
| `let cancelled = false` | 8 | **0** | |
| `api.get` in `*.tsx` | 86 | **29** | 25 inside a `useMutation` fn, 4 exceptions listed below |
| `api.get` anywhere | 91 | **32** | +3 in `*.ts` (listed below) |
| `document.title` set | 0 | **5** | `usePageTitle` + its 4 call sites |
| toasts with `variant: 'error'` | 0 | **41** | plus 3 `'info'` |

### `.catch(() => {})` — 1 remaining, with its reason on the line above

```
src/pages/ProposalPublicPage.tsx:155:  // optional: nothing further to try if the report itself cannot be sent.
src/pages/ProposalPublicPage.tsx:156:  .catch(() => {});
```

This one *is* the failure report (the customer-facing e-sign page telling the
server its archive step failed); if it cannot be delivered there is nothing left
to try, and the customer must not see an error on a signing that actually
worked. A plain `grep '\.catch(() => {})'` also matches one line of prose in
`PcWorkspace.tsx:391` describing the autosave's old behavior — that is a
comment, not code.

Every other formerly-empty catch either went away with its call site or now
calls `reportError` with a context string.

### `} finally {` with no `catch` — 0

Scripted rather than eyeballed: for each `finally` block, walk backwards by
brace depth to its matching `try` and check the body for a `catch`. 30 on main
(across 20 files), 0 on the branch. `} finally {` still appears 45 times — those
all have a `catch`.

### `api.get` — the exceptions, in full

**In `*.tsx` (29 hits):** 25 are inside a `useMutation` `fn` — `OverviewTab`
(runQualify), `LeadDetailDrawer` ×2 (refreshActivity, createGen),
`SiteVisitChecklist` (finalize), `SignedContractCard` (open),
`ElecProjectsPage` ×14 (the 11-way project load, the photo refresh, view,
download), `BidCompare` (the drill-down), `PcWorkspace` ×4 (the docx/xlsx
generators and two document downloads), `RecordFiles` (download).

The remaining **4 are deliberate exceptions**:

| Site | Why |
|---|---|
| `LeadsPage.tsx:142` | A one-shot lookup for a lead that is *not* on the board, keyed by a deep link rather than by render state. Carries an `// optional:` comment. |
| `PcWorkspace.tsx:499` (`pollForResults`) | A recursive-timeout poll whose continuation needs the value *inside* an async callback. `useApi` cannot express that. Task 7 gave it the cancellation ref and the 10-minute deadline, which is the actual defect. |
| `PcWorkspace.tsx:559` (`pollAgent4`) | Same shape, same treatment. |
| `PcWorkspace.tsx:589` | The mount-time reconnect that decides whether either poll should start. Carries an `// optional:` comment and reports through `reportError`. |

**In `*.ts` (3 hits):** `push.ts:71` (`/push/public-key`, fetched inside the
subscribe flow — not a component read) and `useDocPreview.ts:44,60`. The latter
must open the browser tab **synchronously** on the click to dodge popup blockers
and only then fetch, which neither primitive can express; it already has full
error handling and a download fallback. Both files are outside the plan's
`*.tsx` grep, listed here for completeness.

### Every top-level view sets `document.title`

`App.tsx`'s `VIEW_TITLES` covers all 11 (`dashboard`, `generators`,
`electrical`, `sales-by-rep`, `builder`, `contacts`, `calendar`, `followups`,
`comms`, `docs`, `admin`). `bid` is excluded from the map on purpose because
`BidHubPage` sets the record name instead; `CustomerHub` and
`ElecProjectsPage`'s project detail do the same.

### Every navigation point consults the guard

`grep -rn 'navigate(' frontend/src` (non-test) returns **5 hits, all in
`App.tsx`** — `useNavigate` is used nowhere else in the tree:

| Line | Guarded? | Why |
|---|---|---|
| `:90` `setView` | **yes** | The single primitive behind the sidebar, mobile nav, hub tab switches, global search and notification deep links. |
| `:337` `onOpenBid` | **yes** | Leaves the current screen for a bid hub. |
| `:97` `clearParam` | no | A same-view `{ replace: true }` URL cleanup that strips a consumed record id. Nothing is left. |
| `:218` the 401 eject | no | Forced. A guard here would trap the user on a page whose session is already gone. |
| `:229` post-login | no | Nothing to lose — the user just signed in. |

`AppShell.onLogout` is guarded too (it leaves everything).

---

## Tests added

| File | Tests | Task |
|---|---:|---|
| `frontend/src/hooks/useApi.test.ts` | 7 | 2 |
| `frontend/src/api/errors.test.ts` | 8 | 2 |
| `frontend/src/hooks/useMutation.test.tsx` | 7 | 3 |
| `frontend/src/features/docs/DocsPage.delete.test.tsx` | 2 | 3 |
| `frontend/src/components/Toast.test.tsx` | 5 | 4 |
| `frontend/src/App.bootstrap.test.tsx` | 7 | 5 |
| `frontend/src/hooks/useAuth.test.ts` (+5 in an existing file) | 5 | 6 |
| `frontend/src/features/preconstruction/PcWorkspaceAutosave.test.tsx` | 7 | 7 |
| `frontend/src/hooks/useUnsavedGuard.test.tsx` | 9 | 8 |
| `frontend/src/App.unsavedGuard.test.tsx` | 3 | 8 |
| `frontend/src/lib/reportError.test.ts` | 9 | 9 |
| `backend/src/test/clientErrors.test.ts` | 6 | 9 |
| **Total** | **75** | |

Frontend 359 → 428 tests (+69, plus the 6 backend). The arithmetic gap is Task
1: the 9 previously-failing tests are now counted as passing rather than added.

---

## Things found on the way, not fixed

Noted rather than acted on, per the plan's "note it and move on":

1. **`DocsPage.downloadDoc` authenticates with the wrong storage key.**
   `frontend/src/features/docs/DocsPage.tsx:115` reads
   `localStorage.getItem('token')`; the app stores the JWT under `crm_token`
   everywhere else. It sends `Authorization: Bearer null`, so this download has
   presumably been 401ing for as long as it has existed. It is a raw `fetch`,
   not an `api` call, so nothing in this batch touched it. One-word fix, but out
   of scope — worth its own small change with a test.
2. **The workspace autosave payload cannot carry pricing** without a
   `bid_workspaces` migration. See Task 8 above; this is the struck product
   decision and needs Jake's call.
3. **`ElecProjectsPage.loadProject` still caches per project id forever**
   (audit data #16 / code #16 — `if (projData[id]) return`). It is now wrapped
   in a `useMutation` so a wholesale failure is visible, but a colleague's change
   order still stays invisible until a hard refresh. Batch 3 (TTL / focus
   refetch).
4. **`PcWorkspace` is still 2,800 lines.** Explicitly Batch 3; this batch kept
   its diff inside the autosave and poll regions as instructed.

---

## Safety

Every command ran inside `../Electrical-program-wt-audit2`. No file under
`Local Version` was written — it was read only for the plan and the three audit
documents, and once (read-only) to sanity-check the pre-change grep counts,
which were then re-derived authoritatively with `git grep main` from the
worktree. No dev server was started, no Docker state touched, no `DATABASE_URL`
set, no `.env` printed, no push. Backend tests ran only through
`npm test`, which pins `DB_NAME=electrical_crm_test`; the harness's `_test`
suffix allowlist was in force.
