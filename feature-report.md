# GC Name Canonicalization — Feature Report

## Summary

Implemented per the approved design: pure-function GC/customer name matching (`backend/src/utils/customerMatch.ts`), a `resolveCustomer()` wrapper in `customers.ts` that uses it against the DB with find-or-create fallback, wired into the two pipeline-entry points (`POST /bids`, `POST /intake/:id/accept`), plus a GC autocomplete on the manual Add Bid form. `gens.ts` (type `'customer'`) was left completely untouched — only imports/behavior for type `'gc'` changed.

## Files changed

- `backend/src/utils/customerMatch.ts` (new) — `normalizeCompanyName`, `extractCandidates`, `matchCustomer`. No DB, no I/O.
- `backend/src/utils/customerMatch.test.ts` (new) — 20 unit tests, written first (TDD).
- `backend/src/routes/customers.ts` — added `resolveCustomer(name, type)` (exported, calls `matchCustomer` then falls through to existing `upsertCustomer`) and `GET /meta/gc-names` (registered above `GET /:id`).
- `backend/src/routes/bids.ts` — `POST /` now calls `resolveCustomer(gc, 'gc')`; `bids.gc` is set to the returned `canonicalName` instead of the raw trimmed input.
- `backend/src/routes/intake.ts` — `POST /:id/accept` same swap for the `bids` insert's `gc` column. `intake_items.gc` is intentionally left storing the reviewer's raw confirmed text (unchanged), per design — only `bids.gc` is canonicalized.
- `backend/src/test/integration.test.ts` — added `describe('GC name canonicalization (integration)')` with 2 tests (both `ctx.skip()` without a DB, run in CI): variant-spelling collapse through `POST /bids` twice, and a junk-wrapped intake string through `POST /intake/:id/accept`.
- `frontend/src/features/pipeline/AddBidModal.tsx` — GC input gets `list="gc-options"` fed by `GET /customers/meta/gc-names`, fetched once on mount, silent-fail catch — mirrors the existing Brand field pattern exactly.
- `frontend/src/features/pipeline/AddBidModal.test.tsx` — updated the two existing mocks to a 3-way URL branch (brands / gc-names / comparables-preview, since a naive 2-way branch would have handed the preview-shaped object to `setGcNames` and blown up `new Set(...)` on render) and added 2 new tests (datalist populates; silent failure).

## TDD evidence

`customerMatch.test.ts` was written and run against a stub-free file first; several of my own initial test expectations were wrong on first principles reasoning (not caught by a red/green cycle against real code, but by hand-tracing the suffix-stripping regex before finalizing) — corrected before implementation:
- `Acme Contracting Group, Inc.` needs the suffix regex's trailing part to consume leftover commas (`[.,]*\s*$`, not `\.?\s*$`) so iterative stripping across `Inc.` → `Group,` → `Contracting` actually chains.
- Apostrophes must be deleted, not turned into a space separator (`Sonny's` → `sonnys`, not `sonny s`).
- An "ambiguous containment" test using `Ajax Electrical Contracting` was wrong because `Contracting` is itself a stripped suffix, so it collapsed to an *exact* match instead of an ambiguous containment — replaced with `Ajax Electrical Roofing` / `Ajax Electrical Supply` (neither word is a suffix).

Final run: `npx vitest run src/utils/customerMatch.test.ts` → 20/20 passed on the first run of the corrected suite against the real implementation.

## Design decisions / interpretation calls

1. **`customers` table has no `deleted_at` column** (confirmed via `database/migrations/028_create_customers.sql`) — `resolveCustomer` loads all customers of the given `type`, no soft-delete filter needed (spec said "non-deleted"; there's nothing to filter).
2. **Substantiality guard applies to exact matches too, not just containment.** The design said "min 2 tokens or ≥5 chars" for containment specifically, but the worked example `"ABC" vs ["ABC Builders","ABC Roofing"] → null` only produces null if the guard also blocks *exact* matches: `ABC Builders` normalizes to exactly `"abc"` (since `builders` is a stripped suffix), which would otherwise be a clean 1-hit exact match, not an ambiguous one. Applying the guard uniformly (both candidate and existing-name normalized forms must be substantial before either match phase runs) makes that test case null for the intended reason (junk-short-candidate) rather than by accident of ambiguity, and doesn't break any of the design's other worked examples.
3. **`extractCandidates` junk-outer handling drops the full string, not just "the outer".** Interpreted "drop the junk outer" as: when the paren-stripped remainder is pure junk, the whole-string candidate is unreliable (it's junk-prefix + real name) so only the parenthetical survives as a candidate — this is also what makes candidates[0] the right create-name in `resolveCustomer`'s fallback path.
4. **`resolveCustomer` calls `pool.query` directly** (not the caller's transaction `client`) inside `intake.ts`'s `accept` handler — this matches the pre-existing `upsertCustomer` call it replaced (which had the same characteristic), so it's not a new inconsistency.
5. Left `intake_items.gc` storing the raw/reviewer-edited text untouched — design explicitly scoped canonicalization to `bids.gc` display, and intake's existing comment about that column feeding future sender-domain matching implies it should stay closer to what was literally seen/confirmed.

## Edge cases considered

- Blank/`'—'` GC input → `resolveCustomer` returns `null` immediately, same short-circuit as old `upsertCustomer` (bids.ts already guards `!gc?.trim()` before this is reached; intake.ts guards `!gc`).
- Short/generic candidates (e.g. 2-letter names) never match via the pure functions, but the DB's `ON CONFLICT (LOWER(name), type)` unique index on `customers` still prevents literal duplicate rows even in that path — the create-fallback in `resolveCustomer` will still land on the same row via the DB constraint, just without going through the fancy-match code path (rare edge case, not covered by a test, not expected in real GC names).
- Nested/multiple parentheticals: `extractCandidates` only inspects the *first* `(...)` group (non-nested regex) — good enough for the observed real-world shapes ("Estimating Department (X)"), not a general parenthesis parser.
- Exact-match and containment ambiguity (2+ hits) both resolve to `null` (create fallback), never guess.

## Checks

- `cd backend && npm run typecheck` — clean.
- `cd backend && npm test` — 152 passed, 37 skipped (all `integration.test.ts`/`comparables.test.ts`/`bids.brand.test.ts` DB-gated tests skip locally, no Postgres available in this environment — no `docker`/`postgres` daemon running here to force a real run; traced the new integration tests by hand against the unit-tested pure functions and existing harness patterns).
- `cd frontend && npm run typecheck` — clean.
- `cd frontend && npm test` — 62 passed, 0 failed.

## Commits

- `dc9...` (see `git log -1`) — single commit, imperative message, on `feat/gc-canonicalization`. Not pushed.
