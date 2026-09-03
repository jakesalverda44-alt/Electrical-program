# Phase 3 — The Bid Standard — Feature Report

## Summary

Implemented Task 0 (user-requested OneDrive-import removal) plus all seven
tasks of the approved plan
(`docs/superpowers/plans/2026-09-02-phase3-bid-standard.md`) on
`feat/phase3-bid-standard`, one commit per task, in order:

| Commit | Task |
|---|---|
| `c649014` | Task 0 — remove the dead "Import from OneDrive" button |
| `94ce4c1` | Task 1 — bid_data contract + boilerplate source of truth |
| `f9055e8` | Task 2 — port build_bid.js v4 into renderBidDocx |
| `740b149` | Task 3 — port build_takeoff.py into an exceljs takeoff builder |
| `6e6671b` | Task 4 — verification gate, ported from verify.sh v4 |
| `fdd8d98` | Task 5 — Agent 4's new data-only contract + legacy adapter |
| `90447e0` | Task 6 — generation flow: verify-gate, file everything, pre-bid package |
| `54a6138` | Task 7 — frontend: preview the new shape, surface the verify gate |

The CRM's proposal generator now matches the APT_Bid_System v4 architecture:
one composed `BidData` object feeds three deterministic renderers
(`renderBidDocx`, `renderTakeoffXlsx`, `renderPrebidScopeDocx`), and
`verifyBidDocx`/`verifyBidText` hard-gate the GC-facing docx and the pre-bid
package before anything is filed or downloaded. AI (Agent 4) fills
project-specific data only; code owns the boilerplate, the visual spec, and
the verification checks.

## Task 0 — Remove "Import from OneDrive" (user request)

The button's `onClick` (`onOpenImport`) was never actually wired up in
`App.tsx` — clicking it did nothing. Its `import-modal`/`ifile-*`/`extract-*`
CSS (the modal/flow it implied) was already fully orphaned, referenced by no
component. Removed the button and that dead CSS block.

**Deviation from the literal instruction, with reason:** the `newIncoming`
prop feeding the button's badge was *also* driving the Electrical nav item's
live unread-intake-email count (`App.tsx`'s `intakeCount`, backend
`/intake/unread-count`, `IntakeInboxPage`'s `onUnreadChange`) — a different,
staying feature (the Outlook email intake pipeline) that happened to share
plumbing with the dead button. Deleting `newIncoming` outright would have
silently killed that live badge. Renamed the prop `intakeUnread` instead of
deleting it, preserving the Electrical nav's unread-intake indicator while
still removing every trace of the Import button itself. No backend endpoints
were dedicated to the OneDrive-import concept (confirmed by grep before
removal), so nothing to delete server-side.

## Task 1 — bid_data contract and boilerplate source of truth

`backend/src/bidstd/bidData.ts` (`BidData`/`TakeoffCategory`/`Section`/
`Bullet` types, `validateBidData`) mirrors the skill's `bid_data.example.json`
field-for-field; that fixture is copied byte-for-byte into
`backend/src/test/fixtures/bidstd/` and round-trips clean through
`validateBidData`. `boilerplate.ts` copies `standardScope6`/`standardTerms`/
`SECTION_HEADERS`/`SECTION_LIMITS`/`CLOSING`/`PREBID_BANNER` verbatim from
PROJECT_INSTRUCTIONS.md §5/§8/§9/§10/§11, plus `jobNumber(date)` (local date
fields, never UTC). Migration `093_bid_standard.sql` adds `bids.job_number`
and restates `documents_category_check` in full (per 082's comment — never
amend), adding `'bid_data'`.

**Addition beyond the plan's literal validateBidData checklist:**
`validateBidData` also requires `terms.length === 10` (the plan's checklist
only named "missing required fields, non-6-bullet scope, empty sections").
Reasoned: `standardTerms()` always emits exactly 10, so any legitimately
composed `BidData` will always satisfy this — it's a low-risk, natural
extension of the same non-6-bullet-scope check, not a behavior change to
anything the plan specified.

## Task 2 — Port build_bid.js v4 into renderBidDocx

`backend/src/utils/proposalDocx.ts` was rewritten around
`renderBidDocx(data: BidData)`, a line-for-line port of `build_bid.js` v4:
NAVY `1F3864`/ACCENT `D9E1F2`, Arial 10/11/12pt, 440/160 band spacing, 40/80
bullet spacing, the `[620,3640,720,700,3680]` takeoff grid, Letter page with
1080/1440 margins, `keepNext`/`keepLines` everywhere v4 has it, 280×224
centered logo, 500×167 left-aligned signature, and the exact closing block.
Copied `APT_Logo_2026.jpg`/`Jake_2026_Signature.png` into `backend/assets/`;
the loader prefers them and falls back to the old `logo.png`/`signature.png`.

**Deviation, with reason:** `build_bid.js`'s `ImageRun` calls omit a `type`
field. The installed `docx` package here is 9.7.1, where
`RegularImageOptions.type` is **required** (`"jpg" | "png" | "gif" | "bmp"`,
not optional) — the skill script was evidently written against a different
docx version. Added extension-based `type` inference (matching the pattern
the pre-Phase-3 `proposalDocx.ts` already used) so the port actually compiles
and runs against this repo's dependency.

`buildProposalDocx(legacyJSON, meta)` was kept working throughout — a
transitional local adapter in Task 2, replaced in Task 5 by delegating to
`legacyProposalToBidData` (composeBidData.ts) once that existed, so there is
exactly one legacy-mapping implementation, not two.

## Task 3 — Port build_takeoff.py into an exceljs takeoff builder

`backend/src/bidstd/takeoffXlsx.ts`, `exceljs` added as a dependency. Ports
`build_takeoff.py` faithfully: GC mode (5 columns) vs `--prebid` mode (adds
CONF., FIRM green `E2EFDA` / APPROX+VERIFY yellow `FFF2CC`), auto-detected
FURNISH BY column (`wantsFurnish`, override via `opts.furnish`), the 8
standard categories in order with navy/ACCENT band rows, the
`building_area`/`interior_breakdown` header block (this is the *only* place
those two fields are ever read — `renderBidDocx` never touches them, which
is the actual mechanism enforcing "square footage never on the bid docx," not
a separate strip step), a NOTES block, landscape/fit-to-width. No
deviations from `build_takeoff.py`'s logic; the port is a straight
Python→TypeScript translation of the same column/fill/merge decisions.

## Task 4 — Verification gate, ported from verify.sh v4

`backend/src/bidstd/verifyBid.ts`. Per the plan's own environment note (no
LibreOffice in production — Aptfile is poppler-only), split the port into
`verifyBidText(text, kind)` — the pure, I/O-free core running the four
text-based checks (placeholders, banned language, square footage, ECFECI
count + placement) — and `verifyBidDocx(buffer, opts)`, a thin wrapper that
extracts docx text and *optionally* converts to PDF when `findSoffice()`
finds one (PATH, then `/Applications/LibreOffice.app/Contents/MacOS/soffice`);
a missing soffice is never a failure. verify.sh's OOXML-validation and
page-render checks don't apply to a buffer this repo just built with `docx`
(valid OOXML by construction) and aren't reproduced.

**Deviation, explicitly directed by the plan:** added word boundaries on
`\bRFI\b`, `\bcounted\b`, `\bTBD\b` so "Discounted"/"accounted" can't
false-positive — verify.sh's own `grep -E` banned-word check is a plain
substring match and has this exact bug today. Every other banned pattern
(phrases, `±`, `↳`, `SCWI`, `DQC`, the two disclaimer phrases) is unchanged
from verify.sh.

## Task 5 — Agent 4's new data-only contract + legacy adapter

`AGENT4_SYSTEM` rewritten (`prompts.ts`): Agent 4 now emits only
`plan_date, sheets[], sections[{title,bullets}], exclusions[],
allowances_bullets[], fixture_types[], takeoff[...], alternates[],
takeoff_notes[]` — no letterhead, no boilerplate, no total price. Locked
against drift by `prompts.test.ts` (asserts the 25%-deposit sentence, the
6-bullet opening, and the closing block are all *absent* from the prompt).
`agent4Message.ts` gained the shared `Agent4Output` type and
`isAgent4Shape()`, the single source of truth for the contract, used by both
`composeBidData.ts` and `run-agent4`'s new light shape check.

**Design choice beyond the plan's literal schema listing, with reason:**
Section C's fixture-type-list bullet and Section D's per-allowance bullets
are *not* free-form AI prose — `fixture_types[]` (raw type codes) and
`allowances_bullets[]` (already-templated strings) are separate fields that
`composeBidData` deterministically folds onto sections C/D. This is the same
"code renders, AI fills data" principle the whole phase is built on, applied
to the two most template-shaped bullets in the standard (a joined list, and
a fixed "XXX' allowance - description." pattern) — it reduces the chance the
model reformats them inconsistently across runs, and the plan's own schema
listing (`allowances_bullets[]`, `fixture_types[]` as top-level array fields,
separate from `sections`) supports this reading over trusting the AI to
splice them into bullet text itself.

`composeBidData()` (pure) merges the bid row (name/loc/gc/contact — same
authority `BidMeta` always had), the validated `agent4_price`, and Agent 4's
data into a full `BidData`; generates `job_number` once and reports back
(`jobNumberGenerated`) rather than writing to the DB itself, since the
function is pure — the caller (Task 6's route) persists it.
`legacyProposalToBidData()` is the one legacy adapter (Task 2's transitional
copy was removed here).

**Bug caught and fixed by the test suite:** `composeBidData`'s section-bullet
folding (`fixture_types`/`allowances_bullets` → sections C/D) initially
mutated the caller's `Agent4Output.sections[].bullets` arrays in place
(missing an array copy) — bullets accumulated across repeated calls sharing
a fixture object in tests. Fixed with `[...(s.bullets ?? [])]`.

## Task 6 — Generation flow: verify-gate, file everything, pre-bid package

`generate-docx` is now compose → render → `verifyBidDocx(kind:'gc')` (hard
gate: 422 + `failures[]`, nothing filed, docx never sent, on any failure) →
file the docx (version history, unchanged) + the composed `bid_data.json`
(new `bid_data` document category, `storeDocument.ts`'s
`CATEGORY_TO_FOLDER` extended) + the PDF when soffice produced one → stream.
New `generate-takeoff-xlsx` (GC mode, same composed data). New
`generate-prebid-package` ports `build_prebid.js`
(`backend/src/bidstd/prebidScopeDocx.ts` — banner, To/From/Owner/Engineer/
sheets header, no price/signature/takeoff-table/closing) + the `--prebid`
xlsx, filed under `prebid_scope`/`prebid_takeoff` with `replaceExisting`
(matching `import-prebid`'s convention); 400 when there's no scope data at
all.

**Design choice, with reason — "verify both" for the pre-bid package:** the
plan's Task 6.3 says "Verify both with kind:'internal'." `verifyBidDocx`
extracts `word/document.xml`, which doesn't exist in an xlsx's zip
structure — running it against the takeoff workbook would silently no-op
(empty text, no failures possible), not actually check anything. Since the
pre-bid *scope docx* never renders a takeoff table (by the standard's own
design — that's the xlsx's job), a placeholder in a takeoff item's
description/source would be invisible to a docx-only check. Implemented
"verify both" as: extract the scope docx's text, flatten every takeoff
item's text fields (`takeoffAsText`), and run `verifyBidText` (Task 4's pure
core, exported for exactly this kind of reuse) once over the concatenation —
full placeholder coverage across both deliverables, using the one text-based
core the plan already built, rather than a second docx-shaped check that
can't see xlsx content anyway.

`composeCurrentBidData` (shared by all three routes) also now queries
`bid_estimates.line_items` and passes it as `composeBidData`'s
`savedLineItems` — Phase 2's saved FIRM/APPROX/VERIFY confidence, preferred
over Agent 4's own echo, feeding the pre-bid xlsx's CONF. column. This is
harmless on the GC docx/xlsx paths since neither ever reads `conf` (Task 2/3
already enforce that structurally, not by stripping the field at compose
time).

**Existing tests updated (not weakened):** `proposalDocxConfidenceGuard
.test.ts`, `generateDocxStorage.test.ts`, and two tests in `prebid.test.ts`
previously exercised `generate-docx` with `'{}'` or thin 2-ECFECI fixtures —
harmless before Task 6's hard gate existed, but the gate correctly 422s them
now. Enriched each fixture to realistic gate-passing content (proper
section/ECFECI placement); every test's original assertion (no
FIRM/APPROX/VERIFY leak into the docx; storage failure doesn't block the
download; the proposal is filed) is unchanged and still holds — see
`git log -p` on those three files for the exact diffs.

## Task 7 — Frontend: preview the new shape, surface the gate

Chose the "new lightweight endpoint" option: `GET
/preconstruction/:bidId/proposal-preview` (thin — reuses
`composeCurrentBidData`, no render/verify/file). `PcWorkspace.tsx`'s
Proposal tab preview now renders straight off that composed `BidData`
(`bidDataPreview.ts`'s types + `bulletText()`), replacing the old ad-hoc
`propData`/`scopeOfWork` parsing entirely — this also means the frontend
needed no legacy-vs-new-shape branch of its own, since the backend's
adapter already normalized either shape. Added the red verify-failure panel
(check + matched text + "Re-run Agent 4" guidance) driven by a shared
`readBlobError` helper so a 422 from either `generate-docx` or
`generate-prebid-package` never fails silently, a "Download Takeoff (.xlsx)"
button, and an internal-labeled "Generate Pre-Bid Package for Chris" panel
that links both filed documents via the existing `/documents/:id/download`
route.

**File beyond the plan's literal single-file listing, with reason:**
`job_number` (Task 7.4) needed a place to be editable "following the
existing edit-form field pattern" — that pattern lives in
`frontend/src/features/bid-hub/OverviewTab.tsx` (the bid's Edit form,
`sq_ft`/`brand`/`project_type`), not in `PcWorkspace.tsx`. Added the field
there (view-mode display + edit-form row + PATCH payload) and to `bids.ts`'s
PATCH handler, in addition to the Proposal tab's read-only display of it.

## Boilerplate-drift test list

Every test below fails the moment its target string stops matching the
skill's verbatim text, which is the intended trip-wire:

- `backend/src/bidstd/boilerplate.test.ts` — `standardScope6` (all 6, exact
  order + substitution), `standardTerms` (all 10, exact order, the
  25%-deposit sentence specifically), `SECTION_HEADERS`, `SECTION_LIMITS`,
  `CLOSING` (all 7 strings), `PREBID_BANNER`, `TAKEOFF_COLUMNS_GC`,
  `TAKEOFF_CATEGORIES`, `jobNumber` formatting.
- `backend/src/ai/prompts.test.ts` — asserts `AGENT4_SYSTEM` contains
  *none* of the boilerplate strings above (the 25%-deposit sentence, the
  6-bullet opening text, the closing block, `rfisToResolve`/TBD-scope
  pattern) and *does* still carry the ECFECI/banned-word instructions.
- `backend/src/utils/proposalDocx.test.ts` — every `SECTION_HEADERS`
  constant and every `CLOSING` string present verbatim in the rendered
  fixture's extracted text; column-width grid exactly `[620,3640,720,700,
  3680]`; band cells centered; category bands span 5 columns.
- `backend/src/bidstd/prebidScopeDocx.test.ts` — the banner text verbatim;
  asserts the takeoff table/price/signature/closing strings are *absent*.
- `backend/src/bidstd/verifyBid.test.ts` — the fixture (built from the same
  canonical `bid_data.example.json`) passes the GC gate cleanly, proving the
  rendered boilerplate + a realistic Agent-4-shaped takeoff together satisfy
  every check verify.sh v4 enforces.

## Verification

1. **Both suites green**, worktree
   `/Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-phase3`:
   - Backend: **638 passed, 1 failed** (`npm test`) — the failure is the known
     pre-existing Kohler-funnel flake (`integration.test.ts`, "surfaces a
     needs-call Kohler lead..."), confirmed a flake by re-running that file
     alone (passes in isolation). Requirement was ≥470 with only that flake.
   - Frontend: **326 passed, 9 failed** (`npm test -- --run`) — all 9 are the
     known pre-existing failures (2 in `CustomerHub.test.tsx`, 7 in
     `useInstallPrompt.test.ts`), unrelated to this phase's files. Requirement
     was ≥315 with only those 9.
2. **End-to-end trace, by test (all passing, listed by file):**
   - compose→render→verify→file→stream:
     `backend/src/test/bidStandardGeneration.test.ts` — "the pass path files
     the docx AND the composed bid_data.json, then streams the docx."
   - a doctored "RFI" document blocked with a 422 listing the match: same
     file, "blocks a doctored document with 422 + failures[], and files
     nothing" — asserts `res.body.failures.some(f => f.check ===
     'banned_language')` and zero `documents` rows afterward.
   - the fixture bid renders a docx whose extracted text passes the same
     gate verify.sh v4 enforces: `backend/src/bidstd/verifyBid.test.ts` —
     "the fixture rendered by renderBidDocx passes the GC gate" (0
     failures).
   - the pre-bid package produces the internal banner + a CONF xlsx:
     `bidStandardGeneration.test.ts` — "files both deliverables under
     prebid_scope/prebid_takeoff... the xlsx has CONF." plus
     `prebidScopeDocx.test.ts`'s banner assertion.
3. This file — deviations (each with a reason) are in the per-task sections
   above; the boilerplate-drift test list is above.

## Safety confirmation

- Every test run in this session went through `npm test` (backend) or
  `npm test -- --run` (frontend) — never raw `vitest`. Confirmed the guard is
  live: an earlier accidental `npx vitest run` (without `NODE_ENV=test
  DB_NAME=electrical_crm_test`) was refused outright by `harness.ts`'s
  live-DB check ("Refusing to run tests against the live database
  \"electrical_crm\"") rather than silently running against it.
  Emails throughout are muted per the existing test harness (no
  `ANTHROPIC_API_KEY`/Graph mail configured in the test environment; routes
  that need them 503 synchronously, exercised by `prebid.test.ts`'s existing
  "passes validation but 503s" case, untouched this phase).
- No dev servers were started at any point.
- No commits touched `Local Version` or any other worktree — all work is on
  `feat/phase3-bid-standard` in
  `/Users/jakesalverda/Programs & Projects/APT Electrical CRM/Electrical-program-wt-phase3`.
- No pushes.
- The skill folder `~/.claude/skills/apt-electrical-bid/` was only read from
  and copied from (the fixture JSON, the two brand assets) — never modified;
  confirmed via `git status`/`git diff` scoped to this repo only (the skill
  folder isn't part of this repo).
- Working tree is clean at the end of this session (verified below).

## Post-review fixes

An adversarial review of the above (glue-code audit, not a re-check of the
ports themselves — those were found faithful) surfaced 13 defects. All 13
fixed on `feat/phase3-bid-standard`, seven commits, in order:

| Commit | Fix(es) |
|---|---|
| `319c452` | FIX-1, FIX-6, FIX-13 — ECFECI placement windows, internal-kind ECFECI count, `field verif\w*` |
| `1521b07` | FIX-2 — legacy `allowances[]` folded into Section D |
| `72df0c4` | FIX-7 (part 1) — Section C exact-3 rule; deleted dead `SECTION_LIMITS`/`TAKEOFF_COLUMNS_GC` |
| `c2e6d02` | FIX-8, FIX-10 — required brand assets; `APT_Bid_[Slug]_[Slug].docx` naming |
| `813b034` | FIX-3, FIX-4, FIX-7 (part 2), FIX-9, FIX-11 — pre-bid filing, takeoff-xlsx gate, `validateBidData` wiring, preview no longer writes, legacy price 422 |
| `41f03a0` | FIX-5 — repointed the confidence-guard test at a real leak vector |
| `3166659` | FIX-12 — busy-state on the .docx download button |

### FIX-1 (HIGH) — ECFECI placement no longer hard-blocks a legitimately omitted section

`verifyBid.ts`'s placement check hardcoded each window's terminator string
("B. Branch Power", "D. Site"). A bid that legitimately omits Section B or D
(e.g. an interior-only job) never contains that literal string, so the old
`between()` treated the window as "ECFECI missing" unconditionally — a
permanent 422 with no workaround short of inventing a section that doesn't
apply to the job.

Fixed: each window's terminator is now whichever `SECTION_HEADERS` marker
actually appears next in the text (in canonical A→B→C→D→E→F→exclusions→
takeoff→terms order), or end-of-text when none of the later markers appear at
all; a window whose *own* start marker is absent is skipped entirely rather
than counted as a failure. Verified: a compliant bid omitting Section D
passes, one omitting Section B passes, and ECFECI genuinely missing from
Section A still fails regardless of what's omitted around it
(`backend/src/bidstd/verifyBid.test.ts`).

### FIX-2 (HIGH) — legacy `allowances[]` no longer silently dropped

`legacyProposalToBidData` mapped the pre-Phase-3 `ProposalJSON` shape onto
`BidData` but never read `old.allowances` — the field wasn't even declared
on `LegacyProposalJSON`'s type, so a re-downloaded legacy proposal with
priced ALLOWANCES content lost it with no error, no warning, nothing filed
differently. Added the field and `formatLegacyAllowanceBullet()`, which maps
each legacy allowance onto a Section D bullet in the standard's own phrasing
(`"<footage>' allowance — <item>"`, the unit spelled out when it isn't LF,
notes appended parenthetically when present), appending to whatever D
already has or creating it — the same fold pattern `composeBidData`'s own
`allowances_bullets` handling already uses for the new shape. Verified: a
legacy row with allowances renders a docx whose text contains the allowance
line (`backend/src/utils/proposalDocx.test.ts`).

### FIX-3 (HIGH) — pre-bid regeneration no longer deletes imported pre-bid documents

`generate-prebid-package` passed `replaceExisting: true` to `storeDocument`
under the `prebid_scope`/`prebid_takeoff` categories — the exact same two
categories `import-prebid` files a human-uploaded pre-bid package under.
`replaceExisting` is `DELETE FROM documents WHERE linked_id=$1 AND
category=$2`, with no way to distinguish "the AI's own last generation" from
"what Chris uploaded by hand" — every regeneration silently destroyed the
estimator's imported documents. Fixed by dropping `replaceExisting`
entirely; each generation now files new dated rows (`<name> - <date>.docx`/
`.xlsx`), the same version-history convention `generate-docx` already used.
Verified: import-prebid document rows survive a `generate-prebid-package`
call — before/after row counts and IDs checked directly
(`backend/src/test/bidStandardGeneration.test.ts`).

### FIX-4 (MED) — `generate-takeoff-xlsx` now gated

The GC-facing takeoff spreadsheet shipped with no verification gate at all,
unlike `generate-docx` (which has always run `verifyBidDocx(kind:'gc')`).
Added `verifyBidText(takeoffAsText(bidData), 'gc')` before filing/streaming;
failure 422s with `failures[]` and files nothing, same response shape as the
docx path. Verified: a takeoff item carrying "TBD" blocks with 422 and files
nothing (`backend/src/test/bidStandardGeneration.test.ts`).

### FIX-5 (MED) — the confidence-guard test was vacuous; repointed at a real vector

The original test sent an old-shape `ProposalJSON` body whose `takeoff[]`
rows carried a stray `confidence` field — but `legacyProposalToBidData` (the
only code that ever reads an old-shape row) never mapped `confidence` onto
the composed item at all. The docx was guaranteed conf-free by construction;
the test could never fail regardless of whether `renderBidDocx`'s rendering
logic was correct. Repointed at the two real, live confidence paths: a
new-shape compose where a takeoff item carries Agent 4's own `conf` echo,
and — higher priority — a saved `bid_estimates.line_items` confidence value
that overrides it, both exercised, then `renderBidDocx`'s GC docx text
asserted free of FIRM/APPROX/VERIFY/VERIFIED/ASSUMED. Kept a legacy-shape
case too (cheap, and still a real if narrower guarantee, since that path
structurally can't carry `conf` through at all)
(`backend/src/test/proposalDocxConfidenceGuard.test.ts`).

### FIX-6 (MED) — internal documents keep the ECFECI count check (coordinator decision)

**Divergence disclosure, both directions:**

1. **verify.sh v4 runs its ECFECI ≥3 occurrence-count check on every document
   it verifies** — GC-facing or internal — with no kind distinction in the
   shell script at all. The original port had `verifyBidText`'s `kind:
   'internal'` branch skip the count check entirely alongside
   banned-language/square-footage, which was *not* faithful to verify.sh:
   the pre-bid scope carries Sections A–F (PROJECT_INSTRUCTIONS §14) and is
   expected to keep the ECFECI language just as much as the GC bid. Restored
   per the coordinator's decision: the count check now runs for both kinds.
2. **The ECFECI mandated-placement-window check (between Section A/B and
   between C/D) is this port's own invention, beyond verify.sh** — there is
   no such check anywhere in `verify.sh`; it was added during Task 4 per the
   plan's own instruction (PROJECT_INSTRUCTIONS §7's placement guidance) as
   a stricter GC-facing rule. It stays GC-only: the pre-bid scope is
   internal working content for Chris, not the two most price-sensitive,
   customer-facing sections the placement rule is really about.

Internal-kind tests updated to assert both halves of this: an internal doc
still fails when its ECFECI count is under 3, and an internal doc is *not*
held to the placement windows (3+ mentions anywhere is enough)
(`backend/src/bidstd/verifyBid.test.ts`).

### FIX-7 (MED) — `validateBidData` wired in; Section C rule added; dead constants removed

`validateBidData` (`bidData.ts`) was fully-implemented dead code — nothing
in the app ever called it, despite a route comment in `preconstruction.ts`
claiming it "runs on the COMPOSED BidData in generate-docx." Wired it into
`composeCurrentBidData` (the one function shared by all three generate
routes), applied to the new-shape (`composeBidData`) path only — a legacy
row was never subject to this gate, per `legacyProposalToBidData`'s own
docstring, and stays exempt. `generate-docx` and `generate-takeoff-xlsx`
(both GC-facing, subject to the standard's non-negotiables) validate by
default; `generate-prebid-package` opts out (`validate: false`) since it's a
deliberately more lenient internal deliverable with its own existing, more
specific "no scope data" 400. Failures surface as `422
{failures:[{check:'data', detail}]}`. Fixed the stale route comment to
describe what actually runs now.

Added rule while there: **Section C, when present, must have exactly 3
bullets** — the standard's one non-negotiable exact count
(PROJECT_INSTRUCTIONS §6). Also deleted `SECTION_LIMITS` and
`TAKEOFF_COLUMNS_GC` (`boilerplate.ts`) rather than wire them to nothing
meaningful: both were dead constants exercised only by their own
drift-lock tests, and `TAKEOFF_COLUMNS_GC` had gone stale — it locked
`'SOURCE / NOTES'` as the takeoff xlsx's column headers, but
`takeoffXlsx.ts` has emitted `'SOURCE / BASIS / NOTES'` since Task 3, so the
test was green while asserting something false about the actual xlsx
output.

### FIX-8 (MED) — missing brand assets now throw instead of silently degrading

`proposalDocx.ts`'s `loadLogo`/`loadSignature` fell back through a chain of
old filenames (`logo.png`, `signature.png`, ...) that `build_bid.js` has no
equivalent of at all — its own `image()` helper is a bare
`fs.readFileSync(file)` with no existence check, so a missing asset throws
there. An environment missing `APT_Logo_2026.jpg`/`Jake_2026_Signature.png`
would silently render old branding (or none) at the 2026 layout's fixed
280×224/500×167 dimensions, with no signal anything was wrong. Matched
build_bid.js's strictness: `loadRequiredAsset` now throws a clear "Required
brand asset missing: `<file>` (`<label>`) — expected at `<path>`" error,
surfacing as the route's existing 500 "Document build failed" — deleted the
invented fallback chain.

### FIX-9 (LOW) — preview no longer writes to the database

`GET /proposal-preview` shared `composeCurrentBidData` with the generate
endpoints, including its "persist a freshly-generated job number" branch —
a GET request writing `bids.job_number`. Added a `persist` option (default
`true`); the preview route now passes `persist: false`, showing the
would-be job number (still computed — `composeBidData`/`jobNumber` is pure)
without stamping it onto the row. Persistence stays exclusive to
`generate-docx`/`generate-takeoff-xlsx`/`generate-prebid-package`. Verified:
preview returns a well-formed job number while `bids.job_number` stays
`NULL` (`backend/src/test/bidStandardGeneration.test.ts`).

### FIX-10 (LOW) — bid docx filenames follow the standard's naming

Generated proposals were always named `Proposal - <bid name>.docx`,
ignoring `project_slug`/`location_slug` already sitting on the composed
`BidData` unused. Added `bidDocxFilename()`, building
`APT_Bid_[ProjectSlug]_[LocationSlug].docx` per PROJECT_INSTRUCTIONS §15's
deliverables table (matching the desktop skill's own examples, e.g.
`APT_Bid_SampleProject_Eustis.docx`) — `output_filename` wins when set on
the data, and it falls back to the pre-existing `Proposal - <name>.docx`
naming when a slug comes out blank. The ASCII header-safety strip (HTTP
headers must be Latin-1) is kept, applied on top of whichever name is
chosen.

### FIX-11 (LOW) — legacy path with no price now 422s instead of 500ing

The new-shape branch of `composeCurrentBidData` has always required a
DB-validated `agent4_price` before returning, 422ing otherwise; the legacy
branch had no equivalent guard, so a legacy row with neither `agent4_price`
nor its own embedded `totalPrice` string sailed through only to blow up
later as an uncaught 500 inside `renderBidDocx`'s own "Proposal has no
price" throw. Same 422, same message, as the new path now.

### FIX-12 (LOW) — busy-state on the .docx download button

`downloadDocx` (`PcWorkspace.tsx`) had no busy-state, unlike its
`downloadTakeoffXlsx`/`generatePrebidPackage` siblings — a double-click
could fire two overlapping `generate-docx` requests, each filing its own
copy. Added `docxBusy`, set/cleared around the request identically to the
xlsx button, with a "Building…" label while in flight.

### FIX-13 (LOW) — "field verify" banned-language check extended to inflected forms

`/field verify/gi` didn't catch "to be field verified," "field
verification," etc. — the exact same estimator-language meaning, just
inflected. Changed to `/field verif\w*/gi`, consistent with the existing
RFI/counted/TBD word-boundary tightening (documented deviations from
verify.sh's plain substring matching, same reasoning).

### Verification (post-review fixes)

- **Backend**: `npm test` — **659 passed, 1 failed** (the same known
  pre-existing Kohler-funnel flake, `integration.test.ts`; re-confirmed
  unrelated to this round by running it against the pre-fix commit
  (`4feea63`) in a scratch worktree — identical failure there, no file this
  round touched is anywhere near it).
- **Frontend**: `npm test -- --run` — **326 passed, 9 failed**, all 9 the
  same known pre-existing failures (2 in `CustomerHub.test.tsx`, 7 in
  `useInstallPrompt.test.ts`).
- Full `tsc --noEmit` clean on both sides.
- Working tree clean at the end of this round; no pushes; no dev servers
  started; no live-DB access (same `harness.ts` guard as the original
  session).
