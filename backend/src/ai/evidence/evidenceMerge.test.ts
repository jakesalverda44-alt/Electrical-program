// Evidence round — the merge and the review list with evidence: the enlarged-
// plan question (1.3), the sheet-pair relationship being gated with the
// evidence round (1.4), typical host counts that are missing (2.2), family
// questions (3.3), schedule-owned lines and the parser's circuit rows (3.2 /
// 3.4), and what the estimator's answers enforce. Real Kissimmee types.
import { describe, it, expect } from 'vitest';
import { buildCountTargets, type CountTarget } from '../countTargets';
import { mergeCountsIntoTakeoff, type SheetCountInput } from '../countMerge';
import { buildReviewItems, enforcedCounts, validateResolution, type ReviewItem } from '../reviewItems';
import type { CountResult } from '../countingStage';
import { parseViewportReply, type SheetGeom } from './viewports';
import { resolveSheetMarks } from './viewportResolve';
import { parseTypicalsReply, hostTargets } from './typicals';
import { parseScheduleReply, scheduleCounts } from './schedules';
import { selectCountSheets } from '../countSheets';
import { VIEWPORT_REPLIES, TYPICALS_REPLIES, TABLE_REPLIES, E1_RESTROOM_REPEATS } from '../../test/fixtures/evidence/kissimmeeReplies';
import { loadKissimmeeBaseline, KISSIMMEE_FILE } from '../../test/fixtures/evidence/kissimmeeBaseline';

const base = loadKissimmeeBaseline();
const { targets } = buildCountTargets(base.agent1);
const G: SheetGeom = { widthPt: 1728, heightPt: 2592, originX: 0, originY: 0, rotation: 270 };
const key = (p: number) => `${KISSIMMEE_FILE}#${p}`;
const sel = selectCountSheets(base.inventory);
const sheetOf = (p: number) => sel.counted.find(s => s.page === p)!;

function input(page: number, opts: { viewports?: boolean; areaUnknown?: boolean; extra?: Array<{ type: string; x: number; y: number }> } = {}): SheetCountInput {
  let vps = opts.viewports === false ? null : parseViewportReply(VIEWPORT_REPLIES[page], key(page), G)!.viewports;
  if (vps && opts.areaUnknown) vps = vps.map(v => ({ ...v, areaOnMain: undefined }));
  const marks = [...base.marks.filter(m => m.sheetKey === key(page)).map(m => ({ typeKey: m.typeKey, x: m.x, y: m.y })), ...(opts.extra ?? []).map(e => ({ typeKey: e.type, x: e.x, y: e.y }))];
  const res = resolveSheetMarks(marks, vps, G);
  return { sheet: sheetOf(page), status: 'counted', placed: res.counted, unreadable: [], geometry: G, viewports: vps, pendingEnlarged: res.pending };
}
const others = () => [19, 51, 55].map(p => {
  const marks = base.marks.filter(m => m.sheetKey === key(p));
  return { sheet: sheetOf(p), status: 'counted' as const, placed: marks.map(m => ({ typeKey: m.typeKey, x: m.x, y: m.y })), unreadable: [], geometry: base.sheets.find(s => s.page === p)!.geometry };
});
const cr = (m: ReturnType<typeof mergeCountsIntoTakeoff>, ts: CountTarget[], ev?: Partial<NonNullable<CountResult['evidence']>>): CountResult => ({
  version: 2, ran: true, model: 'm', targets: ts, targetNotes: [], sheets: [], skippedSheets: [], types: m.types, loadCheck: m.loadCheck,
  removedRows: m.removedRows, flags: m.flags, marks: [],
  ...(ev ? { evidence: { model: 'e', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, calls: 0, cached: 0, errors: [], pages: [], typicals: [], expansions: m.evidence?.expansions ?? [], unmappedTypical: m.evidence?.unmappedTypical ?? [], tables: [], families: m.evidence?.families ?? [], symbolDefinitions: [], circuitRows: 0, scheduleOwned: [], panelsExpected: 0, panelsUnread: [], ...ev } } : {}),
});
const answer = (item: ReviewItem, idx: number) => ({ ...validateResolution(item, { action: 'answer', answer: item.options![idx] }, null) as { ok: true; resolution: NonNullable<ReviewItem['resolution']> }, by: 'e', at: 't' });

describe('1.4 is part of the evidence round (off = the title-only question, exactly as before)', () => {
  it('evidence off: E-1 / E-2 raise "same area?"; on: complementary layers, B-32 (on both) counted once -> 9', () => {
    const sheets = [input(49, { viewports: false }), input(50, { viewports: false }), ...others()];
    const off = mergeCountsIntoTakeoff(base.agent1, targets, sheets, { countingRan: true });
    expect(off.types.find(t => t.key === 'SIMPLEX RECEPTACLE')).toMatchObject({ count: 5, areaQuestion: { keep: 5, sum: 10 } });
    const on = mergeCountsIntoTakeoff(base.agent1, targets, [input(49), input(50), ...others()], { countingRan: true, evidence: {} });
    const s = on.types.find(t => t.key === 'SIMPLEX RECEPTACLE')!;
    expect(s.count).toBe(9);
    expect(s.areaQuestion).toBeUndefined();
    expect(s.flags.join(' ')).toMatch(/− 1 drawn on both/);
    expect(s.relations![0]).toMatchObject({ kind: 'complementary' });
  });
});

describe('1.3 — an enlarged plan whose place on the main plan is unknown', () => {
  const m = mergeCountsIntoTakeoff(base.agent1, targets, [input(49, { areaUnknown: true, extra: E1_RESTROOM_REPEATS }), input(50), ...others()], { countingRan: true, evidence: {} });
  const items = buildReviewItems(cr(m, targets));
  const q = items.find(i => i.id === 'viewport:GFCI')!;
  it('raises one question with both totals: repeats (keep 3) or adds (9)', () => {
    expect(q).toMatchObject({ kind: 'area', keepQty: 3, sumQty: 9, group: 'viewport' });
    expect(q.detail).toMatch(/#3 RESTROOM POWER AND LIGHTING: 6/);
  });
  it('the answer is enforced', () => {
    const resolved = items.map(i => (i.id === q.id ? { ...i, resolution: answer(i, 1).resolution } : i));
    expect(enforcedCounts(cr(m, targets), resolved).byType.get('GFCI')).toBe(9);
    const kept = items.map(i => (i.id === q.id ? { ...i, resolution: answer(i, 0).resolution } : i));
    expect(enforcedCounts(cr(m, targets), kept).byType.get('GFCI')).toBe(3);
  });
});

describe('2.2 — a typical whose hosts were not counted', () => {
  const pk = parseTypicalsReply(TYPICALS_REPLIES[50], { sheetKey: key(50), source: 'vision', viewports: [{ id: `${key(50)}@9`, label: '#9 POWER POLE LEGEND' }], targets })!.packages;
  const all = [...targets, ...hostTargets(pk, targets)];
  // No host marks at all (the counter found none of the pole tags).
  const m = mergeCountsIntoTakeoff(base.agent1, all, [input(49), input(50), ...others()], { countingRan: true, evidence: { typicals: pk } });
  const c = cr(m, all, {});
  const items = buildReviewItems(c);
  it('no expansion; one blocking item per pole type naming its devices and the legend quote; hosts never lines or zero items', () => {
    const typ = items.filter(i => i.id.startsWith('typical:'));
    expect(typ).toHaveLength(5);
    expect(typ[3]).toMatchObject({ kind: 'count', group: 'typical', typicalDevices: [{ key: 'SIMPLEX RECEPTACLE', perHost: 1 }, { key: 'DUPLEX RECEPTACLE / FLOOR RECEPTACLE', perHost: 1 }] });
    expect(typ[3].detail).toMatch(/TEST STATION POWER POLE WITH ONE SIMPLEX OUTLET/);
    expect(items.some(i => i.id.startsWith('count:HOST'))).toBe(false);
    expect(m.quantities.some(q => /HOST TAG/.test(String(q.item)))).toBe(false);
    expect(m.types.find(t => t.key === 'DUPLEX RECEPTACLE / FLOOR RECEPTACLE')!.components!.typical).toBe(0);
  });
  it('the estimator\'s host count expands it: 2 parts-pod poles -> +2 duplex', () => {
    const it2 = items.find(i => i.id === `typical:${pk[2].id}`)!;
    const r = validateResolution(it2, { action: 'count', qty: 2 }, null);
    expect(r.ok).toBe(true);
    const before = enforcedCounts(c, items).byType.get('DUPLEX RECEPTACLE / FLOOR RECEPTACLE')!;
    const after = enforcedCounts(c, items.map(i => (i.id === it2.id ? { ...i, resolution: { ...(r as { ok: true; resolution: NonNullable<ReviewItem['resolution']> }).resolution, by: 'e', at: 't' } } : i))).byType.get('DUPLEX RECEPTACLE / FLOOR RECEPTACLE')!;
    expect(after - before).toBe(2);
  });
});

describe('3.2 / 3.4 — schedule-owned lines and the parser\'s circuit rows', () => {
  const ctx = (t: string) => ({ sheetKey: key(52), sheetLabel: 'E-4 "Lighting Control Panel Details"', viewportId: `${key(52)}@${t}`, viewportTitle: t });
  const tables = ['PANEL A', 'PANEL B', 'LOAD TOTALS'].map(t => parseScheduleReply(TABLE_REPLIES[t], ctx(t))!);
  const sc = scheduleCounts(targets, tables);
  const m = mergeCountsIntoTakeoff(base.agent1, targets, [input(49), input(50), ...others()], { countingRan: true, evidence: { scheduleCounts: sc, tables } });
  it('a schedule-owned line is VERIFIED, countedBy schedule, sourced from the schedule sheet', () => {
    const line = m.quantities.find(q => q.countType === 'BATT CHGR')!;
    expect(line).toMatchObject({ qty: 5, countedBy: 'schedule', confidence: 'VERIFIED', sourceSheet: 'E-4' });
  });
  it('Agent 1\'s circuit-count rows are replaced by the parser\'s (with the rows); nothing is held as an "unscheduled fixture"', () => {
    const items = buildReviewItems(cr(m, targets, { tables }));
    expect(items.some(i => /UNSCHEDULED:.*CIRCUITS/i.test(i.id))).toBe(false);
    expect(m.quantities.filter(q => q.countedBy === 'schedule' && /Branch circuit/.test(String(q.item))).map(q => [q.item, q.qty])).toEqual([
      ['Branch circuit 20/1 — Panel A', 31], ['Branch circuit 60/3 — Panel B', 2], ['Branch circuit 20/1 — Panel B', 14],
    ]);
  });
  it('a panel schedule found but not read -> a blocking item (its circuits would have no source); Agent 1\'s circuit rows stay when nothing was parsed', () => {
    const m2 = mergeCountsIntoTakeoff(base.agent1, targets, [input(49), input(50), ...others()], { countingRan: true, evidence: {} });
    const items = buildReviewItems(cr(m2, targets, { panelsExpected: 2, panelsUnread: ['PANEL B (E-4)'] }));
    expect(items.find(i => i.id === 'schedule:panels-unread')).toMatchObject({ kind: 'confirm', group: 'schedule' });
    expect(buildReviewItems(cr(m2, targets, { panelsExpected: 2 })).some(i => i.id === 'schedule:panels-unread')).toBe(false);
    expect(m2.quantities.some(q => q.category === 'Branch Power' && /Lighting branch circuits/.test(String(q.item)))).toBe(true);
  });
});

describe('3.3 — merged types carry no line, no review item, no enforced count', () => {
  const m = mergeCountsIntoTakeoff(base.agent1, targets, [input(49), input(50), ...others()], { countingRan: true, evidence: {} });
  const c = cr(m, targets);
  it('the untagged E-7 site light and SITE LIGHT are merged; S1/S2 lines carry 3 poles / 4 heads', () => {
    expect(m.types.filter(t => t.status === 'merged').map(t => t.key)).toEqual(expect.arrayContaining(['SITE LIGHT', '(UNTAGGED) SITE LIGHT', 'W1', 'W2']));
    expect(m.quantities.some(q => q.countType === '(untagged) SITE LIGHT' || q.countType === 'SITE LIGHT')).toBe(false);
    const poles = m.quantities.filter(q => /— pole/.test(String(q.item))).reduce((s, q) => s + Number(q.qty), 0);
    const heads = m.quantities.filter(q => /fixture heads/.test(String(q.item))).reduce((s, q) => s + Number(q.qty), 0);
    expect([poles, heads]).toEqual([3, 4]);
    const items = buildReviewItems(c);
    expect(items.some(i => /SITE LIGHT/.test(i.id))).toBe(false);
    expect(enforcedCounts(c, items).byType.has('SITE LIGHT')).toBe(false);
  });
  it('Agent 1 rows that ARE the site poles are the family\'s lines; a receptacle or base at a pole is not', () => {
    const a1 = { ...base.agent1, quantities: [
      { category: 'Exterior Site Lighting', item: 'Site light pole locations (A-15 single, A-17 two heads @90 deg, A-19 single)', qty: 3, unit: 'EA' },
      { category: 'Exterior Site Lighting', item: 'GFCI receptacle at light pole base', qty: 3, unit: 'EA' },
      { category: 'Exterior Site Lighting', item: 'Light pole concrete base', qty: 3, unit: 'EA' },
    ] };
    const m2 = mergeCountsIntoTakeoff(a1, targets, [input(49), input(50), ...others()], { countingRan: true, evidence: {} });
    expect(m2.removedRows.map(r => [String(r.row.item).slice(0, 20), !!r.unscheduled])).toEqual([
      ['Site light pole loca', false], ['GFCI receptacle at l', true], ['Light pole concrete ', true],
    ]);
  });
  it('a family question\'s answer replaces the primary\'s count', () => {
    const fake: CountResult = { ...c, evidence: { ...cr(m, targets, {}).evidence!, families: [{ family: 'DSXW1', primary: ['L'], merged: [], question: { key: 'W2', memberCount: 4, primaryCount: 1, into: 'L', intoKeys: ['L'] }, flags: [] }] } };
    const items = buildReviewItems(fake);
    const q = items.find(i => i.id === 'family:W2')!;
    expect(q).toMatchObject({ kind: 'area', keepQty: 1, sumQty: 4, group: 'family' });
    const res = items.map(i => (i.id === q.id ? { ...i, resolution: answer(i, 1).resolution } : i));
    expect(enforcedCounts(fake, res).byType.get('L')).toBe(4);
  });
});

describe('fix round B4 — named partitions still sum; an enlarged same-area sheet is never summed', () => {
  const t = targets.find(x => x.key === 'SIMPLEX RECEPTACLE')!;
  const mk = (no: string, title: string, role: 'building' | 'enlarged', area: string, n: number, dx: number): SheetCountInput => ({
    sheet: { ...sheetOf(49), key: `k#${no}`, sheetNo: no, title, label: `${no} "${title}"`, role, area, level: '', focus: 'power' },
    status: 'counted', unreadable: [], geometry: G, viewports: null,
    placed: Array.from({ length: n }, (_, i) => ({ typeKey: t.key, x: 300 + i * 40, y: 600 + dx })),
  });
  it('AREA A / AREA B: summed (named-area path)', () => {
    const m = mergeCountsIntoTakeoff(base.agent1, [t], [mk('E-2.1', 'POWER PLAN AREA A', 'building', 'AREA A', 4, 0), mk('E-2.2', 'POWER PLAN AREA B', 'building', 'AREA B', 3, 0)], { countingRan: true, evidence: {} });
    expect(m.types[0].count).toBe(7);
  });
  it('an ENLARGED plan sheet of the same area: the larger is kept, never summed', () => {
    const m = mergeCountsIntoTakeoff(base.agent1, [t], [mk('E-2', 'POWER PLAN', 'building', '', 4, 0), mk('E-5', 'ENLARGED OFFICE POWER PLAN', 'enlarged', '', 3, 0)], { countingRan: true, evidence: {} });
    expect(m.types[0].count).toBe(4);
  });
  it('two same-level plans with the SAME marks and no building box: kept once (the reviewer\'s 10-duplex shape) -> 10', () => {
    const a = { ...mk('E-2', 'POWER PLAN', 'building', '', 10, 0), placed: [...mk('E-2', 'x', 'building', '', 10, 0).placed, ...Array.from({ length: 5 }, (_, i) => ({ typeKey: 'COIL + J', x: 900 + i * 30, y: 900 }))] };
    const b = { ...mk('E-3', 'SYSTEMS PLAN', 'building', '', 10, 0), placed: [...mk('E-3', 'x', 'building', '', 10, 0).placed, ...Array.from({ length: 8 }, (_, i) => ({ typeKey: 'P', x: 1200 + i * 30, y: 1500 }))] };
    const m = mergeCountsIntoTakeoff(base.agent1, targets, [a, b], { countingRan: true, evidence: {} });
    expect(m.types.find(x => x.key === t.key)!.count).toBe(10);
  });
});
