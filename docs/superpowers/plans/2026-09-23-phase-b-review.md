# Estimating Phase B (Plan Viewer): Adversarial Review

**Branch:** `feat/estimating-plan-viewer` (`main..43f6deb`, 25 commits, 83 files, +12,682/-35)
**Reviewer:** Opus 5 (independent, read-only)
**Date:** 2026-09-23

## Verification run

| Check | Result |
|---|---|
| `npm test` (backend, `electrical_crm_test`) | **1074 passed / 1078**, 114 of 115 files. The file that didn't report is `notificationsRetention.test.ts` ("Worker exited unexpectedly"). That's the known flake, and the branch doesn't touch it. |
| `npx tsc --noEmit` (backend) | clean |
| `npx vitest run` (frontend) | **1003 passed / 1004**, 111 of 112 files. The one failure is `SurveyMarkupEditor.test.tsx` (Escape/fullscreen). It passed 2 of 2 times when run alone, and the branch doesn't touch `gen-pipeline/`, so it's the known flake. |
| `npx tsc --noEmit` (frontend) | clean |

**How findings were reproduced.** I built a throwaway detached worktree (since removed) and ran repro tests in it against `electrical_crm_test`, plus pure scripts:

- Backend repros **R1–R5**: supertest against the real routes, plus `composeBidData`.
- Frontend repros **F1–F5** and **R6**: vitest against the real `PlansWorkspace` and `useEstimatingBid`, with the same mocks the branch's own tests use.
- A **pdf.js 4.10 geometry script**: the frontend's own `pdfjs-dist` legacy build run in Node against hand-built PDFs. It was checked against `overlay.ts`'s matrices.
- A **`rollupLines` → `priceBid` unit script**.

Each finding below is marked **[reproduced]** or **[reasoned]**.

**The foundations hold. Most of what breaks is the wiring above them.**

- `line_key` survives save and sync.
- `applyMarkups` goes through the single `saveBidEstimate` transaction.
- Suggested markers are filtered out of the rollup.
- The scale math uses 72 pt/in correctly.
- The tile math and the zero-origin rotation matrices match pdf.js exactly.

The wiring has problems in three places: how the Plans view hands state to `useEstimatingBid`, how autosave reconciles with the server, and what "Applied" means once more markers are added.

---

## Blockers

### B1. After Apply or "New line from markup", the Labor & Pricing state is never refreshed, so the next save silently reverts the applied quantities and deletes the new line [reproduced: R6]

- **Evidence.**
  - `PcWorkspaceView.tsx:1163` passes `onApplied={estimatingBid.reload}`.
  - `reload` is `useApi`'s refetch, but the only consumer of `data` is the hydration effect, which returns early once hydrated (`useEstimatingBid.ts:74`: `if (!data || hydratedRef.current) return;`). So `lines`, `recap`, `savedGrandTotal` and `persistedRef` all stay at their pre-apply values.
  - `createLineFromMarkup` then PUTs `[...lines, newLine]` built from that stale `lines` prop (`PlansWorkspace.tsx:457`).
- **Failure.** R6 hydrated v1 (qty 10, `qty_source 'takeoff'`), called `reload()` with v2 on the server (qty 24, `'markup'`), and read the result:
  - `lines[0].qty` stayed 10 and `savedGrandTotal` stayed at the old value.
  - The next `save()` PUT `{"qty":10,"qty_source":"takeoff"}` with no `qty_overridden`, which reverts the applied 24 in `est_bid_lines`, `bid_estimates` and `bids.amount`.

  In the app:
  - Apply 24 duplex, then edit any unrelated line in Labor & Pricing and Save: the duplex goes back to 10 with no warning.
  - Apply lines, then "New line from markup": the PUT itself reverts every earlier apply.
  - The new line never appears in `estimatingBid.lines`, so the next Labor & Pricing save deletes it. Its markers are left pointing at a dead `line_key`, which is B3 plus S6.
  - The Bid Summary and the "N lines not verified" count never move until a full page reload.
- **Fix.**
  - Give `useEstimatingBid` a real `refresh()` that re-hydrates from the server: reset `hydratedRef` and `persistedRef`. If `dirty`, ask first, or merge server qty and `qty_source` into the local lines by `line_key`.
  - Better still, have `apply-markups` return `save.lines` and install them directly.
  - "New line from markup" should not PUT a snapshot from another component. Add the line through `estimatingBid.setLines` + `save()`, or add a server endpoint that inserts one line inside `saveBidEstimate`'s transaction from the DB's own current lines.
  - Test: apply, then save from Labor & Pricing, then assert the qty is still the marked value.

### B2. On an estimate that has never been saved (proposed mapping), every marker "for a line" is silently saved as unassigned [reproduced: F3 + R2]

- **Evidence.**
  - A bid with takeoff output but no `est_bid_lines` returns proposed lines with `line_key: "proposed-N"` (`bidEstimate.ts:513`).
  - PlansWorkspace uses these as `activeLineKey` and stamps them on markers (`PlansWorkspace.tsx:199-200`).
  - `validateMarkupCreate` turns any non-UUID `line_key` into `null` without error (`routes/estimating.ts:230`, and the same in update).
- **Failure.** This is the natural first-use flow: Takeoff comes before Pricing in the step rail, so the estimator opens Plans before ever saving. F3 shows the autosave sends `line_key: "proposed-0"`, and R2 shows the server stores `lineKey: null` with a 200.
  - The client keeps drawing those markers in the line's color, so nothing looks wrong.
  - The rollup is empty (there are no saved lines).
  - Apply reports "Line not found".
  - After a reload, every marker is unassigned and has to be reassigned by hand. Saving the estimate later mints fresh UUIDs, so nothing ever re-links.
- **Fix.**
  - While `estimatingBid.proposed` is true, block the Count and Linear tools and show a "Save the estimate to start marking" banner with a one-click save. Or save the proposed mapping when Plans opens.
  - Server: return 400 for a present-but-invalid `line_key` instead of coercing it to null, and check the key belongs to this bid's lines (see S5).

### B3. Autosave loses work in four ways

**(a) Undoing a delete that was already saved (or redoing an undone create) never restores the marker [reproduced: R1 + F5].**

- **Evidence.**
  - `insertMarkup`'s upsert is `ON CONFLICT (id) DO UPDATE … WHERE est_markups.bid_id = $2 AND est_markups.deleted_at IS NULL` (`markups.ts:115`). A soft-deleted row never matches, so the batch reports it as `skipped: 'id already belongs to a different bid'` (`markups.ts:179`).
  - `useMarkupAutosave` never reads the response. It folds the *sent* batch into `syncedRef` and shows "Saved" (`useMarkupAutosave.ts:96-110`).
- **Failure.** Delete 30 markers, wait for the save, then press ⌘Z. The markers reappear and the indicator says "Saved", but the server still has them deleted. The rollup, and any Apply, count 30 fewer. They're gone on reload.
- **Fix.**
  - Server: an upsert for the same bid should revive a soft-deleted row (`deleted_at = NULL`). Only a *different* bid's id should be skipped.
  - Client: treat any `skipped` entry as an error. Keep it out of `syncedRef` and show the reason.

**(b) Async actions overwrite the history with a stale snapshot [reproduced: F2].**

- **Evidence.**
  - `suggestTagsOnSheet` awaits `getSheetTextItems` (a full-PDF download on first use), then calls `mutate([...history.present, ...drafts])` with the `history.present` captured *before* the await (`PlansWorkspace.tsx:336`, `:347`).
  - `createLineFromMarkup` does the same after `await api.put` (`:457-458`).
- **Failure.** In F2 the estimator clicks "Suggest markers for this sheet" and keeps counting while the text loads. When the suggestions land, the manual marker is gone: 1 marker on the sheet where 2 were expected. Autosave then sends it as a delete if it had already been saved.
- **Fix.** Compute against the live state: `setHistory(h => commit(h, [...h.present, ...draftsFrom(h.present)]))`. Apply the same pattern to every `mutate(fn(history.present))` call site.

**(c) Switching steps or toggling List/Plans drops pending and failed batches [reproduced: F4].**

- **Evidence.**
  - The debounce effect's cleanup clears the timer on unmount (`useMarkupAutosave.ts:140`), and nothing flushes.
  - `useUnsavedGuard` is only consulted by App-level navigation (`App.tsx:109`, `:288`, `:384`, `:485`).
  - `onSelectStep` (`PcWorkspaceView.tsx:987`) and the List/Plans toggle unmount `PlansWorkspace` without asking.
- **Failure.** Two cases:
  - Place a marker and click "Pricing" within 800 ms: it's never sent (F4 shows 0 POSTs after unmount).
  - A save fails on a network blip, the estimator doesn't notice, and clicks another step: every unsynced markup is lost without a prompt.
- **Fix.**
  - On unmount, flush synchronously (`fetch(..., {keepalive:true})` or fire the pending attempt).
  - Route `onSelectStep` and the toggle through `useConfirmLeave`.
  - Consider hoisting autosave above the toggle.

**(d) Opening Plans re-POSTs every existing markup [reproduced: F1].**

- **Evidence.**
  - `history` starts as `[]` (`PlansWorkspace.tsx:140`), and the hook takes that as its baseline (`useMarkupAutosave.ts:52-62`).
  - When the server markups hydrate (`:142-146`), the diff treats all of them as creates.
- **Failure.** With 2 existing markups, F1 shows one batch with `creates: m1,m2` and no user action.
  - With 1,000 markers that's a large write on every open.
  - If a second tab or user edited in the meantime, the stale load snapshot overwrites their changes through `ON CONFLICT DO UPDATE`.
  - The unsaved-changes guard arms on open.
- **Fix.** Don't mount the autosave hook, or reset its baseline, until the markups are hydrated. For example, a `reset(baseline)` API, called in the hydration effect.

### B4. Linear runs rolled into C or M lines come out 100× or 1000× low once priced [reproduced: unit script]

- **Evidence.**
  - `markupMath.ts:192` sets `markedQty = feetSum / UNIT_DIVISOR[line.unit]`.
  - The codebase's convention is that `qty` on any linear line is **raw feet** and the unit only picks the divisor: `mapper.ts:102-104` ("the same raw qty (feet) just gets divided by 1, 100 or 1000"), `pricing.ts:43-49` and `:307-309` (`qtyFactor = qty / libDivisor`).
- **Failure.** A 1,234 ft run of 3/4" EMT ($60/C, 4 h/C):

  | Line unit | `markedQty` | Priced material | Priced hours |
  |---|---|---|---|
  | LF | 1234 | **$740.40** | **49.36** (correct) |
  | C | 12.34 | **$7.40** | **0.49** |
  | M | 1.234 | **$0.74** | **0.05** |

  The report flagged the interaction with R2-N5 but shipped the conversion anyway. The focus list asked specifically for correct C/M conversion.
- **Fix.** For every linear unit, have the rollup produce raw feet (`markedQty = feetSum`), matching how pricing and the mapper read `qty`. Alternatively, fix R2-N5 first so a C/M display qty really means hundreds or thousands, then keep the divide. Pick one convention and add a test that goes through `priceBid`.

### B5. The takeoff output applies a marked qty to every Agent 4 row that shares `category::item`, so the GC takeoff disagrees with the price [reproduced: R5]

- **Evidence.**
  - `composeBidData.ts:141` keys `qtyLookup` on `${category}::${item}`. The last line wins, and every Agent 4 item with that key gets its qty (`:150-155`).
  - Phase A's B5 established that real takeoffs contain duplicate `category+item` rows (`dedupeTakeoffKeys`).
- **Failure.** R5 used two "Branch Power :: Duplex receptacle" rows: floor 1 has 40 AI, marked and applied 42; floor 2 has 30 from the takeoff. The priced estimate is 42 + 30 = 72. The composed takeoff (xlsx, pre-bid package and proposal table) shows **[42, 42] = 84**.
- **Fix.** Match on a key that is unique per row: carry `takeoff_key`/ordinal through `bid_estimates.line_items` and match by occurrence order within a `category::item` group. When a key is ambiguous, don't override; log it and surface a pre-send warning. Add the two-row case as a test.

### B6. "Applied" is permanent and hides Apply, so later markers never reach the price [reasoned]

- **Evidence.**
  - `itemsPanelStatus.ts:16` returns `'applied'` whenever `qty_source === 'markup'`, whatever the live rollup says.
  - `ItemsPanel.tsx:206` shows "Apply marked qty" only for `differs`/`not_marked`.
  - `differingKeys` (`:75-80`) excludes applied lines from "Apply all that differ".
- **Failure.** The estimator counts 20 fixtures and applies. Later they find 6 more on E1.3 and mark them, or recalibrate a sheet under an applied conduit run. The row reads "Marked 26 · Current 20 · **Applied**" in green, and there is no way to apply 26 from the Plans view. The bid ships priced at 20.
- **Fix.** `'applied'` only when `qty_source === 'markup' && markedQty === qty`, compared with a rounding tolerance. Otherwise show a "Changed since applied" status that keeps Apply available and is counted in "Apply all that differ".

### B7. The title-block scale is applied automatically, and Linear is never gated on a confirmed scale (Decision 6) [reasoned]

- **Evidence.**
  - At index time `upsertSheetPage` writes the parsed title-block `ft_per_pt` as the sheet's working scale (`sheets.ts:238-245`).
  - The parse takes the **first** `SCALE` cue anywhere in the page text (`sheets.ts:206-207`, `scaleParse.ts:115`), in content-stream order, not reading order.
  - The viewer treats any `ft_per_pt` as set (`PlanViewer.tsx:441-443`).
  - The Linear tool is never disabled: only Scale has a `disabledReason` (`PlansWorkspace.tsx:544`, `Toolbar.tsx:70`).
  - The ">2% verify scale" warning isn't implemented.
- **Failure.** Two ways this goes wrong:
  - An E sheet whose main plan is 1/8" = 1'-0" also carries "ENLARGED ELECTRICAL ROOM PLAN — SCALE: 1/4" = 1'-0"". If the callout is first in the content stream, the sheet gets 1/4" and every feeder run measures **half** its length. A half-size set gives the same 2× error.
  - On a sheet with no scale, runs can still be drawn. The rollup silently excludes them (`missingScaleCount`, which nothing displays), so an applied LF qty comes out short.
- **Fix.**
  - Store the parse as a suggestion only (for example `suggested_ft_per_pt` and `suggested_label`), and set `ft_per_pt` only on an explicit confirm or calibration.
  - Disable Linear with the reason shown until the sheet has a confirmed scale.
  - Implement the 2% disagreement warning.
  - Prefer the title-block-strip match over the whole-page match, and flag sheets with more than one distinct scale label.

### B8. Every linear run rolls up with 0 drops and 0% slack; the drops/slack popover and settings defaults were never built, and the report doesn't mention it [reasoned]

- **Evidence.**
  - Runs are created with `drops: 0, dropFt: null, slackPct: null` (`PlansWorkspace.tsx:207`).
  - The rollup maps null to 0 (`markups.ts:252`).
  - Nothing in the frontend reads `est_default_drop_ft` or `est_default_slack_pct` (grep finds only the migration), and there is no UI to edit a run's drops or slack.
  - Decision 7 and Task 5 require both.
- **Failure.** Every applied conduit or feeder qty is short by at least the 10% default slack, plus 10 ft for every drop the estimator can't enter. This is systematic under-pricing, and the report doesn't mention it.
- **Fix.** Build the post-run popover with defaults from app settings, stamped on the markup at create time and editable later. Until then, stamp the defaults at create time and show them on the run.

### B9. Real 50–150 MB plan sets will not load [reasoned, not measured]

- **Evidence.**
  - `api` has a global `timeout: 30_000` (`api/client.ts:8`). Neither the viewer's full-file GET (`PlanViewer.tsx:151-156`) nor `sheetTextCache.ts:27` overrides it, and axios's timeout covers the whole transfer.
  - `GET /sheets` indexes every plan PDF inside the request (`sheets.ts:316-323`): a Drive download, a whole-file buffer, and a pdfjs parse plus `getTextContent()` of every page.
  - `listSheets` rebuilds only when the table is empty, and no UI calls `?refresh=1`.
- **Failure.** 150 MB through the Drive → backend → browser proxy needs about 40 Mbps sustained to finish in 30 s. On typical office links the viewer shows "timeout of 30000ms exceeded."
  - On the first open of a big set, the sheets request also times out client-side while the server keeps indexing. The UI shows "No plan sheets found".
  - Pages are upserted as they're parsed, so if indexing dies partway (one bad document is skipped, or the process restarts) the **partial** index becomes permanent.
  - Plan PDFs uploaded after the first open never appear.
- **Fix.**
  - Pass `timeout: 0` (or a long timeout plus a stall detector) for the file GETs.
  - Index sheets in a background job on upload or first open, with a status the UI can poll.
  - Add a "Refresh sheets" action, and re-index any plan document with no `est_sheets` rows on every list.
  - Measure against a real 100 MB set before Jake's test drive.

---

## Should-fix

### S1. `overlay.ts` assumes the page origin is (0,0); CAD PDFs with offset boxes are misplaced [reproduced: pdf.js 4.10 script]

- **Evidence.** `overlay.ts:68-81` omits the `-s·x0` / `s·y1` translation that pdf.js's `PageViewport` includes. `est_sheets` stores only width and height, not `view[0..1]`.
- **Result.** The four rotations match pdf.js exactly for `MediaBox [0 0 612 792]`; I hand-verified rotation 90: `[0,2,2,0,0,0]` against pdf.js's `[0,2,2,0,0,0]`. For `MediaBox [100 200 712 992]`, text at (150,250) renders at:

  | Rotation | pdf.js screen | overlay.ts screen |
  |---|---|---|
  | 0 | (100, 1484) | (300, 1084) |
  | 90 | (100, 100) | (500, 300) |
  | 180 | (1124, 100) | (924, 500) |
  | 270 | (1484, 1124) | (1084, 924) |

- **Impact.**
  - Clicked markers are stored shifted by (x0, y0). They still look right, and lengths are translation-invariant.
  - Text-layer suggestions, which are in true user space, are drawn offset from their tags, possibly off the page.
  - Deduplication between suggested and clicked markers can't match.
  - The title-block strip test in `tagSuggest.ts:115-120` is wrong.
  - Any future marked-up PDF export or Phase C symbol work will be misaligned.
  - The backend title-block strip ignores both the origin and the rotation (`sheets.ts:178-179`), so rotated CAD sheets get wrong or empty `sheet_no`/`title`.
- **Fix.** Persist `view_x0`/`view_y0`, or build the matrix from the pdf.js `page.getViewport()` the viewer already has, and include the origin in `pdfToRenderMatrix`. Apply the same fix to the backend strip test (use the rotated, origin-adjusted position). Do it now, while no markups exist in production.

### S2. Suggested plus hand-placed markers double-count through "Confirm all on this sheet" [reasoned]

- **Evidence.** `suggestedMarkerFlow.ts:13,46` deduplicates only within **0.5 pt** of an existing marker. A hand click on a fixture symbol is never within 0.5 pt of the text-run center, and S1 widens the gap further.
- **Failure.** The estimator hand-counts 40 A1 troffers, runs "Suggest markers" (40 more, dashed), then "Confirm all on this sheet": the line rolls up to 80.
- **Fix.** Deduplicate against same-line confirmed markers within roughly 24 pt. Make "Confirm all" show "N confirmed, M skipped as near an existing marker".

### S3. Tag candidates are far too permissive [reasoned]

- **Evidence.** `candidateTagsFromDescription` (`tagSuggest.ts:71-82`) keeps any 2–6 character token containing a digit. `"#12 THHN"` gives `12`, and `"20A 125V duplex"` gives `20A` and `125V`, plus tokens like `2X4` and `3R`.
- **Failure.** "Suggest markers for this sheet" puts dashed markers on every circuit number "12" and every "20A" note, assigned to the one line that claims them. One "Confirm all" inflates the count badly.
- **Fix.** Require at least one letter and one digit. Reject pure numbers and rating patterns (`^\d+(A|V|W|P|KVA|KW|AWG|MCM|KCMIL)$`, `^\d+X\d+$`). Add tests with real description shapes.

### S4. The PDF stream route serves any bid-linked document with its stored Content-Type, reversing a documented security fix [reproduced: R4]

- **Evidence.**
  - `loadPlanDocumentForBid` (`sheets.ts:68-75`) checks only `id` + `linked_id`. Its comment says it enforces "plans-category and PDF"; it doesn't.
  - `streamPlanDocument` echoes `file_type` or Drive's `mimeType` (`sheets.ts:365`, `:372`), and the route sets no `Content-Disposition`.
- **Failure.** R4 fetched a `category:'other'`, `text/html` document through the route and got `200 text/html` with no Content-Disposition. `routes/documents.ts:24-35` (audit Security #6) forces anything that isn't a PDF or image to attachment. This route undoes that. Bearer-only auth limits how exploitable it is, but it's still a regression.
- **Fix.** Filter on `category='plans'` and PDF. Always send `Content-Type: application/pdf` plus `Content-Disposition: inline; filename=…` and `nosniff`, or reuse `serveDocument`.

### S5. Batch validation holes turn one bad item into a batch that fails forever [reproduced: R2, R3]

Each of these returns **500** for the whole batch:

- `drops: 1.5` (INTEGER column; validation uses `Number.isFinite`, `routes/estimating.ts:212`).
- `slack_pct: 12000`, which overflows NUMERIC(6,2).
- A non-UUID id in `deletes` or `updates` (`:293`).

And these pass validation when they shouldn't:

- `{x: null, y: null}` is stored as **(0,0)**, because `Number(null) === 0` (`:188`). A NaN from the client becomes a spurious segment to the page origin, adding hundreds of LF.
- `document_id` is never checked against this bid, so a count markup can reference another bid's document and still roll up.
- `line_key` is never checked against this bid's lines.

Because autosave resends the whole diff until it succeeds, one poisoned item blocks every later save. Today the UI can't produce the first cases, but it will once the B8 popover exists.

**Fix.**
- Validate points with `typeof === 'number'`.
- Use `Number.isInteger` for drops, and cap slack and drop values.
- Filter `deletes` and `updates` to UUIDs.
- Check that `document_id` is in `est_sheets` for the bid.
- Check that `line_key` is in this bid's lines.
- Client side: when a 4xx names an item, drop or quarantine that item instead of retrying the whole diff.

### S6. Orphaned markers are invisible [reasoned]

- **Evidence.** The unassigned bucket counts only `lineKey == null` (`PlansWorkspace.tsx:486`). The rollup covers only live lines.
- **Failure.** Deleting a manual line in Labor & Pricing, B1's lost new line, or a sync that re-keys or vanishes a takeoff line (its markers stay on an excluded line) all leave markers that are drawn on the sheet, counted nowhere, and not listed anywhere.
- **Fix.** Treat a `lineKey` that isn't among the live, non-excluded lines as unassigned in both the bucket and the navigator counts. Warn when deleting a line that has markers.

### S7. Hand-editing the qty of a markup-applied line keeps `qty_source='markup'` [reasoned]

- **Evidence.** `LaborPricingStep.tsx:411-418` sets `qty_overridden: true` but leaves `qty_source` alone, and the client round-trips it.
- **Failure.** `composeBidData` then presents a hand-typed number as plan-confirmed, the chip reads "Applied", and the "not verified on plans" count excludes the line.
- **Fix.** A manual qty edit sets `qty_source: 'manual'`.

### S8. Partial rollups are applied silently [reasoned]

- **Evidence.**
  - `incompatibleCount` and `missingScaleCount` are returned by the rollup but nothing in the frontend reads them (grep).
  - `applyMarkups` applies whatever `markedQty` exists (`markups.ts:305-325`).
  - A count marker placed while an LF line is active is silently excluded.
- **Fix.** Show both counts on the row. Have Apply refuse, or confirm explicitly, when either is above 0. Block Count while an LF-family line is active, and Linear while an EA line is.

### S9. Memory and CPU [reasoned]

- **Frontend.** `sheetTextCache` (`:21-35`) is a module-level cache that is never evicted or destroyed:
  - It keeps one pdf.js document **and its worker** per document for the whole SPA session.
  - "Find tag on sheets…" (`PlansWorkspace.tsx:385-396`) loads every plan document.
  - The current sheet's PDF is downloaded a second time (a second 50–150 MB `ArrayBuffer` plus a parse).
- **Backend.** Indexing:
  - buffers each file whole (`sheets.ts:103-105`), then copies it again with `new Uint8Array(buf)` (`pdfjsLoader.ts:85`);
  - runs pdfjs's fake worker on the API's main thread, which blocks the event loop for every user during a large index.
- **Fix.**
  - One shared, ref-counted document cache used by both `PlanViewer` and text search: LRU of 1–2 documents, destroyed on unmount.
  - Backend: `new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)`, and index in a `worker_thread` or background job (see B9).

### S10. A marker drag commits an undo step on every mousemove [reasoned]

- **Evidence.** `PlanViewer.tsx:391` calls `onMoveMarker` on every mousemove, which reaches `commit()` in PlansWorkspace.
- **Failure.**
  - One drag can use up the 200-step history cap, erasing the estimator's earlier undo history.
  - Undo walks back through intermediate positions.
  - Every mousemove re-diffs and `JSON.stringify`s every marker, which matters with 1,000 markers.
  - There's no drag threshold for markers, so a click-to-select nudges them.
  - Marker drag also starts while the Count or Linear tool is active.
- **Fix.** Keep a transient drag position and commit once on mouseup. Add a 3 px threshold, and allow drags only in Select.

### S11. View-only mode (<900px) has no way to change sheets or zoom [reasoned]

- **Evidence.** `PlansWorkspace.tsx:508-520` renders only `PlanViewer`, with no navigator. The zoom and fit controls sit inside `!viewOnly` (`PlanViewer.tsx` toolbar), and `onWheel` requires `ctrlKey`, so pinch does nothing on a phone.
- **Failure.** A phone user sees only the first sheet, at fit-width.
- **Fix.** Render the dropdown navigator and the zoom buttons in view-only mode, and handle touch pinch.

### S12. Undocumented gaps, and one inaccurate claim in the report

**Not built and not listed as deferred:**

- The drops/slack popover (B8).
- The live length label while drawing.
- Per-vertex editing of a run in Select.
- The 2% verify-scale warning (B7).
- Scale changes in the undo history.
- "Show on plans" from Labor & Pricing (Task 8).
- The "sheets without scale have linear markups" warning.
- The line-color legend in the items panel.
- A sheet refresh action (B9).

**Inaccurate:** "a jump-to-source-sheet action" is described as built, but `ItemsPanel`'s `onJumpToSource` is never passed by `PlansWorkspace`, so the button never renders.

**Fix.** Build these or list them honestly in the report.

### S13. A deep link to a sheet not in this bid shows a blank viewer [reasoned]

- **Evidence.** When `initialSheetKey` doesn't match any sheet, `currentKey` is truthy, so the "default to first sheet" effect never runs (`PlansWorkspace.tsx:123-127`).
- **Failure.** A stale `?sheet=` from another bid shows "No plan sheets found for this bid yet".
- **Fix.** Fall back to the first sheet when the key isn't found.

---

## Nits

- **N1.** Side effects inside the `setToolState` updater (`PlansWorkspace.tsx:194-216`: `mutate` plus `crypto.randomUUID()`). Under `<React.StrictMode>` (`main.tsx:24`) the updater runs twice in dev. That leaves a phantom undo step whose marker has a different id. Updaters must be pure; move the effects out.
- **N2.** `devicePixelRatio` is never applied (the `fitScale` `dpr` parameter is never passed), so the plans render soft on Retina Macs.
- **N3.** `.plan-scale-popover` has no CSS rule, so it renders unpositioned, in flow below the viewer.
- **N4.** Calibration accepts two points any distance apart, even 1 pt. Require at least about 50 pt and warn when the implied scale is extreme.
- **N5.** `GET markups?document_id=<non-uuid>` returns 500.
- **N6.** Applied LF quantities are stored to 4 decimals (`123.4568 LF`) and flow into the GC takeoff. Round linear quantities (for example, ceiling to whole feet) at apply time.
- **N7.** The viewer's file GET has no `AbortController`. Switching documents keeps downloading the old 150 MB in the background.
- **N8.** Only one document is cached in `PlanViewer`, so a set split into one PDF per sheet re-downloads on every sheet switch.
- **N9.** A suggested marker's center adds `width/2` to x regardless of the text's rotation (`tagSuggest.ts:219-220`), so markers on vertical text land beside the tag.
- **N10.** `pdfjs-dist@5` needs Node ≥ 20.16. Pin `engines` (or `NODE_VERSION` in `render.yaml`) so a Render default can't change underneath it.
- **N11.** `sheetTextCache` survives logout in the SPA. A second user in the same tab can read cached text without a fresh access check. Clear it on logout.
- **N12.** Having no FK on `est_markups.line_key` is acceptable given the delete-and-reinsert save, but only if S5's check that the key belongs to the bid and S6's orphan handling land.

---

## Signed off (verified)

- **Stable `line_key`.** `saveBidEstimate` re-supplies each key (`resolveLineKey`). Sync UPDATEs in place and INSERTs new rows with fresh keys, and placeholders mint new keys. The server side is sound; the losses above are client wiring (B1, B2).
- **Apply consistency, server side.** `applyMarkups` → `saveBidEstimate` writes `est_bid_lines`, `bid_estimates` and `bids.amount` in one transaction. Only `qty_source==='markup'` overrides Agent 4, apart from the duplicate-key bug (B5). Sync keeps a markup qty through `qty_overridden`.
- **Suggested markers never roll up.** `rollupLines` filters `status !== 'confirmed'` first (`markupMath.ts:134`), on the server.
- **Scale math.** 72 pt/in is correct: 1/8" = 1'-0" gives 0.111111 ft/pt, 1" = 20' gives 0.277778, 1/4" = 1' gives 0.055556, and 1:100 gives 0.115741. `ftInParse` handles `12'6"`, `12.5`, `150'` and `6"` correctly. `NUMERIC(14,8)` keeps the relative error around 1e-8.
- **Geometry, zero origin.** `overlay.ts` matches pdf.js 4.10's viewport transform at 0, 90, 180 and 270 (rotation 90 hand-checked). `regionRender` tile math is correct: pdf.js `beginDrawing` applies `transform` before `viewport.transform` (`pdf.mjs:7700-7705`), and the tile rectangle is independent of the origin.
- **Cross-bid access.** The file route rejects another bid's document id (though see S4). Batch update and delete are scoped to `bid_id`, and a create colliding with another bid's id is skipped. The scale PUT is scoped to `bid_id`.
- **pdfjs 5 through `new Function('specifier','return import(specifier)')`.** Safe: the specifier is a constant, Node has no CSP, and it's needed under `module: commonjs`. The frontend stays on 4.10, and the wire contract is plain numbers.
- **Integration.** The List branch of `PcWorkspaceView`'s takeoff case is the pre-existing content unchanged. `PlansWorkspace` loads as its own lazy chunk. The modals use the shared `Modal` at z 150, which is fine because `PcWorkspaceView` renders at page level, not in a drawer. If Plans is ever opened from a drawer, pass `Z_ABOVE_DRAWER`.
- **Tag ambiguity policy (a tag claimed by more than one line stays unassigned): SIGNED OFF.** Unassigned markers never roll up, and they show up in the bucket once confirmed. That's the safe default. The bigger risk is false-positive tags claimed by a *single* line (S3) and double-counting through Confirm-all (S2). Fix those two before relying on this feature.

---

## Verdict: **DO NOT MERGE**

Several paths in normal use lose estimator work or put a wrong quantity into the price, and they were reproduced against the real code: B1 (apply reverted by the next save), B2 (first-use markers saved unassigned), B3 (undo, suggest and step-switch data loss) and B4/B5 (C/M 100× and the duplicate-key takeoff mismatch). B6–B9 are reasoned from the code but are just as direct.

The server-side core (line_key, the apply transaction, rollup filtering, scale math, tile math) is solid, so the fix round should be contained to:

- the handoff between `useEstimatingBid` and Plans;
- autosave reconciliation;
- rollup unit semantics;
- the `composeBidData` join key;
- status and scale gating;
- the run adders;
- large-file loading.

After fixing, do a focused re-review of B1–B9 with repro tests like R1–R6 and F1–F5 committed. Also open a real 100 MB set in a browser before Jake's test drive.

---

# Round 2 (re-review of fix range `90fdee0..c810594`, plus report commits `2238ec7`, `576540e`)

**Reviewer:** Opus 5 (independent, read-only) · **Date:** 2026-09-23

## Verification run

| Check | Result |
|---|---|
| `npm test` (backend, `electrical_crm_test`) | **1134 passed / 1139**, 114 of 116 files. Two files failed, and both are known flakes. `notificationsRetention.test.ts`: the worker crashed. `intakeSimilarCache.test.ts`: timed out at 30 s under full-suite load; alone it passes 2/2 in 22.8 s. The branch touches neither. |
| `npx tsc --noEmit` (backend) | clean |
| `npx vitest run` (frontend) | **1151 passed / 1151**, 115 of 115 files |
| `npx tsc --noEmit` (frontend) | clean |

**How findings were reproduced.** I built a throwaway detached worktree (since removed) and ran the round-1 scenarios in it again, plus new ones. All ran against `electrical_crm_test` with Drive mocked:

- **Backend (supertest):** R1–R5, **B9-a/b/c**, **B7-half** and **S5-orphan**.
- **Frontend (vitest):** F1, F4 and F5 against the real `PlansWorkspace`, plus **B2-reg** and **B7-half-popover**.
- **Pure script:** **S1-reg**, using the real `overlay.ts`.
- **Node buffer check:** whether the new zero-copy `Uint8Array` view in `pdfjsLoader.ts` detaches pooled Node buffers. It does not; pdf.js leaves the pool intact.

Each finding is marked **[reproduced]** or **[reasoned]**.

## Round-1 findings: status

| # | Status | Evidence |
|---|---|---|
| B1 | **Fixed** | `installSaved` replaces the dead `reload()`. Apply and New-line ask to save a dirty Labor & Pricing first, and New-line goes through `estimatingBid.setLines` + `save(nextLines)`. The Apply → edit → save revert is covered by a new test. |
| B2 | **Fixed, with a regression (R2-S1)** | The server returns a per-item 400 for malformed or foreign `line_key` (my repro: `proposed-3` → skipped). Count and Linear are disabled while the estimate is `proposed`. |
| B3(a) | **Fixed** [reproduced] | Re-creating a soft-deleted id revives it (R1 again: `created 1, live 1`). Client: `skipped` → error status plus quarantine (F5 again: error indicator). |
| B3(b) | **Fixed** | Functional `mutate`; F2 is covered by the fixer's own test. |
| B3(c) | **Fixed, with a regression (R2-S2)** | Unmount flushes: F4 again shows 1 POST after an unmount inside the debounce. |
| B3(d) | **Fixed** [reproduced] | F1 again: 0 batches on open. |
| B4 | **Fixed** | `markedQty = feetSum` (raw feet) for every linear unit. Latent follow-on: R2-S4. |
| B5 | **Fixed** [reproduced] | R5 again: `[42, 30]`. When the counts don't match, the override is skipped, but that is never surfaced (R2-S4). |
| B6 | **Fixed** | "Changed since applied" status keeps Apply available and is included in Apply-all. |
| B7 | **Fixed, with a new blocker (R2-B2)** | The title-block scale is suggestion-only (migration 109 demotes existing auto-applied scales). Linear is gated on a confirmed scale. Multiple-scale detection and the 2% warning were added. The half-size toggle is broken. |
| B8 | **Fixed** | The drops/slack popover and app-settings defaults are stamped on each run at creation. |
| B9 | **Partly fixed, with a new blocker (R2-B3)** | Background job, `timeout: 0`, abort, progress bar, Refresh sheets. Status handling has holes (below). |
| S1 | **Regressed: new blocker (R2-B1)** | The origin is stored and used when *storing* points but not when *drawing* them. |
| S2, S3, S4, S5, S6, S7, S8, S10, S11, S12, S13 | **Fixed** | S4 [reproduced]: HTML doc → 404; plan PDF → `application/pdf`, `inline`, `nosniff`. S5 [reproduced]: fractional drops, slack 12000, null point and `proposed-3` are all skipped per item; the one valid create in the same batch saves. |
| S9 | Partial, disclosed | Ruling below |
| N1, N3–N7, N9, N11, N12 | Fixed | |
| N2 | Partial (base canvas only) | Ruling below |
| N8 | Not done | Ruling below |
| N10 | **Regressed (R2-S5)** | |

---

## Round 2 blockers

### R2-B1. S1 regression: on any sheet whose PDF page origin isn't (0,0), markers are now drawn away from where they were clicked [reproduced]

- **Evidence.**
  - Clicks go through `screenToPdf`, which now **adds** the origin (`overlay.ts:136-139`).
  - The SVG group that draws every marker still uses `pdfToRenderMatrix(geom, renderScale)` (`PlanViewer.tsx:549-550`, `:627`). The commit deliberately left that matrix origin-less (`overlay.ts:118-123`).
  - The fix therefore made storing origin-aware without making drawing origin-aware. `zoomBy`'s anchor math has the same mismatch (`PlanViewer.tsx:361`).
- **Failure.** On a MediaBox `[100 200 712 992]` sheet at scale 2, clicking at screen (300,400) stores a point that the SVG group draws at:

  | Rotation | Drawn at | Offset from click |
  |---|---|---|
  | 0 | (500, 0) | (+200, −400) px |
  | 90 | (700, 600) | |
  | 180 | (100, 800) | |
  | 270 | (−100, 200) | off the page |

  `pdfToScreen` itself returns the correct (300,400) in every case; only the drawing path is wrong.
  - Every clicked count and run, and every suggested marker, lands hundreds of pixels from its symbol.
  - Estimators will re-click and double-count, or distrust the counts. The quantities themselves are unaffected, since lengths are translation-invariant.
  - Before this "fix", clicked markers were at least drawn where they were clicked.
- **Fix.** Fold the origin into the group matrix: `e' = e − a·ox − c·oy`, `f' = f − b·ox − d·oy`, via one exported `pdfToRenderMatrixWithOrigin`. Use it in `PlanViewer`'s `<g transform>` and in `zoomBy`. Add a test that runs click → `screenToPdf` → the *rendered group matrix* and gets the click point back at every rotation, including an offset origin.

### R2-B2. The half-size toggle corrupts scales two ways, silently doubling or halving every run [reproduced]

1. **The toggle doubles or halves two-point calibrations.**
   - `setHalfSize` (`sheets.ts:591-610`) multiplies `ft_per_pt` by 2 or ½ no matter what `scale_source` is. A two-point calibration measures the real ratio on *this* PDF and is already correct whatever size the set was printed at.
   - B7-half: calibrate at 0.2 ft/pt, toggle half-size on, and `ft_per_pt` becomes **0.4** (`scale_source` still `calibrated`). Every run on every sheet of that document now measures **2× long**. Toggling back halves any calibration made while the toggle was on.
2. **The popover's "Use <title-block label>" ignores half-size.**
   - `ScaleCalibrationPopover.tsx:79-83` re-parses the raw label and commits it as `source: 'calibrated'` (through `commitScale`'s default, `PlansWorkspace.tsx:1063`).
   - B7-half-popover: on a half-size document whose correct suggestion is 0.2222, the popover commits **0.1111** (runs measure ½). The banner's Confirm sends the correct 0.2222, so two buttons with the same label disagree.
   - The popover's 2% disagreement check also compares against the raw label, so a correct calibration on a half-size set always warns.
3. **Refresh re-index drops the doubling.**
   - `upsertSheetPage` writes the raw `suggested_ft_per_pt` (`sheets.ts:325`) while `half_size` stays true.
   - B7-half: after Refresh sheets the suggestion is **0.1111** again, with `half_size: true`.
- **Fix.** Store only the raw parse in `suggested_ft_per_pt` and derive the effective suggestion as `raw × (half_size ? 2 : 1)` at read time. Never rescale a `calibrated` `ft_per_pt`: either scale only `scale_source='titleblock'` rows, or clear confirmed title-block scales when the toggle changes. Have the popover's "Use" button send the sheet's effective `suggested_ft_per_pt` with `source 'titleblock'`, and compare the 2% check against that value. Add tests for all three.

### R2-B3. B9 status machine: a restart leaves a document stuck in "indexing" forever, and Drive failures and corrupt PDFs report "done" with 0 sheets [reproduced]

1. **Stuck `indexing` with no way out** (B9-c).
   - The claim flips `pending → indexing` (`sheets.ts:449`) and only the in-process job ever leaves that state.
   - If the process dies mid-index, the row stays `indexing` forever. Real causes: a Render deploy or instance restart, an OOM on a 150 MB parse, or `ts-node-dev --respawn` on any file save in the live Local Version.
   - `resetIndexStatusForRefresh` deliberately skips `indexing` rows (`:424`), so **Refresh sheets can't recover it** either.
   - The client polls every 2 s forever (`PlansWorkspace.tsx`, `sheetsIndexing`) and shows "indexing" for good. Repro: a row left `indexing` three days ago was still `indexing` after `?refresh=1` plus 500 ms, with 0 sheets.
   - This also happens if `markIndexFailed` itself throws inside the catch: the rejection is only logged by the global handler (`index.ts:43`).
2. **Real failures report "done".**
   - `indexDocument` still returns `0` (not a throw) when the bytes can't be fetched or parsed (`sheets.ts:357`, `:364`).
   - The real `getFileMedia` never throws; it returns `null` on any Drive error (`googleDrive.ts:134-137`). So a Drive outage, a revoked share or a corrupt PDF is marked `done`, `page_count 0`.
   - B9-a: Drive `null` → `done`, 0 sheets. B9-b: corrupt PDF → `done`, 0 sheets.
   - The UI shows "No plan sheets found", with no failed banner and no reason to click Refresh.
   - The fork's "failed" test only passes because its mock *rejects* (`mockRejectedValueOnce`), which the real function never does.
- **Fix.**
  - Make `indexDocument` throw on a null fetch or a parse failure, so it ends in `failed` with a message.
  - Treat `indexing` older than a lease (for example `updated_at < now() − 10 min`, refreshed per page) as reclaimable, both on a plain GET and on Refresh.
  - On startup, reset `indexing` → `pending`.
  - Wrap `markIndexFailed` so a failure there can't strand the row.
  - Stop polling after N minutes with an "indexing seems stuck — Refresh" message.
  - Add tests with a `null`-returning Drive mock and a stale `indexing` row.

---

## Round 2 should-fix

- **R2-S1. The one-click proposed save leaves the chosen line's key as `proposed-N` [reproduced: B2-reg].**
  - `activeLineKey` is initialized once (`PlansWorkspace.tsx:243`) and never remapped after the save mints real UUIDs.
  - Scenario: pick a line, click "Save the estimate", then Count. The tools unlock, but no row is highlighted and the marker is sent with `line_key "proposed-0"`. The server rejects it per item, so it's quarantined with a "could not save" error.
  - It's visible, not silent, but it lands on the exact first-use flow B2 was about.
  - **Fix:** after `proposed` flips to false, remap `activeLineKey` (and the `?line=` URL param) by `takeoff_key`/sort index to the saved line's real `line_key`, or clear it.

- **R2-S2. The step guard now fires for unsaved *Pricing* edits, with a false "will be lost" message [reasoned].**
  - `onSelectStep`, the Plans jump and the List/Plans toggle all go through `confirmLeave` (`PcWorkspaceView.tsx:996+`). The guard registry also includes `useUnsavedGuard(estimatingBid.dirty)` (`:1053`) and `saveState==='error'` (`:306`).
  - So every step change with unsaved Labor & Pricing edits pops "Leave without saving? The changes you have made on this screen will be lost." Those edits live in shared hook state and are *not* lost by a step change. The same is true for pending markups, because unmount now flushes them.
  - The wording is false, and it trains estimators to click through the dialog for the cases where it matters.
  - **Fix:** guard step/toggle navigation only on markup autosave `error` (the only state a step change can really lose), with markup-specific wording. Keep the app-level guard for real navigation. If the unmount flush fails after leaving, raise a toast.

- **R2-S3. A marker whose line was deleted can't be moved or confirmed [reproduced: S5-orphan].**
  - Every update re-sends the full markup including `line_key` (`useMarkupAutosave.ts:281`). The new check rejects any update carrying a key not in the bid's lines (`routes/estimating.ts:790`).
  - After a line is deleted, or a sync re-keys it, dragging or confirming that marker gives `skipped: line_key does not belong to this bid`, gets quarantined and stays in error. S6 correctly lists it as unassigned, but the estimator must reassign it before doing anything else, and nothing says so.
  - **Fix:** send `line_key` on update only when it changed, or treat a dead key on an unchanged field as allowed, or have the server null it out.

- **R2-S4. `composeBidData` loose ends [reproduced: R5 again].**
  - (a) `ambiguousQtyKeys` goes only to `console.warn`; nothing in the UI or the pre-send checklist reads it (grep). When the counts don't match, the GC takeoff silently keeps the AI qty while the price uses the marked qty, which is the B5 disagreement in its safe-but-silent form.
  - (b) Since B4, a markup-applied line whose unit is `C`/`M` writes `{qty: <raw feet>, unit: 'C'}` into the GC takeoff (`composeBidData.ts:230`). R5 again shows `{qty: 1234, unit: 'C'}` meaning 1,234 ft, which a GC reads as 123,400 ft.
    - This is latent today: the agents emit only EA/LF (`ai/prompts.ts:71,81,158`), and a manual C line never matches an Agent 4 row.
  - **Fix:** surface the ambiguous keys as a pre-send warning. Emit `unit: 'LF'` (or convert qty to the display unit) whenever the override is linear.

- **R2-S5. N10 (unsanctioned fork) pins production to Node 20.16.0 exactly (`render.yaml:16`).**
  - Node 20 reached end of life in April 2026.
  - Before this commit Render used its default. This merge could silently *downgrade* the production runtime to an unsupported patch release.
  - `pdfjs-dist@5` accepts `>=22.3.0`.
  - **Fix:** pin a supported LTS major (`22` or the current LTS) and keep `engines` as `>=20.16.0 <21 || >=22.3.0`, matching `pdf-parse`.

- **R2-S6. Background indexing starts every claimed document at once** (`sheets.ts:477-488`, fire-and-forget per doc).
  - A 68-file set means 68 parallel Drive downloads.
  - Three 150 MB PDFs is about 450 MB of buffers plus three pdf.js parses in the API process, on the main thread.
  - `setImmediate` between pages keeps latency bounded per page, but not memory.
  - **Fix:** a per-process queue with concurrency 1–2.

## Round 2 nits

- **R2-N1.** Pinch zoom calls `zoomBy` with a stale `renderScale` for every `touchmove` in the same frame, so it under-zooms and jitters, and every step re-renders the whole page. There's no `touch-action: none` on `.plan-canvas-scroll`, so iOS also pinch-zooms the whole app. Accumulate the scale in a ref, rAF-throttle it, and add `touch-action: none`.
- **R2-N2.** When the LRU evicts a document another caller is mid-`getTextContent` on, it destroys it underneath them. "Find tag" then silently drops that sheet from its results. The evicted in-flight 150 MB fetch isn't aborted either. Ref-count before destroying, and abort on eviction.
- **R2-N3.** The migration 110 header says "'failed' is always retried on the NEXT GET /sheets", but the code makes `failed` sticky until Refresh. Fix the comment.
- **R2-N4.** A marker placed before the markups GET resolves is wiped by hydration's `initHistory` + `reset`. This is pre-existing and narrow. Disable the tools until markups have hydrated.
- **R2-N5.** When the base canvas is DPR-scaled and `renderScale × dpr` passes the area cap but `renderScale` doesn't, the base is clamped (soft) and no tile renders, because `needsTiledRender` compares `renderScale` without DPR. It's cosmetic; fold it into the N2 follow-up.

## Rulings on disclosed partials

- **S9: acceptable follow-up, not a blocker.** Yes, the same file is still downloaded twice: `PlanViewer`'s own fetch plus `sheetTextCache`'s separate LRU fetch. That happens once per text-cache miss, only on a user-initiated Suggest or Find tag, not on render or scroll. Worst case the tab holds the viewer's document plus 2 cached documents (about 3 × 150 MB). The backend double-buffer is fixed (zero-copy view, verified safe). Main-thread indexing is mitigated by the per-page `setImmediate` yield; the real remaining risk there is R2-S6 (memory). Before this ships widely, consider an LRU of 1, or reuse the viewer's document when the ids match.
- **N2 (tile canvas without DPR): acceptable follow-up.** It's purely cosmetic, softer only above the area cap on HiDPI screens, and hit-testing and overlay math are unaffected.
- **N8: acceptable follow-up.** It re-downloads when switching between sheets of *different* single-sheet PDFs. That costs time, not correctness.

## Unsanctioned fork commits (scrutinized as untrusted)

- **`d4882e4` (B9):** the structure is right: atomic CAS claim, fire-and-forget job, status table, `setImmediate` yield, zero-copy buffer (verified safe for pooled buffers). The status transitions are not: R2-B3 (stuck `indexing`; failures reported as `done`) and R2-S6 (unbounded concurrency). Its "failed" test mocks a rejection the real `getFileMedia` never produces, which is why it passes.
- **`597614a` (S3):** fine. Rating, dimension and pure-number tokens are rejected and real tags survive.
- **`b854d5e` (S7):** fine (one line, `qty_source: 'manual'` on a qty edit).
- **`733b6ff` (S6 + S12):** fine. Dead or excluded keys count as unassigned, and Jump to source is wired. See R2-S3 for the interaction with the new server check.
- **`6fa6595` (N10):** not acceptable as written (R2-S5).
- **`7b43a0a` (N11):** fine. Session-cleared event, then destroy and clear; no import cycle.

## Verdict (round 2): **DO NOT MERGE**

Round 1's blockers are mostly closed, several with good tests. But the fix round introduced three new blockers, each reproduced:

- **R2-B1:** every marker on an offset-origin sheet is drawn displaced from its symbol. The round-1 S1 fix is incomplete and made the display worse.
- **R2-B2:** the half-size toggle silently doubles calibrated scales, and the popover commits half-scale on half-size sets. That's a 2× linear quantity error either way.
- **R2-B3:** a restart mid-index leaves a document stuck in "indexing" with no recovery, and real Drive or PDF failures report "done" with 0 sheets.

All three are small, contained fixes: one matrix, one CASE plus a read-time multiply, and the status-machine lease plus a throw. Fix them and R2-S1 through R2-S5, each with the repro above as a committed test. After that, a main-session spot-check is enough; a full round 3 isn't needed.
