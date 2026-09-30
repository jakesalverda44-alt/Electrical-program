// Accuracy round Task 0 — the two live runs of 2026-09-30 (Kissimmee
// 041c6d48 / run 11ff4565, stage 'submitted'; 36th Street 0cd39e74 / run
// ec90ce29, stage 'due') and the live library of that day, exported
// read-only from electrical_crm (see each JSON's _note). Loaded with fs (the
// backend tsconfig has no resolveJsonModule). Nothing is transcribed.
import fs from 'fs';
import path from 'path';
import type { Library } from '../../../estimating/library';
import type { BidLineRow } from '../../../estimating/bidEstimate';
import type { KissimmeeLiveRun, LiveReviewItem } from './kissimmeeLive';

export interface EstSheetRow {
  document_id: string; page_index: number; sheet_no: string | null; title: string | null;
  width_pt: number | string | null; height_pt: number | string | null; rotation: number | null;
  ft_per_pt: number | string | null; scale_source: string | null;
  suggested_ft_per_pt: number | string | null; suggested_label: string | null; scale_ambiguous: boolean | null;
  half_size: boolean | null; has_text_layer: boolean | null; origin_x_pt: number | string | null; origin_y_pt: number | string | null;
}

export interface PanelPinRow { id: string; document_id: string; page_index: number; label: string; points: unknown; status: string; source: string }

/** One live export (both jobs share the shape). */
export interface Live0930 extends Omit<KissimmeeLiveRun, 'reviewItems'> {
  _note: string;
  exportedAt: string;
  bid: { id: string; name: string; stage: string; sq_ft: number | null; gc: string | null; brand: string | null; project_type: string | null; build_type: string | null; amount: string | null };
  runId: string;
  agent2: { takeoff?: unknown[]; allowances?: unknown[]; [k: string]: unknown };
  /** Stored review items; on 36th Street some carry the estimator's `resolution`. */
  reviewItems: Array<LiveReviewItem & { resolution?: unknown; [k: string]: unknown }>;
  documents: Array<{ id: string; name: string; content_sha256: string; page_count: number | null; file_size: number | string }>;
  estSheets: EstSheetRow[];
  panelPins: PanelPinRow[];
  markupSummary: Array<{ kind: string; status: string; source: string; n: number }>;
  estBidLines: unknown[];
  estBidCostLines: unknown[];
  costLineSeeds: Array<{ kind: string }>;
  accubidSettingsRow: Record<string, unknown> | null;
  pricingContext: {
    accubidSettings: Record<string, number | string | null> & { materialTaxPct: number; laborOverheadPct: number; materialMarkupPct: number; laborMarkupPct: number; adjustmentMarkupPct: number; salesMarkupPct: number };
    bidSettings: { factor_ids: string[]; floors_above_2: number; [k: string]: unknown };
    quotes: Array<{ description: string; amount: number; taxPct: number; markupPct: number; status: string }>;
    costLines: Array<{ id: string; kind: string; description: string; amount: number; taxPct: number; sort: number }>;
    alternates: unknown[];
    fixturePackageQuoted: boolean;
  };
  /** What GET /api/estimating/:bidId/accubid returned (the live code, read-only). */
  liveProposal: {
    _note: string;
    lines: BidLineRow[];
    totalHours: number;
    laborFactorMultiplier: number;
    costLines: Array<{ kind: string; amount: number; taxPct: number; description: string }>;
    quotes: unknown[];
    recap: { sellingPrice: number; [k: string]: unknown };
    crew: unknown;
    settings: unknown;
  };
  /** 36th only — takeoff_labeled_events for the bid. */
  labeledEvents?: unknown[];
}

export interface LiveLibrary0930 {
  _note: string;
  library: Library;
  appSettings: Array<{ key: string; value: string }>;
  gcOverheadDefaults: Array<{ gc_name: string; overhead_pct: string | number }>;
}

const read = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8')) as T;
let kCache: Live0930 | null = null;
let sCache: Live0930 | null = null;
let lCache: LiveLibrary0930 | null = null;

/** A fresh deep copy every call (tests mutate what they get). */
export function loadKissimmeeLive0930(): Live0930 {
  if (!kCache) kCache = read<Live0930>('kissimmee-live-2026-09-30.json');
  return JSON.parse(JSON.stringify(kCache)) as Live0930;
}

export function load36th0930(): Live0930 {
  if (!sCache) sCache = read<Live0930>('36th-street-live-2026-09-30.json');
  return JSON.parse(JSON.stringify(sCache)) as Live0930;
}

export function loadLiveLibrary0930(): LiveLibrary0930 {
  if (!lCache) lCache = read<LiveLibrary0930>('live-library-2026-09-30.json');
  return JSON.parse(JSON.stringify(lCache)) as LiveLibrary0930;
}

/** The `value` of one est_* app setting as exported (undefined = not set). */
export function liveSetting(lib: LiveLibrary0930, key: string): string | undefined {
  return lib.appSettings.find(s => s.key === key)?.value;
}
