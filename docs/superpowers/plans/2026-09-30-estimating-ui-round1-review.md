# Review: Estimating UI cleanup, round 1 (`feat/estimating-ui-round1`, 70c75bd..4284569)

Reviewer: Opus. Checked against the plan (Tasks 1–11 and both "Reviewer focus" lists).

## Verdict: MERGE AFTER FIXES

No blockers. There are four should-fix items, all small, and all in the Plans-view half (Tasks 8–11). The step model, the sidebars, the wording, RFIs and Scope (Tasks 1–7) conform to the plan, and I found no bug in them.

### Claims I checked myself (all confirmed)
- Frontend `tsc --noEmit` is clean. The full `vitest run` passes 1456/1456 (137 files), and estimating plus preconstruction pass 927/927.
- Backend `tsc --noEmit` is clean.
- Backend `npm test` on `sheetTitle`, `sheets` and `estimatingSheetsRoutes` passes 88/88. The DB route tests ran against `electrical_crm_test` and none were skipped.
- Backend `aiCountMarkers` and `estimatingMarkups` pass 33/33.

### Focus areas that came out clean
- **scopeMeta persistence.**
  - `ws.scopeMeta` is in the autosave deps (PcWorkspaceView.tsx:277), and `scope_meta` is in the payload (:213).
  - All 7 writers spread the existing object: ScopeTab `withoutAi`, `importScope`, the textarea onChange, useAiPoller:121, `addRfi`, both import branches, and `onSetNoRfis`.
  - `applyServerReset` (:747) replaces scopeMeta on purpose, and the backend `resetScope` drops the flags, as intended.
  - The PcWorkspaceRfi test checks that the last PUT carries `scope_meta.noRfis === true`. That click changes only scopeMeta, so the test really does prove the deps fix.
- **Warning parity.**
  - `bidSummaryWarnings` matches the `bs-warnings` JSX row for row: same order, same conditions (`if (nv)` is the same as `!!nv`, and `!!confirmMatchCount` is the same as truthy), and the same text, including all 4 review-flag kinds.
  - The parity test turns every row on.
  - The strip shows "—" when the total is null. The collapse toggle renders only when `summaryStrip` is passed.
  - AccubidSummaryRows has no warning rows, so the strip misses nothing in Accubid mode.
- **Breakpoints.**
  - The tablet and `forceSlimSummary` branches are byte-identical apart from `{rail}`, so rail collapse applies there, as planned.
  - The summary preference is ignored on both.
  - Focus returns to the new toggle on both the summary and the Plans panels.
- **Legacy steps.**
  - `'rfis'` maps to `rfis`, `'scope'` maps to `scope`, and `stepToLegacyTab('rfis') === 'rfis'`, which is in `PC_TABS`, so App.tsx `validTabs` accepts it.
  - The only switches over step keys are steps.ts and `renderStepContent`, and both handle `rfis`.
  - `?step=rfis` has a test.
- **RFI done rule.**
  - It matches the Task 1 formula.
  - Both `addRfi` and import clear `noRfis`.
  - The `aiRfisImported` flag stops the banner coming back after an edit, and there is a test for it.
- **Scope-list move and hint.** ScopeListPanel now appears only on Scope, and the takeoff hint is gated on `!agent2_output && !aiRunning`.
- **est_sheets leak paths.**
  - `getSheetRows` has one caller, and it always passes the live ids.
  - `statuses` and `indexErrors` are filtered in `listSheets` before they reach the client, so an old copy can no longer raise the indexing or failed banners or keep the poller running.
  - The only other `getPlanPdfDocuments` callers are marker-create validation and `aiMarkers.resolveDocumentsForFiles`. Both tightenings are intended, given 0 generated or superseded plan PDFs in the live data.
- **Inventory keys.**
  - `page - 1` on both maps lines up with `page_index`. `CheckedPage.page` is 1-based (sheetCheck.ts:579 keys `${sha}#${r.page}`).
  - The lookup is scoped per bid (`bid_sheet_check.bid_id` is the primary key).
  - Marker and scale keys are untouched.
- **Junk titles.** I ran about 140 extra real-world titles through `isJunkTitle`, including every one you listed ("SITE PLAN", "E-1 POWER PLAN", "Lighting Plan - Level 2", "PANELBOARD SCHEDULES & RISER", "ELECTRICAL SPECIFICATIONS", "Photometric Site Plan", "FIRST FLOOR POWER PLAN") and around 80 titles with no dictionary words ("HVAC RTU", "MDP", "NURSE CALL", "EV CHARGERS", "IT ROOM", "TV MOUNTS"…).
  - The garble check gave no false positives.
  - Only three came out as junk: "iPad Kiosk Plan" (it starts with a lowercase letter), "eLECTRICAL", and "ELECTRICAL PLAN — SIGNED & SEALED" (the word "signed" is on the note list). Each still falls back to the sheet-check title, then "Page N". Acceptable.
- **Default sheet.** The effect returns early when `currentKey` matches a real sheet, so a valid `?sheet=` is never overridden, and a stale key still shows the "no longer available" toast.
- **Test churn.** Every removed assertion was either replaced by an equivalent one (`getByText` became `getByLabelText`, "Current" became "Now", the chip, listbox and `aria-selected` tests became group, search, `aria-current` and optgroup tests, and the clamp tests are kept as "stays put") or re-pointed on purpose (the RerunReset A-collapsed case). The "Apply marked qty", proposed-banner and scale Confirm tests keep their meaning.
- **No drift.**
  - ProposalTab's `reviewBlocked` and disabled conditions are untouched.
  - In LaborPricingStep only the labels changed, and the test still asserts `pricing_mode: 'phase_a'`.
  - The rollup and apply code is untouched.

---

## Blockers
None.

## Should-fix

**S1. The scale prompt, and with it the one-click Confirm, is now hidden on every `page_group === 'other'` sheet, and real drawings land there.**
- Where: `frontend/src/features/estimating/plans/PlansWorkspace.tsx:1198`, `backend/src/estimating/sheets.ts:173`.
- Why real drawings are affected: `sheet_no` is only read from the page when it matches `^[EAMP]-?\d{1,3}(\.\d{1,2})?$`. So C-1, FA-1, T-1, S-1, ES-1, EP-1 and E-101A are all `other` whenever the sheet check has not filled a number (the check never ran, or its entry was not matched).
- Failure: on such a sheet whose title block has a clean scale, the old "Suggested scale … Confirm" banner used to show. Now nothing shows except PlanViewer's small chip, so the estimator has to calibrate by hand. That breaks the constraint "every existing button's behavior stays the same". The plan prescribed hiding the prompt on `'other'`, so this is a plan gap rather than a builder error.
- Fix: hide the prompt only on `'spec'`. On `'other'`, still render the suggestion and ambiguous variants, and hide only the plain "needed" variant, so cover pages without a number stay quiet. Add a test: an `'other'` sheet with `suggested_label` shows `plan-scale-suggestion-banner` and Confirm. (The group label "Pages without a sheet number" for those sheets, SheetNavigator.tsx:88, is the cosmetic side of the same gap.)

**S2. The takeoff-lines filter hides the line you are marking as soon as you place its first marker.**
- Where: `frontend/src/features/estimating/plans/ItemsPanel.tsx:99`.
- Failure: the estimator picks "Not marked", clicks a line and drops one Count marker. The line's status becomes `differs`, and the row, with its active highlight and its Apply button, vanishes from the list. Markers keep going to a line they can no longer see.
- Fix: in `lineShown`, return true when `l.line_key === activeLineKey`. Add a test: with the not_marked filter and an active line whose rollup changes to marked, the row stays.

**S3. Unassigned markers on a deleted copy now show a raw id and jump to nowhere.**
- Where: `frontend/src/features/estimating/plans/PlansWorkspace.tsx:995`.
- Why: `history.present` still holds markers on deleted copies, because `getMarkups` is not filtered by document. Those sheets are no longer in `sheets`.
- Failure: an unassigned, confirmed marker on a deleted copy gets the label `"<uuid>:3"` in the bucket. Clicking it sets a `currentKey` that is not in the list, so the user gets the "That sheet is no longer available" toast and a bounce to the default sheet. Before this branch, those sheets were listed, so the jump worked. The new hidden-markers banner already reports these markers.
- Fix: leave out bucket entries whose `documentId` is not in `documentNames` (the live ids, which also covers live-but-not-yet-indexed files correctly), or label them with the `hiddenMarkers` name and no jump.

**S4. The file-name fallback can apply an older revision's inventory to a re-uploaded file with the same name.**
- Where: `backend/src/estimating/sheets.ts:721` and `:793`.
- Failure: rev 1 `Electrical.pdf` is deleted and rev 2 `Electrical.pdf` is uploaded with pages added or reordered. Until the sheet check runs again, rev 2's pages take rev 1's title, sheet number (and so discipline and group) and `specBookPage` for the same page index.
- Why it matters: this affects display only, but it moves sheets between groups and turns the scale prompt on or off (see S1).
- Fix: match by content hash before file name. `documents.content_sha256` exists (migrations 121 and 146) and `CheckedPage.key` is `${sha}#${page}`. So select `content_sha256` in `getPlanPdfDocuments`, build `bySha` from `p.key`, try `byDoc`, then `bySha`, then `byFile`. Keep the file-name fallback only for rows with no hash.

## Nits

**N1.** `ItemsPanel.tsx:264` shows "No lines match this filter." when the filter is **All** but "Show only this line" is on with no active line. That message blames the wrong control. Suggested text: "No line selected."

**N2.** The "Marked" filter counts `changed_since_applied` lines whose markers were all removed (the rollup `markedQty` is null) as "Marked". That is defensible, because the line was applied from markers, but the count can look odd. Leave it or document it.

**N3.** The strip's warning badge leaves out the muted "excluded" row, as specified, and the tooltip lists it. This is consistent with the plan and listed only so Jake knows it is on purpose.

## For Jake (decisions, not code defects)
1. **Markers on deleted copies still count in `getRollup`** and now cannot be seen or deleted from the Plans view. The banner surfaces them. Cleanup is your call: move them onto the current copy by page, or leave them out of the rollup.
2. **The scope list moved after Takeoff**, but Agent 2 reads it during the run. There is a pre-run hint with a link on the Takeoff step. Confirm the hint is wanted.
3. **Known limitation:** once the AI RFIs have been imported, a supplement pass that adds new ones does not bring the "AI suggested N" banner back.
