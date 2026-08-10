# EV Charger Quotes in the Proposal Builder

**Date:** 2026-08-10
**Status:** Approved for implementation
**Depends on:** `feat/gen-custom-line-items` (PR #82) — reuses `CustomItem` and its helpers

## Problem

APT quotes Tesla Wall Connector installations often, but the CRM can only build generator
proposals. Charger quotes are produced outside the system, so they miss everything the
proposal pipeline provides: e-signature, countersignature, snapshots, Drive folders, the
award kickoff, and the won-job handoff.

The work is not a generator job in miniature. The customer buys the Wall Connector from
Tesla themselves, so APT sells the install alone, priced off one variable — the distance
from the breaker panel feeding it to the charger location.

## Solution

A second product type inside the existing proposal machinery, selected in the builder.

### Product type on the record

```sql
-- database/migrations/088_product_type.sql
ALTER TABLE generator_proposals
  ADD COLUMN product_type TEXT NOT NULL DEFAULT 'generator'
  CHECK (product_type IN ('generator','ev_charger'));
```

Every existing row backfills to `generator` through the column default; no data migration
runs. The table keeps its name — renaming a live table carrying signed contracts buys
nothing here.

Everything downstream of the proposal — signing, countersignature, snapshots, Drive
folders, won jobs, projects — operates on the row and its stored totals, not on generator
form fields, so those paths work for an EV row without modification. The exception is the
award kickoff email, handled below.

### Pricing

New `frontend/src/features/builder/evData.ts` and `evCalc.ts`, mirroring the existing
`genData.ts` / `genCalc.ts` pair.

Prices, taken from APT's public estimator at `accuratepowerandtechnology.com/TeslaCharger.asp`:

| Line | Price |
|---|---|
| Distance ≤ 5 ft | $675 |
| Distance 6–15 ft | $993 |
| Distance 16–25 ft | $1,275 |
| Panel/service upgrade to 200A | $2,200 |

The distance tier is a single required choice — exactly one tier is charged. The panel
upgrade is a checkbox, and is rare.

```ts
export interface EvForm {
  // Customer block — identical field names to GenForm so the shared proposal chrome and
  // customer autofill work unchanged. There is no taxRate: EV tax is a flat amount, so
  // the address→FL-rate derivation the generator form runs does not apply here.
  customer: string; attn: string; address: string; city: string; state: string;
  zip: string; phone: string; email: string;

  distanceTier: 'le5' | 'f6to15' | 'f16to25';
  panelUpgrade: boolean;

  customItems: CustomItem[];
  discount: number;
  discountType: '%' | '$';
  /** Flat dollar sales tax, not a rate — see below. */
  taxAmount: number;
  notes: string;
  includeBreakdown: boolean;
  validDays: number;
  depositPct: number;
}
```

**Runs longer than 25 ft** are quoted as the 16–25 ft tier plus a custom line item priced by
eye. No fourth tier and no per-foot rate: the estimator has no published price past 25 ft,
and inventing one would put a number on customer proposals that APT never agreed to.

**A second charger on one job** is likewise a custom line item. It is rare enough that a
quantity field on every quote would cost more attention than it saves.

### Sales tax — a flat dollar amount

EV quotes carry roughly $50 of tax, which is a passthrough of tax on materials rather than
a percentage of the contract. Modelling it as a rate would produce a different figure on
every quote and drift from what APT actually charges, so `taxAmount` is a flat editable
dollar field defaulting to `$50`, with a `ev_default_tax` setting behind it (the same shape
as `gen_default_labor` and its siblings).

This is the one place the EV calculator deliberately diverges from the generator one, which
splits a taxable goods base from a non-taxable services base. An EV quote has no meaningful
goods base to split — the customer already bought the only piece of equipment.

Custom line items on an EV quote therefore ignore their `taxable` flag for tax purposes:
the flat amount is the tax. The flag still stores whatever it was set to, and the breakdown
page prints no tax-status column on EV proposals, so the flag is simply not shown.

### Totals

```
base          = tier price
panelUpgrade  = 2200 when checked, else 0
customTotal   = sum of described custom items
subtotal      = base + panelUpgrade + customTotal
discountAmt   = discountType === '%' ? round(subtotal × discount/100) : discount
netSubtotal   = subtotal − discountAmt
tax           = taxAmount           (flat; never derived)
total         = netSubtotal + tax
deposit       = round(total × depositPct/100)
```

`depositPct` defaults to **0** for EV quotes — a job around $1,000 does not usually take a
deposit — against 50% for generators. It stays editable per quote, and a 0% deposit prints
no deposit line.

### The proposal document

`ProposalPreview.tsx` is roughly 1,500 lines and already carries more than one job. It will
not be forked.

Instead, the chrome it already contains gets extracted into
`frontend/src/features/builder/proposalChrome.tsx`:

- `PageHeader`, `SectionHeading`, `SigBlock`
- the page/doc style helpers (`embedFontSize`, `embedDocStyle`, `embedPageStyle`)
- the money formatters
- the disclosures and Sales Agreement pages, which are product-independent

`ProposalPreview.tsx` then imports them rather than defining them, and a new
`EvProposalPreview.tsx` composes the same chrome with EV-specific content. The generator
file gets smaller, and the two documents cannot drift apart on branding, signature blocks,
or terms.

**Scope of Work rows on an EV proposal:**

1. *Tesla Wall Connector Installation* — install a customer-supplied Tesla Wall Connector on
   a dedicated circuit from the existing panel: breaker, wire, conduit, mounting,
   terminations, testing and energization per 2026 NEC. States the quoted distance tier.
2. *Equipment — Customer Supplied* — the Wall Connector is supplied by the customer. APT
   furnishes all wire, conduit, breaker and mounting hardware.
3. *Service Upgrade to 200A* — only when the panel upgrade is selected.
4. *Additional Work Included* — the collapsed custom-item row, same treatment as generator
   proposals.
5. *1-Year Workmanship Warranty* — APT warrants the installation for one year. The Wall
   Connector itself carries Tesla's manufacturer warranty.
6. *Additional Notes* — when the notes field is filled in.

**Permits are not mentioned at all** on an EV proposal — no charge, no line, no disclaimer.

The price breakdown page (opt-in, as on generator proposals) lists the tier, the panel
upgrade when present, each custom item, the discount, the flat tax and the total. It has no
Tax Status column, since a flat tax has no per-row status to report.

Proposal numbers use the `JSEV` prefix: `JSEV-MMDDYYYY-###`, matching the existing
`JSKOHL` / `JSGNRC` format.

### Builder

`BuilderPage` gains a `Generator | EV Charger` switch at the top, shown **only when creating
a new proposal**. Opening a saved proposal opens it in its own type with the switch hidden:
flipping the type on a saved record would orphan its form data and, on a sent or signed
proposal, silently change what the customer was quoted.

The EV form is short — customer block, distance tier, panel upgrade, custom line items,
discount, tax, valid days, deposit, notes, breakdown toggle — so it renders as a single
column rather than the generator's multi-section layout.

### Pipeline

Cards carry a product-type badge, and the pipeline gains an `All / Generators / EV Chargers`
filter. The list, drawer and stage transitions are otherwise unchanged.

EV quotes live in the **Generators hub** for now, because that is where the proposal
pipeline lives. The hub label is a nav string; if EV volume justifies its own home later,
relabeling or moving it is a small change and not a reason to duplicate the pipeline now.

### Award kickoff email

`buildAwardKickoffEmail` hardcodes generator equipment and would email the ops team "We will
be installing a ." for a charger job. It gains an EV branch:

- Subject: `New EV Charger Install - <customer> - <city>`
- Body: the customer contact block, the quoted distance tier, the panel upgrade when
  selected, the notes, and the deposit line when one was taken.

The recipients, attachment kit and draft-never-send behavior are untouched.

## Testing

**`evCalc.test.ts`** — each distance tier prices correctly and only one is ever charged; the
panel upgrade adds $2,200; custom items fold into the subtotal; percentage and flat
discounts; the flat tax is never derived from the subtotal; deposit defaults to 0 and
computes from `depositPct` when set; a blank-description custom item contributes nothing.

**`EvProposalPreview.test.tsx`** — the scope rows render for each tier; the panel upgrade row
appears only when selected; the custom-item row collapses as on generator proposals; the
warranty row states one year; **no permit text appears anywhere in the document**; the
breakdown page lists the tier and flat tax and renders no Tax Status column.

**`proposalChrome` extraction** — the existing `ProposalPreview.test.tsx` suite must stay
green unchanged, which is what proves the extraction was behavior-preserving.

**Backend** — a proposal created without a `product_type` defaults to `generator`; the
kickoff email for an EV row states the charger scope and no generator equipment.

## Out of scope

- AI build-from-notes for EV quotes — its extraction prompt is generator-specific
- The lead site-survey wizard feeding an EV quote
- Powerwall, solar, and any other Tesla product
- A per-foot rate or fourth tier beyond 25 ft
- A quantity field for multiple chargers
- Renaming `generator_proposals`, or moving EV quotes out of the Generators hub
