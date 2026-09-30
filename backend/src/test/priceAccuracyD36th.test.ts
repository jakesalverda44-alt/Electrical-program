// Price accuracy round D1-D4 — the LATEST live 36th Street run (2026-09-29b)
// replayed through the counting stage. See fixtures/realrun/replay36thB.ts
// for what is real (every live mark, status, rule and title) and what is a
// MOCKED model answer (the close-up status check, the "marked for removal"
// flag).
import { describe, it, expect, beforeAll } from 'vitest';
import { replay36thB } from './fixtures/realrun/replay36thB';
import { isPdftoppmAvailable } from '../ai/documentPrep';

type R = Awaited<ReturnType<typeof replay36thB>>;
let have = false;
let now: R;
beforeAll(async () => {
  have = await isPdftoppmAvailable();
  if (!have) return;
  now = await replay36thB();
}, 300_000);

const count = (r: R, k: string) => r.stage.countResult.types.find(t => t.key === k)!;

describe('D1 — E1.0\'s receptacle rule no longer applies to other symbols', () => {
  it('the 9 "could not be told new or existing" items on non-receptacles are gone; their counts are unchanged', (ctx) => {
    if (!have) return ctx.skip();
    const live = now.run.reviewItems.filter(i => i.id.startsWith('status:')).map(i => i.id);
    expect(live).toEqual(['status:DISCONNECT', 'status:$', 'status:ELECTRICAL PANEL', 'status:AHU #1', 'status:COMP #1', 'status:COMP #2', 'status:DISC-A', 'status:DISC-B', 'status:TRIANGLE']);
    expect(now.review.filter(i => i.id.startsWith('status:'))).toEqual([]);
    for (const [k, n] of [['DISCONNECT', 4], ['ELECTRICAL PANEL', 2], ['$', 9], ['AHU #1', 1], ['COMP #1', 1], ['COMP #2', 1], ['DISC-A', 1], ['DISC-B', 1], ['TRIANGLE', 1]] as const) {
      expect([k, count(now, k).count]).toEqual([k, n]);
    }
    expect(now.stage.countResult.remodel!.unknownStatus).toEqual([]);
    const so = now.stage.countResult.remodel!.scopedOut!;
    expect(so.map(s => [s.label, s.count, s.scope])).toEqual([['E1.0 "Electrical Plan"', 15, 'receptacle']]);
  });
});
