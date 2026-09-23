// Takeoff accuracy fix round 2 — R2-B1 (a send never attaches a file whose
// inputs changed after it was made, within one run), S-R2-1 (a superseded
// run never writes), N-R2-7 (auto-drafts count toward the daily limit).
// No real AI / Drive / email: the SDK and Drive are mocked; Graph is muted
// under test (a send that passes every check stops at 503 "not configured").
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { stream: () => ({ finalMessage: async () => { throw new Error('no AI in this test'); } }) }; } }));
vi.mock('../services/googleDrive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/googleDrive')>();
  return { ...actual, uploadFile: async () => null, ensureSubfolder: async () => null };
});

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { startAnalysisRun, composeCurrentBidData } from '../routes/preconstruction';
import { mergeCountsIntoTakeoff } from '../ai/countMerge';
import { buildCountTargets } from '../ai/countTargets';
import { selectCountSheets } from '../ai/countSheets';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const A1 = { fixtureSchedule: [{ type: 'A', description: '4 ft LED linear', location: 'interior', wattage: 32 }] };
function zeroA() {
  const { targets } = buildCountTargets(A1);
  const [s] = selectCountSheets([{ file: 'set.pdf', page: 1, sheetNo: 'E-3', title: 'LIGHTING PLAN', discipline: 'electrical', cls: 'plan', included: true }]).counted;
  const m = mergeCountsIntoTakeoff(A1, targets, [{ sheet: s, status: 'counted', placed: [], unreadable: [] }], { countingRan: true });
  return { version: 2, ran: true, model: 'm', targets, targetNotes: [], sheets: [], skippedSheets: [], types: m.types, loadCheck: m.loadCheck, removedRows: [], flags: [], marks: [], noScheduleOrLegend: false };
}
const AGENT4 = {
  sections: [
    { title: 'A. Service & Distribution', bullets: ['Service entrance assembly (ECFECI).', 'Distribution gear (ECFECI): panels A, B.'] },
    { title: 'B. Branch Power', bullets: ['Branch circuit wiring per plan.'] },
    { title: 'C. Lighting & Controls', bullets: ['Complete lighting package (ECFECI).', 'Controls & testing: occupancy sensors and photocells.'] },
    { title: 'D. Site Lighting, Underground Work & Allowances', bullets: ['Site lighting per plan.'] },
  ],
  exclusions: ['Painting excluded.'], fixture_types: ['A'], allowances_bullets: [],
  takeoff: [{ name: 'Interior Lighting', items: [{ item: 'Type A', description: '4 ft LED linear (ECFECI)', unit: 'EA', qty: 73, source: 'E-3', count_type: 'A' }] }],
};
const resolvedA = (qty: number) => JSON.stringify([{ id: 'count:A', kind: 'count', title: 'Type A', detail: 'Counted 0', actions: ['count', 'markers', 'not_on_job'], resolution: { action: 'count', qty, by: 'Chris', at: 't' } }]);

/** A current-run proposal PDF filed with the inputs hash of that moment. */
async function filedProposal(): Promise<{ token: string; bidId: string }> {
  const user = await makeUser('owner');
  const { rows } = await pool.query(`INSERT INTO bids (name, gc, loc, salesperson_id) VALUES ($1,'Summit General Contractors','Kissimmee, FL 34747',$2) RETURNING id`, [`R2B1 ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]);
  const bidId = rows[0].id as string;
  await startAnalysisRun(bidId);
  await pool.query(
    `UPDATE takeoff_results SET status='complete', agent2_output='{}', count_result=$2, review_items=$3, review_status='clear',
       agent4_output=$4, agent4_price=81485.60, agent4_status='complete', agent4_run_id=run_id WHERE bid_id=$1`,
    [bidId, JSON.stringify(zeroA()), resolvedA(73), JSON.stringify(AGENT4)]
  );
  const loaded = await composeCurrentBidData(bidId, { persist: false, validate: false });
  if (!loaded.ok) throw new Error(loaded.error);
  const pdf = Buffer.from('%PDF-1.4 proposal with A = 73 at $81,485.60');
  await pool.query(
    `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_size, file_type, uploaded_by, file_data, gate_passed, takeoff_run_id, compose_inputs_hash)
     VALUES ($1,'x','elec','Proposal.pdf','Proposal.pdf','proposal',$2,'application/pdf','t',$3,true,$4,$5)`,
    [bidId, pdf.length, pdf.toString('base64'), loaded.runId, loaded.inputsHash]
  );
  return { token: user.token, bidId };
}
const send = (token: string, bidId: string) => request(app).post(`/api/bids/${bidId}/draft-proposal`).set(auth(token)).send({ to: ['gc@example.com'], markSubmitted: false });

describe('R2-B1 — within one run, a send never attaches a file whose inputs changed', () => {
  it('control: nothing changed -> the file passes the check (and the send stops only at "email not configured")', async (ctx) => {
    if (!ok) return ctx.skip();
    const { token, bidId } = await filedProposal();
    const r = await send(token, bidId);
    expect(r.status).toBe(503);
  });
  it('review repro 1: A re-resolved 73 -> 37 after the PDF was filed -> 409 Regenerate', async (ctx) => {
    if (!ok) return ctx.skip();
    const { token, bidId } = await filedProposal();
    await pool.query(`UPDATE takeoff_results SET review_items=$2 WHERE bid_id=$1`, [bidId, resolvedA(37)]);
    const r = await send(token, bidId);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/^Regenerate — inputs changed since this file was made/);
  });
  it('review repro 2: the price changed after the PDF was filed -> 409 Regenerate', async (ctx) => {
    if (!ok) return ctx.skip();
    const { token, bidId } = await filedProposal();
    await pool.query(`UPDATE takeoff_results SET agent4_price=95000 WHERE bid_id=$1`, [bidId]);
    const r = await send(token, bidId);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Regenerate/);
  });
  it('a scope-list change after the PDF was filed -> 409 Regenerate', async (ctx) => {
    if (!ok) return ctx.skip();
    const { token, bidId } = await filedProposal();
    await request(app).post(`/api/preconstruction/${bidId}/scope-items`).set(auth(token)).send({ kind: 'exclude', text: 'Generator — not included' }).expect(200);
    expect((await send(token, bidId)).status).toBe(409);
  });
});

describe('R2-B1 — the pre-bid package for Chris too', () => {
  it('a count re-resolved after the package was filed -> email-prebid-chris 409 Regenerate', async (ctx) => {
    if (!ok) return ctx.skip();
    const { token, bidId } = await filedProposal();
    const { scopeInputsHash } = await import('../routes/preconstruction');
    await pool.query(`UPDATE takeoff_results SET draft_output=$2, draft_status='complete', draft_run_id=run_id WHERE bid_id=$1`, [bidId, JSON.stringify(AGENT4)]);
    await pool.query(`UPDATE takeoff_results SET draft_inputs_hash=$2 WHERE bid_id=$1`, [bidId, await scopeInputsHash(bidId)]);
    const loaded = await composeCurrentBidData(bidId, { persist: false, validate: false, source: 'draft' });
    if (!loaded.ok) throw new Error(loaded.error);
    await pool.query(
      `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_size, file_type, uploaded_by, file_data, gate_passed, takeoff_run_id, compose_inputs_hash)
       VALUES ($1,'x','elec','PreBid.docx','PreBid.docx','prebid_scope',3,'application/vnd.openxmlformats-officedocument.wordprocessingml.document','t','YWJj',true,$2,$3)`,
      [bidId, loaded.runId, loaded.inputsHash]
    );
    const chris = () => request(app).post(`/api/bids/${bidId}/email-prebid-chris`).set(auth(token)).send({});
    expect((await chris()).status).toBe(503); // passes the check; email isn't configured under test
    await pool.query(`UPDATE takeoff_results SET review_items=$2 WHERE bid_id=$1`, [bidId, resolvedA(37)]);
    const r = await chris();
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/^Regenerate — inputs changed since this file was made/);
  });
});

describe('S-R2-1 — a superseded run never writes', () => {
  it('run A is overtaken by run B during Agent 1: A never lifts B\'s "pending", never overwrites B\'s outputs, never marks it error', async (ctx) => {
    if (!ok) return ctx.skip();
    const sharp = (await import('sharp')).default;
    const { fakeAnthropic, systemText } = await import('./fixtures/takeoff/fakeAnthropic');
    const { runPipeline, loadAIConfig } = await import('../routes/preconstruction');
    const { rows } = await pool.query(`INSERT INTO bids (name, gc, loc) VALUES ($1,'G','Ocala, FL') RETURNING id`, [`Overlap ${Date.now()}`]);
    const bidId = rows[0].id as string;
    await startAnalysisRun(bidId); // run A
    let runB = '';
    const { client } = fakeAnthropic(async (req) => {
      const sys = systemText(req);
      if (sys.includes('Senior Electrical Drawing Analyzer')) {
        runB = await startAnalysisRun(bidId); // the estimator starts another analysis meanwhile
        return { text: JSON.stringify({ project: { name: 'X' }, quantities: [], flags: [], missingSheets: [] }) };
      }
      return { text: '{}' };
    });
    const img = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    await runPipeline(bidId, [{ originalname: 'E-3.jpg', buffer: img, mimetype: 'image/jpeg', size: img.length } as Express.Multer.File], client, await loadAIConfig());
    const { rows: tr } = await pool.query('SELECT run_id, status, review_status, agent1_output, agent2_output FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(tr[0]).toEqual({ run_id: runB, status: 'running', review_status: 'pending', agent1_output: null, agent2_output: null });
  });
});

describe('N-R2-7 — pre-bid drafts count toward the daily AI limit', () => {
  it('a user whose drafts reached the limit may not start more paid AI work', async (ctx) => {
    if (!ok) return ctx.skip();
    const { hasAIPermission } = await import('../middleware/auth');
    const u = await makeUser('estimator');
    expect(await hasAIPermission(u as never, 'run_analysis')).toBe(true);
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key='ai_daily_limit_per_user'`).catch(() => ({ rows: [] as Array<{ value: string }> }));
    const limit = parseInt(rows[0]?.value || '10');
    for (let i = 0; i < limit; i++) {
      await pool.query(`INSERT INTO activity (kind, div, text, user_id) VALUES ('ai_draft','preconstruction','draft',$1)`, [u.id]);
    }
    expect(await hasAIPermission(u as never, 'run_analysis')).toBe(false);
  });
});
