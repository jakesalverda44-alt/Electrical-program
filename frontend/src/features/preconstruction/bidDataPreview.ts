// Phase 3 Task 7 — the frontend's view of GET /preconstruction/:bidId/proposal-preview,
// which returns the SAME composed BidData shape the backend renders through
// (backend/src/bidstd/bidData.ts's BidData) regardless of whether the underlying
// agent4_output row is in Agent 4's new data-only contract or the pre-Phase-3
// legacy shape — the backend's composeBidData/legacyProposalWithBidMeta adapter
// normalizes either into this one shape, so the frontend never needs its own
// legacy-vs-new branch.
export type PreviewBullet = string | { b: string; t: string };

export interface PreviewSection {
  title: string;
  bullets: PreviewBullet[];
}

export interface PreviewTakeoffItem {
  item?: string;
  description?: string;
  unit?: string;
  qty?: number | string;
  conf?: string;
  source?: string;
  furnish_by?: string;
}

export interface PreviewTakeoffCategory {
  name: string;
  items: PreviewTakeoffItem[];
}

export interface BidDataPreview {
  project_name: string;
  project_address: string;
  client: string;
  contact?: string;
  email?: string;
  job_number: string;
  plan_date?: string;
  total_price: string;
  scope: PreviewBullet[];
  sections: PreviewSection[];
  exclusions: PreviewBullet[];
  takeoff: PreviewTakeoffCategory[];
  terms: PreviewBullet[];
  alternates?: PreviewBullet[];
  /** Fix round 2 / R2-S4(a) — backend/src/bidstd/composeBidData.ts's own
   *  `category::item` keys left un-overridden because the GC takeoff and
   *  the saved estimate disagree on how many rows share that key. Always
   *  present (possibly empty) once composeCurrentBidData succeeds — see
   *  GET /:bidId/proposal-preview's own comment on including it here. */
  ambiguousQtyKeys?: string[];
  /** Takeoff accuracy Task 8 — deterministic changes the account terms made. */
  accountCorrections?: string[];
  /** Takeoff accuracy Task 9 — GC-facing problems to fix before generating. */
  hygieneWarnings?: string[];
  /** Takeoff accuracy Task 13 — the exact strings the .docx prints. */
  paper?: PreviewPaper;
}

export interface PreviewPaper {
  headerLines: Array<{ text: string; bold?: boolean }>;
  introLine: string;
  priceLine: string | null;
  /** Per takeoff category, per item — "Item — description" as printed. */
  takeoffDescriptions: string[][];
}

/** Flatten a bullet (plain string, or a {b,t} mixed-bold run) into display text. */
export function bulletText(b: PreviewBullet): string {
  return typeof b === 'string' ? b : `${b.b ?? ''}${b.t ?? ''}`;
}

/** One entry of the 422 verify-gate failure list (backend/src/bidstd/verifyBid.ts's VerifyFailure). */
export interface VerifyFailure {
  check: string;
  detail: string;
  /** Absent on compose-level failures (data / zero_quantity / excluded_scope
   *  / non_electrical) — always read as `matches ?? []`. */
  matches?: string[];
  /** Takeoff accuracy Task 11 — a non_electrical failure names its line so
   *  the estimator can keep it (with a reason). */
  category?: string;
  line?: string;
  /** Fix round 2 — the override flag that keeps / picks this line. */
  flag?: string;
}
