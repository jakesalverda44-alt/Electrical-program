# Estimating Phase B — Tasks 1–3 (Backend) Report

**Branch:** `feat/estimating-plan-viewer`, off local `main` (`c2fadef`)
**Worktree:** `../Electrical-program-wt-planviewer` (Local Version never touched)
**Commit range:** `991414f..b68acff` (4 commits: plan copy + Tasks 1–3)
**Executor:** Sonnet 5
**Scope:** Tasks 1–3 only (migration 108, sheets service + authenticated PDF
streaming, markups API + rollup + apply, and tracing/fixing where the
takeoff outputs read qty). Frontend (`frontend/`) was not touched at all —
confirmed by an unchanged frontend suite count (see below).

## Baseline (before any change, on this worktree at `c2fadef`)

- Backend (`npm test` in `backend/`): **974 passed, 978 total**, 107/108
  test files passed. The 1 failing file is `notificationsRetention.test.ts`
  (`Worker exited unexpectedly`) — the same pre-existing, code-unrelated
  flake both Phase A reports and reviews already documented; confirmed
  unrelated by inspection (this branch never touches its imports).
- Frontend (`npm test -- --run` in `frontend/`): **661 passed, 661 total**,
  89/89 test files passed.

## Final (after Tasks 1–3)

- Backend: **1074 passed, 1078 total**, 114/115 test files passed. Net:
  **+100 passed tests, +7 test files**, zero new failures. The one failing
  file is the same `notificationsRetention.test.ts` flake, unchanged.
- Frontend: **661 passed, 661 total**, 89/89 files — byte-for-byte identical
  to baseline, confirming zero frontend files were touched.
- `npx tsc --noEmit` in `backend/`: clean at every commit boundary.

## Commits

1. `991414f` — docs: copy the approved plan into the worktree (first commit,
   per the ground rules).
2. `da2c169` — Task 1: migration 108, stable `line_key`, `qty_source`.
3. `95b4ea4` — Task 2: sheets service + authenticated PDF streaming.
4. `b68acff` — Task 3: markups API + rollup + apply + takeoff-output routing.

---

## Task 1 — Schema (migration 108)

**Files:** `database/migrations/108_estimating_plan_viewer_schema.sql`,
`backend/src/estimating/bidEstimate.ts` (edited),
`backend/src/routes/estimating.ts` (edited),
`backend/src/test/estimatingPlanViewerSchema.test.ts`,
`backend/src/test/estimatingBid.test.ts` (edited — new describe blocks),
`backend/src/test/estimatingSchema.test.ts` (edited — one pre-existing test
narrowed, see below).

- `est_bid_lines.line_key uuid NOT NULL DEFAULT gen_random_uuid()`, unique
  index. `est_bid_lines.qty_source text CHECK IN ('takeoff','manual',
  'markup') DEFAULT 'takeoff'`, backfilled from `qty_overridden` for
  existing rows.
- `est_sheets` and `est_markups` tables and `est_default_drop_ft`/
  `est_default_slack_pct` app settings, exactly per the plan's field list.
  **Deliberately no hard FK** from `est_markups.line_key` to
  `est_bid_lines.line_key` (or a `DEFERRABLE` one) — `saveBidEstimate()`
  `DELETE`s and re-`INSERT`s every `est_bid_lines` row on every plain save;
  a same-transaction FK there buys correctness only if disciplined about
  re-supplying every `line_key` before `COMMIT`, which the code already
  does unconditionally anyway. The invariant is enforced at the application
  layer instead — the same trust level this schema already gives
  `est_bid_lines.takeoff_key`, a synthetic key with no FK either. Documented
  inline in the migration; worth a second look in review.
- **`saveBidEstimate()` now re-supplies each line's own `line_key`** on
  every delete+reinsert cycle: the client's value when it's a well-formed
  UUID, a freshly minted one (`crypto.randomUUID()`, computed in JS — never
  relies on the column's `DEFAULT`, since passing SQL `NULL` explicitly
  would trip the `NOT NULL` constraint instead of falling through to it)
  otherwise. `routes/estimating.ts`'s `validateLines()` only ever passes a
  UUID-shaped `line_key` through, so a client echoing back
  `getProposedLinesFromTakeoff()`'s `"proposed-0"`-style placeholder (a
  bid with no saved lines yet has nothing real to round-trip) safely mints
  a fresh key instead of erroring. `SaveResult` now also returns `lines`
  (the freshly-saved rows) so the client learns a brand-new line's real
  `line_key` without a second round-trip.
- `syncTakeoff()`'s existing `qty_overridden` preservation already keeps a
  line's UPDATE (not delete+insert) untouched aside from the columns it
  explicitly SETs — `line_key` was never at risk there. `qty_source` is
  carried through the same branch: kept as-is while `qty_overridden` stays
  true, reset to `'takeoff'` only when a line's qty actually refreshes from
  a re-run.
- **Test:** "save twice, sync, save again → keys stable" is covered by three
  dedicated tests in `estimatingBid.test.ts` (a brand-new line's key
  surviving an unchanged re-save; a takeoff line's key surviving
  save→sync→save; a non-UUID client value being dropped and replaced).
  `qty_source` round-tripping/backfill/explicit-value tests sit alongside.
- **Collateral fix:** `estimatingSchema.test.ts`'s "seeds the est_default_*
  app settings" test used a bare `LIKE 'est_default_%'` query, which now
  also matches migration 108's two new keys. Narrowed to the five keys
  migration 101 actually owns — each migration's seed test now owns only
  its own keys.

## Task 2 — Sheets service + PDF streaming

**Files:** `backend/src/estimating/pdfjsLoader.ts` (+ test),
`backend/src/estimating/scaleParse.ts` (+ test),
`backend/src/estimating/sheets.ts` (+ test),
`backend/src/test/fixtures/estimating/buildSheetPdf.ts`,
`backend/src/test/estimatingSheetsRoutes.test.ts`,
`backend/src/routes/estimating.ts` (edited), `backend/package.json` +
`package-lock.json`.

- **Library choice: `pdfjs-dist`, not `pdf-parse`** (both available;
  `pdf-parse` is an existing dependency). `pdf-parse`'s public API
  (`getText`/`getInfo`) exposes per-page width/height but **not** page
  rotation and **not** per-text-item positions. Both are required: rotation
  feeds `est_sheets.rotation` for the frontend viewer's future
  rotation-aware transforms (Decision 5), and per-item positions are what
  let this reuse `ai/pageClassifier.ts`'s own "right 25% strip, full
  height" title-block heuristic (`titleBlockCropRect`) on **text**
  coordinates instead of a rasterized image crop — restricting the
  sheet-no/title search to the strip, rather than the whole page, is what
  keeps it from picking up an unrelated tag or note elsewhere on a busy
  sheet (a dedicated test proves this: an "A1.1"-shaped string sitting
  outside the strip is correctly ignored in favor of the real sheet number
  inside it). `pdfjs-dist` gives `page.view`, `page.rotate`, and
  `getTextContent()` item transforms directly.
- **A real, load-bearing compatibility problem found and fixed before
  building anything on top of it:** `pdfjs-dist` 5.x ships ESM-only (no
  CJS build at all). This backend compiles under `module: "commonjs"`
  (`tsconfig.json`), and TypeScript **downlevels** a plain
  `await import(...)` to `Promise.resolve().then(() => require(...))`
  under that target — confirmed by compiling a throwaway file and reading
  the emitted JS. `require()` cannot load an `.mjs`-only package
  (`ERR_REQUIRE_ESM`), which would have made the sheets service crash at
  runtime the moment it actually ran (both in the real `ts-node-dev`/
  `tsc`-built server), while still *appearing* to work in some quick
  spikes run through `tsx` (a different, esbuild-based transform that
  doesn't downlevel dynamic import the same way — this discrepancy is
  exactly what would have let a runtime failure slip past a
  quickly-eyeballed spike). Fixed with the standard workaround:
  `pdfjsLoader.ts` routes the import through
  `new Function('specifier', 'return import(specifier)')`, hiding the
  specifier from TypeScript's static downleveling so it stays a **real**
  dynamic `import()` at runtime. Verified three ways before relying on it
  anywhere: (1) compiling with plain `tsc` and running the output directly
  with `node`, (2) the same under `vitest`'s own transform
  (`pdfjsLoader.test.ts`), (3) `npx tsc --noEmit` clean. `pdfjs-dist` is
  also added as an **explicit** dependency (`^5.4.296`, matching the
  version already resolved) — it was previously only reachable
  transitively through `pdf-parse`'s own internal use of it, which a
  future `pdf-parse` major bump could silently break.
- **Fixture:** `buildSheetPdf.ts` hand-builds a real, minimal, dependency-free
  vector PDF (no library — raw PDF object/xref syntax, following the
  existing `test/fixtures/buildTestPdf.ts` precedent but with individual
  text runs at explicit `(x, y)` positions and per-page `/Rotate`/blank-page
  control, which the existing generic builder doesn't support). **A real
  encoding gotcha caught by testing against actual `pdfjs-dist` output
  rather than assuming:** a base-14 font declared with no explicit
  `/Encoding` falls back to PDF `StandardEncoding`, whose apostrophe/quote
  glyphs are Unicode `U+2019`/`U+201D` ("quoteright"/"quotedblright"), not
  plain ASCII — so `"1'-0\""` in the content stream round-tripped through
  `getTextContent()` as `"1’-0”"`. Fixed by declaring
  `/Encoding /WinAnsiEncoding` on the fixture's font (matching how real
  CAD exports are actually encoded) — but `scaleParse.ts` also normalizes
  both quote-variant forms defensively either way, since a real-world PDF
  with unusual encoding is plausible.
- `scaleParse.ts` (pure): parses `1/8" = 1'-0"`, `1/4"=1'`, `3/32" = 1'-0"`,
  `1" = 20'`, `1:100`, `NTS` → none — exactly the plan's list — into
  feet-per-point, plus a `findScaleLabel()` that locates a scale expression
  inside a larger block of page text (trimming trailing title-block text
  that runs on past the expression itself). This is the module Task 5
  (frontend, out of scope this run) mirrors — there's no shared build
  target between `frontend/` and `backend/` in this repo, so it's a
  by-convention duplicate (same as `frontend/src/features/estimating/
  types.ts` already is for the wire types), not a literal shared import.
- Routes on `/api/estimating/:bidId`: `GET sheets` (build-on-first-call,
  cached in `est_sheets`; `?refresh=1` rebuilds but a page whose existing
  row has `scale_source='calibrated'` keeps its scale — verified by a
  dedicated test), `GET sheets/:documentId/file` (authenticated stream;
  see below), `PUT sheets/:documentId/:pageIndex/scale`.
- **Auth on the PDF stream route — checked twice, deliberately:**
  `loadAccessibleBid` gates the user against the bid in the URL (same as
  every other route in this router), and a *separate*
  `loadPlanDocumentForBid()` additionally requires the document's
  `linked_id` to equal that same bid id. A dedicated test proves the gap
  this closes: the **same** user, who legitimately owns **both** bid A and
  bid B, requesting bid B's document id under bid A's URL gets 404, not
  200 — access to *a* bid the user owns is not the same as access to *this*
  document.
- **Deferred: HTTP Range support on the streaming route.** The plan says
  "add Range support if feasible, otherwise full stream with a progress
  bar." `services/googleDrive.ts`'s `getFileMedia()` has no parameter to
  forward a `Range` header into the underlying Drive API call, and adding
  one touches a shared helper several other routes also call. Deferred
  rather than guessed at in isolation — better designed together with the
  frontend viewer's actual partial-load needs (Task 4, out of scope this
  run) than built speculatively now. Every response streams in full with
  `Cache-Control: private, no-store` (the plan's explicit "no caching
  headers that leak across users").
- Building `est_sheets` buffers a document's full bytes into memory once
  (pdfjs needs the whole PDF to parse its page tree — there's no
  meaningful way to stream-parse it); this is a one-time, cached-after
  indexing cost. It is **not** what the streaming route uses to serve bytes
  to the browser — that pipes the Drive/storage stream straight through
  without buffering, per the plan's "50–150MB plan sets: stream, don't
  buffer-to-base64" note.

## Task 3 — Markups API + rollup + apply

**Files:** `backend/src/estimating/markupMath.ts` (+ test),
`backend/src/estimating/markups.ts`,
`backend/src/estimating/pricing.ts` (edited — exports `UNIT_DIVISOR`),
`backend/src/estimating/bidEstimate.ts` (edited — `qty_source` into
`bid_estimates.line_items`), `backend/src/bidstd/composeBidData.ts` (edited)
+ `.test.ts` (edited), `backend/src/routes/estimating.ts` (edited),
`backend/src/test/estimatingMarkups.test.ts`.

- `markupMath.ts` (pure): `polylineLengthPt()`, `computeRunLengthFt()`
  (`(feet + drops * drop_ft) * (1 + slack_pct/100)`, throwing
  `MissingScaleError` for a null/zero/negative/non-finite scale rather than
  returning 0 or NaN), and `rollupLines()` — per line_key, confirmed count
  markers sum to an EA qty, confirmed linear runs sum to feet converted
  into the line's own display unit via the exact `UNIT_DIVISOR` table
  `pricing.ts` already prices with (now exported for this reuse). Suggested
  markups never count; a kind/unit-family mismatch (a count marker on an
  LF line, a linear run on an EA line) and a linear run on an unscaled
  sheet are both excluded from the rolled-up qty and reported back
  (`incompatibleCount`/`missingScaleCount`) rather than silently mis-rolled
  or aborting the whole rollup for one bad markup.
  - **A documented, deliberate interaction with a pre-existing Phase A gap
    (R2-N5):** converting feet into a line's display unit of `C`/`M` uses
    the standard divide-by-100/1000 convention — mathematically the
    literal "convert LF → the line's display unit" the plan asks for. How
    `pricing.ts` itself later interprets an *unmatched/manual* `C`/`M`-unit
    line's `qty` for material/labor extension was already flagged
    unfixed in the Phase A review (R2-N5) and is out of this task's scope;
    called out again here for the reviewer, with a worked test case
    (`markupMath.test.ts`) showing exactly what this module produces.
- `markups.ts` + routes: `GET markups` (by bid, optional
  document/page filter), `POST markups/batch` (create/update/soft-delete in
  one transaction; create is idempotent by the client-generated uuid — a
  retried/duplicated create for an id already persisted under **this** bid
  re-applies its values via `ON CONFLICT (id) DO UPDATE ... WHERE
  est_markups.bid_id = $bidId`, and silently no-ops rather than corrupting
  data if the id happens to collide with a *different* bid's row),
  `GET markups/rollup` (per line: marked qty, sheets contributing, current
  saved qty, and the takeoff's own fresh AI qty for comparison — reusing
  the already-exported `getProposedLinesFromTakeoff()` rather than
  reimplementing the takeoff-parsing/mapping it already does), and
  `POST apply-markups`.
- **`applyMarkups()` reuses the existing, already-reviewed
  `saveBidEstimate()` transaction** exactly as the plan specifies: it loads
  the current lines, patches the requested `line_keys`'
  `qty`/`qty_source='markup'`/`qty_overridden=true`/`confidence='FIRM'`,
  and calls `saveBidEstimate()` — so `bid_estimates`/`bids.amount` can
  never drift from `est_bid_lines`, for the same reason no other save path
  can. A line with nothing confirmed to apply (`markedQty` null) is
  **skipped with a reason**, never applied as a silent 0 — Decision 4's
  "never overwrites anything silently" holds here the same as for a manual
  edit. Every computed quantity is also explicitly re-checked
  (finite, non-negative) immediately before it's handed to the save path,
  per the hard safety rule, even though `rollupLines()`'s own math can't
  actually produce anything else given its validated inputs.
- **Sync-takeoff already treats a markup-confirmed qty like an estimator
  override, with zero new branching** — Task 1's `qty_overridden`
  preservation in `syncTakeoff()` is exactly what the plan asks for here
  ("sync-takeoff must treat qty_source='markup' like an estimator
  override... kept"), since `apply-markups` always sets both flags
  together. Verified with a dedicated regression test: apply a markup qty
  of 2 over an AI qty of 10, have the AI re-run and say 99, sync, and
  confirm the line stays at 2 with `qty_source` still `'markup'`.
  **Deferral:** the plan's "flagged if the AI qty later differs" (the
  *display* side of this, not the data-safety side) isn't built here — it
  needs the fresh takeoff qty surfaced next to the kept qty in the UI,
  which is Task 6/8 (frontend) territory. `GET markups/rollup`'s `aiQty`
  field already gives a future frontend everything it needs to compute and
  show that flag without another API round trip.
- **Trace and update the takeoff outputs (the plan's explicit closing ask
  for this task):** traced where "takeoff xlsx / bid_data takeoff /
  pre-bid package" actually read `qty`. All three turned out to fold
  through **one** function:
  `routes/preconstruction.ts`'s `/generate-takeoff-xlsx` and
  `/generate-prebid-package` both call `composeCurrentBidData()` →
  `composeBidData()` to build a `BidData`, and `takeoffXlsx.ts`'s
  `renderTakeoffXlsx()` (used by both routes, `prebid: false`/`true`) does
  nothing but render whatever `BidData.takeoff` already contains — it
  never reads `qty` itself. The proposal document's own embedded takeoff
  table is built from the same `data.takeoff`. So the one integration
  point that needed fixing was `composeBidData.ts`'s takeoff-item mapping,
  which already had a precedent to extend: it already prefers a saved
  line's confidence over Agent 4's own echoed value
  (`SavedConfidenceItem`/`confLookup`) — but that type had no `qty` field
  at all, so `bid_estimates.line_items[].qty` (which **was** already being
  written, just never read here) never reached the composed output.
  **Fixed, safely switched:** `SavedConfidenceItem` now also carries
  `qty`/`unit`/`qty_source`; `composeBidData()` overrides Agent 4's echoed
  `qty`/`unit` **only** when the matching saved line's `qty_source` is
  `'markup'` — a takeoff- or manual-sourced saved qty still defers to
  Agent 4's own echo, unchanged, so this doesn't widen scope beyond what
  Decision 4 actually asks for (a confirmed markup is authoritative; a
  bare manual edit isn't declared as such by the plan). This was safe to
  switch outright (not just report-and-stop) because the data was already
  flowing to that exact spot for confidence, on the same lookup key, via
  the same mechanism, with an existing, reviewed precedent — the only gap
  was one missing field on one interface. Proven end-to-end (not just at
  the pure-function level) in `estimatingMarkups.test.ts`: apply a markup
  → read `bid_estimates.line_items` back out of the real DB → feed it into
  `composeBidData()` with a constructed `Agent4Output` → assert the
  composed takeoff item's `qty` is the confirmed value, not Agent 4's.

### Takeoff-output tracing — explicit result

**Not blocked; fixed cleanly.** No path was found that couldn't be safely
switched — `composeBidData.ts` was the single, already-precedented choke
point for all three named outputs (GC takeoff xlsx, pre-bid package xlsx,
proposal's embedded takeoff table), so nothing needed a "stop and report"
instead of a fix.

## Deferrals (with reasons)

- **HTTP Range support on `GET sheets/:documentId/file`** — `getFileMedia()`
  has no parameter for it today; deferred to be designed together with the
  frontend viewer's actual partial-load needs (Task 4) rather than guessed
  at in isolation, per the plan's own "otherwise full stream" fallback.
- **Surfacing "AI qty now differs from your confirmed qty" in the UI** — the
  data (`GET markups/rollup`'s `aiQty` field) is there; the display/warning
  is Task 6/8 (frontend) work, out of scope for this backend-only pass.
- **Frontend Task 5's `qty_source`-setting UI for a plain manual qty edit**
  doesn't exist yet — `routes/estimating.ts`'s `validateLines()` already
  accepts an explicit `qty_source` from any future client and otherwise
  falls back to the same `qty_overridden`-implies-`'manual'` rule migration
  108 used to backfill existing rows, so today's (unmodified) Labor &
  Pricing UI keeps working exactly as before with no frontend changes
  required by this backend work.
- **Tasks 4–9 (frontend viewer, tools, items panel, suggested markers,
  integration, polish)** — explicitly out of scope for this run.

## Everything a reviewer should look at first

1. **`backend/src/estimating/pdfjsLoader.ts`'s indirect dynamic import** —
   the whole sheets service depends on this actually being a real ESM
   `import()` at runtime, not a downleveled `require()`. Verified three
   ways (see Task 2 above); worth an independent check given how easy this
   specific failure mode is to miss (it can look like it works under a
   quick `tsx` spike and still fail in the real server).
2. **`backend/src/estimating/bidEstimate.ts`'s `resolveLineKey`/
   `resolveQtySource` and the `saveBidEstimate()` INSERT** — the
   money-adjacent, safety-critical piece Task 1 exists for (markups must
   point at something that survives a delete+reinsert save).
3. **`backend/src/estimating/markups.ts`'s `applyMarkups()`** and its use
   of the existing `saveBidEstimate()` transaction — confirms the
   bid_estimates/bids.amount consistency guarantee actually holds for this
   new write path too, not just the ones Phase A's review already checked.
4. **`backend/src/bidstd/composeBidData.ts`'s qty-routing precedence** (only
   `qty_source==='markup'` overrides; `'takeoff'`/`'manual'` don't) — the
   one part of Task 3 that reaches outside the estimating module into a
   Phase-3/4 pipeline file shared with Agent 4's proposal generation.
5. **`database/migrations/108_estimating_plan_viewer_schema.sql`'s decision
   not to FK `est_markups.line_key` to `est_bid_lines.line_key`** — a
   deliberate tradeoff given the delete-and-reinsert save shape, documented
   inline; worth a second opinion on whether the application-layer
   enforcement is tight enough as markups load-bear more weight in Tasks
   4–9.

## Environment / safety notes

- Worktree only, at `../Electrical-program-wt-planviewer` off `main`
  (`c2fadef`); Local Version was never touched (confirmed clean before
  starting — its own pre-existing uncommitted changes to unrelated files
  are untouched).
- Every test run used `NODE_ENV=test DB_NAME=electrical_crm_test` (`npm
  test`'s own script, or explicit env when running a narrower `vitest run`
  directly) — the harness's `dbAvailable()` guard refused to run against
  `electrical_crm` (the live DB name) the one time a bare `vitest run` was
  tried without it, exactly as designed.
- No dev server was started at any point. No email, no real Google Drive or
  Anthropic API calls — every Drive interaction in tests mocks
  `services/googleDrive`'s `getFileMedia` (`vi.mock`, same pattern as the
  existing `driveProxyOwnership.test.ts`). No pushes.
- One expected, harmless flake was hit once and self-resolved on retry:
  migration 108's *first* application under two parallel vitest workers
  racing to insert the same `schema_migrations` row — documented as a
  pre-existing characteristic of `migrate.ts` in the Phase A report; not
  something this plan's scope touches.
