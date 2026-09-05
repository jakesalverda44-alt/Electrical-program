# Audit Batch 4 — Frontend Polish — Execution Report

**Executing:** Sonnet 5, Tasks 1–4 (Tasks 5–9 are separate follow-on work by other
engineers per the plan). One commit per task, worktree
`Electrical-program-wt-audit4`, branch `fix/audit-batch4`.

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
