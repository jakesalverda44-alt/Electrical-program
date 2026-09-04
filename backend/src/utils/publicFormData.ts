// Server-side projection of generator_proposals.form_data for the unauthenticated
// public proposal link (audit: Security #3, High; post-review fix for B3 — the
// column-list fix alone still shipped form_data whole, carrying fields the
// codebase itself labels internal plus the full price decomposition the rep
// chose to hide).
//
// Whitelists exactly the keys ProposalPreview.tsx / EvProposalPreview.tsx read —
// directly, or via a genCalc helper they call in their own render body
// (loadCenterFor needs coolingType; activeCustomItems/customItemAmount need
// customItems and each item's own id/desc/amount/taxable). Internal site-detail
// fields (feedFt, genSide, panelRel, panelFt — genData.ts's own comment: "not
// shown on the customer proposal, used for the award kickoff email to the ops
// team") are dropped unconditionally. The price-breakdown component fields are
// dropped whenever the rep left "Include Breakdown" off, so hiding that page is
// not merely cosmetic — the raw numbers never leave the server either.
const GEN_FORM_KEYS = [
  'customer', 'attn', 'address', 'city', 'state', 'zip', 'phone', 'email',
  'brand', 'coolingType', 'size', 'atsSize', 'atsQty', 'fuel',
  'smmQty', 'surgeProQty', 'genStand', 'extWarranty',
  'extWarrantyPromoStart', 'extWarrantyPromoEnd', 'silverServicePromo',
  'evCharger', 'evChargerTier', 'customItems', 'notes', 'includeBreakdown',
  'jobType', 'validDays', 'depositPct', 'extraWire', 'liftType',
] as const;

// Rendered only inside ProposalPreview.tsx's `{form.includeBreakdown && ...}`
// price-breakdown page (as `totals.*Amt`, not these raw form fields — but the
// raw values still ship today because the whole form_data blob does).
const GEN_FORM_BREAKDOWN_KEYS = ['labor', 'permit', 'startup', 'discount', 'discountType', 'taxRate'] as const;

const EV_FORM_KEYS = [
  'customer', 'attn', 'address', 'city', 'state', 'zip', 'phone', 'email',
  'distanceTier', 'panelUpgrade', 'customItems', 'notes', 'includeBreakdown',
  'validDays', 'depositPct',
] as const;

const EV_FORM_BREAKDOWN_KEYS = ['discount', 'discountType', 'taxAmount'] as const;

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
 * preview components take different form shapes). Returns the input unchanged
 * if it isn't an object (null, already-stringified JSON the caller hasn't
 * parsed, etc.) — callers should pass the already-parsed JSONB value.
 */
export function publicFormData(form: unknown, productType: string | null | undefined): unknown {
  if (!form || typeof form !== 'object' || Array.isArray(form)) return form;
  const src = form as Record<string, unknown>;
  const isEv = productType === 'ev_charger';
  const keys = isEv ? EV_FORM_KEYS : GEN_FORM_KEYS;
  const breakdownKeys = isEv ? EV_FORM_BREAKDOWN_KEYS : GEN_FORM_BREAKDOWN_KEYS;

  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (!(key in src)) continue;
    out[key] = key === 'customItems' ? sanitizeCustomItems(src[key]) : src[key];
  }
  if (src.includeBreakdown) {
    for (const key of breakdownKeys) {
      if (key in src) out[key] = src[key];
    }
  }
  return out;
}
