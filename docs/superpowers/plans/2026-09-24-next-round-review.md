# Next Round (Sheet Check & References · Accubid Pricing): Adversarial Review

**Branch:** `feat/sheets-and-pricing`, reviewed range `main(94459cd)..0a3d93b`: 21 commits. Part A was executed by Opus 5, Part B by Sonnet 5. Migrations 125–129.
**Reviewer:** Opus 5.5 (independent, read-only; area sweeps run in parallel, every blocker re-checked by the lead reviewer)
**Date:** 2026-09-24

**Verdict: MERGE AFTER FIXES.** There are 6 blockers. Each has a local fix, but none of them can ship as is.
- Part A is close. Its two blockers are local:
  - a regex that invents missing sheets and prints them on the GC proposal;
  - the supplement pass wiping the Plans-view AI markers.
- Part B's recap math is right to the cent on every job I checked by hand. The wiring around it is not safe to price real bids with:
  - a real BOM import misprices the most common raceway lines;
  - `bids.amount` flips between the two engines;
  - the budget-pending "hold" isn't enforced anywhere on the server;
  - quote and alternate edits aren't scoped to the bid.

## Verification

| Check | Result |
|---|---|
| Merge onto `main` | Trivial. `main` is still `94459cd`, which is the merge-base. |
| `tsc --noEmit` backend / frontend | clean / clean |
| Backend `npm test` (1 full run) | **1696 passed, 4 failed, 4 not run** (1704; 165 files). Same totals as the report. |
| Frontend `npx vitest run` | **1278 passed, 2 failed** (1280; 128 files) |
| Pure test files run by area | countingRetry, agent1Batching, tradeAssignment, reviewItems, accountRules, counter (127/127); accubidBom + accubidImport (44/44) |

**How the failures were classified.** None is a product regression. One is a test-isolation race in a file this branch touched.

- **Backend:**
  - `intakeSimilarCache` ×2, the `integration` backfill timeout, and the `notificationsRetention` worker crash (its 4 not run): known flakes, also present on the baseline.
  - `stopAnalysis` "the end-of-run draft is its own job" (expected 1 SDK call, got 2). **This file was changed by this branch.** It passes 17/17 alone, three times out of three. Cause, from reading the test: the previous S2 test fires a background `/analyze` whose pipeline, now with `planSheetsForRun`'s classifier call and 3 parallel batches, can still call the shared fake SDK after the next test has reset `sdk.calls`. This is load, not product behavior. It is Nit N12.
- **Frontend:** `SurveyMarkupEditor` (known flake) and `PlanViewer` devicePixelRatio (not touched by the branch). Both pass alone, 36/36, twice.
- **I ran the full backend suite once.** A second run wasn't needed to classify these.

**Independent arithmetic** (python from `pdftotext -layout` of Chris's breakdowns, not the repo code):
- **Bubble Down, $36,925.89 ✓**
  - Night crew J 59×1.04+1.50 = 62.86 and A 39×1.04+1.50 = 42.06. Field labor 104×62.86 + 104×42.06 = 10,911.68.
  - OH 42% = 4,582.91. Net cost 30,040.55.
  - Markups: material 22% × 4,915.96 = 1,081.51; labor 22% × 15,494.59 = 3,408.81; quote 18% × 6,630 = 1,193.40; adjustment 4% × net = 1,201.62.
  - Price 36,925.89. Equipment takes no OH and no markup.
- **36th Street, $22,553.54 ✓**
  - Material tax 7% = 237.95. Quotes are taxed, then marked up 10% on the taxed amount (2,312.81 + 2,153.91).
  - OH 70% × 6,383.97 = 4,468.78. Net cost 19,750.67.
  - Markups: material 15% on material *incl. tax* = 545.59; labor 15% × 10,852.75 = 1,627.91. Subtotal 22,330.24.
  - CE sales markup 1% = 223.30. Price 22,553.54.
- **Kissimmee, $79,112.23 ✓**
  - OH 18% × 26,956.52 = 4,852.17. Net cost 65,771.25.
  - Markups: material 22% = 5,685.36; labor 22% × 31,808.69 = 6,997.91; adjustment 1% = 657.71.
- **Orlando:** material markup on material incl. tax and a 1% CE markup, both ✓.
- **The formulas** in `accubidRecap.ts:228-281` match: OH on labor only; labor markup on labor+OH; material markup on material+tax; tax before markup for quotes and equipment/GE; adjustment on net cost; CE markup last; cent rounding per step.
- **The test inputs** are Chris's printed values. None is back-solved.

**BOM reconciliation.** Independent python sum vs the footer vs the parser:

| BOM | My rows | Parser rows / warnings | Mine ($ / h) | Footer ($ / h) | Parser ($ / h) |
|---|---|---|---|---|---|
| Kissimmee | 89 | 89 / 0 | 25,842.56 / 798.949 | 25,842.56 / 798.949 | same |
| 36th Street | 58 | 58 / 0 | 3,399.32 / 189.21 | 3,399.32 / 189.210 | same |
| North Port | 131 | 131 / 0 | 29,593.45 / 1,841.485 | 29,593.45 / 1,841.485 | same |
| Orlando Clubhouse | 96 | 96 / 0 | 14,976.39 / 606.518 | 14,976.39 / 606.518 | same |
| Rockledge | 105 | 105 / 0 | 28,413.56 / 1,393.656 | 28,413.56 / 1,393.656 | same |

- All 5 committed fixtures are byte-identical to a fresh `pdftotext -layout` of the PDFs in `calibration-data/`.
- No real BOM has a wrapped description or a row split across pages, so those two paths are untested on real data.

**Safety.** The repros ran as scratch scripts in the session scratchpad (`npx tsx`/`vite-node`, pure functions) and as DB repros under a scratch `--root` against `electrical_crm_test`, run after the full suite finished. The migration re-run was done inside a transaction that was rolled back. Nothing was written in the worktree except this file. There were no Anthropic, Drive or email calls, and no dev servers. Local Version was not touched. No temp worktrees were created.

---

## Blockers

### B1. The reference regex turns ordinary note wording into "missing sheets", which print on the GC proposal [reproduced]
- **Where:** `backend/src/ai/sheetRefs.ts:125-126`.
  - `CONTEXT_WORDS` includes bare `ON` and `IN`.
  - `ID_TOKEN` allows a plain space between prefix and number (`[A-Z]{1,3}\s?[-.]?\s?\d`).
  - Single letters A/C/D/F/L/S/X are accepted prefixes.
- **Repro** (`extractRegexRefs` on E-sheet text):

  | Note text | Read as |
  |---|---|
  | "MAXIMUM OF 6 RECEPTACLES ON A 20 AMP CIRCUIT." | **A20** |
  | "MOUNT AT 18" AFF IN A 4" SQ BOX." | **A4** |
  | "PROVIDE (2) 20A CIRCUITS IN A 1" CONDUIT." | **A1** |
  | "CIRCUIT ON C-3" | **C3** |
  | "LOCATE ON S 1 SIDE" | **S1** |
  | "INSTALL ON L-1 LEVEL" | **L1** |
  | "PER T-24 REQUIREMENTS" | **T24** |

  Fixture and pole tags ("PHOTOCELL ON S1 AND S2 POLES", "EMERGENCY DRIVER IN F2 FIXTURES") are read as sheets the same way.
- **What follows:**
  - `resolveRefs` marks A20 `missing`: "Sheet A20 not provided at time of bid".
  - The Run button reads "Run without N sheets". Clicking it calls `skip_all_missing` silently (`PcWorkspaceView.tsx:~526`), with no list of what is being skipped.
  - `skippedClarifications` then prints the invented line under Exclusions & Clarifications on the proposal to the GC (`preconstruction.ts:~2976` → `composeProposal`).
  - When the id does exist (arch A4, structural S1), an irrelevant page takes one of the 12 reference slots (see S4).
  - `sheetRefs.test.ts` has no negative cases for any of this.
- **Fix:**
  - Drop ON and IN as context words, or accept them only for a hyphenated or dotted id whose prefix the inventory itself uses.
  - Never accept a plain space between prefix and number unless SHEET/DWG comes first.
  - Reject an id followed by AMP / A / V / " / FIXTURE(S) / POLE(S) / CIRCUIT / TYPE / LEVEL / REQUIREMENTS, and ids equal to a count-target type tag.
  - Show the N sheets in a confirm before "Run without N" skips them.
  - Add every phrase above as a negative test.

### B2. A supplement pass soft-deletes every earlier AI count marker on the bid, and a failed pass doesn't restore them [reasoned; code-traced]
- **Where:**
  - `/supplement` calls `runPipeline(bidId, newFiles, …)` (`preconstruction.ts:~2676`), so the pipeline's `files` holds only the new files.
  - The marker write at `preconstruction.ts:~1187-1188` passes `files.map(...)` to `writeAiCountMarkers`.
  - `estimating/aiMarkers.ts:90-93` first runs `UPDATE est_markups SET deleted_at = now() WHERE bid_id=$1 AND source='ai_count' AND status='suggested'` for the whole bid.
  - The earlier sheets' marks are still in `countResult` (the prior sheets are kept), but `docByFile` maps only the new file. So E-1…E-7 get no markers back.
- **Scenario:**
  1. The estimator uploads a missing M-1 through the "Referenced sheet not in analysis" item.
  2. Every suggested marker on every electrical sheet disappears from the Plans view.
  3. If the pass then fails in Agent 2, `restore()` (`:~2650`) never touches `est_markups`, so the markers stay deleted.
- `supplementPass.test.ts` makes no marker assertions.
- **Fix:**
  - In a supplement pass, pass `[...priorFiles, ...newFiles]`, or scope the soft-delete to the new sheets' documents.
  - Snapshot the soft-deleted ids and un-delete them in `restore()`.
  - Add a test.

### B3. A real Accubid BOM import makes the takeoff mapper price "3/4" EMT" as a 3/4" EMT connector [reproduced; re-run by the lead reviewer]
- **Where:**
  - `backend/src/estimating/accubidImport.ts:184-197` creates `ACB-*` items for every row it can't match exactly or by alias.
  - `backend/src/estimating/mapper.ts:~413-418` breaks a same-tier tie toward the earlier candidate.
  - `backend/src/estimating/library.ts:87` loads `ORDER BY category, name`.
  - {3/4, emt} is a subset of "3/4" Connector - EMT Set Screw Steel", so it ties with seed `EMT-075` at alias tier. '3/4" Connector…' sorts first.
- **Repro:** seed catalog + `buildImportPreview` output, then `mapTakeoffLines` (scratch `f3/sim5.ts`):

  | Takeoff line | Seed only | After Kissimmee import | After all 5 BOMs |
  |---|---|---|---|
  | 3/4" EMT, 1200 LF | `EMT-075`: $720 / 48 h | `ACB-3-4-CONNECTOR-EMT…`: **$192.60 / 120 h** | same connector |
  | 1" EMT | `EMT-100` | `ACB-1-CONNECTOR-EMT…` | same |
  | 3/4" EMT conduit | seed EMT | `ACB-3-4-CONDUIT-CLIP…` (8.2 h/C) | connector |
  | 2" PVC Schedule 40 conduit | `PVCB-200` ($75, 7 h) | `PVCB-200` | **`ACB-2-COUPLING-PVC-C`** ($49.28, 3.2 h) |

  - After a North-Port-only import (2024, no prices), 3/4" EMT is priced at **$0 material**. This is exactly the `materialExt: 0` failure that 3d90851 "fixed" by moving the tests to synthetic BOMs. The test pollution was the production bug.
  - After all 5 BOMs, 139 of 208 ACB items carry $0 material. The token-frequency weights also shift picks between seed items (e.g. Floor receptacle → `DEV-FLRBOX`).
- **Why it's a blocker:** the report calls this "library hygiene". It deterministically misprices the most common raceway lines on every bid after one admin clicks Apply, and the apply route is live.
- **Fix (either):**
  - Create unreconciled ACB items as not mapper-eligible (`active=false`, or a `match_enabled` flag) until reviewed or merged, so they feed calibration and merge suggestions only.
  - Or penalize candidates whose name adds a component noun the description lacks (connector, coupling, strap, clip, bushing, locknut, adapter, elbow, fitting), and break ties toward seed/curated rows instead of name order.
- **Test to add:** a pure test with the seed catalog + the Kissimmee import. "3/4" EMT", "#12 THHN", "2" PVC", "Exit sign" and "LED wall pack" must keep their seed picks.

### B4. In Accubid mode, `bids.amount` and `bid_estimates` flip between the two engines [reproduced]
- **Where:**
  - `bidEstimate.ts:999` (`saveBidEstimate`) and `:777` (`syncTakeoff`) always write the **Phase A** total via `writeBidEstimateSnapshot`, whatever `pricing_mode` is.
  - Only `PUT /:bidId/accubid/settings` (`routes/estimating.ts:850` → `saveAccubidRecapForBid`) writes the Accubid price. Its button is disabled unless a crew or % field changed (`AccubidPricingPanel.tsx:~103`).
  - Quote, cost-line and alternate CRUD (`routes/estimating.ts:~866-962`) recompute nothing.
- **Repro** (electrical_crm_test, a new bid, so accubid mode):

  | Step | `bids.amount` |
  |---|---|
  | Save lines | 1,669.80 (Phase A) |
  | Save Accubid settings | 1,862.40 |
  | Add a $5,000 quote (live recap now 7,762.40) | **still 1,862.40** |
  | Press Labor & Pricing Save | **back to 1,669.80**, and `bid_estimates.grand_total` = 1,669.80 |

- **Also:**
  - BidSummary and the "changed since last save" drift check still use the Phase A recap.
  - `saveAccubidRecapForBid` (`accubidBidData.ts:395-403`) leaves Phase A `line_items`/`subtotals` next to an Accubid `grand_total`. Agent 4 reads those (`preconstruction.ts:~2758`).
- **Consequence:** the dashboard/pipeline amount and the proposal price depend on which button was pressed last.
- **Fix:**
  - Add one `persistPriceForBid(client, bidId)` that branches on `pricing_mode`. Call it from `saveBidEstimate`, `syncTakeoff`, every quote/cost-line/alternate mutation, and the settings save.
  - In Accubid mode, write Accubid-consistent `line_items`/`subtotals`, and show the Accubid price in BidSummary.
  - Tests: after adding a quote, assert `bids.amount`; after pressing Save in accubid mode, assert it again.

### B5. A budget-pending vendor quote blocks nothing on the server [reproduced]
- **Where:** `blocksSend` is computed (`accubidRecap.ts:295`) and used **only** for a banner (`AccubidPricingPanel.tsx:59`). A grep for `budget_pending|blocksSend` finds no gate. `takeoffGate` (`estimating/takeoffReview.ts:31`) returned null with a budget-pending quote on the bid.
- **Paths that go through:**
  - draft-proposal / send / stage → submitted (`routes/bids.ts:~370`)
  - Agent 4 proposal price (`preconstruction.ts:~2711`)
  - compose-draft (`:~2120`)
  - generate-docx (`:~3207`)
  - GC takeoff xlsx (`:~3342`)
  - the pre-bid package (`:~3418`)
- **Scenario:** CES hasn't returned the switchgear price. The estimator enters it as budget-pending and the proposal still goes to the GC at the budget number. This is exactly what the plan's "any budget quote blocks send" was meant to stop.
- **Fix:**
  - Add a budget-pending check to `takeoffGate`, or to a `sendGate` every route above already calls: 409 when `EXISTS (SELECT 1 FROM est_bid_quotes WHERE bid_id=$1 AND status='budget_pending')`.
  - Add route tests on draft-proposal and generate-docx.
  - Disable Send in the UI.

### B6. Quote, cost-line and alternate edits and deletes aren't scoped to the bid in the URL [reproduced]
- **Where:**
  - `accubidBidData.ts:146,164,188,204,228,244`: `updateQuote`/`deleteQuote`, `updateCostLine`/`deleteCostLine` and `updateAlternate`/`deleteAlternate` query by row id only.
  - The routes check access only to `:bidId`.
- **Repro:** a salesperson with no access to the owner's bid (403 when calling it directly) used their *own* bid's URL with the owner's quote id:
  - changed the owner's quote to `firm`, $1 (200);
  - then deleted it (204).
  - Firming a quote this way also clears the hold from B5.
  - A PUT with `{amount:'abc'}` returns 500, because patches aren't validated.
- **Fix:**
  - Add `AND bid_id = $2` to every by-id query, and return 404 on 0 rows.
  - Run patches through `validateQuoteInput` / `validateCostLineInput` / `validateAlternateInput` in partial mode.
  - Add a cross-bid test.

---

## Should-fix

### S1. Opus 5.5 tiles are not sharper: the API caps images by total pixels too [reproduced by arithmetic against the Claude API image docs]
- **Where:** `backend/src/ai/modelLimits.ts:14-16, 29-33`, and the report's A5 section.
- **The limit:** high-res models take 2576 px on the long edge, but an image is also capped at about 3.75 MP (≈4.8k tokens).
- **What the code sends:** a 36×24 sheet with a 10.5" spec gives 12 tiles of ≈8.85×8.67". They are sent at 2576×2523 (6.5 MP) and the server downscales them to ≈1914 px, which is **≈216 px/in**. The 1568 px path gives ≈215 px/in, so there is no gain.
- **On 42×30 sheets** Opus gets *less* resolution (≈206 vs 220 px/in).
- **The report's claims are wrong:** "245 px/in", "sharper" and "8.8k tokens, 1.6×".
- **Fix:** size tiles against an area budget (≈3.5 MP) as well as the long edge. Assert w×h ≤ 3.75 MP in the tile-sizing test, and correct the report. The `opus-5-5` id matching itself (plain, `[1m]` and Bedrock) is fine.

### S2. The dense-area retry replaces every type on the sheet and silently accepts lower counts [reasoned]
- **Where:** `backend/src/ai/countingStage.ts:208-236`.
- **Scenario:** only B was unreadable on E-3, A=55. The retry (a different tile grid) reads A=48, and the sheet takes it. The only trace is a note, "A 55→48"; no review item is raised. That makes the undercount this feature was meant to fix worse.
- **Cost:** the retry costs ≈2.2× the first pass (Opus on 36×24: 30 tiles). This isn't disclosed.
- **Fix:**
  - Take the retry's counts only for `firstUnreadable` types.
  - Raise a blocking count item when the passes differ by more than 10% or 2.
  - Disclose the cost, and pass `onProgress` during the retry.

### S3. Supplement pass: page selection on new files double counts [part (a) reproduced; part (b) reasoned]
- **Where:** `services/sheetCheck.ts:144/150`, `preconstruction.ts:~1100` (`mergeAgent1Batches([prior, parsed])`) and `:2647-2649`.
- **(a) An M-1 uploaded on its own becomes an `analysis` page.** The cause is the "never drop everything" rule, with only the new file planned. Agent 1 reads it in full and the RTU/EF rows are concatenated a second time.
- **(b) The sheet arrives inside a revised full set** (new hash, common with addenda):
  - the E-sheets already analysed pass the hash dedup;
  - they are re-counted (`countingStage.ts:~323`; `selectCountSheets` doesn't dedupe by sheet number);
  - they produce "same area?" questions. The A7 bulk "all different areas" then **sums** old E-2 and new E-2.
- **Fix:**
  - Plan the new files against the bid's existing inventory, so other disciplines become `reference`.
  - Drop, or flag, pages whose normalized sheet number is already in `priorInventory`.
  - Merge Agent 1 output per sheet.

### S4. The 12-page reference cap can crowd out PH0.1, which is the Kissimmee fix itself [reproduced]
- **Where:** `services/sheetCheck.ts:164-188`. Explicit and discipline references take slots before always-useful pages.
- **Repro:** "SEE CIVIL" + "SEE ARCH" + "SEE STRUCTURAL" fill all 12 slots, 4 each. PH0.1 is then excluded ("reference page limit of 12 reached") and W1/W2/S1/S2 go back to 0.
- **Fix:** give photometric and M/P equipment-schedule pages priority or a reserved share, and cap each broad discipline at about 2–3 pages.

### S5. `restore()` after a failed or stopped supplement is not exact [reasoned]
- **Where:** the claim (`preconstruction.ts:~2631`) nulls `agent4_run_id`/`draft_run_id`, and `restore()` never puts them back. The Agent 2/3 and counter usage and model columns aren't restored either.
- **Worse:** the "already part of this analysis" 400 path also goes through claim → `restore()`. So re-uploading a file already in the run marks the finished Agent 4 proposal and the draft as not current, which forces a paid Agent 4 re-run.
- **Fix:** snapshot and restore those columns, and run the duplicate-file check before claiming.

### S6. The classifier cache makes a miss permanent [reasoned]
- **Where:**
  - `services/sheetCheck.ts:267-275, 301-312`: the key is `content_sha256` only. The model is stored but never compared, and there is no prompt version.
  - A page Haiku skipped is filled in as `unknown`/`schedule` (`pageClassifier.ts:~208`), and `countSheets.ts` never counts those.
- **Scenario:** a plan sheet missed once is never counted on any later re-run of that file. Before this branch, every `/analyze` classified again.
- **Fix:** don't cache filled-in pages (or cache them with a retry flag), include the model and a prompt version in the key, and add "re-classify".

### S7. Skips can land on a stale sheet check, and a supplement leaves its skip clarification in place [reasoned]
- **Stale check:** "Run without N" uses the hook's last data (`PcWorkspaceView.tsx:~524-526`). The `skip_all_missing` PUT (`routes/sheetCheck.ts:119-123`) never compares `input_key`, and `reselect()` (`sheetCheck.ts:525-531`) writes with no `run_token` or row lock.
  - Scenario: Run is clicked while the ~1-minute check of newly added files is still running. The skips hit the old references, and the new missing sheets never become clarifications.
- **Supplement:** `onSupplement` (`PcWorkspaceView.tsx:~1092`) doesn't re-run the check, so "Sheet E-9 not provided at time of bid" still prints after E-9 has been analysed.
- **Fix:**
  - Compute missing and skipped references in `/analyze` from `planSheetsForRun`'s result.
  - Refuse the PUT while a check runs or when `input_key` differs, and use `FOR UPDATE`.
  - Resolve matching skips after a successful supplement.

### S8. The GC-scope exclusion gate misses common phrasings [reproduced]
- **Where:** `bidstd/tradeAssignment.ts:112-113` (`ELECTRICAL_ITEM`, `BY_GC`).
- **These pass the gate and can print as exclusions:**
  - "GC to provide receptacles"
  - "Temporary power by GC"
  - "Low voltage cabling by GC"
- **Also:**
  - Agent 4's scope and clarification sections aren't scanned.
  - The `gcTerms` allow-list tests the whole line, so "Receptacles and lighting by GC" passes when only lighting was really assigned to the GC.
- **Fix:**
  - Add `(g\.?c\.?|general contractor)\s+(to|shall|will)\s+(provide|furnish|install|supply)`.
  - Add power / temporary power / cabling / raceway / device box to `ELECTRICAL_ITEM`.
  - Apply the allow-list per item.

### S9. A bare "BY OWNER" turns a zero-count fixture into information instead of a block [reproduced]
- **Where:** `bidstd/tradeAssignment.ts:72-78` (a bare trailing party covers both halves) together with `ai/reviewItems.ts:171-181`.
- **Scenario:** "Type F pendant — BY OWNER" with a zero count is non-blocking, so install labor silently drops out. Decision 4 says owner-furnished is still APT-installed.
- **Fix:** read a bare Owner/Vendor as furnish-only. Only an explicit "installed by owner/others/<trade>", or N.I.C., should become information.

### S10. The Labor & Pricing duplicate gate [reproduced; the "remove new line" part reasoned]
- **Where:** `bidstd/enforceCounts.ts:72-86` (`plausiblySameText`).
- **Misses (the double count gets through):**
  - "Pole light S1" vs "S1 site pole"
  - "Fixture type C" vs "Type C"
- **False pairs (only friction):**
  - 2x4 vs 2x2 troffer
  - duplex vs quad
  - USB vs duplex
- **GFCI-vs-duplex fix holds**, as do GFI≈GFCI and "20A duplex"≈"duplex 20A".
- **"Same item — remove the new line" deletes the line** (`LaborPricingStep.tsx:~353`). The next sync re-inserts it from the takeoff and the pair comes back.
- **Fix:**
  - Match on a type tag.
  - Add a POLE group, and treat an N×M size mismatch as a conflict.
  - Mark the removed line `excluded: true`, which sync preserves, instead of deleting it.

### S11. "Prices only from the 2026 Kissimmee BOM" is a caller flag, not a rule [reasoned]
- **Where:** `routes/estimating.ts:~624-639`. `applyPrices:true` on any BOM writes its net costs, stamped `2026-06-18` (`KISSIMMEE_PRICE_DATE`) when no `bomDate` is given.
- **Scenario:** 2024 North Port prices get dated 2026-06-18. With S13, some rows would write `material_cost = -100`.
- **Fix:** parse the report date from the BOM header, allow prices only when it is on or after a configured cutoff, and always stamp the parsed date.

### S12. Apply ignores reconciliation, and unparseable lines vanish silently [reasoned]
- **Where:**
  - `accubidBom.ts:193-194`: a line that fails `ROW_HEAD_RE` returns null and is never reported.
  - `accubidImport.ts:216-218`: `reconciles` is true when there's no footer.
  - Apply never checks `reconciles` or `warnings`.
- **Fix:**
  - Warn on any qty+unit-shaped line that doesn't parse.
  - Apply returns 409 unless the BOM reconciles and has no warnings, or `force` is passed.
  - A missing footer counts as not reconciled.

### S13. Material columns are assigned by field count, so 5 real rows parse `netCost = -100` [reproduced]
- **Where:** `accubidBom.ts:140-148`. A blank Price or Cost column shifts vendor adj % into `netCost`.
- **Rows affected:**
  - North Port: 400W HPS lamp; 2-button LV control.
  - Orlando: 250W and 400W MH lamps.
  - Rockledge: 30A NEMA 3R safety switch.
- **Why the reconciliation misses it:** the totals are 0, so the footer still reconciles.
- **Fix:**
  - Take column x-positions from the header line.
  - At minimum, reject a row whose net cost is negative, or where qty/divisor × net differs from the total by more than 1¢, and warn instead.

### S14. The 40-character code slug merges different items; last import wins [reproduced]
- **Where:** `accubidImport.ts:87` (`.slice(0, 40)`).
- **Collisions:**
  - 400A safety switch NEMA 3R (4.8 h) and NEMA 1 (4.4 h, $1,794.56) → one code.
  - Panelboard "MLO recessed" and "main breaker surface" → one code.
- **Effect:** labor depends on import order.
- **Fix:** append a short hash of the canonical text. No production rows exist yet, so this is free now.

### S15. Reconciled seed items are overwritten with BOM hours, without a unit check [reproduced]
- **Where:** `accubidImport.ts:184-186, 204-212`.
- **Observed:**
  - `PNL-225` goes 8 → 3.6 → 4.5 → 3.6 h depending on BOM order.
  - `XFMR-45` goes 6 → 16.2 h.
  - `LC-CONTACTOR` goes 2 h/$180 → 6 h/$800.
  - `LTG-EM` takes "2-Heads 80W Unit Equipment" hours.
- **No unit check:** the update writes BOM hours without checking `existing.unit === unit`.
- **Fix:**
  - Show reconciled matches in the preview as suggested updates that are accepted per row.
  - Require the same unit, or convert.
  - Never let an older BOM overwrite a newer one.

### S16. The 7-Eleven auto deduct deducts too much, and its amount goes stale [reasoned]
- **Too broad:** `autoDeductAlternate.ts:35-45` matches the whole "Service & Distribution" category for panels/disconnects/other equipment. That includes APT's feeder wire and conduit. `/lighting/i` also matches "Lighting Controls" and site-lighting lines.
- **Stale:** the amount is synced only on the Accubid settings save (`accubidBidData.ts:414`), so a later sync or line edit prints the old dollars.
- **Incomplete:** the deduct omits the adjustment and CE markups that the base price applies to the same material.
- **Printed twice:** "DEDUCT $X" appears twice, once from `formatAlternateBullet`'s prefix and once from the label seeded in migration 129.
- **Labor is correctly excluded.**
- **Fix:**
  - Match on descriptions (panel/switchgear/SPD/disconnect/receptacle/luminaire), excluding conduit/wire/feeder and "Lighting Controls".
  - Compute the deduct as sellingPrice(all) − sellingPrice(without the matched material), with labor left in.
  - Sync it in the B4 persist hook, and print the amount once.

### S17. There's no way to switch pricing mode, and Accubid mode drops labor factors [reasoned]
- **No switch:**
  - Migration 128 correctly backfills existing rows to `phase_a` and defaults new bids to `accubid`. The Decision 5 defaults 38/20/18/0 and burden 4 / fringe 1.50 are right.
  - But no UI sets `pricing_mode` (only `PUT /:bidId` settings accepts it). "Unless the estimator switches" is therefore impossible.
- **Factors dropped:** `materialAndHoursFromLines` (`accubidBidData.ts:301-308`) prices with `factors: []`. A bid's multi-story or height labor factors are silently dropped in Accubid mode, and that panel is hidden.
- **Fix:**
  - Add a mode toggle that re-persists the price (B4).
  - Apply the factors, or a per-line labor adj %, in the Accubid hours sum, or show "factors not applied".

### S18. Test integrity: the real-data import path is not covered where it matters [reasoned]
- **What happened:** 3d90851 moved every import write test to synthetic tagged BOMs, to stop cross-file pollution.
- **Why that matters:** the pollution *was* B3, a real mapper regression. The fix hid it rather than covering it.
- **What remains:**
  - The pure tests run the real fixtures through `buildImportPreview` only against an empty or tiny library.
  - Nothing runs the mapper against the seed catalog after an import.
- **Fix:** add the pure seed+import mapper test from B3 (no DB needed, so no pollution risk).

---

## Nits

- **N1.** Line-wrapped refs are lost: "SEE SHEET\nE-2" yields nothing (`sheetRefs.ts:157` splits by line). [reproduced]
- **N2.** Sheet ranges aren't expanded: "SEE E-1 THRU E-4" yields only E4 (E-1 to E-3 are dropped). [reproduced]
- **N3.** "REFER TO ARCHITECTURAL REFLECTED CEILING PLAN" yields RCP *and* architectural, which pulls in 4 arbitrary A-sheets. A bare heading "MECHANICAL EQUIPMENT SCHEDULE", or a bare "RCP" in an abbreviation list on an E-sheet, yields a missing "Mechanical schedules not provided" on an electrical-only set (`needsContext:false`). [reproduced]
- **N4.** `normalizeSheetId` allows at most 3 digits (E-1001 fails), and "E2.01" vs "E-2.1" don't unify. [reasoned]
- **N5.** Page texts and plans are keyed by original file name, so two PDFs both named "Electrical.pdf" (set + addendum) mix. Key by sha. [reasoned]
- **N6.** `readVagueRefs` sends at most 40 sentences to Haiku but marks every page as read, so the rest are never read. [reasoned]
- **N7.** The sheet-check PUT has no `run_analysis` permission check, even though skips print on the proposal. Overrides keyed `sha#page` lapse silently when a file is revised. [reasoned]
- **N8.** A failed Agent 1 batch doesn't abort its ≤2 siblings in flight, which are billed anyway. `usage_agent1` isn't written on failure. Progress writes are fire-and-forget and can land out of order ("2 of 13" after "3 of 13"). (`agent1Batching.ts:251-282`) [reasoned]
- **N9.** The bulk review resolve route doesn't check that the `itemIds` share a group or kind on the server (`preconstruction.ts:~2059`). The UI is correct. [reasoned]
- **N10.** `tradeAssignmentOf` misreads that err toward blocking: "Signage by sign vendor, power by EC" → APT F&I; "BY GC/EC" → null. [reproduced]
- **N11.** `computeFieldLaborCost` misses Chris's per-role lines by 1¢ on 4 jobs, including the even 1:1 splits (36th −2¢, Orlando −1¢). The "uneven split" explanation in the comment and the report is wrong: Accubid carries more precision in hours. Fix the comment and add the ≤$0.05-tolerance tests for 36th and Orlando. The full-recap reproductions are unaffected. [reproduced]
- **N12.** The `stopAnalysis` S3 test races the previous test's background `/analyze`, and failed in the full run. Await or abort that run in the S2 test's cleanup. [reproduced]
- **N13.** Migration 129's guard compares `terms` only, so an admin's edited `notes` is overwritten when `terms` is still the seed. Also compare `notes`, or leave `notes` alone when it differs. [reproduced in a rolled-back transaction]
- **N14.** Mixed-tax equipment/GE lines are blended into a rounded % (`accubidBidData.ts:333-334`): 1,000 @ 7% plus 500 @ 0% gives 70.05, not 70.00. Pass the tax in dollars. [reasoned]
- **N15.** `validateAccubidSettings` night fields accept NaN, which becomes a 500. The night inputs render `value={null}`. `bid_estimates.overhead_pct` / `profit_pct` change meaning by mode. [reasoned]
- **N16.** B4 calibration (`bomCalibration.ts:69-78`) looks up the BOM's own `ACB-` codes. After an import those hours *are* Chris's, so every delta is ≈0. It should compare against the items the mapper actually prices from. [reasoned]
- **N17.** Import: a manual edit that lands between preview and apply is overwritten and relabelled `accubid` (use `WHERE source <> 'manual'` in the UPDATE). The pole-base count comes from the first pole row only. `skip_unparsed` is never produced. [reasoned]

---

## Verified OK

- **The recap engine:**
  - Every formula and the rounding order reproduce all 6 breakdowns to the cent. I did Bubble Down, 36th Street, Kissimmee and Orlando independently.
  - The test inputs are Chris's printed values.
  - Alternates only add bullets; `total_price` is unchanged, and they are included in the compose hash.
  - Night rates apply only on the night shift, with a day-rate fallback.
  - The auto deduct never includes labor.
- **The BOM parser:**
  - Both column layouts are handled.
  - So are No Cost / Quoted / Halted / Budget, negative vendor and field adj %, the clipped "1,315." percentages, and header and page repeats.
  - `source='manual'` is never updated through preview or apply, including as a reconciled match. `source` is `NOT NULL DEFAULT 'manual'`, and created rows are relabelled `accubid`.
- **Default mode:** existing estimates were backfilled to `phase_a` (2,849 test rows unchanged on re-run). Bids without a row get `accubid`, and `COALESCE` keeps the stored mode.
- **Migrations 125–129** re-run cleanly inside a rolled-back transaction. All are additive: `IF NOT EXISTS`, drop-then-add constraints, guarded UPDATEs, no data DROP. 129 is a no-op on re-run.
- **The reference finder** correctly ignores:
  - NEC 210.8, UL 924, RTU-1, "CKT C-3", "PANEL L-1";
  - spec sections 26 05 19 and 16-1, ASTM E-119.
  It handles 3/E-5, E2.1, lower-case "m101" and lists.
- **Sheet check:**
  - Overrides survive an identical re-upload and re-checks, and `/analyze` honors them. Exclusion wins.
  - `run_token` supersession works, and the Haiku and vision reads are cached.
- **Supplement pass:**
  - The claim uses `FOR UPDATE`, accepts complete runs only, and every write is guarded by run_id and cancellation.
  - A concurrent `/analyze` supersedes it without a stale restore.
  - It restores the agent1/2/3 outputs, `count_result`, `prep_inventory` and review items.
- **Clarifications** reach `composeProposal`, are deduplicated, and join the hash only when present.
- **A5 parallel batches:**
  - Merge by index is identical to sequential.
  - `shouldStop` is checked before each start, and in-flight batches abort on stop.
  - 429s are retried by the SDK (retry-after) and then by `callWithRetry`.
  - The retry runs once and can't loop.
- **A6:**
  - GC reads as APT with `viaGc`, and the raw parser keeps our own GC answers.
  - The power-pole `ask` stays asked with APT pre-filled, and the rule rides in every account-terms block.
  - The Kissimmee legend strings parse correctly.
- **A7:**
  - Bulk resolve is all-or-nothing and uses each item's own option.
  - Info items never hold the gate.
  - The duplicate gate runs on the PUT (409) and in `takeoffGate`, which covers every proposal and send path. `dup_ok` survives sync.
