// Accuracy round — Builder R's part of the replay gate (F5), on the 09-30
// live exports (no model, no DB), compared with the committed "before"
// (eval/replay-baseline-2026-09-30.json, never rewritten):
//   * no non-disputed count item goes pass -> fail, none gets a larger |delta|;
//   * Kissimmee site_poles / site_heads now pass (were 6 / 10);
//   * the power-pole hosts, review items and the projected price are printed
//     (automatic = the live counter marks; SCRIPTED = + the 09-28 counter's
//     own E-2 pole marks, see replay0930.scriptedPoleMarks0928).
// Prices are reported, not pinned here (Builder P's tasks move them; F5).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { replayPricing, countDiff, type ReplayPricing } from './replayEval';
import { validateExpectedFile, type ExpectedFile } from './takeoffEval';
import { loadKissimmeeLive0930, load36th0930, loadLiveLibrary0930 } from '../test/fixtures/realrun/live0930';
import { replayKissimmee0930, replay36th0930, scriptedPoleMarks0928 } from '../test/fixtures/realrun/replay0930';
import { isPdftoppmAvailable } from '../ai/documentPrep';
import { buildReviewItems, reviewItemIsOpen, type ReviewItem } from '../ai/reviewItems';
import type { CountResult } from '../ai/countingStage';

const BASELINE = JSON.parse(fs.readFileSync(path.join(__dirname, '../../eval/replay-baseline-2026-09-30.json'), 'utf8')) as {
  jobs: Record<string, { counting: { rows: Array<{ id: string; expected: number; actual: number | null; delta: number | null; verdict: string }> }; scenarios: Record<string, ReplayPricing> }>;
};
const expectedOf = (f: string): ExpectedFile => validateExpectedFile(JSON.parse(fs.readFileSync(path.join(__dirname, '../../eval', f), 'utf8')));

interface After { id: string; cr: CountResult; review: ReviewItem[]; expected: ExpectedFile; pricing?: ReplayPricing }
const siteOf = (cr: CountResult) => {
  const c = cr.types.filter(t => t.category === 'site_lighting' && t.status === 'counted');
  return { poles: c.reduce((n, t) => n + t.count, 0), heads: c.reduce((n, t) => n + (t.heads ?? 0), 0) };
};
const hostsOf = (cr: CountResult) => (cr.evidence?.hostAssignments ?? []).map(g => ({ host: g.hostKey, found: g.found ?? g.hostCount, stated: g.stated?.total ?? null, asked: (g.hosts?.length ?? 0) + (g.unlocated?.length ?? 0) }));

let have = false;
const after: Record<string, After> = {};
beforeAll(async () => {
  have = await isPdftoppmAvailable();
  if (!have) return;
  const lib = loadLiveLibrary0930();
  const k = await replayKissimmee0930();
  const ks = await replayKissimmee0930({ extraMarks: scriptedPoleMarks0928() });
  const t = await replay36th0930();
  const kLive = loadKissimmeeLive0930(), tLive = load36th0930();
  after.kissimmee = { id: 'kissimmee', cr: k.cr, review: k.review, expected: expectedOf('autozone-10077-kissimmee.expected.json') };
  after['kissimmee SCRIPTED poles'] = { id: 'kissimmee', cr: ks.cr, review: ks.review, expected: after.kissimmee.expected };
  after['36th'] = { id: '36th', cr: t.stage.countResult, review: buildReviewItems(t.stage.countResult), expected: expectedOf('36th-street-warehouse.expected.json') };
  for (const [name, a] of Object.entries(after)) {
    a.pricing = await replayPricing(a.id === 'kissimmee' ? kLive : tLive, lib, { rows: 'projected', countResult: a.cr, stage: 'due', ignoreCostLineSeeds: true });
    void name;
  }
}, 900_000);

describe('R replay gate (accuracy round, 2026-09-30)', () => {
  it('no non-disputed count item goes pass -> fail or gets a larger |delta| (both jobs)', (ctx) => {
    if (!have) return ctx.skip();
    for (const name of ['kissimmee', '36th']) {
      const a = after[name];
      const now = countDiff(a.expected, a.cr);
      for (const b of BASELINE.jobs[a.id].counting.rows) {
        const item = a.expected.items.find(i => i.id === b.id);
        if (item?.disputed) continue;
        const n = now.rows.find(r => r.id === b.id)!;
        if (b.verdict === 'pass') expect([name, b.id, n.verdict]).toEqual([name, b.id, 'pass']);
        if (b.delta != null && n.delta != null) expect(Math.abs(n.delta), `${name} ${b.id}`).toBeLessThanOrEqual(Math.abs(b.delta));
      }
    }
  });

  it('Kissimmee site_poles / site_heads now pass: 6 / 10 -> 3 / 4', (ctx) => {
    if (!have) return ctx.skip();
    const before = BASELINE.jobs.kissimmee.counting.rows;
    expect(['site_poles', 'site_heads'].map(id => before.find(r => r.id === id)!.actual)).toEqual([6, 10]);
    const now = countDiff(after.kissimmee.expected, after.kissimmee.cr);
    expect(['site_poles', 'site_heads'].map(id => { const r = now.rows.find(x => x.id === id)!; return [r.actual, r.verdict]; })).toEqual([[3, 'pass'], [4, 'pass']]);
    expect(siteOf(after['kissimmee SCRIPTED poles'].cr)).toEqual({ poles: 3, heads: 4 });
  });

  it('power-pole hosts: automatic 0 found of 6 stated (all asked, never the schedule\'s 2); SCRIPTED 6 distinct; 36th has none', (ctx) => {
    if (!have) return ctx.skip();
    expect(hostsOf(after.kissimmee.cr)).toEqual([{ host: 'PP-1..6', found: 0, stated: 6, asked: 6 }]);
    expect(hostsOf(after['kissimmee SCRIPTED poles'].cr)).toEqual([{ host: 'PP-1..6', found: 6, stated: 6, asked: 6 }]);
    expect(hostsOf(after['36th'].cr)).toEqual([]);
  });

  it('prints the before / after the R report quotes', (ctx) => {
    if (!have) return ctx.skip();
    const lines: string[] = [];
    for (const [name, a] of Object.entries(after)) {
      const b = BASELINE.jobs[a.id];
      const bp = b.scenarios['projected@due-fresh'];
      const p = a.pricing!;
      const now = countDiff(a.expected, a.cr);
      const open = a.review.filter(reviewItemIsOpen);
      lines.push(`== ${name}`);
      lines.push(`  site poles/heads ${JSON.stringify(siteOf(a.cr))}  hosts ${JSON.stringify(hostsOf(a.cr))}  locateAsked ${JSON.stringify(a.cr.locateAsked ?? [])}`);
      const byKind: Record<string, number> = {};
      for (const i of open) byKind[i.id.split(':')[0]] = (byKind[i.id.split(':')[0]] ?? 0) + 1;
      lines.push(`  review: ${a.review.length} items, ${open.length} blocking open — ${JSON.stringify(byKind)}`);
      lines.push(`  count diff: ${now.rows.map(r => `${r.id} ${b.counting.rows.find(x => x.id === r.id)?.actual ?? '-'}→${r.actual ?? '-'} ${r.verdict}`).join('; ')}`);
      lines.push(`  projected@due-fresh: before $${bp.sellingPrice} ${bp.hours.toFixed(1)} h held ${bp.heldCount} | after $${p.sellingPrice} ${p.hours.toFixed(1)} h held ${p.heldCount}`);
      lines.push(`    by bucket before ${JSON.stringify(bp.hoursByBucket)}`);
      lines.push(`    by bucket after  ${JSON.stringify(p.hoursByBucket)}`);
    }
    // eslint-disable-next-line no-console
    console.log(`[R replay gate]\n${lines.join('\n')}`);
    expect(lines.length).toBeGreaterThan(0);
  });
});
