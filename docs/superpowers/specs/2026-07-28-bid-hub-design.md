# Bid Hub — Estimating/Pipeline Flow Redesign

**Date:** 2026-07-28
**Status:** Approved design, pending implementation plan
**Planned by:** Fable 5 · **Execution:** Sonnet 5

## Problem

A bid currently has two disconnected homes: the pipeline drawer (stage, GC, amount, files) and the estimating workspace (scope, takeoff, import, RFIs). Concrete symptoms:

1. Files imported via bid-import show in the pipeline drawer but not in estimating — `PcWorkspace.tsx:425-433` filters project docs to PDF/image (a filter written for the AI vision pipeline), dropping the imported `.docx` proposal and `.xlsx` takeoff. Estimating's file lists also have no view/download actions at all.
2. Clicking "view" on a file downloads it — `RecordFiles.tsx:111-137` anchors directly at the Cloudinary URL (`resource_type: raw` serves `application/octet-stream`), bypassing the backend `/api/documents/:id/view` endpoint that already sets correct inline content types.
3. Estimating overview shows almost nothing about the project (3 stat tiles + notes). No scope of work, sq ft, GC, due date, stage.
4. Contacts → GC shows only Open and Awarded bids. Lost is computed but never rendered (`CustomerHub.tsx:132-134`); Submitted is lumped into Open.
5. Bid card click opens a cramped 500-line single-scroll drawer, not deep-linkable.
6. Bid comparison exists (`BidCompare.tsx`, `/comparables` + `/compare` endpoints) but is buried in a manual tab, shows raw side-by-side numbers with no deltas or normalization, hides won/lost outcome, and can't work for new bids because brand/project_type are never captured at bid creation.

## Decisions (user-approved)

| Decision | Choice |
|---|---|
| Bid detail architecture | **One Bid Hub page** at `/bid/<id>` — estimating merges in as a tab |
| Estimating nav section | **Removed** — pipeline is the single entry point |
| Office file viewing | **In-app preview** — SheetJS for `.xlsx`, mammoth for `.docx` |
| Comparables timing | **Live in add-bid form** as brand/type/sqft are typed, plus panel on Hub Overview |

## Design

### 1. Bid Hub page — `/bid/<id>`

New full page. Routing: add `case 'bid':` to the `renderView()` switch in `App.tsx` (`viewParam` = bid id). Tab deep-link via query or sub-segment (`/bid/<id>/estimating`). Tab strip reuses the segmented-pill pattern from `GenDetailDrawer.tsx:160-170`.

**Tabs:**

- **Overview**
  - Stat row: contract amount, sq ft, project type, due date, sheet count
  - Stage pills (due → submitted → awarded/lost) + lifecycle timeline (moved from drawer)
  - Scope of Work: A–G sections from `bid_workspaces.scope` (auto-filled by import; read-only summary here, editable in Estimating tab) + takeoff category rollup from `bid_takeoffs`
  - GC / contact / salesperson block; win-rate bar; bid score
  - **Similar Past Bids panel**: top 3–5 comps — brand, sq ft, $/SF, won/lost badge, final amount; links to Compare tab
  - Quick actions: Draft Email to Team, Close Job, Delete, edit fields (name, gc, loc, amount, due, sheets, contact, sq_ft, project_type, **brand**)
- **Estimating** — `PcWorkspace` content moves here whole: 7-step tracker, Import Finished Bid, RFIs, AI takeoff pipeline, pricing, notes. No feature loss. Autosave behavior unchanged.
- **Compare** — upgraded `BidCompare` (see §4)
- **Files** — single unified `RecordFiles` list of all `documents` rows for the bid, each with View + Download (see §3)
- **Activity** — lifecycle timeline detail, lost-reason/competitor form

**Pipeline board:** card click navigates to `/bid/<id>` (replaces `DetailDrawer`). Card keeps quick stage-advance arrow and inline lost-confirm. "Open in Estimating" button becomes "Open" → Hub. `DetailDrawer.tsx` is deleted once Hub reaches parity.

### 2. Navigation changes

- Remove Estimating/Preconstruction from sidebar nav.
- `/preconstruction` route redirects to `/pipeline`; if a bid was active, to that bid's Hub Estimating tab.
- `PreconstructionPage` list view retired. (Its "work queue" value is deferred — YAGNI per user decision.)

### 3. File handling fixes

- **Estimating filter bug:** remove the PDF/image filter from the general project-files list; keep it only for the AI-vision selection checklist where it belongs (`PcWorkspace.tsx:425-433`, duplicate at `672-679`).
- **Download path:** `RecordFiles` download goes through `GET /api/documents/:id/download`; view goes through `/view` (already correct). Never anchor raw Cloudinary URLs.
- **Viewers:** PDF/image → existing blob-tab inline view. `.xlsx` → SheetJS table-preview modal (SheetJS already a backend dep; add frontend usage). `.docx` → mammoth HTML-preview modal (new small dep). Everything else → download only, labeled as such.
- **Categories:** add `takeoff` + `cost_breakdown` labels to `RecordFiles` `CATEGORIES`/`CAT_LABEL`. New migration restores `change_order`, `submittal`, `rfi` to the `documents.category` CHECK constraint (dropped by `068`, currently causes 23514 on upload).

### 4. Comparables

**Data capture (prerequisite for everything else):**
- `brand` field added to: AddBidModal, Hub edit form, intake→bid creation (`intake.ts` also gains `project_type`). `POST /bids` accepts `brand`.
- Brand input = autocomplete over `SELECT DISTINCT brand FROM bids` (free text allowed; no managed list).

**Live comps in add-bid form:** as brand/project_type/sq_ft are entered, debounced call to a new `GET /api/bids/comparables-preview?brand=&project_type=&sq_ft=` returns a one-line summary + top 3 matches ("3 past Sonny's car washes · avg $28/SF · 2 won 1 lost"). Reuses the `/comparables` matching query, parameterized instead of subject-bid-based.

**Compare tab upgrades (`BidCompare`):**
- Takeoff quantities normalized per 1,000 SF (raw value on hover/secondary line).
- Computed deltas vs comp median with outlier highlighting (e.g. subject fixtures +40% vs comps → flagged row).
- Outcome column: won/lost badge + `date_won`/`awarded_at` where present.
- Render already-fetched-but-unused cost data: labor rates, crew size, journeyman/apprentice hours, labor risk ratio.
- **Benchmark mode:** subject bid with no takeoff/breakdown yet → show comps' cost profile (avg $/SF by driver, typical category mix) as a pricing guide instead of amber "differs on every row" noise.
- Empty-state messaging distinguishes "no brand/type set on this bid" from "no comparable jobs in library".

**Security fix (required):** `/comparables` and `/compare` must apply rep ownership scoping to comp rows, not just the subject bid (currently leaks other reps' bid names, GCs, amounts, cost breakdowns — contrary to `ownership.ts` model). `/takeoff` drill-down 403 surfaces as an error, not "no items".

**Robustness:** `ORDER BY` NULL-brand quirk fixed (NULL subject brand must not rank other unbranded bids first); stale `error` state cleared on successful re-fetch.

### 5. Contacts GC view

- Bid list grouped **Open / Submitted / Awarded / Lost** (client-side; backend already returns all stages).
- Each bid row links to its Bid Hub.
- Documents panel rows get inline View (via `/view`) alongside Download.

## Error handling

- Hub with unknown/deleted bid id → friendly not-found with link back to pipeline.
- File preview failures (corrupt xlsx, huge docx) → fall back to download with message.
- Comparables preview endpoint failures in add-bid form are non-blocking (form still submits).

## Testing

- Backend: route tests for comparables-preview, ownership scoping on `/comparables`//`/compare`, `POST /bids` brand, migration constraint (category restore).
- Frontend: Hub tab rendering + deep link, files list shows docx/xlsx, contacts grouping.
- Manual smoke on Render after deploy: import a finished bid → files visible + viewable in Hub Files; create new bid with brand → live comps appear.

## Implementation phasing (for Sonnet 5)

1. **Phase 1 — Bid Hub shell:** route, tabs, Overview (moved drawer content), Estimating tab (PcWorkspace relocation), pipeline card navigation, nav removal + redirect. Drawer deleted at parity.
2. **Phase 2 — Files:** filter fix, download/view paths, xlsx/docx previews, category labels + constraint migration.
3. **Phase 3 — Comparables:** brand capture everywhere, live add-bid comps, Compare tab upgrades, benchmark mode, ownership scoping fix.
4. **Phase 4 — Contacts:** stage grouping, Hub links, inline doc view.

Each phase is independently shippable via the standard branch → PR → Render auto-deploy loop.
