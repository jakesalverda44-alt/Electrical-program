# Job Profile — independent adversarial review

**Range:** `f0e3b76..8ecdd33` (branch `feat/job-profile`) · **Reviewer:** Opus · **Date:** 2026-09-24
**Verdict: NOT READY TO MERGE.** The card-update rules themselves are sound: GC is never touched, the name is only suggested, fills and accepts are audited, and an ignore survives a re-run. The problem is the extractor. When the **real Kissimmee set goes through the real production text path**, it fills wrong values onto empty cards with full confidence. The estimator then has no way to edit or clear them. The report's "verified" table comes from hand-curated fixtures that the app never produces.

## How this was checked
- I read the plan, the report and the full diff.
- I ran the real 55-page Kissimmee PDF through the same path the route uses (`extractPdfPageTexts`, then the route's `guessSheetNo`, then `extractJobProfile`). This ran in a temporary detached worktree, since removed. The PDF was copied read-only to the scratchpad and then deleted.
- I ran 16 adversarial synthetic cases through `extractJobProfile`.
- I ran one DB-backed scratch route test against `electrical_crm_test`. It covered a re-run after a fill, a cross-bid document, and a scanned set. It left a few `ZZREV …` bids in the test DB only.
- Suites, each run once:
  - Backend `npm test`: 2206 tests, 2199 passed, 3 failed, 1 worker crash. All three failures and the crash are the known flakes from the report (`intakeSimilarCache` ×2, the `integration` lead backfill timeout, and the worker crash). They match the report exactly.
  - Frontend `npx vitest run`: 1326/1326 passed.
  - `tsc --noEmit`: clean for both backend and frontend.

### Real Kissimmee, through the production path (reproduced)
| Field | App actually produces | Correct | Why |
|---|---|---|---|
| plan_date | **2025-12-03** (C0.1) | 2025-09-22 (E-1) | `guessSheetNo` returns `null` for **every** E page (pp. 45–54). The layout text puts `E-1` on a line with other columns (`"E-1      For Bidding & Contractor…"`), so the "prefer the electrical sheet" logic never fires. |
| architect | **CPH, INC.** (the landscape architect) | AutoZone, Inc. / RLBA | The layout text interleaves columns: `LANDSCAPE` / `` / `Memphis, Tennessee 38103` / `ARCHITECT` / `CPH, INC.`. The previous-line exclusion therefore sees "Memphis…", not "LANDSCAPE". |
| engineer | **`ING DRAWINGS.   BACKFILLING IN THE PIPE`** (C0.2 civil notes) | DANNY E. DOSS P.E. | There are no E pages to prefer, so the search covers every page. `ENGINEER_INLINE_RE` has no word boundary, so it matches "ENGINEER**ING** DRAWINGS". The lazy capture then runs to "PIP**E**", which it reads as the "P.E." suffix. |
| systems.fuel | **true** (`"…AD UST DOOR"`, A-1.2) | false | "ADJUST" is split in the layout text into `AD UST`, which matches `\bUST\b`. |
| store / address / SF / brand / prototype / owner / name | correct | — | — |

On a fresh bid, every one of these is auto-filled, because the fields are empty.

---

## Blockers

**B1. The real plan set fills wrong architect, plan date, engineer and fuel values onto the card.** Reproduced; see the table above.
- Where:
  - `backend/src/routes/jobProfile.ts:45-53` (`guessSheetNo` only matches a line that is exactly a sheet id)
  - `backend/src/ai/jobProfile.ts:253` (`ENGINEER_INLINE_RE`: no `\b`, the `P.E.` suffix is loose, and it has no `i` flag)
  - `jobProfile.ts:100-121` (the heading-block exclusion depends on line adjacency that layout text doesn't keep)
  - `jobProfile.ts:317` (`\bUST\b`)
  - `routes/jobProfile.ts:55-72` (reads **every** page, which violates Decision 3)
- Why it matters more: the bids PATCH (`routes/bids.ts:668-686`) does not accept `architect`, `engineer`, `plan_date`, `prototype`, `owner_name`, `store_number` or `build_type`. There's no edit-form row for them either. The estimator cannot correct or clear a wrong fill.
- Fix:
  1. Restrict profiling to cover pages and title-block regions: the first page of each file, plus the pages that sheet-check classifies as title/cover or index. Get sheet ids from the `sheetCheck` inventory, or match a sheet-id token anywhere in the bottom-right title-block text, not as a whole line.
  2. Use `/\bENGINEER\s*(?:OF\s+RECORD)?\s*:\s*([A-Z][A-Za-z.'’ -]{2,40}?,?\s*P\.\s?E\.)/` and require a real "P.E." with dots.
  3. Treat the architect as "couldn't determine" whenever more than one ARCHITECT heading exists or a LANDSCAPE token appears within about 3 lines before it.
  4. Drop the bare `UST` token.
  5. Until precision is proven, make these fields **suggest-only** even when the card is empty (or fill only when evidence comes from a confirmed title block).
  6. Add the new columns to the PATCH route and the Overview edit form.

**B2. `build_type` defaults to "new" with no evidence and is auto-filled. A scanned set also "determines" things.**
- Where: `jobProfile.ts:301-307`, `jobProfile.ts:309-313`, and `jobProfileCardRules.ts:136-140`.
- Reproduced:
  - An empty-text PDF fills `build_type = new`.
  - All five systems come back `false` ("inferred"), which the report describes as "fire alarm: no".
  - The route test above applied `fillsApplied: ['build_type']` to the scanned set.
- This breaks two plan decisions: "no default without evidence" and "a scanned set says couldn't determine".
- The reverse also fails. A new-build set whose spec index lists "ALTERATION / RENOVATION PROJECT PROCEDURES (N/A)" is classified `remodel` (reproduced).
- Fix:
  - Omit `build_type` when there is no explicit keyword on a cover or title page.
  - Make systems tri-state (`true` / `unknown`), never `false` from absence.
  - When fewer than N pages clear `TEXT_LAYER_MIN_CHARS`, return an explicit `{ undetermined: true, reason: 'no text layer' }` and write nothing.

**B3. Every re-run after an auto-filled plan date raises a false conflict chip.**
- Where: `routes/jobProfile.ts:87`.
- Cause: node-postgres returns a `DATE` as a JS `Date`, so `String(date).slice(0,10)` gives `"Mon Sep 22"`, which never equals `"2025-09-22"`.
- Reproduced: run 1 fills `plan_date`. Run 2 on the same document produces `suggestions.plan_date = {value:"2025-09-22", status:"pending"}`.
- The chip then reads "card says 2025-09-22T04:00:00.000Z", because the frontend gets the serialized `Date`.
- No test covers a re-run after a fill.
- Fix: format with a local-date formatter (`toISOString` is unsafe across timezones), or select `plan_date::text`. Add a route test that re-runs after a fill and expects no suggestions.

**B4. Brand detection is "first rule in list order that matches any text anywhere". A wrong brand then drives account-rule matching.**
- Where: `jobProfile.ts:56-63`, `jobProfile.ts:137-143`.
- Reproduced (synthetic):
  - A 7-Eleven job with a note reading "ADJACENT AUTOZONE PARCEL" gives brand **AutoZone** and type retail.
  - `ELECTRICAL ENGINEER: JOHN MURRELL P.E.` gives **Murrell** and type self_storage.
  - `TOMMY'S TIRE & LUBE (ADJACENT)` gives **Tommy's** and type car_wash.
  - `7-11` is not recognized at all, although the account rules alias it (migration 119).
- An auto-filled brand is scored 10 ("brand field") in `matchAccountRule` (`bidstd/accountRules.ts:217`). The wrong national account's furnish/install terms and forbidden phrases then reach the takeoff and the proposal.
- Fix:
  - Score brands by where they appear: the cover or title-block project name, the owner line, frequency across title blocks. Brand text in general notes or spec text should not count.
  - Require the brand in the project/owner block, and never take it from a person-name context (`… P.E.`, `ATTN`).
  - Add `7-?11` and `seven[- ]eleven`.
  - Make brand suggest-only when two brands are present.

**B5. Other confident false positives. Each one auto-fills an empty field; all reproduced with synthetic text.**
- **Address** (`jobProfile.ts:266-284`):
  - Upload only the electrical set, and the E-1 engineer office line `132 Kelley Drive, Rogers, AR 72756` becomes `loc`.
  - An owner office line printed before the site address, `123 S. Front Street, Memphis, Tennessee 38103`, becomes `…, Memphis, TE`. The `[A-Z]{2}` state match under `/i` takes the first two letters of any state name.
  - `loc` defaults to `—`, which counts as empty, so this *fills*.
  - Fix: take the address only from the project/site block ("SITE ADDRESS", "PROJECT ADDRESS", the line after the project name). Exclude blocks containing ENGINEER/ARCHITECT/OWNER/TEL/FAX/ATTN. Map full state names instead of taking two letters.
- **Store #** (`jobProfile.ts:157`):
  - `CONTACT STORE 813-555-1212` gives `813`.
  - A room tag `STORE 104` gives `104`.
  - Fix: require `STORE\s*(NO\.?|#|NUMBER)` and a digit run with no `-` or `)` phone continuation. Take it from cover or title-block pages only.
- **SF** (`jobProfile.ts:286-299`):
  - The GROSS/NET regex runs first on every page, so `GROSS SITE AREA: 52,272 SF` beats `BLDG. AREA = 7,381 SQ. FT.` and gives `52272`.
  - Fix: reject SITE/LOT/PARCEL/PAVED/LANDSCAPE contexts, prefer BLDG/BUILDING/FLOOR area, and label gross/net explicitly.
- **Prototype** (`jobProfile.ts:173-196`):
  - Panel names on their own line (`1L1` ×3) outvote `7N2` and give `1L1`. Any non-AutoZone job with panel schedules gets a "prototype".
  - Fix: only accept it within a few lines of the store/brand line on a title block, or only when the brand is AutoZone.
- **Plan date** (`jobProfile.ts:220`):
  - The first whole-line date on an E page wins, so a revision date `03/01/2026` beats the repeated issue date.
  - Fix: prefer a date labeled ISSUE/DATE, or the most frequent date across E title blocks.

## Should-fix

**S1. Race conditions in `/job-profile/run`.**
- Where: `routes/jobProfile.ts:155-190`.
- (a) The SELECT at line 155 and the unconditional `UPDATE bids SET f=$n` at line 164 run with no transaction and no guard, so a PATCH made in between (the user typing into the card) is overwritten.
- (b) Suggestions are read at line 174 and upserted at lines 184-190 with no lock. An Ignore or Accept committed during a run (the PUT *does* use `FOR UPDATE`) comes back as `pending`.
- Reasoned from the code.
- Fix: guard each fill in SQL, `SET f = CASE WHEN f IS NULL OR btrim(f::text) IN ('','—') THEN $n ELSE f END`, and wrap the read-merge-write of `bid_job_profile` in a transaction with `SELECT … FOR UPDATE`.

**S2. An auto-fill cannot be rejected, and clearing it doesn't stick.**
- Where: `jobProfileCardRules.ts:136`.
- Any empty field is refilled on every run. A user who clears a wrong architect has it written back on the next upload.
- Reasoned; the rule is `isEmpty` → fill.
- Fix: record fills in `bid_job_profile` (field, value, status `filled`). Don't refill a field whose last fill was later changed or cleared by a person. Offer an "Undo / not this" action on filled values.

**S3. The run route reads documents from other bids.**
- Where: `routes/jobProfile.ts:56`, which calls `gatherAnalysisInputs` (`routes/preconstruction.ts:2487`, `WHERE id=$1` with no `linked_id` check).
- Reproduced: bid B's run with bid A's `document_id` auto-filled B and echoed A's quotes in the response.
- The flaw predates this branch (sheet-check has it too), but this route exposes it without `run_analysis`.
- Fix: add `AND linked_id = $bidId` in `gatherAnalysisInputs`, or filter `docIds` in the route first.

**S4. The sheet summary on Overview is null or stale.**
- Where: `routes/jobProfile.ts:177-182`.
- The panel starts sheet-check, which is asynchronous (`routes/sheetCheck.ts:86-91` responds `running` and then does the work). The job-profile run then snapshots `loadSheetCheck` straight away. The first upload shows no summary; later uploads show the previous set's counts. Nothing refreshes it afterwards.
- Reasoned from the code.
- Fix: derive the summary on GET from `bid_sheet_check` when its `input_key` matches, or have the panel poll the sheet check.

**S5. Estimating has nothing selected after an Overview upload.**
- Where: `PcWorkspaceView.tsx:377-390`.
- Files are pre-ticked only from a *previous run's* `input_document_ids`. On a new bid the Documents step shows the plans unticked. Run AI then says "Upload plan files or select from Project Files" (around line 524), yet uploading no longer exists on that page.
- Fix: when nothing is selected and there has been no prior run, default-select the eligible `plans` documents that are not superseded. Update the message to point to Overview.

**S6. ZIP upload regressed.**
- The Overview panel accepts `.zip` (`PlansJobProfilePanel.tsx:117,151`). A stored zip document fails `isPdfOrImage`, so it's never sent. `gatherAnalysisInputs` expands zips only from raw uploads (`preconstruction.ts:2456-2476`), not from `document_ids`.
- The result: no sheet check, no profile, and the zip can't be selected for `/analyze`. The removed Estimating dropzone sent zips as raw uploads, where they were expanded.
- Reasoned from the code.
- Fix: expand zip documents in the `document_ids` path (and make them selectable), or stop accepting `.zip` on Overview.

**S7. The Overview pipeline sends every PDF or image on the bid.**
- Where: `PlansJobProfilePanel.tsx:54-56,107`.
- There's no filter on category or superseded status. Hand-filed proposal PDFs, spec books and old plan revisions all go to the sheet check and the profile. Because matching is first-match in document order, an old revision can outvote the new one, which undermines Decision 6's "new plans refresh suggestions".
- Fix: send only `category='plans'` documents that aren't superseded, newest first, or let the user pick the active set.

**S8. Notable systems are computed but thrown away.**
- `profile.systems` is not stored (`routes/jobProfile.ts:188` stores `fields` only), the GET doesn't return it, and the panel doesn't render it. Decision 3's "notable systems" never reaches the user.
- Fix: persist the systems, tri-state per B2, and render them.

**S9. Two gaps from the dropzone removal.**
- (a) SheetCheckPanel's per-sheet Upload (`addFiles`) persists documents but doesn't re-run the job profile, which Decision 6 requires.
- (b) Those files sit in `ws.files` / `fileObjectsRef` and are still sent to `/analyze`. The table that showed and removed them was deleted, so the user can't see or remove them before a run.
- Reasoned from the code.
- Fix: after `runPersistFiles` succeeds, trigger the job-profile run and select the new document ids instead of keeping hidden in-memory uploads.

**S10. Test integrity.**
- `ai/jobProfile.test.ts` fixtures are *curated* non-layout `pdftotext` excerpts with a **hand-set** `sheetNo` ('Cover', 'E-1').
- `test/jobProfileRoutes.test.ts` uses one fact per page.
- Neither runs the production text path (`extractPdfPageTexts` layout text + `guessSheetNo`). That's how B1 went unnoticed, and it means the report's Kissimmee table doesn't describe the app.
- Fix: commit real `extractPdfPageTexts` output for Kissimmee pp. 1, 5, 8, 25, 28, 49 (full pages, not cherry-picked lines). Run it through the route's own `buildPagesFromDocuments` logic, and assert on the table above. Add the B4/B5 adversarial cases as negative tests.

**S11. Suggested-name fallback uses the raw enum.**
- Where: `jobProfile.ts:334-338`.
- Reproduced: "cstore_fuel – Tampa, FL".
- Fix: use the `PROJECT_TYPES` label, or suggest no name without a project name.

## Nits
- **N1.** `PlansJobProfilePanel.tsx:44-52` shows raw `project_type` values (`cstore_fuel`). Map them through `PROJECT_TYPES` labels.
- **N2.** The audit entries for fills and accepts log `before: null` (`routes/jobProfile.ts:169,240`). Log the card's previous value so an accepted overwrite can be traced.
- **N3.** `PcWorkspaceView.tsx:1385`: `hasFiles` counts *any* project document, such as a generated proposal. Count eligible plan documents instead.
- **N4.** `bidstd/accountRulesDb.ts:156-157` passes brand, name and type to `matchAccountRule`, but not the new `owner_name`, although the matcher supports `owner`.
- **N5.** `mergeSuggestions` keeps an `accepted` entry for the same value. If the user retypes a different value after accepting, the same plans value is never suggested again. That may be intended, but document it.
- **N6.** Comments that contradict the code:
  - Migration 141 says `input_key` is sheet-check's fingerprint, but the route stores the sorted document ids.
  - `routes/jobProfile.ts:233` says "name is never a plain column write" right above a plain column write.
- **N7.** `storeDocument.ts:134` copies the whole buffer to count pages, doubling memory for sets over 30 MB. Acceptable for now.

## Areas that pass
- **GC is never changed.** `gc` is not in `ProfileFieldKey`, the rules skip it, and `SUGGESTIBLE_FIELDS` returns 400 for it. Verified by test and by reading the code.
- **Name is suggestion-only.** Accepting it is an explicit, audited PATCH-equivalent. That matches `bids.ts` PATCH, which also renames with a plain update.
- **Conflicts become suggestions.** A filled card field with a different value produces a suggestion, never a silent overwrite (except in the S1 race).
- **Accept uses the server's value.** It applies the stored value, never one from the client.
- **Ignore survives a re-run** for the same value, and a changed value comes back as pending.
- **Permissions:** `loadAccessibleBid` (same as bid PATCH and document upload) plus the `ai_enabled` kill switch. This matches Decision 8.
- **The removed dropzone has no hard dependents.**
  - `/analyze` and sheet-check still take `fileObjectsRef` and `selectedDocIds`.
  - The re-run pre-tick is unchanged.
  - The hidden input for the per-sheet Upload was kept.
  - The Overview upload stores documents exactly like the old `runPersistFiles` (same POST `/documents` fields: category `plans`, div `elec`) and triggers the sheet check.
  - S5, S6 and S9 are gaps in behavior, not breakage.
- **`PROJECT_TYPES`:** every value the extractor emits (retail, cstore_fuel, car_wash, self_storage, restaurant, medical, warehouse, office) is in the backend list (`routes/preconstruction.ts:75`) and the frontend constants.
- **Migrations 140–141 are idempotent and additive.** They use `ADD COLUMN IF NOT EXISTS` and `CREATE TABLE IF NOT EXISTS`, a nullable column CHECK, and a cascade FK. They don't touch existing data. There is **no** `page_count` backfill: old rows stay NULL and both lists render "—", which is safe. Numbering follows main's 139.

---

## Round 2 — fix range `1755e62..3d522b5` (migrations 142–143)

**Verdict: NOT READY. Close, and the fixes are small.** The redesign is sound:
- Page selection uses the sheet check's inventory.
- One structured call, followed by code validators.
- Fills happen only when the value is validated and high-confidence.
- The apply step runs in one locked transaction.

Every Round 1 repro is fixed. What remains:
- The validators mostly **reject known-bad contexts**. They don't **require the right block**. So a model misread with "high" confidence can still auto-fill a wrong value, and that is reproducible on the real Kissimmee cover.
- The wait-for-sheet-check flow can get **stuck forever**.

### How this was checked
- **Real text:** in a temporary worktree at `3d522b5` (since removed), I read the real 55-page Kissimmee PDF live with `extractPdfPageTexts`. It is byte-identical to the committed fixture.
- **Selection:** I ran `selectProfilePages` and `prepareProfileInput` on that text.
- **Hostile model:** I fed the resulting sources through `assembleJobProfile` and `computeCardUpdates` with **hostile model replies**. Every hostile value was a real, verbatim quote with `confidence: "high"`. The real model can't be called, and the report's Kissimmee table uses a reply the executor wrote, so the validators are the only thing that can be verified.
- **Route test:** I ran a scratch DB-backed test (the author's own Anthropic/pdfText mocks) against `electrical_crm_test`. It covered a double claim, a stale sheet check, `read_only` access, PATCH validation and clear-then-re-run.
- **Targeted suites:** 82 backend tests in 7 files and 250 frontend tests in 34 files, all passing. `tsc` is clean for both.
- I did not run the full backend suite again.

### Round 1 repros, re-run
| R1 item | Now | How verified |
|---|---|---|
| B1 real set: plan date / architect / engineer / fuel / Rogers address / all 55 pages read | **Fixed.** Only 12 pages are selected: C0.1, A-0, A-1.1, C2.1, E-1…E-7 and PH0.1 (10,919 prompt characters). A-1.2 ("AD UST") and C0.2 ("ENGINEERING DRAWINGS") are never read. Other checks: CPH under LANDSCAPE ARCHITECT is rejected; the Rogers, AR office is rejected; the 10/17/2025 owner-review date from C0.1 or PH0.1 is capped at low; fuel with no evidence stays unknown. Without an inventory (no key), the fallback still picks C0.1, C2.1, A-0 and E-1…E-7. | Reproduced with hostile replies |
| B2 build_type default / scanned | **Fixed.** There's no default. "new" without "new" wording is rejected. Systems are tri-state. A scanned set is `undetermined` and fills nothing. | Author test plus hostile reply |
| B3 date chip on re-run | **Fixed.** `to_char` / `isoDate` is used everywhere, and a re-run test exists. | Author test passes |
| B4 brand | **Fixed for known brands.** A person context, "ADJACENT" or a second known brand caps the brand at low, and 7-11 is now an alias. **Gap:** see R2-S5. | Reproduced |
| B5 phone or room-tag store #, site SF, panel prototype | **Fixed.** The store number needs a STORE #/NO label. Site, impervious and "improvements" areas are rejected. A panel context is rejected. | Reproduced |
| B5 revision date | **Partly fixed.** See R2-S4. | Reproduced |
| S1 mid-run edit / Ignore | **Fixed.** Conditional UPDATE and `FOR UPDATE` on both rows. **Gap:** double claim, R2-S1. | Author test plus scratch |
| S3 cross-bid | **Fixed.** `eligiblePlanDocs` returns 404, and `gatherAnalysisInputs` reports the document as `other_bid`. | Author test |
| S5 nothing ticked | **Fixed**, but it introduces the regression in R2-S3. | Code read |
| S6 ZIP | **Fixed.** `expandZipFile` handles stored zip documents. | Author test |
| S7 old revision | **Fixed for the profile** (`currentSetPages`). Not for the takeoff selection: R2-S3. | Code read |
| S9 per-sheet upload | **Fixed.** It files a plan document, ticks it and re-runs the profile. | Code read |

### Blockers

**R2-B1. The validators check that a quote is on the page, not that it's in the right block. Wrong values still auto-fill when the model says "high".**
All of these were reproduced on the real Kissimmee sources, or with small synthetic text where noted. Each hostile reply quotes verbatim text at `high` confidence.
- **Site address = the owner's corporate office.** Quote: `"123 South Front Street, 3rd Floor"` from the real C0.1. Result: **filled** as `123 South Front Street, Memphis, TN 38103`. On the cover's layout text the TEL line is more than 3 lines away, so the office-block window (`jobProfileValidators.ts:512-515`) never sees it. The report's own Memphis test used the *architect* block's `123 S. FRONT STREET`, which sits next to a PHONE line.
- **City, state and ZIP are never checked against the quote** (`checkAddress`, `jobProfileValidators.ts:499-522`; only `street` is grounded). Street `2860 N OLD LAKE WILSON RD.` with city `ORLANDO` and ZIP `32801` was **filled** as `…, Orlando, FL 32801`. The bid name suggestion is built from this city too.
- **Engineer of record = the bid service.** `Dodge Data & Analytics` (on 7 of 8 real E title blocks) was **filled**. Synthetic: an architect firm printed on every E title block (`SMITH ARCHITECTS LLC`) was also **filled**. `checkEngineer` (`:396-409`) needs no ENGINEER, P.E. or ELECTRICAL label anywhere near the name.
- **Owner = a consultant.** `CPH, INC.` (the landscape architect) was **filled** as owner, and so was `Dodge Data & Analytics`. `checkOwner` (`:457-464`) only rejects consultant words inside the quote's own segment and never looks for an OWNER or DEVELOPER heading.
- **Architect with two candidates.** `AUTOZONE, INC.` at high was **filled**, although A-0 lists "DESIGNERS OF RECORD: ARCHITECTURAL … rlba.com". Nothing notices that the two covers disagree.
- **Fix: add positive anchors.**
  - **Owner:** an OWNER or DEVELOPER label in the quote, or in the heading above it in the same column.
  - **Engineer:** `ENGINEER` / `P.E.` / `ELECTRICAL` in the quote or its column window.
  - **Architect:** an `ARCHITECT` heading in the column window, and a cap of medium when a second ARCHITECT or "DESIGNER OF RECORD" block names someone else.
  - **Address:**
    1. Require city and state (and the ZIP, when one is given) to appear in the quote or within 2 lines of the street in the same column.
    2. Treat OWNER, DEVELOPER, `\d+(ST|ND|RD|TH) FLOOR` and MAILING as office markers.
    3. Reject a street that appears inside an `Owner / Developer:` block anywhere on the page.
  - Until these anchors exist, make owner, engineer and architect suggest-only.

**R2-B2. The profile can stay in "waiting" forever, with no way out in the UI.**
- Reproduced: a `bid_sheet_check` row left as `running`, as a server restart or deploy mid-check leaves it. `POST /job-profile/run` returns `202 waiting` every time.
- Only a completed sheet check resumes the profile (`services/jobProfileRun.ts:103-106,130`). Nothing expires a stale `running` check or a stale `waiting`/`running` profile.
- The panel stops polling after about 5 minutes and **hides "Read the plans again"** while the status is `waiting` or `running` (`PlansJobProfilePanel.tsx:253`). Uploading the same files gives the same content key, so it stays stuck. The same applies to a profile left `running` by a crash during the model call.
- Fix:
  - Treat a sheet check `running` for more than about 10 minutes (use `updated_at`) as stale: restart it, or run the profile without an inventory.
  - Treat a profile `waiting`/`running` for more than N minutes as `error`.
  - Always show "Read the plans again" once polling stops.

### Should-fix

**R2-S1. Double claim: one run token can make two model calls.**
- Where: `runJobProfileNow` claims with `UPDATE … SET status='running' WHERE run_token=$2` (`jobProfileRun.ts:177-180`), with no `AND status='waiting'`.
- Reproduced: two concurrent `runJobProfileNow(bid, T)` calls made **2 model calls**, and two concurrent `resumeAfterSheetCheck` calls also made **2**.
- When it happens: two sheet checks for the same bid (the profile's own and the Documents step's) finishing close together, or a synchronous run inside `requestJobProfile` racing a resume.
- Fix: add `AND status='waiting'` to the claim.

**R2-S2. `read_only` users can trigger paid AI calls.**
- Reproduced: a `read_only` user got `200 complete` from `POST /job-profile/run` with 1 model call, while `sheet-check/run` returns 403 for the same user.
- The sheet check the profile starts is more than a Haiku classifier call: `aiRefs: true` also runs the reference-vision model (`modelRefVision`, default Sonnet).
- There's no dedupe either: each click makes a fresh call even when the plan set hasn't changed.
- My answer to question 3 is under "Question 3" below.

**R2-S3. S5 adds every new plan upload to the takeoff selection.** Reasoned from the code.
- Where: `PcWorkspaceView` effect ("any plan document that appears later … is added").
- Uploading Rev 2 after a run with Rev 1 selects both. Neither the sheet check nor `/analyze` de-duplicates sheets across files, so the takeoff reads two revisions of the same sheets.
- The old Estimating flow didn't pre-tick earlier inputs once a raw upload existed, so this is a regression.
- Fix: when a new plan document shares sheet numbers with a selected one, untick the older one (reuse `currentSetPages` on the sheet-check inventory), or ask the user.

**R2-S4. A revision date can still auto-fill.** Synthetic repro.
- `revisionDatesIn` looks only at the 24 characters left of a date. A revision table (`REV | DATE | DESCRIPTION`, row `1  10/15/2025  ADDENDUM 1`) has its label on the right.
- With the model's quote cut to `"10/15/2025"` and `kind: "issue"`, the value was **filled**. The cross-check doesn't downgrade it either, because every E sheet carries both dates equally.
- Fix: look at the whole row, both sides, and prefer a date labeled ISSUE, BID or PERMIT.

**R2-S5. Multi-brand detection only knows the known brands.**
- Synthetic repro: a Wawa (unknown) cover with "SHARED DRIVE WITH AUTOZONE", and the model returns AutoZone at high. Result: brand **AutoZone filled**, plus Wawa's store number. The AutoZone account rule would then apply.
- Two reasons: `NOT_THE_PROJECT_RE` has no SHARED, WITH, OUTPARCEL or FUTURE, and an unknown brand in project context never counts as a competing brand.
- Fix: require the brand's segment to be the project-name or STORE line (the same segment as the STORE # or project title), and add those words.

**R2-S6. The profile's own sheet check can overwrite the Documents step's check.** Reasoned from the code.
- `bid_sheet_check` has one row per bid. When the Estimating selection differs from `eligiblePlanDocs` (a prior-run pre-tick, or a hand-ticked non-plans PDF), `resumeAfterSheetCheck` sees a key mismatch and starts its own check (`jobProfileRun.ts:136-139`). That replaces the estimator's check, which Run AI and its "Run without N sheets" skips depend on.
- There's no infinite loop: after the profile completes, `row.input_key` stops a repeat. It still happens once on every selection change.
- Fix: when the stored check isn't for the profile's set, run the profile from the text-only fallback, or give the profile its own inventory cache keyed by content, instead of claiming the shared row.

**R2-S7. PATCH validation.**
- Reproduced: `plan_date: "2025-02-31"` returns **500** "Server error". The regex only checks the shape, and Postgres rejects the date.
- The bids PATCH handler isn't wrapped in `asyncHandler` (Express 4), so this surfaces as a raw 500.
- There are no length caps on the new text fields.
- Permissions are the same as every other card field (`loadOwnedBid`), which is consistent. `read_only` can PATCH, but that predates this branch.
- Fix: validate the calendar date (`isoDate`-style round-trip) and cap lengths at about 200 characters.

### Question 3: should a profile run by a user without `run_analysis` start a sheet check?
**Acceptable for estimators and sales. Not acceptable as it stands.**
- Salespeople (`run_analysis: false`) are the ones uploading plans at intake, so requiring `run_analysis` would defeat Decision 8.
- But the route currently lets **any** role that can open the bid (including `read_only`, technician and accounting) start a Sonnet call plus a sheet check that includes the reference-vision model. Nothing de-duplicates it.
- Recommendation:
  1. Require a role that can upload documents or edit the bid: deny `read_only`, or require `view_results`.
  2. Make the run idempotent: if the plan set's content key equals the last completed or in-flight profile's key, return that profile instead of calling again. Allow a re-read only through an explicit "Read again" (or `force`).
  3. Keep `ai_enabled` as the kill switch.
- Starting the sheet check itself is fine under the same gate. Its per-page classification is cached by content hash, so repeat cost is low once the dedupe exists.

### Cleared field = rejected: too sticky?
- No. `rejectedValues` blocks only the **same** value. A new revision with a different value fills normally (`isRejected`, `jobProfileCardRules.ts:137`).
- Reproduced side effect: after a clear, the same value is never even *suggested* again, including from a new revision at medium confidence. That's acceptable, but see N-R2-1.

### Migrations 142–143
- Additive and idempotent: `ADD COLUMN IF NOT EXISTS`, and `DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT`.
- The `status NOT NULL DEFAULT 'complete'` backfill is safe for existing rows.
- 141 was edited after it was committed, but the change is **comment-only**, so it has no effect on databases that already ran it.

### Nits
- **N-R2-1.** A value that was filled, then `edited`, then cleared is not marked as rejected (`reconcileFills` only moves `filled` → `rejected`), so the next run re-fills it. Separately, the panel could say "you cleared this before" instead of dropping the value silently.
- **N-R2-2.** The `Tommy's` alias maps any "TOMMY'S …" in a project context to Tommy's Express / car wash. Prefer `Tommy's Express` / `Tommy's Car Wash` only.
- **N-R2-3.** `currentSetPages` removes duplicates by sheet number only. An older upload whose cover has a different id (for example `CS` vs `T-1`) is still read alongside the new cover (up to 3 covers).
- **N-R2-4.** The report's "real Kissimmee output" table comes from a mocked model reply. Only the text path and validators are real. The report says so, but the headline should too.
