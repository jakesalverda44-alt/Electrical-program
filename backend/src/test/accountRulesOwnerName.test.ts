// Review N4 — the bid card's owner_name (filled from the plans by the job
// profile) is an account-rule match input, like the drawings' owner.
import { describe, it, expect, beforeAll } from 'vitest';
import { dbAvailable } from './harness';
import { buildAccountTermsSnapshot } from '../bidstd/accountRulesDb';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('buildAccountTermsSnapshot — owner_name', () => {
  it('matches the AutoZone rule from the card owner alone', async () => {
    if (!ok) return;
    const snap = await buildAccountTermsSnapshot({ brand: null, name: 'Store 99 – Kissimmee', project_type: null, owner_name: 'AUTOZONE STORES LLC' }, {});
    expect(snap.ruleName).toBe('AutoZone');
    expect(snap.matchedBy).toMatch(/owner/);
  });
});
