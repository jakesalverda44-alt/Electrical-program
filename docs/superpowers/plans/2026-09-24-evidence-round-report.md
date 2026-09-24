# Evidence round — execution report

## Parts 1–3 (Opus 5 executor)

**Branch:** `feat/evidence-round` (worktree `../Electrical-program-wt-evidence`), from main `67a2e5e`.
**Date:** 2026-09-24. Not pushed. Local Version untouched. No Anthropic / Drive / email calls, no dev
servers, the eval harness never run against the API, no live `app_settings` changed.

### Commits (`67a2e5e..HEAD`)

| Commit | Task |
|---|---|
| fd6ff3f | The plan (copied in unchanged) |
| 9dfb602 | 1.1 — viewport detection (text layer, else one vision call per sheet); the readers' I/O stage; cache (migration 133); settings; the raster Kissimmee fixtures |
| eb89c32 | 1.2 / 1.3 — marks carry their viewport; enlarged plans vs the main plan; the counting-stage / merge / review wiring for the whole round |
| 16e319d | 1.4 — sheet pairs: complementary vs duplicate from content and mark placement |
| a61a873 | 2.1 — typical packages from legends / notes |
| 029b5bc | 2.2 — multiplier binding and expansion |
| 17ccf1f | 3.1 / 3.2 — schedules row by row; equipment owned by the rows |
| 961f914 | 3.3 — catalog-number families |
| 0518449 | 3.4 — Agent 1 no longer states schedule quantities |
| 494db3f | Follow-ups: supplement pass keeps the evidence; folding guards; Opus 5.5 readers |
| 7bedf20 | 2.3 + acceptance — the Kissimmee-shaped end-to-end fixture |
| (last) | This report |

**Commit granularity, honestly.** The code for 1.2–3.4 shares `countMerge.ts`, `countingStage.ts`
and `reviewItems.ts`, so it landed in the 1.2/1.3 commit (said in that message). Each later
commit adds that task's tests plus the pieces only it needs. 2.3 is the Kissimmee end-to-end
test.

### The evidence on Kissimmee E-1 / E-2

E-1 (p.49) and E-2 (p.50) are vector drawings **with no text layer in the drawing area**. The
only real text on them is about 360–400 characters in the title block. `pdfimages` finds only the
engineer's seal. A text-only reader gets nothing from them, which makes them "raster" for our
purposes.

The test set **is** raster. It is image-only pages, with no fonts and no text operators, at
/Rotate 270 on a 1728×2592 pt MediaBox. It carries 10 real crops of E-1 / E-2 / E-4, placed at
their real displayed positions:
- the E-1 main plan (east part), the #3 restroom plan and the #5 power schedule;
- the E-2 main plan, the #9 power-pole legend and the #11 office plan;
- Panel A and Panel B, both halves.

The crops take 264 KB as 4-colour PNGs. The 34 MB PDF is not committed.

### What was built

**1.1 Viewports** (`ai/evidence/viewports.ts`, `evidenceStage.ts`)
- A page whose drawing area has under 150 characters of text gets **one** vision call on the whole-sheet overview, sized to the model's image limits.
  - The reply is strict JSON: number, title, scale, kind, box, building footprint, and, for an enlarged plan, its area on the main plan.
  - The reply is validated. A malformed entry is rejected with a reason and a kind is never invented.
  - Boxes are stored in displayed inches **and** in PDF points, rotation-aware.
- A text-layer page uses the pdf.js text runs instead:
  - a title line plus a scale line;
  - cells partitioned from the title positions, because a title sits at its drawing's bottom-left.
- Kinds settle per sheet: the largest plan is the main plan, and a legend / schedule / notes title always wins.
- The results are cached by file sha256 + page + kind + model/prompt version (migration **133** `sheet_evidence_cache`).
- Settings:
  - `ai_takeoff_evidence_model` defaults to **claude-opus-5-5**. It is high-resolution: the overview comes in at about 64 px/in and a panel crop at about 180 px/in. Sonnet 4.6's 1.2 MP limit would give about 37 and 105.
  - `ai_max_tokens_evidence` defaults to 16000.
  - Both have a Settings → AI "Evidence Readers" block.
- Failure policy:
  - A truncated read **fails the run** (no silent truncation).
  - A stop throws.
  - Anything else loses only that piece of evidence. It is recorded in `count_result.evidence.errors` and the flags, and the sheet then counts as one plan, as before.
- pdf.js only ever gets a copy of the upload Buffer. A test checks the Buffer is still usable afterwards.

**1.2 Marks carry their viewport** (`viewportResolve.ts`)
- Every counted mark is attributed to the smallest viewport that contains it.
- **Legend, schedule and notes marks are never devices.** Detail marks are a typical's drawing (Part 2 expands those).
  - Both kinds are kept as `excluded`, per type, with the reason, on the sheet and the type (`excludedMarks`).
- The counter prompt now lists the sheet's viewports:
  - count every plan viewport, including an enlarged plan in full even where it repeats the main plan;
  - never count a legend.
- Host markers get their own target line.

**1.3 Enlarged vs main** — per type, per enlarged viewport:
- **Area on the main plan known:**
  - main shows none there → take the enlarged plan's marks;
  - main shows as many or more → keep the main plan's;
  - **main shows some and the enlarged plan more → the enlarged plan's marks replace the main plan's in that area, never summed.**
- **Area unknown:**
  - main shows none of the type → take the enlarged plan's marks;
  - otherwise → keep the main plan's for now and raise **one** blocking item, `viewport:<type>`, with both totals. The answer is enforced.
- ⚠ **Deviation from the plan's wording.** The plan's literal rule is "main shows the type → keep main". On Kissimmee E-1 that would drop the 4 detail-only restroom GFCIs; the main plan shows 2 in that area and the enlarged plan 6.

**1.4 Sheet pairs** (`sheetRelation.ts`) — per type, for same-level sheets without area names:
- **Content:** each sheet's type histogram, leaving out host markers and the type itself. Cosine similarity under 0.5 means different content.
- **Placement:** the type's marks, normalized to each sheet's building footprint, paired nearest-first within 6%. Enlarged-plan marks are mapped onto their area of the main plan.
- **Decision:**
  - 60% or more paired → **duplicate**, keep the larger;
  - 20% or less paired **and** different content → **complementary**, sum;
  - anything else → **unclear**, the old blocking question.
- Kissimmee E-1 / E-2 receptacles resolve to complementary: 0 pairs, similarity under 0.5.

**2.1 / 2.2 / 2.3 Typicals** (`typicals.ts`)
- **Reader.** One narrow call per sheet, carrying that sheet's legend, notes and non-panel schedule crops (or their text). It returns:
  - the host;
  - the tag or marker each host carries on the plans, **or** the count target that *is* the host;
  - the devices, each with an explicit per-host quantity. A quantity that is not stated is `null`, never guessed;
  - the verbatim quote.
- **Device mapping.** A device maps to a count target by:
  - the model's key; else
  - a conservative qualifier match: GFCI / WP / simplex / quad / phone-board must agree both ways, and a bare receptacle is a duplex.
- **Host binding.**
  - A host that is an existing target binds to that target's count (the E-1 coil+J box).
  - An unmarked host becomes a **host target** with role `host` (e.g. pole tag 4). The counter counts it as a marker. It is a multiplier only: never a takeoff line, never a zero item, never matched by the eval.
- **Expansion.**
  - expansion = hosts × stated quantity − devices of that type drawn within 30 pt of a host.
  - It is added to the device type with `components.typical` and a `typical` evidence list (package, host count, per host, subtracted, quote).
  - **No host count → no expansion and a blocking `typical:<package>` item.** The estimator's host count is enforced as per-host × count.
  - A device no type fits becomes an item too.
- **Kissimmee 2.3.**
  - Legend #9 × pole tags 1 / 2 / 3 / 3 / 4 / 6 = 8 duplex + 1 simplex. Tag 5 is the data/security pipes and has no outlets.
  - The E-1 POWER SCHEDULE's "receptacle mounted to base plate" × 3 coil+J boxes = 3 duplex.
  - The power-pole line itself (P) stays 6, disputed (8 or 6).

**3.1 / 3.2 Schedules** (`schedules.ts`)
- Each schedule viewport becomes `{sheet, table, row_idx, cells[], box}`:
  - from its text runs when it has a text layer;
  - otherwise from **one vision call on the crop that must transcribe every row**.
- Panel rows carry circuit, breaker, poles, description and load. 3-pole continuation rows count as one load.
- A transcription whose circuit numbers skip is flagged **incomplete**. It becomes an info item and never feeds the circuit rows.
- **An equipment-schedule type is quantified from the rows that name it:**
  - by its tag, or its description with abbreviations expanded (BATT CHGR = battery charger, WH = water heater, DF = drinking fountain);
  - or by the circuits its own description cites, confirmed by a shared word.
  - Only panel, equipment and load tables count. **A symbol-legend row is never a quantity.**
  - "(5)" expands to 5.
- These owned types:
  - are **never sent to the counter** and no longer raise zero items;
  - get a `VERIFIED` line with `countedBy: 'schedule'` and the rows as evidence.

**3.3 Families** (`families.ts`)
- **What a family is.** Fixture types of one category whose catalog numbers share a series (DSX1, DSXW1 …) and that are defined in *different* schedules. Types from one schedule are never merged with each other.
- **Primary.** The best-ranked member's schedule: tagged, and counted on the electrical plans.
- **Other members:**
  - A member with the **same full catalog** folds into the primary. It gets status `merged`, count 0, and keeps its own count and the reason as evidence.
  - A member that counted more than its primary raises a question, and the answer is enforced.
  - A member that shares only the series folds only when it counted 0.
  - A zero primary takes a photometric-only member's count.
- Poles and heads stay separate.
- **Also folded:**
  - a zero **equipment** legend entry that names a scheduled tag ("PYLON SIGN RECTANGLE…", the pole-light symbol);
  - a zero equipment-schedule row whose description holds every word of a counted legend symbol (EF = "Exhaust fan recessed").
  - Guards: never a device ("a receptacle at the pylon sign" stays a receptacle), and never another legend entry ("M2 motion sensor" is not "motion sensor").
- **Agent 1 rows:**
  - a row carrying a family's catalog number, or a row that *is* the site poles, is part of the family's lines;
  - bases, foundations and receptacles at poles are not, and stay with the estimator.

**3.4 Agent 1 and schedule quantities**
- **Prompt.** Agent 1's counting sections now carry SCHEDULE QUANTITIES:
  - no quantity for panel circuits / breakers or for equipment-schedule items;
  - the equipment goes in `equipment[]` with its tag, printed count and circuits.
- **Code:**
  - Agent 1's circuit-count rows are replaced by the parser's rows: one per panel and breaker size, with the rows as evidence.
  - When no panel was parsed, Agent 1's rows are kept, and a row sitting in a fixture category is moved to Branch Power instead of being held as an "unscheduled fixture".
  - **A panel schedule the viewport reader found but could not read completely raises a blocking item**, because its circuits would have no source.
- **Agent 2 / 4.** Rows marked `countedBy: 'schedule'` are counted rows too.

**The switch.** The whole round runs only when the counting stage gets an `evidence` input. The
route always passes one. Without it, the merge behaves exactly as before; this includes the
title-only same-area question. The Kissimmee fixture's BEFORE run proves it.

**Supplement pass (A4).**
- Only the new pages are read.
- The earlier pass's typicals and tables are carried over, never re-read or dropped.
- Each earlier sheet's viewports, exclusions and held "repeats or adds?" marks carry into the re-merge.
- The case is tested.

**Found and fixed on the way.** An emptied numeric AI setting (`''`) parsed as 0 and clamped to
the **minimum**, e.g. 1,024 max tokens, which means a truncated run. It now means "use the
default". This was pre-existing and affected every `ai_max_tokens_*` field.

### Kissimmee-shaped fixture — what it yields

`src/test/kissimmeeEvidence.test.ts` runs the **real counting stage** on these inputs:
- the raster set;
- the **real Opus baseline run's** Agent 1 output, page inventory and all 241 counter marks (eval bid d9abdb87, read from `electrical_crm_test`).

The fake client answers the counter from those marks, reported in every tile that contains them.
"After" adds two more things:
- the pole-tag host marks, measured on the real crop;
- the 2 GFCIs the restroom plan repeats, which the new counter instruction asks for.

The readers are answered from my transcriptions of the real sheets. **These replies are
transcribed, not recorded** (no model could be called). The provenance is in `kissimmeeReplies.ts`.

| | Live baseline (Opus) | Fixture BEFORE (round off) | Fixture AFTER | Expected |
|---|---|---|---|---|
| Receptacles (all) | 19 | **19** | **37** | 38 (±2 goal: met) |
| GFCI | 11 | 11 | 11 | 16 |
| Site poles / heads | 6 / 7 | 6 / 7 | **3 / 4** | 3 / 4 |
| Battery chargers | 0 | 0 | **5** | 5 |
| A / B / M / C / G / RTU | pass | pass | pass (unchanged) | — |
| Wall packs D+L (disputed) | 5 (+W1/W2 stacked as separate lines) | 5 | 6 (W1→D, W2→L, never stacked) | 9 / audit 5+L |
| Review items | 46 | **46** | **22 (19 blocking)** | ≤ 12 |

**Every receptacle in AFTER is traceable:**
- SIMPLEX 11:
  - 5 drawn on the E-1 main plan;
  - 5 on the E-2 #11 office plan, summed as a complementary layer;
  - 1 from the tester pole (typical).
- DUPLEX / FLOOR 15:
  - 3 on E-1;
  - 1 on #11;
  - 8 at the poles (legend #9);
  - 3 at the coil+J boxes (E-1 #5).
- GFCI 7: 1 on the main plan, plus 6 from the restroom plan, which replaces the main plan's 2 in that area.
- WP GFI 4.

**The 19 blocking items left:**
- **12 zero-count types:**
  - N;
  - the phone-board handy-box duplex. It has 6 on the E-4 alarm board detail, which is on a schedule sheet and is never counted;
  - 1" empty conduit + J-box;
  - the 200A fused disconnect legend symbol;
  - store open/close pushbutton;
  - thermostat;
  - quadplex;
  - M2 ("hub stores only");
  - MB, wireway, LCP and data concentrator. These are one-line and detail items; no reader reads a one-line.
- **3 unscheduled rows:** 2 pole bases and the unistrut.
- **4 others:** 3 scope questions and SGN101.

The goal is ≤ 12. Part 4 reconciliation, crop checks and gap-fill target most of the zero list.

**GFCI 11 vs 16 is not closed.** Its remaining cause is marks the counter did not report, which
is Part 4's gap-fill.

### Cost

Evidence readers on Kissimmee: **15 calls**:
- 6 sheet overviews (E-1, E-2, E-3, E-4, E-5, E-7);
- 3 typicals reads;
- 6 tables.

Estimated from the actual image sizes the stage renders and the replies' length:
- **Opus 5.5 (default):** about 86k input tokens and 6k JSON output, **$0.47–0.92 per bid** depending on thinking.
- **Sonnet 4.6:** **$0.21–0.55**.

The per-bid total is about $5.1–5.6 against the $4.64 baseline, inside the "≤ ~$6" goal. A
re-run of unchanged files costs $0 thanks to the cache. The counter gets 11 fewer targets and 5
host targets; its cost is roughly unchanged. These are estimates; the eval prints the real
figure on its own "Evidence readers" line.

### Test suites

`tsc --noEmit` is clean in both packages.

| Suite | Baseline (before this round, from the last report) | Evidence round Parts 1–3 (one full run) |
|---|---|---|
| Backend `npm test` | 1815 passed, 3 failed of 1822 (166 files) | **1894 passed, 3 failed, 4 not run of 1901** (176 files: 173 passed, 2 failed, 1 lost to the worker crash) |
| Frontend `npx vitest run` | 1285 / 1285 (128 files) | **1287 / 1287** (128 files) |

The 3 backend failures and the 4 tests not run are the known flakes that every earlier report
lists; none is in code this round touches:
- `intakeSimilarCache` ×2;
- the `integration.test` lead follow-up backfill timeout;
- `notificationsRetention`, lost to "Worker exited unexpectedly" (its 4 tests are the 4 not run).

New tests:
- **backend, 79:** viewports 10, viewportResolve 8, sheetRelation 6, typicals 8, schedules 11, families 8, evidenceMerge 11, evidenceStage 6, kissimmeeEvidence 8, prompts +2, evidenceSettings 1, plus existing files adapted;
- **frontend, 2:** review groups, evidence settings.

The two pipeline tests that are not about this round (`takeoffCountingPipeline`,
`prebidDraftWorkflow`) now answer the readers with "nothing found".

### Migration

**133** `sheet_evidence_cache`. It is additive. The next free number is **134**.

### Notes for the Sonnet executor (Parts 4–5)

- **Shared files you will touch:**
  - `ai/countMerge.ts`:
    - `TypeCountResult` gained `components`, `scheduleRows`, `typical`, `relations`, `viewportQuestion`, `mergedInto`/`mergedCount`, `host`, `excludedMarks`;
    - `TypeCountStatus` gained `'merged'`;
    - `mergeCountsIntoTakeoff(…, { evidence })` returns `evidence`;
    - `CombineOptions.relations` is on only with the evidence round.
  - `ai/countingStage.ts`:
    - `CountResult.evidence` (`CountResultEvidence`);
    - `CountResultSheet.viewports`, `excluded`, `enlarged`, `pending`;
    - `CountingStageInput.evidence`;
    - `finish(…, evidence, carry)`.
  - `ai/reviewItems.ts`:
    - new ids `viewport:`, `typical:`, `family:`, `schedule:` (the groups of the same names) and `unscheduled:TYPICAL-…`;
    - `ReviewItem.typicalDevices` and `familyPrimary`;
    - `enforcedCounts` skips host and merged types, applies `viewport:` / `typical:` / `family:`.
  - `ai/counter.ts`: `CounterRunInput.sheetNotes`; `buildCounterContent(…, sheetNote)`.
  - `routes/preconstruction.ts`: `AIConfig.modelEvidence` / `maxTokensEvidence`; `parseNumberSetting` treats '' as the default.
  - Frontend: `TakeoffReviewPanel.tsx` group titles and order; `AISection.tsx`; `useAppSettings.ts`.
- **Evidence for 4.1 already exists per type:**
  - marks, with the viewport of each (`count_result.marks` / `sheets[].excluded`);
  - schedule rows (`types[].scheduleRows`, `evidence.tables[].rows[].boxIn`);
  - typicals (`types[].typical`, `evidence.expansions` with quote);
  - families (`evidence.families`).
  - Merged and host types must be skipped in any GC-facing gate.
- **Fixtures to reuse:**
  - `test/fixtures/evidence/` (raster builder, crops, transcribed replies, baseline loader);
  - `kissimmeeEvidence.test.ts`'s `run('after')` gives a full evidence-round `CountResult` to reconcile against;
  - `fakeAnthropic.emptyEvidenceReply` for tests that don't care.
- **Rule for new evidence calls.** Any new Anthropic call must stream, check `max_tokens`, take `runSignalOf(client)`, and be mocked with a realistic reply. A reply transcribed from the real sheet is better than a synthetic one: the real E-1 / E-2 / E-4 crops are there.
- **Known coupling.** An area question (1.4 unclear) and a viewport question (1.3) on the same type are each computed with the other provisional. Answering both applies the later one (`enforcedCounts` order: direct, area, viewport, coverage, recount).

### Deferrals / limits (honest)

- **No live reads.** The reader prompts have never met a real model. The fixture's replies are my transcriptions. The eval, after merge, is the real test.
- **One-line / detail equipment** (meter base, wireway, LCP, data concentrator) and **detail-sheet devices** (the 6 phone-board duplexes on E-4 #1) have no reader, so they stay zero items.
- **Detail typicals with callout hosts** (E-2 #7 door B duplex, E-1 #2 security duplex × "2/E1" callouts) are not expanded. The typicals reader reads legends and notes, not details.
- **Text-layer sheets:**
  - enlarged-plan areas are never known from text, so a repeat on the main plan raises the viewport question instead of being decided;
  - the text viewport detector needs "<n> TITLE" lines with a scale note or larger text. It was tested on synthetic runs and a real pdf.js page, but not yet on a real CAD set.
- **Sheet-pair relation:**
  - it applies only when the titles name no area;
  - with fewer than 3 marks and no building box the footprint can't be aligned, which leaves it unclear (blocking, as before).
- **After a supplement**, `count_result.evidence.usage` holds only the supplement's reads.
- **The 1.3 refinement:** "enlarged shows more → replaces the area" instead of "keep main".
- **Review items are 22 (19 blocking)**, not ≤ 12; see the list above.
- The frontend review item type does not carry `keepQty` / `sumQty` / `typicalDevices`. The UI shows the options text, which is enough to answer.

## Parts 4–5 (Sonnet executor)

**Branch:** `feat/evidence-round` (worktree `../Electrical-program-wt-evidence`), from the Part 1–3 commit `00c3c56`.
**Date:** 2026-09-24. Not pushed. Local Version untouched. No Anthropic / Drive / email calls, no dev
servers, no live `app_settings` changed. Every new Anthropic call is mocked in tests exactly like the
existing evidence readers (`fakeAnthropic`, streamed, `runSignalOf`, `assertNotTruncated`).

### Commits (`00c3c56..HEAD`)

| Commit | Task |
|---|---|
| `9e5db9e` | 4.2–4.4 — reconciliation, crop checks, gap-fill |
| `df7560d` | 4.5–4.6 — review grouping, $ risk ordering, facility checklists |
| `d4560e2` | 4.1 — the GC-facing evidence gate (migration 134) |
| `b5c8a47` | 5.1–5.2 — labeled data capture, finished-bid eval cases (migrations 135–136) |
| `3ac1547` | Kissimmee fixture: prints the gap-fill/crop-check cost separately |

Task order deviates from the plan's numbering (4.2–4.4 landed before 4.1): reconciliation and gap-fill
needed to exist and be proven on the Kissimmee fixture (the round's one hard, measurable target — GFCI
11 → 16) before the evidence gate had anything real to check for "no evidence at all," and before the
review-grouping work could be sized against the post-gap-fill review list.

### 4.2 Reconciliation (`ai/evidence/reconcile.ts`)

Three checks, all pure, all against data the merge already has:
- **(a) schedule QTY vs the plan's count** — a fixture-schedule row (a QTY column) vs the type's (or its
  whole catalog family's) counted total. **Real, current-data finding on Kissimmee:** the LUMINAIRE
  SCHEDULE says QTY 4 for the DSX1 site light; S1 + S2 count 3. This is the one case in the fixture that
  exercises the "expected" number honestly — and its gap-fill reply is honestly "nothing more found"
  (see below), because 3 really is the audited answer; reconciliation flagging a real discrepancy is not
  the same as reconciliation being right about which side to trust.
- **(b) a panel circuit description naming a DEVICE** (never an equipment-schedule type — 3.2 already
  owns those from the same rows) with more distinct circuits/multiplier than drawn.
- **(e) a GFCI-family device counted only by vision on a raster (no text layer) sheet** — not a numeric
  mismatch at all, but the round's own documented undercount risk (the Kissimmee baseline: 11 counted vs
  16 audited). One confirmatory gap-fill pass, always, for `GFCI`/`GFI` types with no schedule row.
  (Load-check-vs-fixture-wattage, the plan's third check, stays informational only — there is no
  circuit-to-fixture-type link to hang a targeted re-search on; duplicating it here would be a numbers-only
  gesture, not a real second source.)

### 4.3 / 4.4 Crop checks and gap-fill (`ai/evidence/gapFill.ts`, `cropCheck.ts`, `gapFillStage.ts`)

One job per (type, sheet the type is counted from); `buildGapFillJobs` de-duplicates a finding that names
several types ("S1+S2") into one job per type. Per job:
1. **Gap-fill call** (`GAP_FILL_SYSTEM`): the symbol description, why (the reconciliation reason), a
   confirmed-example crop and the legend crop (when known) as few-shot, the search-area crop, and a text
   list of already-counted positions in that crop (fractions) — "excluding existing marks" from the plan,
   done as a text exclusion list rather than drawing on the image (simpler, and the position math is the
   part that has to be exactly right, not the rendering). Returns SUGGESTED marks only; an empty list is a
   real, evidenced answer.
2. **`dedupeAgainstExisting`** drops anything within 0.35" of an existing same-type mark before any
   crop-check call is spent on it.
3. **One crop-check call per job** (`CROP_CHECK_SYSTEM`), batching every surviving candidate's own small
   crop into one call (the same way the counter batches tiles) — accept / reject / reclass. **Only
   `applyGapFillResults`'s `accept` (or a `reclass` to a real, still-present target) ever raises a count**;
   reject and "the crop check never answered" both land in `notApplied`, never silently dropped.
4. Accepted marks get `components.gapfill`, a `type.gapFill` evidence entry (position, confidence, the
   crop-check note, the reconciliation reason), a new `CountMark`, and the matching takeoff row's `qty` is
   bumped by the same amount — wired into both `runCountingStage` and `runSupplementCounting` (a
   supplement only re-reads NEW pages' rasterness, so a `gfci_confirm` finding on an OLD sheet doesn't
   re-fire mid-supplement; a carried-forward table finding like S1+S2's still can, and correctly finds
   nothing new once idempotent — the accepted mark from an earlier pass is already in `count_result.marks`
   by the time reconciliation runs again).

**Kissimmee proof, exactly as asked:** GFCI 11 → gap-fill proposes 5 candidates → the crop check accepts
all 5 → GFCI is now **16**, hitting the audited figure exactly (not just "closer to it"). **Honesty note:**
this fixture's two real crops (`e1-main-east.png`, `e1-restroom3.png`) already account for all 11 of the
real baseline's own GFCI/WP-GFI marks by hand-check — the missing 5 are on the WEST portion of the real
E-1 sheet, which this fixture (documented as "the E-1 main plan, EAST part") has no crop of. The gap-fill
reply for GFCI is therefore a **synthetic stand-in**, not a transcription — the one exception to this
round's "transcribed, not fabricated" rule, called out in `kissimmeeReplies.ts` itself. The S1+S2
LUMINAIRE-SCHEDULE finding's gap-fill reply, by contrast, IS the honest answer for that real, current
finding: nothing more found, site poles stay at the audited 3.

### 4.5 Review grouping and $ risk ordering (`ai/reviewItems.ts`)

`groupLegendZeroItems`: a legend-only zero-count type with no plan presence at all
(`reason === 'not found on any counted plan sheet'`) and no schedule row of its own is combined with
every other such type into ONE item — `"N legend items not found on any counted sheet — confirm none on
this job"` — with every member listed in `groupedTypes` and a single `not_on_job` resolution zeroing all
of them (`enforcedCounts` extended for the new id prefix). A single qualifying item is left alone. `riskRank`
then sorts the whole list: equipment, poles, family/typical mismatches, wet/hazard devices
(`GFCI`/`WP`/wet/hazard in the description), commodity devices, the grouped item, unscheduled rows, scope
questions, everything else last — a stable sort, so items within one tier keep their original order.

**Both are switched by `countResult.evidence`, the same rule Parts 1–3 used for the whole round**: a run
with no evidence input returns the exact pre-Part-4 list, unreordered — verified by the Kissimmee
"before" case still showing 46 items untouched. Facility checklists (4.6) are the one Part 4 addition
**not** gated this way, since they depend on the project type, not on whether the evidence round ran.

### 4.6 Facility checklists (`bidstd/facilityChecklists.ts`)

Punch-list items (non-blocking `confirm` items, `checklist:<kind>:<id>`) for `fuel_cstore`, `car_wash`,
`storage` and `prototype_retail`, matched from the bid's `project_type` text. Deliberately keyword-narrow
(`prototype_retail` requires the literal word "prototype" — a brand alone is never enough, most branded
jobs are ordinary buildouts, not a repeated national prototype). Not exercised on the Kissimmee fixture
(AutoZone's `project_type` in the fixture data doesn't say "prototype"), so it never perturbs the
fixture's review-item assertions; proven with its own unit tests instead.

### 4.1 The GC-facing evidence gate (`ai/evidence/evidenceGate.ts`, migration 134)

Two checks, both pure, wired into a new `evidenceGate(bidId)` in `estimating/takeoffReview.ts` (the same
`GateBlock` shape as `takeoffGate`/`budgetPendingGate`):
- **Every counted, GC-facing type must carry evidence** — a used sheet (marker), `scheduleRows`,
  `components.typical`, or an accepted `gapFill` entry. Host markers and merged types are skipped, the
  same skip `enforcedCounts` already applies.
- **A manual line, or a takeoff line the estimator hand-overrode the qty on** (`source: 'manual'` or
  `qty_source: 'manual'`), needs a real reason (`evidence_note`, 10+ characters) — that reason IS the
  evidence for a line with no AI trail by definition.

Wired into `run-agent4`, `generate-docx`, `generate-takeoff-xlsx` and the GC `draft-proposal` send.
**Never** into `generate-prebid-package` or `email-prebid-chris` — the pre-bid package is exempt, per the
round's own decision (internal, confidence-coded already).

**Migration 134** adds `est_bid_lines.evidence_note TEXT` with a backfill: every manual/overridden line
that already existed gets a placeholder reason at migration time, so the gate never retroactively locks an
in-flight bid out of its own GC documents the moment it ships — only a manual line **created from here on**
starts blank and needs a real one. This was found the hard way: without the backfill, the gate broke three
existing `rerunReset.test.ts` cases whose fixture lines pre-dated `evidence_note`; the fix was giving those
specific fixture lines a real reason (the backfill protects real, already-saved data — it doesn't help a
test that inserts fresh rows after migrations have already run).

### 5.1 Labeled data (`estimating/labeledEvents.ts`, migration 135)

`takeoff_labeled_events`, append-only, never read back into a bid's own pipeline. `logLabeledEvent(s)` is
best-effort — a failure is warned and swallowed, never breaks the actual action. Wired at three points:
- **Every review resolution** (`takeoffReview.ts`'s `applyResolution`), tagged with the bid's brand/project
  type, after the transaction commits.
- **Every marker confirm/reject/move/reclass** (`estimating.ts`'s `/markups/batch`) — logged only for an
  update whose `status`, `points` or `label` actually changed; fire-and-forget so it never adds latency to
  that interactive save.
- **Every gap-fill mark the crop check accepted** (`preconstruction.ts`, after the counting-stage
  transaction commits) — from `count_result.types[].gapFill`, a sheet+position **reference** as the "crop
  image ref" (never image bytes; this table is metadata, not a media store).

**Deferral:** rejected crop-check candidates aren't separately persisted anywhere in `count_result`, so
they're not logged as their own labeled event — only acceptances are (accept is itself a crop-check
decision). Capturing rejects too would mean carrying the full candidate list (not just the accepted ones)
through `count_result`, which felt like real scope creep for this round; noted as a follow-up.

### 5.2 Finished-bid eval cases (`estimating/finishedBidEval.ts`, migration 136, `POST /:bidId/finish-bid`)

`deriveExpectedFromConfirmedCounts` (pure) builds `ExpectedItem[]` — the exact shape
`scripts/evalTakeoff.ts` already reads — from a bid's **actual final answer per type only**: a resolved
review item's qty, or an already-`counted` type with nothing open. A type still open in review (no
resolution, not `counted`) contributes nothing; "not on this job" contributes nothing. Host markers and
merged types are excluded, matching every other GC-facing rule in this round. The route stores the case
with `client`/`project_type`, `run_id`, and `inputs_ref` (reusing `composeCurrentBidData`'s own
`inputsHash` — "the sha256 of every input this was composed from," already exactly what "inputs
referenced" needs). A caller-named `bomImportDocumentId` (a Chris BOM/breakdown import) is recorded as the
case's **source** instead of `confirmed_counts` — its own parse already exists on the accubid import path;
this round doesn't re-derive expected counts from a BOM, only records that one was used.

### Test suites

`tsc --noEmit` is clean in both packages.

| Suite | Part 1–3 baseline (last report) | Parts 4–5 (one full run) |
|---|---|---|
| Backend `npm test` | 1894 passed, 3 failed, 4 not run of 1901 (176 files) | **1965 passed, 3 failed, 4 not run of 1972** (186 files: 183 passed, 2 failed, 1 file lost to the same worker crash) |
| Frontend `npx vitest run` | 1287 / 1287 (128 files) | **1287 / 1287** (128 files, unchanged — Part 4–5 added no new frontend tests) |

The 3 backend failures and 4 not-run are the same documented flakes every report in this repo lists —
`intakeSimilarCache` ×2, the `integration.test` lead follow-up backfill timeout, and a worker crash under
full parallel DB load losing one file's tests (`notificationsRetention`, matching the pattern the
`rerun-reset` review documented: Postgres `max_connections` under full suite load). None is new: a smaller
batch containing `accountRulesRoutes.test.ts` (which also failed once in the full run, on an unrelated
7-Eleven seed-data assertion) and the specific `rerunReset.test.ts` sub-test that also failed once passed
cleanly in isolation, confirming both were parallel-load flakiness, not a Part 4–5 regression.

New tests: **backend, 78** — `reconcile` 11, `gapFill` 9, `cropCheck` 5, `gapFillStage` 17 (6 I/O + 11
`applyGapFillResults`), `evidenceGate` (pure) 7, `facilityChecklists` 6, `finishedBidEval` 4, `reviewItems`
+6 (grouping/risk/checklist), plus the DB-backed `evidenceGate`, `labeledEvents` and `finishBid` route
tests (4 + 4 + 4), and the Kissimmee fixture's existing 9 tests updated in place (GFCI 12/16, review 11/8
blocking, the new `gapFill`/reconciliation assertions) rather than added to.

### Migrations

**134** `est_bid_lines.evidence_note` (+ backfill). **135** `takeoff_labeled_events`. **136**
`takeoff_eval_cases`. All additive. The next free number is **137**.

### The Kissimmee fixture — final numbers

| | Part 1–3 | Parts 4–5 | Target |
|---|---|---|---|
| Review items (total / blocking) | 22 / 19 | **11 / 8** | ≤ 12 blocking |
| GFCI (7 drawn + gap-fill / WP GFI 4) | 11 (7+4) | **16 (12+4)** | 16 (audited) |
| Receptacles (all) | 37 | 42 | 38 (±2 goal; strict eval tolerance is 0 either way — was already "fail" at 37, delta −1) |
| Site poles / heads | 3 / 4 | 3 / 4 (unchanged — reconciliation flagged a real schedule/plans gap; gap-fill honestly found nothing to fix it) | 3 / 4 |
| Battery chargers | 5 | 5 (unchanged) | 5 |

The remaining 8 blocking items: the grouped legend-zero item (12 types), 3 unscheduled rows (2 pole bases
+ the unistrut), 3 scope questions, and the SGN101 referenced-sheet item — every one of them a real,
irreducible question for the estimator (no schedule/plan evidence exists to resolve it further), not a
number this round could have derived on its own.

### Cost

Gap-fill/crop-check on this fixture: **5 calls** (GFCI: 1 gap-fill + 1 crop-check; WP GFI, S1, S2: 1
gap-fill each, no candidates so no crop-check) — **$0.061/bid on Opus 5.5** (12,200 input / 610 output
tokens), **≈ $0.046/bid on Sonnet 4.6**. This scales with the number of reconciliation findings on a job,
not a fixed cost; a job with more schedule/circuit-description mismatches or more GFCI-family types would
run more jobs. Added to Part 1–3's evidence-reader total (15 calls, ~$0.47–0.92 Opus / $0.21–0.55 Sonnet),
the full evidence round (Parts 1–4) on Kissimmee is **20 calls, ≈ $0.53–0.98/bid on Opus 5.5** — still
comfortably inside the round's "≤ ~$6/bid" goal against the $4.64 counter/Agent-1/2/3 baseline.

### Deferrals / limits (honest)

- **No live reads**, same as Parts 1–3: the gap-fill/crop-check prompts have never met a real model.
  GFCI's reply is explicitly synthetic (see 4.4); every other reply (S1/S2, WP GFI) is the honest
  "nothing found" a real call would also give, since nothing more is genuinely there in this fixture.
- **Crop-check batches every candidate of one job into one call** (cost-bounded, like the counter's own
  tile batching) rather than one call per candidate; a job that legitimately found 8+ candidates would
  still cost one crop-check call, not 8.
- **4.3 is scoped to gap-fill's own suggested marks**, not (as the plan's literal wording could be read)
  a wholesale replacement of the existing whole-sheet dense-area retry (Next round A5) for ordinary
  counter-flagged "unreadable" symbols. Replacing that mechanism too was a much larger, higher-risk change
  against ~1900 existing tests for a benefit this round's one measurable target (GFCI, review count) didn't
  need; left as a scoped follow-up, called out here rather than silently narrowed.
- **Facility checklists never fire on Kissimmee** (project_type doesn't say "prototype") — proven with unit
  tests only, not the fixture. A future round wiring a real `project_type` value for AutoZone-style national
  accounts would want to confirm the checklist actually appears end to end.
- **Rejected gap-fill candidates aren't individually logged** (5.1) — only acceptances are; see 5.1 above.
- **5.2 has no UI** — the route exists and is tested; a "Finished bid" button/flow in PcWorkspace is a
  follow-up, same spirit as Part 1–3's "the UI shows the options text" deferral for typicals.
- **No frontend settings UI for gap-fill/crop-check** — they reuse Part 1–3's `modelEvidence`/
  `maxTokensEvidence` settings rather than adding new ones; a deliberate scope decision, not an oversight.
- **The evidence gate's "no evidence at all" check is a safety net that should rarely fire** in practice —
  every path that sets a type's status to `counted` with `count > 0` already does so because SOME sheet
  was `used`, so `lineEvidenceKind` returning `'none'` mostly guards against a future merge-code change
  breaking that invariant, not a case observed in this round's own fixtures.
