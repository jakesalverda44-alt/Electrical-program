// Next round A4 — the post-Agent-1 safety net and the supplement pass, on
// real multi-page PDFs (>4 KB, Buffers that own their ArrayBuffer) through
// the real pipeline, real pdftoppm counting renders and the real routes.
// No network: the SDK is mocked; every agent answers from the request.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

type Req = Record<string, unknown>;
const sys = (req: Req) => (Array.isArray(req.system) ? (req.system as Array<{ text?: string }>).map(b => b.text ?? '').join('\n') : String(req.system ?? ''));
const userText = (req: Req) => {
  const c = (req.messages as Array<{ content: unknown }>)[0]?.content;
  return typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n') : '';
};

// ── the drawings ────────────────────────────────────────────────────────────
const W = 1728; const H = 1296;
const tb = (no: string, title: string) => [{ x: W * 0.92, y: 120, size: 16, text: no }, { x: W * 0.92, y: 90, size: 8, text: title }];
const filler = Array.from({ length: 30 }, (_, i) => ({ x: 72, y: 1200 - i * 14, size: 8, text: `GENERAL NOTE ${i + 1}: ALL WORK PER NEC AND THE CONTRACT DOCUMENTS; FIELD VERIFY ALL CONDITIONS.` }));

const CLASS: Record<string, { sheetNo: string; title: string; cls: string }> = {
  'E-0.1': { sheetNo: 'E-0.1', title: 'FIXTURE SCHEDULE', cls: 'schedule' },
  'E-3': { sheetNo: 'E-3', title: 'LIGHTING PLAN', cls: 'plan' },
  'E-9': { sheetNo: 'E-9', title: 'LEVEL 2 LIGHTING PLAN', cls: 'plan' },
};

// ── what each agent answers ─────────────────────────────────────────────────
const state = { agent1Supplement: 'ok' as 'ok' | 'garbage', calls: [] as Req[] };
const AGENT1_MAIN = {
  project: { name: 'Supp', address: '', gcName: 'GC', gcContact: '', gcEmail: '', drawingDate: '', sheets: ['E-0.1', 'E-3'], projectType: 'retail', sqFt: 0 },
  service: { voltage: '', mainAmps: 0, phase: 3, utilityCompany: '', transformerKVA: '', confidence: 'VERIFIED' },
  panels: [{ name: 'LP', amps: 225, voltage: '208/120', phase: 3, circuits: 42, location: '', fedFrom: '', nemaRating: '', confidence: 'VERIFIED' }],
  equipment: [], quantities: [], allowances: [], ecfeciItems: [], flags: [], scopeNotes: [],
  // Agent 1 reads "SEE E-9 FOR THE MEZZANINE" — a sheet not in the upload.
  missingSheets: ['E-9 (see note 5 on E-3)'],
  fixtureSchedule: [
    { type: 'A', description: '4 ft LED strip', wattage: 32, location: 'interior', headsPerPole: 0, emergency: false, symbol: 'square', sourceSheet: 'E-0.1' },
    { type: 'G', description: '6 in downlight', wattage: 15, location: 'interior', headsPerPole: 0, emergency: false, symbol: 'circle', sourceSheet: 'E-0.1' },
  ],
  symbolLegend: [], panelCircuits: [], furnishStatements: [],
};
const AGENT1_SUPP = {
  project: { name: '', address: '', gcName: '', gcContact: '', gcEmail: '', drawingDate: '', sheets: ['E-9'], projectType: '', sqFt: 0 },
  service: {}, panels: [], equipment: [], quantities: [], allowances: [], ecfeciItems: [], flags: [], scopeNotes: [], missingSheets: [],
  // E-9 carries a type the run had not seen.
  fixtureSchedule: [{ type: 'Z', description: 'LED high bay', wattage: 150, location: 'interior', headsPerPole: 0, emergency: false, symbol: 'hex', sourceSheet: 'E-9' }],
  symbolLegend: [], panelCircuits: [], furnishStatements: [],
};

function reply(req: Req): string {
  const s = sys(req);
  const u = userText(req);
  if (s.includes('construction document sheet classifier')) {
    // The classifier reads title blocks; the fake knows each file by its pages.
    const pages = [...u.matchAll(/Page (\d+) \(absolute/g)].map(m => Number(m[1]));
    const names = u.includes('supp') ? ['E-9'] : ['E-0.1', 'E-3'];
    return JSON.stringify(pages.map((p, i) => ({ page: p, ...CLASS[names[i]], discipline: 'electrical' })));
  }
  if (s.includes('Senior Electrical Drawing Analyzer')) {
    if (u.includes('--- Sheet: E-9')) return state.agent1Supplement === 'ok' ? JSON.stringify(AGENT1_SUPP) : 'not json at all';
    return JSON.stringify(AGENT1_MAIN);
  }
  if (s.includes('counting symbols on ONE electrical plan sheet')) {
    // A on E-3 x3; on E-9: A x2 and Z x4 (Z asked of E-3 too: 1 there).
    const onE9 = u.includes('SHEET: E-9');
    const asksA = /\bA\b.*4 ft LED strip/.test(u);
    const marks: unknown[] = [];
    if (asksA) for (let i = 0; i < (onE9 ? 2 : 3); i++) marks.push(['A', 'R1C1', 0.1 + i * 0.1, 0.3]);
    if (u.includes('LED high bay')) for (let i = 0; i < (onE9 ? 4 : 1); i++) marks.push(['Z', 'R1C1', 0.15 + i * 0.1, 0.5]);
    return JSON.stringify({ marks, unreadable: [], notes: [] });
  }
  if (s.includes('Senior Electrical Estimator')) return JSON.stringify({ scopeOfWork: {}, takeoff: [], rfis: [], manualCountRequired: [] });
  if (s.includes('Chief Electrical Estimator')) return JSON.stringify({ overallRisk: 'LOW', readyToSubmit: true });
  return '{}';
}

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      stream: (req: Req) => {
        state.calls.push(req);
        return { finalMessage: async () => ({ id: 'm', type: 'message', role: 'assistant', model: String(req.model), content: [{ type: 'text', text: reply(req), citations: null }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } }) };
      },
      create: async () => { throw new Error('not used'); },
    };
  },
}));
vi.mock('../services/googleDrive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/googleDrive')>();
  return { ...actual, uploadFile: async () => null, ensureSubfolder: async () => null };
});

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { buildSymbolPdf } from './fixtures/takeoff/buildSymbolPdf';
import { ownedBuffer } from './fixtures/takeoff/kissimmeeSet';
import { isPdftoppmAvailable } from '../ai/documentPrep';
import { runPipeline, loadAIConfig } from '../routes/preconstruction';
import { sha256 } from '../services/sheetCheck';
import Anthropic from '@anthropic-ai/sdk';
import type { CountResult } from '../ai/countingStage';
import type { ReviewItem } from '../ai/reviewItems';

const MAIN = buildSymbolPdf([
  { mediaBox: [0, 0, W, H], symbols: [], texts: [...filler, ...tb('E-0.1', 'FIXTURE SCHEDULE')] },
  { mediaBox: [0, 0, W, H], symbols: [{ type: 'A', x: 200, y: 900 }], texts: [...filler, { x: 72, y: 700, size: 9, text: '5. SEE E-9 FOR THE MEZZANINE.' }, ...tb('E-3', 'LIGHTING PLAN')] },
]);
const SUPP = buildSymbolPdf([
  { mediaBox: [0, 0, W, H], symbols: [{ type: 'Z', x: 300, y: 900 }], texts: [...filler, ...tb('E-9', 'LEVEL 2 LIGHTING PLAN')] },
]);

let ok = false; let have = false; let user: TestUser;
beforeAll(async () => {
  ok = await dbAvailable();
  have = await isPdftoppmAvailable();
  process.env.ANTHROPIC_API_KEY = 'test-dummy-not-a-key';
  if (!ok) return;
  user = await makeUser('owner');
  await pool.query('DELETE FROM sheet_page_cache WHERE content_sha256 = ANY($1)', [[sha256(MAIN), sha256(SUPP)]]);
}, 30_000);

async function analysedBid(): Promise<string> {
  const { rows } = await pool.query(`INSERT INTO bids (name, gc, salesperson_id) VALUES ($1, 'GC', $2) RETURNING id`,
    [`Supp ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]);
  const bidId = rows[0].id as string;
  const { rows: d } = await pool.query(
    `INSERT INTO documents (linked_id, name, category, file_type, file_data, file_size, uploaded_by, content_sha256)
     VALUES ($1, 'main set.pdf', 'plans', 'application/pdf', $2, $3, $4, $5) RETURNING id`,
    [bidId, MAIN.toString('base64'), MAIN.length, user.id, sha256(MAIN)]);
  await pool.query(`INSERT INTO takeoff_results (bid_id, status, run_id, input_document_ids) VALUES ($1, 'running', gen_random_uuid(), $2)`, [bidId, [d[0].id]]);
  const file = { originalname: 'main set.pdf', buffer: ownedBuffer(MAIN), mimetype: 'application/pdf', size: MAIN.length } as Express.Multer.File;
  await runPipeline(bidId, [file], new Anthropic({ apiKey: 'x' }), await loadAIConfig());
  return bidId;
}

async function waitDone(bidId: string) {
  const t = Date.now();
  for (;;) {
    const { rows } = await pool.query('SELECT status, supplement FROM takeoff_results WHERE bid_id=$1', [bidId]);
    if (rows[0].status !== 'running' && rows[0].supplement?.status !== 'running') return rows[0];
    if (Date.now() - t > 60_000) throw new Error('supplement did not finish');
    await new Promise(r => setTimeout(r, 100));
  }
}

const tr = async (bidId: string) => (await pool.query('SELECT * FROM takeoff_results WHERE bid_id=$1', [bidId])).rows[0];

describe('A4 — referenced sheet not in analysis -> supplement pass', () => {
  it('the run raises "Referenced sheet E-9 not in analysis"; uploading it counts only what it can change, same run', async () => {
    if (!ok || !have) return;
    const bidId = await analysedBid();
    let row = await tr(bidId);
    expect(row.status).toBe('complete');
    const items = row.review_items as ReviewItem[];
    expect(items.map(i => i.id)).toEqual(expect.arrayContaining(['count:G', 'refsheet:E9']));
    expect(items.find(i => i.id === 'refsheet:E9')!.title).toBe('Referenced sheet E-9 not in analysis');
    expect((row.count_result as CountResult).types.find(t => t.key === 'A')!.count).toBe(3);
    const runId = row.run_id;

    // The estimator resolved G before the sheet arrived; that answer survives.
    await pool.query(`UPDATE takeoff_results SET review_items=$2 WHERE bid_id=$1`,
      [bidId, JSON.stringify(items.map(i => i.id === 'count:G' ? { ...i, resolution: { action: 'not_on_job', reason: 'No downlights in this scope', by: 'J', at: 'now' } } : i))]);

    state.calls = [];
    // The workspace files every upload in Project Files (as it does live).
    await pool.query(
      `INSERT INTO documents (linked_id, name, category, file_type, file_data, file_size, uploaded_by, content_sha256)
       VALUES ($1, 'supp E-9.pdf', 'plans', 'application/pdf', $2, $3, $4, $5)`,
      [bidId, SUPP.toString('base64'), SUPP.length, user.id, sha256(SUPP)]);
    const res = await request(app).post(`/api/preconstruction/${bidId}/supplement`).set(auth(user.token))
      .attach('files', ownedBuffer(SUPP), 'supp E-9.pdf');
    expect(res.status).toBe(200);
    await waitDone(bidId);
    row = await tr(bidId);
    expect(row.status).toBe('complete');
    expect(row.run_id).toBe(runId); // merged into the SAME run
    expect(row.supplement).toMatchObject({ status: 'complete', files: ['supp E-9.pdf'] });

    // Agent 1 read only the new pages.
    const a1 = state.calls.filter(c => sys(c).includes('Senior Electrical Drawing Analyzer'));
    expect(a1).toHaveLength(1);
    expect(userText(a1[0])).toContain('E-9');
    expect(userText(a1[0])).not.toContain('--- Sheet: E-3');
    // Counter: E-9 for every type; E-3 again ONLY for the new type Z.
    const counts = state.calls.filter(c => sys(c).includes('counting symbols on ONE'));
    const e3 = counts.filter(c => userText(c).includes('SHEET: E-3'));
    expect(e3).toHaveLength(1);
    expect(userText(e3[0])).toContain('LED high bay');
    expect(userText(e3[0])).not.toContain('4 ft LED strip');
    expect(counts.filter(c => userText(c).includes('SHEET: E-9'))).toHaveLength(1);

    const cr = row.count_result as CountResult;
    const byKey = Object.fromEntries(cr.types.map(t => [t.key, t.count]));
    expect(byKey).toMatchObject({ A: 3 + 2, Z: 1 + 4 }); // two levels, summed
    const now = row.review_items as ReviewItem[];
    expect(now.find(i => i.id === 'refsheet:E9')).toBeUndefined();
    expect(now.find(i => i.id === 'count:G')!.resolution).toMatchObject({ action: 'not_on_job', carriedOver: true });
    // The run's inventory now has both files' pages; a re-run pre-ticks the new document too.
    expect((row.prep_inventory as Array<{ sheetNo: string }>).map(p => p.sheetNo)).toEqual(expect.arrayContaining(['E-0.1', 'E-3', 'E-9']));
    expect((row.input_document_ids as string[]).length).toBe(2);
  }, 120_000);

  it('a failed supplement puts the run back exactly as it was', async () => {
    if (!ok || !have) return;
    const bidId = await analysedBid();
    const before = await tr(bidId);
    state.agent1Supplement = 'garbage';
    try {
      const res = await request(app).post(`/api/preconstruction/${bidId}/supplement`).set(auth(user.token)).attach('files', ownedBuffer(SUPP), 'supp E-9.pdf');
      expect(res.status).toBe(200);
      const after = await waitDone(bidId);
      expect(after.supplement).toMatchObject({ status: 'error', error: expect.stringContaining('could not be analysed') });
    } finally {
      state.agent1Supplement = 'ok';
    }
    const row = await tr(bidId);
    expect(row.status).toBe('complete');
    expect(row.agent1_output).toBe(before.agent1_output);
    expect(row.count_result).toEqual(before.count_result);
    expect(row.review_items).toEqual(before.review_items);
    expect(row.review_status).toBe(before.review_status);
  }, 120_000);

  it('409 while a run is going; 400 for a file already in the run', async () => {
    if (!ok || !have) return;
    const bidId = await analysedBid();
    const same = await request(app).post(`/api/preconstruction/${bidId}/supplement`).set(auth(user.token)).attach('files', ownedBuffer(MAIN), 'main again.pdf');
    expect(same.status).toBe(400);
    expect((await tr(bidId)).status).toBe('complete');
    await pool.query(`UPDATE takeoff_results SET status='counting' WHERE bid_id=$1`, [bidId]);
    const busy = await request(app).post(`/api/preconstruction/${bidId}/supplement`).set(auth(user.token)).attach('files', ownedBuffer(SUPP), 'supp.pdf');
    expect(busy.status).toBe(409);
  }, 120_000);
});
