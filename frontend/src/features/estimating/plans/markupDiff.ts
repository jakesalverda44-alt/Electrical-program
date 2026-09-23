// Estimating Phase B, Task 5 — pure diff between the last-synced markup
// snapshot and the current draft list, in the exact shape
// POST .../markups/batch expects ({creates, updates, deletes}). Isolated
// from useMarkupAutosave.ts so the diff logic itself is trivially testable
// without any hook/timer machinery.
import { MarkupDraft } from './markupHistory';

export interface MarkupBatchPayload {
  creates: MarkupDraft[];
  updates: MarkupDraft[];
  deletes: string[];
}

function sameContent(a: MarkupDraft, b: MarkupDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** `synced` is what the server last confirmed; `current` is the live draft
 *  list. A markup present in both but unchanged is omitted entirely (never
 *  sent as a no-op update). */
export function diffMarkups(synced: MarkupDraft[], current: MarkupDraft[]): MarkupBatchPayload {
  const syncedById = new Map(synced.map(m => [m.id, m]));
  const currentById = new Map(current.map(m => [m.id, m]));

  const creates: MarkupDraft[] = [];
  const updates: MarkupDraft[] = [];
  for (const m of current) {
    const prior = syncedById.get(m.id);
    if (!prior) creates.push(m);
    else if (!sameContent(prior, m)) updates.push(m);
  }

  const deletes: string[] = [];
  for (const m of synced) {
    if (!currentById.has(m.id)) deletes.push(m.id);
  }

  return { creates, updates, deletes };
}

export function isEmptyBatch(batch: MarkupBatchPayload): boolean {
  return batch.creates.length === 0 && batch.updates.length === 0 && batch.deletes.length === 0;
}
