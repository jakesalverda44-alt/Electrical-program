// Accuracy round C3 — locate-only targets (feeder endpoints): built from
// Agent 1's panels / service / feeder-size equipment, asked in the counter's
// existing calls under LOCATE ONLY, stored as count_result.locate[] — never a
// type, a takeoff line, a review item or an AI marker. No live model.
import { describe, it, expect, beforeAll } from 'vitest';
import { buildCountTargets, buildLocateTargets, normalizeFeederNode, MAX_LOCATE_TARGETS } from './countTargets';
import { buildCounterContent, parseCounterResponse } from './counter';
import { runCountingStage, type CountResult } from './countingStage';
import { buildReviewItems } from './reviewItems';
import { isPdftoppmAvailable } from './documentPrep';
import { fakeAnthropic, emptyEvidenceReply, systemText, userText, type FakeRequest } from '../test/fixtures/takeoff/fakeAnthropic';
import { buildKissimmeeSetPdf, ownedBuffer, KISSIMMEE_SET_CLASSIFIED } from '../test/fixtures/takeoff/kissimmeeSet';
import { loadKissimmeeLive0930, load36th0930 } from '../test/fixtures/realrun/live0930';
import { replayKissimmee0930 } from '../test/fixtures/realrun/replay0930';

describe('C3 — the feeder node names (R\'s own normalizer; P\'s feederNodes() can replace it)', () => {
  it('normalizes the names a drawing uses', () => {
    const cases: Array<[string, string | null, boolean?]> = [
      ['A', 'PANEL A', true], ['DISCON A', 'DISCON A', true], ['Panel A ckts 27,29', 'PANEL A'], ['DISCON A (200A fused switch)', 'DISCON A'],
      ['Disc. B', 'DISCON B'], ['Meter base', 'METER'], ['MB', 'METER'], ['Wireway', 'WIREWAY'], ['gutter', 'WIREWAY'],
      ['utility transformer', 'XFMR'], ['XFMR', 'XFMR'], ['MDP', 'MDP'], ['RTU-1', 'RTU-1'], ['COMP #1', 'COMP-1'], ['AHU #2', 'AHU-2'],
      ['Disconnects shown in warehouse', null], ['200A fused switch', null], ['Rooftop unit', null],
    ];
    for (const [raw, want, asPanel] of cases) expect([raw, normalizeFeederNode(raw, { asPanel: !!asPanel })]).toEqual([raw, want]);
  });

  it('Kissimmee 09-30: the panels, their disconnects, the wireway / meter they are fed from, the service transformer, and the two 60/3 RTUs', () => {
    const t = buildLocateTargets(loadKissimmeeLive0930().agent1);
    expect(t.map(x => x.node)).toEqual(['PANEL A', 'PANEL B', 'DISCON A', 'DISCON B', 'WIREWAY', 'METER', 'XFMR', 'RTU-1', 'RTU-2']);
    expect(t.every(x => x.role === 'locate' && x.key === `@${x.node}`)).toBe(true);
  });

  it('36th Street 09-30: the existing service is never a node; the four 40A/2P HVAC units with 3#6 are', () => {
    const t = buildLocateTargets(load36th0930().agent1);
    expect(t.map(x => x.node)).toEqual(['PANEL A', 'PANEL B', 'COMP-1', 'AHU-1', 'COMP-2', 'AHU-2']);
  });

  it('at most 20 per job (the prompt budget)', () => {
    const panels = Array.from({ length: 30 }, (_, i) => ({ name: `LP${i}`, amps: 100 }));
    expect(buildLocateTargets({ panels }).length).toBe(MAX_LOCATE_TARGETS);
  });

  it('the prompt lists them under LOCATE ONLY, apart from the count targets; a locate reply is a position + confidence, never unreadable', () => {
    const counted = buildCountTargets({ fixtureSchedule: [{ type: 'A', description: '4 ft LED', wattage: 32, location: 'interior' }] }).targets;
    const loc = buildLocateTargets({ panels: [{ name: 'A', amps: 225, voltage: '208Y/120V' }] });
    const text = (buildCounterContent({ label: 'E-1' }, [...counted, ...loc], [], { index: 1, of: 1 })[0] as { text: string }).text;
    expect(text).toMatch(/COUNT TARGETS[^]*- A \|[^]*LOCATE ONLY — place ONE mark at each item's symbol or label[^]*never count, never report as a device[^]*\n- @PANEL A \| A — 225A 208Y\/120V panelboard/);
    expect(text.indexOf('- @PANEL A')).toBeGreaterThan(text.indexOf('LOCATE ONLY'));
    const p = parseCounterResponse(JSON.stringify({ marks: [['@PANEL A', 'R1C1', 0.4, 0.5, 'low'], ['A', 'R1C1', 0.1, 0.1]], unreadable: [{ type: '@PANEL A', tile: 'R1C1', note: 'x' }] }), new Set(['A', '@PANEL A']), new Set(['R1C1']))!;
    expect(p.marks.map(m => [m.typeKey, m.locateConfidence])).toEqual([['@PANEL A', 'low'], ['A', undefined]]);
    expect(p.unreadable).toEqual([]);
  });
});

describe('C3 — a counter reply with locate marks (real renders, fake model)', () => {
  let have = false;
  let cr: CountResult;
  let calls: FakeRequest[];
  beforeAll(async () => {
    have = await isPdftoppmAvailable();
    if (!have) return;
    const pdf = ownedBuffer(buildKissimmeeSetPdf());
    const agent1 = {
      fixtureSchedule: [{ type: 'A', description: '4 ft LED linear wraparound', wattage: 32, location: 'interior', symbol: 'square', sourceSheet: 'E-0.1' }],
      panels: [{ name: 'A', amps: 225, voltage: '208Y/120V', fedFrom: 'DISCON A (200A fused switch)' }],
      equipment: [{ tag: 'RTU-1', description: 'Rooftop unit, 60/3, 3#6,#10G,3/4"C' }],
      quantities: [],
    };
    const fake = fakeAnthropic(req => {
      const ev = emptyEvidenceReply(req);
      if (ev) return ev;
      if (!systemText(req).includes('counting symbols on ONE')) throw new Error(`unexpected model call: ${systemText(req).slice(0, 80)}`);
      const t = userText(req);
      const first = [...t.matchAll(/Tile (R\d+C\d+) \(row/g)][0][1];
      if (!t.includes('SHEET: E-1')) return { text: JSON.stringify({ marks: [], unreadable: [], notes: [] }) };
      return { text: JSON.stringify({ marks: [['A', first, 0.2, 0.3], ['@PANEL A', first, 0.5, 0.5, ''], ['@DISCON A', first, 0.6, 0.5, 'low']], unreadable: [], notes: [] }) };
    });
    calls = fake.calls;
    const inventory = KISSIMMEE_SET_CLASSIFIED.map(c => ({ ...c, file: 'set.pdf', included: true }));
    const stage = await runCountingStage({
      client: fake.client, model: 'claude-opus-5-5', maxTokens: 8000, agent1, inventory: inventory as never, pdfs: new Map([['set.pdf', pdf]]),
      evidence: { model: 'claude-opus-5-5', maxTokens: 4000 },
    });
    cr = stage.countResult;
  }, 300_000);

  it('stored in count_result.locate[] (node, sheet, PDF points, confidence); asked = every node', (ctx) => {
    if (!have) return ctx.skip();
    expect(cr.locateAsked).toEqual(['PANEL A', 'DISCON A', 'RTU-1']);
    expect(cr.locate!.map(l => [l.node, l.confidence, l.sheetKey.endsWith('#' + l.sheetKey.split('#').pop())])).toEqual([['PANEL A', 'high', true], ['DISCON A', 'low', true]]);
    expect(cr.locate!.every(l => Number.isFinite(l.x) && Number.isFinite(l.y))).toBe(true);
  });

  it('never a type, a target, a takeoff row, a mark (AI marker) or a review item', (ctx) => {
    if (!have) return ctx.skip();
    expect(cr.types.some(t => t.key.startsWith('@'))).toBe(false);
    expect(cr.targets.some(t => t.key.startsWith('@'))).toBe(false);
    expect(cr.marks.some(m => m.typeKey.startsWith('@'))).toBe(false);
    expect(cr.marks.filter(m => m.typeKey === 'A').length).toBeGreaterThan(0);
    expect(buildReviewItems(cr).some(i => /@|PANEL A|DISCON A/.test(`${i.id} ${i.title}`))).toBe(false);
    // Asked in the existing counter calls (no extra call for them).
    expect(calls.filter(c => systemText(c).includes('counting symbols on ONE') && userText(c).includes('LOCATE ONLY')).length)
      .toBe(calls.filter(c => systemText(c).includes('counting symbols on ONE') && !userText(c).includes('CONSISTENCY PASS') && !/PH0/.test(userText(c))).length);
  });
});

describe('C3 — the Kissimmee 09-30 replay (the live counter answers; it never saw a LOCATE item)', () => {
  let have = false;
  let r: Awaited<ReturnType<typeof replayKissimmee0930>>;
  beforeAll(async () => { have = await isPdftoppmAvailable(); if (have) r = await replayKissimmee0930(); }, 300_000);
  it('the E sheets are asked to locate the nine nodes; nothing is located (the live replies hold no locate mark); every count as before', (ctx) => {
    if (!have) return ctx.skip();
    expect(r.cr.locateAsked).toEqual(['PANEL A', 'PANEL B', 'DISCON A', 'DISCON B', 'WIREWAY', 'METER', 'XFMR', 'RTU-1', 'RTU-2']);
    expect(r.cr.locate).toEqual([]);
    const e1 = r.calls.find(c => userText(c).includes('SHEET: E-1') && !userText(c).includes('CONSISTENCY PASS'))!;
    expect(userText(e1)).toContain('- @DISCON A | DISCON A — 200A 208Y/120V disconnect (Exterior)');
    // The photometric sheet is never asked to locate anything.
    expect(r.calls.filter(c => userText(c).includes('SHEET: PH0.1')).every(c => !userText(c).includes('LOCATE ONLY'))).toBe(true);
  });
});
