// Server-side projection of generator_proposals.form_data for the unauthenticated
// public proposal link (audit: Security #3, High; post-review fixes for B3/R1/R2/R3).
//
// R1/R2 (Opus re-review): the first version of this whitelist gated the price-
// breakdown fields on `includeBreakdown` and dropped the pre-unification legacy
// field names entirely. That broke two real things: (1) ProposalPublicPage.tsx
// falls back to `calcGenTotals(form)` / `calcEvTotals(form)`
// (frontend/src/pages/ProposalPublicPage.tsx:177-178, ":166-168" for EV) whenever
// a proposal has no `totals_data` snapshot — true for 6 of 31 live proposals at
// review time — and those functions read several fields the old whitelist
// dropped, producing a WRONG total and deposit on a page the customer can sign;
// (2) `migrateGenForm` (genCalc.ts:45-74) needs the five legacy aliases to still
// render old proposals' ATS/SMM/SurgePro scope lines, and the whitelist ran
// before migration ever saw them.
//
// R3: the `includeBreakdown` gate is also removed. `totals_data` — sent whole,
// unprojected, on the same route — already carries `laborAmt`, `permitAmt`,
// `startupAmt`, `discountAmt`, `subtotal`, `taxableBase`, `nonTaxableBase`, and
// `taxedAmount` (see GenTotals/EvTotals below), and ProposalPreview.tsx reads
// `totals.laborAmt`/`totals.permitAmt`/`totals.startupAmt` OUTSIDE the
// `{form.includeBreakdown && ...}` block (verified: all three appear before
// that block starts). So hiding the breakdown page was never a confidentiality
// boundary — the same dollar figures are already on the wire either way — and
// gating the raw form_data inputs on it only broke the totals fallback for no
// actual privacy benefit. The breakdown toggle stays a display choice.
//
// The only fields this module still excludes are genData.ts's own declared
// internal set — its exact comment, verbatim:
//   "Internal site-detail fields — not shown on the customer proposal, used for
//   the award kickoff email to the ops team." (genData.ts, directly above
//   feedFt/genSide/panelRel/panelFt in the GenForm interface)
// No other field in GenForm or EvForm carries a similar "internal"/"not shown"
// comment.
//
// Key list derivation (three sources, as required by the fix):
//   (a) every `form.*` ProposalPreview.tsx / EvProposalPreview.tsx read directly,
//       plus fields needed only transitively because those components call a
//       genCalc helper in their own render body (loadCenterFor(form) needs
//       coolingType; activeCustomItems(form)/customItemAmount(item) need
//       customItems and each item's own id/desc/amount/taxable).
//   (b) every input calcGenTotals / calcEvTotals (and the calc helpers they call:
//       getGenPrice, atsIncludedQty, evInstallPrice, activeCustomItems,
//       customItemAmount) read — the literal output of
//       `grep -oE "g\.[a-zA-Z]+" frontend/src/features/builder/genCalc.ts | sort -u`
//       and the same for `e\.[a-zA-Z]+` against evCalc.ts, both re-run against
//       this commit:
//         genCalc.ts g.*: atsQty, atsSize, battery, brand, coolingType,
//           customItems, depositPct, discount, discountType, emPanel, evCharger,
//           evChargerPriceOverride, evChargerTier, extraWire, extWarranty,
//           gasLine, genStand, jobType, labor, liftType, pad, permit, removal,
//           removalFee, silverServicePromo, size, smmQty, startup, surgeProQty,
//           taxRate (plus form.brand/coolingType/genPriceOverride/jobType/size
//           in the same file's other helpers — genPriceOverride included below).
//         evCalc.ts e.*: depositPct, discount, discountType, distanceTier,
//           panelUpgrade, taxAmount, tierPriceOverride.
//   (c) migrateGenForm's five legacy aliases (genCalc.ts:40-44, pre-ATS-
//       unification proposals): smm, surgePro, ats, lcATS, additionalATS.
const GEN_FORM_KEYS = [
  // (a) ProposalPreview.tsx — direct + transitive (coolingType, customItems)
  'customer', 'attn', 'address', 'city', 'state', 'zip', 'phone', 'email',
  'brand', 'size', 'atsQty', 'atsSize', 'jobType', 'validDays', 'depositPct',
  'smmQty', 'surgeProQty', 'silverServicePromo', 'extWarranty',
  'extWarrantyPromoStart', 'extWarrantyPromoEnd', 'genStand', 'evCharger',
  'evChargerTier', 'notes', 'includeBreakdown', 'taxRate', 'liftType',
  'extraWire', 'coolingType', 'customItems',
  // (b) calcGenTotals + its callees — the rest of the genCalc.ts g.* grep
  'battery', 'discount', 'discountType', 'emPanel', 'evChargerPriceOverride',
  'gasLine', 'labor', 'pad', 'permit', 'removal', 'removalFee', 'startup',
  'genPriceOverride',
  // (c) migrateGenForm legacy aliases
  'smm', 'surgePro', 'ats', 'lcATS', 'additionalATS',
] as const;

const EV_FORM_KEYS = [
  // (a) EvProposalPreview.tsx — direct + transitive (customItems)
  'customer', 'attn', 'address', 'city', 'state', 'zip', 'phone', 'email',
  'depositPct', 'validDays', 'panelUpgrade', 'notes', 'includeBreakdown',
  'distanceTier', 'customItems',
  // (b) calcEvTotals — the full evCalc.ts e.* grep
  'discount', 'discountType', 'taxAmount', 'tierPriceOverride',
] as const;

const CUSTOM_ITEM_KEYS = ['id', 'desc', 'amount', 'taxable'] as const;

function sanitizeCustomItems(items: unknown): unknown {
  if (!Array.isArray(items)) return items;
  return items.map(item => {
    if (!item || typeof item !== 'object') return item;
    const src = item as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of CUSTOM_ITEM_KEYS) if (key in src) out[key] = src[key];
    return out;
  });
}

/**
 * Projects a generator_proposals.form_data value down to the customer-safe
 * subset. `productType` selects the generator vs. EV-charger key list (the two
 * preview components — and their totals calculators — take different form
 * shapes). Returns the input unchanged if it isn't an object (null, etc.) —
 * callers should pass the already-parsed JSONB value.
 */
export function publicFormData(form: unknown, productType: string | null | undefined): unknown {
  if (!form || typeof form !== 'object' || Array.isArray(form)) return form;
  const src = form as Record<string, unknown>;
  const isEv = productType === 'ev_charger';
  const keys = isEv ? EV_FORM_KEYS : GEN_FORM_KEYS;

  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (!(key in src)) continue;
    out[key] = key === 'customItems' ? sanitizeCustomItems(src[key]) : src[key];
  }
  return out;
}
