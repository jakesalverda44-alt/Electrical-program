# Gap-closing round: Opus review. 2026-10-01

Branch `feat/gap-closing`, 490242f..9a3da0c on main 25dce72 (17 commits). Reviewed against the plan's Reviewer focus, including "Jake's decisions (2026-10-01)" and the final pricing policy, and against the builder report.

## Verdict: MERGE AFTER FIXES

The core is sound:
- The library history triggers cover every write path.
- `getLibraryForBid` is the only library read on the pricing path.
- Every rule from migration 168 is gated by `isEstimatingBid`.
- The owner-furnished logic follows J1.
- Migrations 164–168 are numbered, guarded, idempotent and mirrored exactly.
- The gate is honest.

There is one blocker in the stage rule: a bid that is re-submitted prices "as of" its *first* submission. There are also a few should-fixes. Two of them are over-reach in the new code-only mapping, and one is the LC-CONTACTOR price.

### What I verified (all on this branch, no DB writes)

**Tests I ran:**
- Backend: 12 files, 102 tests pass. These were the gap gate, gapMigrations, gapBaseline, libraryAsOf, ownerFurnished, serviceGear, matcherSafety, seedUnitsVsChris, receptacleDeviceOnly, fixturePackageQuestion, replayEval.baseline and replayPricingGate.
- The gate reproduces the builder's numbers:
  - K SCRIPTED $68,512.84 / 720.66 h; 36th $19,160.29 / 175.09 h.
  - K live@submitted $42,916.83 / 364.5375 h.
  - Material K −32.4% and 36th −30.5%, reported, not gated.
- Backend and frontend `tsc` are clean. Frontend: AccubidPricingPanel, BidSummary and LaborPricingStep tests pass, 107/107.

**DB tests I did not run** (libraryHistory, ownerFurnishedBid, estimatingSidebarAccubid). The harness runs `runMigrations()`, which would re-apply 168 to the shared `electrical_crm_test`. The builder deliberately reversed that for the parallel round. Run them again right before merge.

**Scratch probes and a K line dump**, run with vitest from the scratchpad (outside the repo). The findings are below.

**Migration values checked against `backend/src/test/fixtures/estimating/accubid/*-bom.txt`. All match:**
- 165: Polaris 8 × 1.2 h / $45; Service Gutter 6 h / $600; Grounding Materials 6 h / $890; FRT "Playwood" 4 h / $250; #6 lug 15 h/C, $136.76/C; Meter Socket 1.5 h Quoted; CMP #24-4 8.6 h/M, $230/M; Misc 16 h / $1,500; MC saddle 406 C × 8 h/C, $59.52/C ÷ 144 = 2.82 × 0.08.
- 166: #3/0 and #6 at 18.8 / 8.9 h/M; 225A MLO surface 3.6 (and recessed 4.5 on North Port); duplex 20+3, GFCI 25+3, 20A toggle 18+3, 3-way 24+3 h/C; MC 15.2 h/M; 60A NF 1.55; 200A fusible 3.1; 30A NF 1.10; 20' pole 4.8; pole-top ≤250 W 2.2; wraparound 0.75; 5" downlight 0.9; exit 0.55.
- 167: the Kissimmee net prices $208 / $329.70 / $895.50 / $4,735 / $92.38 / $157.82 / $51.82 / $105.68 / $745.20/M; contactor $800.

**Mirrors and guards:**
- 166's SQL was parsed against `GAP_UNIT_MOVES` (exact match). 165 is checked against `GAP_CLOSING_ITEMS` (exact match).
- 167 and 168 are already checked by gapMigrations.test.
- Every moved code is `source='seed'` in the 09-30 live export.
- 168's footage-ratio guard equals the live value.
- 168's cost-line guard equals 159's v2 literal.

---

## Blockers

### B1. A re-submitted bid prices as of its first submission, not as of what was actually submitted
**Where:** `backend/src/estimating/library.ts:170` (`const ts = bid.submitted_at ?? bid.updated_at`) together with `backend/src/services/bidStage.ts:60` (`submitted_at = … COALESCE(submitted_at, now())`). `submitted_at` is set once and never cleared or reset.

**Failure scenario:**
1. Kissimmee is submitted on 9/20, so `submitted_at` = 9/20.
2. This branch merges on 10/2. Migrations 166 and 167 move THHN-3_0, the panel units, the wire prices and so on.
3. An addendum comes in. Jake moves the bid back to `due`. As intended, it now prices live, at the new units and prices. He re-prices it and submits $X.
4. `submitted_at` stays 9/20. From then on, `getLibraryForBid` rebuilds the 9/20 library.
5. The recap, the Accubid recap, the proposal regeneration and any later save on the bid now show a price from the OLD library, not the $X he submitted.
6. A save on a submitted bid also writes that number to `bids.amount`. `BIDS_AMOUNT_GUARD_SQL` only blocks calibration bids.

The result is a mix of two libraries. Items the bid picked up while it was `due` are kept live through `keepIds`, and everything else is from 9/20. Re-bids after an addendum are routine, so this breaks the stage rule's core guarantee ("submitted bids keep their prices") in a common workflow. The plan itself says "a bid un-submitted back to due prices live (intended)", but nothing handles the re-submission.

The same weakness affects a bid that goes `due → lost` without a submission. It falls back to `updated_at`, which moves forward on every later edit of the bid (loss reason, notes and so on), so its as-of date drifts forward.

**Fix:**
- Add a dedicated stamp, for example `bids.priced_as_of TIMESTAMPTZ` (migration 169, or folded into 164 before merge).
- Set it to `now()` on every transition from an estimating stage to a non-estimating one, in `transitionBidStage`. That covers `due → submitted / awarded / lost`.
- Also set it when the `calibration` flag is turned off.
- `getLibraryForBid` reads `priced_as_of ?? submitted_at ?? updated_at`. Backfill it from `submitted_at`.
- Keep `submitted_at` for the timeline and win-rate figures.
- Add a DB test for submit → back to due → library change → re-submit. The recap must equal the re-submitted price.

---

## Should-fix

### S1. LC-CONTACTOR $800 (167) overprices on Kissimmee itself
**Where:** `database/migrations/167_gap_closing_price_refresh.sql:49` and `backend/src/eval/gapMigrations.ts` (`GAP_PRICE_MOVES`).

Chris's line is "Lighting Contactor 1 E $800, **6.0 h**" (kissimmee-bom.txt): one lump for the whole enclosure. LC-CONTACTOR is a per-EA unit at 2 h.

The SCRIPTED line dump of Kissimmee shows two things:
- **The real contactors.** They are a counted row, "Lighting contactors (Work, Sales, Sign x2, Site x2) 6 EA", held today as a `confirm_match` to the relay panel. The moment the estimator confirms it onto LC-CONTACTOR, it prices 6 × $800 = **$4,800 against Chris's $800**.
- **Where the $800 lands today.** It sits on "Semi-recessed, circuit B-25", which looks like a pre-existing mis-match. So part of K's material improvement comes from a mis-matched line.

On any job that counts single contactors, the item is overpriced by about 4×.

**Fix:**
- Drop the LC-CONTACTOR row from 167 and from `GAP_PRICE_MOVES`, so it stays at $180, until Chris answers.
- Or, if Jake wants Chris's number, use $800 / 6 = $133.33 per contactor with a cited evidence line.
- Either way, re-pin the K gate numbers.

Jake approved "contactor" on the list, but the builder's own flag and this evidence justify putting it back to him as a one-line question.

### S2. A non-service wireway is silently turned into a "duplicate" of the service gutter
**Where:** `backend/src/estimating/serviceGear.ts:27` and `:91–98`.

`GUTTER_SERVICE_RE` accepts any dimension (`\d x \d`) as "service". Every gutter-like row after the largest one then becomes a `duplicate` note, which drops it from pricing.

Probe: `"Lighting control wireway 4x4"` together with `"Wireway NEMA 3R 12x12"` → the LCP wireway becomes **note: duplicate** ("the same service gutter"). That is a real wireway silently priced at $0, the opposite of "nothing silent".

**Fix:**
- Dimensions alone must not qualify a row as service.
- Exclude `lighting control|\blcp\b|controls|\balc\b|telecom` from gutter matching.
- Collapse only rows that each independently say service / NEMA 3R / meter / "contractor provided".
- Leave the rest to the mapper.
- Add the probe pair to `matcherSafety.test.ts`.

### S3. Transformer grounding is priced as the $890 / 6 h service grounding lump
**Where:** `backend/src/estimating/serviceGear.ts:60`.

Any EA/LS × 1 row naming two electrodes qualifies. Two probes both → **GND-SVC**:
- "Ground transformer T1 to building steel and cold water pipe"
- "Transformer grounding — building steel & water pipe bond"

A dry-type transformer's separately-derived-system grounding is on most tenant-improvement jobs. The existing probe only tests the bare words "transformer grounding", which is why the test passes.

**Fix:**
- Add `transformer|xfmr|\bT-?\d\b|separately derived` to the exclusion unless the text also says "service".
- Add both probes.

### S4. The fixture-package question is asked on submitted bids, and answering it moves a submitted price
**Where:** `backend/src/estimating/accubidBidData.ts:469`. `fixturePackageQuestionFor` is not gated, and the fixture-package flag reaches `resolveLines` for every stage.

On a submitted bid with an unflagged quote, the new prompt invites "Yes", which removes the library fixture material from a submitted bid's recap and amount.

**Fix:** return the question only when `isEstimatingBid` (the stage is already read in `previewCostLines`). The flag itself can stay as an explicit estimator edit.

### S5. The bound in `replayEval.baseline.test.ts:172` went from 2% to 10%, but the real delta is 5.6%
The 36th live@due replay is $22,133.75 against the live proposal's $20,955.28, a delta of $1,178. The 10% bound leaves about $920 of headroom, enough to hide a second change of this round's size.

**Fix:** pin the delta exactly (±$1), or bound it at 6%. Say in the comment that the gap gate owns the per-group checks.

### S6. The SQL of 166 and 167 has never executed against a real seed row
The shared test DB has no `source='seed'` rows (builder report), so both migrations ran as no-ops there. Only regex parity is tested.

**Fix, before deploy:** do a rollback dry-run on a copy of the live DB:

```
BEGIN; \i 164..168; SELECT code, labor_hours, material_cost FROM est_items WHERE code IN (…);
SELECT count(*), min(changed_by) FROM est_item_history; ROLLBACK;
```

Expect 18 unit rows and 10 price rows moved (9 if S1 drops the contactor), plus the same number of history rows tagged `migration 166` / `migration 167`.

---

## Nits

- **N1. History is loaded in full on every call.** `library.ts:140`: `getLibraryHistory` loads every history row on every pricing call for a non-estimating bid, and `getLibraryForBid` runs several times per recap (accubid recap + save + sync). Each calibration apply adds one row per active item. Filter with `WHERE valid_until > $ts`: every use in `libraryAsOf` needs `valid_until > ts`, so this changes no result.
- **N2. Two false positives on the flush panel.** `serviceGear.ts:79`:
  - "225A surface (not flush)" → PNL-225F, because of the negation.
  - "Panel B 225A MLO flush, existing to remain" → PNL-225F, so an existing panel gets 4.5 h.

  Add `not flush|existing to remain|\bexisting\b` exclusions.
- **N3. `fusedOnly` is computed only in the disputed branch.** `ownerFurnished.ts:71`. When every source says Owner and the only statements name fused switches, labor-only zeroes every disconnect, including non-fused RTU ones. Apply `fusedOnly` to labor-only too.
- **N4. The wall-mount material is uncited.** `165_gap_closing_items.sql:45,50`: LTG-WM175 / LTG-WM250 carry $145 material, while Chris's rows are Quoted. Cite where $145 comes from (the library wall-pack price?) in the SQL comment and the seed.
- **N5. Calibration on a submitted bid may permanently change its saved lines.** Turning Calibration on for a submitted bid and syncing rewrites its saved lines with the new rules. `keepIds` then keeps the new code-only items (e.g. ALW-FIT-MCLUM) after Calibration is turned off, so the bid no longer reprices to its submitted figure. This predates the round (S6 design), but it limits the "to the cent" guarantee. Document it in the Calibration toggle hint, or snapshot the lines before a calibration sync.
- **N6. The grep test can be dodged.** `libraryAsOf.test.ts:50` matches only the literal `getLibrary()`. It is meaningful today: every pricing call site was moved, and the only allowed hits are `GET /library` and the Accubid import preview / apply. But an alias (`const g = getLibrary`) would slip past it. Also match `\bgetLibrary\b` not followed by `ForBid|AsOf|History`.
- **N7. Owner-furnished needs an account-terms snapshot.** It only works on a bid whose run wrote `takeoff_results.account_terms`. The live Kissimmee export has none, so in the app nothing changes on Kissimmee until the planned live re-run. That is expected; say it to Jake with the re-run.
- **N8. "No history for settings" is not a hole for 168's rules on the recap path.** Each of 168's rules is gated where it is read:
  - the receptacle swap by `priced` in `takeoffRowsFrom`;
  - the MC basis forced to `fixture` in `computeGeneratedTakeoffRows`;
  - the box / fitting rows (including the per-luminaire MC connectors) by `isEstimatingBid`;
  - the OxBlue line by `previewCostLinesFrom`.

  Saved lines are frozen anyway, and the live@submitted replay reproduces $42,916.83 with the 168 settings applied. Two exceptions remain: an estimator editing the general footage ratios (`wirePerConduitFt`, etc.) still moves a submitted bid on its next sync, but that predates the round; and N5.

---

## The other focus items (no finding)

**Stage rule.**
- The triggers write history BEFORE UPDATE/DELETE on items, assemblies and components, so every writer is covered (library.ts, accubidImport, calibration, migrations).
- The trigger skips `updated_at`-only writes.
- 164 runs before 165–167.
- `resolveOptionsForBid` gates owner-furnished. The generated tap / lug / underground / Misc / site rows all sit behind `feederEst` / `isEstimatingBid`.
- Due and Calibration bids reprice. Pinned in the replay and in `libraryHistory.test.ts`.

**Nothing silent.**
- Every owner-furnished zero quotes its sheet and statement.
- K disconnects stay priced and flagged ($624.86, `disputed:disconnects`); the RTU 60A disconnects are not flagged.
- "by G.C." = APT, tested. The estimator's answer wins. The auto-deduct guard and the override are in place.
- No count is raised or lowered: the lump grounding row stays at qty 1, and taps and lugs are derived and labeled "default — confirm".
- The CMP line is a `needs_length` hold at 0 LF quoting E-6.

**No double counting.**
- Fixture package, then owner-furnished, then B5 run in one pass in `resolveLines`. `materialRemoved` counts only what that pass removed.
- Taps are separate graph edges, not feeder estimates.
- The site radial keeps the B3 one-source check (`siteScope`) and zeroes the ratio PVC.
- A swapped receptacle reports `pointHasBox=false`, so the box allowance adds its box exactly once.
- The per-luminaire MC connectors replace the per-ft fitting, never add to it.

**Alias safety.** All 13 new codes are in `ALIAS_ONLY_CODE_RE`, with empty aliases. The mapper probes ("plywood shelf", "transformer grounding", "gutter downspout", "data cable for cameras", "EAS wireway") do not match. The over-reach is in `decideServiceGear`, not the mapper (S2, S3).

**Migrations.**
- 164–168 follow 161 (162/163 are other branches').
- History is written first via the trigger. The 156 guard and the `<>` / `IS DISTINCT FROM` idempotence are on every UPDATE.
- 165 is insert-only with `ON CONFLICT DO NOTHING`. 168 touches only untouched or absent settings.
- Only Jake's approved values appear, plus the decision-1 carry-overs and METER-SKT, which was flagged.
- The `set_config(..., true)` tagging works because `migrate.ts` wraps each file in BEGIN/COMMIT.

**Gate honesty.**
- The baseline was committed once (490242f) and never rewritten.
- SCRIPTED answers are labeled, each with a quote.
- The old Chris-price row is still printed.
- CI throws without `pdftoppm`.

**Pin updates.**
- Hold count 17 → 11 is 16 − 4 priced by code − 1 Ufer note.
- zeroHourLines 17/8/16 → 21/9/11 still totals 41.
- DISCON A 16 → 31 ft follows J3.
- The exception is the 10% bound (S5).

**Fewer-questions files.** reviewItems.ts, takeoffReview.ts, tradeAssignment.ts, routes/preconstruction.ts, countMerge and the review UI are untouched. The `replayEval.ts` changes are additive.

**Frontend.**
- The labor-only (green) and furnish-disputed (amber) badges carry the evidence as a tooltip.
- The sidebar and collapsed-strip rows share one text function each (parity 16 → 19).
- The fixture-package prompt sends `fixturePackage` / `fixturePackageDecided` only on an explicit click, never automatically. "No" marks every listed quote as decided.

### Judgement on the two flagged defaults
- **LC-CONTACTOR $800: do not ship as an EA price** (S1).
- **#6 lugs, 3 per feeder with a #6 ground: acceptable as labeled.**
  - It is fit to Kissimmee (6 lugs / 2 feeders); North Port carries 2 #6 lugs.
  - It costs 0.45 h and about $4 per feeder, and is stated as "default — confirm" on the line.
  - Keep it, and add it to Chris's question list next to Q1.

### Material band, reported rather than gated
The material band staying reported is justified. Kissimmee's −32.4% is mostly the 8 power poles × $650, a count this round may not set, plus the excluded Misc lump and the CMP length, each tied to Q4 / Q6 / Q9. Note that the Kissimmee material figure includes the $800 contactor on a mis-matched line (S1). Once S1 is fixed, expect about −$620.
