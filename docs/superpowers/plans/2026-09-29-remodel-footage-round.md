# Remodel + Footage Round: new/existing/demo, unscheduled tags, legend noise, footage allowance, equipment/GE

**Date:** 2026-09-29 · **Status:** Approved by Jake ("yes lets do that… any plans that are uploaded will also do auto-estimate footage")
**Planned by:** Opus 5.5 (main) · **Execution:** two Opus builders in parallel (A = AI reading, B = pricing) · **Review:** Opus
**Depends on:** main `da59e4d`. Migrations: **A uses 148–149, B uses 150–151** (no collisions).

## Why (evidence)
- **36th Street Warehouse** (remodel), live run `550da561`, 2026-09-29, $2.37. Chris: $23,230 submitted, 189 hrs. The AI's estimate came to ~$10k.
  - Type A 14 and B 2 are exact; switches 15 vs 16.
  - **Missed 13 type-"H" warehouse fixtures.** H is drawn on E2.0 but absent from the fixture schedule. The counter only counts targets (countTargets.ts; counter.ts:164,178 rejects anything else).
  - **Receptacles 26 vs Chris's 5 new + 2 GFCI.** E1.0 says "SHADED SYMBOL DENOTES NEW RECEPTACLE"; the AI counted existing devices too. There is no new/existing/demo concept anywhere (only prompts.ts:466).
  - **Demolition** (52 2x4 fluorescent, 2 HID high bays, 2 exit/em, 18 receptacles, 6 SP + 2 3-way switches) is on A2.0/A3.0 "…Demolitions" sheets. None of it is counted or priced, and the seed library has no demo units.
  - **Wire/conduit:** Agent 2 wrote `allowances[]` with footage 0, and `parseAgent2Takeoff` drops `allowances[]` entirely (bidEstimate.ts:498). There are no footage rules at all. Chris: ~670 ft EMT, ~3,660 ft #12/#10, 378 ft MC.
  - **Equipment $890 / GE $310:** no defaults exist.
  - About a dozen 0-qty "COUNT PENDING ESTIMATOR REVIEW" lines come from the architect's master legend: symbols not used on this job.
- **Data:**
  - `calibration-data/36th-street-live-run-2026-09-29/` (count_result, review_items, agent1-3, prep_inventory, sheet_check)
  - `calibration-data/kissimmee-live-run-2026-09-28/`
  - Chris's BOM fixtures in `backend/src/test/fixtures/estimating/accubid/{36th-street,kissimmee,north-port,orlando-clubhouse,rockledge}-bom.txt` (qty = raw feet; the unit letter is only the pricing divisor)
  - Answer key: `calibration-data/36th-street-warehouse.expected.json` (regex; B converts it to type tags, see B5)
  - Plan set PDF: `~/Desktop/36th Street Warehouse - Plan Set.pdf`

## Standing rules (Jake-approved, do not relitigate)
- AI finds never count without a human confirm when they are new or inferred (gap-fill, unscheduled tags, suggestions).
- The evidence gate applies on GC-facing outputs; the pre-bid package is exempt.
- "By G.C." = APT scope; owner-furnished = APT installs.
- Pricing: labor OH 38%, material/labor markup 20%, quotes 18%.
- Never lower a count silently. Every change is visible with its reason.

## Builder A — AI reading (worktree `../Electrical-program-wt-remodel`, branch `feat/remodel-reading`)

### A1. New / existing / demolition status (accuracy-critical)
1. **Conventions per sheet.** Agent 1 (or a cheap reader on the sheet's text layer/notes, else vision on the notes/legend crop) extracts status conventions. Examples:
   - "SHADED SYMBOL DENOTES NEW …"
   - "(E) = existing", "EXISTING TO REMAIN", "dashed = to be removed", "DEMO"
   - sheet titles containing DEMOLITION / EXISTING … DEMOLITIONS / ALTERATIONS
   - Store them with evidence (sheet + quote).
2. **Counter:** when a sheet has conventions, the counter prompt includes them, and every mark returns `status: new|existing|demo|relocated|unknown`.
   - Only `new` (and `relocated`) count toward install lines.
   - `demo` counts toward Demolition lines.
   - `existing` is listed but never priced.
   - No conventions on a new-build sheet → everything is `new`, exactly as today (a Kissimmee regression guard).
3. **Demolition sheets:** any sheet whose title says DEMOLITION (any discipline, e.g. A2.0/A3.0 here) becomes a count sheet for **demo only**, with targets from the legend plus the fixture schedule. Its marks are all `demo`. Deduplicate against demo marks on the E-sheets by position only when both have geometry; otherwise raise a review item.
4. **Remodel with no convention:** job profile build_type = remodel/tenant, or sheet titles say ALTERATIONS/EXISTING, but no convention was found → ONE blocking review item: "How are new vs existing devices shown on these plans?" with the options (all new / shaded = new / … / tell me). The count stays unchanged until answered.
5. **Demolition takeoff lines** go in a new takeoff category "Demolition", e.g. "Demolition — 2x4 fluorescent fixture". Each line has evidence (sheet, marks). B prices them.

### A2. Unscheduled fixture/device tags
- The counter may report tags drawn with a fixture or device symbol that are NOT in COUNT TARGETS, as `unlisted: [{tag, symbolDescription, marks}]`. Remove the hard rejection for this channel only.
- They become ONE review item per tag: "Type H drawn 13× on E2.0 — not in the fixture schedule. What is it?"
  - The count is shown as a SUGGESTION, not counted until the estimator confirms and names it.
  - A "same as type X" answer merges it into X.
- Guard: tags that are circuit numbers, room numbers, keyed-note numbers or door tags are never reported. Add tests with real 36th Street tags (A01, A05, A08, room names).

### A3. Legend noise
Zero-count types from a **legend** with no other evidence (no panel circuit, no schedule qty, no note/Agent 1 mention, no equipment row) collapse into ONE informational group: "Legend symbols not used on this job (N)", which the reviewer can expand.
- Zero-count **fixture-schedule** types and evidence-backed zeros stay as review items, as today.
- Agent 2's "COUNT PENDING ESTIMATOR REVIEW" 0-qty rows for collapsed symbols are not emitted as takeoff lines.
- Kissimmee check: the chargers-style case (panel circuit, no symbol) must remain a review item.

### A tests
- Real-shape fixtures from the 36th export.
- Mocked counter replies for the status field and unlisted tags.
- The 9/28 Kissimmee replay must be unchanged (no conventions → all new; review items unchanged apart from legend collapsing, which should be ~0 on Kissimmee).
- A1/A2 change what the model returns, so they can't be proven without a live run. The report must say exactly what the live 36th re-run should show.

## Builder B — pricing (worktree `../Electrical-program-wt-footage`, branch `feat/footage-allowance`)

### B1. Stop dropping allowances
`allowances[]` with footage > 0 become est lines (category preserved, confidence ESTIMATED, evidence = Agent 2's note). Footage 0 → no priced line, but a visible "needs footage" row. It is never silently lost.

### B2. Footage allowance for every analysis (the main item)
A deterministic module `estimating/footageAllowance.ts`, run after counting for every bid.
- **Inputs:** per-category counts of new devices and fixtures (receptacles, switches, lighting fixtures by kind, equipment connections, site poles), panels/feeders from the panel schedule and riser, and job size (SF from the job profile when present).
- **Branch method v1 (ratio):** conduit ft and wire ft per device/fixture, by category and raceway type (EMT vs MC vs PVC site), calibrated from Chris's 5 BOM fixtures:
  1. Derive the ratios by fitting BOM footage to BOM device/fixture counts.
  2. Report leave-one-out error per job in the report.
  3. Store the ratios as editable settings (a table or app_settings), not constants.
  - Wire ft ≈ conduit ft × conductors (from panel circuit wiring, e.g. 2#12 1#10G → 3), plus MC for fixture whips/drops where Chris uses MC.
- **Branch method v2 (geometry, when available):** if the sheet has a confirmed or title-block (unambiguous) scale, marks have geometry, and a panel position is known (a counted panel type's marks, or a manual pin), then per-circuit homerun ≈ Manhattan distance device→panel × ft/pt + drops (est_default_drop_ft) + slack (est_default_slack_pct).
  - Use the larger of v1 and v2 only when they disagree by more than 40%, and flag it. Otherwise use v2.
  - Label the method on each line.
- **Feeders:** when the riser/schedule gives the feeder size but no length → a feeder line with qty from v2 geometry if possible, else a blocking-free "measure feeder" line (0 qty, visible) linked to the Plans view measuring tool.
- **Output:** est lines in "Branch Wiring (allowance)" / "Feeders (allowance)", mapped to library items (3/4" EMT, #12/#10 THHN, 12/2 MC …) through the existing mapper with LINEAR units.
  - Evidence text shows the math, e.g. "31 devices × 21.6 ft EMT (calibrated on 5 of Chris's jobs) = 670 ft".
  - `qty_overridden` survives syncs. Confirmed measured runs (est_markups `applyMarkups`) replace the allowance for that line.
- **Remodel:** count only `new` devices (from A1). Before A merges, use all devices.

### B3. Demolition pricing
Seed demo labor units from Chris's 36th BOM demolition rows:
- fluorescent up to 2x4: 0.31 h/E
- HID high bay: 0.58
- exit/em: 0.50
- receptacle: 13.2 h/C
- switch 1-pole: 12.8 h/C
- switch 3-way: 15.5 h/C

Material $0. The mapper maps category "Demolition" lines to them.

### B4. Equipment & general expense defaults
Derive defaults from Chris's breakdowns (bid_cost_breakdown rows plus the PDFs in calibration-data: equipment $ and GE $ vs labor hours). Use a simple tiered or per-hour rule; show the fit in the report.
- Seed an editable default into est_bid_cost_lines ("Equipment — default", "General expenses — default") when a bid has none.
- Never overwrite user lines. The settings UI can edit the rule.

### B5. 36th Street answer key + price check
- Convert `calibration-data/36th-street-warehouse.expected.json` into `backend/eval/36th-street-warehouse.expected.json` with type tags (A=14, B=2, H=13 disputed-until-A2, switches $+$3=16, duplex new 5, GFCI new 2), demolition items as counted items once A1 exists (disputed for now), and `reference_estimate` = $23,230.14 / 189.21 hrs / database material $3,399.32 / quotes $4,466.72 / equipment $890 / GE $310.
- Add a replay test that prices the stored 36th run through the full recap with B1–B4. Report the before/after total vs $23,230, with A's expected effect estimated separately.
- Target: within ±20% once A's fixes are in.

### B tests
Real BOM fixtures and the real 36th export; recap math tests; the existing Kissimmee pricing reproduction (Chris's pricing to the cent on 6 jobs) must stay exact.

## Ground rules (both)
- Work only in your worktree. Never edit Local Version. No dev servers.
- Tests only: `npm test` in backend (uses electrical_crm_test) and `npx vitest run` in frontend. Never touch the live DB.
- No real Anthropic calls: mock them.
- No push. No Agent tool.
- Commit per task with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Run the full suites once at the end. Known flakes: intakeSimilarCache ×2, integration lead-backfill.
- Reports: `docs/superpowers/plans/2026-09-29-remodel-reading-report.md` (A) and `…-footage-allowance-report.md` (B).
- A and B must not edit the same files. If a shared file is unavoidable (e.g. reviewItems.ts, mapper.ts categories), keep the change minimal and additive and name it in the report.
