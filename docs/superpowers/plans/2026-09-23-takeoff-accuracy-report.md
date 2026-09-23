# Takeoff accuracy — execution report (2026-09-23)

Branch `feat/takeoff-accuracy`, worktree `Electrical-program-wt-takeoff-accuracy`.
Commits `b17fd90` (plan copy) .. `HEAD` (this report). Not pushed. Local
Version was never touched. No real Anthropic or Drive calls, no email, and the
eval harness was never run against the API.

## Commits

| Commit | Task |
|---|---|
| b17fd90 | Plan copied into the worktree |
| 1bfffdc | 1 — fail on `max_tokens` for every agent call; counter model settings |
| b06856e | 2 — count-target type list + Agent 1 counting sections |
| b29bc05 | 3 — 300 DPI renderer, ≤8" tiles with 1" overlap |
| a26a74e | 4 — counter agent (Agent 1C), strict parse, overlap de-dup |
| 05799bc | 5 — merge into the takeoff (cross-sheet rules, poles vs heads, load check) |
| 39a7a22 | 6 — AI-counted locations as suggested markers in the Plans view |
| 0097ee2 | 7 backend + Task 1 follow-ups (robust JSON fences, Agent 4 failure detail) |
| 3e3bb4f | 7 frontend — Needs-review panel; proposal blocked while it's open |
| e0b436c | Task 1 follow-up — every agent call streams |
| 65d9f09 | 8 — account rules (fixed or `ask`, drawings-aware, enforced after Agent 4) |
| dde638e | 9 — output hygiene |
| 3477794 | 10 — eval harness (dry run by default) + Kissimmee expected file |
| 2f0509c | 11 — estimator scope list, non-electrical gate, near-duplicates (Lake City) |
| a80d999 | 12 — pre-bid draft right after the analysis; package from it; proposal reuses it |
| e80a787 | 13 — proposal matches the Cowork format and style |

Each commit message describes what it did in detail. This report summarizes and
lists what is **not** done.

## Test suites

| Suite | Baseline (before Task 1) | Final |
|---|---|---|
| Backend | 1160–1161 passed of 1166, 118 files (known flakes: intakeSimilarCache, notificationsRetention) | 1340 passed, 4 failed, 4 skipped of 1348, 138 files (see note) |
| Frontend | 1188 / 1188, 115 files | 1214 / 1214, 121 files (clean rerun — see note) |

Backend final run, 4 failures:
- **2 × intakeSimilarCache.** This is the known flake. One of them fails
  again when the file is run alone.
- **1 × integration.test lead follow-up backfill.** This is a 30 s timeout
  under full-suite load and is not related to this work. It passes when run
  alone.
- **1 × takeoffTruncation "every agent call streams".** This was a real
  stale expectation left by Task 12. Since Task 12, `runPipeline` composes the
  pre-bid draft right after the analysis, which adds a fourth streamed call at
  Agent 4's Max Tokens. The test was updated in the report commit and now
  passes (4/4).

So once that fix is counted, only the known flake and the load timeout remain.

The first full backend run of the session hit a worker crash ("Worker exited
unexpectedly"). It reported 18 failures of 1325 because the crashed worker's
files were lost. The rerun above replaces it.

The first full frontend run reported 4 failures in 5 files plus 1 unhandled
error. Only the summary tail was captured, so which tests failed is not known.
An immediate clean rerun passed 1214/1214. The known frontend flake is
`SurveyMarkupEditor`, and this is treated as that kind of flakiness, but it was
not confirmed.

Task 13 also corrected one stale Task 12 test expectation: the pre-bid package
message now says the draft isn't ready.

## Key design choices

### Counter call split: one call per sheet
Each counted plan sheet goes to Opus 5.5 as **one call**: all of its tiles plus
the full type list. The sheet is split into **whole-row tile groups only when it
would exceed 20 images or 24 MB of base64** (`groupTilesForCalls`). Why:

- A symbol in an overlap band shows up in two or four tiles. De-dup
  (same type, different tiles, within 18 pt = 0.25", and inside both tiles) is
  most reliable when one response sees every tile of the sheet.
- The type list and the system prompt are sent once per sheet, not once per tile.
- A D-size sheet (36×24", title strip excluded) comes to about 5×3 = 15–20
  tiles, which is inside the per-request image limit. Groups are made of whole
  rows so every overlap band that gets split still falls between two
  neighbouring groups, and cross-group de-dup still works on PDF points.
- Concurrency is capped at 3 calls. A failed sheet fails alone. A truncated
  sheet fails the run.

### Estimated Opus token budget per plan sheet
- Each tile is at most 1568 px on the long edge, so it costs about 3.3k input
  tokens (roughly w×h/750).
- A D-size sheet has about 20 tiles, so about 66k tokens of images. The system
  prompt and type list add about 2–4k, for **~70k input**.
- Output with effort `high` (thinking plus `[type,tile,x,y]` marks) runs about
  **10–20k**.
- At $4/$20 per MTok, that is about **$0.50–0.70 per sheet**. A typical
  AutoZone set counts 3–5 plan sheets, so the counter costs about **$2–3.50 per
  run**.
- These are estimates, not measurements. The eval harness prints real usage
  per stage the first time it runs.

### Other decisions
- The counter tiles are sized for 1568 px (≥196 px/in). Opus 5.5 accepts
  2576 px images. Using that would allow larger tiles and fewer calls, but it
  was left alone to stay inside Decision 3's numbers.
- Streaming everywhere: the SDK rejects a non-streaming request above about
  21,333 `max_tokens`, which is what caused the live Agent 4 failure. The test
  fake enforces the same rule, so any call site that regresses fails in tests.
- The pre-bid draft is Agent 4 in draft mode, not a separate composer. It has
  one output contract, so the account terms, scope list, review resolutions and
  verification apply to both documents.
- Account terms are either fixed or `ask`:
  - For `ask`, an explicit drawing statement wins (and is cited).
  - An `ask` term with no statement becomes a blocking scope question.
  - A fixed rule value that conflicts with the drawings becomes a conflict
    question. It is never silently overridden.

## Task 13 — format and style (Cowork match)
The renderer now matches Cowork's proposal:
- **Header block:** date, bold GC, Attn, email, Re with the store number, address, Job No.
- **Intro:** bold.
- **Section bands:** shaded navy bands.
- **Bullets:** a small • with a tight hanging indent, and bold-lead `{b,t}` bullets.
- **Takeoff table:**
  - no borders and fixed widths
  - navy header row that repeats on each page
  - light-blue section rows and numbered items
  - no CKT rows (removed and reported as a correction) and no zero rows
  - rows never split across pages
- **Sheet citation:** electrical sheets plus photometric/civil sheets only.
- **Terms page.**
- **Price line:** the amount in words and in figures
  (`amountWords.ts`, tested for cents, thousands and hundred-thousands), kept
  on the same page as the signature block.
- **PDF:** generate-docx already converts through LibreOffice and files the
  PDF. draft-proposal already attaches the PDF when one exists; that was
  existing behaviour and is covered by existing tests.
- **In-app Proposal Preview:** a white Letter-width page in the same format. It
  stays white in dark mode, and the colors are locked by a test. The account-term
  corrections and hygiene warnings are shown above it. The preview route returns
  the .docx's exact header, intro, price and description strings, so the two
  can't drift.
- **Structure test** (`utils/proposalCoworkStructure.test.ts`): checks the
  rendered Kissimmee reference against a committed Cowork outline:
  - header lines, intro, and band order
  - table columns and sections, and numbering restarting in each section
  - the price block, then the closing
  - page count ≤ Cowork's 6 (5 in LibreOffice)
- Cowork's two errors are **not** copied: disconnects are APT-furnished, and
  change orders are approved by the GC. The test asserts both.
- Renders at 60 DPI are in `2026-09-23-takeoff-accuracy-renders/`:
  - `before-*` (old CRM output, 7 pages)
  - `cowork-*` (Cowork reference, 6 pages)
  - `after-*` (new CRM output, 5 pages, continuous flow, no large gaps)

## For Jake to decide
1. **PROJECT_INSTRUCTIONS line 23 vs the 7-Eleven seed.** The skill says
   7-Eleven is "furnish by GC / **install by GC**" on fixtures, panels, etc. The
   plan's seed (and the rule as committed) says furnish by GC, **install by
   EC**. The seed follows the plan. Edit the rule in Settings → Account Rules if
   line 23 is right.
2. **Change orders.** PROJECT_INSTRUCTIONS lines 162 and 185 still say
   "approved/signed by the **Owner**". The CRM now says GC, per your
   instruction. The skill's text needs the same edit so the desktop bid system
   doesn't reintroduce it.
3. **AutoZone power poles** are `ask`. A job whose drawings are silent raises a
   scope question that blocks the proposal until it is answered.

## Migrations
- The plan owned **112–115**. **116** (`bid_scope_items`, Task 11) and **117**
  (pre-bid draft columns plus `agent4_source`, Task 12) come from the tasks
  added during the run.
- The next plan should start at **118**. If main has taken 112–117 in the
  meantime, renumber before merging.

## Not built / deferred / limits (honest list)
- **Eval not run.** `scripts/evalTakeoff.ts` is a dry run by default. It needs
  `--confirm-live-api` and Jake's OK. No counts from a real Opus run exist yet,
  so the per-sheet cost above is an estimate.
- **The load cross-check is job-wide, not per panel.** Decision 5 says per
  panel. Agent 1's panel circuits don't reliably tie each fixture type to a
  panel, so counted watts are compared with the total VA of lighting circuits.
  A kVA-looking circuit is excluded and flagged, never converted.
- **Panel-circuit fallback targets are weak.** They are used only when there is
  no fixture schedule, legend or equipment schedule, and they carry a warning.
  Circuit descriptions rarely map one-to-one to countable symbols.
- **Tiles are sized for 1568 px** even though Opus 5.5 supports 2576 px (see
  above).
- **Same-area detection** (enlarged plans, same level) relies on the page
  classifier's sheet titles and levels. *Superseded by fix round 1 (B4):* named
  areas are summed, enlarged plans are max-kept, and anything the titles can't
  classify is a blocking question showing both numbers.
- **Counter accuracy on real drawings is unmeasured.** All counter tests use a
  perfect fake counter on real pdftoppm tiles of a committed vector fixture.
  They prove the geometry, de-dup and merge, not Opus's symbol recognition.
- **The in-app preview is HTML, not the PDF.** It matches the format; exact
  pagination comes only from the generated PDF.
- Project-type account rules (car wash, etc.) start empty, as the plan says.

## Files most worth reviewing
1. `backend/src/ai/counter.ts` — the prompt, the call split, strict parsing, overlap de-dup
2. `backend/src/ai/countMerge.ts` — cross-sheet rules, poles vs heads, the load check
3. `backend/src/ai/countRender.ts` and `backend/src/estimating/pageGeometry.ts` — tiling and the point math
4. `backend/src/bidstd/accountRules.ts` — `ask` vs fixed terms, conflicts, and enforcement on Agent 4 output
5. `backend/src/routes/preconstruction.ts` — `runPipeline` (counting stage), `composeCurrentBidData`, the review gate, `runDraftComposition` and draft reuse
6. `backend/src/ai/outputHygiene.ts`, `backend/src/bidstd/scopeList.ts`, `backend/src/bidstd/verifyBid.ts`
7. `backend/src/utils/proposalDocx.ts` and `frontend/src/features/preconstruction/PcWorkspace/ProposalPaper.tsx`
8. `frontend/src/features/preconstruction/PcWorkspace/TakeoffReviewPanel.tsx`

---

# Fix round 1 (review 2026-09-23, verdict MERGE AFTER FIXES)

Review: `2026-09-23-takeoff-accuracy-review.md` (051bd8e). Commits
**e1c0f2e..(this report commit)** on `feat/takeoff-accuracy` (not pushed). Same rules: worktree only,
no Agent tool, no real Anthropic / Drive / email, the eval not run. Every
reproduced finding has its repro committed as a test.

| Commit | Findings |
|---|---|
| e1c0f2e | S1, S2, N2, N3, S17 (counter) |
| 1262e5a | B1, B2, B3, B4, B5, S3, S4, S12, S13, S15, N1, N4, N5, N6 |
| e3f0e5b | B6, B7, S6, S7, S8, S9, S10, S11, S14, S17 (compose path + renders), N7-N12 |
| 73766b2 | S5, S16, N13, and the Takeoff-step / pre-bid / proposal UI for B2, B4, B5, N4, S8, S12, N7 |
| 352a60b | S15 test |
| (last) | this section |

Migrations: **118** (run ids on takeoff results and filed documents,
`review_status 'pending'`, `manual_count_targets`) and **119** (7-11 / 711
aliases on the seeded 7-Eleven rule). The next plan starts at **120**.

## Blockers

- **B1 — counted and resolved quantities are enforced by code.**
  `bidstd/enforceCounts.ts` runs after Agent 4 / the draft inside the one
  composition path (`bidstd/composeProposal.ts`): each counted type's line
  (Agent 4's new `count_type`, else the merge's tag/description match) gets
  the counted or estimator-resolved qty; a dropped line is re-inserted; extra
  lines for a type and every line for a "not on this job" type are removed;
  every change is a correction in the preview. `countMismatchProblems`
  re-checks the final takeoff and blocks the GC documents (422
  `count_mismatch`). End-to-end test: Agent 4 drops A and writes B = 37 → the
  rendered .docx says A 73 / B 52. The check runs in compose validation (it
  gates generate-docx, the GC xlsx and so the only files draft-proposal can
  attach); `verifyBid` itself reads rendered text and is not the place for it.
- **B2 — no schedule/legend → blocking "No fixture schedule/legend found —
  counts not verified".** Also when counting didn't run for any reason. The
  estimator confirms Agent 1's counts with a reason, or enters the types
  (`PUT /count-types`, a text box in the Takeoff step). **Limit:** the entered
  types are counted on the *next* analysis run (one click, but it re-runs the
  whole pipeline); counting-only re-runs would need the plan PDFs and page
  inventory re-loaded outside `/analyze`, which I didn't build.
- **B3 — unscheduled Agent 1 fixture rows** are blocking "Unscheduled
  fixture: …" items (count it / not on this job). A count is written back into
  the takeoff by B1. Kissimmee's "Site lights 4 (PH0.1)" is one click.
- **B4 — split areas.** PARTIAL is a partition, not an enlarged plan. Named
  areas of one level (AREA A/B, NORTH/SOUTH, PART, UNIT, WING, ZONE,
  BUILDING) are **summed** (the reviewer's 40 + 35 = 75, both title shapes,
  tested); enlarged plans of a covered area are max-kept; two same-level
  sheets whose titles can't tell same-area from partitions raise a
  **blocking** choice ("E-2.1 40 / E-2.2 35 — same area (keep 40) or
  different areas (sum 75)?") and the answer is enforced.
- **B5 — nothing from an earlier run reaches the GC or Chris.** Each
  `/analyze` is a run: Agent 4's output and price, the draft and the counts
  are cleared and the review is `pending` (every GC path blocked) until the
  counting stage writes it. Agent 4 and the draft write only if no newer run
  started. Composed output from an earlier run is never used. Filed documents
  carry the run id; "Draft email to GC" attaches **only the current run's
  verified PDF** (409 otherwise — so a bid analysed after this change needs
  LibreOffice on the server to send); the pre-bid package and the email to
  Chris are gated by the review and current-run only. Kissimmee stale-PDF
  scenario tested (re-analyse → blocked while running → still refused after
  the review clears).
- **B6 — Section C is edited in place.** The lighting term replaces the
  procurement bullet, else the bullet about the fixtures, else bullet 1;
  never a 4th bullet. The Cowork Kissimmee bullets go through the real
  enforcement + compose + `validateBidData` + `verifyBidDocx` in tests, and
  the committed `after-*` renders were regenerated through exactly that path
  (`scripts/renderProposalSample.ts` now refuses anything the app would).
- **B7 — power poles.** Asked in two halves (furnished by / installed by —
  APT / GC / Owner / Vendor each); a half the drawings state isn't asked.
  Applying an answer rewrites only text about the poles: a bullet solely
  about them is removed, they are struck from a list bullet (the Kissimmee
  "receptacles, retail power poles, and display baseflex" keeps receptacles
  and baseflex), circuits / conduit / feeds / connections to them stay, and
  anything else is flagged, not deleted. The realistic "GC furnishes, APT
  installs" removes nothing and labels the line "GC (EC installs)".

## Should-fix

- **S1** wrong reply shape / every mark rejected → the sheet fails (its types
  become unreadable review items), never "counted 0"; a bare top-level array
  is accepted explicitly.
- **S2** overlap de-dup: nearest-first one-to-one pairing within 0.83" plus
  tile-core ownership for anything unpaired. **Not exact at every noise
  level** — seeded simulation of 120 fixtures on a D sheet, 100 sheets:

  | Position error (sd, of a tile) | Old (review) | Now |
  |---|---|---|
  | 1% | 21 of 20 in one band | exact (band test, 5 seeds) |
  | 2% | 27 of 20 in one band | band exact (5 seeds); full sheet exact on ≥ 97/100, never off by more than 1 of 120 |
  | 3% | 32 of 20 in one band | band within 1; full sheet exact on ≥ 60/100, off by at most 2 of 120 |

  Position errors of 2-3% of a tile are 0.15-0.22", comparable to fixture
  spacing, so no position-only rule can be exact there; the eval must measure
  Opus's real position error. A 2% jittered counter on the real pdftoppm
  tiles gives the true counts (3 seeds).
- **S3** partial coverage (lighting only from the power plan, no plan of the
  right kind, only an enlarged / lone partial plan) and uncounted plan pages
  (classified schedule/detail/non-electrical but titled PLAN; a PDF the
  classifier returned nothing for) → blocking items.
- **S4** a counted legend/equipment type replaces Agent 1's row in any
  category and keeps its category (4 disconnects, not 8).
- **S5** legacy bids: non-blocking note with their AutoZone questions (tested).
- **S6** an answered term is never also "NOT YET DECIDED".
- **S7** furnish and install parsed separately (GC / EC, F&I, BY EQUIPMENT
  VENDOR, BY OTHERS); conflict options carry structured parties.
- **S8** matching never uses the bid's GC; 7-11 / 711 aliases (migration
  119 — note "711" also matches a bid named "... #711"); a brand that only
  matched Default warns in the Takeoff step.
- **S9** non-electrical gate: hard block only for drywall/finishes,
  storm/sanitary/water pipe, plumbing-fixture supply and roofing; everything
  ambiguous (and an SF unit alone) is a flag cleared by keeping it with a
  reason; the reviewer's electrical lines are all allowed; overrides survive
  rewording.
- **S10** other-region spec text is a warning with an override, never a
  verify block; only a conflicting named region or a named store type
  "…only" triggers it; the reviewer's three sentences don't.
- **S11** RFIs / TBDs / "to be determined" / "request for information".
- **S12** the draft prompt and its hash come from one repeatable-read
  snapshot; a stale draft is never used (package refuses; UI offers
  "Compose the draft again").
- **S13** auto-draft only for run_analysis users; running state claimed
  atomically (two concurrent starts → one model call, tested); logged.
- **S14** section rows keep with their first item; the reviewer's sweep is a
  test (mutation: 5 orphaned bands without the fix, 0 with).
- **S15** confirmed markers count only on the sheets a type is counted from;
  others are listed, never added (tested: 70 + 73 → 73).
- **S16** the eval defaults to `electrical_crm_test`, refuses the live DB
  unless `--db electrical_crm`, and prices the draft call.
- **S17** noisy / malformed counter tests (above); the Cowork structure test
  runs through real enforcement and the GC verify gate.

## Nits

N1 "found only on E-1 (5) — not counted there"; N2 context-window
exceeded = truncation (own message), refusal throws at every pipeline call;
N3 zero-tile sheet fails; N4 changed evidence → re-confirm (earlier answer
shown); N5 carry-over under a row lock; N6 reasons ≥ 10 chars with a word;
N7 Included carve-outs + a keep-with-reason override for Not-included hits;
N8 a missing-sheet entry is dropped only if every sheet it names is loaded;
N9 plumbing fixtures / fire-alarm panels aren't lighting / panels; N10
"Fixture A/B" tags; N11 an unreadable price never prints without words;
N12 no repeated item names in descriptions; N13 preview bands match the .docx.

**N14 (note):** draft reuse is the *uncommon* case in Jake's order of work —
Chris's scope list, notes and price usually arrive after the draft, and any
scope-input change forces a full Agent 4 run. That is safe (never stale), it
just doesn't save the call often.

**N15:** frontend known flakes now include `ElecProjectsSaveSection`
(fails under full-suite load on `main` too).

## Test suites (fix round 1)

`tsc --noEmit` clean in both packages. Both suites run twice, one after the
other (backend, frontend, backend, frontend):

| Run | Backend (142 files, 1432 tests) | Frontend (122 files, 1223 tests) |
|---|---|---|
| 1 | 1425 passed, 3 failed, 4 not run | 1222 passed, 1 failed |
| 2 | 1425 passed, 3 failed, 4 not run | 1223 / 1223 |

Before fix round 1: backend 1340 passed of 1348; frontend 1214. Every
failure is a known flake or load timeout, with evidence:

- **Backend `notificationsRetention.test.ts`** is the file lost to "Worker
  exited unexpectedly" in both runs (its 4 tests are the 4 not run). It is the
  one test file absent from both runs' output. The review saw the same crash
  on `main`.
- **Backend `intakeSimilarCache` ×2** failed in both full runs. Run alone it
  passed 2/2. Run together with `integration.test` it failed again, so it's
  load-sensitive. This branch touches no intake code.
- **Backend `integration.test` "backfills a follow-up…"** is a 30 s timeout in
  both full runs, and passed when run alone next to `intakeSimilarCache`
  (31/31 in that file). This branch doesn't touch leads.
- **Frontend `SurveyMarkupEditor`** (Escape / full screen) failed in run 1,
  passed in run 2, and passed 1/1 alone. The review showed it failing on
  `main`.
- **Frontend `Takeoff step — List|Plans toggle`** (lazy chunk) failed once in
  a targeted run during the work, then passed in every later run. I'm listing
  it as a timing flake, but it has only been seen once.

## Not fixed / limits

- B2's "enter the types" counts them on the next full analysis run, not
  instantly.
- S2 is not exact at 3% position error (numbers above); the eval must
  measure the real error before the counter prices a live bid.
- The Kissimmee eval has still not been run against the real API.
- B5 requires the current run's PDF to send; a server without LibreOffice
  can no longer attach the .docx fallback for a bid analysed with run ids.
- Earlier limits above (job-wide load check, weak panel-circuit fallback,
  1568 px tiles, HTML preview) are unchanged.

---

# Fix round 2 (review "Round 2", c477b83, verdict MERGE AFTER FIXES)

Commits **fc7388f..(this report commit)** on `feat/takeoff-accuracy` (not pushed).
Same rules: worktree only, no Agent tool, no real Anthropic / Drive / email,
the eval not run. Every reproduced repro is a committed test. Migration
**120** (`bid_scope_items.flag_code`, `documents.compose_inputs_hash`, the
bare "711" alias removed). The next plan starts at **121**.

| Commit | Findings |
|---|---|
| fc7388f | R2-B2, R2-B3, S-R2-2 to S-R2-8, N-R2-3, N-R2-4, N-R2-5 |
| 5addee3 | R2-B1, S-R2-1, N-R2-1, N-R2-2 (via the R2-B1 hash), N-R2-6, N-R2-7, the override UI, regenerated renders |
| (last) | this section |

## Blockers

- **R2-B2 (the regression).** Count enforcement identifies a line **only by
  structured identity**: its `count_type`, or its item field *being* the type
  ("A", "Type A", "RTU-1 — …", the legend description) in a category where
  the type lives. It never matches on a free-text mention of a tag.
  - A line naming a different item (feeder, disconnect, base, junction box,
    panel, conduit…) is never the counted line, even with the tag in it.
  - A line not counted in EA is never the counted line either.
  - When several lines carry a type's identity, the `count_type` line wins,
    then the estimator's pick. Otherwise **nothing is changed** and the GC
    documents are blocked (`count_line_ambiguous`) until the estimator clicks
    "This is the counted line", an exact-line override. Nothing is ever
    deleted as an "extra".
  - The reviewer's four repros are tests, and every line is left untouched:
    - RTU-1 connection, with its disconnect and 80 LF feeder;
    - Panel P1 vs. pump P1, with a 60 LF feeder;
    - the S1 pole base;
    - the second junction-box line.
- **R2-B1.** Every filed GC document and pre-bid package file carries a
  compose-inputs hash. The hash covers:
  - the run and the Agent 4 output or draft;
  - the price and the count result;
  - every resolution and answer;
  - the account-rule snapshot;
  - the scope list and overrides;
  - the printed bid fields.

  "Draft email to GC" (and the takeoff it attaches) and email-prebid-chris
  return 409 "Regenerate — inputs changed since this file was made" on any
  difference. Tested cases: 73→37, the price change, a scope-list change,
  the pre-bid package, and an unchanged control.
- **R2-B3.** The bare "711" alias is removed (migration 120). A brand-field
  match outranks a name or drawings match, and a match found only in the
  name or drawings, or two matching rules, raises a warning. "AutoZone Store
  #711", "711 Main St" and "Suite 711" are never 7-Eleven (pure and DB tests).

## Should-fix and nits

- **S-R2-1 / N-R2-1:** every pipeline write, and every Agent 4 and draft
  write, is bound to its run id. A superseded run stops at the next stage and
  can't change status, outputs or the review. Tested with an overlapping run.
- **S-R2-2:** a verb is never treated as a list element. "Furnish and install
  power poles and receptacles per E-2." becomes "Furnish and install
  receptacles per E-2." plus the GC exclusion.
- **S-R2-3 / N-R2-4:** after the answers are applied, every bullet and
  exclusion that states who furnishes or installs an answered term is checked
  against the answer:
  - a bullet solely about the item is rewritten;
  - a mixed bullet is split, and the item gets its own correct bullet ("Install
    the power poles furnished by the GC.");
  - a contradicting exclusion is removed;
  - anything else is flagged.

  The Kissimmee "Provide all receptacles, retail power poles, and baseflex"
  is now split this way (see after-2.png).
- **S-R2-4:** these hard-block again when there is no electrical context
  (override with a reason): drywall, storm/sanitary pipe, plumbing piping and
  fixtures, roofing, HVAC ductwork and equipment supply, sprinkler piping,
  paving/asphalt, and painting. Concrete, flooring, doors, framing and
  fencing only flag.
- **S-R2-5:** overrides bind to the exact line (category plus every word and
  number) and to their flag code. The fire-alarm conduit vs. devices case and
  the 100 SF vs. 900 SF case are tests.
- **S-R2-6:** a sentence naming a state, territory or country other than the
  project's blocks, with an exact-line override. Puerto Rico on Kissimmee
  blocks. A named store type is only a warning.
- **S-R2-7:** an estimator-counted unscheduled line never overwrites a counted
  type. It is raised as a blocking `count_conflict` (the Wall pack / D repro).
- **S-R2-8:** a carve-out covers only conduit, boxes and pull strings.
  Cabling, devices, wiring, terminations or programming fail.
- **N-R2-3:** Section C is fitted to exactly 3 bullets after enforcement, so
  there is no 422 loop.
- **N-R2-5:** PHASE is not an area. PHASE 1/2 sheets get the blocking
  same-area-or-additive question.
- **N-R2-6:** the legacy note also shows in Review & Proposal.
- **N-R2-7:** pre-bid drafts count toward the daily AI limit.

## Test suites (fix round 2)

`tsc --noEmit` is clean in both packages. Both suites ran twice, one after
the other:

| Run | Backend (144 files, 1469 tests) | Frontend (123 files, 1226 tests) |
|---|---|---|
| 1 | 1463 passed, 2 failed, 4 not run | 1225 passed, 1 failed |
| 2 | 1462 passed, 3 failed, 4 not run | 1226 / 1226 |

Before this round: backend 1425 of 1432, frontend 1223. The failures are the
same known flakes as rounds 1 and 2:

- **`notificationsRetention`:** the only file missing from both backend logs,
  lost to "Worker exited unexpectedly". These are the 4 tests not run.
- **`intakeSimilarCache`:** 1 failure in run 1, 2 in run 2. It is
  load-sensitive and this branch doesn't touch intake code.
- **`integration.test` "backfills a follow-up…":** a 30 s load timeout in
  both runs.
- **Frontend `SurveyMarkupEditor`:** failed in run 1 only; it fails on `main`
  too.

All the round-2 test files pass in both runs: `fixRound2`, `enforceCounts`,
`composeProposal`, `accountRules`, `scopeList`, `outputHygiene`,
`countMerge`, `KeepLineControl` and `PcWorkspaceProposal`.

## Not fixed / limits

- The partials the round-2 review accepted are unchanged:
  - B2: entered types are counted on the next run.
  - S2: counts aren't exact at 3% position error.
  - B5: sending needs LibreOffice.
- R2-B2's structured identity depends on Agent 4 carrying `count_type`, or
  writing the type in the item field. A line where Agent 4 does neither is
  left alone, and the counted line is added beside it. That can double a
  fixture if Agent 4 wrote the type only in free text. There is no dedicated
  warning for this: the near-duplicate warning catches it only when the
  wording overlaps. This is the price of never deleting on a text match. A
  "possible stacking" warning for untagged EA lines in fixture categories is
  a small follow-up I didn't build.
- The Kissimmee eval has still not been run against the real API.
