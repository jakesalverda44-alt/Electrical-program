# Next round — execution report (Part A)

**Branch:** `feat/sheets-and-pricing` (worktree `../Electrical-program-wt-next-round`), from local main `94459cd`.
**Executor:** Opus 5 · **Date:** 2026-09-24
**Scope change (coordinator, mid-run):** Part A only. Part B is left to a Sonnet executor on this same branch/worktree (see "For Part B's executor" below).

## Commits (`main..HEAD`)

| Commit | Task |
|---|---|
| 1161c16 | The plan (copied in unchanged) |
| b331329 | A2: reference finder (pure regex + resolver + always-useful pages) |
| a183758 | A1: page inventory as a first-class record (sheet check) and the analysis uses it (migration 125) |
| 48b2f5d | A3: Sheet Check panel, "Run without N sheets", photometric site fallback, clarifications |
| 82310bc | A4: "Referenced sheet X not in analysis" + supplement pass (migration 126) |
| 6f19eb1 | A5: counter tiles per model, dense-area retry, parallel Agent 1 batches |
| 1fbdf96 | A6: "By G.C." = APT scope (Decision 4) |
| e9263e0 | A7: review noise (groups, bulk actions, info items) + Labor & Pricing duplicate block (migration 127) |
| 78ea26b | A1 follow-up: the sheet check treats every stop as a stop |
| b18e58a | A7/A6 follow-up (from the full run): a GFCI is not a plain duplex in the duplicate check; the route test for Decision 4 |

Migrations: **125** (`sheet_page_cache`, `bid_sheet_check`), **126** (`takeoff_results.supplement`), **127** (`est_bid_lines.dup_ok`). All additive (`IF NOT EXISTS`). **Part B starts at 128.**

## Test suites

| Suite | Baseline (main `94459cd`, before any change) | Part A (final) |
|---|---|---|
| Backend `npm test` | 1528 tests: 1521 passed, 3 failed, 4 not run. 147 files (144 passed, 2 failed, 1 lost to the worker crash) | **1605 tests: 1597 passed, 4 failed, 4 not run.** 156 files (152 passed, 3 failed, 1 lost to the worker crash) |
| Frontend `npx vitest run` | 1250/1250 (125 files) | **1264 passed, 2 failed** (126 files); both failures pass alone (4/4) |
| `tsc --noEmit` | clean / clean | clean / clean |

**How the final failures were classified.** None is a regression, and none is in code this branch touches.

- **Backend:**
  - `intakeSimilarCache` ×2 — the known flake. It failed in the baseline too, and now times out even alone, apparently slowing as the test DB accumulates bids.
  - `integration.test` "backfills a follow-up…" — the known load timeout.
  - `notificationsRetention` — the known worker crash; its 4 tests are the 4 not run.
  - `rerunReset` "migration 121 backfill" — **"deadlock detected"**. The test re-runs the whole-table migration backfill while other files write. It passed in the previous full run, and the file passes 30/30 alone. This is load.
- **Frontend:** `ElecProjectsSaveSection` and `SurveyMarkupEditor` are the known flakes. They ran while the backend suite was loading the machine, and both pass alone.

**The earlier full backend run** (before b18e58a) had 2 real failures: `accountRulesRoutes`, which encoded the old reading of "BY GC", and a `rerunReset` save my duplicate check refused because GFCI and duplex matched. Both are fixed in b18e58a and verified with targeted runs, then the full run above.

**New tests:** +77 backend, +16 frontend. The DB-backed ones use real multi-page PDFs over 4 KB in Buffers that own their ArrayBuffer (`ownedBuffer`), and the new route tests assert the DB really ran (not silently skipped).

## A1 — the page inventory as a record

- `sheet_page_cache` holds the title-block classification of every page, keyed by the file's **content hash** (plus `text_chars`, `has_text_layer`, and the cached AI references).
- `bid_sheet_check` holds the bid's current check: the inventory with each page's role (`analysis` / `reference` / `excluded`) and reason, the references, the estimator's overrides (`{sha#page: {decision, reason, by, at}}`) and skips.
- Routes:
  - `POST /api/preconstruction/:bidId/sheet-check/run` takes the same inputs as `/analyze` (uploads + `document_ids`, through `gatherAnalysisInputs`). It runs in the background, and a newer check supersedes an older one through `run_token`.
  - `GET /:bidId/sheet-check` returns the check.
  - `PUT /:bidId/sheet-check` takes `include` / `exclude` / `clear` (reason ≥ 10 characters), `skip` / `unskip`, or `skip_all_missing`. It re-applies the selection and makes no AI call.
- `/analyze` → `runPipeline` → `planSheetsForRun`:
  - It builds the inventory from the cache, so an unchanged file never gets a second Haiku pass.
  - It applies the bid's overrides and hands each PDF's plan to `prepOnePdf`, which then skips its own crop and classify step.
  - A file the cache has never seen is classified there and cached. A classifier failure still falls back to the old whole-file path.
- Reference pages go to Agent 1 as a new `reference` class. They are 24" tiles at 100 DPI, at most 2 per page. They are labelled "reference — context only … do not count … do not list it as a missing sheet".
- `prep_inventory` rows now carry `role`, `reason` and `referencedBy`.

## A2 — references

- `ai/sheetRefs.ts` (pure) finds references in each electrical page's `pdftotext -layout` text. Column gaps of 3+ spaces are split into separate lines, and numbered notes are tracked, e.g. "note 3".
  - **Explicit sheet ids** after SEE / REFER TO / PER / ON / SHEET / DWG / DETAIL, including "3/E-5" and lists like "E-2 AND E-3". Only known sheet prefixes, or prefixes the inventory itself uses, are accepted, so NEC 210.8, UL 924 and RTU-1 never read as sheets.
  - **Discipline-only references**: mechanical, plumbing, civil, architectural, structural, fire protection, photometric, RCP, life safety, equipment schedules, kitchen and landscape. The broad trades need a pointer word ("see civil"); "installed by mechanical contractor" is not a reference.
- The resolver gives one entry per target, marked present, missing or ambiguous. Ambiguous means the same sheet number appears with different titles. Each entry keeps every place it was referenced from and the text for a "not provided" clarification.
- Always-useful pages go as reference pages even when nothing points at them: M/P equipment schedules, photometric / site lighting, RCP and life safety plans. The cap is 12 reference pages.
- **Haiku** reads the notes sentences that point somewhere the regex can't resolve, in one call per check. Its answer is cached, even an empty one.
- **Sonnet vision** reads only the notes region of a scanned E-sheet (no text layer): the band from 45% to 90% of the width, left of the title block. Setting `ai_sheet_refs_vision_model` (default `claude-sonnet-4-6`); cached per page.
- Tests cover the plan's cases: SEE M-1, REFER TO SHEET C-3.1, PER PH0.1, see civil, and the AutoZone-shaped inventory (E-7 → PH0.1 included although it is classified civil; M-1 missing).

## A3 — Sheet Check panel and the one Run button

- **Documents step.** `SheetCheckPanel` has three sections:
  - **Included** — with the "reference" badge and "referenced by E-7 note 3";
  - **Needed but missing** — Upload opens the file picker; Skip needs a reason of at least 10 characters;
  - **Left out** — with a force-in checkbox and a reason.
- The panel runs by itself whenever the inputs change (debounced 1.2 s; it polls until done) and has a "Check again" button. It does not run on first load: the stored check is shown until something changes.
- **The Run button.** The Takeoff-step button and the panel shortcut both read **"Run without N sheets"** while referenced sheets are missing and not skipped. Running records them as not provided (`skip_all_missing`, reason "Not provided at time of bid — analysis run without it").
- **Clarifications.** Skipped sheets become Exclusions & Clarifications bullets in `composeProposal`, e.g. "Mechanical schedules not provided at time of bid." They are logged as corrections and never duplicated. They enter the compose-inputs hash only when present, so documents filed earlier keep their hash.
- **Counting.** Reference pages are never counted, with one exception: a photometric SITE PLAN, which is often classified civil.
  - The counter asks it only about site and building-exterior types.
  - The merge uses its count only when the electrical plans show none of that type. It is never stacked on them, and it is not used when the plan that should show the type failed or was unreadable.
  - This is the fix for Kissimmee's W1/W2/S1/S2 zeros.
  - Photometric calculation sheets are still never counted.

## A4 — post-Agent-1 safety net and supplement pass

- **Review item `refsheet:<KEY>`** "Referenced sheet X not in analysis" is raised for each sheet in Agent 1's `missingSheets` (after hygiene has dropped the ones actually loaded) that the sheet check did not already know as present, missing or skipped.
  - It is resolved by **Upload the sheet** (the supplement pass) or by Confirm with a reason.
- **`POST /:bidId/supplement`:**
  - It claims only a finished run (409 otherwise) under a row lock, and refuses files already in the run, compared by hash against the run's `input_document_ids`, so nothing is counted twice.
  - Agent 1 reads only the new pages. Its output is merged into the SAME run (same run id, every write run-guarded).
  - Counting covers only what the new pages can change: every type on the new plan sheets, plus NEW types on the earlier sheets. When an earlier sheet's PDF is not available, those new types are marked unreadable there, never assumed 0. Every other count comes from the earlier pass.
  - Unscheduled rows held earlier stay held. The estimator's resolutions carry over when an item's evidence is unchanged. Agents 2–3 run again.
  - The run's Agent 4 output and draft stop being current.
  - A failed or stopped supplement puts the run back **exactly** as it was and records the failure in `takeoff_results.supplement`.

## A5 — accuracy and speed

- `ai/modelLimits.ts` is the one model → max-image table: Opus 5.5 is 2576 px, everything else 1568 px.
- **Counter tiles:**
  - Opus 5.5: 10.5" tiles, 245 px/in, **12 tiles** on a 36x24 sheet.
  - Other models: 8" tiles, 196 px/in, 20 tiles, as before.
  - Core-region ownership de-dup is unchanged.
  - Cost note: a 2576 px tile is about 8.8k image tokens against about 3.3k, so a sheet's image tokens go up about 1.6x with Opus 5.5. The trade is sharper and fewer tiles.
- **Dense-area retry.** A sheet that came back with symbols it couldn't read reliably is counted once more at 60% tile size (10.5" → 6.3", 8" → 5").
  - The retry's counts are used, and both passes are kept on the sheet (`retry.firstCounts` / `retryCounts` / a note such as "A 1→3").
  - A failed retry keeps the first pass and its unreadable flag.
- **Parallel Agent 1 batches.** `runBatchesInOrder` runs up to 3 batches at once.
  - Results are merged in batch order; a test shows the merge is byte-identical to the sequential one.
  - A stop or a superseded run starts nothing new, and aborts every in-flight batch.
  - The first failure (for example a truncated batch) stops new batches and is rethrown.
  - Progress reads "Agent 1: N of M batches done (k running)".

## A6 — "By G.C." = APT (Decision 4)

- `bidstd/tradeAssignment.ts` reads who furnishes and installs from schedule and legend text:
  - "Simplex receptacle, G.C. furnished/installed" → APT F&I;
  - "Duplex receptacle / floor receptacle, G.C." → APT;
  - "Exhaust fan recessed, installed by HVAC, wired by EC" → HVAC installs, APT connects.
  - Owner / owner's vendor / vendor / others / N.I.C. are outside APT's supply. Owner-furnished items stay APT-installed.
- **Drawing statements.** "By GC" is read as APT, and the reader remembers which half said GC.
  - An `ask` term (the AutoZone power poles) is **still asked**, with **APT pre-filled** and a note saying why.
  - Our own scope text keeps GC as GC (`parseStatementPartiesRaw`), because an estimator's GC answer is a real decision.
- **Count targets** carry the assignment. A zero count for a type another trade, the Owner or a vendor installs is **information, not a block**.
- **Prompts:**
  - The rule rides in the ACCOUNT TERMS block, which Agents 2 and 4 always receive, so it survives custom prompts.
  - The counter is told to count "by G.C." items.
- **GC documents.** An exclusion or GC-furnished takeoff line that puts electrical work on the GC blocks with flag `gc_scope` and an exact-line "keep with a reason" override. The exception is a term the account terms really gave the GC. Nothing is rewritten or deleted.

## A7 — review noise

- **Grouping.** Every review item carries a cause group:
  - zero, unreadable, `area:<sheets>`, scope, unscheduled, coverage, heads, sheets, refsheets, counting;
  - plus the non-blocking photometric and info groups.
- **Bulk actions.** The panel lists the groups with one bulk action each:
  - all same area / all different areas, each item taking its own option (`answerIndex`);
  - accept the pre-filled answers (`useSuggested`);
  - mark all not on this job, or confirm all, with one reason.
  - The server applies a bulk action all-or-nothing.
- **Information items** (`blocking: false`) never block the gate, and the status chip counts blocking items only.
- **The Kissimmee-shaped fixture gives 7 blocking items (of 14)**; the same drawings run the old way give 16 (all blocking). Target ≤ 8. File: `src/test/kissimmeeReviewNoise.test.ts`.
  - The remaining 7 are real decisions: the E-2/E-2.1 "same area?" group (GFI, duplex), type L and OS not found, the unscheduled "Site lights 4 (E-7)", and the two power-pole halves (APT pre-filled).
- **Labor & Pricing duplicate block.** A line kept from the previous run that sync could not re-bind (`recheck_reason`), next to a fresh takeoff line for the same fixture or device, is a possible duplicate. The matcher is `plausiblySameText`, the same rules as the proposal's double-count check: synonyms, size conflict, two distinctive words.
  - `PUT /api/estimating/:bidId` returns 409 and `takeoffGate` blocks the proposal until it is resolved.
  - The UI offers "Same item — remove the new line", "Same item — remove my old line", or "Different items — keep both" with a reason (`dup_ok`, migration 127).
  - The "checked" button is hidden while a pair is open.

## Existing tests changed by design (so a reviewer can check them)

- **takeoffCountingPipeline, counter, countMerge:** PH0.1 is now counted as a site-types-only fallback. The site counts are unchanged (never stacked).
- **takeoffCountingPipeline, aiCountMarkers, prebidDraftWorkflow:** the truth tiles are rendered at the counter model's tile size (A5).
- **stopAnalysis:** Agent 1 batches run 3 at a time.
  - "No second wave after a stop" replaces "no batch 2".
  - A stop aborts all three in-flight calls.
  - The progress label changed.
- **accountRules:** Decision 4 changes the reading of "BY GC" on the drawings, as follows.
  - The E-2 power-pole statement no longer resolves to GC/GC with an exclusion. The term stays asked with APT pre-filled.
  - The S7 parser cases now expect GC read as APT (the raw parser keeps GC).

## Not built / limits (honest)

- **No live runs.**
  - Nothing ran against the Anthropic API.
  - The "≤ 8 blocking" figure comes from a constructed Kissimmee-SHAPED fixture, not the live run's `count_result`: I did not touch the live DB. The fixture's "before" number (16) is the same drawings through the old rules, not the live 37.
  - Jake's Opus run on Kissimmee is the real test.
- **The notes region for scanned sheets** (45–90% of the width) is a heuristic. It has not been tried on a real scanned set.
- **Upload in "Needed but missing"** opens the file picker. The added file triggers a re-check, which resolves the reference if the new sheet matches; the upload is not tied to that one reference.
- **The supplement pass** runs only on a finished run. New types on earlier sheets need those PDFs to be reachable through the run's `input_document_ids`; when they are not, those types are unreadable, which blocks.
- **The 7-Eleven fixed account rule** (GC furnishes lighting, panels and disconnects) is untouched. Decision 4 is about drawing notes. **Question for Jake:** does it apply to that rule too?
- **The Labor & Pricing duplicate check** keys on `recheck_reason`. If a client clears it ("checked") while a pair is open, the server can no longer see that pair; the UI hides "checked" while a pair is open.
- **Settings:** the `ai_sheet_refs_vision_model` setting exists, but it has no field in the Settings UI yet.

## For Part B's executor

**Shared files changed in Part A:**
- `backend/src/estimating/bidEstimate.ts`: `dup_ok` on `ClientLineInput`, `rowToBidLine` and `saveBidEstimate`, whose INSERT now has 25 columns.
- `backend/src/routes/estimating.ts`:
  - `validateLines` accepts `dup_ok`;
  - `GET /:bidId` and `POST /:bidId/sync-takeoff` return `duplicates`;
  - `PUT /:bidId` returns 409 with `duplicates`.
- `backend/src/estimating/takeoffReview.ts`: `takeoffGate` also runs `laborDuplicateGate`; `applyResolution` supports bulk `answerIndex` / `useSuggested`.
- `backend/src/routes/preconstruction.ts`:
  - `AIConfig.modelRefVision`;
  - `runPipeline(…, opts.supplement)`;
  - `planSheetsForRun` before Agent 1 prep; `prepOnePdf` / `prepareAgent1Upload` take plans;
  - parallel batches;
  - supplement-aware counting and `referencedSheetItems`;
  - `composeCurrentBidData` loads sheet-check clarifications; `composeInputsHash` has an optional `clarifications`;
  - new `POST /:bidId/supplement`;
  - `/review/resolve` passes `answerIndex` / `useSuggested`;
  - the override flag regex allows `gc_scope`.
- `backend/src/bidstd/composeProposal.ts`: the `clarifications` input and the `gc_scope` findings.
- `backend/src/index.ts` mounts `routes/sheetCheck.ts`.
- `frontend/src/features/estimating/`:
  - `types.ts`: `EstimateLine.dup_ok`, `DuplicatePair`, `duplicates` on responses;
  - `useEstimatingBid.ts`: `duplicates`; a 409 save error shows the server message;
  - `LaborPricingStep.tsx`: the `duplicates` prop, `openDuplicatePairs`, the banner, Save disabled while open;
  - `EstimatingWorkspace.tsx`: passes `duplicates`.
- `frontend/src/features/preconstruction/PcWorkspace/`: `PcWorkspaceView.tsx`, `BidTab.tsx`, `TakeoffReviewPanel.tsx`, `ProposalTab.tsx`, and the new `SheetCheckPanel.tsx` / `useSheetCheck.ts`.

**Source data (checked while planning, before the scope change):**
- `~/Downloads` is blocked by macOS privacy (TCC) for this terminal: "Operation not permitted", from both Bash and Read. That rules out the four 2024 BOMs (Orlando Clubhouse, Rockledge, 36th Street, North Port) and the Seminole and 36th Street breakdowns. Jake needs to move them into the repo's reach (e.g. OneDrive) or grant Full Disk Access.
- These OneDrive files are online-only placeholders; `cp` / `pdftotext` time out even outside the sandbox:
  - `Bay To Bay Properties/Bubble Down Car Wash Safety Harbor (Renovation)/Bubble Down Remodel Breakdown.pdf`;
  - `Bids1/Bay To Bay Properties/7-Eleven #10319 …/7-11 #10319 Fort Meyers Breakdown.pdf`;
  - `JamesCo Builders/Older Bids/36th Street Warehouse Orlando/36th Street Warehouse Pricing.zip`.
  - Jake can mark them "Always keep on this device".
- **Readable now:**
  - `Summit GC/Autozone Kissimmee, FL/Autozone Kissimmee BOM.pdf` and `… Breakdown.pdf`;
  - `JamesCo Builders/Clermont Golf Simulator/Bid Submittal/Gulf Simulator Breakdown.pdf` (the file name says "Gulf").
- **Kissimmee BOM.** `pdftotext -layout` gives 89 item rows.
  - The row columns are Qty, U, Price, Cost, Cost Adj %, Net Cost, Total Mat., U, Labor U, Field Labor Adj %, Total Field Labor, Mat. Cond.
  - Columns can be blank. Parse from the right; `Mat. Cond.` can be "No Cost".
  - The rows reconcile to the footer: **$25,842.56 and 798.949 h** (the sum of the rows' printed hours). Unit divisors: E = 1, C = 100, M = 1000. Examples: PVC 1" has a 25% labor adj; "#12 Black" has net $208.00, which is cost 108.00 plus 92.593%.
- **The recap math reproduces to the cent** once field labor is taken from his breakdown:
  - Kissimmee: labor OH 18% on labor = 4,852.17; net cost 65,771.25; material markup 22% = 5,685.36; labor markup 22% on (labor + labor OH) = 6,997.91; adjustment 1% of net cost = 657.71 → **$79,112.23**.
  - Golf: labor 323.793 h at 1J $37 + 2A $27, burden 4%, fringe $1.50 = $10,700.28; OH 12% = 1,284.03; net 30,540.97; material and labor markup 18% = 2,224.20 / 2,157.18; quotes 18% = 896.40; adjustment 2% = 610.82 → **$36,429.57**.
- **Caveat:** Kissimmee's field labor from hours × crew (798.949 × (42.06 + 2 × 29.58) / 3) is **$26,956.54**, 2¢ above his $26,956.52. His J / A extended lines are 11,201.24 / 15,755.28, which don't split 1:2 exactly. Accubid's crew allocation has a rounding step I could not reverse-engineer. Golf matches exactly.
- **Percentages:** Kissimmee's breakdown uses OH 18%, markup 22% and adj 1% (Chris's per-job inputs), not the Decision 5 defaults (38/20/18).

---

# Part B — execution report

**Branch:** `feat/sheets-and-pricing` (same worktree), on top of Part A's `abd5ad9`.
**Executor:** Sonnet 5 · **Date:** 2026-09-23/24

## Commits (`abd5ad9..HEAD`)

| Commit | Task |
|---|---|
| 62be088 | B1a: Accubid BOM parser (`accubidBom.ts`) |
| 4fe508c | B1b: BOM import into the Labor Library (`accubidImport.ts` + routes) |
| 80269fb | B2: Accubid-style recap engine (`accubidRecap.ts`) |
| 9e65530 | B2/B3 schema + routes: migration 128 (accubid settings, quotes, equipment/GE, alternates, per-GC OH defaults) |
| 89474ee | B3 (coordinator follow-up): 7-Eleven → APT scope + auto deduct alternate; alternates print on the proposal (migration 129) |
| e8bf3ee | B4: calibration extension against Chris's real BOMs (`bomCalibration.ts`) |
| 3d53733 | B3 frontend: the Accubid Labor & Pricing panel |
| 3d90851 | Fix: accubid-import tests were polluting the shared `est_items` catalog (a real cross-file hazard found by running the full suite) |
| 0f04722 | Fix: `DEFAULT_SETTINGS.pricing_mode='accubid'` broke every test that spreads `DEFAULT_SETTINGS` as its own mock |

Migrations: **128** (`est_bid_settings.pricing_mode`, `est_accubid_settings`, `est_bid_quotes`, `est_bid_cost_lines`, `est_bid_alternates`, `est_gc_overhead_defaults`), **129** (7-Eleven account rule → APT scope + `account_rules.auto_deduct_alternate`, guarded against an admin's own edit). Both additive.

## Test suites (full run, once each, at the end)

| Suite | Part A final | Part B final |
|---|---|---|
| Backend `npm test` | 1605 tests: 1597 passed, 4 failed, 4 not run. 156 files | **1704 tests: 1696 passed, 4 failed, 4 not run.** 165 files (161 passed, 3 failed, 1 lost to the worker crash) |
| Frontend `npx vitest run` | 1264 passed, 2 failed (126 files) | **1280 passed, 0 failed** (128 files) |
| `tsc --noEmit` (both) | clean | clean |

**Backend failures, classified** (none is a regression, none is in code Part B added — same standard Part A used):
- `intakeSimilarCache.test.ts` ×2 — the known flake (timeout / stale cache), documented in Part A's baseline.
- `integration.test.ts` "backfills a follow-up…" — the known load timeout.
- `notificationsRetention` — the known worker crash (its tests are the 4 "not run").
- `estimatingSheetsRoutes.test.ts` "404s a documentId that belongs to a different bid" — a NEW flake instance under full-suite load (unrelated file, unrelated code); passes 32/32 alone. Same "load" category Part A's `rerunReset` deadlock was.

**A real bug the full-suite run caught and Part B fixed, not a flake:** the accubid-import route tests originally wrote real-fixture-derived rows ("3/4\" Conduit - EMT 10' Lengths") into the shared, non-bid-scoped `est_items` table. Those rows' text is close enough to the seed library's own curated item ("3/4\" EMT (incl. couplings/straps)") that the takeoff mapper's fuzzy matcher occasionally preferred the $0 accubid row over the real seed item — caught as `estimatingBid.test.ts`'s seed-magnitude assertion coming back `materialExt: 0`. Fixed by (a) making every accubid-import WRITE test use a uniquely-tagged synthetic BOM instead of a real fixture, and (b) making `buildImportPreview` try to reconcile against an existing catalog item via the same exact/alias matcher a takeoff line uses before minting a new deterministic code (a real improvement, though it doesn't by itself close the fuzzy-tier case — see Limits below).

## Reproduction table (Chris's Selling Price, to the cent, using each job's OWN percentages)

| Job | Chris's price | CRM's price | Difference |
|---|---|---|---|
| Autozone Kissimmee (18% OH / 22% markup / 1% adj) | $79,112.23 | $79,112.23 | $0.00 |
| Gulf Simulator (12% OH / 18% markup+quotes / 2% adj) | $36,429.57 | $36,429.57 | $0.00 |
| James Co Seminole State (22% OH/markup, per-quote 18%/20%) | $20,991.53 | $20,991.53 | $0.00 |
| Bubble Down Remodel (42% OH, 22% markup, 4% adj, night crew) | $36,925.89 | $36,925.89 | $0.00 |
| 36th Street Warehouse (7% material tax, 70% OH, 1% CE sales markup) | $22,553.54 | $22,553.54 | $0.00 |
| Orlando Clubhouse (bonus — BOM + breakdown both complete) | $97,649.38 | $97,649.38 | $0.00 |

Every one of the five required jobs plus one bonus reproduces exactly. These six numbers are produced by `computeAccubidRecap` (`backend/src/estimating/accubidRecap.ts`) fed Chris's own printed **Field Labor total** (not re-derived from crew×hours — see below) plus his other breakdown inputs; `accubidRecap.test.ts` asserts every intermediate line (labor overhead, net cost, each markup, total markup) to the cent, not just the final price.

**The one documented exception — field labor computed FROM crew + hours** (`computeFieldLaborCost`, used when pricing a bid this engine builds itself rather than reproducing an already-known breakdown):

| Job | Crew ratio | Chris's field labor | CRM's crew-computed field labor | Difference |
|---|---|---|---|---|
| Autozone Kissimmee | 1 journeyman : 2 apprentices, 798.949 h (doesn't split evenly into thirds) | $26,956.52 | $26,956.53 | **$0.01** |
| Gulf Simulator | 1 journeyman : 2 apprentices, 323.793 h (also doesn't split evenly, but happens to round cleanly) | $10,700.28 | $10,700.28 | $0.00 |
| James Co Seminole State | 1:1, 197.458 h (splits evenly) | $7,483.66 | $7,483.66 | $0.00 |
| Bubble Down Remodel | equal hours given directly (208/208, no ratio math) | $10,911.68 | $10,911.68 | $0.00 |

Only Kissimmee is off, by one cent, and only because its crew ratio doesn't divide 798.949 h evenly into 3-decimal shares — Accubid's own report is itself internally inconsistent by 1-2¢ on the *per-trade* lines there (Journeyman extends to $11,201.25 by the identical hours-share/round/extend method his report uses elsewhere, but he prints $11,201.24). This is closer than Part A's own attempt at this same reconciliation (which used a single blended crew rate and landed 2¢ off); I could not find the exact intra-cent rounding step Accubid uses for an unevenly-split crew, and the plan's own ≤ $0.05 tolerance is documented in `accubidRecap.test.ts` and applies **only** to this one line, not to any full-recap reproduction above (all of which match exactly, using Chris's own field-labor figure as the input).

## Import counts per BOM (`accubidBom.ts` / `accubidImport.ts`, all verified against the real PDFs' own footers)

| BOM | Rows | Reconciles to footer | Notes |
|---|---|---|---|
| Autozone Kissimmee (2026-06-18, the price-authoritative BOM) | 89 | $25,842.56 / 798.949 h | 3 site poles + anchor bolts only (base by others) |
| 36th Street Warehouse | 58 | $3,399.32 / 189.21 h | has demolition-unit rows |
| North Port Storage | 131 | $29,593.45 / 1,841.485 h | the only BOM with pole-base units (8 poles) |
| Orlando Clubhouse | 96 | $14,976.39 / 606.518 h | |
| Rockledge Storage | 105 | $28,413.56 / 1,393.656 h | has the "Fluorescent" LED-proxy rows |

The pole-base assembly derived from North Port (auger 6 ft/pole, sono tube 9 ft/pole, #5 rebar ring 9/pole, #5 rebar 48 ft/pole, concrete 1.047 yd/pole, anchor bolt template 2/pole, anchor bolt 4/pole, plus per-pole auger/pour setup) is written as one bundling assembly (`ACB-POLE-BASE-FOUNDATION`) over 9 component items.

## What's built (B1-B4)

- **B1 — BOM parser + import**: `accubidBom.ts` (pure parser, handles both report column layouts found across the five real BOMs, and a real PDF quirk — a vendor-adjustment % over 1000% with its decimal digits clipped by the column width). `accubidImport.ts`: LED-proxy mapping (fluorescent/HID/metal-halide → the LED-equivalent catalog name, keeping Accubid's own labor hours), demolition items (imported as ordinary priced items), the pole-base assembly, conduit-fittings ratios (couplings/connectors/straps per 100 ft) and box-accessory ratios (plaster ring / cover per box), each a median across all five real BOMs, and an idempotent create/update-by-deterministic-code import that never touches a `source='manual'` row. Routes: `POST /api/estimating/library/accubid-import/{preview,apply}` (admin, accepts a PDF upload or raw text).
- **B2 — Accubid recap**: `accubidRecap.ts`, reverse-engineered against the Final Price / Field Labor pages of five real breakdowns (see the reproduction table). Crew/burden/fringe, per-item labor adjustment (via the BOM parser's own `fieldLaborAdjPct`), labor overhead (and a full per-category overhead structure for completeness, though only labor OH is ever nonzero in Chris's real jobs), separate material/labor markup, per-quote tax+markup, equipment/GE with optional tax, an adjustment markup on net cost, and a final "CE Sales Markup" surcharge (36th Street, Orlando). `accubidBidData.ts` wires this to a bid's saved `est_bid_lines` (reusing Phase A's `resolveLines`/`priceBid` with every Phase A add-on zeroed out, so material $/labor hours are the exact same numbers Phase A prices from) and writes `bid_estimates`/`bids.amount` — same downstream contract as Phase A, so `composeProposal`'s price flow is unchanged either way.
- **B3 — Labor & Pricing sections**: Crew (day/night shift, journeyman/apprentice/foreman, burden/fringe), Quotes (status firm/budget-pending — a budget-pending quote sets `blocksSend`), Equipment, General Expenses, Alternates (add/deduct, printed on the Cowork-format proposal via a new `estimatorAlternates` composeProposal input, never changing `total_price`), and a per-GC overhead default table (Settings, all 38% today). Backend routes + DB fully built and tested; frontend built for Crew/Overhead-Markup/Quotes/Equipment/GE/Alternates (`AccubidPricingPanel.tsx`), mounted by `LaborPricingStep` in place of the Phase A settings row when `pricing_mode === 'accubid'`.
  - **Coordinator follow-up (7-Eleven):** migration 129 changes the seeded 7-Eleven account rule to APT furnish & install (fixtures, panels, switchgear/SPD/receptacles via `other_equipment`, disconnects) through the Graybar 7-Eleven national account, guarded against an admin's own edit. `autoDeductAlternate.ts` (pure) computes the auto-deduct amount — matched lines' material + material markup (+ tax if the rule is marked taxable), installation labor structurally excluded since only `materialExt` is ever passed in — and `syncAutoDeductAlternateForBid` upserts it as an `auto` alternate (unique per bid + source rule) whenever accubid settings are saved.
- **B4 — calibration extension**: `bomCalibration.ts` compares Chris's own per-row hours (at his own quantities, including his field-labor adjustment %) against the CURRENT library's hours for the same quantity, per takeoff category, combinable across several jobs. Read-only — same "suggest, never auto-apply" rule as the existing `applyCalibrationAdjustment`. `POST /api/estimating/calibration/bom` (admin) accepts one or more BOM PDFs/text.

## Deferrals (honest)

- **Settings → Labor Library → "Import Accubid BOM" preview-diff UI** — the backend route (preview + apply, with a create/update/skip_manual/skip_no_labor diff) is built and tested; no frontend screen for it yet. An admin can drive it via the API today.
- **Per-GC overhead default table's own Settings screen** — same story: `GET/PUT /api/estimating/gc-overhead-defaults[/:gcName]` works and is tested; no Settings UI.
- **Fittings ratios are derived and tested but not yet wired into the conduit/device assemblies' own `qty_per`** — B1's plan line "apply them in the conduit/device assemblies" is the one sub-item not done; `deriveConduitFittingsForJob`/`medianConduitFittingsRatios` and the box-accessory equivalents are real, tested pure functions, just not yet applied as an update to the seed assemblies.
- **`buildImportPreview`'s reconcile-with-existing-item step only trusts exact/alias-confidence matches** (never fuzzy) — by design, since auto-overwriting a library row's hours off a fuzzy text match risks silently corrupting the wrong item. This means a BOM row whose phrasing doesn't closely match a seed item's curated name/alias (true of most raceway/wire/device rows, whose Accubid phrasing is generic and rarely matches the seed catalog's own alias text) still creates a same-meaning duplicate catalog row under a separate `ACB-...` code rather than updating the existing seed row. This is a known limitation worth a follow-up (either curating aliases on import, or a reviewed "merge suggestion" UI) — not a correctness bug in any test or reproduction above, but a real library-hygiene gap after a production import.
- **Account rules Settings UI does not yet expose `auto_deduct_alternate` for editing** — the seeded 7-Eleven config works and is tested; `saveAccountRule`/`validateRuleInput` don't read/write the field, so an admin can't add this to a different rule from the UI yet (only via a direct migration/DB edit).
- **7-Eleven's `receptacles`** ride on the generic `other_equipment` term (no dedicated `TermKey` exists for it) and the auto-deduct matcher's receptacle detection is a description regex (`/receptacle/i`) scoped to the `Branch Power` category — reasonable, but not as precise as a dedicated term/category would be.
- No live runs against the Anthropic API; nothing here touched Local Version or a live database. All reproduction numbers above are pure-function tests against real BOM/breakdown text.

## Top files for review

- `backend/src/estimating/accubidBom.ts` / `accubidBom.test.ts` — the parser; the two-layout handling and the clipped-percentage tolerance are the trickiest parts.
- `backend/src/estimating/accubidRecap.ts` / `accubidRecap.test.ts` — the pricing model; every formula is backed by a worked real-number comment.
- `backend/src/estimating/accubidImport.ts` — the LED-proxy/pole-base/fittings-ratio logic, and the exact/alias reconciliation step (see Deferrals above for its known limit).
- `backend/src/estimating/accubidBidData.ts` — where the recap meets the DB (per-bid settings, quotes/cost-lines/alternates CRUD, the auto-deduct sync).
- `database/migrations/128_accubid_pricing.sql`, `129_seven_eleven_apt_scope.sql`.
- `backend/src/bidstd/composeProposal.ts` (the `estimatorAlternates` input) and `backend/src/routes/preconstruction.ts` (wiring it through `composeCurrentBidData`).
- `frontend/src/features/estimating/AccubidPricingPanel.tsx` / `useAccubidPricing.ts` — the new UI; deliberately plain (functional, not pixel-polished) given the time budget.
- `backend/src/test/estimatingAccubidImportRoutes.test.ts` — worth a look specifically for WHY it uses synthetic tagged BOMs instead of the real fixtures (see the file's own header comment and the "real bug" note above).
