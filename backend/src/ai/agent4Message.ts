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
