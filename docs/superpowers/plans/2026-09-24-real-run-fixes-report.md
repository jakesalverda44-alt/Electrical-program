# Real-run fix round — AutoZone #10077 Kissimmee (live Opus run, 2026-09-24)

**Branch:** `fix/real-run-kissimmee` (worktree `../Electrical-program-wt-realrun`), from main `8724d30`.
**Executor:** Opus 5. **Date:** 2026-09-24. Not pushed. Local Version untouched. No Anthropic / Drive /
email calls, no dev servers, the eval never run against the API, the live `electrical_crm` DB never
read or written (the run's exported JSON only). No migrations (the next free number is still **140**).

| Commit | Task |
|---|---|
| 3d56bb6 | 1 — referenced sheets must be sheet numbers of this set (+ the committed real-run fixture) |
| f497828 | 2 — type synonyms consolidated into canonical entities (+ the replay harness) |
| 47828fc | 3 — power-pole legend packages expand, times the drawn poles |
| c05c93e | 4 — panel schedules: the unread "panels" were drawings; incomplete reads re-read side by side |
| 89bb629 | 5 — dense-sheet consistency pass on a shifted tile grid |
| b5fe613 | 6 — the replayed live run's review list: 46 blocking → 14 |
| (last) | This report (+ a type-only fix to the task-5 frontend test) |

## How the acceptance test works: the live run, replayed

`backend/src/test/kissimmeeLiveReplay.test.ts` runs the **real counting stage** on the live run's own
outputs (`fixtures/realrun/kissimmee-live-2026-09-24.json`, JSON excerpts of the exported run:
Agent 1's output, the page inventory, the count result, the 53 review items). Nothing is transcribed
and no model is called:

- **The counter** is answered with the live counter's own 226 marks (plus the 2 it placed and the
  enlarged-plan rule later excluded), each reported in every tile containing it, with the circuit tag
  the live counter read. A mark is reported under the key the fixed code asks for: an alias folded by
  consolidation is reported as its canonical entity; a name no longer asked for is not reported.
- **The evidence readers** are answered from the live run's parsed output through the evidence cache:
  the counted sheets' viewports, all 8 typical packages, all 9 schedule tables. That is the same path
  a re-run of unchanged files takes in production.
- **Agent 1's quantities** are restored to what the counting stage first received. The stored output
  is post-merge, so the counted rows come out and the live merge's `removedRows` go back in.
- **The plan set** is a blank raster set with the real sheets' geometry, so tiles and positions are
  the real ones.

**Fidelity check (asserted).** Every type nothing fixed comes back exactly as live: A 70, B 45, M 6,
C 2, G 10, E 13, F 4, J 5, D 5, L 1, S1 2, S2 1, GFCI 7, WP GFI 4, FLEX+J 3, M1 2, battery chargers 5,
DISCON A/B, MINI-TUNE.

**Limits, honestly:**
- E-4 and E-5 were evidence-only sheets, so the run stored their viewports only as tables. The
  replay rebuilds their schedule viewports from those tables; E-4's rectangles come from the evidence
  round's measured transcription of the real sheet.
- Spec pages 136–138 are blank here. They had a text layer live, and they gave no viewports either
  way.

## 1. Referenced sheets (13 blocking items → 0: 12 spec sections gone, SGN101 information)

**Why.** Agent 1's `missingSheets` cites spec sections: "Spec 16050 …", "Spec Section 16480 …",
"Structural drawings (referenced Sec 01410 3.09)". The old extractor took the first
`letters+digits` run anywhere in the string, which read "pec160", "ion164" and "Sec014" out of the
middles of words.

**Fix** (`reviewItems.referencedSheetItems`, `sheetIdCandidates`):
- Candidates are **whole tokens only**.
- A 5–6 digit number, an "xx xx xx" number or a SECTION / SPEC / DIV citation is never a sheet.
- A missing id must match the **sheet-number pattern learned from this set's inventory**, the sheet
  check's B1 rule. The route now passes that pattern.
- "SGN101 Sign Vendor Foundation Drawing" does not have this set's shape, so it is listed as a
  non-blocking information item ("another party's drawing"). It is never dropped.

**Tests** (`realRunRefs.test.ts`) run on the real `missingSheets` strings: 0 blocking, SGN101 as
information, every spec string yields no candidate, and a real E-8 still blocks.

## 2. Type consolidation (`ai/evidence/consolidate.ts`)

**When.** This runs before counting and review, switched by the evidence round like the rest of it.

**Identity signals:**
- **Tag tokens.**
  - "RTU-1/RTU-2" = RTU-1 + RTU-2; a combined tag is never a type of its own.
  - An un-numbered base (RTU, PP) is the class of its numbered members.
  - Numbered siblings are always distinct: PP#1/PP#2, DISCON A/B, M1/M2.
- **Schedule-row identity.**
  - The circuits a description cites, on a known panel. "CMR-9" is a sensor model, not circuit 9.
  - The same circuits mean the same load: PYLON = PYLON SIGN (A-18); LCP = ALC PANEL (B-25).
  - A circuit set that is exactly the union of other types' sets is those types combined: SIGN-JB
    (A-6/14/16) = FRONT WALL SIGN + SIDE WALL SIGN.
- **Normalized description.**
  - An abbreviation's expansion appears in the other's description: EF = "exhaust fan", EWH ⊇ WH
    "water heater", ALC = "automatic lighting control".
  - Or a head phrase does: "lighting contactor enclosure".
  - Receptacle qualifiers must agree both ways. DUPLEX = the duplex/floor receptacle, never the
    handy-box one.
- **The legend's tag range.** "POWER POLE TAG 1-6" is the host marker of PP#1–#6.

**Guarantees:**
- **Never doubled.**
  - Every alias stays on the list as a `merged` type with its reason, and is kept as evidence on its
    canonical entity (`aliases`).
  - An alias is never counted, never a line and never a zero item. Its count is never added.
  - RTU is **2**, where it was 1 + 1 + 2 = 4.
- **Never silent.**
  - A generic **legend** symbol that matches 2+ entities, or a class symbol drawn on the legend
    (Motion sensor vs M1/M2; T vs T-1/T-2; P vs PP#1–#6), is counted first.
  - If none is drawn, it folds.
  - If its marks sit on a candidate's marks, it raises one `synonym:` question. The answer is
    enforced: "the same device" leaves no line.
  - If its marks are elsewhere, it is a different device. The real "Motion sensor" mark on E-3 is far
    from every M1, so it is kept.
- **Canonical choice.**
  - Priority: an equipment-schedule type that cites its circuits (its row owns the quantity), then any
    type citing circuits, then the drawn legend symbol.
  - The canonical names its aliases for the counter.
  - It inherits an alias's stated trade assignment.

**Also fixed on the way:**
- `circuitRefs` read "ckt A-6, 1,220VA" as A-6, A-1 and A-220.
- The legend shorthand "(AutoZone furn, HVAC install, EC wire)" now reads as another trade's install
  with APT connecting, so EF is information, per Decision 4.

**The effect on the real run.** 9 of the 24 blocking zero items were only another name:
ALC, EF, LCP, POWER POLES, PP, PYLON, RTU and SIGN-JB fold, and T folds after the count. 5 more had
schedule rows that a synonym had made ambiguous (two targets named the row, so nobody owned it):
ALC PANEL 1, WH 1, FRONT WALL SIGN 1, SIDE WALL SIGN 2 and PYLON SIGN 1 are now counted from Panel A
and Panel B.

**Tests** (`consolidate.test.ts`) use the real type list and the real tables.

**Old fixture.** The earlier fixture (`kissimmeeEvidence.test.ts`) now folds LCP into ALC (B-25): its
review list goes 22 → 21, blocking 16 → 15. The assertions were updated with that reason.

## 3. Power-pole typicals: why nothing expanded, and the fix

**Why, from the live data.** `count_result` typicals for PP#1…#6 all had status `assembly`,
expanded 0:
- **(1) The binding.** The typicals reader bound each pole package to its PP#n type (Agent 1 had
  listed the poles as equipment). The S1 "host's own assembly" rule then swallowed the outlets of any
  counted host whose description shares words with the quote.
- **(2) Circuits counted as poles.**
  - PP#1 was 3 and PP#6 was 2, because each Panel A circuit their own descriptions cite counted as
    one pole.
  - PP#3's 2 was right only by coincidence.
- **(3) The tester pole.**
  - Its tag (B20,24) was counted under the legend's "POWER POLE TAG 1-6".
  - So PP#4 was zero and its hostCount was null.
- **(4) Device keys.** They pointed at "DUPLEX", a zero synonym (fixed by consolidation).

**Fix:**
- **Equipment hosts.** An **equipment** host (a pole, a counter, a kiosk) never swallows the devices
  on it. The device-symbol baseflex (FLEX+J) stays an assembly.
- **Cited circuits.** Rows owned only through the circuits a target's description cites feed **one**
  item. "(2)" parts pods is still 2.
- **Pole tags.**
  - Each tag mark binds to the one member whose circuits it carries: PP#2 A29, PP#3 A33 and A35,
    PP#4 B20,24, PP#6 A40,42.
  - This happens before any viewport rule.
  - A tag with no circuit stays with the legend and is never guessed.
- **The same pole drawn twice.** Pole #2 appears on the main plan and on #11 with the same A29, so it
  counts once. This applies to equipment only; receptacles share circuits. (The #11 area the live
  viewport reader gave was too small to catch the repeat.)
- **Unchanged rules.** Subtract-drawn-at-host and never-guess are unchanged. A host whose own tag is
  unbound is looked for at its family's unbound tags, but only for the "drawn nearby" information.

**Replayed** (each expansion carries its quote):

| Host | Pole count | Outlets per pole | Outlets added |
|---|---|---|---|
| Office pole | 1 | 2 duplex, plus floor simplex (quantity not stated) | 2 duplex; the simplex is 5 drawn on #11, information |
| Checkout pole | 1 | 1 duplex | 1 duplex |
| Parts pods | 2 | 1 duplex | 2 duplex |
| Tester pole | 1 | 1 simplex + 1 duplex | 1 simplex + 1 duplex |
| Counter pole | 1 | 2 duplex | 2 duplex |
| **Total** | | | **8 duplex + 1 simplex** |

The PP#4 zero item is gone.

**Receptacles**

| | Live | Replayed |
|---|---|---|
| Simplex | 8 | **9** (8 drawn + 1 at the tester pole) |
| Duplex / floor | 6 | **14** (6 drawn + 8 at the poles) |
| GFCI | 7 | **7** |
| WP GFI | 4 | **4** |
| **Total** | **25** (+ FLEX+J 3) | **34** (+ FLEX+J 3) |

**Plausibility against Chris's 38** (GFCI 16, duplex 11, single 8, decorator 3):
- Duplex + decorator 14 = our 14.
- Single 8 against our 9.
- The whole gap is **GFCI 11 vs 16**. It is the open audit question carried since the evidence round;
  the other 5 are not drawn on E-1.

## 4. "Panel schedules not read completely"

**Why.** Both real panel schedules were read completely: E-4 Panel A and Panel B, 42 rows each, odd
1–41 and even 2–42, no gap. The blocking item came from two E-5 viewports that the viewport reader
classed as schedules because their titles say PANELBOARD: "PANELBOARD - DIAGRAM" and "PANELBOARD -
MOUNTING HEIGHT SECTION". The table reader rightly found no rows in them.

**Fix:**
- A panel's diagram, section, elevation, detail, riser, one-line, schematic or mounting drawing is no
  longer an expected panel schedule (`isPanelScheduleTitle`).
- **The reader, made sturdier.** A vision read of a panel that comes back incomplete (one side only,
  or circuits skipped) is read again **side by side**:
  - one call for the odd circuits and one for the even, both cached;
  - the reads are merged by circuit number (`mergePanelReads`);
  - circuits that are still missing keep the panel incomplete.

**Tests** (`realRunPanels.test.ts`) use the real page-52 crops: the raster E-4 page carries the four
real Panel A / Panel B crops at their positions, and the reader renders its crops from it.
- The replies are the live run's own transcription.
- The first Panel A reply is that transcription cut to its odd side, which is the failure mode,
  simulated.
- The result: 42 rows, complete, `sidesRead`. Panel B is never re-read.
- Every Panel A request carried the real crop: it has ink and the viewport's shape.

**Replayed:** no panels-unread item, and the branch-circuit rows come from both panels.

## 5. Dense-sheet consistency pass

**What triggers it.** A type counted 20+ times on one sheet, or flagged hard to read.

**What it does:**
- The type is counted a second time on a tile grid **shifted by half a tile**
  (`planOffsetTiles`, ids `SR#C#`).
- Only those types, and only the shifted tiles over their marks, are sent.
- The two passes are reconciled **by location** (nearest-first, one-to-one, within 0.4"):
  - marks both passes found are counted;
  - marks only one pass found become **suggested markers** plus one blocking `consistency:` review
    item. They are written like gap-fill's, cleared the same way on a re-run, and never auto-counted.
    The item is answered type by type: confirm the marks, keep the counted number, or enter the count;
  - the agreement rate is reported per type.
- **Safeguard.** Passes that agree on under 50% are no check on each other. The first pass stands,
  unconfirmed and flagged, and nothing is dropped or suggested on its word.
- It is switched by the evidence round. Off means exactly one pass, as before.

**Replayed on real data.** The second read is the **earlier real Opus run** of the same E-3 (the
baseline's 73 / 52 marks).
- It is a real second reading, but not one made on a shifted grid, since no model can be called
  here.
- A: 70 / 73, 70 agree (**96%**), 3 suggested.
- B: 45 / 52, 45 agree (**87%**), 7 suggested.
- Counts stay **70 / 45** with **10 suggested markers**. Confirming them gives the earlier run's
  73 / 52.

**Mocked-pass tests** (`consistency.test.ts`) cover:
- agree / only-first / only-second;
- one-to-one matching at the real 44 pt fixture spacing;
- the threshold and the density flag;
- the shifted grid's edges and bounding;
- a failed second pass, which keeps the first and notes it;
- an inconclusive pass;
- the review item and its enforced per-type answers.

**Cost.** One extra counter call on **4** shifted tiles (of the shifted grid's 20).
- Estimated from the real tile images sent (image tokens) plus text, and ~25 output tokens per mark
  plus 1,500 of reasoning.
- That is **~19.9k input / ~5.2k output**, about **$0.18 per bid on Opus 5.5** for this set.
- Allow **$0.15–0.30** depending on thinking. It scales with the number of dense sheets, not the set
  size.
- This is an estimate; no call was made.

**The panel side re-read** costs nothing on Kissimmee (both panels were complete). When it fires, it
is 2 calls per incomplete panel, about $0.15 each on Opus 5.5 (estimated).

## 6. The review count on the replayed live run

Three blocking items were not real questions, and each has a test for the case that stays one:
- **The photometric pole spec.** "25' 5in square steel pole, dark bronze, 3' conc base" × 3 is the
  counted poles (S1 ×2 + S2 ×1) when its quantity is exactly theirs. Another quantity is still held,
  and so is a base row.
- **The notes restatement of the baseflex outlet** at FLEX+J. It is part of that host's own legend
  assembly. Alone, an unstated quantity is still asked.
- **"Two 209W fixtures per site pole, typically."** It restates the heads the fixture schedule states
  per type (4). It becomes an information note with both numbers. Without schedule heads it still
  blocks.

| Group | Before (live): blocking / total | After (replay): blocking / total |
|---|---|---|
| zero-count types | 24 / 24 | **8 / 8** |
| referenced sheets | 13 / 13 | **0 / 1** (SGN101, information) |
| unscheduled rows | 3 / 3 | **1 / 1** (pole concrete base) |
| scope questions | 3 / 3 | 3 / 3 |
| legend-zero group | 1 / 1 | 1 / 1 (7 non-equipment members) |
| typical | 1 / 1 | 0 / 0 |
| schedule (panels unread) | 1 / 1 | 0 / 0 |
| consistency (new) | — | 1 / 1 |
| information | 0 / 2 | 0 / 3 |
| photometric | 0 / 3 | 0 / 3 |
| spot-check | 0 / 2 | 0 / 2 |
| **Total** | **46 / 53** | **14 / 23** (goal ≤ 15: met) |

**The 14 blocking items**, every one a real question:
- **8 equipment types, each its own item:** METER BASE, WIREWAY, CT/SERVICE CABINET, DATA CONC,
  T-1/T-2, AIM, QC, CF.
  - These are one-line, detail and closet items no reader reads.
  - CF appears only on the E-3 lighting plan.
- **The consistency check** (A / B).
- **The legend-zero group:** handy-box duplex, K, M2, N, photocell, open/close pushbutton,
  quadplex. No equipment.
- **The pole concrete base.**
- **3 scope questions.**

**Asserted as well:**
- Every zero equipment type is its own item.
- Every alias is on the list with its reason.
- ALC PANEL carries ALC / LCP / LIGHTING CONTACTOR ENCLOSURE as evidence.
- EF, SGN101 and the 209W note stay visible as information.

## Test suites (one full run each, at the end)

`tsc --noEmit` is clean in both packages.

| Suite | Baseline (fix round 4) | This round |
|---|---|---|
| Backend `npm test` | 2070 passed, 3 failed, 4 not run of 2077 (191 files) | **2118 passed, 3 failed, 4 not run of 2125** (198 files: 195 passed, 2 failed, 1 lost to "Worker exited unexpectedly") |
| Frontend `npx vitest run` | 1315 passed, 1 failed of 1316 | **1317 / 1317** (128 files) |

The 3 backend failures are the known flakes that every earlier report lists: `intakeSimilarCache` ×2 and
the `integration` lead follow-up backfill timeout. None is in code this round touches. The worker crash
loses 4 tests, the same pattern as before.

**New tests, backend:**
- `realRunRefs` 5;
- `consolidate` 9;
- `realRunPoles` 5;
- `realRunPanels` 4;
- `consistency` 10;
- `realRunReview` 6;
- the replay acceptance test 9;
- `kissimmeeEvidence` updated in place (LCP folded; its fake counter answers the shifted tiles).

**New tests, frontend:** 1 (the consistency / synonym groups).

## Deferrals / limits (honest)

- **No live call validated the two new prompts:** the odd/even side read and the consistency-pass
  note. As in every round, the next real run is the test. The eval prints the real cost.
- **The consistency pass's second read** in the acceptance test is the earlier real run, not a
  shifted-grid read of the same model.
- **Thresholds.** The ≥ 20 per sheet threshold and the 0.4" agreement radius were set from these two
  real reads. Real fixtures here are ≥ 44 pt apart, and the two runs' marks were ≤ 25 pt apart.
- **GFCI 11 vs Chris's 16** is still open. That makes receptacles 34 against 38.
- **CF (ceiling fans)** is drawn only on the lighting plan, so the equipment anti-focus rule leaves
  it a zero item. It is kept blocking rather than counted from the lighting plan, because the two
  real runs disagree: 2 against CF1-CF3 = 3.
- **T-1/T-2 "(2) thermostats"** is not auto-counted from Agent 1's text. It stays a question.
- **The tag binding** needs the counter to read the circuit at the tag.
  - The office pole #1 and the pipes #5 had none.
  - So #1's count comes from its schedule rows, and #5's from #11.
  - A tag that fits several members, or none, is never guessed.
- **Uncertain synonyms.** A generic legend symbol drawn somewhere else is kept as a different device,
  with only a flag. No question is asked unless its marks coincide with a candidate's.
- **Replay limits:** the E-4 / E-5 viewports are rebuilt from tables, and the spec pages are blank
  (see above).
- **The frontend** shows the new `consistency` / `synonym` groups with their titles and per-type
  controls (the existing `reconcileMembers` UI). There is no dedicated Plans-view filter for the
  consistency suggestions; they appear as SUGGESTED markers, created by "Consistency check".

---

## Fix round (review `2026-09-24-real-run-fixes-review.md`, 361f259 — MERGE AFTER FIXES)

**Executor:** Opus 5. Same worktree and rules: no Agent tool, no real API calls, no live DB, no
migrations needed (the next free number is still **140**; `consistency_accept` needed no schema change,
`event_kind` is free text). Each repro is now a test.

| Commit | Findings |
|---|---|
| c5b032b | B1, S8, N3 — the consistency pass never lowers a count without a human |
| 5415497 | B2, B3, N4, S2–S7 — consolidation needs direct evidence; generic names never bridge |
| 465c1b6 | S1 — one receptacle under two class names on two sheets counts once |
| a610493 | S9 — real sheet references are never dropped or downgraded |
| 6cde742 | S10, S11, N2, N5 |
| ae1fc79 | S12 — a supplement over a pre-consolidation run never doubles |
| 563f9cc | N1 + the replay's new numbers + the frontend class-conflict group |
| (last) | This section |

### Blockers

**B1 — the consistency pass never lowers a count.**
- Pass 1's marks stay counted, whether the second pass re-found them or not. Agreement only raises
  confidence.
- Marks only pass 2 found are SUGGESTED (possible additions).
- Pass-1 marks pass 2 did not re-find stay counted and are listed as "not re-seen".
- Agreement is re-found ÷ pass 1.
  - Under 85% (strictly), a **blocking** item shows both counts and the disagreeing marks.
  - "Keep the counted number" keeps pass 1's.
- Test: 70 counted, 50 re-found → **70** plus the blocking item. The 50%-cliff "inconclusive" rule is
  gone.

**B2 — no transitive linking.** A merge needs direct pairwise evidence between the two types. Any one
of these counts:
- a shared tag (PYLON / PYLON SIGN, ALC / ALC PANEL, EWH = WH = "water heater");
- a tag that abbreviates the other item. For LCP this is "lighting control panel" on the same circuit
  B-25; without shared circuits, the abbreviation must be the other's whole core;
- the same core words;
- a legend symbol restating it.

How the evidence is used:
- Items that cite their own circuits merge as cliques only.
- A name without circuits folds into the one entity it matches.
- A name that matches two or more distinct entities, or that bridges two names which don't match each
  other, is **generic**.
  - It is counted and decided by its marks (the uncertain path).
  - It never owns or blocks a schedule row.
- Tests:
  - FRONT and SIDE wall sign plus a "Wall sign" legend stay **3**;
  - a kitchen exhaust fan never folds into EF through an "Exhaust fan" legend.

**B3 — letter-suffixed tags are numbered siblings.** This covers EF-A / EF-B, WH-A, DISCON-A, "EF A"
and P-1A. They stay distinct even with identical descriptions: EF-A / EF-B → **2**.

### Should-fix

**S1 — B-32 is one receptacle.** Plain receptacles of different classes are paired across sheets when
all of these hold:
- they coincide after the sheets are aligned;
- they carry the same circuit tag;
- the pair is unambiguous. The reach is 0.75", or 1.0" through an enlarged plan's hand-read area; the
  real B-32 pair is 0.59" apart.

The main plan's mark is kept (DUPLEX on E-1). An enforced class-conflict question asks which class it
is. **Receptacles 34 → 33.**

**S2 — combined tags citing circuits.** A combined tag counted from the circuits it cites is one per
member: "RTU-1/RTU-2" → **2**.

**S3 — combined tag parsing.**
- "RTU-1/2/3" and "RTU-1 & 2" are parsed.
- Members that are not listed are created, so they are counted or asked about. They never stack on
  the members that are present.
- A "(n)" that differs from the member count is a blocking `combined:` question.

**S4 — distinct loads stay separate.**
- Equal circuits are necessary, never enough.
- Circuits a description "controls", "serves" or is "for" are not its own.
- Only neutral modifiers ("electric") are ignored.
- These stay separate: a circulating pump, an instantaneous water heater, a hood interlock, an ice
  machine on the drink machine's circuit, a contactor for the pylon sign, and a time clock controlling
  the signs.

**S5 — circuit parsing.**
- `circuitRefs` drops a continuation number that is followed by a unit or count word ("A-6, 180 VA",
  "3 phase", "3 fixtures").
- Circuits are capped at 84.
- Consolidation needs the drawing's panel list. T-1, SP-1 and P-4 are never circuits without it.

**S6 — generic symbols against schedule-owned types.** A generic symbol whose candidates have no marks,
or are schedule-owned, becomes a `synonym:` question. Six "P" marks never stack on the PP#n quantities.
With none drawn, the symbol is folded as information.

**S7 — "The same device" answer.** It drops only the coinciding marks; the rest keep their own count.

**S8 — consistency mechanics:**
- **Matching.** Maximum one-to-one matching. The radius is 0.75 × the type's median nearest-neighbour
  spacing, clamped to 0.2–0.5". A jittered 70-mark read at ±15 pt is re-found 70 / 70.
- **Failures.** A truncated or failed second pass is skipped, with a non-blocking warning item. It
  never fails the run.
- **Viewports.** Suggestions obey the viewport rules: plan viewports only.
- **Confirming.** "Confirm the found marks" **adds** the confirmed consistency suggestions to the kept
  count (tested against the DB: 4 + 1 confirmed = 5).
- **Tile size.** The pass reads at the retry's 6.4" tiles.
- **Supplement pass.** It keeps the check, and so its answer.
- **Caps.** 3 sheets and 16 shifted tiles per sheet, with one cover per type.
- **Caching.** By sheet hash + types + tile size + prompt version (`cs1`).

**S9 — sheet references.**
- Only the text before or at an id marks it as a spec citation. "E-9 (Div 16)" and "Sheet E-8 SECTION
  2" keep the sheet.
- A known discipline prefix is a sheet of this job whatever its digits. A missing M-101, P-201, A-201
  or E-101, and "E4.1" or "Refer to sheet E8", stay blocking.
- Only an explicit vendor's or third party's drawing is information (SGN101).

**S10 — the pole-spec rule.** It removes a row only for a light pole. It never removes a flag, camera,
CCTV, banner or sign pole.

**S11 — two downgrades reversed.**
- The 209W note is information only when its per-pole number equals every site type's heads per pole.
  Kissimmee's note gives 6 against the schedule's 4, so it is **blocking** with both numbers.
- A zero-count type APT connects blocks. Only `aptScope: 'none'` is information, so **EF blocks**.

**S12 — supplement over a pre-consolidation run.** Remapped alias marks on top of the canonical's own
are dropped. Test: 3 shared + 1 separate gives 4, not 7.

### Nits

- **N1:** E-5's rebuilt viewport rectangles in the replay are invented placeholders; only their titles
  are used. This is documented in `replay.ts` and asserted. E-4's are measured.
- **N2:** PP#5 (the data / security pipes) is a raceway line, never a pole connection.
- **N3:** a confirmed consistency suggestion logs `consistency_accept`.
- **N4:** only the exact tag base folds a numbered family (RTU → RTU-n). "DISCONNECT" against DS-n, or
  POWER POLES against PP#n, is uncertain.
- **N5:** a notes line that restates an assembly's device is information, never swallowed. An
  "additional outlet" note is a new device and is asked about.

### The live run, replayed again

| | Live | After the first round | After this fix round |
|---|---|---|---|
| Review items: blocking / total | 46 / 53 | 14 / 23 | **17 / 25** |
| Receptacles (simplex / duplex+floor / GFCI / WP) | 25 (8 / 6 / 7 / 4) | 34 (9 / 14 / 7 / 4) | **33 (8 / 14 / 7 / 4)** |
| RTU | 4 | 2 | **2** |
| Power-pole outlets | 0 | 8 duplex + 1 simplex | **8 duplex + 1 simplex** |
| A / B | 70 / 45 | 70 / 45 (agreed marks), 3 + 7 suggested | **70 / 45 kept** (pass 1; pass 2 re-found all of them), 3 + 7 suggested |

**Per group, before → after** (blocking / total):

| Group | Before | After |
|---|---|---|
| zero | 24/24 | 9/9 (EF now blocks) |
| referenced sheets | 13/13 | 0/1 |
| unscheduled | 3/3 | 1/1 |
| scope | 3/3 | 3/3 |
| legend-zero | 1/1 | 1/1 |
| typical | 1/1 | 1/1 (the 209W heads conflict) |
| schedule | 1/1 | 0/0 |
| consistency | — | 1/1 |
| classconflict | — | 1/1 (B-32) |
| information / photometric / spot-check | 0/7 | 0/7 |

**The 3 new blocking items are the review's own decisions:** EF (APT's connection), the 209W note
(6 vs 4 heads) and B-32's class. The ≤ 15 goal of the first round is therefore no longer met: 17
blocking. Nothing was hidden to reach a number.

**The consistency pass's cost.** It now reads at the retry's smaller tiles: one call on 8 shifted tiles,
an estimated ~33k input / ~5.8k output tokens. That is **about $0.25 per bid on Opus 5.5** (estimate;
up from $0.18 at the first-pass tile size). It is capped at 3 sheets and 16 tiles each, and a re-run of
unchanged sheets costs $0 because it is cached.

### Test suites (one full run each, at the end)

`tsc --noEmit` is clean in both packages.

| Suite | Result |
|---|---|
| Backend `npm test` | **2149 passed, 3 failed, 4 not run of 2156** (201 files: 198 passed, 2 failed, 1 lost to "Worker exited unexpectedly"). The failures are the known flakes: `intakeSimilarCache` ×2 and the `integration` backfill timeout. |
| Frontend `npx vitest run` | **1316 passed, 1 failed of 1317**. The failure is the known `SurveyMarkupEditor` flake; it passed 1/1 when run alone. |

**The backend was run twice.** The first full run also failed 3 tests in `kissimmeeReviewNoise`: that
older fixture asserted the HVAC-installed fan at zero was information, which S11 now makes blocking.
Its assertions were updated to the decision: 8 blocking items, still within its ≤ 8 goal. The file
passes, and the second full run above is the one reported. `integration`'s "bad enum → 400" failed
once in the first run and passed alone and in the second run.

**New tests in this round:**
- `consistency` rewritten: 13 tests;
- `consistencyEndToEnd`: 4 (DB);
- `consolidateReview`: 13;
- `classConflict`: 3;
- `realRunRefs`: +3;
- `realRunReview`: +5;
- updated: `consolidate`, `realRunPoles`, the replay acceptance test, `reviewItems` (A6),
  `kissimmeeReviewNoise`, `kissimmeeEvidence` (its fake answers the retry-size shifted tiles);
- frontend: +1 group.

## Round 2 fixes (review 5e2b496 — MERGE, with S13–S15 before the live re-run)

**Commit:** 1921466. No migrations needed.

**S15 — confirmed consistency markers are never added twice.** "Confirm the found marks" now adds only
the confirmed markers that the **current** first pass does not already count. It uses the same matching
radius, on the same sheet. Tested against the DB: 70 + 3 confirmed = 73; a re-run that finds 72 gives
**73, not 75**.

**S14 — the class-conflict question can say "two receptacles".** It now has a third answer, "Two
different receptacles — count both", which restores the dropped mark. The answer is enforced and
tested.

**S13 — schedule rows follow the distinct-load rules.**
- A row belongs to a target only when the target explains every word of the row. Matching is
  prefix-tolerant (INSTANT = INSTANTANEOUS) and ignores neutral words.
- "INSTANT WATER HEATER" is IWH, not WH. Each unit is owned by its own row and is never counted again
  from the plans: **IWH + WH = 2**.
- A row with words that neither target has goes to nobody.

**Nits:**
- **N6:** a second-pass mark within the match radius of a counted mark is a double report, never a
  suggestion.
- **N7:** the consistency cache key carries the shifted tiles and a hash of the first pass's marks.
- **N8:** the circuit is part of the class-conflict fingerprint.
- **N9:** "A-2, 4-#12" gives A-2 only, and "E-8 thru E-10" includes E-9.
- **N10:** the pole-spec rules apply to area / site light poles only. They never apply to a bollard,
  pedestrian or walkway pole, and a stated pole height must be within 5 ft of the site fixtures'
  mounting height.

**The replayed live run:**
- 17 blocking / 25 items, unchanged.
- Receptacles 33, RTU 2, pole outlets 8 duplex + 1 simplex, unchanged.
- A / B 70 / 45 kept.
- The second pass's suggestions go from 3 + 7 to **3 + 4**. The other 3 B marks were double reports
  of counted marks (N6).

**Suites** (one full run each; `tsc` clean in both packages):
- **Backend:** 2158 passed, 3 failed, 4 not run, of 2165. The failures are the known flakes:
  `intakeSimilarCache` ×2 and the `integration` backfill timeout.
- **Frontend:** 1317 / 1317.
