// Evidence round 4.3 — crop checks: a single small crop per candidate mark,
// classified accept / reject / reclass. This is what turns a gap-fill
// SUGGESTED mark into a counted one (or discards it) — gap-fill itself
// never counts anything. Pure parsing; the I/O half is gapFillStage.ts.
import { parseAIJSON } from '../json';
import { normalizeTypeKey } from '../countTargets';

export type CropCheckDecision = 'accept' | 'reject' | 'reclass';

export interface CropCheckResult {
  id: string;
  decision: CropCheckDecision;
  /** Only for 'reclass', and only when it names an actual count target. */
  reclassKey: string | null;
  note: string;
}

function clean(s: unknown, max = 200): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Pure: the crop-check model's strict JSON -> one decision per candidate id
 *  sent. An id the reply doesn't mention, or a malformed entry, defaults to
 *  'reject' — a candidate is only ever added on a clear "accept" (never by
 *  a parse failure defaulting the other way). Returns null only when the
 *  reply has no usable `decisions` array at all (the caller then leaves
 *  every candidate pending for the estimator, never auto-accepted). */
export function parseCropCheckReply(text: string, ids: string[], targetKeys: ReadonlySet<string>): CropCheckResult[] | null {
  const parsed = parseAIJSON(text);
  const raw = parsed && Array.isArray(parsed.decisions) ? (parsed.decisions as unknown[]) : null;
  if (!raw) return null;
  const byId = new Map<string, CropCheckResult>();
  for (const d of raw) {
    if (!d || typeof d !== 'object') continue;
    const r = d as Record<string, unknown>;
    const id = clean(r.id, 40);
    if (!id || !ids.includes(id) || byId.has(id)) continue;
    const decisionRaw = clean(r.decision, 10).toLowerCase();
    const reclassRaw = decisionRaw === 'reclass' ? normalizeTypeKey(clean(r.type, 80)) : '';
    const reclassKey = reclassRaw && targetKeys.has(reclassRaw) ? reclassRaw : null;
    const decision: CropCheckDecision = decisionRaw === 'accept' ? 'accept' : (decisionRaw === 'reclass' && reclassKey) ? 'reclass' : 'reject';
    byId.set(id, { id, decision, reclassKey, note: clean(r.note) });
  }
  return ids.map(id => byId.get(id) ?? { id, decision: 'reject', reclassKey: null, note: 'not answered by the crop check' });
}
