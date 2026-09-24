// Next round A1–A3 — the sheet check, end to end on a real multi-page PDF
// with text layers (pdftotext reads E-7's notes), through the real routes
// and the real analysis prep. No network: the SDK is mocked (the classifier
// answers from KISSIMMEE_SET_CLASSIFIED, Haiku reads the one vague note).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type Anthropic from '@anthropic-ai/sdk';

type Req = Record<string, unknown>;
const sdk: { calls: Req[] } = { calls: [] };
const sys = (req: Req) => (Array.isArray(req.system) ? (req.system as Array<{ text?: string }>).map(b => b.text ?? '').join('\n') : String(req.system ?? ''));
const userText = (req: Req) => {
  const c = (req.messages as Array<{ content: unknown }>)[0]?.content;
  return typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n') : '';
};

function reply(req: Req): string {
  const s = sys(req);
  if (s.includes('construction document sheet classifier')) {
    const pages = [...userText(req).matchAll(/Page (\d+) \(absolute/g)].map(m => Number(m[1]));
    return JSON.stringify(KISSIMMEE_SET_CLASSIFIED.filter(c => pages.includes(c.page)));
  }
  if (s.includes('list the other drawings each one points to')) {
    // The only vague note: "SEE OWNER-PROVIDED VENDOR DRAWINGS" -> nothing.
    return '[]';
  }
  if (s.includes('general-notes region of a scanned electrical drawing sheet')) {
    return '[{"kind":"sheet","id":"M-1","context":"SEE M-1 FOR RTU DATA"},{"kind":"sheet","id":"NEC 210.8"}]';
  }
  if (s.includes('Senior Electrical Drawing Analyzer')) return '{}';
  return '{}';
}

function fakeStream(req: Req) {
  sdk.calls.push(req);
  return {
    finalMessage: async () => ({
      id: 'msg_fake', type: 'message', role: 'assistant', model: String(req.model),
      content: [{ type: 'text', text: reply(req), citations: null }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  };
}

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: (req: Req) => fakeStream(req), create: async () => { throw new Error('not used'); } };
  },
}));
vi.mock('../services/googleDrive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/googleDrive')>();
  return { ...actual, uploadFile: async () => null, ensureSubfolder: async () => null };
});

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { KISSIMMEE_SET_CLASSIFIED, buildKissimmeeSetPdf, ownedBuffer } from './fixtures/takeoff/kissimmeeSet';
import { isPdftoppmAvailable } from '../ai/documentPrep';
import { planSheetsForRun, sha256, skippedClarifications, loadSheetCheck } from '../services/sheetCheck';
import { buildSymbolPdf } from './fixtures/takeoff/buildSymbolPdf';
import { runPipeline, loadAIConfig } from '../routes/preconstruction';

let ok = false;
let have = false;
let user: TestUser;
const PDF = buildKissimmeeSetPdf();

beforeAll(async () => {
  ok = await dbAvailable();
  have = await isPdftoppmAvailable();
  process.env.ANTHROPIC_API_KEY = 'test-dummy-not-a-key';
  if (ok) user = await makeUser('owner');
}, 30_000);

beforeEach(async () => {
  sdk.calls = [];
  // Each test starts cold: the classification cache is keyed by content.
  if (ok) await pool.query('DELETE FROM sheet_page_cache WHERE content_sha256=$1', [sha256(PDF)]);
});

async function makeBid(): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO bids (name, gc, salesperson_id, brand) VALUES ($1, 'Summit General Contractors', $2, 'AutoZone') RETURNING id`,
    [`SheetCheck ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]);
  return rows[0].id as string;
}

async function runCheck(bidId: string) {
  const res = await request(app).post(`/api/preconstruction/${bidId}/sheet-check/run`).set(auth(user.token))
    .attach('files', ownedBuffer(PDF), 'AZ 10077 FULL SET.pdf');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('running');
  const t = Date.now();
  for (;;) {
    const g = await request(app).get(`/api/preconstruction/${bidId}/sheet-check`).set(auth(user.token));
    if (g.body.status !== 'running') return g.body;
    if (Date.now() - t > 20_000) throw new Error('sheet check did not finish');
    await new Promise(r => setTimeout(r, 50));
  }
}

const bySheet = (body: { pages: Array<{ sheetNo: string }> }, no: string) => body.pages.find(p => p.sheetNo === no) as Record<string, unknown>;

describe('sheet check (Documents step)', () => {
  it('classifies, follows E-7\'s references, lists what is missing', async () => {
    if (!ok || !have) return;
    const bidId = await makeBid();
    const body = await runCheck(bidId);
    expect(body.status).toBe('complete');
    expect(body.pages).toHaveLength(8);
    // Electrical sheets are analysed; the cover sheet too (as before).
    for (const no of ['G-0.1', 'E-0.1', 'E-1', 'E-3', 'E-7']) expect(bySheet(body, no).role).toBe('analysis');
    // PH0.1 was classified 'civil' — referenced by E-7 note 3, so it goes as a reference page.
    expect(bySheet(body, 'PH0.1')).toMatchObject({ role: 'reference', discipline: 'civil' });
    expect(bySheet(body, 'PH0.1').referencedBy).toContain('E-7 note 3');
    // "SEE CIVIL" -> the utility plan; the floor plan is not referenced by any E-sheet note... except
    // nothing points at A-1.1, so it stays out.
    expect(bySheet(body, 'C-3.1').role).toBe('reference');
    expect(bySheet(body, 'A-1.1').role).toBe('excluded');
    // M-1 is referenced and not in the upload.
    expect(body.missing.map((m: { id: string }) => m.id)).toEqual(expect.arrayContaining(['sheet:M1']));
    const m1 = body.missing.find((m: { id: string }) => m.id === 'sheet:M1');
    expect(m1.referencedBy[0]).toMatchObject({ note: 'note 4' });
    // "FIXTURE LOCATIONS PER REFLECTED CEILING PLAN" (E-3) — no RCP in the upload.
    expect(body.missing.map((m: { id: string }) => m.id)).toContain('discipline:reflected_ceiling');
    expect(body.unskippedMissing).toBe(body.missing.length);
    // One classifier call (8 pages, one batch) and one Haiku call for the vague note.
    expect(sdk.calls.filter(c => sys(c).includes('sheet classifier'))).toHaveLength(1);
    expect(sdk.calls.filter(c => sys(c).includes('list the other drawings'))).toHaveLength(1);
    expect(userText(sdk.calls.find(c => sys(c).includes('list the other drawings'))!)).toContain('OWNER-PROVIDED VENDOR DRAWINGS');
  });

  it('an unchanged file is never classified twice (cache by content hash)', async () => {
    if (!ok || !have) return;
    const bidId = await makeBid();
    await runCheck(bidId);
    const first = sdk.calls.length;
    const again = await runCheck(bidId);
    expect(again.status).toBe('complete');
    expect(sdk.calls.length).toBe(first); // no classifier, no Haiku the second time
    // …and neither does the analysis prep.
    const { plans } = await planSheetsForRun(bidId, [{ originalname: 'AZ 10077 FULL SET.pdf', buffer: ownedBuffer(PDF) }],
      new (await import('@anthropic-ai/sdk')).default({ apiKey: 'x' }) as unknown as Anthropic, 'claude-haiku-4-5-20251001');
    expect(sdk.calls.length).toBe(first);
    const plan = plans.get('AZ 10077 FULL SET.pdf')!;
    expect(plan.roles.get(7)).toMatchObject({ role: 'reference' });
    expect(plan.roles.get(2)).toMatchObject({ role: 'excluded' });
    expect(plan.pageTexts[5]).toContain('SEE M-1');
  });

  it('force-in / leave-out (reason required), skip / un-skip, and skip-all for "Run without N sheets"', async () => {
    if (!ok || !have) return;
    const bidId = await makeBid();
    const body = await runCheck(bidId);
    const a11 = bySheet(body, 'A-1.1');
    const put = (b: Record<string, unknown>) => request(app).put(`/api/preconstruction/${bidId}/sheet-check`).set(auth(user.token)).send(b);

    expect((await put({ action: 'include', pageKey: a11.key, reason: 'short' })).status).toBe(400);
    let r = await put({ action: 'include', pageKey: a11.key, reason: 'Floor plan shows the receptacle layout' });
    expect(r.status).toBe(200);
    expect(bySheet(r.body, 'A-1.1')).toMatchObject({ role: 'analysis' });
    expect(String(bySheet(r.body, 'A-1.1').reason)).toContain('Floor plan shows');
    // A forced-in page's notes are read: A-1.1 says "SEE E-3" (present, already analysed).
    r = await put({ action: 'exclude', pageKey: bySheet(r.body, 'PH0.1').key, reason: 'Duplicate of the site plan, not needed' });
    expect(bySheet(r.body, 'PH0.1').role).toBe('excluded');
    r = await put({ action: 'clear', pageKey: bySheet(r.body, 'PH0.1').key });
    expect(bySheet(r.body, 'PH0.1').role).toBe('reference');

    expect((await put({ action: 'skip', refId: 'sheet:M1', reason: 'meh' })).status).toBe(400);
    r = await put({ action: 'skip', refId: 'sheet:M1', reason: 'Mechanical set not issued for bid' });
    expect(r.body.missing.find((m: { id: string }) => m.id === 'sheet:M1').skip).toMatchObject({ reason: 'Mechanical set not issued for bid' });
    expect(r.body.unskippedMissing).toBe(r.body.missing.length - 1);
    r = await put({ action: 'unskip', refId: 'sheet:M1' });
    expect(r.body.unskippedMissing).toBe(r.body.missing.length);
    r = await put({ action: 'skip_all_missing' });
    expect(r.body.unskippedMissing).toBe(0);
    // Skipped references become proposal clarifications.
    const row = await loadSheetCheck(bidId);
    expect(skippedClarifications(row!.result, row!.skips)).toEqual(expect.arrayContaining([
      'Sheet M-1 not provided at time of bid.', 'Reflected ceiling plan not provided at time of bid.',
    ]));
  });

  it('a stale check can\'t overwrite a newer one', async () => {
    if (!ok || !have) return;
    const bidId = await makeBid();
    await runCheck(bidId);
    const { claimSheetCheck, runSheetCheck } = await import('../services/sheetCheck');
    const t1 = await claimSheetCheck(bidId, 'k1');
    const t2 = await claimSheetCheck(bidId, 'k2');
    await runSheetCheck(bidId, t1, [], { client: null, classifierModel: 'x', visionModel: 'y', aiRefs: false });
    expect((await loadSheetCheck(bidId))!.status).toBe('running'); // t1's write refused
    await runSheetCheck(bidId, t2, [], { client: null, classifierModel: 'x', visionModel: 'y', aiRefs: false });
    expect((await loadSheetCheck(bidId))!.status).toBe('complete');
  });

  it('403 without run_analysis; 404 for another user\'s bid', async () => {
    if (!ok) return;
    const bidId = await makeBid();
    const viewer = await makeUser('sales_manager');
    const res = await request(app).post(`/api/preconstruction/${bidId}/sheet-check/run`).set(auth(viewer.token));
    expect([403, 404]).toContain(res.status);
  });

  it('a scanned E-sheet (no text layer): Sonnet vision reads its notes region; the cache remembers it', async () => {
    if (!ok || !have) return;
    // Symbols only, no text: pdftotext finds nothing on the page.
    const scanned = ownedBuffer(buildSymbolPdf([
      { mediaBox: [0, 0, 1728, 1296], symbols: Array.from({ length: 60 }, (_, i) => ({ type: '', x: 100 + (i % 12) * 120, y: 200 + Math.floor(i / 12) * 150 })), texts: [] },
    ]));
    expect(scanned.length).toBeGreaterThan(4096);
    await pool.query('DELETE FROM sheet_page_cache WHERE content_sha256=$1', [sha256(scanned)]);
    // Seed the classification (the crop has no text for the fake to read).
    await pool.query(`INSERT INTO sheet_page_cache (content_sha256, page, sheet_no, title, discipline, cls, text_chars, has_text_layer)
      VALUES ($1, 1, 'E-2', 'POWER PLAN', 'electrical', 'plan', 0, false)`, [sha256(scanned)]);
    const bidId = await makeBid();
    const res = await request(app).post(`/api/preconstruction/${bidId}/sheet-check/run`).set(auth(user.token)).attach('files', scanned, 'E-2 scan.pdf');
    expect(res.status).toBe(200);
    let body: Record<string, unknown> & { missing: Array<{ id: string; referencedBy: Array<{ source: string }> }> };
    for (;;) {
      body = (await request(app).get(`/api/preconstruction/${bidId}/sheet-check`).set(auth(user.token))).body;
      if (body.status !== 'running') break;
      await new Promise(r => setTimeout(r, 50));
    }
    const vision = sdk.calls.filter(c => sys(c).includes('scanned electrical drawing sheet'));
    expect(vision).toHaveLength(1);
    // One image: the notes region only, not the whole sheet.
    const content = (vision[0].messages as Array<{ content: Array<{ type: string }> }>)[0].content;
    expect(content.filter(b => b.type === 'image')).toHaveLength(1);
    expect(body.missing.map(m => m.id)).toEqual(['sheet:M1']); // "NEC 210.8" dropped
    expect(body.missing[0].referencedBy[0].source).toBe('vision');
    // A second check reads the cached answer — no second vision call.
    sdk.calls = [];
    await request(app).post(`/api/preconstruction/${bidId}/sheet-check/run`).set(auth(user.token)).attach('files', ownedBuffer(scanned), 'E-2 scan.pdf');
    for (;;) {
      const g = (await request(app).get(`/api/preconstruction/${bidId}/sheet-check`).set(auth(user.token))).body;
      if (g.status !== 'running') { expect(g.missing.map((m: { id: string }) => m.id)).toEqual(['sheet:M1']); break; }
      await new Promise(r => setTimeout(r, 50));
    }
    expect(sdk.calls).toHaveLength(0);
  });

  it('the analysis uses the check: no second classifier call, PH0.1 goes to Agent 1 as a low-res reference sheet, A-1.1 not at all', async () => {
    if (!ok || !have) return;
    const bidId = await makeBid();
    await runCheck(bidId);
    await pool.query(`INSERT INTO takeoff_results (bid_id, status) VALUES ($1, 'running') ON CONFLICT DO NOTHING`, [bidId]);
    sdk.calls = [];
    const { fakeAnthropic, systemText: st, userText: ut, imageCount } = await import('./fixtures/takeoff/fakeAnthropic');
    const fake = fakeAnthropic(() => ({ text: '{}' }));
    await runPipeline(bidId, [{ originalname: 'AZ 10077 FULL SET.pdf', buffer: ownedBuffer(PDF), mimetype: 'application/pdf', size: PDF.length } as Express.Multer.File], fake.client, await loadAIConfig());
    expect(fake.calls.filter(c => st(c).includes('sheet classifier'))).toHaveLength(0);
    const a1 = fake.calls.filter(c => st(c).includes('Senior Electrical Drawing Analyzer'));
    expect(a1.length).toBeGreaterThan(0);
    const text = a1.map(ut).join('\n');
    expect(text).toMatch(/--- Sheet: PH0\.1 "PHOTOMETRIC SITE PLAN" \(reference — context only/);
    expect(text).toMatch(/--- Sheet: C-3\.1 "UTILITY PLAN" \(reference/);
    expect(text).not.toContain('A-1.1');
    expect(text).toMatch(/--- Sheet: E-3 "LIGHTING PLAN" \(plan\)/);
    // A 24x18 reference sheet is one or two tiles; a plan sheet is more.
    expect(a1.reduce((n, c) => n + imageCount(c), 0)).toBeGreaterThan(0);
    const { rows: [tr] } = await pool.query('SELECT prep_inventory FROM takeoff_results WHERE bid_id=$1', [bidId]);
    const inv = tr.prep_inventory as Array<{ sheetNo: string; role: string; reason: string; included: boolean }>;
    expect(inv.find(p => p.sheetNo === 'PH0.1')).toMatchObject({ role: 'reference', included: true, reason: expect.stringContaining('E-7 note 3') });
    expect(inv.find(p => p.sheetNo === 'A-1.1')).toMatchObject({ role: 'excluded', included: false });
  });
});
