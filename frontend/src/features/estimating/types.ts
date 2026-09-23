// Frontend mirror of backend/src/estimating/{pricing,bidEstimate,library}.ts's
// wire shapes. Kept minimal — only what the UI actually reads/writes.
export type EstUnit = 'EA' | 'LF' | 'C' | 'M';
export type LineConfidence = 'FIRM' | 'APPROX' | 'VERIFY';
export type MatchConfidence = 'exact' | 'alias' | 'fuzzy' | 'none';

export interface LibraryItem {
  id: string; code: string; name: string; category: string; unit: EstUnit;
  material_cost: number; material_price_date: string | null; labor_hours: number;
  aliases: string[]; source: string; active: boolean;
}
export interface AssemblyComponent { item_id: string; item_code: string; item_name: string; qty_per: number }
export interface LibraryAssembly {
  id: string; code: string; name: string; category: string; unit: EstUnit;
  aliases: string[]; source: string; active: boolean; components: AssemblyComponent[];
}
export interface LibraryFactor { id: string; code: string; label: string; pct: number; group_key: string; active: boolean }
export interface Library { items: LibraryItem[]; assemblies: LibraryAssembly[]; factors: LibraryFactor[] }

export interface EstimateLine {
  id?: string;
  category: string;
  description: string;
  qty: number;
  unit: EstUnit;
  assembly_id?: string | null;
  item_id?: string | null;
  takeoff_key?: string | null;
  takeoff_item_id?: string | null;
  material_unit_override?: number | null;
  labor_hours_override?: number | null;
  confidence?: LineConfidence | null;
  excluded?: boolean;
  /** Fix round 1 / B5 — true when the ESTIMATOR (not the takeoff) set this
   *  line's qty by hand; sync-takeoff never overwrites qty when this is set. */
  qty_overridden?: boolean;
  /** Fix round 1 / B5 — true when this line's excluded=true was set BY
   *  sync-takeoff (it vanished from the takeoff), not by the estimator.
   *  Server-managed / read-only from the client's perspective. */
  sync_excluded?: boolean;
  /** Fix round 2 / SF1 — how confident the mapper was about this line's
   *  match; null for a manual line. Drives the "check match" badge. */
  match_confidence?: MatchConfidence | null;
  /** Fix round 2 / SF4 — whether the current item_id/assembly_id came from
   *  the mapper ('auto') or an estimator's manual resolve ('manual'). */
  match_source?: 'auto' | 'manual' | null;
  /** Fix round 2 / SF4 — the raw takeoff description this line was last
   *  synced against (server-managed). */
  synced_description?: string | null;
  source: 'takeoff' | 'manual';
  sort?: number;
}

export interface EstimateSettings {
  labor_rate: number;
  factor_ids: string[];
  material_tax_pct: number;
  small_tools_pct: number;
  supervision_pct: number;
  consumables_pct: number;
  overhead_pct: number;
  profit_pct: number;
  crew_size: number;
  /** Fix round 1 / N3 — multiplies the MULTI-STORY labor factor's pct. */
  floors_above_2: number;
}

export interface PricedLine {
  id: string; category: string; description: string; qty: number; unit: EstUnit;
  materialUnit: number; materialExt: number; hoursUnit: number; hoursExt: number; laborExt: number;
  confidence: LineConfidence | null; excluded: boolean;
  /** Fix round 1 / S10 — this line's fully-loaded share of totals.directCost; sums exactly across all lines. */
  directShare: number;
  /** Fix round 2 / SF1 — see EstimateLine.match_confidence. */
  matchConfidence: MatchConfidence | null;
  /** Fix round 2 / SF2 — the server-derived "did this actually resolve to a
   *  library row" signal — an item_id/assembly_id can be set on a line that
   *  still didn't match (an incompatible unit). Use this, not id presence,
   *  to decide whether a line still needs resolving. */
  unresolved: boolean;
}
export interface CategoryTotal {
  category: string; material: number; hours: number; labor: number;
  /** Fix round 1 / S10 — this category's fully-loaded share of totals.directCost; sums exactly across all categories. */
  subtotal: number;
}
export interface PricingTotals {
  materialSubtotal: number; consumables: number; materialTax: number;
  laborHours: number; laborCost: number; smallTools: number;
  directCost: number; overhead: number; profit: number; grandTotal: number;
  sellPerSf: number | null; crewWeeks: number;
}
export interface PricingWarnings {
  unmatchedCount: number; verifyCount: number; zeroMaterialMatchedCount: number;
  excludedCount: number; unverifiedMaterialShare: number;
  /** Fix round 1 / B2 — count of non-excluded lines with an unrecognized unit. */
  unitUnknownCount: number;
  /** Fix round 2 / SF1 — count of non-excluded lines matched only at 'fuzzy' confidence. */
  fuzzyMatchCount: number;
}
export interface PricingRecap {
  lines: PricedLine[]; categories: CategoryTotal[]; totals: PricingTotals; warnings: PricingWarnings;
}

export interface EstimatingBidResponse {
  lines: EstimateLine[];
  settings: EstimateSettings;
  recap: PricingRecap;
  proposed: boolean;
  /** Fix round 2 / SF3 — what's actually persisted in bid_estimates.grand_total;
   *  `recap.totals.grandTotal` is always freshly recomputed against the
   *  CURRENT library/settings and can legitimately drift from it (a library
   *  edit or calibration apply since the last save). null for a bid that's
   *  never been saved through the new engine (including a proposed mapping). */
  savedGrandTotal: number | null;
}

export interface SyncTakeoffResponse {
  added: number; updated: number; vanished: number; lines: EstimateLine[]; recap: PricingRecap;
}

export const DEFAULT_SETTINGS: EstimateSettings = {
  labor_rate: 38, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3,
  supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3,
  floors_above_2: 0,
};

export const EMPTY_RECAP: PricingRecap = {
  lines: [], categories: [],
  totals: {
    materialSubtotal: 0, consumables: 0, materialTax: 0, laborHours: 0, laborCost: 0,
    smallTools: 0, directCost: 0, overhead: 0, profit: 0, grandTotal: 0, sellPerSf: null, crewWeeks: 0,
  },
  warnings: { unmatchedCount: 0, verifyCount: 0, zeroMaterialMatchedCount: 0, excludedCount: 0, unverifiedMaterialShare: 0, unitUnknownCount: 0, fuzzyMatchCount: 0 },
};
