// Takeoff accuracy, Task 11 — bid_scope_items persistence.
import { pool } from '../db/pool';
import type { ScopeItem, NonElectricalOverride } from './scopeList';

export interface BidScopeList {
  items: ScopeItem[];
  overrides: Array<NonElectricalOverride & { id: string; text: string }>;
}

export async function getBidScopeList(bidId: string): Promise<BidScopeList> {
  const { rows } = await pool.query('SELECT id, kind, text, line_key, reason FROM bid_scope_items WHERE bid_id = $1 ORDER BY created_at, id', [bidId]);
  return {
    items: rows.filter(r => r.kind === 'include' || r.kind === 'exclude').map(r => ({ id: r.id, kind: r.kind, text: r.text })),
    overrides: rows.filter(r => r.kind === 'override_non_electrical').map(r => ({ id: r.id, text: r.text, lineKey: r.line_key, reason: r.reason })),
  };
}
