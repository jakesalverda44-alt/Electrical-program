// Fewer-questions round Task 2 — the zero-count checklist on both
// 2026-09-30 replays (D1 yes: legend-symbol equipment joins as "enter each"
// rows), the pinned proposals, and enforcedCounts parity with the
// standalone count:<K> items it replaces.
import { describe, it, expect, beforeAll } from 'vitest';
import { replayReview, type ReplayReview } from '../../eval/reviewReplay';
import { applyGroupMemberResolution, enforcedCounts, reviewStatus, type ReviewItem } from '../reviewItems';
import { isPdftoppmAvailable } from '../documentPrep';
import { nounsOf } from './zeroChecklist';

let have = false;
const r: Partial<Record<'kissimmee' | '36th', ReplayReview>> = {};
beforeAll(async () => {
  have = await isPdftoppmAvailable();
  if (!have) return;
  r.kissimmee = await replayReview('kissimmee');
  r['36th'] = await replayReview('36th');
}, 900_000);

const checklistOf = (x: ReplayReview) => x.items.filter(i => i.id.startsWith('textzero:'));
const row = (m: NonNullable<ReviewItem['groupedTypes']>[number]) => `${m.rowKind} ${m.key}: ${m.proposal ? `${m.proposal.tier} ${m.proposal.action === 'count' ? m.proposal.qty : 'not on job'}` : '—'}`;

describe('textzero checklist (replays)', () => {
  it('Kissimmee: exactly one checklist, 11 text rows + 2 legend rows, pinned proposals', (ctx) => {
    if (!have) return ctx.skip();
    const [c, ...more] = checklistOf(r.kissimmee!);
    expect(more).toHaveLength(0);
    expect(c.id).toBe('textzero:equipment');
    expect(c.blocking).toBeUndefined();
    expect(c.groupedTypes!.map(row)).toEqual([
      'text AIM: —', 'text CF1-CF3: stated 3', 'text DC: —', 'text FSC: —', 'text LCP: —', 'text MB: —', 'text PC: —',
      'text PYLON SIGN: covered not on job', 'text QC/RELOCK: —', 'text TSTAT: stated 2', 'text WIREWAY: —',
      'legend 200A FUSED SWITCH NEMA 3R: —', 'legend T: —',
    ]);
    const by = new Map(c.groupedTypes!.map(m => [m.key, m]));
    expect(by.get('CF1-CF3')!.alsoDrawn).toEqual([{ sheet: 'E-3', count: 3 }]);
    expect(by.get('PYLON SIGN')!.alsoDrawn).toEqual([{ sheet: 'E-7', count: 1 }]);
    expect(by.get('PYLON SIGN')!.proposal!.reason).toMatch(/^Covered by SIGNS \(A-18\)/);
    expect(by.get('TSTAT')!.proposal!.reason).toBe('Stated: "Thermostats #1 and #2 above electric panels (2)" (the equipment list)');
    expect(by.get('T')!.twinOf).toBe('TSTAT');
    expect(by.get('LCP')!.label).toBe('Owner furnishes, APT installs');
    expect(by.get('DC')!.label).toMatch(/^low-voltage \/ controls/);
    expect(by.get('200A FUSED SWITCH NEMA 3R')!.label).toMatch(/the panels name 2: "DISCON A \(200A fused switch\)"/);
    // no standalone count:<K> left for an absorbed type
    expect(r.kissimmee!.items.filter(i => i.id.startsWith('count:'))).toHaveLength(0);
  });

  it('36th Street: 2 text rows + 4 legend rows; AHU #2 named → 1', (ctx) => {
    if (!have) return ctx.skip();
    const [c] = checklistOf(r['36th']!);
    expect(c.groupedTypes!.map(row)).toEqual([
      'text AHU #2: named 1', 'text TIMER: —',
      'legend EQUIPMENT DIRECT POWER: —', 'legend J: —', 'legend M: —', 'legend MOTOR: —',
    ]);
    // the informational existing-only zeros stay as they are (D3 no)
    expect(r['36th']!.items.filter(i => i.id.startsWith('count:')).map(i => `${i.id}:${i.blocking}`)).toEqual(['count:GFI:false', 'count:WP:false', 'count:42:false']);
  });

  it('blocks until every row has an answer; legend rows never carry a proposal', (ctx) => {
    if (!have) return ctx.skip();
    for (const x of [r.kissimmee!, r['36th']!]) {
      let c = checklistOf(x)[0];
      expect(c.groupedTypes!.filter(m => m.rowKind === 'legend').every(m => !m.proposal)).toBe(true);
      const keys = c.groupedTypes!.map(m => m.key);
      for (const k of keys.slice(0, -1)) c = applyGroupMemberResolution(c, k, { action: 'not_on_job', reason: 'not on this job at all' }, 'Jake');
      expect(c.resolution).toBeUndefined();
      expect(reviewStatus([c])).toBe('needs_review');
      c = applyGroupMemberResolution(c, keys[keys.length - 1], { action: 'count', qty: 1 }, 'Jake');
      expect(reviewStatus([c])).toBe('clear');
    }
  });

  it('enforcedCounts parity: a member answer = answering the old count:<K> item the same way', (ctx) => {
    if (!have) return ctx.skip();
    for (const x of [r.kissimmee!, r['36th']!]) {
      const c = checklistOf(x)[0];
      c.groupedTypes!.forEach((m, n) => {
        for (const res of [{ action: 'count' as const, qty: n + 2 }, { action: 'not_on_job' as const, reason: 'not on this job at all' }, { action: 'markers' as const, qty: 4 }]) {
          const withMember = x.items.map(i => (i.id === c.id ? applyGroupMemberResolution(i, m.key, res, 'Jake') : i));
          const old: ReviewItem = { id: `count:${m.key}`, kind: 'count', title: m.type, detail: '', typeKey: m.key, resolution: { ...res, by: 'Jake', at: 'x' } };
          const withOld = [...x.items.filter(i => i.id !== c.id), old];
          expect(enforcedCounts(x.countResult, withMember).byType.get(m.key)).toEqual(enforcedCounts(x.countResult, withOld).byType.get(m.key));
          expect(Object.fromEntries(enforcedCounts(x.countResult, withMember).byType)).toEqual(Object.fromEntries(enforcedCounts(x.countResult, withOld).byType));
        }
      });
    }
  });
});

describe('twin nouns', () => {
  it('thermostat ↔ TSTAT; fused switch ↔ disconnect; nothing generic', () => {
    expect([...nounsOf('T Thermostat')]).toEqual(['thermostat']);
    expect(nounsOf('TSTAT Thermostats #1 and #2 above electric panels (2)').has('thermostat')).toBe(true);
    expect(nounsOf('200A fused switch NEMA 3R').has('disconnect')).toBe(true);
    expect(nounsOf('HVAC disconnect with unit').has('disconnect')).toBe(true);
    expect(nounsOf('Junction box').size).toBe(1);
  });
});
