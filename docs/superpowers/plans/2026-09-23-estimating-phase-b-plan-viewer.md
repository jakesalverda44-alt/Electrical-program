# Estimating Phase B: Plan Viewer, Count Markup & Linear Measure

**Date:** 2026-09-23
**Status:** Approved by Jake ("let's do phase B"), pending implementation
**Planned by:** Opus 5.5 (main session) · **Execution:** Sonnet 5 · **Review:** Opus 5 (adversarial) → main session verdict (spot-checks)
**Depends on:** local main `c2fadef` (Phase A labor engine + estimating redesign merged)

## Why

Drawer AI / Togal / Accubid's takeoff screen make a takeoff *trustworthy*:
every count is a mark on the drawing you can see, and runs are measured to
scale. Today the AI's counts are a list with a sheet reference; nothing can
be checked on the plans without opening the PDF elsewhere and counting by
hand. Phase B puts the plans inside Estimating, lets the estimator confirm,
add and remove counts as markers, measure conduit/feeder runs, and push the
confirmed quantities into Labor & Pricing.

## Decisions (made; do not relitigate)

1. **Lives in the Takeoff step** of the Phase A step rail, as a
   **List | Plans** toggle. Plans view = sheet navigator (left) · drawing
   (center) · items panel (right). The Bid Summary panel collapses to its
   slim bar while Plans is open (the drawing needs the width).
2. **Desktop-first.** Below 900px the viewer is view-only (pan/zoom, see
   markers, no editing) with a one-line notice.
3. **AI counts have no coordinates.** Markers come from (a) the estimator
   clicking, and (b) **suggested markers from the PDF text layer**: fixture
   type tags / device labels found on plan sheets become dashed "suggested"
   markers the estimator confirms or rejects. Scanned (image-only) sheets get
   no suggestions — that is Phase C's job (symbol detection).
4. **Confirmed quantities win, explicitly.** A line's marked quantity never
   overwrites anything silently. "Apply marked qty" (per line or bulk) sets
   the est_bid_line qty with `qty_source='markup'`, `qty_overridden=true`,
   confidence FIRM, through the existing `saveBidEstimate` transaction. The
   same confirmed quantity must also reach the **takeoff outputs** (takeoff
   xlsx / bid_data takeoff / pre-bid package) so the GC sheet and the priced
   estimate never disagree — trace where those read qty and route them
   through the confirmed value (Task 3).
5. **Coordinates are stored in PDF user space (points)**, never screen
   pixels, so markups survive zoom, screen size and re-render.
6. **Scale is per sheet**, set by two-point calibration against a known
   dimension, with the title-block scale text ("1/8\" = 1'-0\"") parsed as a
   one-click suggestion. A sheet without a confirmed scale cannot be
   measured (tool disabled with the reason shown).
7. **Linear runs** = polyline length × scale, plus per-run adders:
   number of vertical drops × drop height (ft), then slack %. Defaults
   (drop 10 ft, slack 10%) are editable per run and in Labor Library →
   Defaults.
8. **No new heavy libraries.** Use the existing `pdfjs-dist` (already used by
   `gen-pipeline/SurveyMarkupEditor.tsx` — reuse its worker setup and
   patterns) with an SVG overlay. Custom pan/zoom. The viewer ships as its
   own lazy chunk.

## Out of scope

Symbol auto-detection / "find similar" / Python service (Phase C), area
takeoff, marked-up PDF export (follow-up), distributor pricing (D), job
actuals (E), multi-scale viewports within one sheet (warn only), Intake,
Leads, Generators.

## Environment facts

- Plan files are `documents` rows linked to the bid; 66/68 are Google Drive
  (`storage_url`), fetched server-side via `getFileMedia` (see
  `preconstruction.ts` `/analyze` ~1530) and served by the documents file
  route (`routes/documents.ts` ~143). The viewer must load PDFs through an
  authenticated backend route — never a public Drive link. Plan sets can be
  50–150 MB: stream, don't buffer-to-base64; support HTTP Range if the route
  can (pdf.js benefits), otherwise full stream with a progress bar.
- Sheet identity: `ai/pageClassifier.ts` produces `sheetNo`/title/discipline
  per page during a takeoff run. Trace whether results are persisted
  (takeoff_results / workspace); reuse them if so, else classify on demand
  via the same module (no AI call needed if the text-layer title block
  parse suffices — prefer text first, AI classifier only as fallback, and
  never without the `run_analysis` permission).
- Agent 1/2 output carries a source sheet per item (prompts.ts:14). Use it to
  jump from a line to its sheet(s).
- Phase A: `est_bid_lines` rows are **replaced on save** — row ids are not
  stable. Markups must reference a stable key (Task 1).
- Migrations: main is at **107**. This plan owns **108–110**.
  `migrate.ts` wraps each file in a transaction; destructive guard applies.
- UI kit: Modal, ConfirmDialog+Undo, Badge, useApi, useMutation,
  useUnsavedGuard, tokens in styles.css, `features/estimating/estimating.css`.
  z-index above drawers ≥ 250.
- Known flakes: backend `notificationsRetention.test.ts` (heap OOM, also on
  main); frontend `SurveyMarkupEditor.test.tsx` (intermittent).

## Ground rules (permanent)

- Worktree only, from Local Version:
  `git worktree add "../Electrical-program-wt-planviewer" -b feat/estimating-plan-viewer main`
  (quote paths). `npm install` both sides. Never edit Local Version (live app
  under ts-node-dev --respawn; Jake has uncommitted edits there). **Never
  start dev servers.** Tests only via `npm test` (backend targets
  `electrical_crm_test`). Never touch the `electrical_crm` DB, never send
  email, never call Google Drive or Anthropic APIs from tests (mock them).
  No pushes.
- First commit: this plan copied into the worktree.
- One commit per task (or per coherent sub-step), imperative message ending
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Every behavior change has tests. Geometry and rollup math get exhaustive
  pure unit tests.
- Report: `docs/superpowers/plans/2026-09-23-phase-b-report.md` — per task:
  commits, files, tests, deferrals with reasons, suite counts vs baseline.

---

## Tasks

### Task 1 — Schema (migration 108)

- `est_bid_lines.line_key uuid NOT NULL DEFAULT gen_random_uuid()` — stable
  across saves. `saveBidEstimate` and sync-takeoff must **preserve** a line's
  `line_key` (client round-trips it; server keeps existing keys, mints new
  ones only for new lines). Test: save twice, sync, save again → keys stable.
- `est_bid_lines.qty_source text CHECK in ('takeoff','manual','markup')`
  default 'takeoff' (backfill existing: qty_overridden → 'manual').
- `est_sheets` — `bid_id`, `document_id`, `page_index int`, `sheet_no`,
  `title`, `discipline` (E/A/M/P/other), `kind` (plan/schedule/detail/
  riser/cover/other), `width_pt`, `height_pt`, `rotation`,
  `ft_per_pt numeric null`, `scale_source` ('calibrated'|'titleblock'|null),
  `scale_label text`, `has_text_layer bool`, pk `(document_id, page_index)`,
  index on bid_id.
- `est_markups` — `id uuid`, `bid_id`, `document_id`, `page_index`,
  `line_key uuid null` (null = unassigned), `kind` ('count'|'linear'),
  `points jsonb` (array of [x,y] in PDF points; count = one point),
  `drops int default 0`, `drop_ft numeric`, `slack_pct numeric`,
  `status` ('confirmed'|'suggested'), `label text`, `created_by`,
  timestamps, `deleted_at` (soft delete for undo). Indexes on
  `(bid_id)`, `(document_id, page_index)`, `(line_key)`.
- App settings defaults (insert-if-absent): `est_default_drop_ft` 10,
  `est_default_slack_pct` 10.

### Task 2 — Sheets service + PDF streaming

- `backend/src/estimating/sheets.ts`: build/refresh `est_sheets` for a bid's
  plan documents (PDFs only): page count + page sizes + rotation (pdf-parse
  or pdfjs-dist legacy build in Node — pick one, report why), text-layer
  presence, sheet no/title from the title-block text (reuse
  pageClassifier's pure helpers such as `formatSheetLabel` and its
  right-strip heuristic), and the scale label parse (Task 5's parser lives
  in a shared pure module used by both sides).
- Routes on `/api/estimating/:bidId`:
  - `GET sheets` — list (builds on first call, cached in est_sheets;
    `?refresh=1` rebuilds, preserving calibrated scales).
  - `GET sheets/:documentId/file` — authenticated PDF stream. Reuse the
    documents route's access check and Drive fetch; add Range support if
    feasible; correct content-type; no caching headers that leak across
    users.
  - `PUT sheets/:documentId/:pageIndex/scale` — `{ft_per_pt, source, label}`,
    validated finite > 0.
- Bid access check on every route (same helper as Phase A routes).
- Tests: sheet index from a small fixture PDF (commit a tiny multi-page
  vector PDF fixture with text: a title block "E1.1 LIGHTING PLAN",
  "SCALE: 1/8\" = 1'-0\"", and a few tag strings), refresh keeps calibrated
  scale, auth 403/404, Drive fetch mocked.

### Task 3 — Markups API + rollup + apply

- `estimating/markupMath.ts` (pure): polyline length in points; feet =
  length × ft_per_pt; run LF = (feet + drops × drop_ft) × (1 + slack/100);
  per-line rollup: confirmed count markers → EA qty; confirmed linear →
  LF sum; suggested markers never count. Unit compatibility: a count
  markup can only roll into an EA-family line, linear into LF/C/M (convert
  LF → the line's display unit). Tests: every formula, rotation-agnostic
  (points already in user space), zero-length, missing scale → error.
- Routes: `GET markups` (by bid, optional document/page), `POST markups/batch`
  (create/update/delete in one call, idempotent by client-generated uuid —
  the viewer autosaves in batches), `GET markups/rollup` (per line_key:
  marked qty, count by sheet, vs current line qty and AI qty).
- `POST apply-markups` `{line_keys: [...]}` → for each line, qty := rollup,
  `qty_source='markup'`, `qty_overridden=true`, confidence FIRM, via the
  `saveBidEstimate` transaction (bid_estimates + bids.amount stay
  consistent). Then **trace and update the takeoff outputs** (takeoff xlsx,
  bid_data takeoff composed in `composeBidData`, pre-bid package) so they
  use the confirmed qty for those lines. Document exactly which fields/paths
  you changed in the report. If a path can't be switched safely, stop and
  report instead of guessing.
- Sync-takeoff (Phase A) must treat `qty_source='markup'` like an estimator
  override (kept, flagged if the AI qty later differs).
- Tests (test DB): batch create/update/delete, soft delete, rollup,
  apply → est_bid_lines + bid_estimates + bids.amount + composeBidData
  takeoff all show the confirmed qty; sync keeps markup qty.

### Task 4 — Viewer core (frontend)

`frontend/src/features/estimating/plans/`:

- `PlanViewer.tsx` — loads a document via the streaming route with pdf.js
  (reuse SurveyMarkupEditor's worker config), renders the current page to a
  canvas; pan (drag / space+drag / trackpad), zoom (wheel/pinch/+−/fit
  width/fit page), zoom around cursor. Cap canvas area (≤ 16.7M px) — past
  that, render only the visible region at full resolution (re-render on
  settle, show the lower-res page underneath while it renders). Cancel stale
  render tasks; destroy pages/doc on unmount (memory).
- `overlay.ts` (pure) — PDF-point ↔ screen transforms from the pdf.js
  viewport (rotation-aware). Exhaustively tested.
- SVG overlay layer draws markers/runs in PDF coordinates via the transform.
  Must stay smooth with 1,000 markers on a sheet (no per-marker React state
  churn on pan — transform the group, not each child).
- `SheetNavigator.tsx` — list of sheets (sheet no + title, discipline
  filter, "E" sheets first), per-sheet marker counts, current highlight,
  keyboard ↑/↓.
- Loading, progress (bytes) and error states (Drive unavailable, not a PDF,
  password-protected).
- Tests: transforms, navigator, viewer with pdf.js mocked (render calls,
  cancellation, cleanup).

### Task 5 — Tools

- Toolbar: **Select/Pan (V)**, **Count (C)**, **Linear (L)**, **Scale (S)**,
  Delete (Del/Backspace), Undo/Redo (⌘Z / ⇧⌘Z), Esc cancels.
- Count: click drops a marker assigned to the active line (colored per line,
  consistent palette, legend in the items panel). Click an existing marker
  in Select to select; drag to move; shift-click multi-select; reassign
  selected markers to another line.
- Linear: click points, double-click/Enter finishes; live length label;
  after finishing, a small inline popover for drops / drop height / slack
  (defaults from settings). Edit points later in Select.
- Scale: if the title-block label parsed, offer "Use 1/8\" = 1'-0\"" in one
  click (convert architectural/engineering scales to ft_per_pt: 72 pt/in);
  otherwise / additionally, two-point calibrate: click two points, enter a
  known length (ft-in input: `12'6"`, `12.5`, `150'`). Show the sheet's scale
  in the toolbar; warn "verify scale" if calibrated and title-block scales
  disagree by >2%.
- `scaleParse.ts` (pure, shared shape with backend): parses `1/8" = 1'-0"`,
  `1/4"=1'`, `3/32" = 1'-0"`, `1" = 20'`, `1:100`, `NTS` (→ none). Tests for
  each, plus garbage input.
- Undo/redo stack covers create, move, delete, reassign, scale changes.
- Autosave: debounce 800ms → `POST markups/batch`; save indicator; register
  `useUnsavedGuard` while a batch is pending or failed.
- Tests: each tool's state machine, undo/redo, scale parser, ft-in parser,
  autosave batching + guard.

### Task 6 — Items panel + apply

- Right panel lists est_bid_lines grouped by category (same grouping as
  Labor & Pricing): color swatch, description, **AI qty · marked qty ·
  current qty**, status chip (Matches / Differs / Not marked / Applied),
  sheets where marked. Click → active line (and filter/highlight its
  markers; "show only this line" toggle). "Jump to source sheet" uses the
  line's AI source sheet.
- "Apply marked qty" per line and "Apply all that differ" (ConfirmDialog
  listing each change old → new, with $ impact from a `POST /price`
  preview). After apply, Labor & Pricing and the Bid Summary refresh.
- "New line from markup": create a manual est_bid_line (description, unit,
  library match via the Phase A resolver) and assign selected markers.
- Unassigned markers bucket.
- Tests: statuses, apply flow payload + confirm contents, new line flow.

### Task 7 — Suggested markers from the text layer

- `tagSuggest.ts` (pure): given pdf.js text items (str + transform) for a
  page and a list of tags, return candidate points (center of the matched
  text run) with the tag. Exact token match, case-insensitive, whole token
  only (tag "A" must not match "A1" or "AMP"); ignore text inside the title
  block strip and on sheets whose `kind` is schedule/cover/riser; ignore
  matches inside detected table regions (dense aligned text grids — simple
  heuristic, tested).
- Tags come from: the takeoff's fixture types / device labels where Agent 1
  output carries them (trace the fields), plus a user-entered tag per line
  ("Find tag on sheets…").
- UI: "Suggest markers" per line or per sheet → dashed markers with a
  count ("12 suggested"); Confirm all on this sheet / click to confirm /
  Reject all. Suggested markers never roll up until confirmed.
- Sheets without a text layer show "No text on this sheet — suggestions
  unavailable (scanned drawing)".
- Tests: whole-token matching, title-block exclusion, table heuristic,
  schedule-sheet exclusion, rotated text.

### Task 8 — Integration & summary

- Takeoff step: **List | Plans** toggle (remember per user in localStorage,
  try/catch). URL `?step=takeoff&view=plans&sheet=<doc>:<page>&line=<key>`.
- From Labor & Pricing: each line gets a "Show on plans" action → Plans view
  focused on that line.
- Bid Summary warnings: "N lines not verified on plans" (lines with AI qty
  but no confirmed markups and qty_source ≠ markup), "N sheets without
  scale have linear markups" (should be impossible — defensive).
- Pre-send checklist in Review & Proposal gets the same verification count
  (informational).
- Tests: toggle/URL round-trip, deep link, warnings.

### Task 9 — Polish, responsive, performance

- <900px: view-only mode (tools hidden, notice). 900–1279: navigator
  collapses to a dropdown. ≥1280: three columns.
- Plan paper stays white in dark mode; chrome follows theme.
- Keyboard shortcut help (`?`).
- Lazy chunk for `features/estimating/plans` — main bundle must not grow
  (extend `App.codeSplitting.test.tsx`).
- Report perf notes: time-to-first-render and pan smoothness on the fixture
  (measured in tests where possible, otherwise reasoned).

---

## Review & merge

1. Sonnet executes Tasks 1–3 (backend), reports; then 4–9.
2. Opus adversarial review: stable line_key through every save/sync path,
   apply → pricing + takeoff outputs consistency, auth on the PDF stream
   route (no cross-bid document access by id), memory/perf of the viewer,
   transforms under rotation, undo/redo integrity, autosave data loss,
   suggested markers never counted, scale math.
3. Fix rounds; main session spot-checks and gives the verdict.
4. Jake approves merge; verify health + migrations 108–110 on restart.
5. Jake test-drives on one real plan set: calibrate a sheet, count one
   fixture type, measure one run, apply, check pricing + takeoff xlsx.
