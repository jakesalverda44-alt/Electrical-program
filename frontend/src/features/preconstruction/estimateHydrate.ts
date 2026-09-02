import { EstimateLineItem } from '../../types';

// Reconstructs the `estimateOverrides` map — PcWorkspace's Pricing tab already
// uses this exact shape everywhere (buildLineItemsFromTakeoff, computePricingItems,
// the unit-cost <input>'s onChange): `${category}||${item}` -> unit_cost.
//
// Used to restore a saved bid_estimates row's manual price overrides into a fresh
// (post-refresh) workspace. Only rows the estimator explicitly overrode come back;
// everything else keeps tracking the unit-cost library so a later library price
// change still flows through instead of freezing at whatever it happened to be
// when the estimate was last saved.
export function overridesFromEstimate(lineItems: EstimateLineItem[] | undefined | null): Record<string, number> {
  const overrides: Record<string, number> = {};
  if (!lineItems) return overrides;
  for (const li of lineItems) {
    if (li.overridden) {
      overrides[`${li.category}||${li.item}`] = li.unit_cost;
    }
  }
  return overrides;
}
