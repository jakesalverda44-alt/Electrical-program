// Pure merge for batched Agent 1 (Drawing Analyzer) runs.
//
// When a plan set is split into multiple batches (BATCH_SIZE files per call), each
// batch returns a full Agent 1 JSON object shaped per AGENT1_SYSTEM (prompts.ts):
// project, service, panels, equipment, quantities, allowances, ecfeciItems, flags,
// scopeNotes, missingSheets. This merges those N results into one.
//
// Merged generically (no hardcoded key list) so a custom ai_prompt_agent1 override
// with extra keys still merges sensibly:
//   - array values  -> concatenated across batches, in batch order
//   - object values -> first batch's value wins, then later batches fill any
//                       field left empty ('', 0, null, undefined) — field-level
//                       first-non-empty
//   - scalar values -> first non-empty batch wins
//
// Panels also get cross-batch duplicate detection: a panel signature (name +
// location, falling back to name alone when location is empty) seen in an earlier
// batch gets `cross_reference: 'CROSS-REFERENCE — VERIFY'` tagged onto the later
// occurrence so a human notices the same panel was picked up twice.

function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || v === '' || v === 0;
}

function panelSignature(item: Record<string, unknown>): string | null {
  const name = item.name;
  if (name === undefined || name === null || name === '') return null;
  const location = item.location;
  return location ? `${name}:${location}` : `${name}`;
}

export function mergeAgent1Batches(batchResults: Record<string, unknown>[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (batchResults.length === 0) return result;

  // Union of keys, in first-seen order.
  const keys: string[] = [];
  for (const batch of batchResults) {
    for (const k of Object.keys(batch)) {
      if (!keys.includes(k)) keys.push(k);
    }
  }

  const seenPanels = new Set<string>();

  for (const key of keys) {
    // Determine merge mode from the first batch that defines this key.
    let mode: 'array' | 'object' | 'scalar' | null = null;
    for (const batch of batchResults) {
      const v = batch[key];
      if (v === undefined) continue;
      if (Array.isArray(v)) mode = 'array';
      else if (v !== null && typeof v === 'object') mode = 'object';
      else mode = 'scalar';
      break;
    }

    if (mode === 'array') {
      const merged: unknown[] = [];
      for (const batch of batchResults) {
        const v = batch[key];
        if (!Array.isArray(v)) continue;
        for (const rawItem of v) {
          if (key === 'panels' && rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem)) {
            const item = rawItem as Record<string, unknown>;
            const sig = panelSignature(item);
            if (sig !== null) {
              if (seenPanels.has(sig)) {
                item.cross_reference = 'CROSS-REFERENCE — VERIFY';
              } else {
                seenPanels.add(sig);
              }
            }
          }
          merged.push(rawItem);
        }
      }
      result[key] = merged;
    } else if (mode === 'object') {
      let base: Record<string, unknown> | undefined;
      for (const batch of batchResults) {
        const v = batch[key];
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          base = { ...(v as Record<string, unknown>) };
          break;
        }
      }
      if (base) {
        for (const batch of batchResults) {
          const v = batch[key];
          if (v === null || typeof v !== 'object' || Array.isArray(v)) continue;
          for (const [field, val] of Object.entries(v as Record<string, unknown>)) {
            if (isEmptyValue(base[field]) && !isEmptyValue(val)) {
              base[field] = val;
            }
          }
        }
      }
      result[key] = base;
    } else {
      // scalar: first non-empty batch wins; otherwise first defined value.
      let chosen: unknown;
      let found = false;
      for (const batch of batchResults) {
        const v = batch[key];
        if (v === undefined) continue;
        if (!found) { chosen = v; found = true; }
        if (!isEmptyValue(v)) { chosen = v; break; }
      }
      result[key] = chosen;
    }
  }

  return result;
}
