# Bid Overview: Plans Upload + Job Profile — execution report

**Branch:** `feat/job-profile` (worktree `../Electrical-program-wt-jobprofile`), from local main `f0e3b76`.
**Executor:** Sonnet 5 · **Date:** 2026-09-24

## Commit range

`f0e3b76..da42dce` (6 commits so far; this report is the 7th and last):

| Commit | Task |
|---|---|
| `26e0466` | The plan (copied in unchanged) |
| `22cdbf6` | Coordinator override — the plan-file dropzone removed from Estimating → Documents; migration 140 (`documents.page_count`) |
| `8f4918f` | Job profile: pure text-layer extraction engine (`ai/jobProfile.ts`) + migration 141 (bid fields + `bid_job_profile`) |
| `c7fe9ee` | Job profile: card-update rules (pure) — `estimating/jobProfileCardRules.ts` |
| `2626594` | Job profile: routes (`routes/jobProfile.ts`) — run, get, accept/ignore suggestions |
| `da42dce` | Job profile: the "Plans & Job Profile" panel on Bid Hub Overview |

**Mid-task change from the coordinator** (applied before any other job-profile code existed, since it changes what Decision 1 builds): Jake removed Decision 1's "no second upload path is required [in Documents]" — Documents' own dropzone is gone entirely; uploading lives only on Overview now. `22cdbf6` does that removal and is deliberately its own commit, separate from the plan's own task list.

## Migrations

**Last migration: 141.**

- **140** (`documents.page_count`) — a PDF's page count, computed once at upload time (`storeDocument.ts`, via the existing `pdfjsLoader`), best-effort (never blocks an upload on a corrupt PDF). Feeds the read-only plan list in both Documents and the new Overview panel.
- **141** (job profile schema) — `bids` gains `prototype`, `plan_date`, `owner_name`, `architect`, `engineer`, `store_number`, `build_type` (checked to `new`/`remodel`/`tenant`/null); new table `bid_job_profile` (one row per bid) holds the last extraction (`profile`, each field with its sheet + quote evidence), the current suggestion state (`suggestions`, `pending`/`accepted`/`ignored`), the sheet-check one-liner (`sheet_summary`), and the model/cost used. Both additive (`ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`).

## Test suites (run once, at the end)

| Suite | Result |
|---|---|
| Backend `npm test` | **2206 tests: 2199 passed, 3 failed, 4 not run. 206 files (203 passed, 2 failed, 1 lost to a worker crash).** |
| Frontend `npx vitest run` | **1326 passed, 0 failed (129 files).** |
| `tsc --noEmit` (both) | clean / clean |

**The 3 backend failures + 1 worker crash, classified** (none is a regression, none touches a file this branch changed):
- `intakeSimilarCache.test.ts` ×2 ("two calls with nothing changed recompute once…", "same output as before: a REBID item…") — the **known flake** documented in both halves of the prior `2026-09-24-next-round-report.md` ("it failed in the baseline too, and now times out even alone, apparently slowing as the test DB accumulates bids"). Re-ran this file alone here and it still timed out at ~35s/test (30s limit) — same signature, unrelated to intake/lead code, and this branch never touches `routes/intake.ts` or its similarity cache.
- `integration.test.ts` "backfills a follow-up for an existing lead already sitting in a stage" — the same **known load timeout** the prior report documented under this exact name.
- One worker crash ("Worker exited unexpectedly") losing 4 tests — matches the previously-documented `notificationsRetention` worker crash (2206 total − 2199 passed − 3 failed = 4 not run, the same shape as the prior report's "4 not run").

None of these three touch documents, bids, sheet-check, or anything under `ai/`, `estimating/jobProfileCardRules.ts`, or the new routes/frontend — they're pre-existing, load-sensitive intake/notification tests, consistent across two prior independent executor runs on this same codebase.

**New tests added by this branch:** 19 (`ai/jobProfile.test.ts`) + 11 (`estimating/jobProfileCardRules.test.ts`) + 8 (`test/jobProfileRoutes.test.ts`) + 3 (`test/storeDocumentPageCount.test.ts`) = **41 backend**; 7 (`PlansJobProfilePanel.test.tsx`) + 2 new cases in `PcWorkspaceFiles.test.tsx` (its "coordinator override" describe block) = **9 frontend**.

## What the profile extracts

### Kissimmee (AutoZone #10077) — the one real, fully-readable set

Real text read with `pdftotext -f N -l N` from `Bids/Summit GC/Autozone Kissimmee, FL/Plans/1.0 - AZ #10077 - Kissimmee, FL FULL SET.pdf` (55 pages, read-only; small excerpts committed as fixtures in `ai/jobProfile.test.ts`, never the PDF itself):

| Field | Value | Evidence |
|---|---|---|
| Brand | AutoZone | "AUTOZONE, INC." (cover) |
| Project type | retail | inferred from brand |
| Store # | 10077 | "AutoZone Store No. FL10077" (cover) |
| Prototype | 7N2-L | "7N2" (cover, C1.1, …) + "7N2-L" (E-1) — grouped by base, longest variant wins |
| Site address | 2860 N Old Lake Wilson Rd, Kissimmee, FL 34747 | combined address line (cover) |
| Building SF | 7,381 | "BLDG. AREA = 7,381 SQ. FT." (C1.1, repeats on every civil sheet) |
| Plan date | 2025-09-22 | "09/22/2025" — the electrical sheet's (E-1) own title-block date, preferred over the civil cover's separate 12/3/2025 issue date |
| Owner | AUTOZONE STORES LLC | "Owner / Developer: AUTOZONE STORES LLC" (cover) |
| Architect | AUTOZONE, INC. | the "ARCHITECT" heading block (cover) — correctly skips the adjacent "LANDSCAPE ARCHITECT" (CPH, Inc.) block |
| Engineer of record | DANNY E. DOSS P.E. | "ENGINEER: DANNY E. DOSS P.E." (E-1's own title block, not the civil consultant Matthew D'Angelo on the cover) |
| Build type | new | inferred (no remodel/tenant-fit-out language anywhere in the set) |
| Notable systems | site lighting: yes (PH0.1 photometric plan); fire alarm: no; fuel: no; generator: no; EV: no | "UNSPRINKLERED" (general notes), no "FIRE ALARM"/"GENERATOR"/"EV CHARG" anywhere; canopy mentions are all architectural (entry canopy), never fuel |
| Suggested name | "AutoZone #10077 – Kissimmee, FL" | brand + store + city/state |

Verified end-to-end through the real route (`test/jobProfileRoutes.test.ts`, DB-backed): a fresh bid with every field empty gets all ten of these auto-filled and logged to `audit_log`; `gc` is never touched; the suggested name is a pending suggestion chip, never auto-applied; a bid with a pre-existing `sq_ft` that disagrees gets a suggestion instead of a silent overwrite; accepting a suggestion writes the server's own stored value (a tampered client-supplied value in the request body is ignored); ignoring a suggestion survives a re-run against the unchanged plans value (doesn't come back) but resets to pending if the plans' value changes.

### Every other real set attempted — all online-only, unreadable (deferred, not skipped without trying)

Per the ground rules, I looked under `Bids/` (read-only) for a second, differently-shaped real set (car wash, storage, 7-Eleven) and tried every candidate the task named plus several more:

- `Bay To Bay Properties/Vroom Car Wash - Fort Myers/…/Electrical/E001-…-Rev.0.pdf` and its sibling sheets
- `JamesCo Builders/Clermont Golf Simulator/drawings/Current Set/[001] A0.pdf`, `[006] E100.pdf`, `[002] A1.pdf`
- `Bids1/Bay To Bay Properties/Murrell storage - Rockledge/Murrell Storage - Rockledge.pdf` (+ the "Older Bids" copy)
- `Bay To Bay Properties/Older Bids/7-Eleven #10319 - Fort Myers Beach, FL/7-Eleven #10319 - Fort Myers Beach, FL.pdf`
- `Bay To Bay Properties/Bubble Down Car Wash Safety Harbor (Renovation)/Bubble Down Remodel Elec.pdf`
- `Bay To Bay Properties/Big Dan's Car Wash - Sebastian/Big Dans Car Wash - Sebastian Submittal .pdf`
- `Bids1/Bay To Bay Properties/Bubble Down Car Wash Clearwater/Bubble Down Car Wash Clearwater.pdf`
- `JamesCo Builders/Seminole Stae College Building B/` — no plan-set PDF present at all, only an `.eml` invitation to bid.

Every one of these (`ls -la` reports a real, non-trivial file size for each) reads as **zero bytes** through `dd`/`pdftotext`/`pdfinfo` — a classic OneDrive Files-On-Demand cloud-only placeholder, not a corrupt file. This matches the exact finding the prior `2026-09-24-next-round-report.md` already documented for the same folder tree ("These OneDrive files are online-only placeholders; `cp` / `pdftotext` time out even outside the sandbox… Jake can mark them 'Always keep on this device'"). I did not fabricate or substitute synthetic client-branded text for these — the car-wash/storage/7-Eleven extraction paths (brand list, project-type keyword fallback) are covered instead by: (a) unit tests in `ai/jobProfile.test.ts` using realistic-but-synthetic phrasing ("ACME WAREHOUSE EXPANSION" → warehouse fallback, remodel/tenant-fit-out keyword detection), and (b) the route-level integration test's own synthetic multi-page PDF (`test/jobProfileRoutes.test.ts`), which is not a real client set and is called out as such in that file's own header comment.

**Action for Jake:** mark the files above "Always keep on this device" in OneDrive if a second real-set fixture is wanted later.

## Estimated cost per bid

**$0.00 for a plan set with a text layer** (every real set actually opened today, including Kissimmee) — `extractJobProfile` is a pure regex pass over `pdftotext` output, no model call at all. `estimateJobProfileCost()` only charges anything when the vision fallback runs (a scanned, no-text-layer cover/title-block crop): a conservative flat **2¢ per crop**, based on one small Haiku-tier image call (~1.5k image tokens + a few hundred output tokens, well under a tenth of a cent at list pricing) rounded up so the estimate never undercounts. The vision fallback itself is not implemented in this branch (see Deferrals) — `usedVision` is always `false` today, so the field exists and is tested (`estimateJobProfileCost(0) === 0`, `estimateJobProfileCost(1) === 2`) but the route never actually has anything to charge for yet.

## Deferrals (honest)

- **Vision fallback is not built.** Decision 3 says "vision (Sonnet) on the cover/title-block crop only when there is no text." `ai/jobProfile.ts` is text-only; a scanned plan set (no text layer at all) today just produces an emptier profile rather than falling back to a model call. The cost estimator and the `usedVision` flag are wired for it, but there's no crop-rendering/Anthropic-call path yet. No real set found in `OneDrive/Bids` while executing this plan was actually scanned-only (Kissimmee's electrical sheets have real title-block text, as the plan's own "E-sheets have no text layer except the title block" note predicted), so this wasn't exercisable against real data regardless.
- **A second real-set fixture** (car wash / storage / 7-Eleven) — every candidate is an unreadable OneDrive cloud-only placeholder (see above); not something more searching fixes.
- **`ai_sheet_refs_vision_model`-style Settings field for job profile's own model** (`ai_job_profile_model`, Decision 7) — not added. The route doesn't call a model today (see the vision-fallback deferral), so there is currently nothing for that setting to configure; adding an unused Settings field seemed worse than leaving it out until the vision path exists.
- **No manual edit-form fields for the new bid columns** (prototype, plan_date, owner_name, architect, engineer, store_number, build_type) in `OverviewTab`'s existing "Edit" form. They're readable (shown in the panel's "Detected from plans" block and writable via fill/suggestion-accept), but there's no manual text-input row for a human to type/correct one directly the way `name`/`gc`/`loc`/etc. already have. Low-risk, additive follow-up.
- **`build_type` always gets a default value** ("new") even with zero supporting evidence (`confidence: 'inferred'`, `quote: null`) when no remodel/tenant keyword is found — and per the stated rule ("empty fields → fill"), that default DOES get auto-filled onto an empty card, not just suggested. This is a deliberate reading of the plan (build_type is a required profile output field; withholding it entirely felt like a bigger deviation than filling a considered default), but it's worth Jake's eyes: an estimator could see "Build type: New" on a bid whose plans actually said nothing either way.
- **Reference-page/cover-sheet targeting is heuristic, not wired to the sheet-check classifier.** `routes/jobProfile.ts` runs its own lightweight `guessSheetNo()` (a short standalone title-block line shaped like a sheet id) rather than reusing `services/sheetCheck.ts`'s AI-assisted classification, so the job-profile step works even when sheet-check itself hasn't run (different, lighter permission — Decision 8) or is unavailable. It reads every page of every attached PDF's text (cheap — no image work), not just "cover + title blocks + sheet index" as Decision 3's phrasing implies; in practice this makes no difference to which fields are found first (the regexes are page-order-first-match), but it does mean a very large plan set costs one full `pdftotext` pass per file rather than a handful of targeted pages. Not measured against a large real set (Kissimmee's 55 pages ran effectively instantly).
- **Images (JPG/PNG) uploaded as "plans" are not text-extracted at all** — `routes/jobProfile.ts` only runs `extractPdfPageTexts` on `application/pdf` mimetypes; an image-only upload is silently skipped for profiling purposes (it still uploads fine and still shows in the file list). This is the same gap the vision-fallback deferral above would also close.
- **No live runs against the real Anthropic API** — nothing in this branch calls a model; every test is either a pure function test or a DB-backed route test with `NODE_ENV=test` (no Drive/email/Anthropic calls; `storeDocument.ts`'s cloud paths are muted under test the same way the rest of the codebase already mutes them).

## Top files for review

- `backend/src/ai/jobProfile.ts` / `jobProfile.test.ts` — the extraction engine; the prototype base/variant grouping and the plan-date electrical-sheet preference are the trickiest parts.
- `backend/src/estimating/jobProfileCardRules.ts` / `.test.ts` — the three hard rules (empty→fill, conflict→suggest, gc/name special-cased) in one place.
- `backend/src/routes/jobProfile.ts` / `test/jobProfileRoutes.test.ts` — where the rules meet the DB and the audit log; the `SUGGESTIBLE_FIELDS` allowlist is the actual enforcement point for "gc is never touched" at the transport layer.
- `frontend/src/features/bid-hub/PlansJobProfilePanel.tsx` / `.test.tsx` — the Overview panel.
- `frontend/src/features/preconstruction/PcWorkspace/FilesTab.tsx` / `PcWorkspaceView.tsx` — the coordinator-override dropzone removal; worth a look for what stayed (the hidden input for SheetCheckPanel's per-sheet Upload) versus what was deleted.
- `database/migrations/140_documents_page_count.sql`, `141_job_profile.sql`.

---

## Fix round (review `1755e62`, verdict not-ready)

**Range:** `1755e62..HEAD` (10 commits including this report). **Migrations:** 142 (profile run state, systems, fills, pages used, usage) and 143 (requested_by, rejected).

### What changed
- **Extraction redesign.** The regex extractor is no longer a source of values.
  - `ai/jobProfile.ts` uses the sheet check's classified inventory to pick only the cover sheet(s), up to two code / area data sheets (by title, or by labeled data blocks in the text), and the electrical title blocks. It reads the current plan set only: the higher revision or the newest upload wins, and spec books are never read.
  - It makes ONE structured call (`ai_job_profile_model`, default `claude-sonnet-5`, Settings → AI → Job Profile; `output_config` json_schema at low effort). Every field comes back as `{value, sheet, quote, confidence}`. An image crop is sent only for a selected page with no text layer.
  - If the sheet check hasn't finished for exactly these files, the profile waits (202 `waiting`) and runs when the check completes. If no check exists, it starts one.
- **Validators (`ai/jobProfileValidators.ts`, code).**
  - Every quote must really be on the cited page.
  - Each field has its own rules (address, store #, brand, SF, prototype, plan date, engineer, architect, systems, build type), as specified.
  - A hard failure means the value is dropped and listed as "not used, because…". A soft failure makes it a lower-confidence suggestion.
- **Card rules.** An empty field is filled only when the value is validated AND the model had high confidence; any other value is a suggestion.
  - A cleared fill is a rejection and is never re-filled or re-suggested (S2).
  - Accepted-then-retyped is `overridden` and is not re-suggested for the same value (N5).
  - An undetermined (scanned) profile changes nothing.
  - GC is never touched; the name is only ever suggested.
- **Also fixed:**
  - **B3:** `plan_date` is read with `to_char` and returned as `YYYY-MM-DD` everywhere.
  - **S1:** fills and suggestion merges run in one transaction with the bid and profile rows locked, and each fill is a conditional UPDATE.
  - **S3:** document ids are scoped to the bid (404 / `other_bid`).
  - **S4:** a live sheet summary.
  - **S5:** Estimating pre-ticks the plan set, and the no-plans message links to Overview.
  - **S6:** a stored ZIP unpacks through the same `expandZipFile` as the old upload.
  - **S8:** systems are stored and shown, tri-state.
  - **S9:** the per-sheet Upload files a plan document, ticks it and re-runs the profile.
  - **S11 / N1:** labels, not codes.
  - **N2:** audit entries carry the previous value.
  - **N3:** only plan files count toward the Documents step.
  - **N4:** `owner_name` goes into account-rule matching.
  - **N6:** both comments corrected.
  - **N7:** the page count comes from `pdfinfo` on a temp file.
  - Every new column is editable in the Overview form and the PATCH route. The form sends only fields changed in that edit.

### The REAL Kissimmee output: real text path + validators, MOCKED model reply
- **Source:** `1.0 - AZ #10077 - Kissimmee, FL FULL SET.pdf` (55 pages), stored as the bid's plan document in the test DB.
- **Text:** read live by `extractPdfPageTexts` (the committed fixture is byte-identical, which a unit test asserts).
- **Sheet check:** a seeded classifier inventory (the classifier itself is a Haiku call).
- **Route:** the real `POST /job-profile/run`.
- **Model:** the one call mocked with a reply whose quotes are all verbatim from the text it was shown (`backend/src/test/jobProfileRoutes.test.ts`, first test).

**Sheets the model was shown:** C0.1, A-0 (covers); A-1.1, C2.1 (code / area); E-1 … E-7 and PH0.1 (title blocks only).
- The prompt was 11,520 characters.
- C0.2 (the "ENGINEERING DRAWINGS" notes) and A-1.2 (the "AD UST" page) are never read.

| Field | Value | Sheet · quote | Confidence | On the card |
|---|---|---|---|---|
| Brand | AutoZone | C0.1 · "AutoZone Store No. FL10077" | high, validated | **filled** |
| Project type | Retail (`retail`) | from the brand | high, validated | **filled** |
| Store # | 10077 | E-1 · "AutoZone Store No. 10077" | high, validated | **filled** |
| Prototype | 7N2-L | E-1 · "7N2-L" | medium (model) | suggestion |
| Location | 2860 N Old Lake Wilson Rd, Kissimmee, FL 34747 | C0.1 · "2860 N OLD LAKE WILSON RD., KISSIMMEE, FLORIDA 34747" | high, validated | **filled** |
| Building SF | 7,381 (building) | C2.1 · "BUILDING AREA: \| 7,381 S.F." | high, validated | **filled** |
| Plan date | 2025-09-22 | E-1 · "09/22/2025" (the E title blocks agree; PH0.1's civil 12/3/2025 does not win) | high, validated | **filled** |
| Owner | AUTOZONE STORES LLC | C0.1 · "Owner / Developer: AUTOZONE STORES LLC" | high, validated | **filled** |
| Architect | AUTOZONE, INC. | C0.1 · "AUTOZONE, INC." (the civil cover's ARCHITECT block; CPH, INC. under LANDSCAPE ARCHITECT is rejected by the validator) | medium (model) | suggestion |
| Engineer of record | DANNY E. DOSS P.E. | E-1 · "ENGINEER: DANNY E. DOSS P.E." (on 7 of 8 electrical title blocks) | high, validated | **filled** |
| Build type | — | no explicit evidence | — | left empty (never a default) |
| Bid name | AutoZone #10077 – Kissimmee, FL | brand + store + city/state | — | suggestion only |
| Systems | site lighting **yes** (E-7 "SITE LIGHTING PLAN"); fuel, fire alarm, generator, EV **not shown** (unknown, never "no" from absence) | | | stored + shown |
| GC | Summit GC | | | **unchanged** |

**Negative checks on the same real text (unit tests):**
- CPH, INC. as architect: rejected.
- Mathew D'Angelo (PH0.1's civil P.E.) as engineer: only a suggestion.
- PH0.1's 12/3/2025 as plan date: low confidence, flagged "the E title blocks mostly say 2025-09-22".
- Memphis owner office (123 S. Front St) as site: rejected.
- Rogers, AR engineer office (132 Kelley Drive) as site: rejected.

### Cost per bid
The call is estimated from the real prompt size on Kissimmee: ~3.8k input tokens and ~0.5k output tokens at Sonnet 5 list price ($2 / $10 per M), which is **~1.3¢**.

With low-effort adaptive thinking tokens and a larger cover, expect **1–3¢ per plan set**. A scanned set adds up to 4 image crops (~1.6k tokens each), which is about **+1–2¢**.

The sheet check's Haiku classification is unchanged and was already paid for by the sheet check.

### Tests (full suites, once, at the end)
| Suite | Result |
|---|---|
| Backend `npm test` | 2247 tests: **2240 passed, 3 failed, 4 not run** (209 files). The failures are the known, unrelated flakes documented earlier: `intakeSimilarCache` ×2, the `integration` lead-backfill timeout, and one "Worker exited unexpectedly". None touches this branch's files. |
| Frontend `npx vitest run` | 1335 tests: **1334 passed, 1 failed**. The failure is `SurveyMarkupEditor` "Escape exits full screen…", a gen-pipeline test this branch never touches; it passes when run alone, so it's a load flake. |
| `tsc --noEmit` | clean / clean |

**New or rewritten tests:**
- **Backend:**
  - `ai/jobProfile.test.ts` (48): real Kissimmee, plus every B4/B5 negative.
  - `estimating/jobProfileCardRules.test.ts` (14).
  - `test/jobProfileRoutes.test.ts` (13): real PDF, B3 re-run, S2, N5, ignore, S1 mid-run edit + Ignore, S3, S4 waiting and started check, S7, scanned, gc guard.
  - `test/analysisInputsScopeZip.test.ts` (2).
  - `test/bidProfileFieldsPatch.test.ts` (2).
  - `test/accountRulesOwnerName.test.ts` (1).
- **Frontend:**
  - Panel (9).
  - Estimating S5 / S6 / S9 / N3 (4) and `BidTabNoPlans` (1).
  - Overview edit form (1).
  - Settings model field (1).
  - Three existing tests updated for the S5 pre-tick.

### Notes for Jake
- **The unknown in the cost figure:** no real Anthropic call was made; the Kissimmee reply is mocked, grounded in the real text. The first live run should confirm that Sonnet 5 accepts the structured-output schema and returns the same grounded quotes.
- **Permissions:** the profile can start the sheet check itself, which is a Haiku classification, without `run_analysis`. This follows Decision 8 (bid-edit + `ai_enabled`).
- **Removing a per-sheet upload in Estimating:** it is unticked in Plan Files. Moving it to Trash still needs an admin, the same as every other document.

---

## Fix round 2 (review `44610fb`, "Round 2")

**Range:** `44610fb..HEAD` (5 commits including this report). **Migration:** 144 (`content_key`, `model_called_at`).

> **Headline (N-R2-4): the Kissimmee table below uses a MOCKED model reply.** The PDF text is real: it is read live through `extractPdfPageTexts`. The page selection, the validators and the route are the production code. The model's answer was written by hand and quoted verbatim from that text. No real Anthropic call has been made.

### What changed
- **R2-B1: fills now need the right block, not just a quote on the page.** The label check is column-aware and skips blank lines.
  - **Owner:** fills only with an OWNER / DEVELOPER / CLIENT label or heading. The nearest heading above the value decides, so CPH under ENGINEER is never the owner.
  - **Engineer:** fills only with an ENGINEER / ENGINEER OF RECORD label, or P.E. on the name itself.
  - **Architect:** fills only under an ARCHITECT heading that isn't LANDSCAPE / CIVIL / STRUCTURAL.
  - **Without its label**, each of these three is a suggestion only.
  - **Address:**
    - City, state and ZIP must be in the quote and match the value, or the address is rejected (this catches the Orlando swap).
    - A street near OWNER / DEVELOPER / "3rd Floor" / ATTN / corporate is an office and is rejected (this catches 123 South Front Street).
    - It fills only when the street is anchored under a project / site label or the project (STORE) line on a cover or title block; otherwise it's a suggestion.
  - **Plan-room stamps are never a party:** Dodge Data & Analytics, ConstructConnect, iSqFt, BidClerk, PlanHub, The Blue Book, BuildingConnected, "For Bidding & Contractor Information".
  - **Architect of record:** a cover that names a different architect / designer of record (Kissimmee's A-0 names RLBA) caps the architect at a suggestion.
- **R2-B2: never stuck.**
  - A sheet check still `running` after 10 minutes is stale and is re-run.
  - A profile `waiting` / `running` for more than 10 minutes becomes `error`.
  - On boot, both are marked interrupted.
  - The panel always offers "Read the plans again", even while waiting, and it sends `force: true`, which starts a fresh check for the same files.
- **R2-S1:** the run claim only succeeds while the run is `waiting` under its token, so concurrent runs or resumes make exactly one model call.
- **R2-S2: access and repeat calls.**
  - Reading the plans needs a bid-editing role (owner, admin, manager, estimator, sales, PM) or the AI `view_results` permission. `read_only`, technician and accounting get a 403.
  - The same plan set (content key) with the same model re-applies the stored reply without a model call, unless forced.
  - A forced re-read within 10 seconds of the last model call gets a 429.
- **R2-S3: a newer upload replaces the older plan set.**
  - Each input file carries its upload time.
  - The sheet check excludes a page whose sheet number a newer file also carries (higher revision in the name, else the newer upload). It never promotes that page to a reference, so `/analyze` never reads both copies.
  - Estimating unticks the replaced file and says "Elec Rev 2.pdf replaced Elec Rev 1.pdf for analysis."
- **R2-S4:** a date on a revision row is rejected, never just downgraded. That covers a REV / REVISION / △ / ADDENDUM label anywhere on the row, left or right, or a REV…DATE table header above it. A date labeled ISSUE / BID / PERMIT is preferred.
- **R2-S5: brands.**
  - The brand fills only from the project (STORE # / PROJECT:) line or the owner block.
  - When the project line names another client (Wawa), a known brand mentioned elsewhere is rejected.
  - SHARED / WITH / OUTPARCEL / FUTURE contexts are rejected.
  - An unknown project brand is a suggestion at most.
- **R2-S6: partly done.** When the bid's sheet check was made for another selection, the profile never claims that row. It reads the full plan set from the shared classification cache instead (`buildInventory`, keyed by content hash, no row write).
  - **Not done:** Estimating still keeps its selection-specific check. It does not yet use a single full-set check filtered by its selection, because that would change how its missing-reference / skip data works, and it's left for a follow-up.
- **R2-S7:** PATCH returns 400 for a date that isn't a real calendar date (2025-02-31 used to be a 500) and for text over 200 characters.
- **Nits:** a value that was filled, then edited, then cleared stays cleared. The Tommy's alias is narrowed to Tommy's Express / Car Wash. Covers come only from the newest upload batch.

### Every repro is a test
- **Real Kissimmee sources, reviewer's hostile high-confidence quotes:**
  - 123 South Front Street, 3rd Floor → not filled.
  - Orlando / 32801 swap → rejected (and no name suggestion).
  - Dodge Data & Analytics as engineer / owner → rejected.
  - CPH, INC. as owner → not filled.
  - AUTOZONE, INC. as architect → medium, because A-0 names a different designer.
- **Synthetic:**
  - SMITH ARCHITECTS LLC on every E title block → not filled as the EOR.
  - Wawa + "SHARED DRIVE WITH AUTOZONE" → no AutoZone.
  - Right-side revision label and REV/DATE header → never the plan date.
  - Tommy's Diner.
  - Older cover.
  - Edited-then-cleared.
- **Route:**
  - Concurrent run ×2 and resume ×2 → exactly 1 model call.
  - The `read_only` / technician / accounting / salesperson gate.
  - Dedupe, force, and the 429.
  - A stale running check that gets re-run; a same-key stuck wait → expiry → forced re-read; the boot reset.
  - Estimating's check row left untouched.
  - PATCH 2025-02-31 → 400 and a 201-character field → 400.
- **Sheet check:** Rev 2 replaces Rev 1.
- **Frontend:** Rev 1 unticked with the notice; "Read the plans again" while waiting and after an expiry.

### Kissimmee per field (real text path + validators; the model reply is MOCKED)
| Field | Value | Confidence | On the card |
|---|---|---|---|
| Brand | AutoZone (C0.1 "AutoZone Store No. FL10077", a STORE line) | high | **fill** |
| Project type | Retail (from the brand) | high | **fill** |
| Store # | 10077 (E-1) | high | **fill** |
| Prototype | 7N2-L (E-1) | medium | suggestion |
| Location | 2860 N Old Lake Wilson Rd, Kissimmee, FL 34747 (C0.1 quote with city / state / ZIP; the street sits under the STORE line on A-0 and E-1) | high | **fill** |
| Building SF | 7,381 (C2.1, "BUILDING AREA:") | high | **fill** |
| Plan date | 2025-09-22 (E-1 title block) | high | **fill** |
| Owner | AUTOZONE STORES LLC ("Owner / Developer:" label) | high | **fill** |
| Architect | AUTOZONE, INC. (under ARCHITECT, but A-0 names a different designer of record) | medium | suggestion |
| Engineer of record | DANNY E. DOSS P.E. ("ENGINEER:" label, E-1) | high | **fill** |
| Build type | — | — | empty |
| Bid name | AutoZone #10077 – Kissimmee, FL | — | suggestion |
| Systems | site lighting yes (E-7); fuel, fire alarm, generator, EV not shown | — | stored |
| GC | Summit GC | — | unchanged |

The location's own C0.1 quote has no label next to it. It fills because the same street is anchored under the project (STORE) line on A-0 and E-1, and the quote carries the city, state and ZIP. If the rule must be "the quoted occurrence itself is labeled", the location becomes a suggestion; it's a one-line change.

**Cost:** unchanged at about 1.3¢ per plan set on Sonnet 5 (mock-estimated: 3.8k tokens in, 0.5k out), realistically 1–3¢. A repeat read of the same plan set costs nothing (dedupe).

### Suites (once, at the end)
| Suite | Result |
|---|---|
| Backend `npm test` | 2269 tests: **2261 passed, 4 failed, 4 not run** (210 files). All failures are the known load-sensitive intake / integration tests: `intakeSimilarCache` ×2 and two lead follow-up tests in `integration.test.ts` (30 s timeouts), plus the usual worker crash. This round touched none of those files. |
| Frontend `npx vitest run` | **1338 / 1338 passed** (130 files). |
| `tsc --noEmit` | clean / clean |

---

## Fix round 3 (review `ff7a6aa`, "Round 3")

**Range:** `ff7a6aa..HEAD` (6 commits including this report). **Migration:** 145 (`bid_sheet_check.revision_decisions`, `bid_job_profile.forced_at`).

As in round 2, the Kissimmee checks use the real text path and validators with a **mocked** model reply. The Kissimmee result is unchanged from round 2:
- **Filled:** brand, project type, store #, location, SF, plan date, owner and engineer.
- **Suggested:** prototype, architect and name.

### R3-B1: a newer plan file is only proposed as a revision, never applied automatically
- **What was wrong:** the round-2 rule excluded a page whenever a later upload carried the same sheet number. Upload times always differ by milliseconds, so Building A lost to Building B, and a Site package lost its E-1 to a Building package.
- **What happens now:** `detectPlanRevisions` (in `services/sheetCheck.ts`) only proposes. A proposal needs:
  1. The same file-name stem, **or** at least 70% of the newer file's sheets matching by number **and** title.
  2. **And** evidence the file is newer: a higher revision on the same stem, a later date in the file name, or a separate upload batch more than 10 minutes later.
- **Never proposed:**
  - Different buildings (BLDG A / BLDG B), phases or packages (SITE vs BUILDING, CANOPY, SHELL …).
  - A sheet number printed with **different titles**. Both copies are kept, and the file is listed as a duplicate note.
- **Answering a proposal:**
  - **Replace:** only this answer excludes the older file's **matching** sheets. Sheets that only the older file has always stay.
  - **Keep both:** both files stay in the analysis.
  - Answers are stored per file pair (`bid_sheet_check.revision_decisions`) and audited, through `PUT /preconstruction/:bidId/plan-revisions` (same role gate as reading the plans).
- **Until every proposal is answered:**
  - `/analyze` returns **409 "Resolve plan revisions first"**. The check runs before the previous run is reset, and the pipeline refuses too.
  - Estimating keeps both files ticked, lists the proposal, and blocks Run AI with a link to the Overview.
  - The Overview panel shows "Rev 2 appears to replace Rev 1 (N matching sheets) — Replace / Keep both", plus the duplicate-sheet notes.
- **Tests:**
  - Building A/B, both dropped together and uploaded on different days.
  - Site Rev 3 vs Building Rev 1.
  - A multi-building prototype job.
  - A same-number sheet with a different title.
  - Rev 1 → Rev 2 proposed, then Replace vs Keep both.
  - A partial addendum (only E-2 is replaced).
  - Sheets that only the older file has.
  - Two files with no evidence of which is newer.
  - The route: 409, answer, audit and role gate.
  - The panel and Estimating UI.

### R3-S1: the engineer of record is the electrical engineer
A name is rejected, even with P.E. on it, if its own line or the nearest heading above it names STRUCTURAL, MECHANICAL, PLUMBING, FIRE PROTECTION / SPRINKLER, CIVIL, LANDSCAPE, SURVEY, GEOTECH, ARCHITECT or an M/P / MEP firm.
- **Tests:** "STRUCTURAL: JOHN SMITH P.E." (whole quote and quote cut down to the name), "MECHANICAL ENGINEER: ACME MEP, INC.", and a stacked FIRE PROTECTION heading. "ELECTRICAL ENGINEER: …" still fills.

### R3-S2: the address anchor must be a site / project label
- **Accepted anchors:**
  - PROJECT ADDRESS, SITE ADDRESS, PROJECT LOCATION, JOBSITE, or SITE:.
  - The line **directly** under the store / project line, unless that line sits in an owner / client block.
- **No longer an anchor:** a bare SITE or LOCATION heading.
- **Office markers:** CLIENT and OFFICE(S) were added (HQ, HEADQUARTERS and CORPORATE were already there).
- **Tests:**
  - Not filled: a consultant office under LOCATION, a CLIENT / OWNER-block headquarters under a STORE line, and a CORPORATE OFFICE line.
  - Still filled: the real labels and the store-line case, and Kissimmee is unchanged.

### R3-S3: forced re-reads
- A forced re-read no longer clears the page-classification cache. The cache is keyed by file content, so changed files are classified anyway.
- Forced re-reads are limited to **one per 2 minutes per bid** (429 otherwise), in addition to the 10-second model-call limit, and each one is audited.
- **Test:** a second forced re-read gets 429, a cache row survives, and there is one audit entry.

### Suites (once, at the end)
| Suite | Result |
|---|---|
| Backend `npm test` | 2284 tests: **2277 passed, 3 failed, 4 not run** (210 files). The failures are the known load flakes: `intakeSimilarCache` ×2 and the `integration` lead-backfill timeout, plus the usual worker crash. |
| Frontend `npx vitest run` | 1340 tests: **1339 passed, 1 failed**. The failure is the known `SurveyMarkupEditor` load flake (gen-pipeline, untouched; it passes when run alone). |
| `tsc --noEmit` | clean / clean |

**How the backend count was reached:** the first full backend run also failed `sheetCheck.test.ts` "no second classifier call" and `estimatingSheetsRoutes` (ECONNRESET under load).
- The `sheetCheck` failure was caused by this round's boot-reset test. It reset every running sheet check in the shared test DB, including other files' checks running in parallel.
- It's now scoped to its own bid (`d531d71`), and the backend suite was run again for the numbers above.
