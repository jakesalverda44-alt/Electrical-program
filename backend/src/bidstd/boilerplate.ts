// Phase 3 Task 1 — the boilerplate source of truth.
//
// Every string below is copied VERBATIM from
// ~/.claude/skills/apt-electrical-bid/PROJECT_INSTRUCTIONS.md (sections 5, 8, 9,
// 10, 11) — Jake's maintained standard. boilerplate.test.ts locks each string
// against drift. This is the whole point of Phase 3: the 6 scope bullets, the
// 10 terms, the section header names, and the closing block move OUT of the AI
// prompt (where the model could drop or paraphrase them) and INTO code, where
// they cannot change unless this file changes.

/** SCOPE OF WORK — always exactly these 6 bullets, in this order.
 *  `planDates` fills bullet 4, `sheetList` fills bullet 4, `gcName` fills bullet 5. */
export function standardScope6(planDates: string, sheetList: string, gcName: string): string[] {
  return [
    'The project is understood to be electrical work and has been reviewed and quoted as such.',
    'All work to be completed during normal business hours, 8:00 AM – 4:00 PM, Monday through Friday.',
    'Installation per plan. All changes will require a written Change Order approved by the Owner before work proceeds.',
    `Based on the electrical specifications, schedules, and drawing set dated ${planDates}. Sheets: ${sheetList}.`,
    `Coordinate with ${gcName} for scheduling, tie-ins, and required access.`,
    'Submit for and obtain all required electrical permits prior to commencement of work.',
  ];
}

/** TERMS, CONDITIONS & SPECIAL REQUIREMENTS — always exactly these 10 bullets,
 *  in this order. `planDates` fills bullet 1's code-years sentence. Some jobs
 *  govern under different code years (NEC 2023 / FFPC 2023 8th Ed.) — per
 *  PROJECT_INSTRUCTIONS §9, that's a per-job call the estimator makes, not a
 *  parameter this function exposes; callers who need a different code year
 *  build bullet 1 themselves and splice it in. */
export function standardTerms(planDates: string): string[] {
  return [
    `Based on electrical drawings and SOW dated ${planDates}. All work per NEC 2020, FBC 2023, and FFPC 2021.`,
    'Price valid for 30 days from date of proposal. Material costs subject to market fluctuation at time of order.',
    'A deposit of 25% of the contract value is required upon execution of this agreement to initiate material procurement.',
    'Lighting package to be procured through the Southern Lighting Source national account. EC to receive, inventory, and install.',
    'Equipment lead times subject to market and manufacturer availability. APT not responsible for vendor delays.',
    'All changes to the approved scope require a written Change Order signed by the Owner prior to proceeding.',
    'Painting, patching, concrete cutting, and finish restoration are excluded from this scope.',
    "Low-voltage cabling, devices, and programming (security, tele/data, sound/intercom) by Owner's vendor. EC provides conduit and boxes only.",
    "Utility company transformer, primary-side work, and utility fees excluded. EC provides 8' conductor slack at transformer secondary.",
    'All work performed under valid permits in compliance with local, state, and AHJ requirements.',
  ];
}

/** Exact section header names (PROJECT_INSTRUCTIONS §5 table) — centered white
 *  bold text in a navy band. Never paraphrase these. */
export const SECTION_HEADERS = {
  scope: 'SCOPE OF WORK',
  A: 'A. Service & Distribution',
  B: 'B. Branch Power',
  C: 'C. Lighting & Controls',
  D: 'D. Site Lighting, Underground Work & Allowances',
  E: 'E. Low Voltage Infrastructure (Conduit & Boxes Only)',
  F: 'F. Project Coordination & Closeout',
  exclusions: 'EXCLUSIONS & CLARIFICATIONS',
  takeoff: 'ELECTRICAL QUANTITY TAKEOFF',
  terms: 'TERMS, CONDITIONS & SPECIAL REQUIREMENTS',
} as const;

/** Standard closing block strings (PROJECT_INSTRUCTIONS §10), verbatim. */
export const CLOSING = {
  respectfully: 'Respectfully,',
  costBasis: '(Cost based on Terms Above — Due Upon Acceptance to Secure Order)',
  acceptance: 'Please review, execute, and return this proposal along with the applicable purchase order and payment method to confirm acceptance.',
  print: 'Print      ___________________________________',
  sign: 'Sign       ___________________________________',
  date: 'Date      ___________________________________',
  thankYou: 'Thank you for the opportunity to meet your electrical and power generation needs!',
} as const;

/** Pre-bid banner text (PROJECT_INSTRUCTIONS §14 / build_prebid.js), verbatim. */
export const PREBID_BANNER = 'PRE-BID PACKAGE  —  INTERNAL USE';

/** The 8 standard takeoff categories, always in this order (PROJECT_INSTRUCTIONS §11). */
export const TAKEOFF_CATEGORIES = [
  'Service & Distribution',
  'Interior Lighting',
  'Exterior / Site Lighting',
  'Lighting Controls',
  'Branch Power',
  'Site / Underground / Allowances',
  'Low Voltage Infrastructure (Conduit & Boxes Only)',
  'Grounding',
] as const;

// N4/B4: Agent 2's own categorization prompt (src/ai/prompts.ts) asks the
// model for a SHORTER, slash-free spelling of some of these same categories
// ("Exterior Site Lighting", "Site Underground Allowances", "Low Voltage")
// than the canonical PROJECT_INSTRUCTIONS names above. That's intentional on
// the AI-prompt side (shorter labels are less for the model to reproduce
// exactly) but it means a raw takeoff line's `category` field and the seed
// library's/calibration report's canonical category never string-match
// without normalizing one to the other first.
const CATEGORY_ALIASES: Record<string, string> = {
  'exterior site lighting': 'Exterior / Site Lighting',
  'site underground allowances': 'Site / Underground / Allowances',
  'low voltage': 'Low Voltage Infrastructure (Conduit & Boxes Only)',
};

/** Map any known spelling of a takeoff category (the canonical
 *  TAKEOFF_CATEGORIES form, or Agent 2's shorter prompt-facing alias) to the
 *  canonical TAKEOFF_CATEGORIES string. Unrecognized input passes through
 *  unchanged rather than being coerced to something wrong. */
export function canonicalizeTakeoffCategory(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  if ((TAKEOFF_CATEGORIES as readonly string[]).includes(trimmed)) return trimmed;
  return CATEGORY_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

/** Zero-pad to `n` digits. */
function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/**
 * Job number format: JS.MMDDYYYY (PROJECT_INSTRUCTIONS §2/§15). Uses the
 * date's LOCAL calendar fields (never toISOString/UTC), so a job number always
 * reads as the day the estimator actually generated it.
 */
export function jobNumber(date: Date): string {
  const mm = pad(date.getMonth() + 1, 2);
  const dd = pad(date.getDate(), 2);
  const yyyy = String(date.getFullYear());
  return `JS.${mm}${dd}${yyyy}`;
}

/**
 * Phase 4 Task 6.2 — same-day job_number collision (Phase 3 review finding):
 * two proposals generated the same day both compute the identical
 * JS.MMDDYYYY from jobNumber(), so the second one silently overwrote the
 * first's number wherever they collided. Pure: given the freshly-computed
 * candidate and the set of job_numbers already taken by OTHER non-deleted
 * bids, returns the candidate unchanged if free, or the first
 * "<candidate>-2", "<candidate>-3", ... that isn't. Only ever called on a
 * freshly GENERATED number (composeCurrentBidData's jobNumberGenerated
 * branch) — an existing/manually-entered job_number is never passed
 * through this function, so it's never touched.
 */
export function resolveUniqueJobNumber(candidate: string, takenByOthers: ReadonlySet<string>): string {
  if (!takenByOthers.has(candidate)) return candidate;
  let n = 2;
  let attempt = `${candidate}-${n}`;
  while (takenByOthers.has(attempt)) {
    n += 1;
    attempt = `${candidate}-${n}`;
  }
  return attempt;
}
