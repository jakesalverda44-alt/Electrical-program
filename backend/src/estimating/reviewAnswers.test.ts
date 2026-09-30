// Price accuracy round, C2 — review answers reach the estimate at once, on
// the real 36th Street re-run (2026-09-29b) and Jake's actual answer on
// unlisted:H ("LED high bay 2x4 - warehouse (per Chris)", 13).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { applyReviewAnswers, normName } from './reviewAnswers';
import { parseAgent2Takeoff, toLibraryCandidates, RawTakeoffRow } from './bidEstimate';
import { mapTakeoffLines, fromLegacyTakeoff } from './mapper';
import { SEED_ITEMS, SEED_ASSEMBLIES } from './seed/laborUnits';
import type { Library, LibraryItem, LibraryAssembly } from './library';
import type { ReviewItem } from '../ai/reviewItems';

const run = JSON.parse(fs.readFileSync(path.join(__dirname, '../test/fixtures/estimating/price-accuracy/36th-street-run-2026-09-29b.json'), 'utf8'));
const rows = parseAgent2Takeoff('```json\n' + JSON.stringify(run.agent2) + '\n```');
const review = run.review_items as ReviewItem[];
const unanswered = review.map(i => ({ ...i, resolution: undefined }));

const items: LibraryItem[] = SEED_ITEMS.map(i => ({
  id: i.code, code: i.code, name: i.name, category: i.category, unit: i.unit, material_cost: i.materialCost,
  material_price_date: null, labor_hours: i.laborHours, aliases: i.aliases, source: 'seed', active: true,
}));
const byCode = new Map(items.map(i => [i.code, i]));
const assemblies: LibraryAssembly[] = SEED_ASSEMBLIES.map(a => ({
  id: a.code, code: a.code, name: a.name, category: a.category, unit: a.unit, aliases: a.aliases, source: 'seed', active: true,
  components: a.components.map(c => ({ item_id: c.itemCode, item_code: c.itemCode, item_name: byCode.get(c.itemCode)?.name ?? '', qty_per: c.qtyPer })),
}));
const candidates = toLibraryCandidates({ items, assemblies, factors: [] } as Library);

function withAnswer(id: string, resolution: ReviewItem['resolution']): ReviewItem[] {
  return unanswered.map(i => (i.id === id ? { ...i, resolution } : i));
}
const by = { by: 'Jake', at: '2026-09-29T00:00:00Z' };

describe('C2 — review answers → estimate', () => {
  it("Jake's actual H answer: a line of 13 'LED high bay 2x4', mapped to the 2x4 high-bay unit (1.0 h/E)", () => {
    const out = applyReviewAnswers(rows, run.count_result, review).rows;
    const h = out.filter(r => /^Type H\b/.test(r.item));
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ category: 'Interior Lighting', item: 'Type H — LED high bay 2x4 - warehouse (per Chris)', qty: 13, unit: 'EA' });
    expect(h[0].evidence).toMatch(/Named and counted by the estimator/);
    const [m] = mapTakeoffLines(fromLegacyTakeoff([h[0] as RawTakeoffRow]), candidates);
    expect(m.matchedCode).toBe('LTG-HIBAY24');
    expect(m.matchConfidence).not.toBe('fuzzy');
    expect(byCode.get('LTG-HIBAY24')!.labor_hours).toBe(1.0);
  });

  it('every other row keeps its identity (category + item) and its qty', () => {
    const out = applyReviewAnswers(rows, run.count_result, review).rows;
    expect(out.length).toBe(rows.length + 1);
    const key = (r: { category: string; item: string }) => `${r.category}||${r.item}`;
    for (const r of rows) {
      const o = out.find(x => key(x) === key(r))!;
      expect(o).toBeTruthy();
      expect(Number(o.qty)).toBe(Number(r.qty));
    }
  });

  it('no answers → the rows come back untouched', () => {
    expect(applyReviewAnswers(rows, run.count_result, unanswered).rows).toBe(rows);
  });

  it('"Same as Type A" adds the 13 to type A (14 → 27), no new line', () => {
    const out = applyReviewAnswers(rows, run.count_result, withAnswer('unlisted:H', { action: 'answer', answer: 'Same as Type A', ...by })).rows;
    expect(out.find(r => /^Type A\b/.test(r.item))!.qty).toBe(27);
    expect(out.some(r => /^Type H\b/.test(r.item))).toBe(false);
  });

  it('a count answer sets that type\'s qty (switches: same area → keep 9; different → 12)', () => {
    const keep = applyReviewAnswers(rows, run.count_result, withAnswer('area:$', { action: 'answer', answer: 'Different areas — sum 12', qty: 12, ...by })).rows;
    expect(keep.find(r => r.countType === '$')!.qty).toBe(12);
  });

  it('a status answer (how many are NEW) sets the qty', () => {
    const out = applyReviewAnswers(rows, run.count_result, withAnswer('status:DISCONNECT', { action: 'count', qty: 2, ...by })).rows;
    expect(out.find(r => r.countType === 'Disconnect')!.qty).toBe(2);
  });

  it('"not on this job" removes the type\'s line', () => {
    const out = applyReviewAnswers(rows, run.count_result, withAnswer('count:MOTOR', { action: 'not_on_job', reason: 'no motors on this job', ...by })).rows;
    expect(out.some(r => r.countType === 'Motor')).toBe(false);
  });

  it('demolition answers: "the same items — keep 10" sets the switch demo line; a counted class with no unit becomes a Demolition line', () => {
    const answers = unanswered.map(i => (i.id === 'demodup:DEMO-SWITCH' ? { ...i, resolution: { action: 'answer' as const, answer: 'The same items — keep 10', qty: 10, ...by } }
      : i.id === 'demounit:DEMO-EQUIPMENT' ? { ...i, resolution: { action: 'count' as const, qty: 8, ...by } } : i));
    const out = applyReviewAnswers(rows, run.count_result, answers).rows;
    expect(out.find(r => r.countType === 'DEMO-SWITCH')!.qty).toBe(10);
    const eq = out.find(r => r.item === 'Demolition — equipment connection / disconnect');
    expect(eq).toMatchObject({ category: 'Demolition', qty: 8 });
  });
});

describe('C fix round S4 — an answer never adds a second line; warnings stay visible', () => {
  it('the real 36th count:WP repro: 2 WP, not 4 — the existing WP GFCI line takes the count', () => {
    const out = applyReviewAnswers(rows, run.count_result, withAnswer('count:WP', { action: 'count', qty: 2, ...by }));
    const wp = out.rows.filter(r => /\bWP\b|weather/i.test(r.item) && r.category === 'Branch Power');
    expect(wp.reduce((s, r) => s + Number(r.qty), 0)).toBe(2);
    expect(wp).toHaveLength(1);
    expect(wp[0].item).toBe('WP GFCI receptacle exterior at condensers');
    expect(out.corrections.some(c => /no second line/.test(c))).toBe(true);
  });

  it('the hyphen vs em-dash H case: 13, not 26', () => {
    const next: RawTakeoffRow[] = [...rows, { category: 'Interior Lighting', item: 'Type H - LED high bay 2x4 - warehouse (per Chris)', spec: 'LED high bay 2x4', qty: 13, unit: 'EA' }];
    const out = applyReviewAnswers(next, run.count_result, review).rows;
    const h = out.filter(r => /^Type H\b/.test(r.item));
    expect(h).toHaveLength(1);
    expect(h[0].qty).toBe(13);
  });

  it('a row already tagged with the unlisted type takes the answer', () => {
    const next: RawTakeoffRow[] = [...rows, { category: 'Interior Lighting', item: 'Type H — high bay (from the re-run)', spec: 'high bay', qty: 13, unit: 'EA', countType: 'H' }];
    const out = applyReviewAnswers(next, run.count_result, review).rows;
    expect(out.filter(r => /^Type H\b/.test(r.item)).map(r => r.qty)).toEqual([13]);
  });

  it('the enforcement\'s possible-double / ambiguous warnings come through as flags and on the line', () => {
    // A counted type with its own line, plus an untagged line that reads like it.
    const extra: RawTakeoffRow = { category: 'Branch Power', item: 'Duplex receptacle, general purpose', spec: 'Duplex receptacle', qty: 4, unit: 'EA' };
    const out = applyReviewAnswers([...rows, extra], run.count_result, review);
    expect(out.flags.some(f => f.kind === 'possible_double' && /Possible double count: "Duplex receptacle, general purpose/.test(f.message))).toBe(true);
    expect(out.rows.find(r => r.item === extra.item)!.evidence).toMatch(/^⚠ Possible double count/);
  });

  it('names compare without case, dash style or punctuation', () => {
    expect(normName('Type H — LED high bay 2x4 - warehouse (per Chris)')).toBe(normName('type h - led high bay 2x4 – warehouse per chris'));
  });
});

describe('C fix round 2 — N3: a pre-tag that lowers a count raises a visible flag', () => {
  it('WP answered 1 on the 2-count WP GFCI line: lowered, flagged (kind count_lowered) and noted on the line', () => {
    const out = applyReviewAnswers(rows, run.count_result, withAnswer('count:WP', { action: 'count', qty: 1, ...by }));
    const wp = out.rows.find(r => r.item === 'WP GFCI receptacle exterior at condensers')!;
    expect(wp.qty).toBe(1);
    const f = out.flags.find(x => x.kind === 'count_lowered')!;
    expect(f.message).toMatch(/^Count lowered: "WP GFCI receptacle exterior at condensers" 2 → 1/);
    expect(wp.evidence).toMatch(/^⚠ Count lowered/);
  });

  it('an answer that keeps or raises the count raises no count_lowered flag', () => {
    const out = applyReviewAnswers(rows, run.count_result, withAnswer('count:WP', { action: 'count', qty: 2, ...by }));
    expect(out.flags.some(x => x.kind === 'count_lowered')).toBe(false);
  });
});
