# Audit Batch 4 — Frontend Polish — Execution Report

**Executing:** Sonnet 5, Tasks 1–4 (one session) and Tasks 5–8 (a second
session; Task 9 is separate follow-on work by another engineer per the
plan). One commit per task, worktree `Electrical-program-wt-audit4`, branch
`fix/audit-batch4`.

## Summary (Tasks 1–4)

- Commits: `71fb411` (Task 1), `0959f38` (Task 2), `25eff1e` (Task 3),
  `4381a3f` (Task 4) on `fix/audit-batch4`.
- **Frontend:** `npm run typecheck` — 0 errors. `npm test` — 71 test files,
  520 tests, all passing.
- **Backend:** `npm run typecheck` — 0 errors. `npm test` — 100 test files,
  839 tests, all passing (run against the real `electrical_crm_test` DB;
  migration 100 applies cleanly).
- **Backend diff scope** (`git diff --stat main..HEAD -- backend/`): exactly
  `middleware/auth.ts`, the three restore routes
  (`bids.ts`/`gens.ts`/`documents.ts`), and their test file. **Database diff
  scope**: exactly `database/migrations/100_deleted_by.sql`. Nothing else
  under `backend/` or `database/` changed.
- Task 2.3 decision: implemented the plan's preferred option (migration +
  `canRestore` relaxation), with one caveat found during implementation —
  see Task 2's section.
- Every deviation from the literal plan text is called out inline in its
  task's section below, with the reasoning. The two most load-bearing ones:
  Modal.tsx centralizes `role="dialog"`/`aria-label="Close"` behind
  props/defaults rather than duplicating literal strings 9+ times, so two of
  the plan's literal-text grep counts read low even though the underlying
  accessibility behavior is fully in place and verified by
  `Modal.test.tsx`'s `getByRole` assertions (Task 1); the non-admin
  self-restore path (Task 2) is implemented and tested but not reachable
  through today's UI, since `DELETE` on bids/gens/documents stays
  admin-only, unchanged, per the ground rule limiting backend changes to the
  restore routes only.

## Summary (Tasks 5–8)

- Commits: `3a49eda` (Task 5), `5f9087c` (Task 6), `d2833ad` (Task 7),
  `210b169` (Task 8) on `fix/audit-batch4`, continuing directly from `60951d2`.
- **Frontend:** `npm run typecheck` — 0 errors throughout. `npm test` — grew
  from 71 files / 520 tests (before Task 5) to 76 files / 541 tests (after
  Task 8), all passing at every commit.
- **`!important` in `styles.css`:** 59 → 57 (Task 5; see that section for the
  exact two lines removed and why the count only drops by 2, not 3).
- **Chunk sizes (Task 7):** main JS bundle 1,402.49 kB gzip 407.59 kB →
  1,054.29 kB gzip 326.13 kB, plus 7 new page chunks. Full before/after table
  in Task 7's section.
- **Backend diff scope unchanged**: `git diff --stat main..HEAD -- backend/`
  still touches exactly the same 5 files as after Task 4 (`middleware/auth.ts`,
  the three restore routes, and their test file) — Tasks 5–8 touched nothing
  under `backend/` or `database/`, as required.
- `features/preconstruction/PcWorkspace.tsx` was not touched in Tasks 5–8
  beyond what was already done in Task 3 (Tasks 1–4); Task 7's lazy-loading
  change is a one-line import swap in `App.tsx`/`BuilderPage.tsx`/
  `ElectricalHubPage.tsx`, never inside `PcWorkspace.tsx` itself, per the
  ground rule reserving that file for Task 9.
- The most load-bearing deviations from the literal plan text: Task 5 leaves
  the shared `.stats` grid class's `!important` alone (it's reused by 8 other
  pages not named in the task, so removing it would require touching files
  outside scope); Task 6 finds only 2 of the plan's named "modal forms" (of
  Task 1's nine) actually have a `required` input, and only 1 of the 3 modals
  the audit names for missing `autoFocus` (`GenDetailDrawer`) actually has a
  stable single form field to focus — the other two are pickers with no text
  input at all. Full reasoning in each task's section.

---

## Task 1 — One Modal component with real dialog behavior

**Files:** new `frontend/src/components/Modal.tsx` (+ `Modal.test.tsx`), the nine
overlay/drawer components (`AddBidModal`, `LeadDetailDrawer`, `GenDetailDrawer`,
`AwardKickoffModal`, `SignedContractCard`, `CalendarEventPickerModal`,
`LogGenJobModal`, `SurveyFromCalendarModal`, `LeadSiteSurvey`), plus
`frontend/src/features/bid-hub/BidHubPage.tsx`, `frontend/src/components/FilePreviewModal.tsx`,
`frontend/src/components/ProfileModal.tsx` (close-x accessible names only — not migrated
to Modal, out of the nine), and a one-line accessibility fix in
`frontend/src/contexts/UnsavedGuardContext.tsx`.

### What changed

- `Modal({ open, onClose, title?, labelledBy?, isDirty?, variant, role, children })`
  owns: `role="dialog"` (or `"alertdialog"`), `aria-modal="true"`,
  `aria-labelledby` (auto-generated from `title`, or the caller's own id via
  `labelledBy` for a custom header), a Tab/Shift-Tab focus trap, focus moved
  into the dialog on open (deferring to a child's own `autoFocus` if present)
  and restored to the opener on close, Escape-to-close, and backdrop-click-to-
  close. `children` can be a plain node or a render-prop
  `({ requestClose, titleId }) => ReactNode` — the render-prop form is used by
  every component whose Cancel/close-x button needs to route through the same
  dirty check as Escape/backdrop.
- **Dirty routing:** `isDirty` (default `false`) makes Escape/backdrop open a
  "Discard your changes?" prompt instead of closing immediately. Rather than a
  new dialog, Modal reuses Batch 2's `ConfirmLeaveDialog`
  (`contexts/UnsavedGuardContext.tsx`) for that prompt — same copy, same
  component, one visual implementation for both "leave the screen" and "close
  this dialog" with unsaved work.
- **Modal stacking:** a module-level stack tracks which open `Modal` instances
  exist; only the topmost reacts to Escape/Tab-trap. Needed because several of
  the nine open a second Modal on top of themselves (LeadDetailDrawer → site
  survey, GenDetailDrawer → kickoff modal, SignedContractCard → countersign
  confirm) — without this, one Escape press would fire both instances' keydown
  handlers.
- Migrated all nine components. Each kept its existing header/body/footer
  markup; only the outer `.overlay`/`.drawer-overlay` + `.overlay`/`.drawer`
  pair was replaced by `<Modal>`. The mobile bottom-sheet CSS still applies —
  the class names (`overlay`, `modal`, `drawer-overlay`, `drawer`, `modal-hdr`,
  `drawer-hdr`, `modal-body`, `modal-foot`) are unchanged, just now emitted by
  Modal instead of by each component.
  - **`isDirty` wiring**, decided per component based on what it already
    tracked (no new dirty-tracking state was invented for this task):
    - `LogGenJobModal`: `isDirty = JSON.stringify(f) !== JSON.stringify(BLANK) || !commissionPaid` — already existed (was wired through `useDirtyDismiss`, now through `Modal`).
    - `LeadDetailDrawer`: `isDirty={hasChanges}` — reused the drawer's existing dirty-field tracking for its Save bar. This is a small *improvement*: closing the drawer with an unsaved field edit now asks first, where before it silently discarded.
    - The other 7 (`AddBidModal`, `AwardKickoffModal`, `CalendarEventPickerModal`, `SurveyFromCalendarModal`, `GenDetailDrawer`, `SignedContractCard`'s confirm, `LeadSiteSurvey`) pass no `isDirty` (defaults to `false`). None of these regress: AddBidModal/AwardKickoffModal/CalendarEventPickerModal/SurveyFromCalendarModal already let a backdrop click discard silently before this batch, so uniform Escape behavior is consistent, not a new risk. `LeadSiteSurvey` deliberately does **not** use the dirty-guard: it autosaves on close (best-effort) rather than discarding, so `isDirty=false` (default) means Escape/backdrop call its own `handleClose`, preserving that autosave-then-close/error-surface behavior exactly.
- Every `close-x` button across the app now has `aria-label="Close"` (BidHubPage's reused `.close-x`-styled button is a *back* affordance, not a close — labeled `aria-label="Back to Bids"` instead, which is the semantically correct fix for the same underlying accessibility gap).
- `ConfirmLeaveDialog` (`contexts/UnsavedGuardContext.tsx`): `role="dialog"` → `role="alertdialog"`. A yes/no "discard?" prompt is an alert dialog per the ARIA taxonomy, not a general dialog — and it removes the only other `role="dialog"` in the tree besides `Modal.tsx`, since `Modal` now also renders the "discard changes" prompt via this same component.

### Tests

`frontend/src/components/Modal.test.tsx` (12 tests): dialog semantics
(role/aria-modal/aria-labelledby), close button accessible name, Escape
closes (not dirty), backdrop click closes, click starting inside the box does
not close, Tab-trap wrapping both directions, focus-into-dialog on open
(deferring to a child's own `autoFocus`) and focus-restore-to-opener on
close, dirty-content Escape opens the discard guard instead of closing,
dirty-content backdrop click + "Leave without saving" closes, modal stacking
(only the topmost of two simultaneously-open Modals reacts to Escape),
renders nothing when closed.

All pre-existing suites that exercise the nine migrated components
(`AddBidModal.test.tsx`, `SurveyFromCalendarModal.test.tsx`,
`LeadSiteSurvey.test.tsx`, `BidHubPage.test.tsx`, `ElecProjectsSaveSection.test.tsx`,
etc.) pass unmodified.

### Verification / grep checks (before → after)

- `grep -rn "window.confirm" frontend/src` — unchanged this task (Task 2): 11.
- `grep -rn "role=\"dialog\"" frontend/src` — before: 1 (`ConfirmLeaveDialog`, hand-rolled)
  + 0 real dialogs (none of the 9 had dialog semantics). After: the real DOM
  role rendered by every Modal-based dialog is `"dialog"` (verified at runtime
  by `Modal.test.tsx`'s `getByRole('dialog')`), but **the literal source string
  `role="dialog"` does not appear 11+ times** — `Modal.tsx` renders it via a
  `role` prop (`role={role}`, default `'dialog'`) rather than a repeated
  literal, by design (that's the whole point of "one Modal component"). A
  plain `grep -rn 'role="dialog"'` therefore under-counts; the correct check
  is "every one of the nine renders a dialog with `getByRole('dialog')`
  reachable", which the test suite verifies. One **pre-existing**, out-of-scope
  `role="dialog"` remains in `features/command-center/BriefDrawer.tsx` — not
  one of the plan's nine, not touched.
- `grep -rn "aria-label=\"Close\"" frontend/src` → **6** literal occurrences
  (`BriefDrawer.tsx` pre-existing, `LeadDetailDrawer.tsx`, `LeadSiteSurvey.tsx`,
  `GenDetailDrawer.tsx` — these three render their own custom header so their
  close-x is hand-written — plus `FilePreviewModal.tsx`, `ProfileModal.tsx`).
  This is **below the plan's "≥ 11" target** for the same reason as above: the
  other 6 close-x buttons (AddBidModal, LogGenJobModal, CalendarEventPickerModal,
  AwardKickoffModal, SurveyFromCalendarModal, SignedContractCard's confirm) go
  through Modal's own default header, which renders `aria-label={closeLabel}`
  (`closeLabel` defaulting to the string `'Close'`) rather than a literal
  attribute per call site. Every close button in the app **is** reachable via
  `getByRole('button', { name: 'Close' })` (asserted in `Modal.test.tsx`) — the
  literal-text grep just isn't the right instrument once the implementation is
  centralized instead of duplicated 9 times. Flagging this explicitly rather
  than gaming the grep (e.g. re-duplicating the literal string per call site,
  which would undo the point of Task 1).
- `grep -rn "role=\"dialog\"" frontend/src` — see above.

### Deviations from the plan (Task 1)

1. Two of the plan's literal-text grep checks (`role="dialog"` count,
   `aria-label="Close"` count) don't hold as literal counts once Modal
   centralizes both behind props/defaults instead of duplicating them per
   call site. The underlying accessibility requirement is met (verified via
   `getByRole` in tests, not text search). See above.
2. `LeadDetailDrawer` gained a *new* dirty-guard on Escape/backdrop (reusing
   its existing `hasChanges` state) that it did not have before. This is a
   strict improvement (previously: silent data loss), not a copy/behavior
   change the plan called out — flagging since "no visual redesign" was the
   rule; this is a behavior change, not a visual one, and squarely what audit
   finding #14 asked for.
3. Added a small modal-stacking mechanism (not explicitly in the plan) because
   migrating all 9 to real Escape/focus-trap semantics surfaces a real bug
   when one of them opens a second one on top of itself — untested before
   because none of them had Escape handling at all.

---

## Task 2 — Confirm dialog and Undo on deletes

**Files:** new `frontend/src/components/ConfirmDialog.tsx` (+
`ConfirmDialog.test.tsx`), the 11 `window.confirm` sites, `backend/src/routes/{bids,gens,documents}.ts`
restore routes, `backend/src/middleware/auth.ts` (new `canRestore` helper),
new migration `database/migrations/100_deleted_by.sql`, new
`backend/src/test/restorePermission.test.ts`.

### What changed

- `ConfirmDialog` is built on Task 1's `Modal` (`role="alertdialog"`,
  `isDirty` always `false` — a confirmation is never itself "dirty content").
  `useConfirm()` + `<ConfirmProvider>` (mounted once in `main.tsx`, alongside
  `UnsavedGuardProvider`) give every component a promise-based
  `confirm({ title, body?, confirmLabel?, destructive? }) => Promise<boolean>`,
  the same shape `window.confirm` had. Outside a provider (an isolated
  component test that never touches this) `useConfirm()` resolves to `false`
  instead of throwing — the same "nothing happens" result `window.confirm`
  gives in a test environment by default — so no unrelated existing test
  needed a provider added just because the component under test now imports
  `useConfirm`.
- All 11 `window.confirm(...)` sites replaced 1:1, copy unchanged per the
  plan (`GenProjectsPage`, `TrashSection`, `NotificationsSection`,
  `OverviewTab` ×2, `LeadDetailDrawer` ×2, `GenPipelinePage`, `GenDetailDrawer`,
  `ElecProjectsPage`, `PcWorkspace`).
- **Undo**, wired at the 4 sites that delete a bid or gen (the plan's
  soft-deleted/restorable entities) directly from a list/detail view —
  `GenProjectsPage.deleteProject`, `OverviewTab.handleDelete` (bid),
  `GenPipelinePage.handleDelete` (gen), `ElecProjectsPage.deleteProject`
  (bid). Each success toast now carries `action: { label: 'Undo', onClick }`
  that POSTs the restore route and re-inserts the returned row into the
  page's own list state. The other 7 confirm sites don't get Undo because
  they aren't a bid/gen/document soft-delete: `TrashSection`'s confirm is a
  **purge** (already-in-Trash, permanent — nothing to undo), `LeadDetailDrawer`'s
  lead delete has no restore route (leads are hard-deleted), `NotificationsSection`
  sends an email, the two `handleCloseJob`s move a stage, and `PcWorkspace.rerunAI`
  resets in-memory state rather than deleting a record.
- **Backend — Task 2.3 decision:** implemented the plan's preferred option.
  Migration 100 adds `deleted_by UUID REFERENCES users(id)` to `bids`,
  `generator_proposals`, and `documents` (none of the three already tracked
  a deleter on the row itself). The three `DELETE .../:id` routes now also
  set `deleted_by = req.user.id` alongside `deleted_at = now()`. The three
  `POST .../:id/restore` routes dropped `requireAdmin` for a new
  `middleware/auth.ts` helper, `canRestore(user, row)`: true if the user is
  privileged (owner/administrator/manager, unchanged), OR if
  `row.deleted_by === user.id` and the delete happened within the last 10
  minutes (`RESTORE_WINDOW_MS`). Restoring also clears `deleted_by` back to
  `NULL`.
  - **Caveat found while implementing:** all three `DELETE .../:id` routes
    were *already* `requireAdmin`-only before this batch, and that did not
    change (per the ground rule, backend changes are limited to the restore
    routes + migration). So today, the "deleter" of a bid/gen/document is
    always an admin already, who could already restore it anytime — the
    non-admin branch of `canRestore` is not reachable through the app's
    current UI. It's still implemented (not "too wide": it only ever grants
    restore of a row to the specific person who deleted it, for 10 minutes,
    which is safe even if delete permissions are loosened later) and is
    exercised directly in `restorePermission.test.ts` by writing
    `deleted_at`/`deleted_by` the same way the DELETE route does, rather than
    by making a non-admin `DELETE` call (which 403s, as before). Flagging
    this explicitly since it means the "non-admin self-Undo" half of the
    feature is currently latent/forward-compatible rather than live for any
    real user today — the admin-Undo half (an admin deletes something, gets
    Undo in the toast, restore succeeds via the `isPrivileged` branch) is
    fully live and tested.

### Tests

- `frontend/src/components/ConfirmDialog.test.tsx` (4 tests): Cancel resolves
  `false` and closes without side effects, the destructive confirm button
  resolves `true`, Escape cancels, and `useConfirm()` outside a provider
  resolves `false` instead of throwing.
- `frontend/src/features/bid-hub/BidHubPage.test.tsx` gained a "Delete Bid —
  confirm dialog and Undo" describe block (2 tests): Cancel on the
  `ConfirmDialog` leaves the bid in place and calls no API; confirming
  deletes it (asserted against the mocked `api.delete` call) and clicking
  the toast's "Undo" calls the restore route and the bid's name reappears in
  the DOM. (This required promoting the file's `useShowToast`/
  `useOptionalShowToast` mocks from plain no-op arrow functions to `vi.fn()`s
  so this one describe block could override them with a real, state-backed
  toast notifier — every other test in the file is unaffected since the
  default mock implementation is unchanged.)
- `backend/src/test/restorePermission.test.ts` (9 tests, run against the real
  `electrical_crm_test` DB): for bids — the deleter can restore within the
  window (non-admin), a different non-admin is refused (403), the same user
  is refused once past the 10-minute window, and an admin can always restore
  regardless of who deleted it or how long ago; for gens and documents — the
  deleter can restore within the window, and a different non-admin is
  refused; plus documents' restore 404s on a row that isn't in the Trash.

### Verification / grep checks (before → after)

- `grep -rn "window.confirm" frontend/src` → **0** real call sites (11 → 0;
  the only remaining hits are 3 lines of doc-comment prose in
  `ConfirmDialog.tsx` explaining what it replaces).
- `grep -rn "confirm(" frontend/src --include='*.tsx'` → every real call is
  `confirm({ ... })` via `useConfirm()`, or the `ConfirmDialog`/`ConfirmProvider`
  definitions themselves.
- `git diff --stat main..HEAD -- backend/` (through Task 2) touches only
  `middleware/auth.ts` and the three restore routes; `database/` gained only
  migration 100.

### Deviations from the plan (Task 2)

1. Undo is wired at the 4 sites that are genuinely a bid/gen soft-delete from
   a list/detail screen, not all 11 — see "What changed" above for why the
   other 7 don't apply. This matches the plan's own scoping ("Undo: for
   deletes of bids, gens, and documents") rather than expanding it to
   close-job/mark-lost/send-email/purge/rerun actions.
2. No document-delete call site among the 11 `window.confirm` sites is a
   simple list-row delete with local state to re-insert into (documents are
   deleted from `DocsPage`/`RecordFiles`, neither of which uses
   `window.confirm` — they already use `.catch(() => {})` swallowing, audit
   ux #2, out of scope here), so there is no frontend Undo wiring for
   documents in this batch. The **backend** restore-permission relaxation and
   its tests do cover documents (`restorePermission.test.ts`), so a document
   row soft-deleted by any path can still be undone by hitting the restore
   route directly (e.g. from Settings → Trash, which already has its own
   Restore button, unaffected by this task).
3. See the Task 2.3 caveat above: the non-admin-deleter-can-self-restore path
   is implemented and tested but not reachable through today's UI, since
   `DELETE` on all three entities remains admin-only (unchanged, out of this
   task's scope).

---

## Task 3 — Badge component and status tokens

**Files:** new `frontend/src/components/Badge.tsx` (+ `Badge.test.tsx`),
`frontend/src/styles.css`, `PcWorkspace.tsx`, `LeadsPage.tsx`,
`LeadDetailDrawer.tsx`, `EmailSection.tsx`, `NotificationsSection.tsx`, and
(deviation — see below) `AIPermissionsSection.tsx`, `AddLeadModal.tsx`,
`SiteVisitModal.tsx`, `ProposalActionBar.tsx`.

### What changed

- `Badge({ tone, size?, color?, children })` renders the app's existing
  `.badge` class plus a tone modifier that maps onto the classes already
  defined in `styles.css` (`won`/`lost`/`urgent`/`normal`/`critical`), so no
  parallel color system was introduced: `neutral→lost`, `info→normal`,
  `good→won`, `warn→urgent`, `bad→critical`. `size="sm"` is a new, smaller
  modifier class (`.badge.sm`) for inline-pill contexts (a stage dot, an
  email chip) that were previously tighter than the board-card default. A
  `color` prop lets a per-item accent (a lead stage's own hex, distinct from
  any of the 5 fixed tones) still go through the same shape/size/font as
  everything else, deriving its background/border by adding alpha to the
  given color rather than picking a tone.
- Replaced the inline pill implementations: `LeadsPage.tsx`'s stage pill (2
  identical copies — desktop table row and mobile card) now uses
  `<Badge color={si?.color}>`; its source-label pill uses
  `<Badge tone="neutral">`. `LeadDetailDrawer.tsx`'s `OVERDUE` marker is
  `<Badge tone="warn">`. The three identical "removable email chip"
  implementations (`EmailSection.tsx` ×2, `NotificationsSection.tsx` ×1) are
  `<Badge tone="info">` wrapping the email text and its own × button.
- **`PcWorkspace.tsx`** (Task 3.3): all 19 hardcoded `#EF4444`/`#F59E0B`/`#10B981`
  replaced with `var(--red)`/`var(--amber)`/`var(--green)` (and the `-soft`
  variant for the 2 sites using the color as a background fill). No other
  change to that file, per the plan.

### Tests

- `frontend/src/components/Badge.test.tsx` (7 tests): default tone renders
  `.badge.lost`; each of `info`/`good`/`warn`/`bad` renders its mapped class;
  `size="sm"` adds the compact modifier; a `color` override renders inline
  styles instead of any tone class.
- `frontend/src/features/statusColorTokens.test.ts` (3 tests) — the plan's
  grep check as a real, permanent test (mirroring the existing pattern in
  `components/toastVariants.test.ts`): scans every `.ts`/`.tsx` under
  `features/` for `#EF4444`/`#F59E0B`/`#10B981` (case-insensitively) and
  fails with a file:line report if any remain, plus a self-check that the
  scanner itself still matches a known-bad line, and a sanity floor on how
  many files it walked (so a broken path can't make the check pass
  vacuously).

### Verification / grep checks (before → after)

- `grep -rnE "#EF4444|#F59E0B|#10B981" frontend/src/features` → **19 → 0**
  (matches the plan's count exactly for the case-sensitive form).
- Running the same grep **case-insensitively**, before this task, actually
  found **20**, not 19 — one more in `gen-pipeline/ProposalActionBar.tsx`
  (`var(--red, #ef4444)`, lowercase, on the "Delete proposal" menu item),
  missed by a case-sensitive scan. Fixed it too, and the new
  `statusColorTokens.test.ts` scans case-insensitively so this class of miss
  can't recur silently.

### Deviations from the plan (Task 3)

1. **Fixed 3 additional files' hardcoded hex beyond `PcWorkspace.tsx`**:
   `AIPermissionsSection.tsx` (3 sites: a toggle's off-state red, a suspend
   toggle's on-state red, an AI-usage progress bar's red/amber thresholds),
   `AddLeadModal.tsx` and `SiteVisitModal.tsx` (one `var(--amber, #F59E0B)`
   dead-code fallback each — `--amber` is always defined, so the literal hex
   never actually rendered, but it still matched the grep). The plan's
   Task 3.3 bullet names only `PcWorkspace.tsx`, but its own verification
   checklist greps all of `frontend/src/features`, which these four files
   are also under — fixing only `PcWorkspace.tsx` would have left the
   checklist's own grep failing. Each of the other three got the minimal
   swap only (hex → the equivalent `var(--token)`); no other changes.
2. **`SendBidProposalModal.tsx`, named in the plan's Task 3 file list, has no
   badge/pill/chip markup to replace** — it's a plain send-draft modal (form
   fields, two checkboxes, an error banner, Cancel/Create-draft buttons).
   Nothing in it matches the "inline pill implementation" pattern the audit
   describes, and no reasonable reading of the file turns any of its
   elements into a `Badge`. Left untouched; noting this in case the planner
   intended a different file (`bid-hub/SimilarBidsPanel.tsx` and
   `preconstruction/BidCompare.tsx` both already use a shared
   `` `badge ${cls}` `` helper and could be later candidates for `Badge` if a
   future batch wants to fully consolidate the tone-class helpers each of
   them hand-rolls internally — out of scope here since neither was named).
3. **`LeadsPage.tsx` lines 276 and 487 (from the audit's original 5-site
   list) were intentionally left as-is.** Both are interactive filter/toggle
   *buttons* (contact-method filter, stage filter with a count chip) that
   happen to share the same `borderRadius: 20` pill shape as the three true
   status pills at (then-)lines 369/442/451 — but they have hover/active
   click semantics a `<Badge>` (a plain, non-interactive `<span>`) shouldn't
   carry. Converting them would either strip their interactivity or turn
   `Badge` into something it isn't. The 3 genuine status/label pills in that
   file were converted; these 2 controls were not.

---

## Task 4 — One date formatter, one size formatter, money everywhere

**Files:** new `frontend/src/lib/date.ts` (+ `date.test.ts`), new
`frontend/src/lib/format.ts` (+ `format.test.ts`), `frontend/src/lib/money.ts`
(+ new `money.test.ts`), and every file that defined a local `fmtDate` (8),
`dayOf` (4), or `fmtSize` (5): `LeadsPage.tsx`, `CustomerHub.tsx`,
`DocsPage.tsx`, `ElecProjectsPage.tsx` (2 definitions), `GenOverviewTab.tsx`,
`ElecOverviewTab.tsx`, `HomeKpis.tsx`, `RecordFiles.tsx`; the 3 identical
builder `fmt` definitions (`proposalChrome.tsx`, `BuilderPage.tsx`,
`EvBuilderPage.tsx`, plus `proposalChrome.tsx`'s `fmtDec`); `BidCompare.tsx`
and `PcWorkspace.tsx`'s money sites; and (deviation — see below)
`ProposalPreview.tsx` (one rename).

### What changed

- **`lib/date.ts`**: `dayOf(iso)` parses a bare `'YYYY-MM-DD'` (≤10 chars) as
  local midnight (avoiding the classic `new Date('2026-09-10')`-is-UTC
  off-by-one-day bug) and a full timestamp as the real instant — this exact
  dual behavior already existed, spelled differently, across the 8 old
  `fmtDate`/`dayOf` pairs (some sliced unconditionally to 10 chars — safe
  only because they only ever received plain `DATE` columns; others parsed
  the full string directly — required for real `TIMESTAMPTZ` columns).
  Unifying behind a single length check preserves both. `fmtDate(iso, { year
  })` supports `'auto'` (new — year shown only when it differs from the
  current year), `'always'`, and `'never'`. `fmtDateTime(iso)` covers the one
  "+ time" case (`RecordFiles`/`CustomerHub`-style timelines don't use it,
  but it's available for anything that does going forward).
- **`lib/format.ts`**: `fmtSize(bytes)`, the same B/KB/MB thresholds all 5
  duplicates already agreed on.
- **`lib/money.ts`**: added `moneyPrecise` (cents only when present — the
  builders' `fmt`) and `moneyDec` (always 2 decimals — the printed
  proposal's `fmtDec`), both via `Intl.NumberFormat` so they inherit the
  currency-setting awareness the rest of `money.ts` already has, and get
  "-$200.00" (not "$-200.00") sign placement for free.
- **Every local definition replaced by an import**, each call site given the
  `year` mode matching its *existing* rendered output (no visual change):
  `'never'` for `LeadsPage`/`GenOverviewTab`/`ElecOverviewTab` (which never
  showed a year); `'always'` for `CustomerHub`/`DocsPage`/`ElecProjectsPage`/`RecordFiles`
  (which always did). `ElecProjectsPage.tsx`'s two local `fmtSize`s (a
  Drive-photo one prefixing `' · '`, a documents-table one) both now call the
  shared `fmtSize`, with the `' · '` prefix logic kept as a 2-line wrapper
  (`driveSizeLabel`) so it isn't itself named `fmtSize`/`fmtDate` (which
  would re-trip the "no local redefinition" check).
- **`proposalChrome.tsx`**'s `fmt`/`fmtDec` are now `export const fmt =
  moneyPrecise` / `export const fmtDec = moneyDec` — re-exported under their
  original names rather than changing them, since `ProposalPreview.tsx` and
  `EvProposalPreview.tsx` import `fmt`/`fmtDec` from this module several
  dozen times each between them. `BuilderPage.tsx`/`EvBuilderPage.tsx`'s
  local `fmt` became `import { moneyPrecise as fmt } from '../../lib/money'`.
- **`BidCompare.tsx`**: the genuine dollar values that were hand-formatted
  (`Avg labor rate` $/hr, three `$/SF` median tiles, one `$/SF` per-job
  column, one Cost-Drivers `$/SF` inline figure) now go through `moneyDec`.
  Left alone, per the plan ("percentages keep `toFixed`"): labor/journeyman/apprentice
  hours, crew size, labor risk ratio, item counts, and every `/1k SF`
  normalized metric — none of those are dollar values.
- **`PcWorkspace.tsx`**: one remaining hand-formatted `$/sf` metric (project
  history table) now uses `moneyFull`. Everything else that looked like a
  money site on inspection was not one of the plan's two named categories:
  a hardcoded-hex hand-format precedent list turned out to already use
  `moneyFull` (12 call sites, untouched); an inline file-size formatter
  (`f.size > 1024*1024 ? ... : ...`) is a size, not money, and out of Task
  4.3's explicit "money sites" scope for this file. See the deviation below
  for the two sites left alone on purpose.

### Tests

- `frontend/src/lib/date.test.ts` (9 tests): `dayOf` parses a bare date as
  local midnight and a full timestamp as the real instant (not just its date
  digits); `fmtDate` returns `''` for a missing value and correctly applies
  `'never'`/`'always'`/`'auto'` (both branches of `'auto'`, using
  `vi.useFakeTimers()` to pin "today"); `fmtDateTime` returns `''` for a
  missing value and includes both a date and a time.
- `frontend/src/lib/format.test.ts` (4 tests): falsy → `''`, and the B/KB/MB
  thresholds.
- `frontend/src/lib/money.test.ts` (8 tests): `moneyPrecise` omits/keeps
  cents correctly, puts the sign outside the symbol, and respects a changed
  currency; `moneyDec` always shows 2 decimals and the correct sign
  placement; a smoke check that `moneyFull`/`moneyShort` are unaffected.
- `frontend/src/features/dateFormatterDuplication.test.ts` (3 tests) — the
  plan's grep check as a real, permanent test (same pattern as
  `statusColorTokens.test.ts`): scans every `.ts`/`.tsx` under `features/`
  for a local `function`/`const` definition of `fmtDate`, `fmtSize`, or
  `dayOf` and fails with a file:line report if any remain, a self-check of
  the scanner (including that it does *not* flag `fmtCalendarDateLong` or a
  plain import/call), and a sanity floor on files scanned.
- Existing suites exercising the changed files (`BidCompare.test.tsx`,
  `builder/genCalc.test.ts`/`evCalc.test.ts`, `AddBidModal.test.tsx`, every
  `PcWorkspace*.test.tsx`) all pass unmodified — output format is unchanged
  for every value asserted in those tests.

### Verification / grep checks (before → after)

- `grep -rnE "function (fmtDate|fmtSize|dayOf)|const (fmtDate|fmtSize|dayOf) =" frontend/src/features`
  → **17 → 0** (8 `fmtDate` + 4 `dayOf` + 5 `fmtSize` = 17 local definitions
  found and removed; the plan's own count was "16," undercounting by one —
  `CustomerHub.tsx`'s `fmtDate`/`fmtSize` pair wasn't in the audit's
  originally-named file list but matched the same pattern and is fixed too).
- Same grep, run against all of `frontend/src` (not just `features/`) → 0.

### Deviations from the plan (Task 4)

1. **Renamed `proposalChrome.tsx`'s `fmtDateLocal` → `fmtCalendarDateLong`**
   (and its one call site in `ProposalPreview.tsx`). It is a genuinely
   different formatter (long month name, for a printed contract's promo-date
   range) that the plan didn't ask to consolidate — but its old name matched
   the checklist's grep pattern as a *substring* (`function fmtDate` is a
   prefix of `function fmtDateLocal`), so it would have shown up as a false
   positive in the "0 remaining" check. Renaming was simpler and safer than
   trying to make the grep pattern smarter.
2. **Two AI-cost-per-request table cells in `PcWorkspace.tsx` (an AI
   Settings/usage panel) were deliberately left as raw `` `$${x.toFixed(4)}` ``**,
   not moved to `moneyDec`/`moneyPrecise`. Those values are fractions of a
   cent (e.g. $0.0023 for one Claude API call) and both shared helpers cap at
   2 decimal places — routing them through either would round every row to
   "$0.00", destroying the one thing that table exists to show. This is
   internal AI-spend accounting, not a customer-facing or currency-setting-sensitive
   dollar amount, so leaving it as a raw 4-decimal format is the correct call,
   not an oversight.
3. **`ElecProjectsPage.tsx`'s second `fmtSize` (bytes-based, documents table)
   changes an edge-case output**: the old inline version
   (`b >= 1048576 ? MB : Math.round(b/1024)+' KB'`) had no "show bytes" case
   at all — a file under 1KB rendered "0 KB". The shared `fmtSize` correctly
   shows "512 B" instead. Effectively unobservable in practice (document
   uploads are never sub-1KB), but flagging the exact behavior change for
   completeness.
4. Also fixed one adjacent raw date-format call in the same
   `ElecProjectsPage.tsx` documents table (`new Date(doc.created_at).toLocaleDateString(...)`,
   sitting directly next to the `fmtSize` call being replaced) to use the
   shared `fmtDate` too — it wasn't a named `fmtDate` function so it didn't
   violate the grep check, but leaving a hand-rolled date format one line
   away from the fix would have defeated the point.

---

## Task 5 — Grey tokens and the mobile `!important` trap

**Files:** `frontend/src/styles.css`, `frontend/src/features/builder/BuilderPage.tsx`,
`frontend/src/features/builder/EvBuilderPage.tsx` (deviation — see below),
`frontend/src/features/elec-projects/ElecProjectsPage.tsx`.

### What changed

- **Token alias:** `--muted` and `--slate` now read `var(--text3)` in `:root`
  (previously their own close-but-different hex values, `#6E7C95` and
  `#7C8AA3`). A header comment in `styles.css` names `--text2`/`--text3` as
  the two canonical grey tokens and says to prefer `--text3` in new code. The
  ~30 existing call sites using `var(--muted)`/`var(--slate)` are unchanged
  text and keep working, now resolving to the same color as `--text3` — a
  small, deliberate, plan-mandated visual convergence (audit ux #10), not a
  redesign.
- **Grid literals moved out of inline styles into CSS classes**, so the
  existing 768px mobile override can win the cascade by source order instead
  of `!important` beating an inline style:
  - `.builder-layout` (`1fr 300px`), `.builder-field-grid` (`1fr 1fr`),
    `.builder-statezip-grid` (`80px 1fr`) — new base rules in `styles.css`;
    the matching `gridTemplateColumns` keys were deleted from the inline
    `style={{...}}` objects in `BuilderPage.tsx` (3 sites) wherever those
    classes are used.
  - `ElecProjectsPage.tsx`'s `.ws-form-grid` is reused across 9 differently-shaped
    rows (New CO / Pay App / RFI / Key Material / Field Note, financials,
    etc.), each with its own column template, so a single base rule can't
    carry all of them. Seven new modifier classes (`.ws-grid-2`, `.ws-grid-3`,
    `.ws-grid-4`, `.ws-grid-a` through `.ws-grid-d`) each carry one distinct
    desktop template; the matching `gridTemplateColumns` inline key was
    removed at each of the 9 sites and the modifier class added to
    `className` alongside `ws-form-grid` (kept as a marker class, now
    carrying no layout of its own — `display`/`gap`/etc. stay inline per
    site, unchanged).
  - The mobile 768px block's `.builder-field-grid, .builder-statezip-grid`
    and `.ws-form-grid` rules had their `!important` removed (now plain
    single-class rules, same specificity as the new base rules, winning on
    source order — the same pattern `.field-row` already used elsewhere in
    the file). `.builder-layout`'s mobile rule keeps `padding: 12px
    !important` (that property is still set inline and wasn't part of this
    task) but its `grid-template-columns` declaration lost `!important`.
- **Not moved**: the Job Type toggle in `BuilderPage.tsx` (`gridTemplateColumns:
  '1fr 1fr'`, no `className`, not covered by any mobile override — out of
  scope) and `ElecProjectsPage.tsx`'s `.stats` grid (see deviation below).

### Tests

None added beyond the existing suite, per the plan (Task 5.3: "none required
beyond the suite"). All 71 pre-existing test files/520 tests continued to
pass unmodified; `npm run typecheck` stayed at 0 errors.

### Verification (before → after)

- `grep -c "!important" frontend/src/styles.css` → **59 → 57**. Only 2, not
  3, because `.builder-layout`'s mobile rule keeps one `!important` on
  `padding` (untouched, different property, its inline `padding` was not
  moved into a class since only `gridTemplateColumns` was in scope).
- `grep -n "gridTemplateColumns" frontend/src/features/builder/BuilderPage.tsx
  frontend/src/features/elec-projects/ElecProjectsPage.tsx` → only the two
  out-of-scope sites remain (Job Type toggle, `.stats`).

### Deviations from the plan (Task 5)

1. **`EvBuilderPage.tsx`, not named in the plan's file list, was also
   updated.** It reuses the exact same `.builder-layout`/`.builder-field-grid`
   classes with the identical literal values (`1fr 300px` / `1fr 1fr`) as
   `BuilderPage.tsx`. Removing `!important` from those classes' mobile rules
   without also removing `EvBuilderPage.tsx`'s matching inline
   `gridTemplateColumns` would have silently broken its own mobile layout
   (its inline style would again beat the now-non-`!important` mobile rule).
   Since the values are identical, this is a same-behavior fix, not a
   judgment call about new layout.
2. **`ElecProjectsPage.tsx`'s `.stats` grid (line 274) was deliberately left
   alone**, including its `!important` in the mobile block. Unlike
   `.ws-form-grid`, the `.stats` class is shared by 8 other pages
   (`OverviewTab`, `SalesByRepPage`, `FollowupsPage`, `ContactsPage`,
   `CustomerHub`, `CommsPage`, `DocsPage`, `PcWorkspace`), each setting its
   own inline `gridTemplateColumns` (`repeat(3,1fr)` through `repeat(5,1fr)`).
   The mobile `.stats` rules apply to all of them, not just
   `ElecProjectsPage.tsx`; converting only `ElecProjectsPage.tsx`'s site to a
   class and removing `!important` from the shared mobile rule would break
   mobile layout on the other 8 pages, none of which the plan named for this
   task. Left as-is rather than expanding scope to 8 more files.
3. `.ws-form-grid`'s 7 distinct column templates could not become one base
   rule (unlike `.builder-layout`/`.builder-field-grid`/`.builder-statezip-grid`,
   which each have exactly one literal value app-wide) — the plan's "into
   classes" (plural) is read as license for this, and two of the seven
   (`ws-grid-2`, `ws-grid-3`) are reused where two different original
   literals were visually equivalent (`'1fr 1fr'` / `'repeat(2,1fr)'` and
   `'1fr 1fr 1fr'` / `'repeat(3,1fr)'`).

---

## Task 6 — Small navigation and form fixes

**Files:** `frontend/src/features/layout/AppShell.tsx` (+ new
`AppShell.test.tsx`), new `frontend/src/components/RequiredMark.tsx` (+ test),
`frontend/src/features/pipeline/AddBidModal.tsx`,
`frontend/src/features/gen-pipeline/LogGenJobModal.tsx`,
`frontend/src/features/gen-pipeline/GenDetailDrawer.tsx` (+ new test),
`frontend/src/features/gen-pipeline/SignedContractCard.tsx`,
`frontend/src/features/elec-projects/ElecProjectsPage.tsx` (+ new
`ElecProjectsQuickAdd.test.tsx`).

### What changed

1. **Settings topbar title (ux #16):** `AppShell.tsx`'s `TB['admin'].title`
   changed from `'Admin'` to `'Settings'` — only the topbar heading; the
   sidebar nav button (already labeled "Settings") and `App.tsx`'s
   `VIEW_TITLES['admin']` (already `'Settings'`, driving `document.title`)
   were untouched.
2. **`RequiredMark` (ux #15):** new component — a visible `aria-hidden`
   asterisk plus a visually-hidden "required" span. Wired into the two
   `required` inputs that actually exist among Task 1's nine Modal-based
   forms: `AddBidModal.tsx` ("Project name", "General contractor") and
   `LogGenJobModal.tsx` ("Customer"). The other seven of the nine either have
   no `required` attribute at all, or (`AwardKickoffModal.tsx`) only the
   plain word "required" in prose copy, not a form field.
3. **`autoFocus` (ux #22):** `GenDetailDrawer.tsx`'s inline "Edit Details"
   form now focuses its first field (Customer) when it opens (via an
   `autoFocus={i === 0}` on the mapped input list). `AddBidModal`/
   `LogGenJobModal` already had `autoFocus` on their first field before this
   batch (from a prior change, not this task). The other six of the nine —
   `LeadDetailDrawer`, `SignedContractCard`, `CalendarEventPickerModal`,
   `SurveyFromCalendarModal`, `LeadSiteSurvey` — have no single stable text
   field to focus on open; see the deviation below.
4. **Double-submit (ux #21):** `SignedContractCard.tsx`'s "Countersign &
   award" confirm button (previously ungated) now disables (and its label
   changes to "Signing…") for the duration of the request. `ElecProjectsPage.tsx`'s
   5 quick-add rows — Change Order, Pay App, RFI, Key Material, Field Note —
   had inline `onClick={async () => {...}}` handlers with no busy flag at
   all; all 5 are migrated to `useMutation`, whose `saving` flag now disables
   the Add/Submit button and swaps its label for the duration of the request.

### Tests

- `frontend/src/features/layout/AppShell.test.tsx` (2 tests, new): the
  `admin` view's topbar title reads "Settings"; the sidebar nav button is
  still labeled "Settings" (proving this task changed the title, not the
  label).
- `frontend/src/components/RequiredMark.test.tsx` (3 tests, new): the
  asterisk is `aria-hidden`; a visually-hidden "required" string is present
  for assistive tech; it renders correctly next to a `required` input's
  label.
- `frontend/src/features/gen-pipeline/GenDetailDrawer.test.tsx` (1 test,
  new — no prior test file existed for this component): opening "Edit
  Details" focuses the Customer input (asserted via `document.activeElement`).
- `frontend/src/features/elec-projects/ElecProjectsQuickAdd.test.tsx` (1
  test, new): the RFI quick-add row's "Submit RFI" button, clicked three
  times fast while the POST is still in flight (a deferred promise held
  open), issues exactly one POST; the button reads "Submitting…" and is
  disabled throughout; resolving the request re-enables it.
- `frontend/src/features/gen-pipeline/SignedContractCard.test.tsx` (12
  pre-existing tests) continued to pass unmodified after adding `disabled`
  to the Countersign & award button.
- Full suite after this task: 75 files / 527 tests, all passing;
  `npm run typecheck` — 0 errors.

### Deviations from the plan (Task 6)

1. **RequiredMark scope**: the plan's Task 6.2 file list says "the modal
   forms named in the audit," and audit finding #15 also names
   `LoginPage.tsx`, `OverviewTab.tsx`, `AddLeadModal.tsx`, and
   `ContactsPage.tsx` as sites with a `required` attribute — none of those
   are one of Task 1's nine Modal-based dialogs (LoginPage and ContactsPage
   are full pages; OverviewTab is an inline tab-embedded edit form;
   AddLeadModal has no `required` attribute at all, only a post-submit toast).
   Scope was kept to the two real `required`-input sites inside the nine
   Modal forms, matching the narrower "modal forms" phrase in the task text
   rather than the audit finding's broader illustrative list.
2. **`autoFocus` reached only 3 of the 9 (2 pre-existing + 1 new)**, not all
   nine, because six of them genuinely have no single stable form field on
   open: `AwardKickoffModal` and `CalendarEventPickerModal` are upload-slot/
   picker modals with zero text `<input>`s (confirmed by a targeted grep);
   `SignedContractCard`'s confirm and `SurveyFromCalendarModal` are
   confirmation/picker dialogs, same reason; `LeadSiteSurvey` is a
   multi-step wizard whose "first field" changes shape every step (buttons,
   numbers, or a textarea depending which of ~8 steps is showing) — there is
   no one field to autoFocus without restructuring the wizard's step
   rendering, which the "no visual redesign" rule and this task's scope
   don't call for. `LeadDetailDrawer` is a read-first detail view, not a
   form-on-open, and already had a correctly-scoped `autoFocus` on its
   inline "Add note" textarea (pre-existing, appears only when that field is
   toggled on).
3. **`SignedContractCard`'s "Countersign & award" button** was not named by
   the plan's literal Task 6.4 file list (which calls out only the
   ElecProjectsPage quick-add rows), but it was a genuinely ungated mutation
   button discovered while auditing all nine Task 1 modals for double-submit
   protection per audit finding #21's broader statement ("double-submit
   isn't protected uniformly"). Fixed as a small, same-shaped, same-file
   addition rather than filed separately.
4. **All 5 of ElecProjectsPage's quick-add rows were migrated, not only the
   3 the task text names** (CO / Pay App / RFI). Key Materials and Field
   Notes have the exact identical bug pattern in the same file (an inline
   `async onClick` with no busy flag) — fixing 3 of 5 and leaving 2
   identical, adjacent bugs unfixed would have been inconsistent for no
   reason within the same task's blast radius.

---

## Task 7 — Code splitting

**Files:** `frontend/src/App.tsx`, `frontend/src/features/builder/BuilderPage.tsx`,
`frontend/src/features/hubs/ElectricalHubPage.tsx` (deviation on the last
two — see below), new `frontend/src/App.codeSplitting.test.tsx`.
`vite.config.ts` needed no change (no `manualChunks` configuration exists;
Vite already code-splits any `import()` into its own chunk automatically).

### What changed

- `React.lazy()` for the four pages `App.tsx` imports directly —
  `SettingsPage`, `BidHubPage`, `BuilderPage`, `DocsPage` — plus two more
  that the plan names but that App.tsx never imports directly, since they're
  nested inside other pages: `EvBuilderPage` (imported inside
  `BuilderPage.tsx`, rendered when a rep picks "EV Charger") and
  `ElecProjectsPage` (imported inside `ElectricalHubPage.tsx`, rendered on
  its "Projects" tab).
- **One `<Suspense>`**, wrapping `renderView()` inside App.tsx's existing
  page-level `<ErrorBoundary>` (which stays the outer wrapper, so a chunk
  *load failure* — `import()` rejecting, not just being slow — still throws
  during render and is caught by the boundary rather than crashing the
  app). Suspense catches a lazy component suspending anywhere in its
  subtree, not just its direct children, so this single boundary also
  covers `EvBuilderPage` and `ElecProjectsPage` even though each is a second,
  nested lazy import two components below where `renderView()` itself
  switches on `view`.
- A small shared `PageLoadingFallback` component (`App.tsx`) is the one
  Suspense `fallback` — styled identically to the existing bootstrap
  "Loading…" state (`padding: 32, color: 'var(--text3)'` in a
  `.scroll.view-enter` wrapper) so a slow chunk fetch reads as the same kind
  of pause as the initial data load, not a visually different one.

### Tests

- `frontend/src/App.codeSplitting.test.tsx` (8 tests, new): each of the six
  lazy pages actually renders its own real, distinguishing content (not just
  "didn't crash") after its chunk resolves — `DocsPage`'s empty state,
  `BuilderPage`'s "Customer & Site"/"Cooling Type" fields, `SettingsPage`'s
  "Company Profile" section, `BidHubPage`'s bid name, `EvBuilderPage`'s
  "Installation" section (reached by clicking the EV Charger toggle inside
  `BuilderPage`, proving the *nested* lazy import is covered by the same
  outer Suspense), and `ElecProjectsPage`'s empty state (reached by
  navigating to `/electrical/projects`). Two more: `NotFound` still renders
  for an unknown route with the Suspense boundary in place, and
  `usePageTitle` still sets `document.title` for a lazy page.
- All pre-existing tests (76 files before this task's new file) continued to
  pass unmodified — no existing test needed to be wrapped in `Suspense` or
  switched to `findBy`, since the ones that render these pages (directly, or
  through `App.tsx`) already used `findBy`/`waitFor`-style async queries
  throughout, which tolerate the extra microtask a lazy import adds.
- Full suite after this task: 76 files / 535 tests, all passing;
  `npm run typecheck` — 0 errors.

### Chunk sizes (`npm run build`, before → after)

Before (Tasks 1–6, pre-Task-7):

| File | Size | Gzip |
|---|---|---|
| `index-D_QsPSg5.js` (main bundle) | 1,402.49 kB | 407.59 kB |
| `index-DaG4cyX3.js` (vendor) | 495.37 kB | 130.06 kB |
| `pdf-BnPRJEQ6.js` | 365.12 kB | 107.40 kB |
| `jspdf.es.min-BkmqVaXi.js` | 357.39 kB | 116.59 kB |
| `html2canvas.esm-CBrSDip1.js` | 201.42 kB | 47.70 kB |
| `index.es-B6rWNYCB.js` | 150.69 kB | 51.39 kB |
| `purify.es-BwoZCkIS.js` | 22.03 kB | 8.72 kB |
| `pdf.worker.min-yatZIOMy.mjs` | 1,375.84 kB | (worker, not gzip-measured) |

After (Task 7):

| File | Size | Gzip |
|---|---|---|
| `index-nzvcQE1P.js` (main bundle) | **1,054.29 kB** | **326.13 kB** |
| `index-CyMVFe27.js` (vendor, unchanged) | 495.38 kB | 130.06 kB |
| `pdf-BnPRJEQ6.js` (unchanged) | 365.12 kB | 107.40 kB |
| `jspdf.es.min-DgAUGTZU.js` (unchanged) | 357.39 kB | 116.59 kB |
| `html2canvas.esm-CBrSDip1.js` (unchanged) | 201.42 kB | 47.70 kB |
| `index.es-ukL8TGzM.js` (unchanged) | 150.69 kB | 51.39 kB |
| `PcWorkspace-BOLvf1RP.js` (new — see deviation) | 116.39 kB | 29.24 kB |
| `SettingsPage-BGyAl76s.js` (new) | 84.98 kB | 21.05 kB |
| `ElecProjectsPage-JL3BkAyG.js` (new) | 48.62 kB | 11.11 kB |
| `BidHubPage-CSC540Sl.js` (new) | 41.74 kB | 11.33 kB |
| `BuilderPage-BYfYt5HU.js` (new) | 31.06 kB | 9.27 kB |
| `DocsPage-DkUt5hJ8.js` (new) | 14.03 kB | 4.33 kB |
| `EvBuilderPage-D4af-XKu.js` (new) | 12.18 kB | 3.86 kB |
| `purify.es-BwoZCkIS.js` (unchanged) | 22.03 kB | 8.72 kB |
| `pdf.worker.min-yatZIOMy.mjs` (unchanged) | 1,375.84 kB | (worker) |

**Main bundle: −348.2 kB raw (−24.8%), −81.46 kB gzip (−20.0%).** `dist/`
was deleted after each build (already gitignored); no build artifacts were
committed.

### Deviations from the plan (Task 7)

1. **`EvBuilderPage` and `ElecProjectsPage` are lazy-loaded from
   `BuilderPage.tsx` and `ElectricalHubPage.tsx` respectively, not from
   `App.tsx`**, because `App.tsx` never imports either directly — both are
   two levels deep (App.tsx → BuilderPage/ElectricalHubPage → the lazy
   component). The plan's file list only says "App.tsx, vite.config.ts if
   needed," but achieving a genuinely separate chunk for these two (as the
   plan's Task 7.1 explicitly names them, distinct from BuilderPage/
   ElectricalHubPage) requires touching the file that actually imports them.
   This is exactly what "one `<Suspense>`" was written to allow: React's
   Suspense boundary catches any lazy component suspending anywhere beneath
   it, at any depth, so the single boundary in `App.tsx` still covers both
   without a second `<Suspense>` anywhere else.
2. **`PcWorkspace` got its own chunk as a side effect**, not something this
   task explicitly asked for. It was previously bundled into the main chunk
   because it's imported by `BidHubPage.tsx`, which itself was imported
   eagerly by `App.tsx`; once `BidHubPage` became a lazy boundary, Vite's
   bundler naturally split `PcWorkspace` (only reachable through
   `BidHubPage`) into its own chunk too. Left as-is — it's a strict
   improvement for the exact page (audit ux #19 / code #10 both single it
   out as the largest component in the app) that Task 9 is about to split
   further; no code in `PcWorkspace.tsx` itself was touched.

---

## Task 8 — Request dedup for identical in-flight reads

**Files:** `frontend/src/hooks/useApi.ts`, `frontend/src/hooks/useApi.test.ts`.

### What changed

- A module-level `Map<string, SharedRequest>` (`sharedRequests`), keyed on
  `` `${url}|${paramsKey}|${responseType ?? ''}` `` (deviation from the
  plan's literal "keyed on url + paramsKey" — see below). Concurrent
  `useApi` calls for the same key join the same in-flight axios promise
  instead of each firing their own GET.
- **Reference counting**: each `SharedRequest` tracks `refCount`, incremented
  when a subscriber joins and decremented in that subscriber's effect
  cleanup (unmount, dependency change, or `reload()`). The underlying
  `AbortController` is only aborted — and the map entry only deleted early —
  when the *last* subscriber leaves; while any other subscriber is still
  waiting on the same key, the shared request keeps running.
- **No TTL cache**: the entry is deleted the moment its request settles
  (success or failure) via `promise.finally(...)`, whether or not anyone is
  still subscribed. A later call for the same key — a millisecond or an hour
  later — always finds no entry and issues a brand new request.
- **Per-subscriber cancellation is decoupled from the shared
  `AbortController`**: each subscriber's own effect closure has a private
  `cancelled` flag, set in its cleanup. A subscriber that unmounts (without
  being the last one) stops applying the eventual response to its own
  state, without needing — or being able — to touch the shared controller
  that other subscribers still depend on.
- `reload()` no longer manually aborts a per-hook controller; bumping
  `nonce` reruns the effect, whose own cleanup (run first, synchronously, by
  React, before the new effect body) already unsubscribes cleanly through
  the same reference-counting path.
- **Bug found and fixed during implementation**: the internal
  `promise.finally(() => sharedRequests.delete(key))` bookkeeping chain is a
  *second* consumer of the shared promise (distinct from each subscriber's
  own `.then().catch()` chain) and has no `.catch()` of its own — a shared
  request that rejects would otherwise surface as an "Unhandled Rejection"
  in that internal chain even though every real subscriber already handles
  the same rejection correctly. Fixed with a trailing `.catch(() => {})` on
  that one internal chain. Caught by running the full suite, not by a
  dedicated test (see Tests below) — it manifested as unhandled-rejection
  noise across several unrelated test files whose mocked API calls reject,
  not as a failing assertion.

### Tests

`frontend/src/hooks/useApi.test.ts` gained a `describe('request dedup', ...)`
block (7 tests):
- Four simultaneous subscribers to the same `/documents?linked_id=` read
  issue exactly one GET; all four receive the resolved data.
- Unmounting one of two subscribers to the same key leaves the shared
  request's `AbortController` un-aborted and the request still fulfills the
  remaining subscriber.
- A lone subscriber unmounting **does** abort the shared request (the
  reference-counting boundary case).
- A failed shared request rejects every subscriber (both see the same
  normalized error message) and clears the entry, so a subsequent call for
  the same key issues a fresh request rather than reusing the failed one.
- A subsequent call after a *successful* settle also issues a new request
  (no TTL cache).
- Two calls with different `params` for the same `url` are never
  accidentally shared.
- All 6 pre-existing `useApi.test.ts` tests (cancellation on url change,
  abort-on-unmount, error normalization ×2, `reload()`, disabled→enabled,
  equal-by-value params not refetching) continued to pass unmodified.

Full suite after this task: 76 files / 541 tests, all passing (541 vs. 535
after Task 7 — the 6 new dedup tests); `npm run typecheck` — 0 errors; no
unhandled-rejection noise in the run (the fix above).

### Deviations from the plan (Task 8)

1. **The dedup key includes `responseType`** in addition to `url +
   paramsKey`, which the plan states literally as the key. Without it, a
   JSON read and a binary `blob`/`arraybuffer` download of the exact same
   URL and params — a genuinely different request shape, since the parsed
   response type differs — could be incorrectly shared, silently handing one
   caller the wrong data type. No call site in the app currently does this
   (checked: no two `useApi` calls share a URL+params with different
   `responseType`), so this is a forward-looking correctness guard, not a
   fix for an observed bug, and it doesn't weaken the plan's actual target
   scenario (the gen drawer's four identical `/documents?linked_id=` reads,
   which share the same `responseType` — undefined — and dedup exactly as
   specified).

## Task 9 — Split the preconstruction workspace (audit code #10; ux #19)

**Files:** `frontend/src/features/preconstruction/PcWorkspace.tsx` (3,175
lines, one component) → `frontend/src/features/preconstruction/PcWorkspace/`
(21 modules), plus one new test,
`frontend/src/features/preconstruction/PcWorkspaceProfiler.test.tsx`.

### File map (new folder, line counts)

| File | Lines | What it holds |
| --- | ---: | --- |
| `PcWorkspaceView.tsx` | 1,229 | The parent: workspace state, the autosave, the seven data reads and their hydration effects, every handler, the tab switch and the page shell. |
| `TakeoffTab.tsx` | 468 | Plan Review — Agent 1/2/3 output, run-cost summary, "Confirm Key Project Data". |
| `ProposalTab.tsx` | 406 | Agent 4, the docx/xlsx downloads, the pre-bid package for Chris, verify-gate failures, the proposal preview, the convert-to-awarded modal. |
| `PricingTab.tsx` | 220 | The line-item estimate table, the zero-cost banner and the overhead/profit summary. |
| `parsing.ts` | 217 | `parseAgentJson`, `parseScopeSections`, `cleanMarkdown`, `scopeSectionsFrom`, `buildScopeFromAgent2`, `isElecSheet`, `analysisErrorMessage`, `isPdfOrImage`, `lookupUnitCost`, `buildLineItemsFromTakeoff`, `parseAgent1Service`. |
| `FilesTab.tsx` | 172 | Upload drop-zone, uploaded-plan table, "From Project Files" picker. |
| `useAiPoller.ts` | 168 | Both recursive poll loops, the shared cancel flag, the 10-minute deadline and the mount-time reconnect. |
| `ImportPanel.tsx` | 117 | "Import Finished Bid" (the Overview panel), now driven by the reducer. |
| `globalCache.ts` | 116 | The two session-level caches, `useGlobalPcCache`, `resetGlobalPcCaches`. |
| `CostsTab.tsx` | 112 | Historical cost comps + the project-type filter chips. |
| `ui.tsx` | 90 | `StepTracker` (memo), `TabStrip` (memo, includes the autosave chip), `pill`. |
| `OverviewTab.tsx` | 90 | Stats, workspace notes, takeoff-on-file, advance-step; renders `ImportPanel`. |
| `BidTab.tsx` | 89 | The AI Takeoff Engine run/resume/re-run panel and its log. |
| `importReducer.ts` | 78 | `ImportState`/`ImportAction`/`importReducer` — the six `import*` states. |
| `ScopeTab.tsx` | 76 | The seven scope sections + the two import buttons. |
| `RfisTab.tsx` | 75 | RFI add/import/submit and the RFI table. |
| `PricingRow.tsx` | 65 | One estimate line (memo, primitive props). |
| `IntelTab.tsx` | 62 | Win-rate insights. |
| `shared.ts` | 25 | `STEP_ORDER`, `SetWorkspace`, `AiResults`, `SaveState`, `TakeoffOnFile`, `ProjectDoc`. |
| `useStableFn.ts` | 18 | Ref-backed stable callback identity (a `useCallback` that always calls the latest closure). |
| `index.tsx` | 7 | Barrel — keeps the `features/preconstruction/PcWorkspace` module path working. |

`PcWorkspace.tsx` was moved with `git mv` into the folder, so the diff reads as
a rename plus edits rather than a delete/add.

### State ownership

All workspace state stayed in `PcWorkspaceView` — deliberately. Only one tab is
mounted at a time, so moving a tab's state into the tab would silently change
behaviour: the cost-table filter, the open takeoff category, the Plan Review
sub-tab, an in-progress bid import and the typed proposal price would all reset
on a tab switch, which they do not today. The children are presentational and
receive slices:

| Owner | State | Consumers |
| --- | --- | --- |
| `PcWorkspaceView` | `ws` (via props/`onUpdate`), autosave (`saveState`, timers, backoff, `lastScheduledRef`), `aiResults`, `savedEstimate`, `projectDocs`, `selectedDocIds`, `prebidSections`, `svc*`, `prop*`, `agent4*`, `prebid*`, `chrisDraft*`, `verifyFailures`, `proposalPreview`, `convertOpen`, `sendProposalOpen`, `newRfi`, `analysisTab`, `copied`, `dragOver`, `openTakeoffCat`, `costTypeFilter`, `expandedCostRow`, `importState` | handed down as props |
| `useAiPoller` | `pollTimedOut`, `pollCancelled`, both timeout refs | shell banner; `pollForResults`/`pollAgent4` called by `runAI`/`resumeAI`/`runAgent4Proposal` |
| `globalCache` | the two module-level caches | `useGlobalPcCache` |
| `importReducer` | the six `import*` states, one reducer | `ImportPanel` |
| `ImportPanel` | the three file-input DOM refs | itself |

Hook counts in the component itself (the old file's 39 `useState` and 13
`useEffect` include `useGlobalPcCache`'s): 37 → 30 `useState` — the six
`import*` became one `useReducer` and `pollTimedOut` moved into the poller —
and 10 → 9 `useEffect` (the poll reconnect moved), plus 3 new `useMemo`
(`historicalCosts`, `unitCostLib`, `pricingLineItems`).

Three things had to become identity-stable for the `React.memo` boundaries to
pay off, since `ws` lives in `App.tsx` and this component re-renders on every
keystroke: `set` (a `useCallback` over a ref to `onUpdate`), the two "empty"
fallbacks (`?? []` / `?? {}` handed fresh objects to memo dependency lists every
render) and the ~30 handlers passed to tabs (`useStableFn`). Behaviour is
unchanged in every case — `set` still reads the current workspace off `wsRef`,
and `useStableFn` always invokes the latest closure.

### Profiler measurement (one keystroke in a takeoff line's unit-cost input)

Fixture: the Pricing tab with a 12-line saved estimate across 3 categories;
`fireEvent.change` on one unit-cost input; measured with React's `<Profiler>`
plus a count of the React elements the commit constructed (the JSX runtime is
wrapped in the test). The unit-cost box is the only editable number on a
takeoff-derived table, so it is the "takeoff quantity" of the plan's wording.

| Metric | Before (3,175-line single component) | After |
| --- | ---: | ---: |
| Component boundaries that re-rendered | 1 of 1 — the whole workspace; there were no child boundaries to skip, so the step tracker, the tab strip and all 12 estimate rows re-rendered with it | 3 of the 16 instrumented boundaries mounted on that tab (root, step tracker, tab strip, `PricingTab`, 12 rows): `PricingRow:BRANCH POWER‖Item 5`, `PricingTab`, the workspace root |
| Estimate rows re-rendered | 12 of 12 | 1 of 12 |
| React elements re-created in the commit | 234 | 90 (−62%) |
| Boundaries re-rendered when the autosave chip flips (idle → saving → saved, 800 ms after the same keystroke) | the whole active tab, twice | `TabStrip` only; `PricingTab` and every row bail out |

The row-level ratio is the number that scales: the rebuilt-element count is
dominated by the estimate table, so a real 60-line takeoff improves further than
this 12-line fixture does.

Both numbers are asserted as upper bounds in
`PcWorkspaceProfiler.test.tsx` (≤ 4 boundaries, ≤ 140 elements, exactly one
`PricingRow`, never `TabStrip`/`StepTracker`), so the split cannot quietly
regress. The test instruments the real components by mocking each child module
to wrap its export in a `<Profiler>` behind the same shallow-props `memo` — no
profiling code ships in the app.

### Tests

- The nine existing `PcWorkspace*.test.tsx` files are **byte-identical to
  `main`** — not even an import path changed. `PcWorkspace/index.tsx` keeps the
  `./PcWorkspace` specifier resolving, so `App.tsx`, `BidHubPage`,
  `UnitCostSection` (`resetGlobalPcCaches`) and `BidHubPage.test.tsx`
  (`__resetGlobalPcCachesForTests`) are untouched too.
  `git diff main..HEAD --stat -- 'frontend/src/features/preconstruction/PcWorkspace*.test.tsx'`
  lists only the new Profiler test.
- New: `PcWorkspaceProfiler.test.tsx` (2 tests) — the keystroke measurement
  above, and the autosave-chip bail-out.
- Full suite: **77 files / 543 tests passing** (76/541 before, plus the two new
  ones). `npm run typecheck` — 0 errors. Nothing in `backend/` changed.
- A line-by-line audit of the move (every non-trivial line of the old file
  looked up in the new folder) shows the only lines that did not survive
  verbatim are the intended edits: the import block, the six `import*` states,
  `computePricingItems` → `useMemo`, `function set` → `useCallback`, the
  `ws.overheadPct`/`ws.profitPct`/`ws.estimateOverrides` writes that became
  `onOverheadChange`/`onProfitChange`/`onUnitCostChange`, the inline tab strip
  that became `<TabStrip>`, and the estimate row that became `<PricingRow>`.
  Every other line of JSX was moved unchanged (only re-indented).

### Deviations from the plan (Task 9)

1. **More was extracted than the four tabs named.** The plan named
   `TakeoffTab`, `PricingTab`, `ProposalTab`, `ImportPanel` and the poller;
   `OverviewTab`, `FilesTab`, `BidTab`, `ScopeTab`, `RfisTab`, `CostsTab`,
   `IntelTab`, `PricingRow`, `StepTracker`/`TabStrip` and the pure parsers came
   out too. Leaving the other seven tabs inline would have left a ~2,300-line
   parent that still owned most of the rendering, which does not answer audit
   code #10; each was a mechanical move of one `case` body.
2. **`PricingRow` is a component the plan did not ask for.** Without it, "typing
   a takeoff quantity re-renders the takeoff table only" is as far as it goes —
   the table still rebuilds all 12 rows. The row boundary is what turns that
   into one row, and it is where most of the 234 → 90 drop comes from.
3. **The parent is still 1,229 lines.** That is the plan's own division of
   labour ("the parent keeps workspace state and autosave"): 30 `useState`, the
   autosave with its retry/backoff, seven reads with their hydration effects,
   and ~30 handlers. Two further extractions are available and were left alone
   as out of scope for a no-behaviour-change task: a `useWorkspaceAutosave` hook
   (~100 lines) and a `usePricingHydration` hook (~90).
4. **State stayed in the parent rather than moving into the tabs**, including
   the states only one tab reads — see "State ownership" above; moving them
   would reset them on tab switches.
5. **The "components re-rendered" before-count is 1 by construction.** A
   `<Profiler>` only reports subtrees that exist, and before the split there was
   one component, so the honest before/after comparison needs the second metric
   (elements re-created, 234 → 90) to say how much of the tree that single
   commit rebuilt. Both are in the table above; the element count is measured
   the same way on both sides.
