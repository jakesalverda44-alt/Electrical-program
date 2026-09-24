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
