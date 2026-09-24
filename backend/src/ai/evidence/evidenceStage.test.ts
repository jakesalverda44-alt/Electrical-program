// Evidence round 1.1 / 2.1 / 3.1 — the evidence readers' I/O on a RASTER
// plan set (image-only pages, no text layer, /Rotate 270) built from real
// Kissimmee crops. The fake client answers from the executor's transcriptions
// of the real sheets; every render, crop, parse and cache step is real.
import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import { buildRasterSet, KISSIMMEE_E1, KISSIMMEE_E2, KISSIMMEE_E4 } from '../../test/fixtures/evidence/buildRasterSheet';
import { evidenceResponder, isEvidenceRequest } from '../../test/fixtures/evidence/kissimmeeReplies';
import { fakeAnthropic, imageCount, type FakeRequest } from '../../test/fixtures/takeoff/fakeAnthropic';
import { runEvidenceStage, readPagesText, renderRegion, type EvidenceCache, type EvidencePage } from './evidenceStage';
import { readPageGeometry } from '../countRender';
import { isPdftoppmAvailable } from '../documentPrep';
import { imageLimitsFor, imageTokens } from '../modelLimits';
import { buildCountTargets } from '../countTargets';
import { isAgentTruncatedError } from '../stopReason';
import { loadKissimmeeBaseline } from '../../test/fixtures/evidence/kissimmeeBaseline';
const baseline = loadKissimmeeBaseline();
import type Anthropic from '@anthropic-ai/sdk';

const FILE = 'kissimmee-raster.pdf';
const PAGES: EvidencePage[] = [
  { key: `${FILE}#1`, file: FILE, page: 1, label: 'E-1 "Power Plan & General Notes"', counted: true },
  { key: `${FILE}#2`, file: FILE, page: 2, label: 'E-2 "Power Plan & Details"', counted: true },
  { key: `${FILE}#3`, file: FILE, page: 3, label: 'E-4 "Lighting Control Panel Details"', counted: false },
];
const REAL_PAGE: Record<string, number> = { 'E-1': 49, 'E-2': 50, 'E-4': 52 };
const pageOf = (s: string) => {
  const byKey = /#(\d)$/.exec(s);
  if (byKey) return [49, 50, 52][Number(byKey[1]) - 1];
  return REAL_PAGE[s.split(' ')[0]];
};
const MODEL = 'claude-sonnet-4-6';
const { targets } = buildCountTargets(baseline.agent1);

let have = false;
let pdf: Buffer;
beforeAll(async () => {
  have = await isPdftoppmAvailable();
  pdf = await buildRasterSet([KISSIMMEE_E1, KISSIMMEE_E2, KISSIMMEE_E4]);
}, 60_000);

function memCache(): EvidenceCache & { size: () => number } {
  const m = new Map<string, unknown>();
  return {
    size: () => m.size,
    async get(sha, page, kind, key) { return m.get(`${sha}|${page}|${kind}|${key}`) ?? null; },
    async set(sha, page, kind, key, v) { m.set(`${sha}|${page}|${kind}|${key}`, JSON.parse(JSON.stringify(v))); },
  };
}

describe('the raster fixture really has no text layer', () => {
  it('pdf.js finds no text on any page; the drawing area is image-only', async () => {
    const t = await readPagesText(pdf, [1, 2, 3]);
    for (const p of [1, 2, 3]) expect(t.get(p)!.runs).toEqual([]);
    expect(t.get(2)!.geometry).toMatchObject({ widthPt: 1728, heightPt: 2592, rotation: 270 });
  });
});

describe('runEvidenceStage on the raster E-1 / E-2 / E-4', () => {
  it('vision path: one overview call per sheet, crops for legends and tables, parsed and validated', async (ctx) => {
    if (!have) return ctx.skip();
    const { client, calls } = fakeAnthropic(evidenceResponder(pageOf));
    const out = await runEvidenceStage({ client, model: MODEL, maxTokens: 16000, pages: PAGES, pdfs: new Map([[FILE, pdf]]), targets });
    expect(out.errors).toEqual([]);
    expect(out.pages.map(p => [p.viewports.source, p.hasTextLayer])).toEqual([['vision', false], ['vision', false], ['vision', false]]);
    // Viewports: 7 on E-1, 11 on E-2, 6 on E-4.
    expect(out.pages.map(p => p.viewports.viewports.length)).toEqual([7, 11, 6]);
    // Typicals: E-1's coil+J receptacle, E-2's five pole packages.
    expect(out.typicals.map(t => t.host)).toEqual([
      'Junction box with 6\'-0" flex conduit at wall & H.P. counters',
      'Office area power pole', 'Checkout counter power pole', 'Parts pod power pole', 'Test station power pole', 'Commercial counter power pole',
    ]);
    expect(out.typicals[0].hostTargetKey).toBe('COIL + J');
    expect(out.typicals[1].devices.map(d => [d.targetKey, d.qty])).toEqual([['DUPLEX RECEPTACLE / FLOOR RECEPTACLE', 2], ['SIMPLEX RECEPTACLE', null]]);
    // Tables: E-1 #5 POWER SCHEDULE, E-4 LOAD TOTALS / PANEL A / PANEL B.
    expect(out.tables.map(t => [t.title, t.kind, t.rows.length]).sort()).toEqual([
      ['LOAD TOTALS', 'load', 2], ['PANEL A', 'panel', 42], ['PANEL B', 'panel', 42], ['POWER SCHEDULE', 'other', 10],
    ]);
    expect(out.tables.every(t => t.warnings.length === 0)).toBe(true);
    // Calls: 3 overviews, 2 typicals (E-4 has no legend/notes), 4 tables.
    const kinds = calls.map(c => isEvidenceRequest(c));
    expect(kinds.filter(k => k === 'viewports')).toHaveLength(3);
    expect(kinds.filter(k => k === 'typicals')).toHaveLength(2);
    expect(kinds.filter(k => k === 'table')).toHaveLength(4);
    expect(out.calls).toBe(9);
    // Every image is inside the model's limits (never downscaled by the server).
    const lim = imageLimitsFor(MODEL);
    for (const c of calls) {
      for (const b of (c.messages[0].content as Array<{ type: string; source?: { data: string } }>).filter(x => x.type === 'image')) {
        const meta = await sharp(Buffer.from(b.source!.data, 'base64')).metadata();
        expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(lim.maxLongEdge);
        expect(imageTokens(meta.width!, meta.height!)).toBeLessThanOrEqual(lim.maxTokens);
      }
    }
    // E-2's typicals call carried its three textual viewports as images.
    const e2typ = calls.find((c, i) => kinds[i] === 'typicals' && /@9 —/.test(JSON.stringify(c.messages)))!;
    expect(imageCount(e2typ)).toBe(3);
    // The caller's Buffer is intact (pdf.js got a copy, never a view).
    expect((await readPageGeometry(pdf, [2])).get(2)!.rotation).toBe(270);
  }, 120_000);

  it('crops land on the real drawing: the #9 legend crop is inked, an empty viewport of the fixture is blank', async (ctx) => {
    if (!have) return ctx.skip();
    const g = { widthPt: 1728, heightPt: 2592, originX: 0, originY: 0, rotation: 270 };
    const lim = imageLimitsFor(MODEL);
    const ink = async (png: Buffer) => {
      const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
      let dark = 0; for (const v of data) if (v < 128) dark++;
      return dark / data.length;
    };
    // #9 POWER POLE LEGEND text sits at 22.6-33.2" x 8.0-11.9" displayed.
    const legend = await renderRegion(pdf, 2, g, { left: 22.6, top: 8.1, width: 10.6, height: 3.6 }, lim);
    const blank = await renderRegion(pdf, 2, g, { left: 1.5, top: 16.5, width: 5, height: 7 }, lim);
    expect(await ink(legend.png)).toBeGreaterThan(0.01);
    expect(await ink(blank.png)).toBe(0);
    expect(legend.dpi).toBeGreaterThan(90);
  }, 60_000);

  it('a cached page is never read twice (same file content, same model and prompt version)', async (ctx) => {
    if (!have) return ctx.skip();
    const cache = memCache();
    const a = fakeAnthropic(evidenceResponder(pageOf));
    const first = await runEvidenceStage({ client: a.client, model: MODEL, maxTokens: 16000, pages: PAGES, pdfs: new Map([[FILE, pdf]]), targets, cache });
    expect(first.calls).toBe(9);
    const b = fakeAnthropic(() => { throw new Error('should not be called'); });
    const second = await runEvidenceStage({ client: b.client, model: MODEL, maxTokens: 16000, pages: PAGES, pdfs: new Map([[FILE, pdf]]), targets, cache });
    expect(second.calls).toBe(0);
    expect(second.cached).toBe(9);
    expect(second.tables.length).toBe(first.tables.length);
    expect(second.typicals).toEqual(first.typicals);
    // A different model re-reads.
    const c = fakeAnthropic(evidenceResponder(pageOf));
    const third = await runEvidenceStage({ client: c.client, model: 'claude-opus-5-5', maxTokens: 16000, pages: PAGES.slice(1, 2), pdfs: new Map([[FILE, pdf]]), targets, cache });
    expect(third.calls).toBe(2);
  }, 120_000);

  it('a failed read loses only that evidence (recorded); a truncated read fails the run', async (ctx) => {
    if (!have) return ctx.skip();
    const ok = evidenceResponder(pageOf);
    const flaky = fakeAnthropic((req: FakeRequest) => (isEvidenceRequest(req) === 'viewports' && /E-2/.test(JSON.stringify(req.messages)) ? { text: 'I could not find any viewports.' } : ok(req)));
    const out = await runEvidenceStage({ client: flaky.client, model: MODEL, maxTokens: 16000, pages: PAGES, pdfs: new Map([[FILE, pdf]]), targets });
    expect(out.pages[1].viewports.source).toBe('none');
    expect(out.errors.join(' ')).toMatch(/E-2 .*viewports could not be read \(the viewport reply was not in the expected shape\)/);
    expect(out.typicals.filter(t => t.sheetKey.endsWith('#2'))).toEqual([]);
    const trunc = fakeAnthropic(() => ({ text: '{"viewports":[', stop_reason: 'max_tokens' }));
    await expect(runEvidenceStage({ client: trunc.client, model: MODEL, maxTokens: 16000, pages: PAGES.slice(0, 1), pdfs: new Map([[FILE, pdf]]), targets }))
      .rejects.toSatisfy((e: unknown) => isAgentTruncatedError(e));
  }, 120_000);

  it('a stop throws before the next read', async (ctx) => {
    if (!have) return ctx.skip();
    const { client } = fakeAnthropic(evidenceResponder(pageOf));
    await expect(runEvidenceStage({ client: client as Anthropic, model: MODEL, maxTokens: 16000, pages: PAGES, pdfs: new Map([[FILE, pdf]]), targets, shouldStop: () => true }))
      .rejects.toThrow(/cancel|stop/i);
  });
});
