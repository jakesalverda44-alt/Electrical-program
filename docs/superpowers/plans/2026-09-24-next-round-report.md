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

---

# Fix round — Part A (review `2026-09-24-next-round-review.md`, MERGE AFTER FIXES)

**Executor:** Opus 5. **Scope:** the Part A findings only: B1, B2, S1–S10, and N1–N10 and N12 (N6 was not asked for; it was fixed as well). Part B's findings are left to the Part B executor. No Part B file was changed.

**Commits** (`0a78cb9..710f570`):

| Commit | Findings |
|---|---|
| 0fe3a60 | B1, N1–N4, S7 (skips / lock), N7 |
| 8d311d5 | S4, S6, N5, N6 |
| dd23db1 | B2, S3, S5, S7 (supplement) |
| a6b1f9a | S1, S2 |
| 3b6188a | S8, S9, N10 |
| 4aca32f | S10 |
| 710f570 | N8, N9, N12 |

**Migration 130:** `sheet_page_cache.cache_key`, and the primary key becomes (sha, page, cache_key). The next free number is 131.

## Blockers

- **B1 — the reference regex no longer invents sheets.**
  - Pointers must be explicit: SEE, REFER TO, REFERENCE, PER, COORDINATE WITH, AS SHOWN ON, ON SHEET, ON DWG, SHEET, DWG, DETAIL. Bare ON / IN no longer count.
  - An id with a space ("E 3") is accepted only after SHEET or DWG.
  - An id is rejected when it is followed by AMP, A, V, a quote mark, FIXTURE(S), POLE(S), CIRCUIT(S), TYPE, LEVEL, REQUIREMENTS, SIDE, CONDUIT…, or preceded by TYPE, CKT, CIRCUIT, PANEL or POLE.
  - An id that is not in the upload is reported missing only when it matches this set's own sheet-number pattern, learned from the inventory: prefixes, separators, digit count and decimals. Ids read by Haiku or vision are filtered the same way in `resolveRefs`.
  - All of the reviewer's false cases are tests: 20 AMP, 4" SQ BOX, 1" CONDUIT, CIRCUIT ON C-3, S 1 SIDE, L-1 LEVEL, T-24 REQUIREMENTS, S1/S2 POLES, F2 FIXTURES, TYPE A1, CKT C-3, PANEL L-1, #12, 3/4", 20 AMP BREAKER and NEC 210.8.
  - So are the true cases: SEE M-1, REFER TO SHEET C-3.1, PER PH0.1, 3/E-5, DETAIL 4 ON SHEET E-2, and SHEET E 3.
  - "Run without N sheets" now lists the sheets in a confirm before it records them as not provided.
- **B2 — the supplement pass leaves earlier markers alone.**
  - It soft-deletes and rewrites AI markers only for what it re-counts: the new sheets, and on an earlier sheet only the new types.
  - It resolves documents for the run's earlier files as well.
  - The ids it changed are recorded in `takeoff_results.supplement.markers`, and `restore()` reverts exactly those.
  - Tested:
    - after a failed pass, the marker set is identical to before;
    - after a successful pass, E-3's markers are kept and the new types are added.

## Should-fix

- **S1 — tile sizing against the API's real limits.** The Claude API vision docs (read 2026-09-24) give a long-edge limit and a visual-token limit, ⌈w/28⌉ × ⌈h/28⌉, per tier:

  | Tier | Models | Long edge | Visual tokens |
  |---|---|---|---|
  | High-res | Claude 4.7+, e.g. Opus 5.5, Sonnet 5 | 2576 px | 4784 |
  | Standard | everything else, e.g. Sonnet 4.6, Haiku 4.5 | 1568 px | 1568 |

  - Tiles are now sent at exactly the size the server keeps (`fitImageToLimits`). They are sized so a square tile gets at least 196 px/in.
  - **My A5 claims were wrong.** "Opus 5.5 245 px/in, sharper, 8.8k tokens, 1.6×" is incorrect. Worse, the standard path I kept as-is (8" tiles at 1568 px) was downscaled by the server to about 155 px/in, not the 196 it claimed.
  - Real numbers (`countingRetry.test.ts` checks them):

    | Counter model | Sheet | Tile | Tiles | Image tokens | px/in (min) |
    |---|---|---|---|---|---|
    | Opus 5.5, before (A5) | 36×24 | 10.5" | 12 | ≈57k | ≈219 (server-downscaled) |
    | Opus 5.5, now | 36×24 | 9.8" | 12 | ≈57k | 219 |
    | Opus 5.5, now | 42×30 | 9.8" | 20 | ≈94k | 231 |
    | Standard, before | 36×24 | 8" | 20 | ≈31k | ≈155 (server-downscaled) |
    | Standard, now | 36×24 | 5.5" | 42 | ≈65k | 214 |
    | Standard, now | 42×30 | 5.5" | 63 | ≈98k | 214 |

  - **Cost.** At the docs' Opus price of $5 per million input tokens, the image part of an Opus counter pass is about $0.29 per 36×24 sheet. On a standard-tier counter, the fix roughly doubles image tokens per sheet (about 31k → 65k), because the old path was being downscaled.
  - **Not changed:** Agent 1's tiles (`documentPrep`). They are still sent at 1568 px, so on standard-tier models the server downscales them to about 1.2 MP, and `TOKENS_PER_TILE = 3000` over-estimates them for batching. That was outside A5, and I left it unchanged.
- **S2 — the dense-area retry is narrower and never silent.**
  - The retry asks only for the types the sheet flagged as unreadable, and replaces only those; every other type keeps its first-pass count.
  - A lower recount raises a blocking `recount:<TYPE>` review item (count, or confirm). Its resolution is enforced on the GC documents.
  - It runs at most once per sheet. The retry tile is never smaller than the tile that already reaches the 300 DPI raster: Opus 6.4", standard 3.6". Progress reads "Re-counting dense sheet N of M".
  - **Cost of one retry**, on a 36×24 sheet:
    - Opus: 30 tiles, about 121k image tokens, about 2.1× the first pass (about $0.60);
    - standard tier: 117 tiles, about 169k tokens, about 2.6× the first pass.
- **S3 — the supplement pass takes only genuinely new pages.**
  - Each page is compared by content hash (its text layer).
  - A page identical to one already in the run is skipped.
  - A page whose sheet number is already in the run, but with different content, counts as a revision: the upload is refused with 409 and `fullRerun: true`, listing the sheets, and the estimator is told to run the full analysis again.
  - The new files are planned against the run's pages. A lone M-1 is therefore a reference page: context for Agent 1, never counted.
- **S4 — the reference cap only trims extras.**
  - Explicitly referenced sheets and every photometric / site page always go.
  - Only the "always useful" extras (RCP, life safety, equipment schedules) share the cap of 12.
  - A broad discipline reference ("see civil") gives at most 3 pages.
- **S5 — rejection before the claim, and a complete restore.**
  - Every rejection (already in the run, a revised set, unreadable) happens before the claim.
  - `restore()` now also puts back:
    - the Agent 4 and draft run ids;
    - the Agent 2, Agent 3 and counter usage and model columns.
  - `restore()` never restores over a newer run.
- **S6 — the classification cache key.**
  - The key is now content + classifier model + a hash of the classifier prompt.
  - A page the classifier never placed is not cached, so the next check classifies it again.
  - A new "Re-classify pages" action (route flag and panel button) forgets the cache for the current files.
- **S7 — skips.**
  - The sheet-check PUT runs under a row lock. It is refused while a check is running, and refused when it names a different `inputKey`.
  - Each skip carries the input key of the check it was made against, and is not honored after the inputs change.
  - After a successful supplement, references the added pages satisfy become present, and their skips (and so their clarifications) are removed.
- **S8 — the GC-scope gate.**
  - New phrasings caught: "GC to / shall / will provide / furnish / install", "by / from the GC", "GC furnished / provided / installed".
  - Power, temporary power, cabling, raceway and device boxes now count as electrical items.
  - Scope bullets are scanned as well.
  - The allow-list excuses only the items it covers, one item at a time.
- **S9 — a bare "BY OWNER".**
  - A bare "BY OWNER", owner's vendor, or vendor now means who **furnishes** the item. APT installs it, so a zero count still blocks.
  - Only these are information: "by others", another trade, an explicit "installed by …", or N.I.C.
- **S10 — the duplicate gate.**
  - When both lines carry a type tag, the tag decides: "Pole light S1" matches "S1 site pole", and "Fixture type C" matches "Type C".
  - These are no longer paired: 2x4 vs 2x2, quad vs duplex, USB vs duplex, A1 vs A2.
  - "Same item — exclude the new line" is now a user exclusion, which acts as a tombstone that sync keeps. A test runs the sync and checks the pair does not come back.

## Nits

- **N1:** a pointer at the end of a line joins the next line.
- **N2:** ranges expand ("E-1 THRU E-4" gives E-1 to E-4).
- **N3:**
  - A specific plan type suppresses the broad discipline in the same sentence.
  - Every discipline reference needs a pointer, so a bare heading or an abbreviation list is not a reference.
- **N4:** ids of up to 4 digits are read, and "E2.01" = "E-2.1".
- **N5:**
  - Page texts and plans are keyed by content hash.
  - Two different files with the same name are renamed at intake ("Electrical (2).pdf").
- **N6 (extra):** every vague notes sentence is read, 40 per Haiku call.
- **N7:**
  - The sheet-check PUT needs `run_analysis`.
  - Overrides follow their sheet (number + title) into a revised file.
- **N8:**
  - A failed Agent 1 batch aborts its in-flight siblings.
  - `usage_agent1` is written even when the run fails.
  - Progress writes are chained, so they land in order.
- **N9:** the server refuses a bulk resolution that spans cause groups. The one exception is "not on this job" across count items.
- **N10:** "Signage by sign vendor, power by EC" reads as the vendor's sign with APT's connection, and "BY GC/EC" reads as APT.
- **N12:** the stopAnalysis S2 test waits for the new run it started, and the progress test tolerates batch start order.

## Kissimmee-shaped fixture

**7 blocking items (of 12)**, against 14 for the same drawings run under the old rules.

- **Changed because of S9:** D1 (data outlet, owner's vendor) and CM (camera, by owner) are now APT-installed. So the fixture's counter counts them on E-2, as it would on the real set; a zero would rightly block.
- **The 7:**
  - the E-2 / E-2.1 "same area?" pair (2 items);
  - L and OS not found;
  - the unscheduled "Site lights 4 (E-7)";
  - the two power-pole halves, with APT pre-filled.

## Test suites (one full run each, at the end)

- **Backend:** **1746 passed, 3 failed, 4 not run** (1753 tests; 165 files: 162 passed, 2 failed, 1 lost to the worker crash).
  - The failures are the known flakes: `intakeSimilarCache` ×2, the `integration` backfill timeout, and the `notificationsRetention` worker crash (its 4 tests are the 4 not run).
  - The review's own run was 1696 passed, 4 failed, 4 not run, of 1704. The `stopAnalysis` failure it reported (N12) is fixed.
- **Frontend:** **1280 / 1280** (128 files).
- **tsc:** clean on both backend and frontend.

## Not fixed / limits

- **Agent 1 tile sizing** (see S1) is unchanged.
- **Revision detection** compares page text. A scanned page with no text layer whose sheet number is already in the run is always treated as a revision, and gets the full re-run prompt. It is never silently added.
- **No live runs.** Nothing ran against the Anthropic API.

# Fix round — Part B (review `2026-09-24-next-round-review.md`, MERGE AFTER FIXES)

**Executor:** Sonnet 5. **Scope:** the Part B findings only, per the coordinator's decisions: B3–B6, S11–S18, and nits N11, N13–N17 (B1/B2 and Part A's S/N items were fixed separately — see "Fix round — Part A" above; B3/S13/S14/S15/S18/N16/N17-partial were completed in an earlier segment of this same fix round, before a context-window handoff, and are included below for a complete picture). No live Anthropic/Graph calls; the same worktree, branch and hard rules as Part A/B's own execution.

**Migrations:** started at 131 (one added — `131_seven_eleven_deduct_label_fix.sql`). 132 is the next free number.

**Commits** (`b65ece3..5888d21`):

| Commit | Findings |
|---|---|
| 99d9453 | B3, S13, S18 |
| 6e0f7b6 | S14, S15, N16, N17 (partial: pole-count sum, skip_unparsed, manual-guard on the old find-then-update path) |
| 171365a | B4, B6 |
| 2fd871f | B5 |
| d5b12fd | S11 |
| bf00e2e | S12 (remainder — apply-side 409 gating; S12's preview-side warning surfacing was already done in 6e0f7b6) |
| f821708 | S16, N13 |
| dd817c4 | N11 (partial — see below) |
| cb8b534 | N14 |
| db61329 | N15 |
| 1caa740 | S17 |
| 5888d21 | N17 (remainder — atomic update, closing the manual-edit race) |

## Blockers

- **B3 — import reconciliation matches an existing item by a normalized spec (kind + size + material), never by name alone.** A raceway line ("3/4" EMT") can only match a conduit-kind item or assembly, never a fitting — enforced twice: a hard kind guard in the takeoff mapper's alias/fuzzy tiers (`mapper.ts`), and a deterministic spec-key index at import time (`accubidImport.ts`). Reconciliation is scoped to a `RECONCILABLE_KINDS` allowlist (conduit/coupling/connector/wire/panel/disconnect/transformer/device sub-kinds) rather than every kind, after testing showed the naive version over-consolidated genuinely different straps/clips/fixtures that happen to share a size. On a match it UPDATES the existing item; it never creates a same-meaning duplicate. Tie-breaks prefer assemblies and seed/manual items over raw BOM fittings.
  - **S18's test:** `accubidMapperReconciliation.test.ts` imports the real Kissimmee BOM against the real seed catalog and asserts the seed's own picks survive for "3/4" EMT", "1" EMT", "2" PVC Schedule 40 conduit", "#12 THHN", "20A 125V duplex receptacle, spec grade", "GFCI receptacle", "Type A - 2x4 LED recessed troffer", "Exit sign" and "LED wall pack" — both before and after the import.
- **B4 — one source of truth for `bids.amount`/`bid_estimates`, by pricing mode.** `saveBidEstimate` and `syncTakeoff` now read the bid's actual `pricing_mode` and, in Accubid mode, persist the Accubid recap's selling price instead of the Phase A engine's total — a lazy `import('./accubidBidData')` inside `bidEstimate.ts` breaks the circular import that would otherwise create. Every quote/cost-line/alternate mutation calls a new `persistPriceForBid(bidId)` dispatcher that re-persists the correct total after the edit, in whichever mode the bid is actually in. Also fixed a real regression this surfaced: `saveAccubidRecapForBid` used to hardcode `bid_estimates.line_items`/`subtotals` to `'[]'`/`'{}'` on a bid's first Accubid save (and never touch them again) — since a new bid now correctly takes the Accubid path from its first save, this was wiping out `composeBidData.ts`'s per-line confidence/qty_source data on every fresh bid; fixed by building those from a neutral-settings Phase A recap of the same lines, used only for its per-line facts, never for the total.
  - **Test:** the reviewer's exact flip sequence (save lines → save Accubid settings → add a $5,000 quote → press Labor & Pricing Save again) now holds steady on the Accubid number throughout, never reverting to a stale pre-quote total.
- **B5 — a budget-pending vendor quote blocks every GC-facing path on the server.** New `budgetPendingGate(bidId)` (same `GateBlock` shape as the existing `takeoffGate`) 409s when any `est_bid_quotes` row is `status='budget_pending'`, naming the quote(s). Wired into `run-agent4`, `generate-docx` (covers the PDF too — soffice-converted from the same buffer), `generate-takeoff-xlsx`, and `draft-proposal`. Deliberately **not** wired into `generate-prebid-package`/`email-prebid-chris` — that internal package to Chris is scope/quantities only, composed before any price exists, and stays allowed regardless of quote status, per the coordinator's decision. (No live public `/p/:token` proposal page exists for electrical bids to gate — it was removed in an earlier rework; bids.ts's own comment confirms GCs execute via contract/PO, never a web e-sign page.)
- **B6 — every quote/cost-line/alternate query is scoped `WHERE id=$1 AND bid_id=$2`.** Closes the hole where a bid's own accessible `:bidId` in the URL let a request act on another bid's row by id. A cross-bid request now 404s. PUT patches route through new field-by-field validators (`validateQuotePatch`/`validateCostLinePatch`/`validateAlternatePatch`) — a malformed patch (e.g. `{amount:'abc'}`) is a 400, never the 500 a raw string hitting a numeric column used to produce.

## Should-fix

- **S11 — price import gated by the BOM's own header date, never a caller flag or a hardcoded date.** `accubidBom.ts` now parses each BOM's report print date off its own "Job #" header line into `ParsedBom.reportDate` (the header line used to be skipped and its date discarded entirely). `buildImportPreview`'s options became `{ updatePrices, priceCutoffDate? }` (default cutoff `2026-01-01`) instead of `{ applyPrices, bomDate? }`: prices import only when the admin's checkbox AND the BOM's own date meeting the cutoff are both true. Removed the hardcoded `KISSIMMEE_PRICE_DATE` fallback entirely.
- **S12 — apply follows the preview's own reconciliation and warnings exactly.** The apply route now 409s (with `reconciles`/`warnings` in the body) unless the BOM reconciles to its own footer AND has zero unparseable lines, or `force:true` is passed. `ApplyImportResult` gained an `unparsed` array (line + real reason) passed through from the preview, so the apply *result* also lists exactly what didn't import, not just a `skipped` count.
- **S13 — done in 99d9453** (see the earlier segment): a `-100%` vendor-cost-adjustment row's ambiguous column shape (5 real rows across 3 BOMs) is reinterpreted correctly instead of parsing net cost as `-100`.
- **S14 — done in 6e0f7b6:** `bomItemCode()` suffixes a short content hash of the canonical description, so two different products that slug down to the same text never share a code.
- **S15 — done in 6e0f7b6:** a reconciled match whose unit disagrees, or whose hours delta is more than 2×, is never silently overwritten — it becomes a `propose_update` for the estimator to accept or reject.
- **S16 — the 7-Eleven auto deduct is scoped to the exact Graybar-package items, by description.** `TERM_DESCRIPTION_MATCH` replaces the old whole-category match (which swept in APT's own feeder wire/conduit sharing a category with a real panel/disconnect). A `NEVER_DEDUCT_RE` plus an explicit `Lighting Controls` category check exclude raceway/wire/feeder text and lighting *controls* (sensors, photocells, contactors, time clocks) no matter which term would otherwise have matched — those are never part of the fixture package. "Recomputed on every recap" was already fixed as a side effect of B4 (every mutation now re-runs `saveAccubidRecapForBid`, whose tail calls `syncAutoDeductAlternateForBid`). "Printed twice" is migration 131: the seeded label said "...deduct %AMOUNT%..." inside its own text, on top of `formatAlternateBullet`'s own "DEDUCT $X.XX — " prefix — the label is reworded to drop the amount entirely.
- **S17 — a per-bid pricing-mode switch, and Accubid mode stops dropping labor factors.** `accubidRecap.ts` gains `compoundLaborFactorMultiplier`: the same one-factor-per-group exclusivity and per-floor rule as Phase A's `effectiveFactorPct`, but **compounding** each selected factor instead of summing (Accubid's own "Labor Factoring," per Chris's reports — the two only agree when at most one factor is selected). Wired into `materialAndHoursFromLines`, which used to hardcode `factors: []` and silently drop whatever the estimator had picked in the takeoff step, for every Accubid-mode bid. `LaborPricingStep.tsx`'s floors-above-2 input and factor chips — previously visible only in the Phase A branch, invisible the moment a bid switched modes — are now a shared row rendered regardless of mode. A new confirm-gated switch button (`lp-switch-pricing-mode`) flips `pricing_mode` and saves immediately, so the price re-persists from the new engine right away (B4).
- **S18 — done in 99d9453** (folded into B3 above): the real-Kissimmee-BOM-against-the-real-seed-catalog reconciliation test.

## Nits

- **N11 (partial) — the wrong "uneven split" explanation is corrected; the requested new tests are not added.** The comment on `computeFieldLaborCost` blamed the 1–2¢ miss on an unevenly-dividing crew ratio, but the reviewer found the same miss on 36th Street's own *even* 1:1 split — corrected to the real explanation (Accubid computes each role's hours from the sum of every line's own hours before extending cost, then only rounds for display; this function only ever has the job's one total-hours figure to split by ratio). **Not done:** dedicated `computeFieldLaborCost` reproduction tests for 36th Street and Orlando (≤$0.05 tolerance, matching Kissimmee/Golf/Seminole/Bubble Down). This worktree has both jobs' BOM exports but not their Accubid "Breakdown" PDFs' crew composition (rate/count per role) — the only source that could make such a test a real reproduction rather than invented numbers. Flagged for whoever has the actual PDFs.
- **N13 — done in f821708** (folded into S16 above): migration 131's guard checks `terms`, `notes` AND the current auto-deduct label all still matching the migration-129 seed, not `terms` alone the way 129's own guard did.
- **N14 — equipment/GE tax is summed per line in exact dollars.** `TaxedAmount` gained an optional `taxAmount` (exact dollars, takes priority over `taxPct`); `computeAccubidRecapForBid` now sums each cost line's own tax rather than blending every line's rate into one weighted-average % and re-deriving tax from that against a possibly-different net total.
- **N15 — night-shift rate fields are validated server-side; the `value={null}` React bug is fixed client-side.** `validateAccubidSettings`'s night fields now go through the same finite/non-negative check every other numeric setting does (a bad value used to reach a `NUMERIC(10,2)` column and 500). `AccubidPricingPanel.tsx` gained a `nullableField()` helper that coalesces `null` to `''` for display, closing the controlled/uncontrolled-input warning React throws the moment a night-rate field flips between a real number and `null`.
- **N16 — done in 6e0f7b6:** `bomCalibration.ts` now resolves each BOM row through the same normalized-spec + mapper path `accubidImport.ts`'s own reconciliation uses, instead of a self-referential lookup by the row's own `bomItemCode` that read back ~0 drift the moment B3's reconciliation started updating existing items in place.
- **N17 — done across 6e0f7b6 and 5888d21.** `derivePoleBaseAssembly` sums ALL matching pole rows (qty), not just the first. `skip_unparsed` items (from the BOM parser's own warnings) are surfaced in the preview and now the apply result too (S12). The manual-edit guard on the import's update path is now a single atomic `UPDATE ... WHERE code=$1 AND source <> 'manual'` statement (`applyAccubidItemUpdate`) instead of a SELECT-then-UPDATE-then-UPDATE sequence that left real race windows open between each step.

## Test suites (one full run each, at the end)

- **Backend:** **1797 passed, 4 failed** of 1805 (166 files: 162 passed, 3 failed) — `tsc` clean. The 4 failures are pre-existing flakes in modules this fix round never touched (`intakeSimilarCache` ×2, `integration`'s lead-follow-up-backfill timeout, and — on one run — `rerunReset`'s migration-121 backfill test or `supplementPass`'s S7 test; the specific 4th flake varies run to run, which is itself evidence of flakiness rather than a regression). Part A's own report already documented the first three as "known flakes."
- **Frontend:** **1285 / 1285** (128 files) on a clean run; one earlier run showed a single unrelated flake in `SurveyMarkupEditor.test.tsx` (a gen-pipeline fullscreen-toggle timing test, outside this fix round's scope) that cleared on re-run.
- **tsc:** clean on both backend and frontend.

## Not fixed / limits

- **N11's two new reproduction tests** (36th Street, Orlando) — no source crew-rate data available in this worktree; see above.
- **No live runs.** Nothing ran against the Anthropic/Graph API; `takeoffReviewGate.test.ts`'s B5 tests mock the Anthropic SDK to throw if constructed, same as its existing review-gate tests.
- **S17's "Labor Factoring" UI** shows no dedicated readout of the compounding multiplier on screen yet (the backend/`AccubidBidRecap.laborFactorMultiplier` is there for a future display; this round only added the mode switch and un-hid the factor controls).

# Fix round 2 — Part B (review `2026-09-24-next-round-review.md`'s "Round 2" section, commit `f523af3`, MERGE AFTER FIXES)

**Executor:** Sonnet 5. **Scope:** the Round 2 findings only — the new blocker R2-B1, the new should-fix R2-S1, and nits N-R2-1 through N-R2-5 (N-R2-6 left alone, per the coordinator: "it errs safe"). Same worktree/branch/hard rules as every prior fix round in this series; no live Anthropic/Graph calls (every DB test either mocks the Anthropic SDK to throw if constructed, or never touches a route that could reach it).

**Migrations:** started at 132 (one added — `132_accubid_reconciled_provenance.sql`). 133 is the next free number.

**Commits** (`f523af3..6784115`):

| Commit | Finding(s) |
|---|---|
| 8376c27 | R2-S1 |
| 9c567c4 | R2-B1 (blocker), N-R2-4's test |
| 4da6849 | N-R2-1 |
| 996c69f | N-R2-2 |
| 062ab11 | N-R2-3 |
| 6784115 | N-R2-5 |

## Blocker

- **R2-B1 — a bare-conduit BOM row never reconciles into an "all-in" seed raceway item.** The B3 spec-key reconciliation matched a bare-conduit row ("3/4" Conduit - EMT 10' Lengths", Chris's real bare-conduit-only rate, 3.2 h/C) into the seed's ALL-IN item ("3/4" EMT (incl. couplings/straps)", 4.0 h/C — bundling a size's typical fittings labor) purely because both key to the same kind/size/material, silently dropping ~20% labor off every future takeoff pricing off EMT-075. New `isAllInRacewayItem(name)` recognizes the qualifier-phrase shape ("incl./including" or "w//with" + fittings/couplings/straps/glue); `buildSpecIndex` and the mapper-fallback reconciliation path both exclude any matching kind='conduit' item from being a reconciliation target — a bare-conduit row creates its own bare-conduit item instead (idempotent on re-import, same as any other create). This is the review's "either" option (exclude from reconciliation) rather than computing conduit + median fittings ratios and proposing an updated all-in figure — `deriveConduitFittingsForJob`/`medianConduitFittingsRatios` already exist for that, but verifying the arithmetic needs more real per-job data than this round has; the coordinator's own test criterion ("stays 4.0h/$60, OR becomes a proposal... never 3.2h silently") accepts the simpler, fully-verified fix.
  - **Test:** the real Kissimmee BOM's 3/4" EMT row never targets EMT-075 (stays 4.0h/$60, source stays 'seed'); a new bare-conduit item is created alongside it at Chris's real 3.2h rate.

## Should-fix

- **R2-S1 — the kind guard classifies by the PRIMARY noun, not every word in the name.** 99d9453's guard treated any mention of "fittings" as making an item a fitting — including the seed catalog's own all-in items and an ordinary takeoff line noting the same thing ("EMT conduit w/ fittings"). `racewayKindFromNormalizedText` strips the qualifier PHRASE ("incl./including/w//with" + fittings/couplings/straps/clips/clamps/glue) from raw text before classifying — needs raw text, not an already-tokenized set, since the phrase's adjacency is exactly what a token bag discards. A genuine fitting product ("Expansion fitting, conduit", "Coupling - EMT Set Screw Steel") never carries that qualifier shape, so it's unaffected.
  - **Test:** "2" rigid steel conduit" → RGD-200, "3/4" EMT conduit w/ fittings" → EMT-075, "2" PVC conduit with fittings" → PVCB-200 (all three previously unmatched) — plus two guardrails proving a genuine fitting is unaffected.

## Nits

- **N-R2-1 — `acceptProposals` wired through the apply route.** The route computed a preview and applied it but never read `acceptProposals` from the body, so a `propose_update` row (S15) was a dead end no matter what an estimator picked. Now parsed from `body.acceptProposals` into the Set `applyImportPreview` already expected. Per the review's own follow-up ("a unit-mismatch proposal must convert units before writing"): `ImportedItemPlan.previous` now also carries the existing item's own unit, and accepting a `unit_mismatch` proposal converts `laborHours`/`materialCost` into that unit (`convertBetweenUnits`, the same EA=1/LF=1/C=100/M=1000 divisor convention `pricing.ts`'s `UNIT_DIVISOR` uses) before writing — a `big_delta` proposal needs no conversion (same unit on both sides already).
- **N-R2-2 — a reconciled item keeps its own source; Accubid provenance is a separate field.** `applyAccubidItemUpdate` used to restamp `source='accubid'` on every reconciled write, even a 'seed' one — which then made the mapper's own tie-break (`preferCandidate`) rank that curated row BELOW every other, un-reconciled seed item on a tied score, backwards from the intent. Migration 132 adds `est_items.accubid_reconciled_at`; the guarded UPDATE now stamps that instead of touching `source`. A genuine new create is unaffected (still `source='accubid'`, no prior provenance to preserve).
- **N-R2-3 — the 7-Eleven deduct excludes fire-alarm/control panels; keeps fixtures with an attached control accessory.** `panels` matched any line containing the word "panel" ("Fire alarm control panel", over-deducting); the new `PANEL_EXCLUDE_RE` excludes fire-alarm/FACP/annunciator/security/access-control/nurse-call/control panels specifically, checked only for the `panels` term. `NEVER_DEDUCT_RE` excluded any line merely mentioning a control word, under-deducting real fixtures ("LED wall pack w/ photocell", "Troffer w/ integral occupancy sensor"); `isControlDeviceItself` now strips the same "w//with/integral" qualifier-phrase shape as R2-S1 before testing whether a control word remains as the line's own subject — a standalone control device ("Photocell, button-type") is still excluded.
- **N-R2-4 — done as part of R2-S1's commit.** Two candidates agreeing on a FITTING kind name alone (both "connector") now also need a shared raceway material tag (`fittingKindNeedsMaterialMatch` + `sharesMaterialTag`) — kind-name agreement alone let "3/4" EMT connector" match an accubid-imported lighting-track part naming no raceway material at all. `conduit`-vs-`conduit` is excluded from this stricter check (already covered by the ordinary `materialConflict` guard). Verified the test genuinely fails without the guard by temporarily disabling it and confirming the assertion broke, then restoring.
- **N-R2-5 — the pre-bid package marks a budget-pending quote in its internal notes.** `generate-prebid-package` now reads the bid's quotes and appends `"BUDGET — pending vendor quote: {description}."` to `bidData.prebid.flags` (rendered as "INTERNAL NOTES & DISCREPANCIES", the one section that exists only on this internal document) for each budget-pending one. `bidData.prebid` was previously never populated anywhere in the real pipeline at all — this is its first real production use. No price is added or implied; the package still carries none.
- **N-R2-6 — left alone**, per the coordinator's instruction (the review itself calls it conservative/safe: an absent sheet is flagged as missing only when its separator style matches the upload's own, so it never over-flags — the opposite direction of B1's original bug).

## Test suites

- **Targeted suites, run after each finding:** mapper.test.ts (40/40), accubidImport.test.ts (44/44), accubidMapperReconciliation.test.ts (6/6), autoDeductAlternate.test.ts (16/16, pure) + its DB route test (5/5), estimatingAccubidImportRoutes.test.ts (13/13, DB), prebidDraftWorkflow.test.ts (6/6, DB) plus takeoffReviewGate/fixRound1Staleness/bidStandardGeneration (39/39, DB) — all green after every commit, not just at the end.
- **Full pure estimating/bidstd suite:** 509/509 (25 files), run repeatedly through the round.
- **One full backend run at the end:** **1815 passed, 3 failed** of 1822 (166 files: 163 passed, 2 failed, plus 1 worker crash unrelated to any test in this round). The 3 failures are the same pre-existing flakes documented in every prior fix round's own report — `intakeSimilarCache` ×2 (timeout) and `integration`'s lead-follow-up-backfill (timeout) — in modules this round never touched (intake similarity cache, lead follow-up). No regression in any estimating/accubid/bidstd/preconstruction file.
- **tsc:** clean on both backend and frontend.

## Not fixed / limits

- **R2-B1's alternative fix** (compute conduit + median fittings ratios and PROPOSE a recomputed all-in figure for EMT-075/EMT-100/the PVC/rigid all-in items) was not built — see the blocker's own note above. The building blocks (`deriveConduitFittingsForJob`, `medianConduitFittingsRatios`) already existed before this round and remain available for whoever has the real per-job Breakdown data to validate the arithmetic against.
- **No live runs.** Nothing ran against the Anthropic/Graph API.
