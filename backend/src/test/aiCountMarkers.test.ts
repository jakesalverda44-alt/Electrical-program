// Takeoff accuracy Task 6 — the counting stage's located symbols become
// SUGGESTED est_markups (source 'ai_count', "AI" badge), driven through the
// REAL runPipeline on the committed kissimmee-mini.pdf filed under the bid's
// Plans. Covers: positions land on the drawn symbols (PDF points, rotated +
// offset page), suggested markers never roll up, a re-run replaces only the
// previous run's unconfirmed suggestions (confirmed work is kept and not
// re-suggested), line assignment only on a unique match, the assign-ai route,
// and a client batch can never set `source`.
import { describe, it, expect, beforeAll } from 'vitest';
import { counterTileSpec } from '../ai/modelLimits';
import { DEFAULT_COUNTER_MODEL } from '../routes/preconstruction';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { fakeAnthropic, systemText, userText, type FakeRequest } from './fixtures/takeoff/fakeAnthropic';
import { perfectCounter } from './fixtures/takeoff/perfectCounter';
import { MINI_P2_SYMBOLS, MINI_P3_SYMBOLS } from './fixtures/takeoff/buildSymbolPdf';
import { runPipeline, loadAIConfig } from '../routes/preconstruction';
import { readPageGeometry, renderCountTiles, type RenderedCountPage } from '../ai/countRender';
import { isPdftoppmAvailable } from '../ai/documentPrep';
import { lineForType } from '../estimating/aiMarkers';
import type { CountTarget } from '../ai/countTargets';

const PDF = fs.readFileSync(path.join(__dirname, 'fixtures/takeoff/kissimmee-mini.pdf'));
let ok = false;
let have = false;
const rendered: Record<number, RenderedCountPage> = {};
beforeAll(async () => {
  ok = await dbAvailable();
  have = await isPdftoppmAvailable();
  if (!have) return;
  const geo = await readPageGeometry(PDF, [2, 3]);
  for (const p of [2, 3]) rendered[p] = await renderCountTiles(PDF, p, geo.get(p)!, counterTileSpec(DEFAULT_COUNTER_MODEL)) /* A5: the counter model's tiles */;
}, 120_000);

const CLASSIFIED = [
  { page: 1, sheetNo: 'E-0.1', title: 'FIXTURE SCHEDULE', discipline: 'electrical', cls: 'schedule' },
  { page: 2, sheetNo: 'E-3', title: 'LIGHTING PLAN', discipline: 'electrical', cls: 'plan' },
  { page: 3, sheetNo: 'E-1', title: 'ELECTRICAL SITE PLAN', discipline: 'electrical', cls: 'plan' },
  { page: 4, sheetNo: 'PH0.1', title: 'PHOTOMETRIC SITE PLAN', discipline: 'electrical', cls: 'plan' },
];
const AGENT1 = {
  project: { name: 'mini' }, service: {}, panels: [{ name: 'LP' }], equipment: [], quantities: [],
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
    if (sys.includes('Senior Electrical Estimator')) return { text: '{"takeoff":[]}' };
    return { text: '{"overallRisk":"LOW"}' };
  };
}

async function setup(): Promise<{ bidId: string; docId: string }> {
  const user = await makeUser('owner');
  const { rows } = await pool.query(
    `INSERT INTO bids (name, gc, loc, salesperson_id) VALUES ($1, 'Summit General Contractors', 'Kissimmee, FL', $2) RETURNING id`,
    [`AiMarkers ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]
  );
  const bidId = rows[0].id as string;
  await pool.query(`INSERT INTO takeoff_results (bid_id, status) VALUES ($1, 'running')`, [bidId]);
  const doc = await pool.query(
    `INSERT INTO documents (linked_id, name, category, file_type, file_data, file_size, uploaded_by)
     VALUES ($1, 'AZ set.pdf', 'plans', 'application/pdf', $2, $3, 'test') RETURNING id`,
    [bidId, PDF.toString('base64'), PDF.length]
  );
  return { bidId, docId: doc.rows[0].id as string };
}

async function run(bidId: string, docId: string, viaDocumentId: boolean) {
  const { client } = fakeAnthropic(responder());
  const file = { originalname: 'AZ set.pdf', buffer: PDF, mimetype: 'application/pdf', size: PDF.length, ...(viaDocumentId ? { documentId: docId } : {}) } as Express.Multer.File;
  await runPipeline(bidId, [file], client, await loadAIConfig());
}

async function liveMarkers(bidId: string) {
  const { rows } = await pool.query(
    `SELECT id, document_id, page_index, line_key, kind, points, status, label, source FROM est_markups
      WHERE bid_id = $1 AND deleted_at IS NULL ORDER BY page_index, label, (points->0->>'x')::numeric`, [bidId]);
  return rows;
}

describe('AI suggested markers from the counting stage', () => {
  it('writes one suggested ai_count marker per counted symbol, on the drawn symbol, never rolled up', async (ctx) => {
    if (!ok || !have) return ctx.skip();
    const { bidId, docId } = await setup();
    // Uploaded file (no documentId) -> matched to the plans document by name + size.
    await run(bidId, docId, false);
    const m = await liveMarkers(bidId);
    expect(m).toHaveLength(MINI_P2_SYMBOLS.length + MINI_P3_SYMBOLS.length);
    expect(new Set(m.map(r => `${r.status}|${r.source}|${r.kind}|${r.document_id}`))).toEqual(new Set([`suggested|ai_count|count|${docId}`]));
    // Page 2 (/Rotate 90, offset MediaBox, inset CropBox) -> page_index 1.
    for (const s of MINI_P2_SYMBOLS) {
      const hit = m.find(r => r.page_index === 1 && r.label === s.type && Math.hypot(r.points[0].x - s.x, r.points[0].y - s.y) < 2);
      expect(hit, `${s.type} at (${s.x},${s.y})`).toBeDefined();
    }
    for (const s of MINI_P3_SYMBOLS) {
      expect(m.some(r => r.page_index === 2 && r.label === s.type && Math.hypot(r.points[0].x - s.x, r.points[0].y - s.y) < 2)).toBe(true);
    }
    const { rows: cr } = await pool.query('SELECT count_result FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(cr[0].count_result.markers).toMatchObject({ written: 15, replacedSuggestions: 0, unassigned: 15 });

    const user = await makeUser('owner');
    await pool.query('UPDATE bids SET salesperson_id=$1 WHERE id=$2', [user.id, bidId]);

    // GET markups exposes source for the AI badge.
    const g = await request(app).get(`/api/estimating/${bidId}/markups`).set(auth(user.token)).expect(200);
    expect(g.body.markups.every((x: { source: string }) => x.source === 'ai_count')).toBe(true);
  }, 120_000);

  it('a re-run replaces only unconfirmed AI suggestions; a confirmed one is kept and not suggested again', async (ctx) => {
    if (!ok || !have) return ctx.skip();
    const { bidId, docId } = await setup();
    await run(bidId, docId, true);
    const first = await liveMarkers(bidId);
    const confirmedId = first.find(r => r.label === 'A')!.id;
    await pool.query(`UPDATE est_markups SET status='confirmed' WHERE id=$1`, [confirmedId]);

    await run(bidId, docId, true);
    const second = await liveMarkers(bidId);
    // Same total: 14 fresh suggestions + the 1 confirmed marker (not re-suggested on top of it).
    expect(second).toHaveLength(15);
    const kept = second.find(r => r.id === confirmedId)!;
    expect(kept).toMatchObject({ status: 'confirmed', source: 'ai_count' });
    expect(second.filter(r => r.status === 'suggested')).toHaveLength(14);
    expect(second.some(r => first.some(f => f.id === r.id && r.status === 'suggested'))).toBe(false);
    const { rows: cr } = await pool.query('SELECT count_result FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(cr[0].count_result.markers).toMatchObject({ written: 14, skippedAlreadyMarked: 1, replacedSuggestions: 14 });
  }, 120_000);

  it('assigns a line only when exactly one saved line matches; assign-ai fills unassigned ones later', async (ctx) => {
    if (!ok || !have) return ctx.skip();
    const { bidId, docId } = await setup();
    const user = await makeUser('owner');
    await pool.query('UPDATE bids SET salesperson_id=$1 WHERE id=$2', [user.id, bidId]);
    await run(bidId, docId, true);
    expect((await liveMarkers(bidId)).every(r => r.line_key === null)).toBe(true);

    // The estimate gets saved with one line for type A and TWO that both say type B.
    const ins = async (description: string, takeoffItem: string) => (await pool.query(
      `INSERT INTO est_bid_lines (bid_id, category, description, qty, unit, takeoff_key) VALUES ($1,'Interior Lighting',$2,1,'EA',$3) RETURNING line_key`,
      [bidId, description, `Interior Lighting||${takeoffItem}`])).rows[0].line_key as string;
    const lineA = await ins('Type A — 4 ft LED linear wraparound', 'Type A — 4 ft LED linear wraparound');
    await ins('Type B — 8 ft wrap (sales)', 'Type B — 8 ft wrap (sales)');
    await ins('Type B — 8 ft wrap (stock)', 'Type B — 8 ft wrap (stock)');

    const res = await request(app).post(`/api/estimating/${bidId}/markups/assign-ai`).set(auth(user.token)).expect(200);
    expect(res.body).toMatchObject({ assigned: 6, stillUnassigned: 9 });
    expect(res.body.updates).toHaveLength(6);
    expect(new Set(res.body.updates.map((u: { lineKey: string }) => u.lineKey))).toEqual(new Set([lineA]));
    const m = await liveMarkers(bidId);
    expect(m.filter(r => r.label === 'A').every(r => r.line_key === lineA)).toBe(true);
    expect(m.filter(r => r.label === 'B').every(r => r.line_key === null)).toBe(true);

    // Six AI markers now sit on line A — still suggested, so they do NOT roll up.
    const roll = await request(app).get(`/api/estimating/${bidId}/markups/rollup`).set(auth(user.token)).expect(200);
    const rowA = roll.body.rollup.find((l: { lineKey?: string; line_key?: string }) => (l.lineKey ?? l.line_key) === lineA);
    expect(rowA).toBeDefined();
    expect(rowA.markedQty ?? null).toBeNull();

    // Confirming them (the Plans view's Confirm all) makes them count.
    await pool.query(`UPDATE est_markups SET status='confirmed' WHERE bid_id=$1 AND line_key=$2`, [bidId, lineA]);
    const roll2 = await request(app).get(`/api/estimating/${bidId}/markups/rollup`).set(auth(user.token)).expect(200);
    const rowA2 = roll2.body.rollup.find((l: { lineKey?: string; line_key?: string }) => (l.lineKey ?? l.line_key) === lineA);
    expect(rowA2.markedQty).toBe(6);
  }, 120_000);

  it('a client batch cannot mint an ai_count marker', async (ctx) => {
    if (!ok || !have) return ctx.skip();
    const { bidId, docId } = await setup();
    const user = await makeUser('owner');
    await pool.query('UPDATE bids SET salesperson_id=$1 WHERE id=$2', [user.id, bidId]);
    const id = '00000000-0000-4000-8000-' + Date.now().toString(16).padStart(12, '0').slice(-12);
    const b = await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(user.token))
      .send({ creates: [{ id, document_id: docId, page_index: 0, kind: 'count', points: [{ x: 10, y: 10 }], status: 'suggested', label: 'A', source: 'ai_count' }], updates: [], deletes: [] })
      .expect(200);
    expect(b.body.created).toHaveLength(1);
    expect(b.body.created[0].source).toBeNull();
    const { rows } = await pool.query('SELECT source FROM est_markups WHERE id=$1', [id]);
    expect(rows[0].source).toBeNull();
  });
});

describe('lineForType (pure)', () => {
  const t: CountTarget = { type: 'A', key: 'A', description: '4 ft LED linear wraparound', symbolHint: '', wattage: 32, category: 'interior_lighting', source: 'fixture_schedule', sourceSheet: '', headsPerPole: null, emergency: false };
  const line = (line_key: string, description: string, excluded = false) => ({ line_key, description, takeoff_key: `Interior Lighting||${description}`, excluded });
  it('unique tag match -> that line; none or ambiguous -> null; excluded lines ignored', () => {
    expect(lineForType(t, [line('k1', 'Type A — wraparound'), line('k2', 'Type B — wrap')])).toBe('k1');
    expect(lineForType(t, [line('k1', 'Type A — sales'), line('k2', 'Type A — stock')])).toBeNull();
    expect(lineForType(t, [line('k1', 'Troffer')])).toBeNull();
    expect(lineForType(t, [line('k1', 'Type A — sales', true), line('k2', 'Type A — stock')])).toBe('k2');
  });
});
