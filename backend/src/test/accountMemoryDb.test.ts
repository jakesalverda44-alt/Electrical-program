// Fewer-questions round Task 6 — the account-memory loader on the test DB:
// two bids of one (non-default) rule share answers; a bid of another rule,
// and the Default rule, never do. Index migration 162 present.
import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class { constructor() { throw new Error('Anthropic client must not be constructed in this test'); } },
}));

import { pool } from '../db/pool';
import { dbAvailable, makeUser } from './harness';
import { accountIdentityOf, loadAccountMemorySources, accountMemoryApplier } from '../bidstd/accountMemoryDb';
import type { ReviewItem } from '../ai/reviewItems';
import type { AccountTermsSnapshot } from '../bidstd/accountRules';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const zero = (k: string, resolved: boolean): ReviewItem => ({
  id: `count:${k}`, kind: 'count', title: `Type ${k} — Motion sensor`, detail: 'Counted 0: not found on any counted plan sheet.', typeKey: k, type: k, description: 'Motion sensor',
  actions: ['count', 'markers', 'not_on_job'], ...(resolved ? { resolution: { action: 'not_on_job' as const, reason: 'Not on this prototype', by: 'Jake', at: 't' } } : {}),
});

async function rule(name: string): Promise<string> {
  const { rows } = await pool.query(`INSERT INTO account_rules (name, match_aliases, priority) VALUES ($1, $2, 50) RETURNING id`, [name, [name]]);
  return rows[0].id as string;
}
async function bidWith(userId: string, ruleId: string | null, items: ReviewItem[], name: string): Promise<string> {
  const { rows } = await pool.query(`INSERT INTO bids (name, gc, loc, salesperson_id) VALUES ($1,'GC','Here',$2) RETURNING id`, [name, userId]);
  await pool.query(`INSERT INTO takeoff_results (bid_id, status, review_items, review_status, account_terms) VALUES ($1,'complete',$2,'needs_review',$3)`,
    [rows[0].id, JSON.stringify(items), JSON.stringify({ ruleId, ruleName: 'x' })]);
  return rows[0].id as string;
}

describe('account memory sources', () => {
  it('same rule → shared; another rule → never; Default → no account', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const az = await rule(`AZ ${tag}`), other = await rule(`Other ${tag}`);
    const a = await bidWith(u.id, az, [zero('M2', true)], `AZ one ${tag}`);
    const b = await bidWith(u.id, az, [zero('M2', false)], `AZ two ${tag}`);
    const c = await bidWith(u.id, other, [zero('M2', true)], `Other ${tag}`);
    const srcB = await loadAccountMemorySources(b, az);
    expect(srcB.map(s => s.bidId)).toEqual([a]);
    expect((await loadAccountMemorySources(c, other)).map(s => s.bidId)).toEqual([]);
    const idB = await accountIdentityOf({ ruleId: az } as AccountTermsSnapshot);
    expect(idB).toMatchObject({ ruleId: az, aliases: [`AZ ${tag}`] });
    const apply = await accountMemoryApplier(b, idB);
    const [m] = apply!([zero('M2', false)]);
    expect(m.resolution).toMatchObject({ action: 'not_on_job', by: `CRM (from AZ one ${tag})`, auto: { source: 'account_memory' } });
    // the other rule's bid gets nothing from AZ
    const idC = await accountIdentityOf({ ruleId: other } as AccountTermsSnapshot);
    expect(await accountMemoryApplier(c, idC)).toBeUndefined();
    // the Default rule is never an account
    const { rows: d } = await pool.query(`SELECT id FROM account_rules WHERE is_default LIMIT 1`);
    if (d.length) expect(await accountIdentityOf({ ruleId: d[0].id } as AccountTermsSnapshot)).toBeNull();
    expect(await accountIdentityOf(null)).toBeNull();
  });
  it('migration 162 created the ruleId index', async (ctx) => {
    if (!ok) return ctx.skip();
    const { rows } = await pool.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'takeoff_results_account_rule_idx'`);
    expect(rows.length).toBe(1);
  });
});
