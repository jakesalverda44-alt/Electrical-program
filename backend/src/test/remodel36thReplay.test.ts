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
import { replay36th, isCounter, isTitles, type Live36th } from './fixtures/realrun/replay36th';
import { replay0928 } from './fixtures/realrun/replay0928';
import { userText, type FakeRequest } from './fixtures/takeoff/fakeAnthropic';
import { isPdftoppmAvailable } from '../ai/documentPrep';
import { CONVENTION_OPTIONS } from '../ai/remodel/status';
import { enforcedCounts, reviewItemIsOpen, validateResolution, type ReviewItem } from '../ai/reviewItems';
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
    // fix S7 — labelled for what it is, never "not used on this job"
    expect(item(remodel, 'count:GFI').detail).toContain('shown as existing only — not priced (7 on the counted sheets)');
    expect(remodel.review.filter(i => i.groupedTypes).flatMap(i => i.groupedTypes!.map(m => m.key))).not.toEqual(expect.arrayContaining(['GFI']));
    expect(remodel.review.some(i => i.groupedTypes?.some(m => m.key === 'GFI' || m.key === '42'))).toBe(false);
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
      ['Demolition — fluorescent fixture up to 2x4', 52, 'DEMO-FIXTURE', 'counter'],
      ['Demolition — HID high bay fixture', 2, 'DEMO-HIGHBAY', 'counter'],
      ['Demolition — exit/emergency light', 2, 'DEMO-EXIT', 'counter'],
      ['Demolition — receptacle', 18, 'DEMO-RECEPTACLE', 'counter'],
      ['Demolition — single-pole switch', 6, 'DEMO-SWITCH', 'counter'],
      ['Demolition — 3-way switch', 2, 'DEMO-SWITCH3', 'counter'],
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
    // Fix round B2 — the mock tags every 3rd mark "existing" with NO printed
    // rule: nothing moves (every type keeps its base count) and that is said.
    for (const t of base.stage.countResult.types) expect([t.key, count(none, t.key).count], t.key).toEqual([t.key, t.count]);
    expect(none.stage.countResult.remodel!.existing).toEqual([]);
    expect(none.stage.countResult.remodel!.ignoredStatuses!.length).toBeGreaterThan(0);
    expect(q.detail).toContain('with no printed rule they are counted as new');
    expect(none.review.some(i => i.id === 'remodel:existing' || i.id.startsWith('status:'))).toBe(false);
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

  it('fix S1 — E1.0 titled "ELECTRICAL DEMOLITION AND NEW WORK PLAN": counted for both, status per mark, never demolition-only', async (ctx) => {
    if (!have) return ctx.skip();
    const r = await replay36th({ mutate: run => {
      const e1 = run.countResult.sheets.find(s => s.page === 15)!;
      e1.viewports = e1.viewports!.map(v => (v.kind === 'main_plan' ? { ...v, title: 'ELECTRICAL DEMOLITION AND NEW WORK PLAN' } : v));
    }, conventions: false });
    const e1 = userText(r.calls.find(c => isCounter(c) && userText(c).includes('SHEET: E1.0'))!);
    expect(e1).toContain('STATUS (remodel job)');
    expect(e1).not.toContain('DEMOLITION SHEET');
    const rm = r.stage.countResult.remodel!;
    expect(rm.demolitionSheets.map(d => d.label)).not.toContain('E1.0 "Electrical Plan"');
    expect(rm.conventions.find(c => c.source === 'title')?.quote).toBe('ELECTRICAL DEMOLITION AND NEW WORK PLAN');
    // the title is the rule on E1.0: statuses apply there (E2.0, no rule: all new)
    expect(r.stage.countResult.types.find(t => t.key === 'DUPLEX RECEPTACLE')!.count).toBeLessThan(14);
    expect(r.stage.countResult.types.find(t => t.key === 'A')!.count).toBe(14);
  }, 300_000);

  it('fix S2 — A3.0\'s exit units drawn 300 pt away from A2.0\'s (same sheet size, not registered): never de-duplicated silently — ONE question', async (ctx) => {
    if (!have) return ctx.skip();
    const r = await replay36th({ shiftA3: 300 });
    const exit = rows(r).find(x => x.countType === 'DEMO-EXIT')!;
    expect(exit.qty).toBe(4);
    const q = item(r, 'demodup:DEMO-EXIT');
    expect([q.keepQty, q.sumQty, reviewItemIsOpen(q)]).toEqual([2, 4, true]);
  }, 300_000);

  it('fix S5 — the titles call for A2.0 is truncated: the run still completes, A2.0 is not a demolition sheet, a non-blocking note says so', async (ctx) => {
    if (!have) return ctx.skip();
    const r = await replay36th({ truncateTitles: ['A2.0'] });
    const rm = r.stage.countResult.remodel!;
    expect(rm.demolitionSheets.map(d => d.label)).toEqual(['A3.0 "EXISTING REFLECTIVE CEILING PLAN - DEMOLITIONS"']);
    const note = item(r, 'remodel:titles');
    expect([note.blocking, note.detail]).toEqual([false, expect.stringContaining('A2.0')]);
    expect(rows(r).find(x => x.countType === 'DEMO-RECEPTACLE')).toBeUndefined();
  }, 300_000);

  it('fix S6 — 10 demolition sheets: 6 are counted, the other 4 are listed in ONE blocking item', async (ctx) => {
    if (!have) return ctx.skip();
    const { MAX_DEMOLITION_SHEETS } = await import('../ai/countingStage');
    const r = await replay36th({ mutate: run => {
      run.inventory = run.inventory.map(p => ([3, 6, 7, 9, 10, 11, 12, 13].includes(p.page) ? { ...p, cls: 'plan', discipline: 'architectural', title: `Demolition Plan ${p.page}` } : p));
    } });
    const rm = r.stage.countResult.remodel!;
    expect(rm.demolitionSheets.length).toBe(MAX_DEMOLITION_SHEETS);
    expect(rm.uncountedDemolition!.length).toBe(4);
    const cap = item(r, 'demosheets:cap');
    expect([reviewItemIsOpen(cap), cap.title]).toEqual([true, '4 more demolition sheets not counted']);
    expect(r.calls.filter(isCounter).length).toBe(2 + MAX_DEMOLITION_SHEETS);
  }, 300_000);

  it('fix S8 — 3 site pole lights on the demolition sheet: never a "fluorescent fixture" line; ONE blocking item; the estimator\'s count adds a Demolition line', async (ctx) => {
    if (!have) return ctx.skip();
    const r = await replay36th({ sitePoles: 3 });
    expect(rows(r).some(x => x.countType === 'DEMO-SITE-POLE')).toBe(false);
    expect(rows(r).find(x => x.countType === 'DEMO-FIXTURE')!.qty).toBe(52);
    const u = item(r, 'demounit:DEMO-SITE-POLE');
    expect([u.title, reviewItemIsOpen(u)]).toEqual(['Demolition — site pole light: 3 counted — no demolition labor unit for it', true]);
    const answered = r.review.map(i => (i.id === u.id ? { ...i, resolution: { action: 'count' as const, qty: 3, by: 'Jake', at: 'now' } } : i));
    expect(enforcedCounts(r.stage.countResult, answered).extraLines).toContainEqual({ category: 'Demolition', item: 'Demolition — site pole light', qty: 3 });
  }, 300_000);

  it('fix Q2 — titles call failed, but the sheet-check title itself says DEMOLITION: still a demolition sheet (the note still appears); a SITE demolition title is not', async (ctx) => {
    if (!have) return ctx.skip();
    const retitle = (title: string) => (run: Live36th) => {
      run.inventory = run.inventory.map(p => (p.page === 4 ? { ...p, title } : p));
    };
    const r = await replay36th({ truncateTitles: ['A2.0'], mutate: retitle('Existing Floor Plan - Demolitions') });
    const rm = r.stage.countResult.remodel!;
    expect(rm.demolitionSheets.map(d => d.label)).toEqual(['A2.0 "Existing Floor Plan - Demolitions"', 'A3.0 "EXISTING REFLECTIVE CEILING PLAN - DEMOLITIONS"']);
    expect(item(r, 'remodel:titles').blocking).toBe(false);
    expect(rows(r).find(x => x.countType === 'DEMO-RECEPTACLE')!.qty).toBe(18);
    const site = await replay36th({ truncateTitles: ['A2.0'], mutate: retitle('Site Demolition Plan') });
    expect(site.stage.countResult.remodel!.demolitionSheets.map(d => d.label)).toEqual(['A3.0 "EXISTING REFLECTIVE CEILING PLAN - DEMOLITIONS"']);
  }, 300_000);

  it('the bid says "new building": no remodel mode at all (same calls and counts as without it)', async (ctx) => {
    if (!have) return ctx.skip();
    const nb = await replay36th({ remodel: { buildType: 'new' } });
    expect(nb.stage.countResult.remodel).toBeUndefined();
    expect(nb.calls.length).toBe(base.calls.length);
    expect(nb.stage.countResult.types).toEqual(base.stage.countResult.types);
  }, 300_000);
});

describe('36th Street — A2 unlisted tags', () => {
  it('type H drawn 13× on E2.0: ONE blocking item, a SUGGESTION only; circuits / room names / keyed notes are dropped', (ctx) => {
    if (!have) return ctx.skip();
    const u = remodel.stage.countResult.unlisted!;
    expect(u.tags.map(t => [t.tag, t.total])).toEqual([['H', 13]]);
    expect(u.rejected.map(r => r.tag).sort()).toEqual(['12', 'A01', 'A05', 'A26', 'BREAKROOM', 'EM', 'F2', 'LP1-5', 'RTU-1', 'X']);
    expect(u.rejected.find(r => r.tag === 'F2')!.reason).toBe('an equipment tag');
    const h = item(remodel, 'unlisted:H');
    expect(h.title).toBe('Type H drawn 13× on E2.0 — not in the fixture schedule. What is it?');
    expect(reviewItemIsOpen(h)).toBe(true);
    expect(h.detail).toContain('SUGGESTION ONLY — not counted');
    expect(h.options).toContain('Same as Type A');
    // Agent 1's own "Type H" unscheduled row is folded into it (not a second item).
    expect(remodel.review.some(i => i.id.startsWith('unscheduled:TYPE-H'))).toBe(false);
    expect(h.detail).toContain('The drawing analysis also read');
    // never counted: no H type, no H line, A unchanged
    expect(remodel.stage.countResult.types.some(t => t.key === 'H')).toBe(false);
    expect(enforcedCounts(remodel.stage.countResult, remodel.review).byType.get('A')).toBe(14);
  });

  it('"Same as Type A" adds the 13 to A; a named count becomes its own line; a count without a name is refused', (ctx) => {
    if (!have) return ctx.skip();
    const h = item(remodel, 'unlisted:H');
    const answer = (res: NonNullable<ReviewItem['resolution']>) => remodel.review.map(i => (i.id === h.id ? { ...i, resolution: res } : i));
    const same = validateResolution(h, { action: 'answer', answer: 'Same as Type A' }, null);
    expect(same.ok).toBe(true);
    const e1 = enforcedCounts(remodel.stage.countResult, answer({ ...(same as unknown as { resolution: NonNullable<ReviewItem["resolution"]> }).resolution, by: 'Jake', at: 'now' }));
    expect(e1.byType.get('A')).toBe(27);
    expect(validateResolution(h, { action: 'count', qty: 13 }, null).ok).toBe(false);
    const named = validateResolution(h, { action: 'count', qty: 13, reason: "4ft LED strip, surface mounted (warehouse)" }, null);
    expect(named.ok).toBe(true);
    const e2 = enforcedCounts(remodel.stage.countResult, answer({ ...(named as unknown as { resolution: NonNullable<ReviewItem["resolution"]> }).resolution, by: 'Jake', at: 'now' }));
    expect(e2.extraLines).toEqual([{ category: 'Interior Lighting', item: 'Type H — 4ft LED strip, surface mounted (warehouse)', qty: 13 }]);
    expect(e2.byType.get('A')).toBe(14);
  });
});

describe('36th Street — fix S3: "Same as Type X" is never overwritten and never vanishes', () => {
  it('C answered 4 in the legend group + H (13) "Same as Type C" -> C 17; C "not on this job" -> H reopens (blocking), nothing lost', async (ctx) => {
    if (!have) return ctx.skip();
    const { applyGroupMemberResolution, reopenOrphanedMerges } = await import('../ai/reviewItems');
    const group = remodel.review.find(i => i.id.startsWith('legend-zero:'))!;
    expect(group.groupedTypes!.map(m => m.key)).toContain('C');
    const h = item(remodel, 'unlisted:H');
    expect(h.mergeTargets!['Same as Type C']).toBe('C');
    const withAnswers = (member: Parameters<typeof applyGroupMemberResolution>[2]) => remodel.review.map(i => (i.id === group.id ? applyGroupMemberResolution(i, 'C', member, 'Jake')
      : i.id === h.id ? { ...i, resolution: { action: 'answer' as const, answer: 'Same as Type C', by: 'Jake', at: 'now' } } : i));
    const counted = withAnswers({ action: 'count', qty: 4 });
    expect(enforcedCounts(remodel.stage.countResult, counted).byType.get('C')).toBe(17);
    const gone = reopenOrphanedMerges(withAnswers({ action: 'not_on_job', reason: 'no pendants on this job' }));
    const h2 = gone.find(i => i.id === h.id)!;
    expect([reviewItemIsOpen(h2), h2.previousResolution?.answer]).toEqual([true, 'Same as Type C']);
    expect(h2.detail).toContain('that type is marked not on this job');
  });
});

describe('36th Street — A3 legend noise', () => {
  it('fix Q1: $4, $D, 220V, AF, fourplex (no distinguishing word named anywhere) collapse into ONE info group; OS / TC / S (real evidence) stay blocking with their placeholder rows', (ctx) => {
    if (!have) return ctx.skip();
    for (const r of [base, remodel]) {
      const g = r.review.find(i => i.id.startsWith('legend-unused:'))!;
      expect([g.title, g.blocking, g.group]).toEqual(['Legend symbols not used on this job (5)', false, 'legend-unused']);
      expect(g.groupedTypes!.map(m => m.type)).toEqual(['$4', '$D', '220V', 'AF', 'fourplex']);
      const zero = r.review.find(i => i.id.startsWith('legend-zero:'))!;
      expect(reviewItemIsOpen(zero)).toBe(true);
      expect(zero.groupedTypes!.map(m => m.type)).toEqual(['C', 'D', 'E1', 'E3', 'OS', 'S', 'TC']);
      const pending = rows(r).filter(q => String(q.spec ?? '').startsWith('COUNT PENDING')).map(q => q.countType);
      for (const t of ['$4', '$D', '220V', 'AF', 'fourplex']) expect(pending).not.toContain(t);
      expect(pending).toEqual(expect.arrayContaining(['OS', 'TC', 'S', 'C', 'D', 'E1', 'E3']));
    }
  });
});

describe('Kissimmee 2026-09-28 (new build) — unchanged', () => {
  const before = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/realrun/kissimmee-0928-review-before-remodel.json'), 'utf8')) as { review: ReviewItem[]; types: Array<{ key: string; count: number; status: string }> };
  let after: { cr: CountResult; review: ReviewItem[]; calls: FakeRequest[] };
  beforeAll(async () => { if (have) after = await replay0928({ remodel: { buildType: null, answer: null } }); }, 300_000);

  it('no remodel mode, the same model calls, every count and status identical', (ctx) => {
    if (!have) return ctx.skip();
    expect(after.cr.remodel).toBeUndefined();
    expect(after.cr.unlisted).toBeUndefined();
    expect(after.calls.length).toBe(6);
    expect(after.calls.some(c => userText(c).includes('STATUS (remodel job)'))).toBe(false);
    expect(after.cr.types.map(t => ({ key: t.key, count: t.count, status: t.status }))).toEqual(before.types);
  });

  it('fix B1 — the reviewer\'s repro: V0.1 renamed "Boundary & Existing Conditions Survey" (plus the site demolition plan D0.1) stays a new build', async (ctx) => {
    if (!have) return ctx.skip();
    const renamed = await replay0928({
      remodel: { buildType: null, answer: null }, statusEvery: 3,
      inventory: inv => inv.map(p => (p.sheetNo === 'V0.1' ? { ...p, title: 'Boundary & Existing Conditions Survey' } : p)),
    });
    expect(renamed.cr.remodel).toBeUndefined();
    expect(renamed.calls.length).toBe(6);
    expect(renamed.calls.some(c => userText(c).includes('STATUS (remodel job)'))).toBe(false);
    expect(renamed.cr.types.map(t => ({ key: t.key, count: t.count, status: t.status }))).toEqual(before.types);
    expect(renamed.review.some(i => i.id === 'remodel:conventions')).toBe(false);
  }, 300_000);

  it('fix B2 — a remodel with NO printed rule, a counter tagging every 3rd mark existing: every count unchanged, ONE blocking question', async (ctx) => {
    if (!have) return ctx.skip();
    const r = await replay0928({ remodel: { buildType: 'remodel', answer: null }, statusEvery: 3 });
    expect(r.cr.remodel).toBeDefined();
    expect(r.calls.some(c => userText(c).includes('STATUS (remodel job)'))).toBe(true);
    const counted = before.types.filter(t => t.status === 'counted');
    for (const t of counted) expect([t.key, r.cr.types.find(x => x.key === t.key)?.count], t.key).toEqual([t.key, t.count]);
    const q = r.review.find(i => i.id === 'remodel:conventions')!;
    expect(reviewItemIsOpen(q)).toBe(true);
    expect(r.cr.remodel!.existing).toEqual([]);
    // "All devices are new": the counter is not even asked, no question.
    const allNew = await replay0928({ remodel: { buildType: 'remodel', answer: CONVENTION_OPTIONS[0] }, statusEvery: 3 });
    expect(allNew.calls.some(c => userText(c).includes('STATUS (remodel job)'))).toBe(false);
    for (const t of counted) expect([t.key, allNew.cr.types.find(x => x.key === t.key)?.count], t.key).toEqual([t.key, t.count]);
    expect(allNew.review.some(i => i.id === 'remodel:conventions')).toBe(false);
  }, 600_000);

  it('fix Q1: every review item identical except ONE legend symbol with no evidence (the alarm interface module) moving to the informational group', (ctx) => {
    if (!have) return ctx.skip();
    const strip = (xs: ReviewItem[]) => xs.filter(i => !i.id.startsWith('legend-zero:') && !i.id.startsWith('legend-unused:'));
    expect(strip(after.review)).toEqual(strip(before.review));
    const wasGroup = before.review.find(i => i.id.startsWith('legend-zero:'))!.groupedTypes!.map(m => m.key).sort();
    const nowZero = after.review.find(i => i.id.startsWith('legend-zero:'))!.groupedTypes!.map(m => m.key);
    const nowUnused = after.review.find(i => i.id.startsWith('legend-unused:'))!;
    expect(nowUnused.groupedTypes!.map(m => m.key)).toEqual(['AUTOMATIC LIGHTING CONTROL ALARM INTERFACE MODULE (6/E6)']);
    expect(nowUnused.blocking).toBe(false);
    expect([...nowZero, ...nowUnused.groupedTypes!.map(m => m.key)].sort()).toEqual(wasGroup);
  });
});
