# Accuracy round, Builder P: Opus review. 2026-09-30

Branch `feat/accuracy-pricing`, e884e9b..7b5cfa9 (P's commits plus the 3591cd0 merge of main, and the 2bcf07d gap analysis). Read-only review. I edited no source and touched no DB. I ran:
- **Backend** (electrical_crm_test): 16 files, 176 passed, 1 skipped (the site-pole gate skips itself). The files: replayEval, zeroHourLines, feederRows/Graph/Estimate, sheetScale, equipmentConnection, seedUnitsVsChris, siteGeometry, costLineDefaults, bidCalibrationFlag, estimatingFeedersRoute, matcherSafety, accubidRecap, migration159Settings, pricing.
- **Frontend:** `tsc` is clean. Six P test files gave 140 passed and 1 failed. The failure is PlanViewer's mouseDown test, which passed 36/36 when run alone (load flake, as the report says).
- **Scratch replays** (scratchpad only, via `replayPricing`): Kissimmee live@submitted, with and without the migration-158 library, and SCRIPTED projected@due-fresh line detail.
- **A mapper sweep:** every Agent 2 row of the 0924/0928/0930 Kissimmee and 0929/0929b/0930 36th exports, plus 15 synthetic probes. Each was run against the live library before and after `libraryAfterMigrations`.

## Verdict: MERGE AFTER FIXES

The feeder graph, scale tiers, endpoints, route math, the D5 holds and the replay harness are careful work. The math strings are always present. The Task 0 baseline was committed first (e884e9b) and never rewritten, and the gate thresholds are as specified. Chris's six recap reproductions still pass to the cent.

Five defects break the round's own standing rules, though, and the report doesn't flag any of them:
- a submitted bid's displayed price moves on merge;
- new cross-family alias matches;
- a site-run double count;
- parallel-set feeders halved by the panel's own buttons;
- newly priced owner-furnished pole material.

All five fixes are local.

---

## Blockers

### B1. The live, submitted Kissimmee proposal changes price on merge, with no sync and no calibration flag
- **Where.** `backend/src/estimating/bidEstimate.ts:707` (`decideRows` runs on every bid, ungated), together with migration 158's aliases and labor moves.
- **Failure scenario.**
  - Kissimmee 041c6d48 is `submitted` and has **0 saved est_bid_lines** (`estBidLines: []` in the export).
  - Its proposal is computed live by `getProposedLinesFromTakeoff` on every GET (`routes/estimating.ts:777`, `:923`).
  - Replaying that exact path on this branch gives:
    - **$58,756.51 / 430.4 h** against today's $42,916.83 / 364.5 h;
    - even with the library exactly as exported (no migration 158), **$50,913.46**. So about $8k comes from code alone.
  - The added hours are all D3/D4 "equipment units":
    - site poles at LTG-POLE: 6 × 4.8 h + $950 each;
    - heads: 10 × 2.2 h + $385 each;
    - PP-SET: 2 × 3.5 h + $650 each;
    - TERM-6 / TERM-10, DEV-SIMPLEX, RISER-PIPEPOLE.
  - Standing rule: "New priced rows (feeder lengths, **equipment units**, site geometry, itemized defaults) apply only to bids in PRE_SUBMISSION_STAGES." Reviewer focus #6: "no priced change on non-due bids".
  - The report presents the $58.7k as "the live proposal as stored". It is not flagged as a rule break.
- **Fix.**
  - Gate the *pricing* outcomes of `decideRows` on `isEstimatingBid`: `libraryCode` assignments (D3/D4) and the DISC-xx sizing. Notes and holds can stay ungated, because they move $0.
  - Pass the bid to `takeoffRowsFrom`, or have `decideRows` take `{ priced }`.
  - The global alias additions (LTG-POLE "site pole", LTG-POLEHEAD "fixture heads") cannot be stage-gated. They still re-price any unsaved submitted proposal with those rows. Either:
    - drop them in favor of the gated `libraryCode` path (which already covers these rows); or
    - put to Jake in one line: "migration 158 changes the displayed price of submitted bids that were never saved (Kissimmee: $42.9k → $X)".
  - Add a test: `live@submitted` through `proposedLinesFromRows` equals the baseline's live reproduction ($42,916.83) with the migration-158 library.

### B2. New cross-family alias matches: the "alias-only" items are reached by loose token-subset aliases
- **Where.**
  - `mapper.ts:500` / `:1095`: alias-only blocks *fuzzy* only. The alias tier (`mapper.ts:778-783`) is `tokenSubsetMatch`, so any row that contains the alias words matches.
  - Migration 158:29 and `seed/laborUnits.ts`: the 'fixture heads', 'ceiling fan', 'pipe pole', 'anchor bolt set' and 'simplex' aliases.
- **My sweep (before → after).** Real rows:
  - "FSC — Ceiling fan speed controls (connection)" → **FAN-CEIL**, which is a control device priced as a fan (2.5 h).
  - "Ceiling fan (CF)" and "CF1-CF3 — Ceiling fans …" → FAN-CEIL as well. That is three rows for the same 3 fans, the gap analysis's triple count.
  - These are qty 0 today and price the moment the count is answered.
- **Probes:**
  - "Emergency fixture, 2 heads": LTG-EM → **LTG-POLEHEAD** ($385 + 2.2 h). Note that 36th's 8 "2-Heads 80W Unit Equipment" are exactly this kind of row.
  - "Remote emergency fixture heads": LTG-EM → LTG-POLEHEAD.
  - "Fixture heads for track lighting": LTG-TRACK → LTG-POLEHEAD.
  - "Anchor bolt set for transformer pad" → POLE-ANCHOR.
  - "Exhaust fan / ceiling fan combo" → FAN-CEIL.
  - "Pipe pole for service mast" → RISER-PIPEPOLE.
- The report says the only mapper changes are DISCON A/B and the S1/S2 heads. Focus #9 says "no new cross-family match".
- **Fix.**
  - Remove the generic two-word aliases from LTG-POLEHEAD ('fixture heads'). The S1/S2/SITE LIGHT head rows are already decided by code in `decideRows`; add a head branch there, scoped by category, if needed.
  - For alias-only codes, require an exact-name or alias **equality** (not a subset) in the mapper, or route them only through `decideRows`.
  - In `decideRows` (`equipmentConnection.ts:188`), test `speed control` on `text`, not `r.item` only. Also note-dedupe the fan rows the same way the power-pole rows are (`k > 0` → `duplicate`).
  - Add the probes above to `matcherSafety.test.ts`.

### B3. Site geometry rows ignore one-source-per-scope, so an estimator's site footage or Agent 2's site footage is priced twice
- **Where.** `footageAllowanceDb.ts:267-293`. `siteGeometryRows` is appended **after** `composeWiringRows`. Only the ratio row "Site lighting conduit allowance — PVC" is zeroed. `decisions.site` (estimator source 1, Agent 2 source 2) is never consulted.
- **Failure scenario.**
  - The Kissimmee SCRIPTED replay shows the Agent 2 allowance "NEEDS FOOTAGE — Site lighting underground conduit and wire" at 0 LF, sitting next to "Site lighting circuits — 1" PVC" 317 LF + 1,585 LF #10.
  - The estimator types Chris's 750 into the NEEDS FOOTAGE line, which its evidence invites ("measure it or type a qty"). The bid then carries 750 + 317 ft of 1" PVC and both wire sets.
  - The same happens when a later Agent 2 run reads a footage (source 2), or when a site run is measured on the Plans view.
- **Fix.**
  - Run E1 only when `composed.scopes.site.source === 3` (ratio). Otherwise emit the site rows at 0 with "replaced by your / Agent 2's site footage" evidence.
  - Or subtract the user site footage the way NB-2 does.
  - Add a test with a typed qty on the site NEEDS FOOTAGE line.

### B4. "Adopt as run" and "Type length" halve the conduit and wire of every parallel-set feeder
- **Where.**
  - `frontend/src/features/estimating/FeedersPanel.tsx:93`: one markup, no sets multiplier. `computeRunLengthFt` has none either.
  - `FeedersPanel.tsx:86`: `sets` is derived from `quantities`, which is null on a hold, so `sets = 1`.
  - `wiringScopes.ts:457-460`: the wire is derived from the conduit qty divided by the sets.
- **Failure scenario.** Kissimmee METER→WIREWAY and XFMR→METER are "(2)4#3/0, 2"C".
  - **Adopt:** the markup measures one route L, so the conduit line becomes L (should be 2L). On the next sync the wire is L/2 × 8 = 4L (should be 8L). Both are halved, and the toast says "Adopted … as a measured run".
  - **Type length** on the held lateral (the common case, since the endpoint is missing): typing 60 gives 60 conduit-ft (should be 120) and 240 ft #3/0 (should be 480).
  - These are the most expensive feeders on the job.
- **Fix.**
  - Send the edge's `sets` in the API: it is in `edge.spec.sets` server-side.
  - **Adopt:** create `sets` markups, or disable Adopt with a tooltip when sets > 1.
  - **Type length:** use the API's `sets`, not the quantities ratio.
  - Add a FeedersPanel test with a 2-set hold edge.

### B5. P newly prices AutoZone-furnished site pole and head material, against the evidence P itself reads
- **Where.** `equipmentConnection.ts:184` (site pole → `LTG-POLE`, material $950), the LTG-POLEHEAD aliases ($385), and `siteGeometry.ts` E2.
- **Failure scenario.**
  - In the baseline these rows were **held at $0** (fuzzy above $250).
  - They are now priced with full library material:
    - gate scenario: 6 × $950 + 10 × $385 = **$9,550 material ≈ $11.5k selling**;
    - after R's 3 poles / 4 heads: $4,390 ≈ $5.3k.
  - Chris carries them as Quoted with $0 material. Agent 1's `furnishStatements` says "K. SITE LIGHT POLES AND BRACKETS" are furnished by AutoZone.
  - P's own E2 regex reads the export's "Site poles, anchor bolts, templates AZ furnished; EC installs" to choose anchor-bolt sets, yet prices the poles' material in the same sync.
  - The line evidence ("Chris's 20–25 ft pole 4.8 h") cites only labor. The $950 is unexplained.
  - The plan's D4 asked for "material is Chris's net where he had it, else $0 with confirm".
  - This is the P-introduced share of gap-analysis item #1.
- **Fix.**
  - When the furnish statements or notes say the poles / site lighting are owner-furnished, carry the site pole and head lines at labor only. Use the same evidence string E2 already finds, quote it on the line, and keep the material overridable.
  - Otherwise give the new pole path a labor-only item (an LTG-POLE twin at $0 material, "material — confirm"), as D4 specified.
  - Interior fixtures and PNL-225 material are pre-existing (see the cross-check below).

---

## Should-fix

### S1. The lighting contactors are priced as sign terminations through a regex coincidence
- **Where.** `equipmentConnection.ts:99`. `HARDWIRED_RE` contains `\bsigns?\b`.
- **Failure.** "Lighting contactors (Work, Sales, **Sign** x2, Site x2) / Within LCP" ×6 becomes 6 × TERM-10 = 4.32 h. Before, it was LC-RELAYPANEL, held.
  - Contactors are a lighting-controls device. Chris carries one 6.0 h contactor lump.
- **Fix.** Exclude `contactor|relay|lcp` before the hard-wired test, or test the noun head (`item` before "(") rather than the zone list.

### S2. The power-pole host row mapped to a pipe pole (gap #3; P-introduced)
- **Where.** `equipmentConnection.ts:175-179`. The pipe-pole test runs **before** the PP test.
- **Failure.** "PP-1..6 — Power poles #1 office … ; #5 PVC data/security pipes …" → RISER-PIPEPOLE ×2 (3 h). After R's 6 hosts it becomes ×6 = 9 h, on the same poles that "PP-1..6 — Power pole circuits" already prices with PP-SET.
- **Fix.** Run the PP test first. A row whose item starts `PP`/"Power pole" joins `ppRows`, so it becomes the `duplicate` note. Only a row *about* the pipes ("3" PVC data/security pipes at pole #5") gets RISER-PIPEPOLE.

### S3. The C7 sidebar lines are missing
- **Plan.** C7 and focus #1 require "N feeder lengths suggested — confirm" and "N feeders need a location/scale" in the sidebar (`BidSummary` / `bidSummaryWarnings`).
- **Actual.** They appear only in the FeedersPanel header, on Labor & Pricing. Priced APPROX rows from feeder and site geometry have no sidebar count at all. A held feeder's MEASURE rows are qty 0, so they are not in `holds` either.
- **Fix.** Add both counts, from `/feeders` summary plus the site estimate, to `bidSummaryWarnings`, so the collapsed strip gets them too. Extend the parity test.

### S4. The Agent 2 feeder RUN rows become notes even when their edge is not priced
- **Where.** `feederRows.ts:174`. The check is `status === 'estimated'`, but pricing also needs `isResolved`: every run of the MEASURE set, every library part, the tier.
- **Failure.** Take a MEASURE set with one run unlocated: the set is kept at 0. The located run's Agent 2 "Feeder 4#3/0 … ×2 RUN" row still becomes a "Replaced by the feeder estimate" note, so the unit_unknown hold disappears. The feeder then shows only as a 0-qty line, which no count picks up (see S3).
- **Fix.** Note only the rows whose edge was actually emitted as priced rows. Return that set from `feederEstimateRows`.

### S5. `/feeders` and the sync read different sheet scales
- **Where.** `feederEstimateDb.ts:132` loads est_sheets for the count docs **plus** the text-layer docs. `footageAllowanceDb.ts:343` loads them for the count docs only.
- **Failure.** An estimator calibrates or accepts C4.1's scale (a civil sheet that is not in `sheetDocuments`):
  - the panel shows "confirmed" and the new length;
  - the synced line keeps the scale-bar length at "suggested".
- **Fix.** One shared loader for both paths, plus a parity test (the same edges, lengths and tiers from `/feeders` and from `computeGeneratedTakeoffRows`).

### S6. Saving a calibration job overwrites the submitted `bids.amount`
- **Where.** `accubidBidData.ts:578` and `bidEstimate.ts:1221` write `bids.amount` on save, whatever the stage.
- **Failure.** Calibration (migration 160) exists to re-price old submitted jobs. Saving one replaces the amount actually bid with the calibration price, which feeds pipeline and win-rate figures.
- **Fix.** Skip the `bids.amount` write (and the bid_estimates snapshot, or label it) when the bid is not in PRE_SUBMISSION_STAGES. Or confirm with Jake that this is wanted.

### S7. The F5 "no silent $0" check can never fail, and the whole gate skips silently without pdftoppm
- **Where.** `replayEval.test.ts:136`: `silent` excludes `l.hold`. But `holds` is *defined* in `pricing.ts` as exactly the set of qty > 0, $0, 0 h, non-note lines, so the filter is always empty.
- **Fix, part 1.**
  - Assert that every hold reason is specific: no `no_unit` fallback on a line that carries a `libraryCode`, and none on a generated row.
  - Assert the hold count against the plan's target (≤ 12 automatic), or pin today's 15 / 14 with a report line.
- **Where.** `replayEval.test.ts:60`: every gate test calls `ctx.skip()` when `pdftoppm` is missing, so CI goes green with nothing checked.
- **Fix, part 2.** Fail when `CI` is set, or split the pricing checks (which need no rendering, given a committed replayed count) from the counting replay.

### S8. The 36th ±15% gate passes partly on a pre-existing double count
- Not P's bug, but it bears on gate honesty.
- 36th prices its fixtures from the library ($3,005) **and** through the "materials. vendor" quote ($4,470), with `fixturePackageQuoted` false (gap analysis §1).
- Without the double count, 36th is $17,631 (−24%), which fails the gate.
- **Fix.** Say so in the report next to the 36th row, and add the "quote present but fixture_package false" prompt to the next round.

---

## Nits
- **`feederEndpoints.ts:115-116`.** `byCircuit` is built and never used. The plan's "assigned by circuit tag if read" is not implemented, so the RTU ends are always paired by sort order. Totals are unaffected (both edges share a spec), but per-run lengths (121 vs 75 ft) can be swapped.
- **`feederRoute.ts:169`.** The adjacent-gear rule (no rise under 15 ft) is P's addition, not in the plan. The gap analysis shows it gives 16 / 11 ft against Chris's ~33 ft for exterior disconnect → interior panel. Name it as a deviation in the report. Consider applying it only when both ends are on the same side of a wall.
- **Polaris taps.** `feederGraph.ts:161` lists the taps, but no line or hold is emitted, so Chris's 9.6 h is silently absent. Emit a visible hold line ("8 taps — needs a unit") until a unit exists.
- **`footageAllowanceDb.ts` `carried`.** `FAMILY_WORDS` matches every HVAC disconnect row whenever any one RTU edge is priced. With RTU-1 priced and RTU-2 held, both disconnect points still come off the ratio.
- **Sidebar double report.** Confirm-match lines are counted both in "N matches to confirm" and in "Total excludes N held lines". Exclude `confirm_match` from the holds line, or say "(incl. N to confirm)".
- **`noteKindOfEvidence`.** It keys on the evidence prefix. If an estimator edits a note line's evidence, the line becomes a `no_unit` hold. Consider persisting the note kind.
- **`hoursGroups.ts:52`.** It classifies the service lateral as site / underground, before the size rule (gap analysis). That is eval-only, but it misstates the feeders gap by 8 h.
- **Report wording.** "The plan's 608 LF lateral estimate isn't supported by the drawing geometry." The gap analysis (§3.1a) shows the 608 LF covered more than the lateral. Fine as a judgment call, but cite §3.1a.

---

## Cross-check of the gap analysis's mapping findings

| Gap finding | Verdict | Where |
|---|---|---|
| AutoZone-furnished **interior fixtures** ($9,155) and **PNL-225** ($2,900) priced | **Pre-existing.** The baseline carried them | `bidEstimate.ts` resolveLines (only `fixturePackageQuoted` zeroes them) |
| AutoZone-furnished **site poles / heads** priced ($9,550 at 6/10) | **P-introduced.** They were held at $0 before | B5 |
| 36th fixtures in the library **and** the unflagged quote | **Pre-existing** | S8 |
| Power-pole duplicate row → `RISER-PIPEPOLE` | **P-introduced** (new item + rule order) | S2 |
| Ceiling fans triple-mapped; FSC → fan | **P-introduced** (new FAN-CEIL + loose alias) | B2 |
| Lighting contactors as 6 terminations | **P-introduced** | S1 |
| ≤ #10 terminations Chris doesn't carry (10.8 h K, 4.8 h 36th) | P's D3 as planned; judgment for Chris (Q7) | — |
| Receptacle-assembly double count (22.7 h) | **Pre-existing.** D6 measured it, report only, correct | — |
| PNL-225 8.0 vs 3.6 h; MC 2.5 / C; fixture units | **Pre-existing** seed units | — |
| Site PVC chain vs radial (317 vs ~700 ft) | Per plan (E1 specified a chain). A follow-up, not a regression | — |
| Taps listed, priced nowhere | **P** (plan asked only for a note); see the nit | — |

## Checked and fine
- **Stage gate.** `isEstimatingBid` is used at every former `PRE_SUBMISSION_STAGES` site. Feeders, box / fitting, site and cost-line preview / seed / opt-ins are all gated. Branch v2 geometry is still confirmed-only.
- **Submitted sync.** Submitted bids get today's MEASURE rows (tested).
- **Migration 158.** It moves only `source='seed' AND accubid_reconciled_at IS NULL` rows (the 156 precedent), inserts with ON CONFLICT DO NOTHING, and the component PK exists. The seed TS agrees (`seedUnitsVsChris`).
- **Units.** I spot-checked against Chris's BOM:
  - PP-SET $650 (5,200 / 8);
  - FUSE-200 $61.72 (370.32 / 6);
  - FAN-CEIL $65 (195 / 3);
  - simplex 0.20 + 0.03;
  - anchor set 0.7 + 4 × 0.12;
  - TERM-4 and TERM-1/0 labeled "default — confirm".
- **Migration 159.** It moves only the untouched v1 setting, and v1 still parses. `accubidRecap` (the six reproductions) passes.
- **Feeder identity.** A typed qty on a generated "Feeder — A → B" conduit line keeps its own `measureId`, so it is not treated as a second estimator feeder. The wire follows the typed run (`wiringScopes.ts:451-460`). The MEASURE → estimate carry-over is shared by length and tested.
- **Scale tiers.** The scale bar fit, NTS, the >5% disagreement, the ±30% area check, half-size ×2 on the vision viewport only, and Manhattan distance invariant under /Rotate 270 are all correct. The overlay draws inside PlanViewer's rotation-aware `<g>` and is tested at E-1's real geometry and in full-screen.
- **Calibration checkbox.** It PATCHes a boolean only and reloads.
- **Baseline.** It was committed before any change. SCRIPTED pins are labeled. Chris's hours are computed from the BOMs.
