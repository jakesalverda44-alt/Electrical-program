# Mobile Field Pack — Design

**Date:** 2026-08-03
**Status:** Approved by Jake
**Scope:** Make the phone experience work for the three field flows Jake actually uses — site visits, fast lead response, building/sending proposals — plus foundation fixes every mobile user hits, plus PWA install. Desk-oriented pages (ElecProjects 12-tab workspace, Intake rail, report tables) are explicitly OUT of scope beyond a generic table-scroll wrapper.

## Background (from the 2026-08-02 mobile audit)

The app has exactly one meaningful mobile block (`styles.css:515-630` @768px) and large gaps: HTML5 drag-and-drop never fires on touch and the tap-advance button is invisible (hover-reveal `opacity:0`); the new HubTabs bar is inline-styled with no overflow handling so media queries can't reach it; `.mobile-nav` (z-index 200) floats over open drawers (z-index 160); `.app{padding-bottom:64px}` ignores `env(safe-area-inset-bottom)` so notched iPhones lose ~34px; every `.ctable` clips into `body{overflow-x:hidden}` with no scroll wrapper; the leads list is a 7-column grid inside `overflow:hidden`; the customer e-sign page renders 8–9px contract type in ~271px and its `proposal-embed` class has no CSS definition anywhere; PWA manifest/icons/viewport are already valid but the service worker only registers when enabling push in Settings and no install affordance exists. Two dead-CSS bugs: `.split` collapse targets flex on a grid container; `.sd-col .amt` mobile rule styles an element already `display:none`.

## 1. Foundation fixes

- **Touch stage-advance:** `.bcard-adv` becomes always-visible on touch devices via `@media (hover: none) and (pointer: coarse)` — opacity 1, min 40px touch target. Desktop keeps hover-reveal and drag-and-drop. No DnD library is added; phone stage changes = advance button + drawer stage buttons (both already exist).
- **Drawer vs nav z-index:** when a drawer/bottom-sheet is open it must cover the bottom nav — raise `.drawer-overlay`/`.drawer` above `.mobile-nav` (e.g. overlay 240/drawer 250 vs nav 200). Same for `.gp-detail-panel` sheet.
- **Safe area:** `.app` mobile padding becomes `calc(64px + env(safe-area-inset-bottom))`.
- **HubTabs:** add `overflowX:'auto'`, `whiteSpace:'nowrap'` on the bar, `flexShrink:0` and comfortable touch height (≥44px) on the buttons — same pattern as `ElecProjectsPage.tsx` workspace tabs.
- **Tables:** new `.table-scroll` wrapper class (`overflow-x:auto; -webkit-overflow-scrolling:touch`) applied around every `.ctable` render site. Mechanical, app-wide (this one crosses the scope line on purpose — it's one wrapper div per site and turns "clipped/unreachable" into "scrollable").
- **Dead CSS fixes:** `.split` mobile collapse uses `grid-template-columns:1fr` (it's a grid); remove the dead `.sd-col .amt` rule at `styles.css:622`. `.field-row` collapses to one column ≤480px (currently only `.field-row3` does).

## 2. Site-visit flow — Lead Site Survey

A mobile-first guided questionnaire on the lead that maps **deterministically** onto the proposal form (`GenForm`) — no AI extraction. Replaces both the previously-planned SiteVisitChecklist rebuild (checklist is post-award/desk work) and any build-from-notes polish.

**Entry:** "Start Site Survey" button in `LeadDetailDrawer` (prominent on mobile). Re-entering resumes where it left off.

**Storage:** new `leads.survey_data JSONB` column (migration; default NULL). Answers save on every step (PATCH), so a survey survives app close mid-visit. Shape mirrors GenForm field names 1:1 where applicable (`jobType`, `brand`, `coolingType`, `size`, `fuel`, `genSide`, `panelRel`, `panelFt`, `feedFt`, `pad`/`genStand`, `gasLine`, `removal`, `liftType`, `battery`, `emPanel`, `surgeProQty`, `smmQty`, plus `sizingNeeded: boolean` and `notes: string`).

**Sections (one per screen, big touch targets, every question skippable):**
1. **Job type** — New Install / Swap-Out (drives branching below)
2. **Unit** — brand (Kohler/Generac), cooling type, size — or "Needs sizing" (sets `sizingNeeded`, leaves size at default)
3. **Fuel** — Natural Gas / LP
4. **Placement** — side of house (Left/Right), position vs panel (same/opposite/next-to), distance from panel (ft, hidden when next-to), electrical feed distance (ft), base: Concrete Pad / Gen Stand small / Gen Stand big / existing pad (swap-out)
5. **Swap-out only** — gas line disconnect & reconnect needed, removal/haul-off needed
6. **Access** — lift: none / lull / crane
7. **Extras** — battery maintainer, EM panel, surge protector qty, SMM qty
8. **Photos** — `RecordFiles` with `cameraFirst`, attached to the lead (`div="gen"`-style linkage per existing RecordFiles contract on leads — if RecordFiles doesn't support lead linkage today, extend its `linkedId` usage the same way other records use it)
9. **Notes** — free text

**Finish:** "Build Proposal from Survey" → calls the existing lead→gen creation path (`POST /leads/:id/create-gen` or equivalent) extended to merge `survey_data` over `blankGenForm()` (respecting the Gen Stand↔pad exclusion and swap-out defaults that `BuilderPage` applies), then opens the Proposal Builder for price review. Survey answers that map to internal-only fields (`feedFt`, `genSide`, `panelRel`, `panelFt`) flow into the same fields used by the award kickoff email. Photos on the lead carry to the proposal if a linkage exists post-conversion; if the existing conversion doesn't move/link files, add the link so site photos are visible from the gen record.

**Non-goals:** no offline queueing (needs network, same as rest of app); no editing surveys from desktop pipeline views (the lead drawer works on desktop too — that's enough).

## 3. Leads flow

- **Lead list → cards on mobile:** ≤768px the 7-column grid renders as stacked tappable cards: name, source badge, stage chip, `tel:` phone link, days-old. Desktop grid unchanged. (Current grid is inline-styled — restructure so the mobile variant is reachable: conditional render or CSS-class-based grid.)
- **LeadDetailDrawer:** its inline `1fr 1fr` grids collapse to one column on mobile.

## 4. Proposal flow

- **BuilderPage inner grids** (`'1fr 1fr'`, `'80px 1fr'` etc.) collapse to one column ≤768px (outer layout already collapses). Inputs get ≥44px touch height on mobile.
- **Customer e-sign page (`ProposalPublicPage` + `ProposalPreview embed`):** define the missing `proposal-embed` CSS. On phone: body type ≥12px, fluid/stacking tables, gutters reduced (kill the nested 36px page padding in embed mode), signature area comfortable. Print/desktop rendering unchanged (embed-mode-scoped rules only). This is customer-facing revenue surface — treat as the highest-value single item.

## 5. PWA install

- Service worker registers at app boot (main.tsx), not only when enabling push.
- `beforeinstallprompt` captured in a small hook → "Install App" item in the mobile More sheet (Android/desktop Chrome). iOS: one-time dismissible hint card (Share → Add to Home Screen), dismissed state persisted in localStorage, never shown when already standalone (`display-mode: standalone` / `navigator.standalone`).
- No offline caching added (sw stays push-only) — out of scope.

## Testing

- Existing suites stay green; both tsc clean. Two pre-existing backend integration failures (Kohler-brief, GC-canonicalization) remain out of scope.
- New unit tests: survey→GenForm mapping (pure function — the core of §2), lead-card mobile rendering, install-prompt hook state machine.
- Manual mobile viewport pass at the end (375px + notch simulation): every flow in §2-4, drawer/nav layering, hub tabs scroll.

## Execution model

Spec+plan authored with Fable 5; Sonnet 5 subagents implement task-by-task with per-task reviews; Fable 5 whole-branch review before the PR merges. One PR. Branch: `feat/mobile-field-pack`.
