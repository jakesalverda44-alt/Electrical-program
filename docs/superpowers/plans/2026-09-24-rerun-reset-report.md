# Re-run reset, analysis inputs, Stop analysis, pdf.js buffer fix — report

Branch `fix/rerun-reset`, from main `cc486ce`. It is not merged and not pushed. Worktree
`Electrical-program-wt-rerun-reset`. Migrations **121** (reset) and **122** (stop). The
next plan starts at **123**.

| Commit | What |
|---|---|
| 9cf9d88 | Re-run reset (backend), analysis-input exclusion and de-duplication, run guards |
| 41f6491 | Stop analysis (backend), live progress |
| b08aa59 | **pdf.js detached-buffer fix.** The same patch is `acfc2bc` on branch `fix/pdf-buffer-detach`, cut straight from main, so it can merge first. |
| 386347f | Fresh-install max-token defaults: Agent 2 = 32,000, Agent 3 = 16,000 |
| d811a06 | Frontend: reset confirm, panel refresh, recheck badge, Stop buttons, progress |
| (last) | This report |

## 1. Re-run reset

Jake: *"when we re-run the analysis it should clear out all the old outputs."*
`beginAnalysisRun()` mints the new `run_id` and runs `services/rerunReset.ts`
in **one transaction**. It locks the `takeoff_results` row first, so two
re-runs of the same bid run one after the other. A failure anywhere rolls back
the whole reset and the run does not start (a test checks this with a trigger
that makes the reset fail). A request that never starts a run, such as one
with no usable files, resets nothing.

**Cleared** (AI-derived):
- `takeoff_results`: Agent 1–3 output, `count_result`, `review_items` (the
  items **and the estimator's answers**), `account_terms`, `hygiene`,
  `raw_response`, the draft, Agent 4 output and price. `review_status` is set to `pending`.
  B5 already cleared most of this. The review items, answers, account terms
  and hygiene were not cleared before, and now are.
- Suggested AI markers (`source='ai_count' AND status='suggested'`) are
  soft-deleted.
- AI-imported RFIs are removed unless they were already drafted to the GC or
  answered. Those stay as a record of that exchange.
- `est_bid_lines` with `source='takeoff'` that the estimator never touched.
- The `bid_estimates` row. `bids.amount` is set to NULL, but only when it came
  from the pipeline (a saved estimate or an Agent 4 price). An amount typed
  with neither is kept.
- The workspace `scope` sections, `confirmed_service`, `ai_done` and
  `proposal_generated`.
- Filed proposal, takeoff, `bid_data` and pre-bid documents get
  `superseded_at` / `superseded_by_run_id`. They are **never deleted**.
  `loadMostRecentBidDoc` skips them.

**Kept** (the estimator's work): uploaded plans, specs and other documents;
confirmed markers; manual lines; workspace notes; typed RFIs; the scope list
and overrides; account rules; `est_bid_settings`; `manual_count_targets`.

**Touched takeoff lines are kept and flagged.** A takeoff line counts as
touched if it has any of these: `qty_overridden`, a material or labor
override, `qty_source` of markup or manual, a manual match, or a deliberate
exclusion. These lines get `recheck_run_id = <new run>`, which the UI shows as
"From previous run — re-check" with a "checked" button that clears it.

On the next sync-takeoff these lines **re-bind** in this order:
1. same key and same description;
2. same category and same description (a new run can renumber item ids);
3. same key.

A carried line with no match is left priced and flagged, never auto-excluded.
A confirmed marker on a line that was cleared moves to the unassigned bucket.

**Frontend.** The confirm lists what is cleared and what is kept, with counts.
It warns when unsaved Labor & Pricing edits would be lost. Before posting, the
frontend sends any pending workspace autosave, so the old RFIs can't be saved
back over the reset.

The reset returned by `/analyze` is applied to the page straight away:
- RFIs, scope and service, results, proposal preview, verify failures,
  pre-bid links and price are all replaced;
- Labor & Pricing and Bid Summary reload their data from the server;
- the review, scope list, pre-bid package and Plans panels remount.

They refresh again when the run ends. The Plans panel is not remounted while
it has unsaved markup.

Any analysis after the first, such as one after a stop or an error, goes
through the same confirm.

Also fixed: two `set()` calls in the same tick overwrote each other. The
second merged onto the old workspace and put the cleared RFIs back.

**Migration 121**:
- `est_bid_lines.recheck_run_id`;
- `documents.generated`, `content_sha256`, `superseded_at`, `superseded_by_run_id`;
- `takeoff_results.reset_run_id` / `reset_summary`;
- an RFI `origin` backfill. An existing RFI counts as AI when its id has the
  import's `Date.now()+Math.random()` shape (the only writer that puts a `.`
  in the id), or its question matches Agent 2's current `rfis`.

## 2. Analysis inputs (live AutoZone: proposal PDF sent as a drawing, plan set and spec twice)

`gatherAnalysisInputs()` builds the file list for `/analyze`:
- **CRM-generated documents are never inputs.** A document is excluded if it
  has `documents.generated` (set by `storeDocument` for every generate-* route
  and backfilled from `gate_passed` / `takeoff_run_id` / `compose_inputs_hash`
  / `bid_data`), or its category is proposal, takeoff, prebid_scope,
  prebid_takeoff or bid_data.
- An upload that matches a generated document is dropped: by sha256 when the
  document has a stored `content_sha256` (recorded on every new upload), by
  name and size otherwise.
- **Duplicates are dropped**: the same document id selected twice, and the
  same bytes (sha256) twice. The document copy wins, because its id is what
  places the markers.
- One log line, `[takeoff] analysis inputs — …`, lists what was sent and every
  exclusion with its reason. The response carries `excludedInputs`, and the UI
  prints "Left out: …".
- The Files tab disables generated documents as inputs and badges them
  Generated or Superseded.

## 3. Stop analysis

`POST /api/preconstruction/:bidId/stop-analysis` requires bid access and
`run_analysis`. `what` can be analysis, agent4, draft or all.
- The run keeps its `run_id` and is marked `cancelled`: `status`,
  `agent4_status` or `draft_status`. `raw_response`, `agent4_error` or
  `draft_error` is set to "Stopped by <user>", plus `cancelled_at` / `cancelled_by`.
- `ai/runControl.ts` keeps an AbortController registry per bid and job type,
  and an `abortableClient` wrapper. Every model call of a run (classifier,
  Agent 1–3, counter, draft, Agent 4) carries the run's signal, so a stop
  aborts in-flight streams at once. Aborts are never retried.
- The pipeline checks for a stop between Agent 1 batches, before counting,
  between counter sheets (none starts after a stop), and before Agents 2 and
  3 and the draft.
- A cancelled run can never write results. Every write the run makes also
  requires `status <> 'cancelled'`. That covers the counting transaction, the
  AI marker write, the draft write, the Agent 4 write and its `bids.amount`
  update, and the route's error write.
- Live progress goes in `takeoff_results.progress`, e.g. "Agent 1: batch 3 of
  14" or "Counting sheet 2 of 5". The fixed "(1–2 min)" and "30–60 seconds"
  texts are gone. Migration 122 also lets `draft_status` be 'cancelled'.
- UI: a red **Stop analysis** button sits next to a progress bar that now
  fills to the real step count. The confirm reads "Stops the AI run; you'll
  need to re-run. Tokens already used are still billed." Afterwards the page
  shows "Stopped — Stopped by X" and Re-run is enabled. Agent 4 and the
  pre-bid draft each get their own Stop button.

## 4. pdf.js detached the shared upload Buffer (live: counting failed on every sheet)

The cause: `openPdfDocument` passed pdf.js a zero-copy *view*, a change from
fix round 1 / B9. pdf.js transfers, and so detaches, any ArrayBuffer its input
fully spans. `readPageGeometry` ran on the pipeline's own upload Buffer, then
`renderCountTiles` failed with "Cannot perform Construct on a detached
ArrayBuffer".

The fix: pdf.js gets a copy by default. Sheet indexing, which owns its buffer
and never reads it again, opts back into the zero-copy view
(`{ transfer: true }`). `openPdfDocument` is the only place the backend calls
pdf.js, so nothing else in the analyze pipeline reuses a buffer after pdf.js.

Why the tests missed it: every fixture PDF is under 4 KB, so it is served from
Node's shared buffer pool, and pdf.js copies those. The new regressions
(`pdfBufferReuse.test.ts` and a full-pipeline case in
`takeoffCountingPipeline.test.ts`) use a Buffer that owns its whole
ArrayBuffer, which is the live shape. With the old code the full-pipeline case
fails; with the fix it passes.

## Tests

- Backend, new: `rerunReset.test.ts` (17) and `stopAnalysis.test.ts` (10),
  `pdfBufferReuse.test.ts` (4), plus 1 new case in the counting pipeline test.
  They cover:
  - an AutoZone-shaped fixture with every cleared and kept category;
  - the keep list surviving;
  - atomic rollback;
  - the markup-sourced line kept, flagged and re-bound;
  - the flag round-tripping through GET/PUT;
  - stale documents refused: the prior run's files (409), the inputs-hash
    guard (409 "Regenerate"), and superseded files;
  - analysis inputs: proposal plus plan set given as an upload and as a
    document goes to Agent 1 once, with no proposal, and the log line lists
    the exclusions and why;
  - the migration backfill;
  - stop between batches (no further calls), stop during a stream (the abort
    is called), a cancelled run can't write, stopping Agent 4 and the draft,
    progress, permission.
- Frontend, new: `PcWorkspaceRerunReset.test.tsx` (9):
  - the confirm's contents;
  - after a re-run: the analyze request, Labor & Pricing reloading, the
    autosave sending the reset RFIs, RFI and Labor & Pricing panels fresh,
    and the recheck badge;
  - cancelling the confirm;
  - Stop button states;
  - the full stop flow for the analysis and for Agent 4;
  - the draft Stop button.
- **Frontend full suite: 124 files, 1237/1237 passed.**
- **Backend full suite: 1501–1502 of 1508 passed per run.** Only known flakes
  failed: integration.test backfill timeout, intakeSimilarCache, and the
  notificationsRetention worker crash. One run also had "sorry, too many
  clients already" from the shared Postgres, which failed one fixRound2 test.
  An earlier run under the same load also failed two rerunReset sync tests
  and four dashboardCoTotals tests. All of these pass when run on their own.
- `tsc --noEmit` is clean for backend and frontend.

## Open questions

1. **Review answers are now cleared on re-run.** This turns off the N4
   carry-over, where earlier resolutions were re-offered on the next run. Keep
   it that way, or carry answers over only for items whose counts didn't change?
2. **AI RFIs already drafted to the GC or answered are kept.** Should those
   be cleared too?
3. **`bids.amount` is set to NULL, not 0**, when it came from the estimate or
   Agent 4. An amount typed with no estimate is kept. Is that right?
4. **Kept takeoff lines are never auto-excluded** when the new takeoff has no
   match. They stay priced and flagged until the estimator checks them.
5. **Stop across processes:** the in-memory abort only reaches the process
   running the job. On a multi-instance deploy, the database flag still stops
   the job at its next checkpoint, and the write guards still hold, but an
   in-flight stream on another instance runs to completion.
6. **Re-run needs the files re-selected**, as before (nothing is sent
   automatically). Should a re-run default to the last run's input documents?
