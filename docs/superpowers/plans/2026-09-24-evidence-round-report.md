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

---

## Fix round — Parts 1–3 (review `2026-09-24-evidence-round-review.md`, a479103)

**Executor:** Opus 5. **Findings covered:** B4, B7, B8, B9, S1, S2, S3, S9, S10, S11, S12. The Part 4–5 findings (B1–B3, B5, B6, S4–S8, S13, S14, nits) are left to the Sonnet executor. Same rules as before: worktree only, no Agent tool, no real API calls, no migrations needed (none added; the next free number is still **137**). Every reproduced finding's repro is now a test.

| Commit | Findings |
|---|---|
| c14ddf8 | B4 — sheet-pair alignment and one-object pairing |
| bb670ab | B4 — the supplement pass re-attributes carried marks to viewports |
| f820ebb | B7, B8, B9 (text-layer panels), S10 |
| b7c25c1 | S9, S12, B9 (review item and no replacement) |
| 4c6a7b6 | S1, S2, S3 and the honest fixture numbers |
| 11e1c45 | S11 |

### B4 — the sheet-pair sum needs positive evidence
- **Alignment comes first**, and never from the marks' own bounding box:
  - the building outlines on both sheets (offset and scale); else
  - a translation voted by marks of types drawn on both sheets: at least 3 votes, at least half the shared marks, an offset of at most 3", and the same scale; else
  - the sheet frame (same size and scale), with a 1.0" tolerance; else
  - **unclear** → a review item, never a sum.
- **Pairing:** a type's marks within 0.5" of each other after alignment are **one object**.
  - 60% or more paired → duplicate;
  - different content → a complementary sum that counts each pair once;
  - anything else → unclear.
- **Verified on the real renders** (wall lines measured at 100 DPI):
  - E-1 and E-2 are the same building, with E-2 drawn 0.53" right and 0.73" up. The fixture's first building boxes were rough and are now corrected.
  - E-2 #11 is labelled 1/8" but drawn at 1/4". Its area on the main plan was mapped through the office J-box, pole #2 and the FDCOKE cooler. My first transcription had that area at a quarter of its size, which is what made B-32 miss.
  - Now **B32 on #11 lands 0.05" from E-1's B-32**. It is one outlet: simplex is 5 + 5 − 1 = **9**.
- **Tests:**
  - the reviewer's 10 identical duplexes → **10, not 20**, both at the same position and drawn 2" apart;
  - AREA A/B still sums (→ 7);
  - an ENLARGED same-area sheet → the larger count, not summed;
  - a 20" "offset" is never accepted as a registration;
  - unalignable sheets → unclear;
  - Kissimmee B-32 counted once, both in a full run and in a supplement pass.

### B7 / B8 / B9 / S10 / S9 / S12 — schedules
- **B7:**
  - A numbered tag matches as a whole token with its exact suffix. EF-1 matches "EF 1" or "EF1", but never EF-12 or EF-2.
  - Each row goes to **exactly one** target:
    - the target whose tag it names; else
    - only if the row names no equipment tag at all, the single target its description matches.
    - Two description matches means the row belongs to nobody, and the counter keeps those types.
  - EF-1/2/3 → **3** (was 9). RTU-1/RTU-2 → 1 each.
- **B8:**
  - `multiplierOf` reads only `(5)`, `(5) EA`, `(QTY 5)`, `QTY 5`, `QTY: 5`, or a stand-alone `x5`.
  - It never reads `MAX 30`, `2X4`, `2'X4'`, `(2)#10`, ratings or model numbers.
  - On equipment and load rows it reads the description cell only. The reviewer's WH-1 row → 1.
- **B9:**
  - A text-layer panel with repeated CKT / DESCRIPTION headers splits into left and right rows.
  - A panel with only odd or only even circuits is **incomplete**.
  - Incomplete panels give no circuit rows and no equipment quantities, never replace Agent 1's rows, and raise the blocking `schedule:panels-unread` item ("branch circuits not verified").
- **S10:**
  - `(5)` repeated on every row of one tag → counted once (5, not 25).
  - Multi-pole continuations count as one load even when the description repeats.
  - `1,3,5` → circuit 1 with 3 poles (not circuit 135).
  - The same panel read twice is used once. If the two copies differ, the more complete one is kept, with a warning.
  - Panel names are parsed from "PANEL SCHEDULE A", "PANELBOARD LP-1", "A PANEL" and "PANEL: LP2".
  - SPARE, SPACE and "--" are never loads.
- **S9:**
  - An Agent 1 circuit row is replaced only when **every panel it covers** was read completely. A row that names no panel covers all panels.
  - If an unnamed row covering an unread panel stays, the parser's rows are not added beside it, and this is flagged.
  - `isCircuitCountRow` now also catches "20A/1P breakers", "Dedicated circuits (20/1)" and "60/3 RTU circuits". The last one had been sitting beside the parser's 60/3 row on Kissimmee.
- **S12:** Agent 1 is no longer told to leave schedule quantities out. It states them as before, and the parser's quantities replace them only where it read the schedule.

### S1 / S2 / S3 — typicals
- **S1:**
  - A package that is the host's **own** legend or schedule row is an assembly.
  - Its devices are recorded on the host's line ("each incl. 1 receptacle mounted to base plate") and are never expanded into a commodity type.
  - On Kissimmee the coil+J symbol is the display baseflex (J-box, 6' flex, receptacle in the kick plate). The 3 extra duplexes are gone.
  - The eval's `baseflex` item now matches that legend identity and honestly reports **3 against the estimator's 8**.
- **S2:** A device named without a per-host quantity raises a `typicalqty:` item:
  - **blocking** when none is drawn within 2" of a host (the estimator's total is enforced);
  - **information** when some are drawn there. The office pole's floor simplex outlets are drawn on #11, so on Kissimmee this is information.
- **S3:**
  - Drawn-at-host is measured in the host sheet's main-plan frame, within 0.75" of the tag.
  - Enlarged-plan marks are mapped through their area on the main plan, and other sheets are aligned first.
  - A device drawn at the host on its own sheet is subtracted.
  - A device at the host's position **on another sheet** is **asked about** (`typicalat:`, both totals, enforced), never subtracted silently.
  - Kissimmee example: E-1's "duplex outlet at deck" (A-31) sits exactly over the checkout pole (A-29), so it is now a question.
  - Pole detail viewports need no subtraction: marks in details were already excluded in Part 1.

### S11 — families
- **Catalog numbers are normalized:**
  - hyphens count as separators;
  - voltages and option or finish suffixes are dropped;
  - so "DSX1-LED-P8-40K-T4M-277-HS" is S1.
- "Different schedules" compares schedule sheet identity, so "E-7" = "E-7 SITE PLAN".
- Unreadable members never fold, and the symbol-definition fold takes only zero-count types.
- A numbered item (FDS-1) never folds into a generic legend symbol.

### Kissimmee-shaped fixture — honest numbers
These are the fixture's own numbers after the fixes, **without** anything gap-fill adds. The fixture still carries Part 4's synthetic GFCI gap-fill reply (B3, the Sonnet executor's). The assertions subtract whatever gap-fill added, so they hold before and after that fix.

| | Before the round | After the round (review) | After this fix round | Expected |
|---|---|---|---|---|
| Receptacles (traceable) | 19 | 37 (+5 synthetic = 42) | **33** | 38 |
| — Simplex | 5 | 11 | **10** (9 drawn: E-1 5 + #11 5 − B-32; +1 tester pole) | 8 |
| — Duplex / floor | 3 | 15 | **12** (4 drawn + 8 at the poles) | 11 |
| — GFCI | 7 | 7 (+5 synthetic) | **7** (1 main + 6 restroom plan) | 16 incl. WP |
| — WP GFI | 4 | 4 | **4** | — |
| Baseflex (coil+J) | 3 (no_match) | no_match | **3** | 8 |
| Site poles / heads | 6 / 7 | 3 / 4 | **3 / 4** | 3 / 4 |
| Battery chargers | 0 | 5 | **5** (Panel B 15–23) | 5 |
| Other equipment from rows | — | 10 types = 1 each | **same** (WH, ALC, mini-tune, drink mach, DF, pylon sign, RTU-1/2, DISCON A/B) | — |
| Review items (with the gap-fill reply still in) | 46 | 11 (8 blocking) | **13 (9 blocking)** | ≤ 12 |

- **The two new review items:**
  - the blocking checkout-pole "same outlet on two sheets?" question (S3);
  - the office-pole floor-simplex information item (S2).
- **GFCI:** 11 against the audited 16. As the reviewer found, the other 5 are not on E-1; they are an open question for the audit, not a counter miss.

### Test suites (one full run each, at the end)
`tsc --noEmit` is clean in both packages.

| Suite | Review baseline (71bfccd) | This fix round |
|---|---|---|
| Backend `npm test` | 1965 passed, 3 failed, 4 not run of 1972 (186 files) | **2000 passed, 3 failed, 4 not run of 2007** (186 files: 183 passed, 2 failed, 1 lost to "Worker exited unexpectedly") |
| Frontend `npx vitest run` | 1287 / 1287 | **1287 / 1287** |

The failures are the known flakes, as in every earlier round: `intakeSimilarCache` ×2 and the `integration` lead follow-up backfill timeout. The worker crash loses 4 tests.

### Deferred / limits
- The pole-host "possibly the same outlet" rule relies on alignment. On an unalignable pair nothing is subtracted or asked, and the expansion stands.
- Registration by vote assumes the same scale on both sheets. Different-scale sheets without building boxes are unclear, which means blocking, as before.
- Recommended for the Sonnet round: B3 should replace the synthetic GFCI gap-fill reply. The Kissimmee assertions already subtract gap-fill additions, so they will keep passing.

## Fix round — Parts 4–5 (review `2026-09-24-evidence-round-review.md`, a479103)

**Executor:** Sonnet 5. **Findings covered:** B1, B2, B3, B5, B6, S4, S5, S6, S7, S8, S13, S14, N1, N2 (already
in place, see below), N3 (report language only), N4, N5, N6, N7, N8. Opus's Parts 1–3 fix round is committed
through fca055d; this round starts from there. Same rules throughout: worktree only, no Agent tool, no real
API calls, migrations from **137**, `npm test` / `npx vitest run` once each at the end. Every reproduced
finding's repro is a test.

| Commit | Findings |
|---|---|
| 7b51cf1 | B1, B2, B3, S4, S5 — gap-fill/crop-check never counts by itself |
| 7ef6a45 | S6, S14, N5, N6 — reason gate, resolved-item evidence, stable ids, labeled events |
| ba04579 | B6 — equipment / phone-board receptacles never grouped |
| c5956ef | S7, S8, N4 — finish-bid gated, BOM reference validated, idempotent |
| ecba00d | S13 — spot-check sample of a high auto-accepted count |
| 022ef33 | N7 — 180-day retention for the sheet evidence cache |
| 24ac62b | N8 — frontend review-item groups follow the backend's $-risk order |
| 5989235 | B5 — Evidence / reason field, jump-to-line |

### B2 (core principle) — gap-fill and crop-check never count by themselves
This is the change everything else in this round is built on. Before: an accepted gap-fill/crop-check
candidate silently raised a type's count. After: it never does.

- `reconcile()` (`backend/src/ai/evidence/reconcile.ts`) compares actual **units** against the second
  source (schedule/typical qty) — `actualUnitsOf(t)` uses `t.heads` for `site_lighting`, `t.count`
  otherwise. This is also the **S1+S2 fix**: the reviewer's false alarm compared the LUMINAIRE SCHEDULE's
  head count against S1+S2's POLE count; on the real Kissimmee numbers (2 poles × 1 head + 1 pole × 2
  heads = 4 heads) that now matches the schedule's QTY 4 exactly, and no finding fires at all — the audited
  3 poles are never touched.
- A real reconciliation shortfall (`ReconcileFinding{direction:'under', diff}`) builds a gap-fill job
  (`buildGapFillJobs`, capped at `MAX_GAPFILL_JOBS`, ranked by $ risk). The model proposes candidates;
  crop-check accepts/rejects/reclasses them (unchanged mechanics, now proven end to end — see B3 below).
  Accepted candidates become **suggested** `est_markups` rows (`source:'gap_fill'`, migration 137) plus
  **one** review item:
  - `gapfill:<type>` when there's a candidate to confirm — "Gap-fill found N possible `<type>` —
    confirm on plans", capped at the reconciled shortfall, actions `['markers','count','not_on_job']`.
  - `reconcile:<type>` when there's no candidate (or an over-count, informational only) — the shortfall
    still reaches the review list, it just has nothing to point at.
- The type's own count (`countResult.types`) is **never** touched by `runGapFillPass` or
  `resolveGapFillCandidates` — confirmed by a dedicated assertion in every gap-fill test. The **only** way
  a gap-fill suggestion becomes a real count is the estimator confirming markers in the Plans view and
  resolving the `gapfill:` item with `action:'markers'` (`enforcedCounts`'s `gapfillByKey`/`reconcileByKey`
  lookup) — the exact same mechanism that already turns a counted mark into a GC quantity everywhere else.

### B1 — gap-fill's exclusion set and search area
- The exclusion set passed into a gap-fill job now includes **every** existing mark, including excluded
  ones (a main-plan area a legend-viewport/enlarged-plan mark replaced) — `GapFillSheetAsset.excludedMarks`.
- The search rectangle (`planSearchRect`) is the bounding box of **countable viewports only**
  (`main_plan`/`enlarged_plan`, per Part 1's own rules) — never a legend, schedule, notes or detail
  viewport, and never a replaced main-plan area.
- Any candidate the model still proposes outside that rectangle, or inside a legend/schedule/notes
  viewport, is rejected before it ever reaches crop-check.
- Reproduced with the reviewer's own repro (#5 POWER SCHEDULE, #3 restroom landings) in
  `gapFillStage.test.ts`.

### B3 — the synthetic GFCI reply
- `kissimmeeReplies.ts`'s always-on GFCI gap-fill reply (a hard-coded set of "found" marks, regardless of
  what the real west half of E-1 actually shows) is gone; `gapFillResponder()` now always answers
  honestly (`{"marks":[]}` / `{"decisions":[]}`) — because on the real Kissimmee data there is, in fact,
  nothing to gap-fill there once B2's false alarm is fixed and S5 removes the always-on bias pass (see
  below). The Kissimmee fixture's GFCI count is **7** (E-1's own drawn marks), never inflated.
- The full **suggest → confirm → count** lifecycle — the thing B3 actually asked to prove — is instead
  demonstrated end to end on clearly-synthetic data in the new `gapFillEndToEnd.test.ts`: a made-up
  "GFCI-EXAMPLE" schedule shortfall (5 vs. 4) proposes one candidate, becomes a `gapfill:` item, gets
  written as a suggested marker, and the count only reaches 5 after the estimator confirms every marker
  on the sheet and resolves the item with "Use confirmed markers" — never automatically.

### S4 / S5 — gap-fill jobs and the GFCI bias pass
- **S4:** gap-fill jobs are built only from real reconciliation shortfalls, ranked and capped
  (`MAX_GAPFILL_JOBS = 12`), cached by `(sheet content sha256, type, prompt version)` through the same
  evidence cache Parts 1–3 already use, with the cap and cache hits disclosed on
  `countResult.evidence.gapFill.{jobsSkipped,cachedJobs}`.
- **S5:** the always-on "confirm GFCI" pass — the thing that made B3's synthetic reply necessary in the
  first place — is gone. Gap-fill now only ever runs from an actual reconciliation shortfall.

### B6 — equipment and phone-board receptacles never grouped
- `groupLegendZeroItems`'s "N legend items not found — confirm none on this job" bulk item was folding
  in meter base, wireway, a 200A fused disconnect, LCP, data concentrator, a "1\" empty conduit and J-box"
  equipment symbol, a thermostat (T), and a phone-board duplex receptacle — high-$ items that could get
  waved through with one click and one reason.
- Excluded from grouping now: any type in `category:'equipment'`, any type whose own name/description
  matches an equipment keyword (meter base, wireway, disconnect(s)/DISCON, LCP, data concentrator,
  panel(board) — belt-and-suspenders alongside the category check), and any receptacle described as on a
  phone board. On the real Kissimmee fixture this drops the group from 12 members to **4**
  (M2, N, QUADPLEX RECEPTACLE, STORE OPEN/CLOSE PUSHBUTTON) and turns the other 8 into their own
  individual blocking items — **21 review items, 17 blocking** (was 13/9), the honest count even though
  it's now above 12.
- The group itself no longer resolves with a single blanket flag either: each member now carries its own
  resolution (`applyGroupMemberResolution`), and the group is not resolved (still blocks) until every
  member has answered. `/review/resolve` takes an optional `memberKey` to answer one member at a time (or
  every unanswered one, still recorded per member, when omitted — the "apply to all" shortcut).

### S6 / S14 / N5 — the reason gate, resolved-item evidence, stable ids
- **S6:** the migration-134 placeholder evidence note is cleared the moment a manual/overridden line's
  quantity actually changes (`bidEstimate.ts`'s `EVIDENCE_NOTE_PLACEHOLDER` handling), instead of
  surviving forever; `isRealReason` requires 10+ characters with 3+ distinct letters, so `..........`
  still fails the gate.
- **S14:** `missingEvidenceTypes` takes the review items' resolved keys — a "not on job" or a confirmed
  qty now counts as evidence, so a resolved item no longer blocks the gate forever.
- **N5:** `evidence:manual:<description>` (which broke the instant the description text changed) is now
  `evidence:line:<lineKey>`, stable across edits; `GateBlock.openItems` carries the `lineKey` for B5's
  jump-to-line.

### S7 / S8 / N4 — finish-bid
- **S7:** finish-bid now runs the same `takeoffGate()` a proposal send does — an open review item 409s
  it, with the list of open items, instead of quietly building the eval case around whatever happened to
  be resolved.
- **S8:** `bomImportDocumentId` is validated as THIS bid's own `category:'cost_breakdown'` document
  (never an arbitrary string, another bid's document, or a plans/photo upload). `expected` is still
  derived from the bid's own confirmed counts — nothing parses the BOM into it yet — so the case's
  `source` stays honestly `'confirmed_counts'`, never relabeled to `'bom_import'` on a name alone; the
  reference is still recorded for provenance.
- **N4:** added `requireAIPermission('view_results')` (it only had `requireAuth` before) and a unique
  index on `(bid_id, run_id, source)` (migration 138) so a second finish-bid call for the same run updates
  the one eval case instead of duplicating it.

### S13 — spot-check sample of a high auto-accepted count
- Every counted type at or above 20 gets one non-blocking `spotcheck:<type>` review item: a deterministic
  7.5% sample (min 3, a stable stride across the type's own placed marks — never `Math.random`) of marks
  to eyeball against the plans. It never blocks the gate and never changes the count by itself. On
  Kissimmee: Type A (73 counted) → 5-mark sample, Type B (52 counted) → 4-mark sample.

### N6 / N7 — labeled events and cache retention
- **N6:** gap-fill suggestions and estimator marker confirmations are now logged as labeled events too
  (`gapfill_suggested` / `gapfill_accept`), not just the original AI count, so 5.1's training data can
  tell a human decision from a model one; every logged event's string fields are capped
  (`MAX_DETAIL_STRING`).
- **N7:** migration 133's `sheet_evidence_cache` had no retention; `purgeExpired()` (the same hourly-job
  purge audit_log/notifications/intake_items already use) now drops cache rows older than a fixed 180
  days.

### N8 — the frontend follows the backend's $-risk order
`TakeoffReviewPanel`'s `GROUP_ORDER` pre-dated `gapfill:`/`reconcile:` (B2) and `spotcheck:` (S13) — those
fell through to an untitled "other" bucket — and had `scope` ordered 4th, far ahead of where the backend's
`riskRank()` actually ranks scope questions (40, near the bottom). `GROUP_ORDER` is re-sequenced to track
`riskRank`, and `groupTitle`/`groupKey` know about the three new groups.

### B5 — Evidence / reason field, jump-to-line
The backend's evidence gate already blocked a manual/overridden Labor & Pricing line with no real reason;
the frontend had nowhere to type one except the description field. `EstimateLine` gains `evidence_note`;
`LaborPricingStep` shows an "Evidence / reason" input under any line with `source:'manual'` or
`qty_source:'manual'` (never on an excluded line), flagged until it reads as a real reason. The gate's 409
already names the first offending line by its `lineKey` (N5); Download .docx's error handler now reads it
and switches straight to Labor & Pricing, scrolling to and focusing that exact line's field.

### N1 / N2 / N3 — nits
- **N1:** the reclass target list is deduped after reclass (`resolveGapFillCandidates`).
- **N2:** gap-fill already used per-viewport tiles at the counter's own resolution (`planSearchRect` +
  the counting stage's tile renderer), not a whole-sheet low-res image — verified while rebuilding
  `gapFillStage.ts` for B1/B2; no separate fix needed.
- **N3:** the report's own Parts 1–4 cost figures (S4/S5's now-removed always-on GFCI pass, "$0.061/bid
  on Opus 5.5") described a gap-fill pass that no longer exists on Kissimmee post-fix — corrected below.
  Everywhere this round prints a token-usage-derived dollar figure it's phrased as an **estimate**
  (`usageCost()`, Anthropic list prices) — never presented as an actual, billed cost.

### Kissimmee-shaped fixture — honest numbers (after this fix round)
| | Before this fix round | After this fix round |
|---|---|---|
| Receptacles (traceable) | 33 | **33** |
| — Simplex | 10 | **10** |
| — Duplex / floor | 12 | **12** |
| — GFCI | 7 | **7** |
| — WP GFI | 4 | **4** |
| GFCI total (GFCI + WP GFI) | 11 | **11** |
| Site poles / heads | 3 / 4 | **3 / 4** (no reconciliation finding at all — B2's heads-vs-poles fix) |
| Battery chargers | 5 | **5** |
| Gap-fill/crop-check calls on Kissimmee | 5 (the synthetic GFCI pass) | **0** (no real shortfall; S5 also removed the always-on pass) |
| Review items | 13 | **23** |
| — blocking | 9 | **17** |

The review-item jump from 13/9 to 23/17 is entirely B6 (8 equipment/phone-board items un-grouped: 13 → 21,
9 → 17) and S13 (2 non-blocking spot-check items: 21 → 23, blocking unchanged). Nothing here is a
regression — it's B6's "report the honest blocking count, even if it's above 12" and S13's new
informational item, both explicitly asked for. Receptacles/GFCI/poles/battery chargers are unchanged from
the Parts 1–3 fix round's own honest numbers, confirming B2/B3/S5 didn't disturb them.

### Test suites (one full run each, at the end)
`tsc --noEmit` is clean in both packages.

| Suite | Parts 1–3 fix round baseline | This fix round |
|---|---|---|
| Backend `npm test` | 2000 passed, 3 failed, 4 not run of 2007 (186 files) | **2032 passed, 3 failed, 4 not run of 2039** (189 files: 186 passed, 2 failed, 1 lost to "Worker exited unexpectedly") |
| Frontend `npx vitest run` | 1287 / 1287 | **1296 / 1296** |

The 3 backend failures are the same known flakes carried since the original review baseline (documented
above, under Parts 1–3's own test table): `intakeSimilarCache` ×2 (a global cache-signature race under
full-suite contention against a long-lived shared test database; the test file's own comments describe
this exact failure mode) and the `integration` lead follow-up backfill timeout — none of the touched
files (`reconcile.ts`, `gapFillStage.ts`, `reviewItems.ts`, `finishedBidEval.ts`, `evidenceGate.ts`,
`takeoffReview.ts`, `bidEstimate.ts`, `labeledEvents.ts`, `audit.ts`) are anywhere near intake or lead
follow-up code. Re-run individually, `integration.test.ts` passes; `intakeSimilarCache.test.ts` times out
even alone, consistent with its own documented "under full-suite contention... occasionally never lands a
clean window" caveat on this worktree's now heavily-populated test database.

### Deferred / limits
- B5's jump-to-line only fires from Download .docx's evidence-gate 409 (where the backend's `evidenceGate`
  is actually wired in); the takeoff .xlsx and internal pre-bid package downloads never run that gate
  (a deliberate Parts 1–4 scope decision — "never applied to the pre-bid package" — carried forward, not
  a gap introduced here).
- B6's per-member group resolution UI (multiple distinct actions inside one group card) is proven at the
  API level (`reviewGroupMembers.test.ts`) and the pure layer; TakeoffReviewPanel's own bulk-resolve UI
  for a legend-zero group still sends one action to every open member in one call (the existing "apply to
  all" bulk button) rather than offering a per-member action picker in the group's own row — a frontend
  UI follow-up, not a correctness gap (the backend still records and requires each member's own answer).
- S8 validates the BOM reference and keeps the source honest, but does not implement BOM parsing itself —
  `expected` is still confirmed-counts-derived either way, exactly as the finding asked ("keep
  confirmed_counts as source until BOM is actually parsed").

## Re-review — two gaps closed (d03b5a8, d9d6fac)

The Parts 4–5 fix round's own report (above) understated two things; both are now closed.

1. **TakeoffReviewPanel's legend-zero group answers member by member in the UI.** The backend already
   required a per-member resolution (B6, ba04579); the frontend still rendered the whole group as one row
   with a single set of controls (no `memberKey`) and still let the group's id enter the cross-item
   multi-select's bulk "Mark selected not on this job" bar — either path could resolve every member at
   once with one action, reintroducing what B6 closed. Fixed: one row per member with its own count/not-
   on-job controls; the group is removed from the multi-select entirely; the only remaining shortcut
   ("mark all N remaining not on this job") requires its own reason and a confirm dialog listing every
   member by name before it posts (still with no memberKey server-side, so each member still gets its own
   recorded resolution). 7 new tests in `TakeoffReviewPanel.test.tsx`.
2. **The evidence gate's jump-to-line now covers every GC-facing path.** The backend gate itself was never
   the gap — `generate-docx`, `generate-takeoff-xlsx`, `draft-proposal` (send) and `run-agent4` all already
   called `evidenceGate()` before this round even started (this report's own earlier "deferred" note
   claiming the takeoff xlsx "never runs that gate" was simply wrong). The actual gap was that B5's
   jump-to-line frontend wiring only fired from Download .docx. Now `downloadTakeoffXlsx`,
   `runAgent4Proposal` and `SendBidProposalModal` (draft-proposal) all extract the 409's `reviewItems` and
   jump to the named line the same way. 3 new frontend integration tests (one per path, through the real
   `PcWorkspaceView`) plus 2 new backend HTTP tests (`takeoffReviewGate.test.ts`) hitting all four routes
   with a real unresolved manual line, isolated from the review-items and budget gates.

Affected test files run: `TakeoffReviewPanel.test.tsx` (29), `PcWorkspaceProposal.test.tsx` (15),
`takeoffReviewGate.test.ts` (12), `evidenceGate.test.ts`, `finishBid.test.ts`, `reviewGroupMembers.test.ts`,
`reviewBulk.test.ts`, `gapFillEndToEnd.test.ts`, `kissimmeeEvidence.test.ts` — all passing (45 backend + 44
frontend across the touched files) — plus a full frontend `npx vitest run` (1306/1306) and `tsc --noEmit`
clean in both packages.

---

## Fix round 3 — Parts 1–3 (review "Round 2", 3c66503)

**Executor:** Opus 5. **Scope:** B12, S15, S17, S19 and the migration-138 nit. Sonnet does B10, B11, S16 and S18 after this, on the same branch; the tree is left clean for it. Same rules as before: worktree only, no Agent tool, no real API calls. Each repro is now a test.

| Commit | Finding |
|---|---|
| d7ae5fc | Migration nit: migration **139** de-duplicates eval cases, then creates the unique index (138 is now a no-op) |
| 265d451 | B12 |
| 7473e77 | S17 |
| 8ca3134 | S15 |
| b25dc0f | S15 follow-up: the supplement test's first floor now names its level |
| db055fd | S19 |

### Migration nit
- 138 was already applied to the test DB, so the fix went into a new migration.
- Old 138 created the unique index directly, which fails on a dev DB that already holds duplicates. It is now a no-op, and the index moved to **139**:
  - 139 first deletes duplicates, keeping the newest row per (bid, run, source);
  - then it runs `CREATE UNIQUE INDEX IF NOT EXISTS`.
- On a DB that already ran the old 138, 139 changes nothing.
- The test runs in a rolled-back transaction:
  - 3 duplicate rows → 1 row plus the index;
  - a re-run of 139 changes nothing.
- **The next free migration number is 140.**

### B12: panels are keyed by name + building + content
- **Identity.** A panel's identity is its name **and** the building or area its sheet title names ("BUILDING 1").
- **Same identity, same content** → one table. The content signature is the set of circuit numbers, descriptions and loads.
- **Same name, different content:**
  - **both** tables are kept and summed;
  - each carries a conflict warning;
  - the counting stage and the supplement pass store the warning on `count_result.evidence.tables`, so the real review list raises one blocking `panel-dup:<name>` item ("two panels or one?").
- Circuit lines name the building. When two same-name panels have no building, the lines name the sheet instead.
- **Tests:**
  - the reviewer's repro → water heaters **2**, Panel A circuits **7** (was 1 and 4), both tables flagged;
  - building-named titles → two identities, no conflict;
  - the same content on two sheets → one table;
  - the item reaches `buildReviewItems` from the stored tables.

### S15: stacked floors
- `levelOf` now reads:
  - L1 / L2, LEVEL n, LEVEL TWO, 2ND LEVEL;
  - FIRST–SIXTH FLOOR / LEVEL;
  - UPPER / LOWER;
  - BASEMENT / CELLAR, MEZZANINE, ROOF;
  - "FLOORS 2-4".
- A same-layout pair (the marks coincide) where either sheet's title names **no level** is never taken silently as "the same devices drawn twice":
  - it becomes the blocking keep/sum question;
  - the same applies to an unnamed-level sheet against a named-level sheet;
  - complementary layers (Kissimmee E-1/E-2) still sum.
- **Tests:**
  - the level forms;
  - L1 / L2 typical floors → 20, summed;
  - two unnamed same-layout sheets → question (keep 10 / sum 20);
  - unnamed vs LEVEL 2 → question.
- An existing test changed: `supplementPass.test.ts`. Its E-3 "LIGHTING PLAN" (no level) and E-9 "LEVEL 2 LIGHTING PLAN" put symbols at the same page positions, so they are now asked about. That test is about the supplement pass, so E-3 is now titled "FIRST FLOOR LIGHTING PLAN".

### S17: "(n)" on some rows of a tag
- One row says "(n)" and there are at most n rows → **n**. The other circuits feed the same n units.
- More rows than n, or several rows each saying "(n)" → **n for now**, plus a blocking `schedqty:` question showing both readings. The answer is enforced.
- **Tests:**
  - "BATT CHGR (5)" + 4 plain rows → **5** with no question (was 9);
  - two circuits "EF (2)" → 2 for now, asked "2 or 4"; answering "4" is enforced;
  - "(2)" on one of 3 circuits → asked.
- Kissimmee is unchanged: its Panel B rows are plain "BATTERY CHARGER", so battery chargers stay 5.

### S19: the at-host question needs matching circuits
- The counter may report the circuit tag at a symbol as a 5th mark element ("A-31", or "" when none — never guessed).
- The tag is normalized (A-31 = A31) and carried through:
  - the overlap de-duplication;
  - the viewport resolution;
  - `count_result.marks`;
  - the supplement pass.
- The "same outlet on two sheets?" question is asked only when the two circuits match, or when neither mark shows one.
- **Kissimmee** (checked on the renders):
  - E-1's "duplex outlet at deck" is **A-31** (CCTV MONITOR);
  - checkout pole #2's leader says **A-29** (CK OUT REG & PRN);
  - so the question is gone.
  - The fixture's counter now reports those two tags.
  - Review items: **22 (16 blocking)**.

### Kissimmee fixture after fix round 3
- Receptacles: **33** traceable, unchanged:
  - SIMPLEX 9 drawn + 1 typical;
  - DUPLEX 4 drawn + 8 typical;
  - GFCI 7;
  - WP GFI 4.
- Site poles / heads: **3 / 4**.
- Battery chargers: **5**; the other equipment is 1 each.
- Baseflex: **3** (expected 8).
- Review items: **22 (16 blocking)**. The drop from 23 (17) is the removed A-31 question.

### Tests (fix round 3)
- `tsc --noEmit` is clean.
- **Targeted runs:** `src/ai/**`, `kissimmeeEvidence`, `takeoffCountingPipeline`, `aiCountMarkers`, `supplementPass` and `evalCasesMigration139` — **569/569 passed** after the supplement-test title change.
- **One full backend run:** **2050 passed, 3 failed, 4 not run of 2057** (190 files: 187 passed, 2 failed, 1 lost to "Worker exited unexpectedly"). The failures are the known flakes: `intakeSimilarCache` ×2 and the `integration` lead follow-up backfill timeout. The crashed worker's 4 tests are the 4 not run.
- The frontend was not touched this round, so it was not re-run.

## Fix round 3 — Parts 4–5 (review "Round 2", 3c66503)

**Executor:** Sonnet 5. **Scope:** B10, B11, S16, S18, and the S6 nit (a copied line must not carry the
placeholder reason). Opus's Fix round 3 / Parts 1–3 (B12, S15, S17, S19, the migration-138 nit) is committed
through 063a1ba; this round starts from there. Same rules: worktree only, no Agent tool, no real API calls,
migrations from **140** (none were needed — every fix here is logic-only, no schema change). Every
reproduced finding's repro is a test.

| Commit | Findings |
|---|---|
| ae5ef2a | B10, B11 — gap-fill/reconcile never zero a type; a multi-type finding answers per type |
| aa42832 | S18 — gap-fill's suggested markers cleared on re-run/reset, can't be confirmed twice |
| ba74056 | S6 nit — a copied line never keeps the placeholder reason |
| af1aed3 | S16 (backend) — equipment never resolved in bulk |
| 5e151df | B10, B11, S16 (frontend) — per-type UI rows; equipment excluded from every bulk path |

### B10 — gap-fill/reconcile never offer "not on this job"
The Round 2 repro: a GFCI type has 7 counted; gap-fill suggests 2 more that turn out to be dimension ticks;
answering the old `gapfill:` item's "Not on this job" nulled the WHOLE type (7 → 0), because
`enforcedCounts` mapped `action:'not_on_job'` straight to `null` for these items exactly like a real
"not on this job" count item.

- `gapfill:`/`reconcile:` items never carry `not_on_job` in their `actions` any more. Their three actions
  are exactly:
  - `'markers'` — **"Confirm the found marks on the plans"** (gap-fill only — a jump to its own SUGGESTED
    markers in the Plans view, then "Use confirmed markers" resolves it);
  - `'confirm'` — **"No more on this job — keep current count N"** — rejects the suggestion/mismatch,
    keeps the type's CURRENT count exactly (never `null`), and — for a gap-fill item — deletes that type's
    own SUGGESTED `source:'gap_fill'` markers so a rejected suggestion never lingers to be confirmed later
    (this is also half of S18);
  - `'count'` — **"Enter correct count"**.
- They're structurally excluded from the cross-item multi-select (its checkbox is gated on
  `actionsOf(item).includes('not_on_job')`, which is no longer true) and the group "mark all N not on this
  job" bulk button (same gate) — there's no code path left that could broadcast a `not_on_job` to one of
  these items at all.
- **Test:** the reviewer's exact repro (GFCI 7, 2 suggested marks rejected) — `enforcedCounts` stays at
  **7**, never `null`, never 0.

### B11 — a multi-type finding answers per type, in the type's OWN unit
The Round 2 repro: S1 (2 poles × 1 head) + S2 (1 pole × 2 heads) = 4 heads. A schedule reconciliation for
"S1+S2" resolved with "count 5" turned **3 poles into 5 poles** while heads stayed untouched — the old
`byMemberKey` map pointed every key in "S1+S2" at the SAME item, and always wrote to the type's plain
`count`, never `:heads`, even though the finding's own basis (2.2/B2's `actualUnitsOf`) is heads for a
site_lighting type.

- `ReviewItem.reconcileMembers` — one entry per type a finding covers (`{key, type, description, unit,
  currentQty, headsPerPole, resolution}`), always present, even for a single-type finding (n=1). Each
  answers separately via `applyReconcileMemberResolution` (the same per-member pattern B6 already
  established for legend-zero groups): the item's own `resolution` mirrors the ONE member directly when
  there's no ambiguity (n=1); with 2+, it only appears once every member has answered.
- **The unit an answer is IN follows the finding's own basis**: `'heads'` for a site_lighting type,
  `'count'` otherwise. A heads answer re-derives poles ONLY when the fixture schedule states
  heads-per-pole, and only as an EXACT multiple (validated: a non-multiple leaves poles untouched rather
  than silently rounding); when heads-per-pole is unknown, poles stay exactly as directly counted from
  the plans — never guessed either way.
- **A broadcast is refused, not guessed at:** `'count'`/`'markers'` on a 2+-type finding REQUIRE
  `memberKey` — omitting it 400s ("This covers N types — answer each one separately"). Only `'confirm'`
  (no shared number — each type just keeps its own current value) may still apply to every unanswered type
  at once, matching B6's "apply to all unanswered" shortcut.
- The marker tally for a `'markers'` resolution is now tallied on the ONE requested key
  (`confirmedMarkersForType(bidId, memberKey)`), never summed across every type the finding names and
  handed to each (`takeoffReview.ts`'s own half of the B11 bug).
- **Tests:** S1+S2 answered per type gives the correct total (heads set directly, poles re-derived when
  known: 3 heads / 1 per pole → 3 poles; 4 heads / 2 per pole → 2 poles); a non-multiple heads answer
  leaves poles untouched; a headsPerPole-unknown type leaves poles untouched; the all-reject path keeps
  each type at its OWN current value; a broadcast attempt on a 2+-type finding → 400; a single-type
  finding needs no `memberKey` and its `item.resolution` still mirrors directly (no behavior change for
  the common case).

### S16 — equipment can never be zeroed by a bulk action
- **Backend:** a multi-item `/review/resolve` call 400s outright — **"Equipment is never resolved in
  bulk — answer each one on its own"**, naming them — the instant ANY picked item is `category:'equipment'`,
  whether or not the rest of the batch would otherwise be a legal one-group bulk action. The exact same
  item resolved alone (`itemIds` of one) is unaffected.
- **Frontend:** equipment items are excluded from BOTH bulk paths entirely — the zero-count group's
  "mark all N not on this job" pool (`nojIds`/`confirmIds`), and the cross-item multi-select (no checkbox
  at all, same treatment B6 already gives a legend-zero group). Whatever bulk action remains (2+
  non-equipment items) now goes through the SAME confirm-dialog-listing-every-member gate B6 put on
  legend-zero's "mark all remaining" shortcut — extended here to the ordinary zero-count group bulk and
  the cross-item multi-select bar too, not just legend-zero groups.
- **Tests:** backend — a mixed batch (2 equipment + 1 non-equipment) 400s and resolves nothing; two
  equipment items alone still 400; an equipment item alone still works; a non-equipment-only bulk is
  unaffected. Frontend — no checkbox on an equipment item; the group bulk button disappears when only 1
  non-equipment item remains eligible; a mixed group's confirm dialog names only the non-equipment
  members; an equipment item still resolves fine on its own row.

### S18 — gap-fill's suggested markers are cleared on re-run/reset, never confirmed twice
The three places that clear a stale SUGGESTED marker before writing a fresh set
(`writeAiCountMarkers`'s full and scoped/supplement passes, `assignAiMarkersToLines`) and the rerun-reset
service only ever matched `source = 'ai_count'` — a `gap_fill` suggestion from an earlier run was never
cleared, so a stale one from a prior run could sit in the Plans view next to the current run's, and an
estimator confirming both would double it.

- All four now match `source IN ('ai_count', 'gap_fill')`, exactly like the counter's own suggestions.
- **Test:** two runs each write one gap-fill suggestion for the same finding; the second run's write
  clears the first's (soft-deleted, gone from every live query, and never returned by
  `assignAiMarkersToLines`); confirming everything still live and resolving the item ends at the type's
  own 4 marks plus exactly the ONE remaining suggestion (**5**, never 6) — proven end to end through the
  real `/review/resolve` route.

### S6 nit — a copied line never keeps the placeholder reason
The placeholder was cleared only when a line's qty moved AND a prior row with that `line_key` existed. A
line with NO prior row at all (a fresh `line_key`, never saved before — exactly what a line
duplicated/copied in the UI produces) fell through untouched, keeping the placeholder — and so kept
passing the evidence gate — even though it never legitimately earned the migration-134 grandfather clause.

- The placeholder is now legitimate ONLY when a real prior row with this exact `line_key` already exists
  AND its qty matches; a fresh `line_key` with no prior row clears it immediately, same as a changed qty.
- Updated the existing S6 test to actually simulate a genuine prior row (written directly, the way
  migration 134's own raw UPDATE would, never through `saveBidEstimate`) — matched by the same `line_key`
  and qty, it still passes. Added the nit's own repro: a brand-new `line_key` sent with the placeholder on
  its very first save, even with a "matching" qty, clears it immediately.

### Kissimmee fixture after fix round 3 (Parts 4–5)
Unchanged from Opus's Parts 1–3 numbers — Kissimmee currently has zero reconciliation findings (B2's
heads-fix) and no equipment-bulk scenario exercised, so none of B10/B11/S16/S18 touch its own counts:
**receptacles 33, GFCI 11 (7+4), site poles/heads 3/4, battery chargers 5, review items 22 (16 blocking)**.

### Test suites (targeted, plus one full run each at the end)
`tsc --noEmit` is clean in both packages.

| Suite | Fix round 3 / Parts 1–3 baseline | This round (Parts 4–5) |
|---|---|---|
| Backend `npm test` | 2050 passed, 3 failed, 4 not run of 2057 (190 files) | **2062 passed, 3 failed, 4 not run of 2069** (190 files: 187 passed, 2 failed, 1 lost to "Worker exited unexpectedly") |
| Frontend `npx vitest run` | not touched, not re-run | **1315 / 1315** |

The 3 backend failures are the same known flakes carried since the original review baseline:
`intakeSimilarCache` ×2 (a global cache-signature race under full-suite contention against this worktree's
long-lived, heavily-populated test database) and the `integration` lead follow-up backfill timeout — none
of the touched files (`reviewItems.ts`, `takeoffReview.ts`, `aiMarkers.ts`, `rerunReset.ts`,
`bidEstimate.ts`, `TakeoffReviewPanel.tsx`) are anywhere near intake or lead code.
