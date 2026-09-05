# Audit Batch 4 — Frontend Design, Accessibility & Perceived Performance

**Date:** 2026-09-04
**Status:** Approved plan, pending implementation (run after Batch 3 merges)
**Planned by:** Fable 5.1 · **Execution:** Sonnet 5 (Tasks 1–8) and Opus 5 (Task 9) · **Review:** Opus 5 (full) → Fable 5.1 (verdict)
**Depends on:** Batches 1–3
**Source:** `docs/audit-2026-09-03.html` → "Look & feel" and the frontend
items under "Speed & scaling"; details in `docs/audit-frontend-ux.md`
(findings 4–10, 12–19, 21–24, 26) and `docs/audit-frontend-code.md` (8, 10,
14, 21). Read the cited finding before each task.

## Context

The dark design system is coherent and the mobile work is above average. The
drift is in the biggest pages, which grew their own parallel styles, and in
the dialogs, which lack the semantics and keyboard behavior a desktop user
expects. This batch consolidates onto shared components and tokens and makes
the modals behave. Task 9 (splitting the 2,800-line workspace) is the one
judgment-heavy item and is assigned to Opus.

## Environment facts

- Batch 2 added: `useApi`, `useMutation`, toast variants, `UnsavedGuardContext`
  and its confirm dialog (`components/` — find the exact file), `usePageTitle`,
  `NotFound`, `reportError`. **Reuse them; do not create parallel versions.**
- Design tokens live in `frontend/src/styles.css:1-17`. `--red/--amber/--green`
  and their `-soft` variants exist. Four grey tokens exist: `--text2`,
  `--text3`, `--muted`, `--slate`.
- `lib/money.ts` is the currency formatter of record. There is no
  `lib/date.ts` yet.
- Restore routes exist for bids, gens, and documents (`POST /:id/restore`),
  all `requireAdmin`.
- 11 `window.confirm` call sites remain (recount at start).
- The frontend suite is green; keep it green after every task.
- The live app runs from Local Version under Vite HMR. **Worktree only.**

## Ground rules (permanent)

- Worktree only:
  `git worktree add "../Electrical-program-wt-audit4" -b fix/audit-batch4 main`
  from `"/Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version"`
  (quote paths). `npm install` both sides. Never touch Local Version or other
  worktrees. Never run dev servers. Tests only via `npm test`. No pushes.
- One commit per task, imperative messages, co-author line naming the
  executing model. Every behavioral change gets a test. Feature report at
  `docs/superpowers/plans/2026-09-04-audit-batch4-report.md`.
- **No visual redesign.** Same colors, same layout, same copy except where a
  task names the change. Consolidation means the rendered result is
  unchanged or strictly more consistent.
- Backend changes are limited to Task 2 (restore route permission). Nothing
  else in `backend/` may change.

## Task 1 — One Modal component with real dialog behavior (audit ux #12, #13, #14, #22)

**Files:** new `components/Modal.tsx` (+ test), the nine overlay/drawer
components (`AddBidModal`, `LeadDetailDrawer`, `GenDetailDrawer`,
`AwardKickoffModal`, `SignedContractCard`, `CalendarEventPickerModal`,
`LogGenJobModal`, `SurveyFromCalendarModal`, `LeadSiteSurvey`), and the 11
`className="close-x"` buttons.

1. `Modal({ open, onClose, title, labelledBy?, children, size?, variant: 'modal' | 'drawer' })`:
   `role="dialog"`, `aria-modal="true"`, `aria-labelledby` (auto from
   `title`), focus moved to the first focusable element on open and restored
   to the opener on close, Tab/Shift-Tab trapped inside, Escape closes,
   backdrop click closes. Both Escape and backdrop route through the
   Batch 2 unsaved guard when the content is dirty (the guard's context
   already exposes the check).
2. Migrate all nine components onto it. Keep each one's existing markup
   inside; only the shell changes. The mobile bottom-sheet styling in
   `styles.css` must still apply (keep the class names).
3. Every close button gets `aria-label="Close"`.
4. Tests: focus trap, Escape, backdrop, focus restore, and a dirty-content
   Escape that opens the guard dialog instead of closing.

## Task 2 — Confirm dialog and Undo on deletes (audit ux #4, #5)

**Files:** new `components/ConfirmDialog.tsx` (may extend Batch 2's guard
dialog — one component, two uses), the 11 `window.confirm` sites,
`backend/src/routes/{bids,gens,documents}.ts` restore routes.

1. `ConfirmDialog` built on Task 1's `Modal`; destructive variant with a red
   primary button; returns a promise so call sites read
   `if (await confirm({ … })) …`.
2. Replace all 11 `window.confirm` sites. Copy stays as it is.
3. Undo: for deletes of bids, gens, and documents (all soft-deleted), the
   success toast gets `action: { label: 'Undo', onClick }` that calls the
   restore route and re-inserts the row locally. Backend: relax the three
   restore routes from `requireAdmin` to "admin OR the user who deleted it
   within the last 10 minutes" — record `deleted_by` if the column is
   missing (small migration, next free number after Batch 3) or, if that is
   too wide, keep `requireAdmin` and show Undo only to admins; say which.
4. Tests: confirm cancel does nothing; confirm accept deletes; Undo restores
   and the row reappears; a non-admin deleter can restore within the window.

## Task 3 — Badge component and status tokens (audit ux #6, #7)

**Files:** new `components/Badge.tsx`, `styles.css`,
`features/preconstruction/PcWorkspace.tsx`, `features/leads/LeadsPage.tsx`,
`features/leads/LeadDetailDrawer.tsx`, `features/settings/sections/EmailSection.tsx`,
`features/settings/sections/NotificationsSection.tsx`,
`features/preconstruction/SendBidProposalModal.tsx`.

1. `Badge({ tone: 'neutral'|'info'|'good'|'warn'|'bad', size?, children })`
   rendering the existing `.badge` classes with tone modifiers that map to
   the theme tokens.
2. Replace the inline pill implementations at the sites listed in the audit
   (LeadsPage ×5, LeadDetailDrawer, EmailSection ×2, NotificationsSection,
   SendBidProposalModal) with `Badge`. Rendered size and color must match
   the theme, which is the fix.
3. `PcWorkspace`: replace the 19 hardcoded `#EF4444` / `#F59E0B` / `#10B981`
   with `var(--red)` / `var(--amber)` / `var(--green)` (and `-soft` where a
   background). No other change to that file in this task.
4. Tests: Badge renders the tone class; a grep test asserting no `#EF4444`,
   `#F59E0B`, `#10B981` remain in `features/`.

## Task 4 — One date formatter, one size formatter, money everywhere (audit ux #8, #9, #23; code #14)

**Files:** new `lib/date.ts`, new `lib/format.ts` (or fold into `lib/money.ts`),
the seven `fmtDate` definitions, four `dayOf`, four `fmtSize`, three builder
`fmt`, plus `BidCompare.tsx` and `PcWorkspace.tsx` money sites.

1. `lib/date.ts`: `fmtDate(iso, { year?: 'auto'|'always'|'never' })` with
   `'auto'` = show the year only when it differs from the current year;
   `fmtDateTime`; `dayOf` (the local-parse `'T00:00:00'` trick, kept).
2. `fmtSize` once. The builders' `fmt`/`fmtDec` move into `lib/money.ts` and
   respect the currency setting.
3. Replace every local definition and every raw `toLocaleString`/`toFixed`
   on a money value in `BidCompare.tsx` and `PcWorkspace.tsx` with the
   shared helpers. Percentages keep `toFixed` where appropriate.
4. Tests: the helpers; a grep test that no file under `features/` defines
   `function fmtDate` / `const fmtDate` / `fmtSize` / `dayOf`.

## Task 5 — Grey tokens and the mobile `!important` trap (audit ux #10, #26)

**Files:** `styles.css`, the inline `gridTemplateColumns` sites in
`BuilderPage.tsx` and `ElecProjectsPage.tsx`.

1. Alias `--muted` and `--slate` to `--text3` (keep the names so nothing
   breaks), and note in the stylesheet header which two are canonical.
2. Move the inline desktop `gridTemplateColumns` in the two named files into
   classes in `styles.css`, so the existing mobile block no longer needs
   `!important` for those rules. Remove those `!important`s only.
3. Test: none required beyond the suite; the report shows before/after
   `!important` counts.

## Task 6 — Small navigation and form fixes (audit ux #15, #16, #18, #21)

**Files:** `features/layout/AppShell.tsx:49`, the modal forms, `components/`.

1. Sidebar "Settings" opens a page titled "Settings" (change the topbar title,
   not the nav label).
2. A `RequiredMark` (asterisk with `aria-hidden` and a visually-hidden
   "required") added next to labels for every input carrying the `required`
   attribute in the modal forms named in the audit.
3. `autoFocus` on the first field of every Task 1 modal that has a form.
4. Double-submit: `useMutation`'s `saving` now backs every submit button in
   the migrated forms; find any remaining inline submit handler without it
   (the CO / pay-app / RFI quick-add rows in `ElecProjectsPage`) and migrate.
5. Tests: the required mark renders for a `required` input; the quick-add
   row cannot fire twice.

## Task 7 — Code splitting (audit code #8)

**Files:** `App.tsx`, `vite.config.ts` if needed.

1. `React.lazy` + one `<Suspense>` with a small page-level spinner for
   `SettingsPage`, `PcWorkspaceView` (or `BidHubPage`), `BuilderPage`,
   `EvBuilderPage`, `ElecProjectsPage`, `DocsPage`.
2. Report the `npm run build` chunk sizes before and after (this is the one
   place a build is allowed; it does not start a server).
3. Test: the lazy pages render after their chunk loads (the existing page
   tests, wrapped in Suspense where needed).

## Task 8 — Request dedup for identical in-flight reads (audit data #9)

**Files:** `hooks/useApi.ts`.

1. A module-level map of in-flight GET promises keyed on
   `url + paramsKey`; concurrent `useApi` calls with the same key share one
   request. No TTL cache. Cleared on settle. Aborting one subscriber must
   not abort the shared request for the others (reference-count the
   controller).
2. Test: the gen drawer's four identical `/documents?linked_id=` reads issue
   one request; aborting one of them leaves the others fulfilled.

## Task 9 — Split the preconstruction workspace (audit code #10; ux #19) — **Opus executes**

**Files:** `features/preconstruction/PcWorkspace.tsx` → `PcWorkspace/` folder.

1. Extract `TakeoffTab`, `PricingTab`, `ProposalTab`, `ImportPanel`, and the
   AI results poller into sibling files. The parent keeps the workspace
   state and the autosave; children receive slices via props or a small
   context. Collapse the `import*` states into one `useReducer`.
2. `React.memo` on each tab; `useMemo` for the derived pricing rows;
   `useCallback` for the handlers passed down. The goal is that typing in a
   takeoff quantity re-renders the takeoff table only.
3. **No behavior change.** Every existing `PcWorkspace*.test.tsx` passes
   unmodified except for import paths. The Batch 2 autosave, polling, and
   unsaved-guard behavior are covered by those tests and must stay green.
4. Report: a before/after count of components re-rendered on one keystroke,
   measured with React's Profiler API in a test (not a screenshot).

## Out of scope (deliberately)

- Terminology alignment between the two hubs' tabs (Leads/Intake,
  Pipeline/Bids, Jobs/Projects) — product decision for Jake.
- A light theme.
- Table sorting/column persistence.
- Any copy changes beyond Task 6.1.

## Verification (reviewer checklist)

- `npm test` and `npm run typecheck` exit 0 in both packages.
- `grep -rn "window.confirm" frontend/src` → 0. `grep -rn "confirm(" frontend/src --include='*.tsx'` → only `ConfirmDialog` usages.
- `grep -rnE "#EF4444|#F59E0B|#10B981" frontend/src/features` → 0.
- `grep -rn "role=\"dialog\"" frontend/src` → only in `Modal.tsx`; all nine
  components import `Modal`.
- `grep -rn "aria-label=\"Close\"" frontend/src` ≥ 11.
- `grep -rnE "function (fmtDate|fmtSize|dayOf)|const (fmtDate|fmtSize|dayOf) =" frontend/src/features` → 0.
- Build chunk table present in the report (Task 7).
- Profiler re-render counts present in the report (Task 9).
- `git diff --stat main..HEAD -- backend/` touches only the three restore
  routes (and one small migration if Task 2 needed it).
