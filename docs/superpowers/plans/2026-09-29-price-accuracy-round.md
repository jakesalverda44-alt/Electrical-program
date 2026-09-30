# Price Accuracy Round: matcher safety, answers → estimate, boxes/fittings/hardware, sidebar, remodel reading v2

**Date:** 2026-09-29 · **Status:** Approved by Jake ("yes start") · **Planned by:** Opus 5.5 (main)
**Execution:** two Opus builders in parallel (C = estimate/pricing, D = AI reading) · **Review:** Opus
**Depends on:** main `20f3dce`. Migrations: **C 153–155, D 156–157**.

## Evidence: 36th Street live re-run `ab7e1dc6` (2026-09-29, remodel mode on)
Export: `calibration-data/36th-street-live-run-2026-09-29b/`.

The Estimating sidebar showed **$39,026** (Chris $23,230; 189.2 h):
- **Matcher false positive.** An Agent 2 row "Branch circuit ?/1 — Panel A", spec "1 1; 2 1; … 26 2", qty 17 EA, fuzzy-matched `XFMR-15 Transformer, dry-type, 15 kVA` at $1,100 / 4 h → **$18,700 + 68 h**. "A/C Comp Unit #1 … 40A/2P" also matched XFMR-15 ($1,100 / 4 h).
- **Review answers never reach the estimate.** Jake named unlisted H ("LED high bay 2x4 – warehouse (per Chris)", count 13); proposed lines unchanged.
- **The sidebar total is the Phase-A engine** (small tools/overhead/profit) while the pricing mode is Accubid. The Accubid "Selling price breakdown" shows $0 until lines are saved. Confusing and wrong.
- **Chris's hours by group** (BOM `36th-street-bom.txt`) vs ours (without the bogus lines):
  - wire & MC 54.4 vs ~13
  - conduit & fittings 46.2 vs ~14
  - fixtures 35.1 vs ~15
  - demolition 22.2 vs 23.8
  - boxes & rings 12.9 vs 0
  - hardware 11.8 vs 0
  - devices 6.6 vs ~6
- **Boxes/rings/fittings/hardware have no estimate lines.** accubidImport.ts already derives ratios (deriveConduitFittingsForJob, medianConduitFittingsRatios, deriveBoxAccessoriesForJob).
- **Reading (A2.0 checked by the planner):**
  - Only 1 new duplex found (Chris 5 + 2 GFCI). Shaded vs unshaded is too subtle at the tile scale.
  - A2.0 "Existing Floor Plan – Demolitions" shows ALL existing devices, and the run counted all 40 receptacles as demo (Chris 18). Removal is implied by the walls/areas being removed and by what remains on the new E1.0 plan.
  - Nine "could not be told new or existing" items came from applying E1.0's receptacle-only rule ("SHADED SYMBOL DENOTES NEW RECEPTICLE") to disconnects, switches, panels, AHU/COMP, DISC-A/B and phone.
  - Two demolition classes (disconnect/equipment connection, other device) have no unit.

## Rules (standing, do not relitigate)
- AI finds never count without a human confirm when inferred.
- Never lower a count silently.
- Existing / submitted bids never change price.
- Chris's six Accubid recap reproductions stay exact to the cent.
- Pricing % from 2025–26 jobs.

## Builder C: estimate & pricing (worktree `../Electrical-program-wt-pricefix`, branch `fix/price-accuracy`)
- **C1. Matcher safety** (blocker class).
  - A fuzzy match may never cross equipment families. Define families: transformer, panel/switchgear, fixture, device, wire, conduit, box, equipment connection, demolition, etc. A line's family comes from its category, words and unit; the candidate's family comes from its library category.
  - Fuzzy matches whose extended material > $250 or labor > 2 h per unit, or any fuzzy match into gear (transformer/panel/switchgear), are never auto-priced. They become a "confirm match" line (0 contribution until confirmed).
  - Circuit-list rows (a panel circuit enumeration, qty = circuit count) map to a branch-circuit assembly if one exists, else stay unresolved with the evidence "branch circuit count — wiring carried by the allowance". Never an item.
  - Equipment connection rows ("A/C Comp … 40A/2P", "Air Handler …") map to equipment-connection units by amperage when available, else stay unresolved.
  - Tests use the real 36th rows (both culprits) and a regression sweep over the Kissimmee and 36th proposed lines: list every fuzzy match before/after in the report.
- **C2. Review answers → estimate immediately.** Resolving a review item that changes a quantity updates the proposed lines on the next GET without a new analysis run, via the same enforcement the proposal uses:
  - unlisted tag named + counted → its own line (description = the estimator's name, mapped through the mapper);
  - "same as X" → added to X;
  - count answers → the qty for that type;
  - demolition answers → the demo lines;
  - pole assignment and the like → as already enforced in the proposal.
  - Tests: Jake's actual H answer on the 36th review items → a line of 13 "LED high bay 2x4", mapped to a high-bay item (add a seed high-bay unit if missing, labor from Chris's BOM 1.0 h/E).
- **C3. Boxes/rings/fittings/hardware lines** from Chris's ratios, as allowance lines tied to the device/fixture counts and conduit footage (not ratios of price):
  - boxes + rings + covers per device/fixture;
  - fittings (couplings, connectors, straps) per 100 ft of each conduit type;
  - hardware (anchors, hangers, clips, screws) per 100 ft of conduit plus per fixture.
  - Calibrate on the 5 BOM fixtures with leave-one-out error, as B2 did. Store as editable settings. One source per scope, like wiringScopes: an estimator's own lines in a category replace or subtract.
  - Tests; report the per-job hours vs Chris's for these groups.
- **C4. The sidebar follows the pricing mode.** In Accubid mode, the sidebar total and breakdown are the Accubid recap (material, field labor, prime cost, labor OH, net, markup, selling price) computed on the proposed (unsaved) lines as well as saved ones, so the "Selling price breakdown" is never $0 before a save. The Phase-A figures show only in Phase-A mode. Frontend + route tests.
- **C5. Demolition units** for the missing classes: disconnect/equipment connection (Chris's 36th BOM has none; use NECA-style defaults, marked "default — confirm"), device (other), site pole light, exterior fixture, control. They can then be used by D's lines.
- **C6. Per-bid "use default equipment/GE" button** for bids created before migration 151, so the estimator can opt in. It never runs automatically.
- **C7. The replay.** Price the new 36th export (`…-2026-09-29b`) plus Jake's H answer through the full Accubid recap before/after C1–C6. Target within ±15% of $23,230 on material and hours separately. Report both; if D's expected effect is needed to get there, estimate it separately as before.

## Builder D: AI reading v2 (worktree `../Electrical-program-wt-reading2`, branch `fix/remodel-reading-v2`)
- **D1. Conventions scoped to what they name.** A printed rule applies only to the device classes it names (receptacle → receptacle types; "fixtures" → fixture types; "devices" → devices; unqualified → all). Other types behave as on a new build, with no status question. Removes the 9 noise items on 36th. Test with the real export.
- **D2. Receptacle status by crop check.**
  - When a rule depends on symbol fill (shaded/solid/filled vs open/hollow), or when the tile pass returns status for fewer than ~80% of a rule-scoped type's marks confidently, run a zoomed single-symbol crop check per mark: a cheap vision call, batched several crops per call, using the evidence model setting. Ask "is this symbol shaded/filled or open?" with the legend's own symbol crops as examples.
  - The status comes from the crop answer. Low-confidence answers go to one review item listing them.
  - Cap: 60 crops per run, the rest go to review.
  - Tests with mocked vision.
  - Report the expected 36th result (Chris: 5 new duplex + 2 GFCI).
- **D3. Demolition by comparison.**
  - On an "existing / demolition" plan that shows all existing devices, a device is demo only if:
    (a) it is marked for removal (dashed symbol, removal keynote, inside an area/wall keyed for removal), OR
    (b) it is absent from the corresponding new-work plan (E1.0/E2.0) as existing/relocated at the same registered position.
  - Use the existing sheet-registration (building outline / marks alignment) from the sheet-pair logic.
  - When registration fails, demo = count on the demo plan − count shown as existing on the new plan, per class, as a SUGGESTION with a blocking question showing the arithmetic.
  - Fixtures on an RCP demo sheet whose new lighting plan replaces all fixtures keep today's behavior.
  - Tests: the real 36th export (A2.0 receptacles 40 vs E1.0 existing 25 → about 15; Chris 18).
- **D4.** D's demolition lines use C5's new units (coordinate by unit name; list them in the report).

## Ground rules (both)
- Worktree only; never edit Local Version. No dev servers.
- Tests on electrical_crm_test only; never touch the live DB. Mock Anthropic.
- No push. No Agent tool.
- Commit per task with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Full suites once at the end. Known flakes: intakeSimilarCache ×2, integration lead-backfill, estimatingLibrary seeded-item (test-DB state), notificationsRetention OOM.
- Reports: `docs/superpowers/plans/2026-09-29-price-accuracy-C-report.md` and `…-D-report.md`.
- C and D must not edit the same files except minimal additive changes, named in the report.
