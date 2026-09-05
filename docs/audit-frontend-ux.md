# Frontend UX & Visual Design Audit — APT Electrical CRM

Scope: `frontend/src`, React 18 + Vite + react-router, ~33.6k LOC across 22 feature folders. Read-only review. Unsaved-changes-guard findings excluded per instructions.

---

## Data loading, errors & feedback

**1. [High] The entire app's initial data load has no error handler**
`App.tsx:94-145` — `Promise.all([api.get('/dashboard'), api.get('/users'), api.get('/preconstruction/workspaces')]).then(...).finally(() => setLoading(false))`. There is no `.catch()`. If any of these three calls fails (a 500, a dropped connection, an expired token), the loading spinner just disappears and the app renders with empty `bids`, `gens`, `wonJobs` and no error message — every board, dashboard stat, and list looks empty with zero explanation. Since this is the one fetch that feeds nearly the whole app, this is the single highest-leverage gap in the audit.
Fix: add a `.catch()` that sets an error state and renders a retry banner instead of silently proceeding with empty arrays.

**2. [High] Failed deletes are reported to the user as successful**
`features/docs/DocsPage.tsx:126-130`:
```js
const deleteDoc = async (id: string) => {
  await api.delete(`/documents/${id}`).catch(() => {});
  setDocs(prev => prev.filter(d => d.id !== id));
  showToast({ title: 'Document removed' });
```
Same pattern in `features/elec-projects/ElecProjectsPage.tsx:1158-1161`. If the DELETE request fails, the error is swallowed, the row still disappears from the UI, and a "Document removed" success toast fires. The file still exists server-side but the user believes it's gone.
Fix: only optimistically remove/toast on the resolved promise; on rejection, show a "Delete failed" toast and keep the row.

**3. [Medium] Error and success toasts are visually identical**
`components/Toast.tsx:9` always renders `<Icon name="check"/>` inside `.t-ic`, and `styles.css:258` hardcodes `.toast .t-ic{background:var(--green-soft);color:var(--green)}` — a green checkmark — for every toast. The `Toast`/`useToast` types (`hooks/useToast.ts`) carry no severity field. So calls like `showToast({ title: 'Delete failed', sub: 'Please try again' })` (`features/gen-pipeline/GenPipelinePage.tsx:164`, `features/bid-hub/OverviewTab.tsx:212`, 19 total "failed" toasts found) render with the same green success checkmark as "Document removed." A user glancing at the corner of the screen after a bulk action can't tell success from failure without reading the text.
Fix: add a `variant: 'success' | 'error'` to the toast type and swap icon/color for errors.

**4. [Medium] Destructive actions use the native browser `confirm()` dialog, not the app's own modal system**
15 call sites (`features/gen-projects/GenProjectsPage.tsx:191`, `features/bid-hub/OverviewTab.tsx:190,203`, `features/leads/LeadDetailDrawer.tsx:211,456`, `features/gen-pipeline/GenPipelinePage.tsx:152`, `features/elec-projects/ElecProjectsPage.tsx:180`, etc.) use `window.confirm(...)` for permanent deletes ("Delete lead... This cannot be undone."). The rest of the app has a polished custom modal/drawer system (`.overlay`/`.modal`), but the highest-stakes actions drop into an unstyled OS dialog that breaks visual continuity and can't be styled, tested consistently, or offer an undo.

**5. [Low] No undo on destructive actions** — every delete flow above is confirm-then-gone; no toast action ("Undo") is offered even though `Toast` already supports an `action` button (`components/Toast.tsx:11-17`, used elsewhere).

---

## Design system consistency

**6. [Medium] Status colors are reimplemented with different hex values instead of the shared tokens**
`styles.css:12` defines `--red:#E06A6A`, `--amber:#E0A53B`, `--green:#34C588` and these are used consistently for badges/board accents. But `features/preconstruction/PcWorkspace.tsx` (the biggest single page) hardcodes a *different* red/amber/green palette for its risk/confidence indicators: `#EF4444` (7×), `#F59E0B` (8×), `#10B981` (4×) — e.g. `PcWorkspace.tsx:1710`: `r === 'HIGH' ? '#EF4444' : r === 'MEDIUM' ? '#F59E0B' : 'var(--green)'`. The result: a "Stop Item" warning in the takeoff tab is a visibly different, more saturated red than a "Lost" badge on a pipeline card two clicks away, even though both mean "bad."
Fix: extend the CSS variables (or reuse the existing ones) instead of a parallel Tailwind-style palette.

**7. [Medium] Badges/pills are hand-rolled with inline styles instead of the shared `.badge`/`.tag-div` classes**
`styles.css:147-152` defines a full `.badge` system. Yet `features/leads/LeadsPage.tsx` alone reimplements pill styling inline five separate times (lines 276, 369, 442, 451, 487), each with its own `borderRadius: 20`, padding, and ad-hoc color — e.g. line 442: `flex: 'none', fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20`. `LeadDetailDrawer.tsx:245` does the same with yet another color (`#d97706` / `rgba(217,119,6,.12)`) that matches none of the theme's amber token. `SendBidProposalModal`, `EmailSection.tsx:125,159`, `NotificationsSection.tsx:267` follow the same pattern. There are at least 4-5 independent "chip" implementations across the codebase beyond the shared one.

**8. [Low] Duplicated date formatters with inconsistent output**
At least 6 files each define their own local `fmtDate` (`features/docs/DocsPage.tsx:41`, `features/elec-projects/ElecProjectsPage.tsx:59` and again at `:1008`, `features/hubs/ElecOverviewTab.tsx:19`, `features/hubs/GenOverviewTab.tsx:19`, `features/leads/LeadsPage.tsx:25`, `components/RecordFiles.tsx:43`). Some include the year (`'short', 'numeric', 'numeric'` in Docs/ElecProjects/RecordFiles) and some omit it (Overview tabs and LeadsPage use `{ month: 'short', day: 'numeric' }` only) — the same due date can read "Sep 3" on the hub overview and "Sep 3, 2026" on the documents list, with no shared helper.

**9. [Low] A shared currency formatter exists but isn't used everywhere**
`lib/money.ts` is a well-built single source of truth (`moneyFull`, `moneyShort`, respects the app's currency setting via `Intl.NumberFormat`). Its own header comment explains it replaced "every page hand-rolling its own `'$' + n.toLocaleString()`." Despite that, `features/preconstruction/BidCompare.tsx` (9 raw `toLocaleString`/`toFixed` money calls) and `PcWorkspace.tsx` (multiple, e.g. lines 1682-1691, 2663-2665) still hand-format dollar amounts, so if a shop ever changes the currency setting away from USD, the biggest, most-used page in the app (preconstruction/estimating) won't reflect it while smaller pages will.

**10. [Low] Four near-duplicate "muted grey" text tokens**
`styles.css:6`: `--text2:#9FADC6; --text3:#6A7892; --muted:#6E7C95;` plus `--slate:#7C8AA3` (line 12) — four different greys with overlapping intent. `--text3` is used 579 times, `--text2` 163 times, `--muted` only 23 times, and `--slate` only 7 times, suggesting `--muted`/`--slate` are largely vestigial and a source of "which grey do I use" ambiguity for anyone extending the app.

---

## Dark mode / theming

**11. [Low, informational] There is no light mode — by design, not by breakage**
`styles.css:1-17` defines one fixed dark palette on bare `:root`; there is no `@media (prefers-color-scheme)` block and no light/dark toggle anywhere in the codebase (`grep` for `prefers-color-scheme`/`data-theme` returns nothing outside a code comment). This isn't a "partially implemented dark mode that breaks" — it's a single committed dark theme, which is a reasonable choice for an internal tool, but worth naming explicitly since the stylesheet's own header comment calls it "dark + airy design system" with no mention that light mode was ever planned. The one place this could bite: the customer-facing e-sign proposal page (`ProposalPublicPage`/`ProposalPreview.tsx`) is deliberately light/white (print-style), which is correct and intentional, not a bug.

---

## Accessibility

**12. [Medium] Icon-only close buttons have no accessible name**
All 11 `className="close-x"` buttons across modals/drawers (`features/pipeline/AddBidModal.tsx:90`, `features/leads/LeadDetailDrawer.tsx:251`, `features/leads/LeadSiteSurvey.tsx:358`, `features/leads/SurveyFromCalendarModal.tsx:98`, `features/bid-hub/BidHubPage.tsx:70`, etc.) render only an `<Icon name="x"/>` with no `aria-label`. A screen-reader user hears "button" with no indication it closes the dialog.

**13. [Medium] Modals/drawers carry no dialog semantics**
Across the whole codebase there is exactly one `role="dialog"` and only ~16 total `aria-*` attributes in 33.6k lines. The 9 components using the `.overlay`/`.drawer-overlay` pattern (`AddBidModal`, `LeadDetailDrawer`, `GenDetailDrawer`, `AwardKickoffModal`, `SignedContractCard`, `CalendarEventPickerModal`, `LogGenJobModal`, `SurveyFromCalendarModal`, `LeadSiteSurvey`) don't set `role="dialog"`/`aria-modal="true"`, don't label themselves via `aria-labelledby`, and don't trap focus — Tab can walk out of an open modal into the page behind it.

**14. [Low] Escape-to-close and backdrop-click-to-close are inconsistent across modals**
Of the 9 overlay/drawer components above, only `LeadDetailDrawer.tsx` listens for `Escape`. Only one file attaches an `onClick` to the `.overlay` backdrop to dismiss. The other 8 modals can only be closed via their explicit close-x or Cancel button — a small but real inconsistency for a mouse+keyboard desktop user who has learned "Escape closes things" from the one modal that supports it.

**15. [Low] No visible required-field marking**
`grep` for an asterisk-style required marker (`*</label>` or similar) returns zero matches anywhere. Required fields rely solely on the native HTML `required` attribute (`features/pipeline/AddBidModal.tsx:96,101`, `features/auth/LoginPage.tsx:50,99`, `features/bid-hub/OverviewTab.tsx:266`), which produces no persistent visual cue — the user only discovers a field is required when the browser's native validation balloon pops up on submit, or via a post-submit toast like "Name is required" (`features/leads/AddLeadModal.tsx:53`, `features/contacts/ContactsPage.tsx:51`).

---

## Navigation & IA

**16. [Low] Sidebar item label doesn't match the page title it opens**
`features/layout/AppShell.tsx:127`: the nav item is `{ id: 'admin', label: 'Settings', icon: 'gear' }`, but `AppShell.tsx:49` maps that same `admin` view to a topbar title of `'Admin'` (`TB.admin = { title: 'Admin', ... }`). Clicking "Settings" in the sidebar lands on a page titled "Admin" — a small but noticeable naming mismatch on one of the most-visited items for an owner/admin user.

**17. [Low] Unknown URLs silently become a fake page instead of a real 404**
`App.tsx:198` (logged-out) does redirect unknown paths to `/login`, but once logged in, `App.tsx:334` routes `path="*"` straight into the app shell, and `renderView()`'s `default` case (`App.tsx:294-295`) renders `<StubPage title={view...titleCased}/>` — e.g. visiting `/askdjfh` renders a page literally titled "Askdjfh — coming soon" rather than a 404/not-found state. Harmless for typos but means broken/stale deep links (e.g. an old bookmark to a renamed section) give no signal that anything is wrong.

**18. [Low] No per-page browser tab titles**
`document.title` is never set anywhere in the app (`grep -r document.title` returns 0 hits); `index.html:6` hard-codes `<title>Accurate Power CRM</title>` once. Every open tab/PWA app-switcher card reads identically regardless of whether the user is on the Dashboard, a specific Bid Hub, or Settings — makes multi-tab work (e.g. comparing two bids in two tabs) harder to navigate by title alone.

---

## Performance (perceived)

**19. [Medium] The largest page in the app (2,799 lines) has zero memoization**
`features/preconstruction/PcWorkspace.tsx` declares 43 separate `useState` hooks and contains zero `useMemo`/`useCallback` calls (`grep -c` confirms 0 of each). `React.memo` is not used anywhere in the entire `features/`/`components/` tree. Because this component renders the takeoff tables, RFI lists, pricing breakdown, and proposal preview all in one tree, any keystroke in any single input (e.g. editing a quantity in the takeoff grid) triggers a full re-render of the whole 2,800-line render function, including tables and panels that didn't change. On a large commercial takeoff with many line items this is the kind of thing that shows up as visible typing lag.

**20. [Medium] `ElecProjectsPage.tsx`, `BuilderPage.tsx`, and `GenPipelinePage.tsx` show no loading indicator of their own**
These pages consume `bids`/`gens` as props from the single top-level `App.tsx` fetch (finding #1), so the initial "Loading…" screen (`App.tsx:106-113`) covers first paint. But subsequent in-page async actions (uploads, phase changes, per-record refetches) in these three files have no local loading affordance — combined with the swallowed-error pattern in #2/#1, an action that's slow or silently failing gives no visual feedback at all.

---

## Forms

**21. [Low] Double-submit isn't protected uniformly**
30 call sites gate a save button on a `saving`/`submitting` boolean, but this is opt-in per component rather than a shared pattern (no shared `<SaveButton busy={...}>` component was found) — some newer modals follow it, some of the older/smaller ones (e.g. quick add-forms in `ElecProjectsPage.tsx`'s CO/Pay App/RFI rows) construct their own inline submit handlers without checking a busy flag, so a fast double-click can plausibly fire two requests.

**22. [Low] `autoFocus` is used in only 9 places app-wide** despite dozens of modals/forms — most dialogs (e.g. `GenDetailDrawer`, `AwardKickoffModal`, `CalendarEventPickerModal`) open without moving focus into the first field, so a keyboard-first user has to click before typing.

---

## Tables/lists & formatting

**23. [Low] Number formatting is inconsistent even within one file**
`features/preconstruction/BidCompare.tsx` mixes `toLocaleString()` (lines 44, 83-85, 254, 355) and manual `toFixed()` (lines 86-88, 284, 296, 305, 322, 357, 398, 403, 458) for what appear to be adjacent dollar/percentage figures in the same comparison table, rather than a single consistent formatter — small misalignments in decimal places are plausible between two numbers sitting in the same row.

**24. [Low] `.table-scroll` wrapper exists but isn't universal**
`styles.css:307-309` defines a generic horizontal-scroll wrapper for data tables (`.table-scroll .ctable{min-width:560px}`), which is good practice for the mobile PWA — but it's applied selectively; not every `.ctable` usage in `ElecProjectsPage.tsx`'s many CO/pay-app/RFI tables was confirmed to be wrapped (would need per-instance verification; flagged as worth spot-checking on an iPhone).

---

## Mobile / PWA

**25. [Done well, verified]** Mobile responsiveness is unusually thorough for a tool this size: `styles.css:467-748` contains a large, well-commented `@media (max-width:768px)` block that explicitly re-flows the board/kanban to vertical stacks, converts drawers to bottom sheets, adds `env(safe-area-inset-bottom)` padding around the fixed bottom nav (`styles.css:469,525,598,663,711`), raises input `min-height` to 44px for touch targets (`styles.css:562`, with an explicit comment citing the iOS/Android 44px guideline), and even handles the iOS "no `beforeinstallprompt`" PWA-install gap with a manual `.mobile-more-ios-hint` (`styles.css:733-748`). This is genuinely above-average craftsmanship and reads like it was iterated on with a real phone in hand.

**26. [Low] One `!important`-laden mobile override pattern signals underlying specificity fights**
The mobile media query at `styles.css:467` uses `!important` on nearly every rule (`.board { display: flex !important; ... }`, dozens more). The in-code comments explain this is because desktop layout is often set via inline `style={{gridTemplateColumns:...}}` in the TSX (`BuilderPage.tsx`, `ElecProjectsPage.tsx` per the comments at lines 534-547), which inline styles can only be beaten by `!important`. This works today but is fragile — any new inline grid layout added to those big page files won't get mobile treatment unless someone remembers to also add a matching class + `!important` override in this one file.

---

## Copy / microcopy

**27. [Done well, verified]** Empty-state copy is consistently well-written and actionable rather than generic "No data" — e.g. `features/gen-projects/GenProjectsPage.tsx:236`: "No awarded generator installs yet. Mark proposals as Awarded in the Generator Proposals board," `features/bid-hub/OverviewTab.tsx:449`: "No scope yet — import a finished bid or fill it in Estimating," `features/docs/DocsPage.tsx:284`: "No documents yet — upload files above." No leftover Lorem-ipsum/TODO/placeholder copy was found anywhere in `features/`.

**28. [Low] Terminology drift between the two divisions' hub tabs**
`features/hubs/constants.ts:3-6` (Generators): Overview / Leads / Pipeline / Jobs. `features/hubs/constants.ts:9-12` (Electrical): Overview / Intake / Bids / Projects. The two divisions use different words for structurally parallel stages (Leads vs. Intake, Pipeline vs. Bids, Jobs vs. Projects). This may reflect genuinely different workflows per division (plausible for a contractor — worth confirming with the owner), but a new user switching between the Generators and Electrical hubs has to re-learn the tab vocabulary each time.

---

## Done well (additional, beyond what's cited inline above)

- **`lib/money.ts`** is a textbook "single source of truth" module — a decent template for how the date-formatting duplication (#8) should be fixed.
- **`hooks/useToast.ts`** + `Toast` component keep a simple, centralized global toast rather than several competing toast systems.
- **Legacy URL redirects** (`App.tsx:57-58`, `lib/legacyRoutes.ts`) show real care for not breaking old bookmarks/backend-emitted links when routes were reorganized into the hub structure.
- **PWA install/push handling** (`push.ts`) correctly gates all Push APIs behind feature-detection (`isPushSupported`) and has explicit iOS-standalone detection, rather than assuming desktop-Chrome-shaped browser APIs everywhere.

---

## Unverified (would need to run the app / a device to confirm)

- Whether `.table-scroll` is actually applied to every wide table in `ElecProjectsPage.tsx`'s CO/Pay App/RFI sub-tables on a real iPhone viewport (flagged in #24 but not exhaustively traced).
- Actual perceived jank from PcWorkspace's lack of memoization (#19) — inferred from the state/hook structure, not measured with the React profiler.
- Whether the four-grey token overlap (#10) is visually confusable in practice or just a maintenance-code-smell (would want a rendered side-by-side).
- Whether double-submit races (#21) are actually reachable given backend idempotency — not checked, since backend was out of scope.
