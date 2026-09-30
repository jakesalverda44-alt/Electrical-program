# Price accuracy round, Builder D (AI reading v2): adversarial review

**Branch:** `fix/remodel-reading-v2`, range `a5ac9cd..61855fc`:
- D1 `7991180`, D2 `048d1b1`, D3 `d16493e` + `61c00e8`, D4 `bebfe45`;
- decisions 3 / 4 / 5 / 2: `d48f854`, `4e04b2a`, `4f069a8`, `c22c5f4`;
- the hedged-note follow-up `61855fc`;
- the reports.

**Reviewer:** Opus 5.5, 2026-09-29.
**Ground rules followed:**
- Read-only, except this file.
- No model calls, no Agent tool, no push.
- Tests ran only on `electrical_crm_test`.
- C's code (`fix/price-accuracy` @ `08e0029`) was read with `git show` only.

**How the probes ran:**
- Every probe is a vitest file in the session scratchpad. It is not committed.
- The files import the worktree's modules and are run with `--root <scratchpad>`.
- The 36th probes call the branch's own `replay36thB()`. That goes through the production `runCountingStage`, using the real 9/29b export, and `buildReviewItems`.
- Only the `mutate` / `crops` hooks change the input.

## Verdict: **NOT READY**

What is sound:
- The plumbing is careful.
- The replay is honest (see (f)).
- Kissimmee is unchanged.
- Failures fall back to the tile reading, as decision 3 requires.

Three things break the round's standing rule "never lower a count silently" on realistic input:

1. **D2 misreads line-weight rules as fill rules.** A crop answer then turns every new device into "existing", and nothing blocks.
2. **Decision 5 zeroes equipment on negated notes.** "Do not reuse existing panel" is taken as a reuse note, and so are notes about other equipment. Verified on the real 36th run.
3. **D3 auto-lowers when it registers with the wrong plan.** This happens with a typical floor, or with a mirrored regular layout, and only a non-blocking note says so.

---

## Blockers

### B1. "DARK" / "SOLID" line-weight rules are treated as FILL rules, and the crop check then lowers every new device to existing (b: no silent lowering)

**Where:** `statusCrops.ts:40`.
- `FILLED_RE = /\b(SHADED|FILLED|SOLID|DARK|HATCHED|BLACK(?:ENED)?)\b/`.
- `fillRuleOf` matches the quote alone.

"NEW WORK SHOWN DARK, EXISTING SHOWN LIGHT" and "SOLID LINES INDICATE NEW WORK" are ordinary line-weight conventions, and both become `filled = new, open = existing`. The crop prompt then asks "is the symbol FILLED or OPEN?". A receptacle drawn in heavy lines is still a hollow circle, so a correct, high-confidence answer is "open", which maps to **existing**.

`CLEAR` in `OPEN_RE` and `HATCHED AREA DENOTES DEMOLITION` (an area rule, which becomes `filled = demo, open = new`) have the same fault.

**Pure repro:**

```ts
fillRuleOf([{ status:'new', quote:'SOLID LINES INDICATE NEW WORK', rule:'' }])  // { filled:'new', open:'existing' }
fillRuleOf([{ status:'new', quote:'DARK SYMBOLS ARE NEW', rule:'' }])            // { filled:'new', open:'existing' }
```

**Production repro (36th replay):** `replay36thB({ mutate, crops: () => ({ answer: 'open', confidence: 'high' }) })`.
- `mutate` sets E1.0's quote to `NEW WORK SHOWN DARK, EXISTING WORK SHOWN LIGHT`.
- It makes every E1.0 mark `new`, which is how a tile pass reads "dark = new".
- It clears `unknownStatus`.

| | crop calls fail (tile kept) | crops answer "open" |
|---|---|---|
| duplex / GFI / 42 / WP | 14 / 7 / 3 / 2 | **0 / 0 / 0 / 0** |
| disconnect | 4 | **0** |
| demo switch / device / equipment | 11 / 1 / 8 | **8 / 0 / 0** (auto, through D3 `democompare`) |
| blocking remodel items | `statuscrop:low`, `demosuggest:DEMO-SWITCH` | only `demosuggest:DEMO-SWITCH` |

- The scope is "every item" because the rule names no kind, so 5 crop calls ran.
- 30 new devices leave the install counts.
- The only trace is the **non-blocking** item "41 existing devices shown on the plans — listed, never priced".

The D2 answers also feed D3, so the demolition lines drop too.

**Fix direction:**
- Only symbol-fill words should make a fill rule: SHADED, FILLED, SOLID-FILL, HATCHED SYMBOL, HALF-TONE SYMBOL. Line words must not: LINES, DARK, BOLD, HEAVY, LIGHT, SCREENED, CLEAR.
- A crop answer that turns a tile-pass "new" into "existing" should also be listed in a blocking item, or at least counted in one: "the close-up check moved N from new to existing".

### B2. Decision 5 auto-zero fires on negated notes and on notes about other equipment (d)

The `61855fc` follow-up handles hedges ("verify", "TBD", "if", "?"). It does not handle negation. The kind check also only asks whether the note contains the kind's noun anywhere; it does not check that the reuse words apply to that item.

Pure repro (`reuseQuoteFor(type, key, [note])`), panel = `ELECTRICAL PANEL / Electrical panel`, disconnect = `DISC-A / 60A disconnect switch`:

| Note | panel | disconnect |
|---|---|---|
| "Do not reuse existing panel" | **reused → 0 demo** | – |
| "Existing panel shall not be reused" | **reused** | – |
| "Reuse of existing panel B is not permitted" | **reused** | – |
| "Remove existing panel. Reuse existing conduit where possible" | **reused** | – |
| "Replace existing panel; existing feeders to remain" | **reused** | – |
| "Demolish existing panel B and disconnects; reuse existing panel A" | **reused** | **reused** |
| "Existing panel to be removed and replaced with new panel; existing branch circuits to remain" | **reused** | – |

**Production repro (real 36th):** `replay36thB({ mutate })`, where `mutate` rewrites Agent 1's four reuse strings:
- `quantities[0].item` becomes "Existing Panel A 200A MLO 120/208V 1PH - do not reuse, remove and replace";
- `quantities[1].item` becomes "… not to be reused, remove";
- `ecfeciItems[5]` becomes "Panels A & B existing - shall not be reused";
- `scopeNotes[1]` becomes "Remove existing Panels A & B; reuse existing service conductors".

The result is **identical to the unmodified run**:
- DEMO-EQUIPMENT is 6.
- The non-blocking `demoreuse:DEMO-EQUIPMENT` says "4 kept (Electrical panel 4) … noted for reuse → 0 demolition for them".

So 4 panels that the notes say come out are removed from the demolition line, and nothing blocks.

`reuseNotesOf` also walks every string in Agent 1, including flags, scope notes and quantity rows, and every counter note. Those are sentences with several clauses, so "the same note names the same kind" is too weak a test.

**Fix direction:**
- Void a note on negation: not / no / never / shall not / do not / n't / "not permitted", plus remove / replace / demolish in the same clause.
- Require the reuse words and the equipment noun to be in the same clause, for example split on `;` and `.` and require both within a few words of each other.
- Alternatively, when in doubt, show the note as context on the one final-count question, as the hedge path already does, rather than zeroing.

### B3. D3 registers a demolition sheet with the WRONG new-work plan and lowers it automatically (c: registration false positives)

**Where:** `registerDemolitionSheet`.
- It picks the plan with the most paired marks, needing only `paired ≥ 3` and `alignSheets(...).kind === 'marks'` (≥3 votes, ≥ half the shared minimum, offset ≤ 3").
- Nothing checks that the two sheets show the same level or area.
- Under decision 1 a registered comparison lowers the line **with only a non-blocking note**.

**Repro A, typical floors:**
- `buildDemolition([A2.1 "LEVEL 2 … DEMOLITIONS"], T, [E1.0 "LEVEL 1 POWER PLAN", E1.1 "LEVEL 2 POWER PLAN"])`.
- There are 20 irregularly placed receptacles and 4 switches.
- E1.0 (level 1) draws 18 of the same positions as existing, because the floors stack.
- E1.1 (the real level 2 plan) keeps 2 as existing and draws 10 new elsewhere.
- **Result:** A2.1 registers with **E1.0**. The line is **2** (truth 18). The only item is the non-blocking `democompare:DEMO-RECEPTACLE`: "20 shown on A2.1, 18 still shown as existing on E1.0 → 2 in the line".

**Repro B, a mirrored plan with a regular layout:**
- The demo sheet has receptacles on a regular 10 × 2 grid (x = 300 + 200·i pt, y = 400 / 900) and switches at x = 500 + 300·i.
- The plan is the same layout mirrored (x → 2592 − x), all drawn as existing.
- The mirrored grid is the original grid shifted by 192 pt (2.7" ≤ 3"), so the vote registers it.
- **Result:** a `democompare` comparison, and the line goes to **0**.
- With an irregular layout the mirror correctly fails to register, and the case goes to a blocking `demosuggest`. So the fault is grid aliasing.
- Troffer grids and receptacles spaced evenly along a corridor are exactly this kind of regular pattern. The fixture classes vote in the registration even though they are never reduced.

**Fix direction:**
- Only register a pair of sheets that have the same level / area. `CountSheet` already has `level` / `area`, and sheet titles such as "LEVEL 2" can be matched.
- Require a fraction of the demolition sheet's marks to pair, not an absolute 3.
- Reject an offset when a second offset at least one grid period away scores nearly as well (an ambiguity test).
- Until then, make a registered reduction confirm-once (blocking) whenever the demolition sheet or the plan has a sibling on another level.

---

## Should-fix

### S1. D1: a kind word used in passing narrows an unqualified rule, and the dropped statuses are never shown (a)

`conventionScope` scans the whole quote for any kind noun. It does not check which noun the rule is about:

| Quote | scope |
|---|---|
| "BOLD INDICATES NEW WORK ON LIGHTING AND POWER PLANS" | fixture only |
| "NEW WORK SHOWN BOLD. REFER TO PANEL SCHEDULES FOR CIRCUITING" | equipment only |
| "SCREENED ITEMS ARE EXISTING; SEE LIGHTING FIXTURE SCHEDULE" | fixture only |
| "(E) INDICATES EXISTING DEVICE TO REMAIN" | devices (no fixtures, no equipment) |

The four named phrasings are right:
- "SHADED SYMBOL DENOTES NEW RECEPTICLE" → receptacle;
- "(E) = EXISTING" → all;
- "BOLD = NEW WORK" → all;
- "SHADED FIXTURES ARE NEW" → fixture.

**Production repro:** set E1.0's quote to "BOLD INDICATES NEW WORK ON LIGHTING AND POWER PLANS".
- `remodel.scopedOut` is `[{ E1.0, count: 41, scope: 'fixture' }]`.
- Duplex / GFI / 42 / WP become **14 / 7 / 3 / 2 new** (they were 5 / 0 / 0 / 2 with the rule applied). The 19+ existing receptacles are now priced as new.
- There is no `status:` item, no `remodel:existing` item, and nothing about `scopedOut`. `reviewItems.ts` never reads `scopedOut`.

**Fix direction:**
- Take the kind from the rule's subject, for example the noun after SYMBOL / DENOTES / next to the status word, and ignore nouns after "SEE" / "REFER TO" / "ON … PLANS".
- Raise one item when statuses other than `unknown` are scoped out.

### S2. D3 lowers demolition on statuses the close-up check itself could not confirm, and answering the check does not undo it (c: never lower without evidence)

`replay36thB({ crops: () => ({ answer: 'unclear', confidence: 'low' }) })`:
- The blocking `statuscrop:low` says "26 symbols could not be told new or existing, even close up".
- In the same run, the non-blocking `democompare:DEMO-RECEPTACLE` lowers the line 40 → **15** using those same 25 tile-pass "existing" marks.

The estimator can answer the crop item "all new" (duplex 14, GFI 7, 42 3, WP 2). `enforcedCounts` then carries those install counts, but the demolition line stays 15. If every receptacle is new, the old ones are all pulled (decision 4), so the line should be 40.

**Fix:**
- Exclude `cropLow` (and `unknown`) plan marks from `STILL_THERE`.
- Or make the comparison blocking whenever any of its paired plan marks is `cropLow`.

### S3. Unregistered suggestion: several demolition sheets subtract the same plan list, so the arithmetic shown is wrong (c)

**Repro:**
- `buildDemolition([A2.0 (40), A2.1 (30, other size)], T, [E1.0 with 25 existing, not registrable])`.
- Each sheet's suggestion subtracts all 25: 40 − 25 = 15 and 30 − 25 = 5.
- The item reads "Suggestion: 70 shown − 25 still there = **20** removed", and option 1 is "Use the suggestion — 20 removed".

The correct figure is at least 45, so one click under-counts by 25. The item is blocking, but its arithmetic is false.

**Fix:** subtract the plan list once per class, or once per level when a level match exists.

### S4. C2 contract: "last answer wins", so confirming an info item overrides the FINAL-count answer (e)

The key and shape match C's `demolitionAnswers` (`fix/price-accuracy` `reviewAnswers.ts:50`):
- `typeKey = DEMO-<class>`;
- `demosuggest` is kind `area` and answers with `qty = keepQty / sumQty`;
- a count sets `qty`;
- confirming `democompare` / `demoreuse` sets `qty = aiCount`.

On the real 36th run, DEMO-EQUIPMENT carries two items in stored order: `demosuggest` (blocking, keep 0 / sum 6) and then `demoreuse` (info, aiCount 6).

**Repro:** answer the suggestion "Use the suggestion — 0 removed" (qty 0), then confirm the info item. C's map comes out as **6**. The answer labelled "the line's FINAL demolition count" is silently overridden.

**Fix (either side):**
- The info items' confirm carries no qty.
- Or `demosuggest:` wins over `democompare:` / `demoreuse:` for the same class.

### S5. `demosuggest` cannot be answered "0 removed" unless 0 happens to be the suggestion (e)

- The actions are `['answer', 'count']`.
- `validateResolution` rejects a count below 1.
- `not_on_job` is not allowed.

**Repro:** `validateResolution(demosuggest:DEMO-SWITCH, { action: 'count', qty: 0 })` returns "Enter a whole-number count of at least 1 …".

If all 11 switches stay, the estimator cannot give the true answer.

**Fix:** add `not_on_job`, which C maps to "line removed", or allow 0 for this prefix.

### S6. D1 + decision 5 contradict each other on the panels

Baseline 36th with HEAD and Chris's crops:
- The demolition side says panels A / B are "noted for reuse → 0 demolition".
- The install side counts **ELECTRICAL PANEL = 2 new**, and DISCONNECT = 4 new.

D1 dropped their `unknown` status as "not covered by a receptacle rule". The question that used to catch this is gone.

C1 keeps gear from auto-pricing ("confirm match"), which limits the money. Even so, the same evidence (the reuse note and the same-place pairing) should mark those install marks as existing, or at least raise one item.

### S7. Legend example (b)

- The plan asked for the legend's own symbol crops.
- The code sends the whole legend viewport at **150 DPI**, which is half the crops' 300 DPI. On 36th that is a 5.8" × 8.7" POWER legend with symbols of about 20 px.
- When no title matches, `legend[0]` is still sent as "THE SHEET'S OWN LEGEND … drawn as the rule describes". That could be a keyed-notes box.
- `LEGEND_WORDS.switch` prefers a LIGHTING legend, but switches are usually in the POWER / DEVICE legend.

This is minor, but it is the one lever for exactly the subtlety that D2 exists to fix.

### S8. Small

- `crops.cached` is not added to `evidence.ev.cached`.
- Crop `errors` are logged but not added to `evidence.ev.errors`. The marks still reach `statuscrop:low`, so nothing is lost.

---

## (a)–(f) checklist

**(a) D1 scoping**
- The real phrasings parse correctly, including the misspelt RECEPTICLE.
- A receptacle rule never touches other classes. In the replay, the nine non-receptacle `status:` items are gone and their counts are unchanged.
- An unqualified rule still covers everything. The exception is incidental nouns (S1).

**(b) D2 crop check**

| Check | Result |
|---|---|
| Cost cap | 60 crops per run, in 10-crop batches. 36th is 26 crops in 3 calls. The estimate of about $0.06–0.10 is plausible. |
| Failures fall back to the tile reading | Yes: a throw, an unclear answer and the cap are all flagged `cropLow`, with one item. |
| Streaming and retry | `messages.stream().finalMessage()` under `callWithRetry` with the run signal, refusal and truncation checks, effort low, a cached system prompt. This is the same as `titleReader`. |
| Sanitization and injection | Answers are closed enums, ids are checked against the ids sent, and prompt text passes `sanitizeForPrompt`. OK. |
| No silent lowering | **Fails (B1).** |
| Legend | S7. |

**(c) D3**
- The count never goes negative: `gone` is a subset of the shown marks, and suggestions use `max(0, …)`.
- Replaced-in-place logic matches decision 4. It is information only and the quantity is unchanged.
- The new-build guard holds: everything is under `remodelCtx`.
- Registration false positives: **B3**.
- Lowering without evidence: S2 and S3.

**(d) Decision 5**
- Hedges now cancel the zero (`61855fc`).
- Negation and other-clause notes do not: **B2**.

**(e) Merged demolition items**
- The one-item-per-class merge works.
- Answers carry over by id and fingerprint.
- The key and shape match C2.
- The gaps are S4 and S5.

**(f) Replay honesty**
- `replay36thB` drives the real `runCountingStage` and `buildReviewItems`, using the live marks, statuses and quote.
- The mocked parts are stated: crop answers, and the "marked" flag in one test only.
- All 14 replay tests and my probes go through that stage.
- Kissimmee (4 replay / evidence files) is unchanged, because a new build never enters D.

## Tests run here (HEAD `61855fc`)

**Relevant tests: 159 / 159.** These are:
- `priceAccuracyD36th`;
- `src/ai/remodel/*` (including `remodelV2`);
- `remodel36thReplay`;
- `reviewItems.test`;
- the Kissimmee replay / evidence / noise files.

**Full backend suite, run once: 2597 passed, 6 failed, 4 skipped (247 files).** Every failure is a known flake or load timeout in a file D does not touch:
- intakeSimilarCache ×2;
- integration lead-backfill;
- estimatingLibrary seeded-item (test-DB state);
- intakeSimilar.route ×2. These hit the 30 s timeout under full-suite load, and the file re-run alone gives 2 / 2.

**Probes (scratchpad, not committed):**

| Probe | Covers | Result |
|---|---|---|
| p1 | D1 scope and fill-rule parsing | B1, S1 |
| p2 | reuse notes | B2 |
| p3 | 36th replay: baseline, negated notes, DARK rule, D1 narrowing | B1, B2, S1, S6 |
| p4 | D3 registration and suggestion arithmetic | B3, S3 |
| p5 | C2 `demolitionAnswers`, copied verbatim from `08e0029` | S4, S5 |
| p6 | `cropLow` vs D3 | S2 |

---

# Addendum: re-check of the fix round `b0c0b5f..840546a`

**Commits:**
- `4e4e7e0` B1
- `bb391ee` B2
- `768efe2` B3 + S3
- `a7e1b39` S1
- `ad38991` S2
- `54e461e` S4 + S5
- `1bdb1f8` S6
- `b6fb492` S7 + S8
- `86e1029` report
- `840546a` one reuse question per equipment item

**Reviewer:** Opus 5.5, 2026-09-29. Same rules as the first review:
- read-only, except this file;
- the test DB only;
- no model calls, no Agent tool, no push.

The probes are the scratchpad files p1–p9. They run on the final HEAD `840546a`, with a clean tree.

## Verdict: **NOT READY**

One blocker: the B1 "reclassified" item cannot be answered through the real resolve path. Everything else from the first review is fixed or safe.

## Blocker

### R1. `statuscrop:reclassified` is a silent no-op in `resolveReviewItems`, so the blocking item can never be cleared and "restore" never applies

**Where:** `estimating/takeoffReview.ts:326`.
- The member-by-member branch catches every id that starts with `statuscrop:`. That prefix was added in D2 for `statuscrop:low`.
- `statuscrop:reclassified` has no `reconcileMembers`, so `targets` is `[]`.
- The loop does nothing, and the branch returns `ok: true` with no resolution stored.

The branch's tests set `resolution` on the item directly (`priceAccuracyD36th.test.ts:230`). So the enforcement is tested, but the route never is.

**Repro:** probe p7, on the test DB.
1. Run `replay36thB({ mutate: allNew('SHADED SYMBOL DENOTES NEW RECEPTICLE'), crops: () => ({ answer: 'open', confidence: 'high' }) })`.
2. Store its review items on a new bid in `takeoff_results`.
3. Call `resolveReviewItems(bidId, ['statuscrop:reclassified'], { action: 'answer', answer: item.options[1] }, 'Probe')`.

The call returns `ok = true`, but the stored resolution is **null** and the review status stays `needs_review`. The estimator can neither confirm nor restore, and the 26 receptacles stay unpriced behind a blocking item that cannot be closed.

`reuse:ELECTRICAL PANEL` goes through the same path correctly: `qty 0` is stored.

**Fix:** narrow the member-branch prefix to `statuscrop:low`, or to items that have `reconcileMembers`. Also add a route-level test that resolves both options.

## Should-fix

### N1. The level match now drops D3 without any question when only one sheet names a level

`sameLevel` compares a sheet with no level only when `jobLevels === 0`.

**Repro:** probe p9, the 36th replay with the live statuses. Set E1.0's inventory title to "First Floor Electrical Plan"; A2.0 stays "Interior Build-Out Floor Plan".
- The receptacle line becomes **40**.
- **No** receptacle item is raised at all: no `democompare`, no `demosuggest`.

The reason: `plansFor(A2.0)` is empty, so neither the comparison branch nor the suggestion branch runs. This does not break the "never lower" rule, but it is exactly the live-run result that Chris flagged (40 against 18), and it is silent.

Both "Level 1 …" titles still give 15, and so does an unmodified run or an "- North" area on one side only.

**Fix:**
- Treat an unstated level as compatible when the job states at most one distinct level (`jobLevels <= 1`).
- Or raise the blocking suggestion with the arithmetic whenever a demolition sheet has no same-level plan.

### N2. Nit: a quoted tag is not read

For `EXISTING PANEL "A" TO REMAIN`, the tag is missed, so the clause also counts for `PANEL LP-1` (p8).

Since decision 5 is now a blocking question and never an automatic zero, this only raises one extra question.

## Re-verified with the original probes

| Finding | Status | Evidence |
|---|---|---|
| **B1** | Fixed; see R1 for the answer path | The DARK, SOLID, CLEAR and HATCHED AREA rules are no longer fill rules. On the DARK 36th repro: 0 crop calls, counts 14 / 7 / 3 / 2 and 4 disconnects. A crop that lowers tile-pass new marks raises one blocking `statuscrop:reclassified`. |
| **B2** | Fixed (p2, p3, p8) | All 7 negated or other-kind phrasings give no reuse, and the real "- reuse" quote still does. The negated 36th rewrite gives equipment 10 with no reuse item. After `840546a` nothing is zeroed automatically: reused equipment keeps its own Demolition row (`DEMO-EQUIPMENT/ELECTRICAL PANEL` = 4, class row 6), and one blocking `reuse:` question sets both sides. The clause parser reads the real phrasings sensibly. |
| **B3** | Fixed (p4) | Typical floors with levels: level 2 no longer compares with level 1, so line 20 goes to a blocking question. The mirrored regular grid and the irregular mirror both become questions, never automatic. The unmodified 36th still registers (offset 0.23", -0.32", mean residual 0.04") and gives **15**. |
| **S1** | Fixed (p1, p3) | "… ON LIGHTING AND POWER PLANS", "REFER TO PANEL SCHEDULES" and "SEE LIGHTING FIXTURE SCHEDULE" now cover every item; through the stage nothing is scoped out. The four named phrasings are unchanged. |
| **S2** | Fixed (p6) | Crops all unclear give a receptacle line of 40 with a blocking question (40 − 25 = 15), no longer an automatic 15. |
| **S3** | Fixed (p4 C) | "70 shown − 25 still there = 45 removed", and a "None removed — 0" option. |
| **S4** | Fixed (p5, p7) | Every DEMO-* row has exactly one quantity-bearing item. Across all 120 answer orders, C's `demolitionAnswers` (copied verbatim) gives **one** result. Through the route, `democompare` confirm and a `demosuggest` answer are stored as expected. The `reuse:` answer carries over on an identical re-run. |
| **S5** | Fixed | A count of 0 is accepted on `demosuggest`. |
| **S6** | Merged into `reuse:<type>` (`840546a`) | "Existing, reused" makes the install line null (`enforcedCounts`) and the row 0 (C2). "New install" keeps both. |
| **S7, S8** | Read, not probed further | Legend-row crops at 300 DPI; totals added to the evidence counters. |

**Kissimmee:** unchanged. Its 4 replay / evidence / noise files pass.

## Tests (HEAD `840546a`)

- **Relevant backend: 192 / 192.** These are:
  - `priceAccuracyD36th`;
  - `src/ai/remodel/*`;
  - `remodel36thReplay`;
  - `remodelConventionRoute`;
  - `reviewItems.test`;
  - the Kissimmee files;
  - `labeledEvents`, for the resolve path.
- **Frontend:** `TakeoffReviewPanel.test.tsx` 41 / 41.
- **Probes p1–p9:** all run. p7 shows the R1 no-op, and p9 shows N1.

---

# Addendum 2: final check of `36dcfc5..86ca71d`

**Commits:**
- `f7d41e0` R1
- `28e1297` N1
- `41326ff` N2
- `86ca71d` report

**Reviewer:** Opus 5.5, 2026-09-29. Same rules as before. The probes are the scratchpad files p4 and p7–p10, run on HEAD `86ca71d` with a clean tree.

## Verdict: **NOT READY**

R1, N1 and N2 are fixed. The N1 fix, however, reopens the B3 class of fault: an unlabelled floor can be lowered automatically against a labelled OTHER floor.

## Re-verified

- **R1: fixed (p10, on the test DB, through `resolveReviewItems`, then read back from `takeoff_results`).**
  - "Confirm": the answer is stored and the item is closed. The enforced receptacle counts are unchanged, so they stay unpriced.
  - "Restore": the answer is stored and the item is closed. The enforced counts are duplex / GFI / 42 / WP = 14 / 7 / 3 / 2.
  - The member branch now takes only a `statuscrop:low` that has members.
- **N1: fixed (p9, p4 A).**
  - E1.0 titled "First Floor Electrical Plan" against an unlabelled A2.0 now gives **15** with the `democompare` note. It was a silent 40.
  - Unmodified, both "Level 1", and "- North" also give 15.
  - A labelled level 2 against a labelled level 1 is never compared: line 20 and a blocking `demosuggest`.
  - A sheet with no same-level plan is always asked.
- **N2: fixed (p8).**
  - `EXISTING PANEL "A" TO REMAIN` now matches PANEL A only, not LP-1.
  - "(E) PANEL LP-1 …" matches LP-1 only.
  - The other real phrasings are unchanged.

## Blocker

### R2. `jobLevels <= 1` lets an unlabelled floor be compared with the one labelled OTHER floor, and lowered automatically

`sameLevel` now treats a missing level as compatible whenever the job names at most one level. On a two-storey job it is common for only the upper floor to carry a level word: "FLOOR PLAN" / "SECOND FLOOR PLAN", or "FLOOR PLAN" / "MEZZANINE". In that case `jobLevels = 1`, so the unlabelled level-1 demolition sheet is compatible with the level-2 plan. The best-paired plan wins, and a registered comparison lowers the line with only the non-blocking note.

**Repro:** p4 D, a pure `buildDemolition` call using the same typical-floor layout as B3 repro A.
- A2.0 "EXISTING FLOOR PLAN - DEMOLITIONS": no level; 20 receptacles and 4 switches.
- E1.0 "ELECTRICAL FLOOR PLAN": no level. This is the real level-1 plan: 2 of those places still existing, 10 new elsewhere.
- E1.1 "SECOND FLOOR ELECTRICAL PLAN": `level: '2'`. It draws 18 of the same places as existing, because the floors stack.

**Result:**
- A2.0 registers with **E1.1**, and the line is **2** (truth 18).
- The only receptacle item is the non-blocking `democompare:DEMO-RECEPTACLE`: "20 shown on A2.0, 18 still shown as existing on E1.1 → 2 in the line".
- On `36dcfc5` the same input gave a blocking question, because `jobLevels === 0` was false.

**Fix direction:** a pairing across a missing level may be used, but never automatically. Either of these keeps p9 answerable while removing the wrong-floor automatic cut:
- When one side's level is unstated and the other's is stated, make the comparison a blocking `demosuggest` showing the arithmetic.
- Or, when the job has an unlabelled new-work plan, prefer it and never let a labelled plan win for an unlabelled demolition sheet.

If p9 (the "First Floor" E1.0 against an unlabelled A2.0) must still go through automatically:
- allow it only when no new-work plan on the job has an unstated level other than the one being compared;
- or allow it only when every labelled sheet on the job names the same level.

## Tests (HEAD `86ca71d`)

- **Relevant backend: 195 / 195.** These are:
  - `priceAccuracyD36th`;
  - `src/ai/remodel/*`;
  - `remodel36thReplay`;
  - `remodelConventionRoute`;
  - `reviewItems.test`;
  - the Kissimmee files;
  - `labeledEvents`.
- **Probes:** p4 D shows R2; p7 / p10 show R1 fixed; p8 and p9 show N2 and N1 fixed.

---

# Addendum 3: final check of `ee2cc20` (the R2 fix)

**Reviewer:** Opus 5.5, 2026-09-29. Same rules as before. The probes are p4 (A–E) and p9 in the scratchpad, run on HEAD `ee2cc20` with a clean tree.

## Verdict: **NOT READY**

R2 is fixed, but the same wrong-floor automatic cut is still reachable when the levels are on the demolition sheets and not on the plans. Given how levels are read today, that is the systematic case, not a rare one.

## Re-verified

| Probe | Result |
|---|---|
| p4 D: "FLOOR PLAN" against "SECOND FLOOR" | Line 20 and ONE blocking question. It used to be 2 automatically. **R2 fixed.** |
| Mezzanine: an unlabelled demolition sheet, an unlabelled level-1 plan and a "MEZZANINE" plan | Line 20, one question, nothing automatic. |
| p9 on the 36th replay | Unmodified 15; E1.0 "First Floor …" 15; both "Level 1" 15; "- North" 15. Every one with the `democompare` note. |
| p4 A (labelled typical floors), B (mirror), C (70 − 25 = 45) | Unchanged: questions, never automatic. |
| One-level job: an unlabelled demolition sheet against a "FIRST FLOOR" plan | Automatic, which is the intended p9 shape. |
| Demolition sheet "SECOND FLOOR" against an unlabelled level-1 plan and a labelled level-2 plan | Pairs with the level-2 plan, which is correct. |

## Blocker

### R3. A labelled demolition sheet at the ground level still pairs automatically with UNLABELLED plans of other floors

`sameLevel`'s known-level branch checks only `GROUND_LEVELS.has(known) && every PLAN level === known`. Demolition-sheet levels are left out of that check. So on a job whose demolition sheets say FIRST FLOOR and SECOND FLOOR, while the electrical plans carry no level, the first-floor demolition sheet is compatible with **both** plans, and the best pairing wins.

**Repro (p4 E, pure `buildDemolition`, the typical-floor layout of B3 A):**
- A2.0 is level `1` and A2.1 is level `2`.
- E1.0 (the real level 1) and E1.1 (the real level 2) have no level.
- E1.1 draws 18 of A2.0's places as existing; E1.0 draws 2.

**Result:** A2.0 registers with **E1.1** and the line becomes **2** (truth 18). A2.0 gets no question, only the info note.

**This is the systematic configuration, not an edge case:**
- A new-work plan's level comes only from `levelOf(p.title)`, the inventory / title-block title (`countSheets.ts:178`). For the plans, `remodelStage.levelArea` adds only the title and label.
- A demolition sheet's level also comes from its drawing titles (`demolitionTitles`, read by the titles reader).
- On 36th, for example, the inventory titles are "Electrical Plan", while the demolition titles are "EXISTING FLOOR PLAN - DEMOLITIONS".
- So a multi-storey job with generic title blocks ends up with labelled demolition sheets and unlabelled plans: exactly this repro.

**Fix (one line, keeps every passing case):** in the known-level branch, also require every stated level on the job (demolition sheets included) to be that level. That means `jobLevels <= 1`, alongside `GROUND_LEVELS.has(known)` and the plan-levels check.

With that change:
- p9 still gives 15 (the job's levels are just {1});
- p4 D and the mezzanine case stay questions;
- this repro becomes a question.

Separately, reading each new-work plan's level from its viewport / drawing titles as well would make levels symmetric. That is recommended, but not required for READY.

## Nit (pre-existing, not D's)

`levelOf` maps both GROUND and FIRST to `1`. With UK-style naming ("GROUND FLOOR" / "FIRST FLOOR"), two different floors share one level, and the pairing can cut across them. p4 E shows 2 instead of 18. APT's Florida work uses FIRST for the ground floor, so this is noted only.

## Tests (HEAD `ee2cc20`)

**Relevant backend: 198 / 198.** These are:
- `priceAccuracyD36th`;
- `src/ai/remodel/*`;
- `remodel36thReplay`;
- `remodelConventionRoute`;
- `reviewItems.test`;
- the Kissimmee files;
- `labeledEvents`.
