// Remodel round A1-A3 — the live 36th Street Warehouse run (remodel,
// 2026-09-29) replayed through the counting stage, and the Kissimmee
// 2026-09-28 regression guard. See fixtures/realrun/replay36th.ts for
// exactly what is real and what is a MOCKED model answer (the statuses,
// the unlisted channel, the titles reader and the demolition-sheet counts:
// A1 / A2 change what the model is asked, so only a live re-run proves the
// model answers it).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { replay36th, isCounter, isTitles } from './fixtures/realrun/replay36th';
import { replay0928 } from './fixtures/realrun/replay0928';
import { userText, type FakeRequest } from './fixtures/takeoff/fakeAnthropic';
import { isPdftoppmAvailable } from '../ai/documentPrep';
import { CONVENTION_OPTIONS } from '../ai/remodel/status';
import { reviewItemIsOpen, validateResolution, type ReviewItem } from '../ai/reviewItems';
import type { CountResult } from '../ai/countingStage';

type R = Awaited<ReturnType<typeof replay36th>>;
let have = false;
let base: R, remodel: R;
beforeAll(async () => {
  have = await isPdftoppmAvailable();
  if (!have) return;
  base = await replay36th({ remodel: null });
  remodel = await replay36th();
}, 300_000);

const count = (r: R, k: string) => r.stage.countResult.types.find(t => t.key === k)!;
const rows = (r: R) => r.stage.agent1.quantities as Array<Record<string, unknown>>;
const item = (r: R, id: string) => r.review.find(i => i.id === id)!;

describe('36th Street (remodel) — A1 new / existing / demolition', () => {
  it('model calls: the counter on E1.0 / E2.0 and the two demolition sheets, one titles call per scanned architectural plan', (ctx) => {
    if (!have) return ctx.skip();
    expect(base.calls.filter(isCounter).map(c => /SHEET: (\S+)/.exec(userText(c))![1])).toEqual(['E1.0', 'E2.0']);
    expect(remodel.calls.filter(isCounter).map(c => /SHEET: (\S+)/.exec(userText(c))![1]).sort()).toEqual(['A2.0', 'A3.0', 'E1.0', 'E2.0']);
    expect(remodel.calls.filter(isTitles).map(c => /SHEET: (\S+)/.exec(userText(c))![1]).sort()).toEqual(['A1.0', 'A2.0', 'A3.0', 'A6.0']);
    expect(remodel.calls.length).toBe(8);
    const e1 = userText(remodel.calls.find(c => isCounter(c) && userText(c).includes('SHEET: E1.0'))!);
    expect(e1).toContain('STATUS (remodel job)');
    const a2 = userText(remodel.calls.find(c => isCounter(c) && userText(c).includes('SHEET: A2.0'))!);
    expect(a2).toContain('DEMOLITION SHEET ("EXISTING FLOOR PLAN - DEMOLITIONS")');
    expect(a2).toContain('- DEMO-HIGHBAY |');
    expect(e1).not.toContain('- DEMO-');
  });

  it('receptacles: only NEW count (Chris: 5 duplex + 2 GFCI) — the live run counted 26; existing are listed, never priced', (ctx) => {
    if (!have) return ctx.skip();
    const k = ['DUPLEX RECEPTACLE', '42', 'GFI', 'WP'];
    expect(k.map(x => count(base, x).count)).toEqual([14, 3, 7, 2]);
    expect(k.map(x => [count(remodel, x).count, count(remodel, x).existingMarks ?? 0])).toEqual([[5, 9], [0, 3], [0, 7], [2, 0]]);
    const rm = remodel.stage.countResult.remodel!;
    expect(rm.conventions.map(c => [c.quote, c.sheetLabel, c.source])).toEqual([['SHADED SYMBOL DENOTES NEW RECEPTACLE', 'E1.0 "Electrical Plan"', 'counter']]);
    expect(rm.existing.map(e => [e.type, e.count])).toEqual([['GFI', 7], ['Duplex receptacle', 9], ['42', 3]].sort((a, b) => (b[1] as number) - (a[1] as number) || String(a[0]).localeCompare(String(b[0]))));
    // Drawn only as existing: information (never "not found", never a pending 0-qty line).
    expect([item(remodel, 'count:GFI').blocking, item(remodel, 'count:42').blocking]).toEqual([false, false]);
    expect(rows(remodel).some(r => r.countType === 'GFI' || r.countType === '42')).toBe(false);
    expect(item(remodel, 'remodel:existing').title).toBe('19 existing devices shown on the plans — listed, never priced');
    expect(rm.conventionQuestion).toBe(false);
    expect(remodel.review.some(i => i.id === 'remodel:conventions')).toBe(false);
  });

  it('everything else keeps the live count: A 14, B 2, E2 3, G 8, switches 9 + 6', (ctx) => {
    if (!have) return ctx.skip();
    for (const t of base.stage.countResult.types) {
      if (['DUPLEX RECEPTACLE', '42', 'GFI'].includes(t.key)) continue;
      expect([t.key, count(remodel, t.key).count, count(remodel, t.key).status], t.key).toEqual([t.key, t.count, t.status]);
    }
    expect(['A', 'B', 'E2', 'G', '$', '$3'].map(k => count(remodel, k).count)).toEqual([14, 2, 3, 8, 9, 6]);
  });

  it('A2.0 / A3.0 (architectural, excluded, title block "Interior Build-Out Floor Plan") are found by their drawing titles and counted for demolition only', (ctx) => {
    if (!have) return ctx.skip();
    const rm = remodel.stage.countResult.remodel!;
    expect(rm.demolitionSheets.map(d => [d.label, d.status])).toEqual([
      ['A2.0 "EXISTING FLOOR PLAN - DEMOLITIONS"', 'counted'], ['A3.0 "EXISTING REFLECTIVE CEILING PLAN - DEMOLITIONS"', 'counted'],
    ]);
    expect(remodel.stage.countResult.sheets.filter(s => s.demolition).length).toBe(2);
    // never install marks
    expect(remodel.stage.countResult.marks.some(m => /#[45]$/.test(m.sheetKey))).toBe(false);
  });

  it('Demolition lines = Chris\'s BOM demolition rows; the exit/em units drawn on both sheets are counted once', (ctx) => {
    if (!have) return ctx.skip();
    const demo = rows(remodel).filter(r => r.category === 'Demolition');
    expect(demo.map(r => [r.item, r.qty, r.countType, r.countedBy])).toEqual([
      ['Demolition — light fixture up to 2x4 (fluorescent/LED)', 52, 'DEMO-FIXTURE', 'counter'],
      ['Demolition — HID high bay fixture', 2, 'DEMO-HIGHBAY', 'counter'],
      ['Demolition — exit/em fixture', 2, 'DEMO-EXIT', 'counter'],
      ['Demolition — receptacle', 18, 'DEMO-RECEPTACLE', 'counter'],
      ['Demolition — switch 1-pole', 6, 'DEMO-SWITCH', 'counter'],
      ['Demolition — switch 3-way', 2, 'DEMO-SWITCH3', 'counter'],
    ]);
    expect(String(demo[2].spec)).toContain('2 shown on two sheets counted once');
    expect(String(demo[3].sourceSheet)).toBe('A2.0');
    expect(rows(base).some(r => r.category === 'Demolition')).toBe(false);
    expect(item(remodel, 'remodel:demolition').blocking).toBe(false);
  });

  it('no printed rule found: ONE blocking question, the counts stay as they are; the answer is applied on the next run', async (ctx) => {
    if (!have) return ctx.skip();
    const none = await replay36th({ conventions: false });
    const q = item(none, 'remodel:conventions');
    expect([q.title, reviewItemIsOpen(q), q.options]).toEqual(['How are new vs existing devices shown on these plans?', true, [...CONVENTION_OPTIONS]]);
    expect(none.review.filter(i => i.id === 'remodel:conventions').length).toBe(1);
    expect(['DUPLEX RECEPTACLE', '42', 'GFI', 'WP'].map(k => count(none, k).count)).toEqual([14, 3, 7, 2]);
    // demolition is found either way
    expect(rows(none).filter(r => r.category === 'Demolition').length).toBe(6);
    const ok = validateResolution(q, { action: 'answer', answer: CONVENTION_OPTIONS[1] }, null);
    expect(ok.ok).toBe(true);
    const next = await replay36th({ conventions: false, remodel: { buildType: null, answer: CONVENTION_OPTIONS[1] } });
    expect(next.review.some(i => i.id === 'remodel:conventions')).toBe(false);
    const e1 = userText(next.calls.find(c => isCounter(c) && userText(c).includes('SHEET: E1.0'))!);
    expect(e1).toContain('KNOWN RULES for this job');
    expect(e1).toContain('shaded / filled symbol = new');
  }, 300_000);

  it('the bid says "new building": no remodel mode at all (same calls and counts as without it)', async (ctx) => {
    if (!have) return ctx.skip();
    const nb = await replay36th({ remodel: { buildType: 'new' } });
    expect(nb.stage.countResult.remodel).toBeUndefined();
    expect(nb.calls.length).toBe(base.calls.length);
    expect(nb.stage.countResult.types).toEqual(base.stage.countResult.types);
  }, 300_000);
});

describe('Kissimmee 2026-09-28 (new build) — unchanged', () => {
  const before = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/realrun/kissimmee-0928-review-before-remodel.json'), 'utf8')) as { review: ReviewItem[]; types: Array<{ key: string; count: number; status: string }> };
  let after: { cr: CountResult; review: ReviewItem[]; calls: FakeRequest[] };
  beforeAll(async () => { if (have) after = await replay0928({ remodel: { buildType: null, answer: null } }); }, 300_000);

  it('no remodel mode, the same model calls, every count and status identical', (ctx) => {
    if (!have) return ctx.skip();
    expect(after.cr.remodel).toBeUndefined();
    expect(after.calls.length).toBe(6);
    expect(after.calls.some(c => userText(c).includes('STATUS (remodel job)'))).toBe(false);
    expect(after.cr.types.map(t => ({ key: t.key, count: t.count, status: t.status }))).toEqual(before.types);
  });

  it('every review item identical', (ctx) => {
    if (!have) return ctx.skip();
    expect(after.review).toEqual(before.review);
  });
});
