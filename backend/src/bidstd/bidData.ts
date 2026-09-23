// Phase 3 Task 1 — the bid_data contract; post-review FIX-7 wired
// validateBidData into the generate routes (see composeCurrentBidData in
// backend/src/routes/preconstruction.ts) and added the Section C rule below.
//
// Mirrors the APT_Bid_System v4 skill's `scripts/bid_data.example.json` exactly
// (copied verbatim to backend/src/test/fixtures/bidstd/bid_data.example.json —
// the canonical fixture every Task 1-6 test renders against). This is the ONE
// shape build_bid.js / build_prebid.js / build_takeoff.py (and now
// proposalDocx.ts's renderBidDocx / takeoffXlsx.ts / verifyBid.ts) all read —
// AI fills this data, code renders the documents. See
// ~/.claude/skills/apt-electrical-bid/PROJECT_INSTRUCTIONS.md for the standard
// this shape encodes.
import { SECTION_HEADERS } from './boilerplate';

/** A takeoff line item. `qty` may be a plain number or a string (e.g. an
 *  unresolved "VERIFY" count carried as text) — never coerced here. */
export interface TakeoffItem {
  item: string;
  description: string;
  unit: string;
  qty: number | string;
  /** FIRM / APPROX / VERIFY — pre-bid xlsx only, never the GC docx or GC xlsx. */
  conf?: string;
  source: string;
  /** e.g. "APT (ECFECI)", "GC / Graybar national account". Presence on ANY
   *  item across the whole takeoff is what turns on the FURNISH BY column. */
  furnish_by?: string;
  /** Fix round 1 / B1 — the count type this line carries (never rendered). */
  count_type?: string;
}

export interface TakeoffCategory {
  name: string;
  items: TakeoffItem[];
}

/** A scope/exclusions/terms bullet: a plain string, or a mixed-run bullet
 *  whose lead phrase renders bold ({b: bold lead, t: rest of the sentence}). */
export type Bullet = string | { b: string; t: string };

export interface Section {
  title: string;
  bullets: Bullet[];
}

/** Internal-only header fields for the pre-bid package (build_prebid.js).
 *  Never rendered on the GC-facing bid. */
export interface PrebidBlock {
  to?: string;
  from?: string;
  owner?: string;
  engineer?: string;
  received?: string;
  sheets?: string;
  /** Title-block discrepancies, sheets that wouldn't extract, etc. — renders
   *  as "INTERNAL NOTES & DISCREPANCIES", a section that exists only here. */
  flags?: string[];
}

export interface BidData {
  /** Defaults to `APT_Bid_${project_slug}_${location_slug}.docx` when absent. */
  output_filename?: string;
  project_slug: string;
  location_slug: string;
  /** "Month DD, YYYY" — already formatted, never ISO. */
  date: string;
  client: string;
  contact?: string;
  email?: string;
  project_name: string;
  /** Takeoff accuracy Task 13 — Cowork's "Re:" line, e.g. "AutoZone Store
   *  #10077" (brand + store number when both are known); falls back to
   *  project_name. Also capitalized into the opening statement. */
  re_line?: string;
  project_address: string;
  /** JS.MMDDYYYY — see jobNumber() in boilerplate.ts. */
  job_number: string;
  /** Drawing set date(s), e.g. "07.15.2026". */
  plan_date?: string;
  /** Takeoff-xlsx header only — NEVER the bid docx. See Bid_Output_Standards.md. */
  building_area?: string;
  interior_breakdown?: string;
  /** Pre-formatted, e.g. "$248,750.00". */
  total_price: string;
  prebid?: PrebidBlock;
  /** Exactly 6 bullets — see boilerplate.ts's standardScope6(). */
  scope: Bullet[];
  /** The lettered A–F sections, in order. */
  sections: Section[];
  exclusions: Bullet[];
  /** The 8 standard categories, in the standard order (see boilerplate.ts). */
  takeoff: TakeoffCategory[];
  /** Exactly 10 bullets — see boilerplate.ts's standardTerms(). */
  terms: Bullet[];
  alternates?: Bullet[];
  takeoff_notes?: string[];
}

function bulletText(b: Bullet | undefined | null): string {
  if (b == null) return '';
  return typeof b === 'string' ? b : `${b.b ?? ''}${b.t ?? ''}`;
}

function isBlank(s: unknown): boolean {
  return typeof s !== 'string' || s.trim() === '';
}

/**
 * Validate a BidData blob against the standard's non-negotiables and return a
 * list of human-readable problems (empty = clean). Deliberately does NOT
 * re-check every boilerplate string verbatim (boilerplate.test.ts locks those
 * against drift) — this checks the *shape* a caller (composeBidData, an
 * imported desktop bid_data.json, a hand-edited fixture) must satisfy before
 * it's safe to render.
 */
export function validateBidData(data: Partial<BidData> | null | undefined): string[] {
  const problems: string[] = [];
  const d = data ?? {};

  const requireField = (key: keyof BidData, label: string) => {
    if (isBlank((d as Record<string, unknown>)[key])) problems.push(`${label} is required`);
  };
  requireField('project_slug', 'project_slug');
  requireField('location_slug', 'location_slug');
  requireField('date', 'date');
  requireField('client', 'client');
  requireField('project_name', 'project_name');
  requireField('project_address', 'project_address');
  requireField('job_number', 'job_number');
  requireField('total_price', 'total_price');

  if (!Array.isArray(d.scope) || d.scope.length !== 6) {
    problems.push(`scope must have exactly 6 bullets (got ${Array.isArray(d.scope) ? d.scope.length : 0})`);
  } else if (d.scope.some(b => isBlank(bulletText(b)))) {
    problems.push('scope has an empty bullet');
  }

  if (!Array.isArray(d.sections) || d.sections.length === 0) {
    problems.push('sections must not be empty');
  } else {
    d.sections.forEach((s, i) => {
      const label = s?.title || `section ${i + 1}`;
      if (isBlank(s?.title)) problems.push(`section ${i + 1} is missing a title`);
      if (!Array.isArray(s?.bullets) || s.bullets.length === 0) problems.push(`section "${label}" has no bullets`);
    });

    // FIX-7 — Section C's bullet count is the standard's one non-negotiable
    // exact count (PROJECT_INSTRUCTIONS §6: "C 3-3"; boilerplate.ts's own
    // TAKEOFF_COLUMNS_GC/SECTION_LIMITS locked the same rule but were never
    // wired to anything). Only checked when Section C is present — a job
    // that legitimately omits it entirely (no lighting scope) isn't gated.
    const sectionC = d.sections.find(s => s?.title === SECTION_HEADERS.C);
    if (sectionC && (!Array.isArray(sectionC.bullets) || sectionC.bullets.length !== 3)) {
      problems.push(
        `section "${SECTION_HEADERS.C}" must have exactly 3 bullets (got ${Array.isArray(sectionC.bullets) ? sectionC.bullets.length : 0})`
      );
    }
  }

  if (!Array.isArray(d.exclusions) || d.exclusions.length === 0) {
    problems.push('exclusions must not be empty');
  }

  if (!Array.isArray(d.takeoff) || d.takeoff.length === 0) {
    problems.push('takeoff must not be empty');
  } else {
    d.takeoff.forEach((cat, i) => {
      const label = cat?.name || `category ${i + 1}`;
      if (isBlank(cat?.name)) problems.push(`takeoff category ${i + 1} is missing a name`);
      if (!Array.isArray(cat?.items)) problems.push(`takeoff category "${label}" items must be an array`);
    });
  }

  if (!Array.isArray(d.terms) || d.terms.length !== 10) {
    problems.push(`terms must have exactly 10 bullets (got ${Array.isArray(d.terms) ? d.terms.length : 0})`);
  }

  return problems;
}
