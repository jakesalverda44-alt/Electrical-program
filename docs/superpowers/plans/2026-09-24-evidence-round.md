# Evidence Round: Sheet Relationships, Details, Typicals, Schedules, Reconciliation, Data Capture

**Date:** 2026-09-24
**Status:** Planned (Jake: "look into the receptacle undercount first then plan the evidence round"); awaiting go
**Planned by:** Opus 5.5 (main) · **Execution:** Opus for Parts 1–3 (accuracy-critical), Sonnet for Parts 4–5 (strictly tested) · **Review:** Opus
**Depends on:** main `67a2e5e`. Migrations start at **133**.

## Baseline (Opus, Kissimmee, 2026-09-24 — eval `scripts/evalTakeoff.ts`)

$4.64/bid, 566 s. PASS: A 73, B 52, M 6, C 2, G 11, RTU 2 (dense lighting exact).
FAIL: site poles 6 / heads 7 (exp 3/4) · receptacles 19 (exp 38) · GFCI 11 (exp 16)
· battery chargers 0 (exp 5) · baseflex no_match. Disputed: exits 24 (22/24), wall
packs D+L 5 (+W1 3, W2 1 from PH0.1; exp 9 / audit 5), power poles 6 (8/6).
Review items: 46.

### Root causes found (receptacles, from the actual E-1/E-2 sheets)
1. **Complementary layers treated as duplicates.** E-1 "Power Plan & General Notes" and
   E-2 "Power Pole & Junction Box Locations" are different layers of the same floor.
   The same-level rule raised "same area?" and kept E-1's counts only (19 → ~26 if summed).
2. **Enlarged detail viewports** carry devices the main plan doesn't: E-1 #3 Restroom
   Power & Lighting (GFCIs), E-2 #11 Office Area Power Plan (manager's desk outlets
   A30/A32/A36/A38/B30/B32), E-2 #6/#7 door details. The counter has no viewport concept.
3. **Legend/notes typicals:** E-2 #9 Power Pole Legend lists outlets per pole type (office
   2 duplex + simplex, checkout 1 duplex, parts pod 1 duplex, tester simplex + duplex,
   counter 2 duplex) × pole count. Nothing expands it.
4. **No text layer** on E-1/E-2 (raster). Notes describing outlets and the panel schedule
   must be read by vision; a text-only table parser gets nothing on this job.
Other misses: site poles (photometric S1/S2 vs E-7 "SITE LIGHT" = same Lithonia DSX1 P8,
not recognized → stacked); battery chargers/disconnects/WH/etc. exist only in the panel
schedule and legend (symbol counting finds 0 → also the bulk of the 46 review items).

## Goals
- Kissimmee re-test (same eval): receptacles within ±2 of 38 with every one traceable;
  site poles/heads 3/4; battery chargers 5; review items ≤ 12; cost ≤ ~$6.
- Every GC-facing quantity carries evidence; misses become visible diffs; every estimator
  correction is captured as labeled data.

## Decisions (Jake-approved roadmap, 2026-09-24; do not relitigate)
- Agents classify/link/argue/audit; the ledger counts. Evidence required on GC-facing
  quantities (marker, schedule cell, typical expansion, or manual/allowance with reason).
  **Pre-bid package is exempt** (internal; confidence-coded).
- The schedule parser OWNS schedule quantities; Agent 1 may not state them.
- Typical expansion: multiplier from a schedule/legend/architectural source only;
  subtract units drawn in full; never guess; missing multiplier = blocking review.
- Merge by equipment tag / catalog number first; coordinate registration later.
- Gap-fill: when reconciliation shows a shortfall, a targeted search for that type on
  that sheet with the legend symbol + confirmed crops as examples.
- Review sorted by $ risk; 5–10% QA sample of auto-accepted high-count classes.
- Capture every confirmation/correction as labeled data (client + project type tags).
- "By G.C." = APT scope; owner-furnished = APT-installed (existing rules).

## Part 1 — Sheet relationships & viewports (Opus)
1.1 **Viewport detection per plan sheet:** find drawing viewports (title bubble + title +
    scale, e.g. "3 RESTROOM POWER AND LIGHTING 1/4"=1'-0"") via text layer when present,
    else vision on the sheet overview. Store viewport bboxes (PDF points) and kind:
    main plan / enlarged plan / detail / schedule / legend / notes.
1.2 **Marks carry their viewport.** Counter output is attributed to viewports; marks in
    legend/schedule/notes viewports are never counted as devices.
1.3 **Enlarged vs main dedup:** an enlarged-plan viewport's area on the main plan is
    determined (title/area keywords + optional bubble reference); per type, if the main plan
    shows that type inside the area → keep main; if the main plan area is empty for that
    type ("see detail") → take the enlarged viewport's marks. Ambiguous → one grouped review
    item with both counts.
1.4 **Sheet-pair relationship:** replace the title-only "same area?" rule. Two plan sheets
    of the same level are **complementary** (sum distinct types) when their dominant content
    differs (e.g. power devices vs power poles/J-boxes vs lighting) — decided from each
    sheet's type histogram + titles; **duplicate** only when the same type appears on both
    with overlapping mark distribution after a coarse alignment (building outline bbox of
    marks). Unclear → review. Kissimmee E-1/E-2 must resolve to complementary for receptacles.

## Part 2 — Typicals & legends (Opus)
2.1 **Legend/notes typical extraction:** from legends and note blocks (text or vision),
    extract "per-unit" device packages: pole types → outlets per pole; storage unit →
    light + receptacle; vacuum island → n vacuums; each with source crop/text evidence.
2.2 **Multiplier binding:** count of the host (power pole markers by type, units from
    architectural unit schedule, islands from site plan) with evidence; expansion rows
    `source=typical-expanded` linked to host marks. Subtract devices drawn individually at a
    host. Missing/ambiguous multiplier → blocking review.
2.3 Kissimmee: 8 (or 6, disputed) power poles × per-type outlets → expanded receptacles.

## Part 3 — Schedules, equipment, site equivalence (Opus)
3.1 **Schedule reading with cell evidence:** text-layer table parse when available;
    otherwise vision row-by-row on the schedule crop (never "summarize the table"). Rows:
    `{sheet, table, row_idx, cells[], bbox}`. Panel schedules (ckt, description, load,
    breaker), fixture schedules (mark, catalog, qty if present), equipment schedules.
3.2 **Equipment from schedules:** equipment types (battery chargers ×5 on B-15..23, WH,
    DF, drink machine, mini-tune, ALC, disconnects, meter base, wireway) come from panel/
    equipment schedule rows (evidence = the row) — not from symbol counting; they stop
    raising zero-count review items. Circuit descriptions like "BATT CHGR (5)" expand.
3.3 **Catalog-number equivalence:** fixture types sharing a catalog/model (Lithonia DSX1
    LED P8…) across sheets (PH0.1 S1/S2 vs E-7 SITE LIGHT) are one fixture family;
    merge by location/pole tag, never stack. Heads vs poles preserved.
3.4 Agent 1 no longer emits schedule quantities (parser owns them).

## Part 4 — Evidence, reconciliation, gap-fill, review (Sonnet, strict tests)
4.1 Evidence field on every takeoff line + GC-facing gate (pre-bid exempt; manual/allowance
    evidence = reason text).
4.2 Reconciliation (code): fixture schedule qty vs accepted marks; panel circuit
    descriptions vs devices/equipment; per-circuit lighting load vs fixtures on that circuit
    (second control when no schedule qty); typical host counts vs unit/pole counts. Each
    mismatch = one diff item showing both sides with jump links. Blocking when > tolerance.
4.3 Crop checks: marks flagged low-confidence / tile-edge / dense / legend-mismatch get a
    single-crop classify call (accept/reject/reclass). Replaces whole-sheet retries.
4.4 Gap-fill: for a reconciled shortfall, targeted search on that sheet for that type with
    legend crop + confirmed crops as few-shot examples, excluding existing marks; results are
    suggested marks (need acceptance or crop-check pass).
4.5 Review: grouped, sorted by $ risk (equipment, poles, typical multipliers, wet/hazard,
    then commodity devices); 5–10% random QA sample of auto-accepted high-count types.
4.6 Facility checklists (fuel/c-store, car wash, storage, prototype retail) as punch lists
    on the same review queue.

## Part 5 — Data capture (Sonnet)
5.1 Log every marker confirm/reject/move/reclass, review resolution, crop decision and
    gap-fill acceptance with crop image ref, type, sheet, client/brand, project type, run id.
5.2 "Finished bid" action: attach answer key (Chris BOM/breakdown import or confirmed
    counts) → stored as an eval case (inputs referenced, expected counts derived).
(Test-set gate + accuracy dashboard = the next round.)

## Leftovers folded in
Agent 1 `documentPrep` tiles still 1568 px (size per model like the counter); fittings
ratios applied to all-in raceway items as PROPOSED changes; Settings UI for BOM import
preview, per-GC overhead table, account-rule auto-deduct editing.

## Ground rules
Worktree `../Electrical-program-wt-evidence`, branch `feat/evidence-round`. Standard rules
(no Local Version edits, no dev servers, tests only, no real API calls, no Agent tool,
no push, real-shape fixtures incl. a RASTER plan page fixture with no text layer, commit
per task, full suites once per part). Report: `docs/superpowers/plans/2026-09-24-evidence-round-report.md`.
After merge: re-run the Kissimmee eval (Opus, test DB) and compare to the baseline.
