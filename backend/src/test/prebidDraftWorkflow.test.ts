// Takeoff accuracy Task 12 — Jake's order: analysis -> pre-bid package for
// Chris (no price) -> Chris prices it -> Agent 4 proposal for the GC from the
// SAME draft with the price inserted.
//
// Real runPipeline on the committed kissimmee-mini.pdf with a fake client (no
// network): the review comes back clear, so the pre-bid draft is composed
// right after Agent 3 with NO Agent 4 proposal run. Then the package is built
// from it (no price anywhere), and run-agent4 reuses it (no model call) when
// the scope inputs are unchanged and there are no new notes. The Anthropic
// SDK and Google Drive are mocked for this file: nothing leaves the machine.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import ExcelJS from 'exceljs';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class { constructor() { throw new Error('the real Anthropic client must not be constructed in this test'); } },
}));
vi.mock('../services/googleDrive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/googleDrive')>();
  return { ...actual, uploadFile: async () => null, ensureSubfolder: async () => null };
});

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { fakeAnthropic, systemText, userText, type FakeRequest } from './fixtures/takeoff/fakeAnthropic';
import { perfectCounter } from './fixtures/takeoff/perfectCounter';
import { MINI_P2_SYMBOLS, MINI_P3_SYMBOLS } from './fixtures/takeoff/buildSymbolPdf';
import { runPipeline, loadAIConfig } from '../routes/preconstruction';
import { readPageGeometry, renderCountTiles, type RenderedCountPage } from '../ai/countRender';
import { isPdftoppmAvailable } from '../ai/documentPrep';
import { extractDocxText } from '../utils/bidDocParse';

const PDF = fs.readFileSync(path.join(__dirname, 'fixtures/takeoff/kissimmee-mini.pdf'));
let ok = false;
let have = false;
const rendered: Record<number, RenderedCountPage> = {};
beforeAll(async () => {
  ok = await dbAvailable();
  have = await isPdftoppmAvailable();
  if (!have) return;
  const geo = await readPageGeometry(PDF, [2, 3]);
  for (const p of [2, 3]) rendered[p] = await renderCountTiles(PDF, p, geo.get(p)!);
}, 120_000);

const CLASSIFIED = [
  { page: 1, sheetNo: 'E-0.1', title: 'FIXTURE SCHEDULE', discipline: 'electrical', cls: 'schedule' },
  { page: 2, sheetNo: 'E-3', title: 'LIGHTING PLAN', discipline: 'electrical', cls: 'plan' },
  { page: 3, sheetNo: 'E-1', title: 'ELECTRICAL SITE PLAN', discipline: 'electrical', cls: 'plan' },
  { page: 4, sheetNo: 'PH0.1', title: 'PHOTOMETRIC SITE PLAN', discipline: 'electrical', cls: 'plan' },
];
const AGENT1 = {
  project: { name: 'Retail shell', gcName: 'Summit General Contractors', sheets: ['E-0.1', 'E-3', 'E-1', 'PH0.1'], sqFt: 0 },
  service: { voltage: '208Y/120', mainAmps: 400, phase: 3, confidence: 'VERIFIED' },
  panels: [{ name: 'LP', amps: 225, confidence: 'VERIFIED' }], equipment: [], quantities: [],
  allowances: [], ecfeciItems: [], flags: [], scopeNotes: [], missingSheets: [],
  fixtureSchedule: [
    { type: 'A', description: '4 ft LED linear wraparound', wattage: 32, location: 'interior' },
    { type: 'B', description: '8 ft LED linear wraparound', wattage: 64, location: 'interior' },
    { type: 'D', description: 'LED wall pack', wattage: 40, location: 'exterior_building' },
    { type: 'S1', description: 'LED area light single head', wattage: 150, location: 'site', headsPerPole: 1 },
    { type: 'S2', description: 'LED area light twin head', wattage: 300, location: 'site', headsPerPole: 2 },
  ],
  symbolLegend: [], panelCircuits: [], furnishStatements: [],
};
/** Agent 4 in DRAFT mode: sections + takeoff, no price. */
const DRAFT = {
  plan_date: 'February 7, 2025', sheets: ['E-1', 'E-3'],
  sections: [
    { title: 'A. Service & Distribution', bullets: ['Furnish and install the complete service entrance assembly (ECFECI), fed by the utility transformer.', 'Distribution gear (ECFECI): panel LP, with feeders and disconnects throughout.'] },
    { title: 'C. Lighting & Controls', bullets: ['Complete lighting package (ECFECI) — procured through the Southern Lighting Source national account (770-242-4000). EC to receive, inventory, and install all fixtures per schedule.', 'Controls and testing prior to final inspection.'] },
  ],
  exclusions: ['Utility company fees.'], allowances_bullets: [], fixture_types: ['A', 'B', 'D', 'S1', 'S2'], alternates: [], takeoff_notes: [],
  takeoff: [
    { name: 'Interior Lighting', items: [{ item: 'Type A', description: '4 ft LED linear wraparound', unit: 'EA', qty: 6, source: 'E-3', conf: 'APPROX' }] },
    { name: 'Service & Distribution', items: [{ item: 'Panel LP', description: '225A panelboard (ECFECI)', unit: 'EA', qty: 1, source: 'E-4', conf: 'FIRM' }] },
  ],
};

let agent4Calls = 0;
function responder() {
  const counter = perfectCounter({
    'E-3 "LIGHTING PLAN"': { rendered: rendered[2], symbols: MINI_P2_SYMBOLS },
    'E-1 "ELECTRICAL SITE PLAN"': { rendered: rendered[3], symbols: MINI_P3_SYMBOLS },
  });
  return (req: FakeRequest) => {
    const sys = systemText(req);
    if (sys.includes('construction document sheet classifier')) {
      const pages = [...userText(req).matchAll(/Page (\d+) \(absolute/g)].map(m => Number(m[1]));
      return { text: JSON.stringify(CLASSIFIED.filter(c => pages.includes(c.page))) };
    }
    if (sys.includes('Senior Electrical Drawing Analyzer')) return { text: JSON.stringify(AGENT1) };
    if (sys.includes('counting symbols on ONE')) return counter(req);
    if (sys.includes('Senior Electrical Estimator')) return { text: '{"takeoff":[],"scopeOfWork":{}}' };
    if (sys.includes('Chief Electrical Estimator')) return { text: '{"overallRisk":"LOW"}' };
    if (sys.includes('Proposal Formatter')) {
      agent4Calls++;
      const msg = userText(req);
      // Draft mode: no price line, an explicit no-price instruction.
      if (!msg.startsWith('PRE-BID DRAFT REQUEST') || /Total Bid Price/.test(msg)) throw new Error('expected a DRAFT request with no price');
      return { text: JSON.stringify(DRAFT) };
    }
    throw new Error(`unexpected agent: ${sys.slice(0, 40)}`);
  };
}

async function analyzedBid(): Promise<{ user: TestUser; bidId: string }> {
  const user = await makeUser('owner');
  const { rows } = await pool.query(
    `INSERT INTO bids (name, gc, loc, salesperson_id) VALUES ($1, 'Summit General Contractors', '100 Main St, Ocala, FL 34470', $2) RETURNING id`,
    [`Draft ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]
  );
  const bidId = rows[0].id as string;
  await pool.query(`INSERT INTO takeoff_results (bid_id, status) VALUES ($1,'running')`, [bidId]);
  agent4Calls = 0;
  const { client } = fakeAnthropic(responder());
  await runPipeline(bidId, [{ originalname: 'set.pdf', buffer: PDF, mimetype: 'application/pdf', size: PDF.length } as Express.Multer.File], client, await loadAIConfig());
  return { user, bidId };
}

async function xlsxText(b64: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(b64, 'base64') as unknown as ArrayBuffer);
  const out: string[] = [];
  wb.eachSheet(ws => ws.eachRow(r => r.eachCell(c => out.push(String(c.value ?? '')))));
  return out.join('\n');
}

describe('pre-bid draft workflow', () => {
  it('the draft is composed right after the analysis (review clear) — no Agent 4 proposal run', async (ctx) => {
    if (!ok || !have) return ctx.skip();
    const { bidId } = await analyzedBid();
    const { rows } = await pool.query('SELECT status, review_status, draft_status, draft_output, agent4_output, draft_inputs_hash FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(rows[0]).toMatchObject({ status: 'complete', review_status: 'clear', draft_status: 'complete', agent4_output: null });
    expect(JSON.parse(rows[0].draft_output).sections[0].title).toBe('A. Service & Distribution');
    expect(rows[0].draft_inputs_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(agent4Calls).toBe(1);
  }, 120_000);

  it('the pre-bid package builds from the draft with no price anywhere', async (ctx) => {
    if (!ok || !have) return ctx.skip();
    const { user, bidId } = await analyzedBid();
    const r = await request(app).post(`/api/preconstruction/${bidId}/generate-prebid-package`).set(auth(user.token)).expect(200);
    const { rows } = await pool.query('SELECT id, category, file_data FROM documents WHERE id = ANY($1::uuid[])', [[r.body.scopeDocumentId, r.body.takeoffDocumentId]]);
    const scope = extractDocxText(Buffer.from(rows.find(d => d.category === 'prebid_scope').file_data, 'base64'));
    const takeoff = await xlsxText(rows.find(d => d.category === 'prebid_takeoff').file_data);
    for (const text of [scope, takeoff]) {
      expect(text).not.toMatch(/\$\s?\d/);
      expect(text).not.toMatch(/total\s+(bid\s+)?price|price summary/i);
    }
    expect(scope).toContain('A. Service & Distribution');
    expect(takeoff).toContain('4 ft LED linear wraparound');
  }, 120_000);

  it('the GC proposal reuses the same draft with the price inserted — no model call — when nothing changed', async (ctx) => {
    if (!ok || !have) return ctx.skip();
    const { user, bidId } = await analyzedBid();
    const r = await request(app).post(`/api/preconstruction/${bidId}/run-agent4`).set(auth(user.token)).send({ price: '79112.23' }).expect(200);
    expect(r.body).toEqual({ status: 'complete', reusedDraft: true });
    const { rows } = await pool.query('SELECT agent4_output, draft_output, agent4_price, agent4_source, agent4_status FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(rows[0].agent4_output).toBe(rows[0].draft_output);
    expect(rows[0]).toMatchObject({ agent4_source: 'draft', agent4_status: 'complete', agent4_price: '79112.23' });
    const p = await request(app).get(`/api/preconstruction/${bidId}/proposal-preview`).set(auth(user.token)).expect(200);
    expect(p.body.total_price).toBe('$79,112.23');
    expect(p.body.sections.map((s: { title: string }) => s.title)).toEqual(['A. Service & Distribution', 'C. Lighting & Controls']);
    expect(agent4Calls).toBe(1); // only the draft, during the analysis
  }, 120_000);

  it('new notes or a changed scope list re-compose (here: no key in the test DB -> 503, the draft is NOT silently reused)', async (ctx) => {
    if (!ok || !have) return ctx.skip();
    const { user, bidId } = await analyzedBid();
    const notes = await request(app).post(`/api/preconstruction/${bidId}/run-agent4`).set(auth(user.token)).send({ price: '79112.23', internalNotes: 'Chris: exclude the sign power' });
    expect(notes.body.reusedDraft).toBeUndefined();
    await request(app).post(`/api/preconstruction/${bidId}/scope-items`).set(auth(user.token)).send({ kind: 'exclude', text: 'Sign power' }).expect(200);
    const changed = await request(app).post(`/api/preconstruction/${bidId}/run-agent4`).set(auth(user.token)).send({ price: '79112.23' });
    expect(changed.body.reusedDraft).toBeUndefined();
  }, 120_000);

  it('a bid from before drafts (agent4_output only) still builds its pre-bid package', async (ctx) => {
    if (!ok) return ctx.skip();
    const user = await makeUser('owner');
    const { rows } = await pool.query(`INSERT INTO bids (name, gc, loc, salesperson_id) VALUES ($1,'GC','Ocala, FL',$2) RETURNING id`, [`Legacy ${Date.now()}`, user.id]);
    await pool.query(`INSERT INTO takeoff_results (bid_id, status, agent4_output, agent4_price) VALUES ($1,'complete',$2,100000)`, [rows[0].id, JSON.stringify(DRAFT)]);
    const r = await request(app).post(`/api/preconstruction/${rows[0].id}/generate-prebid-package`).set(auth(user.token)).expect(200);
    expect(r.body.scopeDocumentId).toBeTruthy();
  });
});
