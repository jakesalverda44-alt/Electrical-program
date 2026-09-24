# Re-run reset, analysis inputs, Stop analysis, pdf.js buffer fix — report

Branch `fix/rerun-reset`, from main `cc486ce`. It is not merged and not pushed. Worktree
`Electrical-program-wt-rerun-reset`. Migrations **121** (reset), **122** (stop) and **123** (run inputs). The
next plan starts at **124**.

| Commit | What |
|---|---|
| 9cf9d88 | Re-run reset (backend), analysis-input exclusion and de-duplication, run guards |
| 41f6491 | Stop analysis (backend), live progress |
| b08aa59 | **pdf.js detached-buffer fix.** The same patch is `acfc2bc` on branch `fix/pdf-buffer-detach`, cut straight from main, so it can merge first. |
| 386347f | Fresh-install max-token defaults: Agent 2 = 32,000, Agent 3 = 16,000 |
| d811a06 | Frontend: reset confirm, panel refresh, recheck badge, Stop buttons, progress |
| 3299c56 | This report |
| (last) | Re-run defaults to the last run's inputs (answers to the open questions) |

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

## Follow-up: re-run defaults to the last run's inputs

Jake tripped over the unticked boxes on the live re-run. Each `/analyze` now
records `takeoff_results.input_document_ids` (migration 123). A file from a
document keeps its id. An upload maps to this bid's filed, non-generated
copy with the same content hash. Generated and duplicate inputs are never
recorded.

The workspace pre-ticks those documents in "From Project Files", once per
run and only when nothing is picked or uploaded yet. Generated or missing ids
are skipped. It stays an ordinary selection: the estimator can untick it and
it does not come back on its own.

Tests: 1 backend test (the ids recorded, including an upload mapped by hash,
and returned by `/results`) and 2 frontend tests (pre-ticked, editable, sent
on re-run; an unticked pre-selection stays unticked).

## Open questions — answered by the coordinator

1. Review answers stay cleared on re-run (a clean slate).
2. AI RFIs already drafted to the GC or answered stay (real correspondence).
3. NULL for `bids.amount` is fine.
4. Single-process local deploy — the in-memory abort is enough.
5. Yes: re-run defaults to the last run's inputs (done, above).

## Original open questions

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

---

# Fix round (review `2026-09-24-rerun-reset-review.md`, verdict MERGE AFTER FIXES)

Migration **124**: `est_bid_lines.recheck_reason` and
`bid_workspaces.scope_meta`. The next plan starts at **125**. The reviewer's
reproduced repros are now tests.

## Blockers

- **B1 — a kept line re-binds only on category + unit + normalized
  description.**
  - The item key alone never binds, because keys renumber between runs.
  - Exactly one candidate binds. When a kept line binds, the matching new row
    is not also added, so the item is not priced twice. The kept line keeps
    the estimator's description, qty and overrides.
  - When nothing matches, or only the key matches, the line is not bound and
    is flagged `no_confident_match`. Its takeoff key, qty and overrides are
    untouched.
  - When two candidates match equally (N1), none is picked and the line is
    flagged `ambiguous_match`.
  - An unbound line stays priced and is never excluded. Labor & Pricing shows
    "re-check: no confident match in the new takeoff" (or the ambiguous
    wording), and the banner says an unmatched line may duplicate a new
    takeoff line.
  - Tests:
    - the reviewer's Duplex/GFCI repro: no bind, the GFCI keeps its own qty
      and material, one "Duplex 20A" line;
    - an exact match superseding the new row;
    - a different unit;
    - an ambiguous tie;
    - the reason round-tripping through a save and clearing with "checked".
- **B2 — `bids.amount` is cleared only when it equals, to the cent, the
  cleared estimate grand total or Agent 4 price.** Anything else (typed,
  imported or changed) is kept. The reset reports `amount: {before, kept}`.
  The confirm shows the actual amount: "and the bid amount ($X) that came from
  it" under Cleared, or "The bid amount ($X) — you set it" under Kept.
  - Tests: the 23,173 vs 25,000 repro, one cent either side, and the Agent 4
    price.

## Should-fix

- **S1** — an input is excluded only by `documents.generated`, or an upload
  whose content hash matches a generated document. A person's PDF filed under
  Proposal, Takeoff or Pre-Bid is analysed and selectable. The Generated
  badge follows the same rule.
- **S2** — `/analyze` aborts the previous run's in-flight analysis, counter,
  draft and Agent 4 calls through the stop mechanism before the reset. The
  counter's stop check is also true once the run is superseded. If the reset
  itself fails, the aborted run is marked cancelled rather than left looking
  alive.
- **S3** — Stop is phase- and run-specific.
  - It aborts only when a running job was actually cancelled, and only that
    run's jobs (the registry is keyed by run id).
  - A stop after the job finished returns 409 "already finished" and aborts
    nothing.
  - The end-of-run draft is its own job on the unwrapped client, so a late
    analysis stop can't kill it. The finished run's scope, auto-fill and Drive
    writes now skip only when a newer run took over.
  - The UI shows "Stopped" only when the server stopped the job; on
    "already finished" it leaves the run to complete.
- **S4** — Scope of Work sections record what the AI wrote in
  `scope_meta.ai` (auto-fill and "Import from AI Takeoff"). A re-run clears a
  section only while it still matches the AI's text. Before scope_meta
  existed, the fallback is to compare against the previous Agent 2
  scopeOfWork. Typed, edited, pre-bid and imported sections are kept and
  flagged "From previous run — re-check"; editing a section clears its flag.
  The confirm counts both.
- **S5** — a draft RFI's question is editable, and editing it sets
  `origin: 'manual'`, so a re-run keeps it. Sent RFIs aren't editable.
- **S6** — PlansWorkspace hands the workspace a markup flush
  (`useMarkupFlush`). The re-run saves pending markup first and does not start
  if the save fails. The Plans view is always refreshed after a reset, and the
  confirm warns about markup still saving.
  - Note: the Re-run control lives in List view, and leaving Plans view already
    goes through the markup guard, so this is defence in depth.
  - Tested at the hook level.

## Nits

- **N2** — `storeDocument({replaceExisting})` soft-deletes, following the
  documents convention (restorable), and never touches a generated file.
- **N3** — the `/analyze` comment now says review answers are cleared, with
  no carry-over.
- **N4** — Agent 4 registers its abort handle before `agent4_status='running'`
  is visible, and re-checks the status just before the call.
- **N5** — `isCancellationError` goes by type only: `RunCancelledError`,
  `APIUserAbortError` or `AbortError`, never the message text.
- **N6** — `callWithRetry` takes the run signal (`runSignalOf(client)`), wakes
  from the backoff on a stop, and throws at once.
- **N8** — the test pool is `max 5` with a 1 s idle timeout (production stays
  at 20). Two full backend runs had no "too many clients".

## Results

- **Backend:**
  - Run 1: 1521 passed, 3 failed.
  - Run 2: 1520 passed, 4 failed.
  - Both runs had 1528 tests, and neither run hit "too many clients".
  - Failures:
    - the known flakes: intakeSimilarCache ×2, the integration.test backfill
      timeout, and the notificationsRetention worker crash;
    - in run 2 only, one estimatingMarkups "socket hang up" under load. That
      file passes 28/28 on its own.
  - New fix-round tests: 13 in `rerunReset.test.ts` (30 total) and 7 in
    `stopAnalysis.test.ts` (17 total).
- **Frontend:** 125 files, 1250/1250 passed. The new tests are 7 in
  `PcWorkspaceRerunReset.test.tsx` (18 total) and 4 in `useMarkupFlush.test.ts`.
  Two existing RFI tests now query by display value, since RFI questions are
  editable inputs.
- **tsc:** backend and frontend clean.
