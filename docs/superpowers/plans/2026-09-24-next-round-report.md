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
