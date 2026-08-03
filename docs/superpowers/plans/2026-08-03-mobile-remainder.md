# Mobile Remainder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the mobile sweep — the desk-oriented pages excluded from the Field Pack (Intake, ElecProjects workspace, Docs, Followups, Contacts, Home leftovers) plus the worthwhile deferred minors from the Field Pack ledger.

**Architecture:** Pure CSS/layout surgery following the exact patterns the Field Pack established: `useIsMobile()` for structural switches, media-query rules in styles.css for collapses, inline-grid → className where CSS must reach it. No new features, no backend changes, no migrations.

**Tech Stack:** React 18 + TS + vitest. No new dependencies.

**Context:** Follows PR #61 (Mobile Field Pack, merged). Established tools: `useIsMobile` (`frontend/src/hooks/useIsMobile.ts`), `.table-scroll` wrapper class, mobile block `@media (max-width:768px)` in `frontend/src/styles.css` (~:523+), touch block `@media (hover:none) and (pointer:coarse)`. Audit anchors below are from the 2026-08-02 mobile audit — line numbers may have drifted (two PRs landed since); ALWAYS match on content.

## Global Constraints

- Branch `feat/mobile-remainder`. One PR. Frontend suite (146 tests at plan time) stays green; `npx tsc --noEmit` clean. Backend untouched entirely.
- Desktop rendering byte-identical everywhere: every change is media-query-scoped, `useIsMobile`-gated, or provably layout-neutral on desktop. The `repeat(auto-fit, minmax())` trap is BANNED for collapsing fixed grids (it ADDS columns on wide screens — proven in PR #61 review); collapse via media query + className instead.
- Touch targets ≥44px for interactive elements newly restyled for mobile.
- No feature changes, no copy changes beyond what layout requires.
- Commit at the end of every task with the given message + this repo's standard Co-Authored-By/Claude-Session trailer.

---

### Task 1: Intake Inbox mobile layout

**Files:**
- Modify: `frontend/src/features/intake/IntakeInboxPage.tsx` (root grid `gridTemplateColumns:'340px 1fr'` + `height:'calc(100vh - 60px)'` at ~:267; filter row `'1fr 1fr'` at ~:244)
- Modify: `frontend/src/styles.css` (if class-based rules are cleaner than useIsMobile branches — implementer's choice, consistent within the task)

The audit's worst desk-page finding: on a 375px phone the fixed 340px list rail leaves ~35px for the detail pane, and the `100vh` calc ignores the 64px bottom nav and iOS dynamic toolbars.

Required behavior:
- **Mobile (≤768px):** single-pane master→detail flow. List fills the screen; tapping an item shows the detail full-width with a Back control (≥44px) returning to the list. Use `useIsMobile()` + existing selected-item state (READ the file first — it already tracks a selected intake item; reuse that state, do not add parallel state).
- Height: replace the fixed `calc(100vh - 60px)` on mobile with a document-flow layout (the mobile `.scroll` override already hands scrolling to the document) — no fixed 100vh on phone. Desktop keeps the current two-pane layout and height exactly.
- Filter row stacks on mobile.

- [ ] **Step 1: Failing test** — `frontend/src/features/intake/IntakeInbox.mobile.test.tsx`: mock matchMedia mobile (copy the pattern from `frontend/src/features/leads/LeadsPage.mobile.test.tsx`, and mock the intake api calls the page makes — read the page for its fetches): (a) mobile: list renders full-width, no detail pane until an item is tapped; tapping an item shows detail + Back button; Back returns to list. (b) desktop: both panes render simultaneously (existing behavior).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** New test + full suite green + tsc clean.
- [ ] **Step 5: Commit** — `fix: intake inbox master-detail flow on mobile`

---

### Task 2: ElecProjects workspace mobile collapse

**Files:**
- Modify: `frontend/src/features/elec-projects/ElecProjectsPage.tsx` (the un-overridden inline grids; audit list ~:399 `'1fr 1fr'`, ~:469 `'repeat(4,1fr)'`, ~:511 `'2fr 1fr 1fr 1fr auto'`, ~:587 `'1fr 1fr 1fr 1fr 1fr auto'`, ~:659 `'2fr 1fr 1fr 1fr'`, ~:718 `'2fr 1fr 1fr 1fr 1fr 1fr auto'`, ~:782 `'1fr 1fr 1fr'`, ~:839 `'repeat(3,1fr)'`, ~:874 `'repeat(2,1fr)'`, ~:1228 `'120px 1fr'`, ~:1319 `'140px 1fr'` — grep `gridTemplateColumns` in the file for the authoritative current list)
- Modify: `frontend/src/styles.css`

Method (uniform, mechanical): give each multi-column inline grid a shared className by role —
- **Form/field grids** (2-4 equal-ish columns of inputs/fields): `className="ws-form-grid"` keeping the inline desktop value; CSS: `@media (max-width:768px){ .ws-form-grid{ grid-template-columns:1fr !important; } }`
- **Row/list grids** (the `'2fr 1fr ... auto'` table-like rows): these are data rows, not forms — wrap their scroll parent in the existing `.table-scroll` pattern instead of collapsing (a 7-column row collapsed to 1 column is unreadable; horizontal scroll is correct). If a row grid has no scrollable parent, add `.table-scroll` around the list container. `min-width` on the row container so columns keep shape (~560px, matching the ctable convention).
- **Label/value grids** (`'120px 1fr'`, `'140px 1fr'`): leave alone — two columns fit a phone.

The file is 73KB — edit surgically, no reformatting. The 12-tab bar and `stats` grid are already handled (prior work) — don't touch.

- [ ] **Step 1:** Grep + classify every `gridTemplateColumns` site in the file (list them in your report with chosen treatment).
- [ ] **Step 2:** Apply classNames + CSS.
- [ ] **Step 3:** Full suite green (ElecProjectsPage isn't directly tested but imports must stay whole) + tsc clean.
- [ ] **Step 4: Commit** — `fix: elec projects workspace grids collapse or scroll on mobile`

---

### Task 3: Docs, Followups, Contacts mobile pass

**Files:**
- Modify: `frontend/src/features/docs/DocsPage.tsx` (root padding `'20px 28px 40px'` ~:159; `gridTemplateColumns: selected ? '1fr 300px' : '1fr'` ~:178; filter row `'1fr 1fr 1fr auto'` ~:217)
- Modify: `frontend/src/features/followups/FollowupsPage.tsx` (root padding ~:107; filter row `'2fr 1fr 1fr auto'` ~:125)
- Modify: `frontend/src/features/contacts/ContactsPage.tsx` (form grid `'repeat(3,1fr)'` ~:64; root padding ~:134)
- Modify: `frontend/src/styles.css`

Uniform treatment:
- Root paddings: add a shared class (e.g. `className="page-pad"` alongside existing classes, keeping inline desktop padding) + mobile rule `padding:12px 14px` — OR reuse whatever pattern Task 1 settles on; consistent across all three pages.
- Filter rows + Contacts form grid: className + `grid-template-columns:1fr !important` in the mobile block (form/filters collapse fine).
- DocsPage 300px detail sidebar: on mobile, when `selected`, render the detail as a full-width section below the list (or the grid collapses to one column with detail after list — simplest correct thing; READ the component to see which reads better structurally). Desktop unchanged.

- [ ] **Step 1:** Apply all three pages + CSS.
- [ ] **Step 2:** Full suite green (ContactsPage has tests — must pass untouched) + tsc clean.
- [ ] **Step 3: Commit** — `fix: docs, followups, contacts pages adapt to mobile`

---

### Task 4: Home/CommandCenter leftovers + small deferred minors

**Files:**
- Modify: `frontend/src/features/command-center/command-center.css` and/or `frontend/src/features/dashboard/sales-dashboard.css`
- Modify: `frontend/src/pages/ProposalPublicPage.tsx` (outer padding ~:145 `padding:'32px 16px 60px'`)
- Modify: `frontend/src/features/settings/sections/UsersSection.tsx` (~:34 inline `overflow:'hidden'` clipping the `.table-scroll` scrollbar)

Items (each audited):
1. **Nested gutters on Home:** HomeKpis' `.sd-root` renders inside `.cc2-root`; both apply mobile side padding (~28px total) and doubled bottom pad. Add a scoped rule so `.cc2-root .sd-root` gets `padding:0 0 12px !important` on mobile (outer `.cc2-root` keeps its 12/14px) — single gutter, single bottom pad.
2. **`.sd-hero` padding** (`sales-dashboard.css` ~:11 `26px 30px 24px`) — mobile rule → `16px 14px`.
3. **Leaderboard name column** (`sales-dashboard.css` ~:127 `.sd-rep .nm{width:110px}`) — mobile rule → `width:84px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;` so bars get real track length.
4. **Funnel 3-across** (`sales-dashboard.css` ~:133) — mobile → `grid-template-columns:1fr; gap:8px;` (stacked steps read fine).
5. **ProposalPublicPage outer padding** (deferred minor from PR #61): `padding:'32px 16px 60px'` → responsive: keep desktop, mobile `16px 8px 40px` (className + mobile rule; this page is OUTSIDE AppShell — its own CSS or a `<style>`-free styles.css class both work since styles.css is global).
6. **UsersSection scrollbar clip** (deferred minor): remove/adjust the inline `overflow:'hidden'` on the panel wrapping `.table-scroll` (verify border-radius clipping still looks right — if the radius needs overflow, apply the radius to the `.table-scroll` div instead).

- [ ] **Step 1:** Apply all six.
- [ ] **Step 2:** Full suite green + tsc clean.
- [ ] **Step 3: Commit** — `fix: home nested gutters, chart/leaderboard/funnel mobile, e-sign page padding, users table clip`

---

### Task 5: Final verification + PR

- [ ] **Step 1:** Full frontend suite + tsc; backend untouched (verify `git diff main --stat -- backend/` is empty).
- [ ] **Step 2:** Push; `gh pr create` (summary: intake master-detail, workspace grids, three-page pass, home leftovers, deferred minors closed). Standard footer. Final whole-branch review (Fable) before merge — do not merge in this task.

---

## Self-Review (done at plan time)

- Coverage vs "Everything" remainder: Intake (T1), ElecProjects (T2), Docs/Followups/Contacts (T3), Home/CommandCenter + public-page + UsersSection minors (T4). Remaining deferred minors NOT picked up (deliberate): days-in-stage timestamps (needs schema), debounce-timer test, double-backdrop cosmetic, Object.assign style, per-render recompute — all recorded in old ledgers, none user-visible enough to justify scope.
- Placeholder scan: none — every task lists exact sites and exact rules; T2's classification step is explicitly the implementer's first deliverable because the 73KB file's line numbers are unreliable.
- Type consistency: only shared interface is `useIsMobile()` (pre-existing) and className conventions defined inline per task.
