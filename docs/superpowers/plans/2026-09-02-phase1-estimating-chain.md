# Phase 1 — Fix the Estimating Chain

**Date:** 2026-09-02
**Status:** Approved plan, pending implementation
**Planned by:** Fable 5 · **Execution:** Sonnet 5 · **Review:** Fable 5

## Problem

The estimating flow (pre-bid → plan analysis → scope → pricing → proposal) has six
correctness breaks, verified against the code:

1. **Multi-PDF runs lose most of Agent 1's output.** The batch merge at
   `preconstruction.ts:333-359` merges keys (`feeders, transformers, lighting, wire,
   sheet_inventory, project_info, …`) that `AGENT1_SYSTEM` never produces. The prompt's
   actual schema (`prompts.ts`) is `project, service, panels, equipment, quantities,
   allowances, ecfeciItems, flags, scopeNotes, missingSheets`. In batched mode only
   `panels` and `equipment` survive; `quantities`, `allowances`, `service`, `project`,
   `flags` are silently dropped. Single-PDF runs are unaffected — which is why this
   hasn't been obvious.
2. **The estimator's edited Scope of Work never reaches the proposal.** Agent 4 reads
   raw `agent2_output` (`preconstruction.ts:1232,1246`); the seven editable sections in
   `bid_workspaces.scope` (including anything imported from the pre-bid package) are
   discarded. Agent 1's context is also truncated to 8,000 chars (`:1265`).
3. **A "$" or comma in the proposal price crashes a completed AI run.** `price.trim()`
   (free text) is written into `agent4_price NUMERIC(12,2)` (`:1297`,
   `053_agent4_proposal.sql`). The error lands *after* the paid Agent 4 call. Separately,
   `proposalDocx.ts:200` falls back to `'TBD'` when the LLM drops `totalPrice`, and
   `bids.amount` is never synced from the proposal price.
4. **Pricing state silently resets on refresh.** `estimateOverrides`, `overheadPct`,
   `profitPct` are excluded from the workspace auto-save (`PcWorkspace.tsx:317-333`) and
   hardcoded back to `{}`/10/15 on restore (`App.tsx:126-129`) — even when
   `bid_estimates` holds the real values. Also, a takeoff category missing from the
   unit-cost library silently prices at $0 (`PcWorkspace.tsx:212`) and that too-low
   grand total then overwrites `bids.amount` (`estimates.ts:97-100`).
5. **The generated proposal is never filed.** `generate-docx`
   (`preconstruction.ts:1312-1364`) streams the buffer and keeps no record — no
   `documents` row, no Drive upload.
6. **Guardrail gaps.** `PUT /estimates/:bidId` does no input validation (NaN propagates
   into NUMERIC columns); `GET /costs` and `GET /intelligence/:bidId`
   (`preconstruction.ts:1033-1067`) skip the rep-ownership scoping every other
   estimating endpoint applies; any stage move off `lost` permanently nulls
   `loss_reason`/`competitor` (`bids.ts:139-143`); an unparseable pre-bid file imports
   as an empty success (`preconstruction.ts:645-687`).

## Ground rules for execution

- Branch: `feat/phase1-estimating-chain`. One commit per task below, imperative messages.
- TDD where a pure function is involved: write the test first, watch it fail, implement.
- **Read every file you touch before editing it.** Line numbers here were verified on
  2026-09-02 but may drift; anchor on the quoted code, not the numbers.
- Do not touch the generator (`gens`) pipeline, the four AI prompts' *content* beyond
  what Task 2 specifies, or anything in Phases 2–4 of the review (no takeoff-fidelity
  work, no docx-standard work, no delivery work).
- After each task: `cd backend && npm run typecheck && npm test`; frontend tasks also
  `cd frontend && npm run typecheck && npm test`. DB-gated tests skip without Postgres —
  that is expected locally; note it in the report.
- Write a feature report at `docs/superpowers/plans/2026-09-02-phase1-report.md` as you
  go (files changed, decisions, test evidence), following the style of
  `feature-report.md` in the repo root.

---

## Task 1 — Fix the Agent 1 batch merge

**File:** `backend/src/routes/preconstruction.ts` (merge block at ~333-359), new
`backend/src/ai/mergeAgent1.ts` + `mergeAgent1.test.ts`.

1. Extract the merge into a pure function `mergeAgent1Batches(batchResults:
   Record<string, unknown>[]): Record<string, unknown>` in `backend/src/ai/mergeAgent1.ts`.
2. Merge **generically instead of from a hardcoded key list** (so a custom
   `ai_prompt_agent1` override with extra keys still merges):
   - For every key present in any batch result: if the value is an **array**, concatenate
     across batches. If it is an **object** (e.g. `project`, `service`), take the first
     batch's value, then fill any empty/`""`/`0`/null fields from later batches
     (field-level first-non-empty). Scalars: first non-empty wins.
   - Keep the panel cross-reference behavior: a `panels` entry whose duplicate signature
     has been seen gets `cross_reference: 'CROSS-REFERENCE — VERIFY'`. **Note:** the
     Agent 1 schema's panel objects have no `source_sheet` field (that was the old
     schema); read the current schema in `prompts.ts` and build the signature from
     `name` + `location` (fall back to `name` alone when location is empty).
3. Tests (write first): two synthetic batch results shaped exactly like the
   `AGENT1_SYSTEM` schema. Assert: `quantities`, `allowances`, `flags`, `scopeNotes`,
   `ecfeciItems`, `missingSheets` all concatenate; `project` and `service` survive with
   batch-2 filling fields batch-1 left empty; duplicate panel tagged; an unknown extra
   array key from a hypothetical custom prompt still merges.
4. Fix the backward-compat write at ~450-458: `materials` currently reads `a1.lighting`,
   which never exists → always `[]`. Change it to `a1.quantities ?? []`. Leave
   `scope = a1.panels` as-is (legacy consumers).

## Task 2 — Make Agent 4 use the estimator's actual work

**Files:** `backend/src/routes/preconstruction.ts` (`run-agent4`),
`backend/src/ai/prompts.ts` (`AGENT4_SYSTEM`), new
`backend/src/ai/agent4Message.ts` + test.

1. Extract a pure builder `buildAgent4UserMessage(input)` into
   `backend/src/ai/agent4Message.ts`, where `input` carries `price`, `internalNotes`,
   `agent1Output`, `agent2Output`, `workspaceScope` (the `bid_workspaces.scope` object),
   and `savedEstimate` (the `bid_estimates` row or null).
2. In `run-agent4`, additionally load `bid_workspaces.scope` and the `bid_estimates` row
   for the bid, and pass them to the builder.
3. Message layout (in this order):
   - The existing price + internal-notes header.
   - **New block — only when at least one section is non-empty:**
     `--- ESTIMATOR-EDITED SCOPE OF WORK (AUTHORITATIVE) ---` listing each non-empty
     section as `<Title>:` followed by its text. Use the human titles from
     `frontend/src/features/preconstruction/constants.ts` `SCOPE_SECS`
     (A Service & Distribution, B Branch Circuits, C Lighting, D Low Voltage / Data,
     E Fire Alarm, F Site / Exterior, G Special Systems) — **emit titles, not letters**,
     because the CRM's letters do not match the proposal's A–F lettering (CRM F=Site maps
     to proposal D; CRM D=Low Voltage maps to proposal E; see the pre-bid design doc's
     "by meaning, not by letter" finding). Mirror that `SCOPE_SECS` list as a small
     constant in the backend module with a comment pointing at the frontend source —
     do not import across the package boundary.
   - **New block — only when an estimate exists:** `--- SAVED ESTIMATE (CONTEXT) ---`
     with grand total, overhead %, profit %, and category subtotals. Label it context:
     the price in the header remains the number to print.
   - The Agent 1 block, **cap raised from 8,000 to 100,000 chars**; when truncation
     occurs, append `\n[TRUNCATED — drawing analysis exceeded limit]` so it is visible
     rather than a silent mid-JSON cut.
   - The Agent 2 block, unchanged.
4. `AGENT4_SYSTEM` in `prompts.ts`: append one instruction paragraph: when an
   `ESTIMATOR-EDITED SCOPE OF WORK` block is present, its content is authoritative for
   the corresponding proposal sections — map each titled section into the A–F output
   section that matches its *meaning*, and prefer its wording over the Agent 2 scope;
   sections not covered by the block fall back to Agent 2 as before.
5. Tests (write first) for the builder: edited scope present → block appears with
   titles and only non-empty sections; all-empty scope → no block; estimate null → no
   estimate block; agent1 text over the cap → truncated with the visible marker; under
   the cap → untouched.

## Task 3 — Price handling that can't crash or ship "TBD"

**Files:** `backend/src/routes/preconstruction.ts` (`run-agent4`, `generate-docx`),
`backend/src/utils/proposalDocx.ts`, `frontend/src/features/preconstruction/PcWorkspace.tsx`
(Proposal tab price input), new `backend/src/utils/money.ts` + test (check first whether
a suitable parser already exists in `backend/src`; the frontend has `lib/money.ts` —
mirror its behavior where sensible).

1. `parseMoney(input: string): number | null` — strips `$`, commas, whitespace; returns
   null for non-finite or ≤ 0. Unit tests: `"$425,000"` → 425000, `"425000.50"` →
   425000.5, `"abc"`/`""`/`"-5"` → null.
2. `run-agent4`: parse the incoming `price` with `parseMoney`. Null → `400` with a clear
   message *before* stamping `agent4_status='running'` (mirror the ordering rule the
   prebid-analyze 503 test asserts). Store the parsed number in `agent4_price`; keep the
   raw trimmed string in the prompt so Agent 4 sees what the estimator typed.
3. On Agent 4 success, sync the pipeline: `UPDATE bids SET amount=$1 WHERE id=$2 AND
   deleted_at IS NULL` with the parsed number. (The estimate save already does this;
   the proposal is the later, more authoritative number.)
4. `generate-docx`: select `agent4_price` alongside `agent4_output`. Format it as
   `$X,XXX,XXX` (US locale, no cents when whole) and pass it into `buildProposalDocx`
   via `bidMeta` as the authoritative `totalPrice`, overriding the LLM echo — same
   pattern as `projectName`/`gcName`.
5. `proposalDocx.ts`: add `totalPrice?: string` to `BidMeta`; resolution order
   `bidMeta.totalPrice` → `data.totalPrice` → **throw** `new Error('Proposal has no
   price — re-run the proposal step')`. Delete the `'TBD'` fallback. The route already
   maps a build throw to a 500 with the message; that is acceptable.
6. Frontend Proposal tab: strip `$`/commas/spaces from the price input before POSTing
   (keep what the user typed in the box); surface the 400 message inline, not as a toast
   only.
7. DB-gated route test in `backend/src/test/` (follow `prebid.test.ts` harness
   patterns): garbage price → 400 and `agent4_status` untouched.

## Task 4 — Pricing state survives a refresh; $0 categories are loud

**Files:** `frontend/src/App.tsx` (restore block ~109-131),
`frontend/src/features/preconstruction/PcWorkspace.tsx`, new pure helper + test
(e.g. `frontend/src/features/preconstruction/estimateHydrate.ts`).

1. **Hydrate from `bid_estimates` instead of hardcoding.** No migration needed — the
   saved estimate already stores `overhead_pct`, `profit_pct`, and `line_items` with an
   `overridden` flag. Write `overridesFromEstimate(lineItems): Record<string, number>`
   returning `{ [category||item]: unit_cost }` for rows with `overridden: true` (the
   override key format already used by `estimateOverrides` — confirm the exact key
   composition in `PcWorkspace.tsx` before writing the helper). Unit-test it.
2. `PcWorkspace` already fetches the saved estimate; when it loads and the workspace's
   pricing state is still pristine (overrides empty, 10/15 defaults), apply
   `overhead_pct`, `profit_pct`, and the reconstructed overrides from the saved row.
   Do not clobber in-session edits: only hydrate when the local state is untouched.
3. **$0 warning.** In `buildLineItemsFromTakeoff` / the Pricing tab render: a line whose
   resolved unit cost is 0 and is not user-overridden gets a visible amber marker
   ("no unit cost") on the row, and a banner above the grand total: "N line items have
   no unit cost and are priced at $0 — the grand total is understated." Show the same
   count in the Save Estimate confirmation toast.
4. Frontend tests: the hydration helper; a render test asserting the banner appears
   when a category is missing from the library (follow existing PcWorkspace/PreBid test
   patterns for mocking `api`).

## Task 5 — File every generated proposal

**Files:** `backend/src/routes/preconstruction.ts` (`generate-docx`),
`backend/src/utils/storeDocument.ts` (read only — reuse).

1. In `generate-docx`, after a successful build and **before** `res.send`, persist the
   exact bytes that are about to be delivered:
   - `storeDocument` with category `'proposal'`, linked to the bid, filename
     `Proposal - <name> - YYYY-MM-DD.docx`. **Do not pass `replaceExisting`** — each
     generation is a new version; the Files tab becomes the version history.
   - Confirm `'proposal'` is in the current `documents.category` CHECK constraint
     (restated last in `082_prebid.sql`). If it is not, restate the constraint in full
     in a new migration — check the max existing migration number first and use the
     next one; the constraint must be restated, never amended (see the comment in 082).
2. Storage failure must not block the download: `catch` → `logger.error` → still send
   the file. (Same trade-off as `import-prebid`'s `keep()` — losing the download is
   worse than a missed filing.)
3. Fire-and-forget Drive upload of the same buffer to the bid's
   `drive_estimates_folder_id` via the existing `uploadFile` helper (mirror the scope
   JSON upload at ~476-501), same dated filename.
4. DB-gated route test: after `generate-docx` (with a stubbed `agent4_output` row and
   storage forced to the base64 fallback), a `documents` row with category `proposal`
   exists; generating twice yields two rows.

## Task 6 — Guardrails: validation, scoping, and honest failures

**Files:** `backend/src/routes/estimates.ts`, `backend/src/routes/preconstruction.ts`,
`backend/src/routes/bids.ts`, `frontend/src/features/preconstruction/PreBidUpload.tsx`.

1. **`PUT /estimates/:bidId` validation** (`estimates.ts:41-57`): reject non-array
   `line_items` (400); coerce each row's `qty`/`unit_cost` with `Number()` and 400 on
   any non-finite; require finite `overhead_pct`/`profit_pct` within 0–100 (400
   otherwise). Keep ownership scoping as the access model (a rep pricing their own bid
   is correct); the fix is validation, not a role gate.
2. **Rep scoping on `/costs` and `/intelligence/:bidId`** (`preconstruction.ts:1033-1067`):
   apply the same `ownScopeId` pattern used by `/comparables` (read how it derives and
   applies the scope around `:744` and copy it exactly): scoped users see only their own
   rows in `/costs`, and `/intelligence`'s GC/overall stats are computed over their
   scope. Extend the existing scoping test in `comparables.test.ts` (or a sibling) to
   cover `/costs`.
3. **Stop erasing loss data** (`bids.ts:138-144`): change the UPDATE so `loss_reason`
   and `competitor` are only *written* when the new stage is `lost`, and otherwise keep
   their existing values:
   `loss_reason = CASE WHEN $1='lost' THEN $3 ELSE loss_reason END` (same for
   `competitor`). Moving lost → due → lost again must not lose the reason recorded the
   first time. DB-gated test.
4. **Honest pre-bid import failures** (`preconstruction.ts:645-687`): the response gains
   a `warnings: string[]` field.
   - Takeoff file supplied but `parseTakeoffWorkbook` yields zero line items → warning
     "Takeoff workbook did not match the expected format — nothing was imported (the
     file was still saved to Files)".
   - Scope file supplied but the parse yields zero sections **and** empty meta → **skip
     the `bid_prebid_scope` upsert** (an empty row lets `prebid-analyze` burn a paid AI
     call on nothing) and add the equivalent warning.
   - Files are still stored via `keep()` in both cases.
   - `PreBidUpload.tsx`: render `warnings` in the existing amber error style.
   - Extend `backend/src/test/prebid.test.ts`: import a junk `.docx`/`.xlsx` → 200 with
     warnings, no `bid_prebid_scope` row, no `bid_takeoffs` row.

---

## Verification (whole phase)

1. `cd backend && npm run typecheck && npm test` — all green (DB-gated skips OK locally).
2. `cd frontend && npm run typecheck && npm test` — all green.
3. Manual trace (no live AI needed): confirm by reading the final code that
   (a) a two-batch merge preserves `quantities`; (b) `run-agent4`'s message contains the
   workspace scope block when sections are filled; (c) `"$425,000"` becomes `425000`
   before any DB write; (d) `generate-docx` writes a `documents` row; (e) a lost→due
   move keeps `loss_reason`.
4. Update the feature report with test counts and any deviations from this plan, with
   reasons.

## Out of scope (Phases 2–4 of the review — do not start)

- Text-extraction-first plan reading, DPI/tiling changes, title-block sheet
  classification, confidence end-to-end.
- Encoding the APT bid standard (boilerplate, section names, banned-string scrub,
  takeoff xlsx, pre-bid package generation) into `proposalDocx.ts`.
- Any delivery path (send email, public page, follow-up sweep), RFI rework, dead-column
  cleanup beyond what Task 6 touches.
