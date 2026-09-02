// Task 4.1 (phase 2 takeoff fidelity): structured handoffs.
//
// Inter-agent messages used to embed whatever format the upstream text happened
// to already be in — 2-space-pretty JSON in the batched Agent 1 path (mergeAgent1
// output is stored via JSON.stringify(agent1JSON, null, 2), ~25% token overhead
// on the largest payload in the system), or raw model output in the single-pass
// path. Agents 2 and 3 read structured JSON either way — they don't benefit from
// pretty-printing, that's for a human reading the stored output in the UI/DB —
// so compacting the copy sent in the REQUEST body is a pure token savings with
// no information loss. Storage (takeoff_results.agent1_output/agent2_output) and
// the UI keep the original text exactly as today; only the outgoing message uses
// the compact form.
import { parseAIJSON } from './json';

/**
 * Compact a stored agent output for use in a downstream agent's message.
 * Falls back to the original text unchanged when it isn't parseable JSON at all
 * (e.g. an agent returned prose or got cut off) — a malformed upstream output
 * degrades exactly as it does today, rather than being silently swallowed.
 */
export function compactForHandoff(text: string): string {
  const parsed = parseAIJSON(text);
  return parsed ? JSON.stringify(parsed) : text;
}
