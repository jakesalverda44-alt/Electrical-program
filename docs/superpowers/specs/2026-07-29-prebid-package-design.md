# Pre-Bid Package (Cowork Scope + Quantity Takeoff) — Design

**Date:** 2026-07-29
**Status:** Approved

## Problem

Every accepted bid invite starts with a Cowork plan-review pass that produces two files:
`<Job>_PreBid_Scope.docx` (internal scope narrative) and `<Job>_Quantity_Takeoff.xlsx`
(counted quantities with confidence flags). Today they live in `~/Downloads` and never
reach the CRM. The estimator wants them stored against the bid and compared against
similar past jobs — matched by project type and square footage — showing how much
bigger or smaller this job is, and where the scope and quantities differ.

## Findings that shape the design (verified against the code and seven real files)

1. **`parseTakeoffWorkbook` already parses this format.** `backend/src/utils/takeoffParse.ts`
   was written against these same Cowork workbooks — its comments reference "the car
   wash/self-storage ones", "(Conduit & Boxes Only)", and `normalizeCategory` special-cases
   `SITE / UNDERGROUND / ALLOWANCES` and `LOW VOLTAGE INFRASTRUCTURE`, which are the literal
   section headers in `AutoZone_Tavares_Quantity_Takeoff.xlsx`. `CATEGORY_RE` matches
   `1. SERVICE & DISTRIBUTION` as-is. This is a wiring job, not a new parser.

2. **The parser silently drops the highest-risk rows.** `takeoffParse.ts:220-221`:
   ```js
   const qty = Number(String(qtyRaw).replace(/,/g, ''));
   if (!Number.isFinite(qty)) continue;
   ```
   Any row whose QTY reads `VERIFY` or `NONE IDENTIFIED` is discarded. In the AutoZone
   file that is 7 line items, including **all three site/exterior lighting lines** (Type D
   and Type L wall packs, and the 209W pole fixtures), the underground service conduit,
   the general receptacle LOT, the transformer pad, and the allowances line. Stored as-is,
   that job's Site/Exterior Lighting category would read *empty*, and a comparison against
   a job that did have pole counts would show a fabricated −100% delta. Silently wrong is
   worse than absent; fixing this is a prerequisite, not an enhancement.

3. **Two smaller parser gaps.** The notes column regex is `/^(NOTES?|SOURCE\s*\/\s*NOTES)$/`
   but these files head that column `SOURCE / BASIS / NOTES`, so notes are dropped. The
   `CONF.` column (`FIRM` / `APPROX` / `VERIFY`) has no handling at all.

4. **`bid_takeoffs.bid_id` is `PRIMARY KEY`** (`078_bid_comparison.sql:13`), so a pre-bid
   and a final takeoff on the same job collide. `POST /:bidId/import-bid` upserts, so the
   final import would overwrite the pre-bid.

5. **The comparison corpus has to be the pre-bids themselves.** `bid_takeoffs` is populated
   only by "Import Finished Bid" and currently holds ~0–3 rows. Pre-bids arrive on every
   accepted invite at 4–10/month, in a consistent format, so pre-bid-vs-pre-bid comparison
   is viable from the second bid onward and reaches a useful corpus within a quarter.

6. **`/comparables` requires `b.amount IS NOT NULL AND b.amount > 0`**
   (`preconstruction.ts:687`; `/comparables-preview` carries the same filter at `:634`). Pre-bid corpus jobs have not been priced yet, so that filter
   would exclude exactly the rows the feature depends on. Pre-bid matching needs a relaxed
   variant.

7. **`PROJECT_TYPES` already covers the requested matching axis** —
   `car_wash`, `self_storage`, `retail`, `cstore_fuel`, … (`frontend/src/features/preconstruction/constants.ts:32`),
   and `bids.project_type` / `bids.brand` are both indexed (`078_bid_comparison.sql:7-8`).

8. **`docx` (v9) is a writer, not a reader.** `adm-zip` is already a dependency and a
   `.docx` is a zip containing `word/document.xml`, so scope parsing needs no new package.

9. **The Cowork scope sections are a fixed template, not per-job-type.** Verified against
   all three scope documents on hand — AutoZone (retail), Indian Oaks (self-storage) and
   Nick Moes — which carry byte-identical `A.`–`F.` headings: Service & Distribution /
   Branch Power / Lighting & Controls / Site Lighting, Underground Work & Allowances /
   Low Voltage Infrastructure / Project Coordination & Closeout. Section alignment across
   jobs is therefore safe.

10. **Cowork's section letters do not match the CRM's.** `SCOPE_SECS`
    (`constants.ts:44`) is live — it backs the Scope of Work tab (`PcWorkspace.tsx:1656`)
    and the overview summary (`OverviewTab.tsx:224`). Its letters mean different things:
    Cowork `D` is Site while CRM `D` is Low Voltage / Data; Cowork `E` is Low Voltage while
    CRM `E` is Fire Alarm. Aligning by letter would file site lighting under Low Voltage and
    low voltage under Fire Alarm — plausible-looking and wrong. The codebase already
    establishes the correct pattern: `buildScopeFromAgent2` (`PcWorkspace.tsx:117-127`)
    maps by meaning with a deliberate D/E/F crossover.

11. **Scope auto-fill is destructive today.** `PcWorkspace.tsx:362` merges
    `{ ...prev.scope, ...scopeFill }` on AI completion, overwriting any section the AI
    produced. Since the pre-bid lands before plan analysis runs, the AI would silently
    replace the Cowork-derived scope.

12. **`OFEI` vs `ECFECI` is a first-class cost driver.** The AutoZone scope carries an
   `ESTIMATING NOTE — SCOPE DEVIATION FROM STANDARD` block: AutoZone furnishes all gear,
   fixtures, controls and poles; APT installs only. An OFEI job's $/SF is structurally far
   below an ECFECI job's. Comparing the two unflagged yields a credible-looking wrong number.

## Decisions (user-confirmed)

- **Approach A — extend the existing subsystem** rather than build a parallel one.
- **Scope comparison: structural side-by-side always, AI summary as an optional button.**
- **New top-level "Pre-Bid" tab** in the estimating workspace, placed before Plan Review.
- **The final bid import must not overwrite the pre-bid.** Both are retained under
  different `kind` values; the pre-bid is the corpus.
- **The pre-bid scope populates the existing Scope of Work tab**, via an "Import from
  Pre-Bid" button mirroring the existing "Import from AI Takeoff". The pre-bid is a source
  for the real deliverable, not only something to look at.
- **Pre-bid scope wins over AI scope.** AI auto-fill becomes non-destructive, writing only
  sections that are still empty.

## A. Data model

Migration `082_prebid.sql`:

```sql
ALTER TABLE bid_takeoffs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'final'
  CHECK (kind IN ('prebid','final'));
ALTER TABLE bid_takeoffs DROP CONSTRAINT bid_takeoffs_pkey;
ALTER TABLE bid_takeoffs ADD PRIMARY KEY (bid_id, kind);
ALTER TABLE bid_takeoffs ADD COLUMN IF NOT EXISTS key_findings JSONB DEFAULT '[]';
```

Existing rows default to `'final'`, so no data changes and no read path breaks. The table
holds ~0–3 rows, making the PK swap near-zero risk.

Confidence and unresolved quantities need **no migration** — `line_items` is JSONB, so the
new keys are additive.

New table:

```sql
CREATE TABLE IF NOT EXISTS bid_prebid_scope (
  bid_id                UUID PRIMARY KEY REFERENCES bids(id) ON DELETE CASCADE,
  meta                  JSONB NOT NULL DEFAULT '{}',
  furnish_model         TEXT,
  furnish_note          TEXT,
  general_items         JSONB NOT NULL DEFAULT '[]',
  sections              JSONB NOT NULL DEFAULT '[]',
  ai_comparison         JSONB,
  ai_comparison_against UUID REFERENCES bids(id) ON DELETE SET NULL,
  ai_status             TEXT,
  ai_error              TEXT,
  source_file           TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);
```

- `meta` — GC, owner + contact, project address, engineer of record, plan dates, sheets
  reviewed, job number, prepared date.
- `furnish_model` — `'OFEI' | 'ECFECI' | 'mixed' | null`.
- `furnish_note` — the scope-deviation paragraph verbatim, so the UI can show the source
  rather than only the classification.
- `sections` — `[{ id: 'A', title: 'Service & Distribution', items: string[] }]`.
- `general_items` — the unlettered leading bullets (hours, permits, change-order terms).
- `ai_status` — `'idle' | 'running' | 'complete' | 'error'`, mirroring the `agent4_status`
  pattern at `preconstruction.ts:993`.

The same migration adds `prebid_takeoff` and `prebid_scope` to the `documents.category`
CHECK constraint, rewriting it in full from the `080` list (that constraint has been
rewritten five times — 068, 076, 077, 079, 080 — so it must be restated, not amended).

## B. Takeoff parser changes (`backend/src/utils/takeoffParse.ts`)

**Retain unresolved rows.** Replace the `continue` with a null-quantity record:

```ts
const n = Number(String(qtyRaw).replace(/,/g, ''));
const qty = Number.isFinite(n) ? n : null;
const qtyRawText = qty === null ? String(qtyRaw).trim() : undefined;
```
Rows are only skipped when the description is empty or the row restates the header.

**Type changes:**

- `TakeoffLineItem.qty: number | null`, plus optional `qtyRaw`, `confidence`
  (`'FIRM' | 'APPROX' | 'VERIFY'`), `qtyLow`, `qtyHigh`.
- `TakeoffCategory` gains `unresolvedCount: number`. `totals` sums numeric quantities only,
  so an unresolved item never reads as a zero.

**Column mapping:** add `/^(CONF\.?|CONFIDENCE)$/` detection; broaden the notes matcher to
accept a header containing `NOTES` with optional `SOURCE` / `BASIS` prefixes.

**Ranges:** parse `range 58–70` (en dash or hyphen) out of the notes into `qtyLow`/`qtyHigh`.

**Key findings:** capture the trailing `LEGEND & KEY FINDINGS` block into `key_findings`.

**Back-compatibility:** finished-bid workbooks carry no `CONF.` column and all-numeric
quantities, so the `'final'` path produces identical output. Existing `bid_takeoffs`
consumers must handle `qty: null` — `compareMath.ts` and `BidCompare.tsx` are updated to
skip nulls rather than coerce them.

## C. Scope parser (new `backend/src/utils/prebidScopeParse.ts`)

`adm-zip` → `word/document.xml` → ordered paragraphs with their `w:pStyle`. Pure function
`parsePrebidScope(buf: Buffer): ParsedPrebidScope`, no I/O, unit-tested against the real files.

- **Header meta** — leading non-list paragraphs matching `^([A-Z][A-Za-z ()./]{2,30}):\s*(.+)$`
  become `meta` keys (`GC`, `Owner`, `Project Address`, `Job Number`, `Plan Date(s)`,
  `Sheets Reviewed`, …).
- **Furnish model** — the paragraph following a heading matching `/SCOPE DEVIATION|ESTIMATING NOTE/i`
  is stored as `furnish_note`; `furnish_model` is `'OFEI'` when it matches
  `/\bOFEI\b|Owner Furnished/i` and `'ECFECI'` when it matches `/\bECFECI\b/i` without the
  former; both present without a deviation heading → `'mixed'`; otherwise `null`.
- **Sections** — a non-list paragraph matching `^([A-F])\.\s+(.{3,60})$` opens a section;
  subsequent `ListParagraph` paragraphs are its items.
- **General items** — `ListParagraph` items appearing after `SCOPE OF WORK` but before the
  first lettered section.

XML entities are decoded (`&amp;`, `&apos;`, `&quot;`) — the raw document contains them.

## D. Upload route

`POST /api/preconstruction/:bidId/import-prebid`, mirroring `/import-bid`
(`preconstruction.ts:528`). Accepts `takeoff` (xlsx) and `scope` (docx); either may be
omitted so a job with only one of the two still imports.

Behaviour:

1. Parse each supplied file.
2. Upsert `bid_takeoffs` with `kind='prebid'`; upsert `bid_prebid_scope`.
3. File both originals as documents through the existing `keep()` helper under the new
   categories.
4. **Auto-fill `bids.sq_ft` only when it is currently null** and the parser found a value.
   Comp matching is driven by `sq_ft`, so a missing value makes the feature inert. An
   existing value is never overwritten.
5. **Suggest, never auto-set, `bids.brand`.** The parser proposes a brand from the docx
   `Re:` line and returns it as `suggestedBrand` for the UI to offer as a one-click apply.
   Brand outranks project type in comp ranking, so a wrong auto-set would silently skew
   every future comparison.

## E. Comparison endpoints

**Guard existing joins.** `/comparables`, `/comparables-preview` and `/compare` each
`LEFT JOIN bid_takeoffs bt ON bt.bid_id = b.id`; each gains `AND bt.kind = 'final'` so a
bid holding both kinds cannot multiply rows. Without this, one job with two takeoffs
duplicates in the comparables list.

**New `GET /:bidId/prebid-comparables`** — the relaxed matcher. Same ranking as
`/comparables` (same brand ranks above same project type, then nearest `sq_ft`), but it
drops the `amount > 0` requirement and instead requires the candidate to have a
`kind='prebid'` takeoff row. Returns each comp's `sq_ft` alongside the subject's so the UI
can render the size delta. Row visibility keeps the existing `ownScopeId` scoping, so a
restricted rep cannot read another rep's jobs through this route.

**`GET /:bidId/compare` gains `?kind=prebid|final`** (default `final`, preserving current
behaviour) to select which takeoff rows to compare. Existing per-1000-SF normalization and
the category-union logic are reused unchanged.

## F. UI — `frontend/src/features/preconstruction/PreBidTab.tsx`

New `PC_TABS` entry `{ key: 'prebid', label: 'Pre-Bid' }` inserted before `takeoff`, plus
the key added to `PcTabKey` and to the `active_tab` validation at `App.tsx:102`.
`PcWorkspace.tsx` is already ~2,300 lines with an inline `switch` per tab; this tab is a
separate component file and its `case` is one line, so the file does not grow materially.

Panels, in order:

1. **Upload** — two drop targets (scope, takeoff), showing what is already on file.
2. **Package summary** — `meta` block, category rollup with per-category item and
   unresolved counts, and the `suggestedBrand` apply control when `bids.brand` is empty.
3. **Furnish-model banner** — shown when `furnish_model = 'OFEI'`, stating that gear and
   fixtures are owner-furnished and that $/SF will read low against ECFECI comps. Expands
   to `furnish_note`.
4. **Comparison** — comp picker from `/prebid-comparables`; selected comp renders the size
   delta (`this job is N% larger/smaller — 7,381 SF vs 5,900 SF`) and a per-1000-SF
   per-category quantity table with deltas.
5. **Scope side-by-side** — subject sections against the comp's, aligned by normalized
   title (never by letter — see finding 10), with sections present on only one side marked
   as gaps.
6. **Unresolved items** — every `VERIFY` / null-quantity row with its source note. This is
   the pre-bid's risk list and is the reason the parser fix matters.
7. **Analyze differences** — triggers the AI pass; renders `ai_comparison` when complete.

## G. Scope of Work population

The pre-bid scope feeds the existing Scope of Work tab rather than living only in the
Pre-Bid tab. New `buildScopeFromPrebid(sections)` in `PcWorkspace.tsx`, mirroring
`buildScopeFromAgent2` (`:104`), and an **"Import from Pre-Bid"** button rendered beside
the existing "Import from AI Takeoff" on the `scope` tab, shown only when a pre-bid scope
exists.

**Mapping — by meaning, not by letter** (finding 10):

| Cowork section | → `SCOPE_SECS` |
|---|---|
| A. Service & Distribution | **A.** Service & Distribution |
| B. Branch Power | **B.** Branch Circuits |
| C. Lighting & Controls | **C.** Lighting |
| D. Site Lighting, Underground Work & Allowances | **F.** Site / Exterior |
| E. Low Voltage Infrastructure | **D.** Low Voltage / Data |
| F. Project Coordination & Closeout | **G.** Special Systems |

`E. Fire Alarm` has no Cowork counterpart in any observed file and is left untouched.
Matching is on the normalized section title, so a heading whose wording drifts still lands
correctly; an unrecognized Cowork section is appended to `G` rather than dropped.

**Precedence.** The AI auto-fill at `PcWorkspace.tsx:362` becomes non-destructive: it
writes only sections that are currently empty, instead of `{ ...prev.scope, ...scopeFill }`
overwriting them. Because the pre-bid arrives before plan analysis runs, this keeps the
Cowork text — which carries the confidence flags and scope-deviation notes — from being
silently replaced by Agent 2 output. The explicit "Import from AI Takeoff" button keeps its
current overwrite behaviour, since that is a deliberate user action.

The toast follows the existing copy pattern: "Scope imported — filled from the pre-bid
package; review and edit as needed."

## H. AI scope comparison

New `PREBID_COMPARE_SYSTEM` prompt in `backend/src/ai/prompts.ts`, alongside the existing
four agents. `POST /:bidId/prebid-analyze?against=<bidId>` runs it asynchronously against
`ai_status`, matching the `run-agent4` pattern (`preconstruction.ts:993`).

- **Input:** both scope section sets, both category rollups (including unresolved counts),
  both `sq_ft`, both `furnish_model` values.
- **Output JSON:** `{ majorDifferences[], costDrivers[], missingScope[], notes }`.
- Reuses `callWithRetry` (`ai/retry.ts:35`) and the lenient extractor (`ai/json.ts:25`);
  model and token limits read from `app_settings` like the other agents.
- Gated by `requireAIPermission('run_analysis')`.
- On-demand only and cached to `ai_comparison` with `ai_comparison_against`, so it never
  runs on upload and re-running against the same comp is free.

The prompt is instructed to treat differing `furnish_model` values as a primary cost driver
and to say so explicitly rather than comparing quantities as though the two jobs bought the
same scope.

## I. Testing

- **Parser fixtures** — the four real workbooks (AutoZone, El Car Wash, Indian Oaks
  Self-Storage, Nick Moes) and the three matching scope documents, copied into
  `backend/src/test/fixtures/prebid/`.
- **Takeoff parser:** unresolved rows are retained with `qty: null`; the AutoZone file keeps
  all three site-lighting lines; `confidence` is captured; `qtyLow`/`qtyHigh` parse from
  `range 58–70`; `sqFt` resolves to 7,381; category `totals` exclude nulls while
  `unresolvedCount` counts them.
- **Regression:** an existing finished-bid workbook parses byte-identically to the current
  output, guarding the `'final'` path.
- **Scope parser:** sections A–F extracted with their items; `furnish_model = 'OFEI'` for
  AutoZone; meta keys populated; entities decoded. All three scope documents must yield the
  same six section titles, guarding the fixed-template assumption in finding 9.
- **Scope mapping:** `buildScopeFromPrebid` puts site lighting in `F` and low voltage in
  `D` — the crossover from finding 10, asserted explicitly so a future edit cannot quietly
  revert to letter alignment. `E` (Fire Alarm) stays empty. An unrecognized section lands
  in `G` rather than vanishing.
- **Precedence:** AI completion does not overwrite a section the pre-bid already filled;
  it still fills sections left empty; the explicit "Import from AI Takeoff" button still
  overwrites.
- **Route:** import with only one of the two files; `sq_ft` fills when null and is preserved
  when set; `brand` is never auto-written.
- **SQL:** a bid holding both `prebid` and `final` takeoffs appears exactly once in
  `/comparables`.

## Out of scope (YAGNI)

- Applying unit costs to pre-bid quantities to produce a price. The deliverable is a
  comparison, not an estimate.
- Changes to the four plan-analysis agents.
- Running the AI comparison automatically on upload.
- Backfilling historical jobs with pre-bid packages.
- Any pre-bid stage on the `bids` lifecycle enum — the pre-bid is a document set on an
  existing bid, not a new pipeline stage.
