// Task 4.2 (phase 2 takeoff fidelity): empty-analysis guard.
//
// If every batch of a batched Agent 1 run fails to parse, mergeAgent1Batches
// still returns a valid-looking (but contentless) object — {} in, {} out. That
// flowed straight into Agents 2-3, billing two more paid calls to QC and
// estimate nothing. This function is the pure predicate runPipeline checks right
// after Agent 1's JSON is parsed: when the drawing analysis found no electrical
// content at all, the run stops before Agent 2 with an actionable error instead.

/** True when `panels`, `equipment`, and `quantities` are ALL empty/absent. */
export function analysisIsEmpty(a1: Record<string, unknown> | null | undefined): boolean {
  if (!a1) return true;
  const isEmpty = (v: unknown): boolean => !Array.isArray(v) || v.length === 0;
  return isEmpty(a1.panels) && isEmpty(a1.equipment) && isEmpty(a1.quantities);
}
