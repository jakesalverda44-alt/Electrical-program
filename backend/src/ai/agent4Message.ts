// Pure builder for the Agent 4 (Proposal Formatter) user message.
//
// Mirrors frontend/src/features/preconstruction/constants.ts SCOPE_SECS — kept as a
// small local constant instead of importing across the package boundary. IMPORTANT:
// these are the CRM's internal scope-editor letters (A Service & Distribution,
// B Branch Circuits, C Lighting, D Low Voltage / Data, E Fire Alarm, F Site /
// Exterior, G Special Systems), which do NOT line up letter-for-letter with the
// proposal's own A–F output sections (AGENT4_SYSTEM: A Service & Distribution,
// B Branch Power, C Lighting & Controls, D Site Lighting/Underground, E Low
// Voltage, F Coordination — e.g. CRM F=Site maps to proposal D, CRM D=Low Voltage
// maps to proposal E). We emit human titles here, never letters, and leave the
// meaning-based remapping to Agent 4 (see AGENT4_SYSTEM's authoritative-scope
// instruction) so this file never has to know the proposal's lettering.
const SCOPE_SECS_BACKEND: { id: string; label: string }[] = [
  { id: 'A', label: 'Service & Distribution' },
  { id: 'B', label: 'Branch Circuits' },
  { id: 'C', label: 'Lighting' },
  { id: 'D', label: 'Low Voltage / Data' },
  { id: 'E', label: 'Fire Alarm' },
  { id: 'F', label: 'Site / Exterior' },
  { id: 'G', label: 'Special Systems' },
];

// Raised from 8,000 (see plan) — Agent 1 output was silently mid-JSON-truncated at
// the old cap, which starved Agent 4 of most of the drawing analysis on any
// nontrivial job.
export const AGENT1_TEXT_CAP = 100_000;

export interface SavedEstimateContext {
  grand_total?: number | string | null;
  overhead_pct?: number | string | null;
  profit_pct?: number | string | null;
  subtotals?: Record<string, number> | null;
}

export interface Agent4MessageInput {
  price: string;
  internalNotes?: string | null;
  agent1Output: string;
  agent2Output: string;
  workspaceScope?: Record<string, string> | null;
  savedEstimate?: SavedEstimateContext | null;
  /** Takeoff accuracy Task 7 — the estimator's resolutions of the Needs-review
   *  list (reviewResolutionsForAgent4), authoritative over Agents 1/2. */
  reviewResolutions?: string | null;
  /** Takeoff accuracy Task 8 — the job's ACCOUNT TERMS block
   *  (accountRules.ts renderAccountTermsBlock), authoritative. */
  accountTerms?: string | null;
  /** Takeoff accuracy Task 11 — the estimator's scope list
   *  (scopeList.ts renderScopeListBlock), binding. */
  scopeList?: string | null;
}

function money(n: number | string | null | undefined): string {
  const num = typeof n === 'string' ? Number(n) : n;
  if (num === null || num === undefined || !Number.isFinite(num)) return '$0';
  return `$${Math.round(num).toLocaleString('en-US')}`;
}

function pct(n: number | string | null | undefined): string {
  const num = typeof n === 'string' ? Number(n) : n;
  if (num === null || num === undefined || !Number.isFinite(num)) return '0%';
  return `${num}%`;
}

function truncateWithMarker(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return `${text.slice(0, cap)}\n[TRUNCATED — drawing analysis exceeded limit]`;
}

export function buildAgent4UserMessage(input: Agent4MessageInput): string {
  const lines: string[] = [
    'PROPOSAL REQUEST',
    '',
    `Total Bid Price: ${input.price.trim()}`,
    '',
    'Internal Notes from Estimator:',
    input.internalNotes?.trim() || '(none)',
  ];

  const scopeEntries = SCOPE_SECS_BACKEND
    .map(s => ({ title: s.label, text: (input.workspaceScope?.[s.id] || '').trim() }))
    .filter(e => e.text.length > 0);

  if (scopeEntries.length > 0) {
    lines.push('', '--- ESTIMATOR-EDITED SCOPE OF WORK (AUTHORITATIVE) ---');
    for (const entry of scopeEntries) {
      lines.push(`${entry.title}:`, entry.text);
    }
  }

  if (input.savedEstimate) {
    lines.push('', '--- SAVED ESTIMATE (CONTEXT) ---');
    lines.push('(Context only — the Total Bid Price above is the authoritative number to print.)');
    lines.push(`Grand Total: ${money(input.savedEstimate.grand_total)}`);
    lines.push(`Overhead: ${pct(input.savedEstimate.overhead_pct)}`);
    lines.push(`Profit: ${pct(input.savedEstimate.profit_pct)}`);
    const subtotals = input.savedEstimate.subtotals;
    if (subtotals && Object.keys(subtotals).length > 0) {
      lines.push('Category Subtotals:');
      for (const [category, amount] of Object.entries(subtotals)) {
        lines.push(`  ${category}: ${money(amount)}`);
      }
    }
  }

  if (input.accountTerms) {
    lines.push('', input.accountTerms);
  }
  if (input.scopeList) {
    lines.push('', input.scopeList);
  }
  if (input.reviewResolutions) {
    lines.push('', input.reviewResolutions);
  }

  lines.push(
    '',
    '--- DRAWING ANALYSIS (Agent 1) ---',
    truncateWithMarker(input.agent1Output, AGENT1_TEXT_CAP),
    '',
    '--- SCOPE & ESTIMATE (Agent 2) ---',
    input.agent2Output
  );

  return lines.join('\n');
}

/* ============================================================================
 * Phase 3 Task 5 — Agent 4's new (data-only) output contract.
 *
 * Agent 4 (AGENT4_SYSTEM, prompts.ts) now emits ONLY project-specific data —
 * no boilerplate, no letterhead, no closing block, no totalPrice (the bid
 * record's validated agent4_price is authoritative — see run-agent4). The
 * shape here is the single source of truth for both the run-agent4 shape
 * check below and composeBidData.ts's input type.
 * ========================================================================== */

/** One takeoff line item as Agent 4 emits it — `conf`/`furnish_by` optional,
 *  everything else Agent 4 is expected to fill even when blank. */
export interface Agent4TakeoffItem {
  item?: string;
  description?: string;
  unit?: string;
  qty?: number | string;
  source?: string;
  /** FIRM / APPROX / VERIFY (or Agent 2's VERIFIED/ASSUMED/NOT SHOWN, which
   *  composeBidData normalizes) — composeBidData prefers the saved estimate's
   *  authoritative value over this echo when both are available. */
  conf?: string;
  furnish_by?: string;
}

export interface Agent4TakeoffCategory {
  name: string;
  items?: Agent4TakeoffItem[];
}

export interface Agent4Section {
  title: string;
  bullets?: (string | { b: string; t: string })[];
}

/** Agent 4's full output contract — see AGENT4_SYSTEM's OUTPUT block. */
export interface Agent4Output {
  plan_date?: string;
  sheets?: string[];
  sections?: Agent4Section[];
  exclusions?: (string | { b: string; t: string })[];
  /** Already-formatted bullet strings, one per allowance — composeBidData
   *  appends them to Section D rather than trusting free-form AI phrasing
   *  for this fixed template ("XXX' allowance - ..."). */
  allowances_bullets?: string[];
  /** Raw fixture-type codes (e.g. ["A","AE","B1"]) — composeBidData builds
   *  Section C's fixed 3rd bullet ("Fixture types per schedule: ...") from
   *  this instead of trusting AI-formatted prose for a simple joined list. */
  fixture_types?: string[];
  takeoff?: Agent4TakeoffCategory[];
  alternates?: (string | { b: string; t: string })[];
  takeoff_notes?: string[];
}

/**
 * Light shape check run after parsing Agent 4's JSON (run-agent4) — not a
 * full schema validation (that's bidData.ts's validateBidData, run on the
 * COMPOSED BidData, not on Agent 4's raw output), just enough to catch a
 * response that isn't even attempting the new contract (e.g. an empty
 * object, or something that parsed as JSON but isn't this shape at all)
 * before it's persisted and silently produces a blank proposal later.
 */
export function isAgent4Shape(parsed: unknown): parsed is Agent4Output {
  if (!parsed || typeof parsed !== 'object') return false;
  const p = parsed as Record<string, unknown>;
  return Array.isArray(p.sections) && Array.isArray(p.takeoff);
}
