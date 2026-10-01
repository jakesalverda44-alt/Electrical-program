// UI cleanup round 1 — the AI takeoff's suggested RFIs (agent2_output.rfis[].question),
// shared by the Import button and the RFI step's "The AI suggested N RFIs" banner
// so both always count the same thing.
import { parseAgentJson } from './parsing';

export const normRfiQuestion = (s: string) => s.trim().toLowerCase();

/** Agent 2's rfis[].question, trimmed, blank-free, deduped (first wins). */
export function aiRfiSuggestions(agent2Output: string | null | undefined): string[] {
  const parsed = parseAgentJson(agent2Output);
  const raw = parsed?.rfis;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw as Array<Record<string, unknown> | null>) {
    const q = String(r?.question ?? '').trim();
    if (!q) continue;
    const key = normRfiQuestion(q);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

/** Suggestions not already on the list (same dedupe the import uses). */
export function newAiRfiQuestions(agent2Output: string | null | undefined, existing: Array<{ question: string }>): string[] {
  const have = new Set(existing.map(r => normRfiQuestion(r.question)));
  return aiRfiSuggestions(agent2Output).filter(q => !have.has(normRfiQuestion(q)));
}
