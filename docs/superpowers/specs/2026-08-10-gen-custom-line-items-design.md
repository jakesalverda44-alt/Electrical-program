# Custom Line Items on Generator Proposals

**Date:** 2026-08-10
**Status:** Approved for implementation

## Problem

The generator proposal builder prices a fixed catalog: the unit, pad, ATS, SMM, surge
protector, battery maintainer, EM panel, lift, removal, labor, permit, startup. Anything
outside that list has nowhere to go. A customer who asks for a small extra — relocate a
hose bib, add a breaker, run an extra outlet — either gets left off the proposal or gets
buried inside the labor number, where the customer can't see it and the salesperson can't
justify it.

The salesperson needs to type a description and a price, and have it flow through the
proposal like any other line.

## Solution

A list of free-text line items on the generator form. Each item carries a description, a
dollar amount, and a flag for whether Florida sales tax applies to it.

### Data shape

`GenForm` gains one field:

```ts
export interface CustomItem {
  id: string;       // stable React key; survives row reorder and delete
  desc: string;
  amount: number;
  taxable: boolean;
}

// on GenForm
customItems: CustomItem[];
```

Items live inside the existing `form_data` jsonb column on `generator_proposals`. No schema
migration and no new table — the same way every other form field is stored.

`blankGenForm()` starts it at `[]`.

### Backward compatibility

`migrateGenForm` gains a clause:

```ts
if (!Array.isArray(out.customItems)) out.customItems = [];
```

Written as an `Array.isArray` check rather than an `undefined` check so that a saved
proposal holding a malformed value (null, an object, a string) also lands on a safe empty
list instead of crashing the builder. Every proposal saved before this feature reopens
identically to how it was saved, and every already-signed proposal renders unchanged.

### Calculation

Mirrored in both calculators, which must stay in step:

- `calcGenTotals` in `frontend/src/features/builder/genCalc.ts`
- `calcFormTotals` in `backend/src/routes/gens.ts`

Rules:

1. **Blank descriptions are ignored.** An item whose `desc` is empty or whitespace
   contributes nothing to any total and renders nowhere. A half-typed row can never move
   the price.
2. Items are split by their `taxable` flag into two sums, exposed on `GenTotals`:
   - `customTaxableAmt` — added to `taxableBase`, alongside the generator, pad, battery, ATS
   - `customNonTaxableAmt` — added to `nonTaxableBase`, alongside labor, permit, startup
3. `customTotal` (the sum of both) is exposed for display convenience.

Nothing downstream changes. Subtotal, the pro-rata discount split, the taxed amount, tax,
total and deposit are all already derived from `taxableBase` and `nonTaxableBase`, so
feeding the two new sums into those bases is the whole of the math change.

**Amount coercion:** `Number(item.amount)`; anything non-finite becomes `0`. Amounts are
dollars and are displayed through the same formatter as every other proposal amount, so an
item entered as `350` renders as `$350.00`.

**Row identity:** `id` comes from `crypto.randomUUID()` at the moment the row is added.
Array index is deliberately not used as the React key, since deleting a middle row would
otherwise shift the remaining rows' identity and carry input focus and state to the wrong
row.

**Negative amounts are allowed.** A negative item reads on the proposal as a named credit
("Courtesy credit — haul-off  −$200"), which the existing single unlabeled `discount` field
cannot express. Because the existing `taxedAmount` formula already clamps at zero, a
negative item cannot drive tax below zero.

### Builder UI

A "Custom Line Items" section in `BuilderPage.tsx`, placed with the discount and notes
fields rather than among the catalog add-ons, since these are per-job one-offs.

```
Custom Line Items
┌────────────────────────────┬─────────┬─────┬───┐
│ Relocate hose bib          │ $  350  │ [ ] │ ✕ │
│ Extra 60A breaker          │ $  185  │ [x] │ ✕ │
└────────────────────────────┴─────────┴─────┴───┘
  [+ Add Item]        checkbox = charge sales tax
```

Per row: a description text input (flexes to fill), a dollar amount number input, a taxable
checkbox, and a remove button. Below the rows, an "+ Add Item" button appends a blank row
with a fresh `id`. The checkbox column carries a short caption explaining that it charges
sales tax on that item, so the meaning does not depend on the reader knowing Florida tax
rules.

### Customer-facing proposal

`ProposalPreview.tsx` renders both the builder's live preview and the public signed
proposal page, so both surfaces change together.

**Page 1 — Scope of Work.** All custom items collapse into a *single* numbered row titled
`Additional Work Included`, whose description is a bulleted list of the item descriptions.
The row only appears when at least one item has a non-blank description.

One row rather than one row per item: page 1 is the page the customer signs, so the work
must be visible there — but N separate numbered entries would bury the actual generator
installation scope in a list of small extras. The row is positioned after the standard
scope entries and before "Additional Notes".

Prices do not appear on page 1, matching every other scope row.

**Page 2 — Price Breakdown** (rendered only when `includeBreakdown` is on). One row per
item: the label is the salesperson's description verbatim, the Tax Status column reads
`taxable` or is blank, and the amount is right-aligned — identical treatment to every
existing breakdown row.

### AI build-from-notes

`extractFormFromNotes` in `backend/src/routes/gens.ts` merges the model's JSON over a set of
safe defaults. `customItems` is **forced to `[]` after that merge**, and the field is left
out of the `BUILD_FROM_NOTES_SYSTEM` prompt.

The AI is not given a channel through which it can invent a priced line item on a customer's
proposal. A hallucinated `$400 panel relocation` in a proposal document is a materially
worse failure than the salesperson typing the item themselves.

## Testing

**`frontend/src/features/builder/genCalc.test.ts`**

- taxable items raise `taxableBase` and the tax; non-taxable items raise the total but not the tax
- a mix of both, with a discount applied, prorates the discount correctly across the bases
- an item with a blank description contributes nothing
- a negative item reduces the subtotal
- `migrateGenForm` on a legacy form yields `customItems: []`, and coerces a malformed value to `[]`

**`frontend/src/features/builder/ProposalPreview.test.tsx`**

- the "Additional Work Included" scope row appears with the item descriptions when items exist
- that row is absent when there are none, and absent when the only item has a blank description
- breakdown rows render with the right label, tax status and amount

**Backend** — `calcFormTotals` gets the same taxable/non-taxable split as the frontend. Its
only callers are the two AI-build paths, which always pass `customItems: []`, so this change
keeps the two calculators identical rather than fixing a live miscalculation.

## Out of scope

- Quantity or unit-price columns — the amount is the line total
- Reordering rows by drag
- Saved/reusable custom item templates
- Custom line items on electrical (non-generator) proposals
