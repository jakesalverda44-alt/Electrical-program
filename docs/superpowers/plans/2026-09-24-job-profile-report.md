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
