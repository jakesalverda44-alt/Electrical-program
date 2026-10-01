// UI cleanup round 2A — the pure review model.
import { describe, it, expect } from 'vitest';
import type { ReviewItem } from '../TakeoffReviewPanel';
import {
  isRealReason, groupKey, GROUP_ORDER, groupHeading, unitsOf, reviewProgress, orderedGroups, openOrder,
  cardKindOf, notOnJobFirst, reasonPresets, choiceLabel,
} from './reviewModel';

const item = (o: Partial<ReviewItem> & { id: string }): ReviewItem => ({ kind: 'count', title: o.id, detail: 'd', ...o });
const member = (key: string, resolution?: ReviewItem['resolution']) => ({ key, type: key, description: key, resolution });
const rmember = (key: string, resolution?: ReviewItem['resolution']) => ({ key, type: key, description: key, unit: 'count' as const, currentQty: 1, headsPerPole: null, resolution });
const res = (o: Partial<NonNullable<ReviewItem['resolution']>> = {}): NonNullable<ReviewItem['resolution']> => ({ action: 'count', qty: 1, by: 'J', at: 't', ...o });

describe('reasonPresets', () => {
  const samples: ReviewItem[] = [
    item({ id: 'spotcheck:A', kind: 'confirm', actions: ['confirm'] }),
    item({ id: 'sheet:a.pdf#2', kind: 'confirm' }),
    item({ id: 'file:b.pdf', kind: 'confirm' }),
    item({ id: 'refsheet:E9', kind: 'confirm' }),
    item({ id: 'demosheet:x', kind: 'confirm' }),
    item({ id: 'demosheets:cap', kind: 'confirm' }),
    item({ id: 'schedule:panels', kind: 'confirm' }),
    item({ id: 'panel-dup:A', kind: 'confirm' }),
    item({ id: 'counting:not_run', kind: 'confirm' }),
    item({ id: 'coverage:SL', aiCount: 9 }),
    item({ id: 'recount:A', aiCount: 0 }),
    item({ id: 'typicalheads:A', kind: 'confirm' }),
  ];
  it('every preset of every branch is a real reason', () => {
    const zero = item({ id: 'count:G', aiCount: 0, actions: ['count', 'markers', 'not_on_job'] });
    const legend = item({ id: 'legend-zero:X', groupedTypes: [member('A')] });
    const all = [
      ...reasonPresets(zero, 'not_on_job'),
      ...reasonPresets(legend, 'not_on_job'),
      ...reasonPresets(samples[0], 'keep'),
      ...samples.flatMap(s => reasonPresets(s, 'confirm')),
    ];
    expect(all.length).toBeGreaterThan(8);
    for (const r of all) expect(isRealReason(r), r).toBe(true);
  });
  it('picks by prefix, and the AI count for a count item', () => {
    expect(reasonPresets(samples[9], 'confirm')).toEqual(['Checked on the plans — 9 is right']);
    expect(reasonPresets(samples[1], 'confirm')).toEqual(['Checked — nothing on this page is missing from the takeoff']);
    expect(reasonPresets(samples[11], 'confirm')).toEqual(['Checked — the takeoff is right as it is']);
    expect(reasonPresets(item({ id: 'count:G', actions: ['count', 'markers', 'not_on_job'] }), 'not_on_job')).toHaveLength(3);
    expect(reasonPresets(samples[0], 'keep')).toEqual(['Checked the plans — keep the current count']);
  });
  it('B1/S5: counting:* and panel-dup: confirms need a typed reason', () => {
    expect(reasonPresets(samples[8], 'confirm')).toEqual([]);
    expect(reasonPresets(samples[7], 'confirm')).toEqual([]);
  });
  it('B2: not-on-job presets only for a genuine zero count or a legend member; every other kind is typed', () => {
    const typed = [
      item({ id: 'unlisted:H', aiCount: 13, actions: ['answer', 'count', 'not_on_job'] }),
      item({ id: 'unscheduled:X', actions: ['count', 'not_on_job'] }),
      item({ id: 'typical:e2', actions: ['count', 'not_on_job'] }),
      item({ id: 'typicalqty:e2', actions: ['count', 'not_on_job'] }),
      item({ id: 'demounit:A', actions: ['count', 'not_on_job'] }),
      item({ id: 'photo:A', actions: ['count', 'not_on_job'] }),
      item({ id: 'count:S1:heads', actions: ['count', 'not_on_job'] }),
      item({ id: 'coverage:SL', actions: ['count', 'markers', 'confirm', 'not_on_job'] }),
    ];
    for (const t of typed) expect(reasonPresets(t, 'not_on_job'), t.id).toEqual([]);
    expect(reasonPresets(item({ id: 'count:G', actions: ['count', 'markers', 'not_on_job'] }), 'not_on_job').length).toBeGreaterThan(0);
    expect(reasonPresets(item({ id: 'legend-zero:X', groupedTypes: [member('A')] }), 'not_on_job').length).toBeGreaterThan(0);
  });
  it('S2: no "by others" preset anywhere', () => {
    const all = reasonPresets(item({ id: 'count:G', actions: ['count', 'not_on_job'] }), 'not_on_job');
    expect(all.some(r => /by others/i.test(r))).toBe(false);
  });
  it('S3: openOrder skips information items that share a group with blocking ones', () => {
    expect(openOrder([
      item({ id: 'remodel:conventions', group: 'remodel', blocking: false }),
      item({ id: 'reuse:P', kind: 'area', group: 'remodel' }),
    ])).toEqual(['reuse:P']);
  });
  it('equipment gets no presets for any action', () => {
    const mb = item({ id: 'count:MB', category: 'equipment', aiCount: 0 });
    for (const a of ['not_on_job', 'confirm', 'keep'] as const) expect(reasonPresets(mb, a)).toEqual([]);
  });
});

describe('cardKindOf — one sample of every item kind', () => {
  const cases: Array<[string, ReviewItem, string]> = [
    ['zero count', item({ id: 'count:G', actions: ['count', 'markers', 'not_on_job'] }), 'count'],
    ['heads', item({ id: 'count:S1:heads', actions: ['count', 'not_on_job'] }), 'count'],
    ['unscheduled', item({ id: 'unscheduled:X', actions: ['count', 'not_on_job'] }), 'count'],
    ['typical', item({ id: 'typical:e2', actions: ['count', 'not_on_job'] }), 'count'],
    ['typicalqty', item({ id: 'typicalqty:e2', actions: ['count', 'not_on_job'] }), 'count'],
    ['demounit', item({ id: 'demounit:A', actions: ['count', 'not_on_job'] }), 'count'],
    ['photo', item({ id: 'photo:A', actions: ['count', 'not_on_job'] }), 'count'],
    ['coverage', item({ id: 'coverage:SL', actions: ['count', 'markers', 'confirm', 'not_on_job'] }), 'quantity'],
    ['recount', item({ id: 'recount:A', actions: ['count', 'confirm'] }), 'quantity'],
    ['status', item({ id: 'status:A', actions: ['count', 'confirm'] }), 'quantity'],
    ['democompare', item({ id: 'democompare:A', actions: ['count', 'confirm'] }), 'quantity'],
    ['area', item({ id: 'area:A', kind: 'area', options: ['a'], actions: ['answer', 'count'] }), 'choice'],
    ['viewport', item({ id: 'viewport:A', kind: 'area', actions: ['answer', 'count'] }), 'choice'],
    ['demosuggest', item({ id: 'demosuggest:L', kind: 'area', actions: ['answer', 'count'] }), 'choice'],
    ['synonym', item({ id: 'synonym:A', kind: 'area', actions: ['answer'] }), 'choice'],
    ['reuse', item({ id: 'reuse:P', kind: 'area', actions: ['answer'] }), 'choice'],
    ['conventions', item({ id: 'remodel:conventions', actions: ['answer'] }), 'choice'],
    ['typicalassignat', item({ id: 'typicalassignat:P:S', kind: 'confirm', actions: ['answer'] }), 'choice'],
    ['scope', item({ id: 'scope:p', kind: 'scope_question' }), 'choice'],
    ['unlisted', item({ id: 'unlisted:H', actions: ['answer', 'count', 'not_on_job'] }), 'unlisted'],
    ['counting', item({ id: 'counting:not_run', kind: 'confirm', actions: ['confirm'] }), 'confirm'],
    ['sheet', item({ id: 'sheet:a#2', kind: 'confirm', actions: ['confirm'] }), 'confirm'],
    ['spotcheck', item({ id: 'spotcheck:A', kind: 'confirm', actions: ['confirm'], blocking: false }), 'confirm'],
    ['legend-zero', item({ id: 'legend-zero:X', groupedTypes: [member('A')] }), 'legendGroup'],
    ['legend-unused', item({ id: 'legend-unused:X', blocking: false, groupedTypes: [member('A')] }), 'legendGroup'],
    ['gapfill', item({ id: 'gapfill:A', actions: ['markers', 'confirm', 'count'], reconcileMembers: [rmember('A')] }), 'reconcile'],
    ['reconcile', item({ id: 'reconcile:A', kind: 'confirm', actions: ['confirm', 'count'], reconcileMembers: [rmember('A')] }), 'reconcile'],
    ['consistency', item({ id: 'consistency:A', actions: ['markers', 'confirm', 'count'], reconcileMembers: [rmember('A')] }), 'reconcile'],
    ['statuscrop:low', item({ id: 'statuscrop:low', actions: ['confirm', 'count'], reconcileMembers: [rmember('A')] }), 'reconcile'],
    ['typicalassign', item({ id: 'typicalassign:P', actions: ['count', 'confirm'], reconcileMembers: [rmember('A')] }), 'typicalAssign'],
  ];
  for (const [name, it_, expected] of cases) it(name, () => expect(cardKindOf(it_)).toBe(expected));
  it('notOnJobFirst is true for zero counts only', () => {
    expect(notOnJobFirst(item({ id: 'count:G', actions: ['count', 'markers', 'not_on_job'] }))).toBe(true);
    expect(notOnJobFirst(item({ id: 'count:S1:heads', actions: ['count', 'not_on_job'] }))).toBe(false);
    expect(notOnJobFirst(item({ id: 'unscheduled:X', actions: ['count', 'not_on_job'] }))).toBe(false);
    expect(notOnJobFirst(item({ id: 'coverage:X', actions: ['confirm'] }))).toBe(false);
  });
});

describe('unitsOf / reviewProgress', () => {
  it('a legend group with 1 of 3 answered is 1/3', () => {
    expect(unitsOf(item({ id: 'legend-zero:X', groupedTypes: [member('A', res()), member('B'), member('C')] }))).toEqual({ total: 3, answered: 1 });
  });
  it('a reconcile member waiting on its second number is not answered', () => {
    expect(unitsOf(item({ id: 'gapfill:A', reconcileMembers: [rmember('A', res({ needs: 'heads' })), rmember('B', res())] }))).toEqual({ total: 2, answered: 1 });
  });
  it('a plain item is 1 unit; a carried-over resolution counts as answered', () => {
    expect(unitsOf(item({ id: 'count:G' }))).toEqual({ total: 1, answered: 0 });
    expect(unitsOf(item({ id: 'count:G', resolution: res({ carriedOver: true }) }))).toEqual({ total: 1, answered: 1 });
    expect(unitsOf(item({ id: 'legend-zero:X', groupedTypes: [member('A'), member('B')], resolution: res() }))).toEqual({ total: 2, answered: 2 });
  });
  it('sums blocking items only', () => {
    const p = reviewProgress([
      item({ id: 'count:A', resolution: res() }),
      item({ id: 'legend-zero:X', groupedTypes: [member('A', res()), member('B'), member('C')] }),
      item({ id: 'count:B' }),
      item({ id: 'count:EF', blocking: false }),
    ]);
    expect(p).toEqual({ total: 5, answered: 2, open: 3 });
  });
});

describe('groups', () => {
  it('recount has its own group, sorted right after unreadable', () => {
    expect(groupKey(item({ id: 'recount:A' }))).toBe('recount');
    expect(GROUP_ORDER.indexOf('recount')).toBe(GROUP_ORDER.indexOf('unreadable') + 1);
    expect(groupHeading('recount')).toBe('Recount found fewer');
  });
  it('orders in the N8 $-risk order and flags info groups', () => {
    const g = orderedGroups([
      item({ id: 'scope:p', kind: 'scope_question', group: 'scope' }),
      item({ id: 'spotcheck:A', kind: 'confirm', group: 'spotcheck', blocking: false }),
      item({ id: 'count:MB', group: 'zero' }),
      item({ id: 'family:W2', kind: 'area', group: 'family' }),
      item({ id: 'gapfill:G', group: 'gapfill' }),
      item({ id: 'reconcile:B', kind: 'confirm', group: 'reconcile' }),
    ]);
    expect(g.map(x => x.key)).toEqual(['zero', 'family', 'gapfill', 'reconcile', 'scope', 'spotcheck']);
    expect(g.map(x => x.info)).toEqual([false, false, false, false, false, true]);
  });
  it('openOrder walks blocking groups only, in group order', () => {
    expect(openOrder([
      item({ id: 'scope:p', kind: 'scope_question', group: 'scope' }),
      item({ id: 'count:EF', group: 'info', blocking: false }),
      item({ id: 'count:A', group: 'zero' }),
      item({ id: 'count:B', group: 'zero' }),
    ])).toEqual(['count:A', 'count:B', 'scope:p']);
  });
  it('headings are short and an area group keeps its sheet names', () => {
    expect(groupHeading('zero')).toBe('Not found on the plans');
    expect(groupHeading('area:E-2 / E-2.1')).toBe('Same area? E-2 / E-2.1');
    expect(groupHeading('area')).toBe('Same area? two plans of one level');
    expect(groupHeading('nonsense')).toBe('Other');
  });
});

describe('choiceLabel', () => {
  const area = item({ id: 'area:A', kind: 'area' });
  it('area options read as plain choices, with the number kept', () => {
    expect(choiceLabel(area, 'Same area — keep 40', 0)).toEqual({ label: 'Same area — keep the larger (40)' });
    expect(choiceLabel(area, 'Different areas — sum 75', 1)).toEqual({ label: 'Different areas — add them (75)' });
  });
  it('reuse options get a short label and a hint', () => {
    const reuse = item({ id: 'reuse:P', kind: 'area' });
    expect(choiceLabel(reuse, 'Existing, reused — no new install, no demolition', 0)).toEqual({ label: 'Existing reused', hint: 'no new install, no demolition' });
    expect(choiceLabel(reuse, 'New install — the old one is removed', 1)).toEqual({ label: 'New install', hint: 'the old one is removed' });
  });
  it('falls back to the option text', () => {
    expect(choiceLabel(area, 'Something unexpected', 0)).toEqual({ label: 'Something unexpected' });
    expect(choiceLabel(item({ id: 'scope:p' }), 'APT', 0)).toEqual({ label: 'APT' });
  });
});
