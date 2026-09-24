// Takeoff accuracy Task 5 — the counting stage inside the REAL runPipeline:
// the committed kissimmee-mini.pdf goes through the real page classifier
// plumbing, real pdftoppm Stage 0 tiling, the real 300 DPI counting renderer,
// the counter (a fake client answering like a perfect counter), the merge,
// and on to Agents 2 and 3 (fakes). No network, no real Anthropic call.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool';
import { dbAvailable } from './harness';
import { fakeAnthropic, systemText, userText, type FakeRequest } from './fixtures/takeoff/fakeAnthropic';
import { perfectCounter } from './fixtures/takeoff/perfectCounter';
import { MINI_P2_SYMBOLS, MINI_P3_SYMBOLS } from './fixtures/takeoff/buildSymbolPdf';
import { runPipeline, loadAIConfig } from '../routes/preconstruction';
import { readPageGeometry, renderCountTiles, type RenderedCountPage } from '../ai/countRender';
import { isPdftoppmAvailable } from '../ai/documentPrep';
import type { CountResult } from '../ai/countingStage';

const PDF = fs.readFileSync(path.join(__dirname, 'fixtures/takeoff/kissimmee-mini.pdf'));

let ok = false;
let have = false;
const rendered: Record<number, RenderedCountPage> = {};
beforeAll(async () => {
  ok = await dbAvailable();
  have = await isPdftoppmAvailable();
  if (!have) return;
  const geo = await readPageGeometry(PDF, [2, 3, 4]);
  for (const p of [2, 3, 4]) rendered[p] = await renderCountTiles(PDF, p, geo.get(p)!);
}, 120_000);

async function makeBid(): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO bids (name, gc, loc, brand) VALUES ($1, 'Summit General Contractors', 'Kissimmee, FL', 'AutoZone') RETURNING id`,
    [`CountPipe ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`]
  );
  await pool.query(`INSERT INTO takeoff_results (bid_id, status) VALUES ($1, 'running')`, [rows[0].id]);
  return rows[0].id as string;
}

const CLASSIFIED = [
  { page: 1, sheetNo: 'E-0.1', title: 'FIXTURE SCHEDULE', discipline: 'electrical', cls: 'schedule' },
  { page: 2, sheetNo: 'E-3', title: 'LIGHTING PLAN', discipline: 'electrical', cls: 'plan' },
  { page: 3, sheetNo: 'E-1', title: 'ELECTRICAL SITE PLAN', discipline: 'electrical', cls: 'plan' },
  { page: 4, sheetNo: 'PH0.1', title: 'PHOTOMETRIC SITE PLAN', discipline: 'electrical', cls: 'plan' },
];

// Agent 1 as it failed on Kissimmee: 0 interior fixtures, 8 wall packs, a
// stacked "Site lights 4" from the photometric sheet.
const AGENT1 = {
  project: { name: 'AutoZone mini', address: '', gcName: 'AutoZone Stores LLC', gcContact: '', gcEmail: '', drawingDate: '2025-02-07', sheets: ['E-0.1', 'E-3', 'E-1', 'PH0.1'], projectType: 'retail', sqFt: 0 },
  service: { voltage: '208Y/120', mainAmps: 400, phase: 3, utilityCompany: '', transformerKVA: '', confidence: 'VERIFIED' },
  panels: [{ name: 'LP', amps: 225, voltage: '208/120', phase: 3, circuits: 42, location: '', fedFrom: '', nemaRating: '', confidence: 'VERIFIED' }],
  equipment: [],
  quantities: [
    { category: 'Interior Lighting', item: 'Type A 4 ft LED wraparound', qty: 0, unit: 'EA', spec: '', sourceSheet: 'E-3', confidence: 'ASSUMED' },
    { category: 'Exterior Site Lighting', item: 'LED wall pack (D)', qty: 8, unit: 'EA', spec: '', sourceSheet: 'E-3', confidence: 'VERIFIED' },
    { category: 'Exterior Site Lighting', item: 'Pole light S1', qty: 2, unit: 'EA', spec: '', sourceSheet: 'E-1', confidence: 'VERIFIED' },
    { category: 'Exterior Site Lighting', item: 'Site lights', qty: 4, unit: 'EA', spec: '', sourceSheet: 'PH0.1', confidence: 'VERIFIED' },
  ],
  allowances: [], ecfeciItems: [], flags: [], scopeNotes: [], missingSheets: [],
  fixtureSchedule: [
    { type: 'A', description: '4 ft LED linear wraparound', wattage: 32, location: 'interior', headsPerPole: 0, emergency: false, symbol: 'filled square', sourceSheet: 'E-0.1' },
    { type: 'B', description: '8 ft LED linear wraparound', wattage: 64, location: 'interior', headsPerPole: 0, emergency: false, symbol: 'filled square', sourceSheet: 'E-0.1' },
    { type: 'D', description: 'LED wall pack', wattage: 40, location: 'exterior_building', headsPerPole: 0, emergency: false, symbol: 'filled square', sourceSheet: 'E-0.1' },
    { type: 'G', description: '6 in LED downlight', wattage: 15, location: 'interior', headsPerPole: 0, emergency: false, symbol: 'circle', sourceSheet: 'E-0.1' },
    { type: 'S1', description: 'LED area light single head 25 ft pole', wattage: 150, location: 'site', headsPerPole: 1, emergency: false, symbol: 'filled square', sourceSheet: 'E-0.1' },
    { type: 'S2', description: 'LED area light twin head 25 ft pole', wattage: 300, location: 'site', headsPerPole: 2, emergency: false, symbol: 'filled square', sourceSheet: 'E-0.1' },
  ],
  symbolLegend: [], panelCircuits: [], furnishStatements: [],
};

function responder() {
  const counter = perfectCounter({
    'E-3 "LIGHTING PLAN"': { rendered: rendered[2], symbols: MINI_P2_SYMBOLS },
    'E-1 "ELECTRICAL SITE PLAN"': { rendered: rendered[3], symbols: MINI_P3_SYMBOLS },
    // Next round A3 — the photometric site plan shows the same poles.
    'PH0.1 "PHOTOMETRIC SITE PLAN"': { rendered: rendered[4], symbols: MINI_P3_SYMBOLS },
  });
  return (req: FakeRequest) => {
    const sys = systemText(req);
    if (sys.includes('construction document sheet classifier')) {
      const pages = [...userText(req).matchAll(/Page (\d+) \(absolute/g)].map(m => Number(m[1]));
      return { text: JSON.stringify(CLASSIFIED.filter(c => pages.includes(c.page))) };
    }
    if (sys.includes('Senior Electrical Drawing Analyzer')) return { text: JSON.stringify(AGENT1) };
    if (sys.includes('counting symbols on ONE electrical plan sheet')) return counter(req);
    if (sys.includes('Senior Electrical Estimator')) return { text: JSON.stringify({ scopeOfWork: {}, takeoff: [], rfis: [], manualCountRequired: [] }) };
    if (sys.includes('Chief Electrical Estimator')) return { text: JSON.stringify({ overallRisk: 'LOW', readyToSubmit: true }) };
    throw new Error(`unexpected agent: ${sys.slice(0, 60)}`);
  };
}

describe('runPipeline — counting stage on kissimmee-mini.pdf', () => {
  it('counts every plan sheet (the photometric one for site types only, never stacked) and replaces Agent 1\'s numbers before Agent 2', async (ctx) => {
    if (!ok || !have) return ctx.skip();
    const bidId = await makeBid();
    const { client, calls } = fakeAnthropic(responder());
    const config = await loadAIConfig();
    const file = { originalname: 'AZ 10077 set.pdf', buffer: PDF, mimetype: 'application/pdf', size: PDF.length } as Express.Multer.File;
    await runPipeline(bidId, [file], client, config);

    const { rows } = await pool.query('SELECT status, agent1_output, count_result, usage_counter, model_counter, account_terms, review_items, review_status, hygiene FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(rows[0].status).toBe('complete');
    expect(rows[0].model_counter).toBe(config.modelCounter);

    const counterCalls = calls.filter(c => systemText(c).includes('counting symbols on ONE electrical plan sheet'));
    expect(counterCalls.map(c => /SHEET: (.*)\n/.exec(userText(c))![1]).sort()).toEqual(['E-1 "ELECTRICAL SITE PLAN"', 'E-3 "LIGHTING PLAN"', 'PH0.1 "PHOTOMETRIC SITE PLAN"']);
    // Next round A3 — the photometric sheet is asked about site / exterior types only.
    const phCall = userText(counterCalls.find(c => userText(c).includes('SHEET: PH0.1'))!);
    expect(phCall).toContain('S1');
    expect(phCall).not.toContain('4 ft LED linear wraparound');

    const cr = rows[0].count_result as CountResult;
    expect(cr.ran).toBe(true);
    expect(cr.skippedSheets.map(s => [s.label.split(' ')[0], s.reason])).toEqual([
      ['E-0.1', 'schedule sheet — only plan sheets are counted'],
    ]);
    // S1 x2 + S2 x1 on BOTH E-1 and PH0.1: the site plan's count, never stacked.
    const s1 = cr.types.find(t => t.key === 'S1')!;
    expect(s1.sheets.find(x => x.label.startsWith('PH0.1'))).toMatchObject({ count: 2, used: false, ignoredReason: expect.stringContaining('never stacked') });
    const counts = Object.fromEntries(cr.types.map(t => [t.key, [t.count, t.status]]));
    expect(counts).toEqual({ A: [6, 'counted'], B: [3, 'counted'], D: [3, 'counted'], G: [0, 'zero'], S1: [2, 'counted'], S2: [1, 'counted'] });
    expect(cr.marks).toHaveLength(6 + 3 + 3 + 2 + 1 + 3 /* PH0.1's own marks, not used */);

    const a1 = JSON.parse(rows[0].agent1_output);
    const q = a1.quantities as Array<Record<string, unknown>>;
    expect(q.map(r => [r.item, r.qty])).toEqual([
      ['Type A — 4 ft LED linear wraparound', 6],
      ['Type B — 8 ft LED linear wraparound', 3],
      ['Type D — LED wall pack', 3],
      ['Type G — 6 in LED downlight', 0],
      ['Type S1 — pole (LED area light single head 25 ft pole)', 2],
      ['Type S1 — fixture heads (1 per pole)', 2],
      ['Type S2 — pole (LED area light twin head 25 ft pole)', 1],
      ['Type S2 — fixture heads (2 per pole)', 2],
    ]);
    expect(a1.countingSummary.pendingEstimatorReview).toEqual(['G (not found on any counted plan sheet)']);

    // Task 9 — the bid's GC, not the owner the drawings print.
    const a1Now = JSON.parse(rows[0].agent1_output);
    expect(a1Now.project.gcName).toBe('Summit General Contractors');
    expect(a1Now.project.gc_extracted).toBe('AutoZone Stores LLC');

    // Task 8 — the AutoZone rule (bid brand), with no drawing statement for the
    // power poles -> a scope question in the review list next to type G.
    expect(rows[0].account_terms.ruleName).toBe('AutoZone');
    // Fix round 1 / B3 — Agent 1's stacked "Site lights 4 (PH0.1)" row is
    // held for the estimator (one "not on this job" click), never silently dropped.
    expect(rows[0].review_items.map((i: { id: string }) => i.id)).toEqual(['count:G', 'unscheduled:SITE-LIGHTS-PH0-1', 'scope:power_poles:furnish', 'scope:power_poles:install']);
    expect(rows[0].review_status).toBe('needs_review');
    expect(rows[0].hygiene.gc).toEqual({ bidGc: 'Summit General Contractors', extracted: 'AutoZone Stores LLC', owner: '', mismatch: true });

    // Agent 2 saw the counted rows, not Agent 1's zeros / 8 wall packs / stacked site lights.
    const a2 = calls.find(c => systemText(c).includes('Senior Electrical Estimator'))!;
    const a2Text = userText(a2);
    expect(a2Text).toContain('"item":"Type A — 4 ft LED linear wraparound","qty":6');
    expect(a2Text).not.toContain('Site lights');
    expect(a2Text).not.toContain('"qty":8');
    // ...and the ACCOUNT TERMS block, not the old hard-coded supplier.
    expect(a2Text).toContain('--- ACCOUNT TERMS (AUTHORITATIVE');
    expect(a2Text).toContain('Lighting fixtures: furnished by the Owner through the Graybar national account; installed by APT.');
    expect(a2Text).toContain('Power poles: NOT YET DECIDED');
    expect(systemText(a2)).not.toContain('Southern Lighting Source');
  }, 120_000);

  it('live shape: ONE upload Buffer that owns its ArrayBuffer goes through prep, pdf.js geometry and the counter renderer (AutoZone detached-buffer regression)', async (ctx) => {
    if (!ok || !have) return ctx.skip();
    const bidId = await makeBid();
    const { client } = fakeAnthropic(responder());
    // A multi-MB upload never comes from Node's small-Buffer pool: it spans its
    // whole ArrayBuffer, which pdf.js would transfer (detach) if handed a view.
    const shared = Buffer.alloc(PDF.length);
    PDF.copy(shared);
    const file = { originalname: 'AZ 10077 set.pdf', buffer: shared, mimetype: 'application/pdf', size: shared.length } as Express.Multer.File;
    await runPipeline(bidId, [file], client, await loadAIConfig());
    const { rows } = await pool.query('SELECT status, count_result FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(rows[0].status).toBe('complete');
    const cr = rows[0].count_result as CountResult;
    expect(cr.sheets.map(s => [s.label.split(' ')[0], s.status, s.error ?? null])).toEqual([
      ['E-3', 'counted', null],
      ['E-1', 'counted', null],
      ['PH0.1', 'counted', null],
    ]);
    expect(Object.fromEntries(cr.types.map(t => [t.key, t.count]))).toMatchObject({ A: 6, B: 3, D: 3, S1: 2, S2: 1 });
    expect(shared.byteLength).toBe(PDF.length); // still intact after the whole run
  }, 120_000);

  it('a truncated counter call fails the run with the counter\'s own message', async (ctx) => {
    if (!ok || !have) return ctx.skip();
    const bidId = await makeBid();
    const base = responder();
    const { client, calls } = fakeAnthropic((req) => systemText(req).includes('counting symbols on ONE')
      ? { text: '{"marks":[["A"', stop_reason: 'max_tokens' } : base(req));
    const config = await loadAIConfig();
    const file = { originalname: 'set.pdf', buffer: PDF, mimetype: 'application/pdf', size: PDF.length } as Express.Multer.File;
    await runPipeline(bidId, [file], client, config);
    const { rows } = await pool.query('SELECT status, agent1_output FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(rows[0].status).toBe('error');
    expect(rows[0].agent1_output).toMatch(/^Counter \(Agent 1C\) on (E-[13]|PH0\.1) "[A-Z ]+" ran out of room — raise its Max Tokens/);
    expect(calls.some(c => systemText(c).includes('Senior Electrical Estimator'))).toBe(false);
  }, 120_000);
});
