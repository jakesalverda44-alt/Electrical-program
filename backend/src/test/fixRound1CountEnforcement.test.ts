// Takeoff accuracy fix round 1 / B1 — end to end through generate-docx: an
// Agent 4 output that DROPS type A and writes B = 37 still produces A 73 /
// B 52 in the rendered proposal, and the preview lists every correction.
// No AI calls (the rows are written directly), no Drive (mocked).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import AdmZip from 'adm-zip';

vi.mock('../services/googleDrive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/googleDrive')>();
  return { ...actual, uploadFile: async () => null, ensureSubfolder: async () => null };
});

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { mergeCountsIntoTakeoff } from '../ai/countMerge';
import { buildCountTargets } from '../ai/countTargets';
import { selectCountSheets } from '../ai/countSheets';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const A1 = { fixtureSchedule: [
  { type: 'A', description: '4 ft LED linear', location: 'interior', wattage: 32 },
  { type: 'B', description: '8 ft LED linear', location: 'interior', wattage: 64 },
] };
function countResult() {
  const { targets } = buildCountTargets(A1);
  const [light] = selectCountSheets([{ file: 'set.pdf', page: 2, sheetNo: 'E-3', title: 'LIGHTING PLAN', discipline: 'electrical', cls: 'plan', included: true }]).counted;
  const marks = [...Array(73).fill({ typeKey: 'A' }), ...Array(52).fill({ typeKey: 'B' })];
  const m = mergeCountsIntoTakeoff(A1, targets, [{ sheet: light, status: 'counted', placed: marks, unreadable: [] }], { countingRan: true });
  return { version: 2, ran: true, model: 'm', targets, targetNotes: [], sheets: [], skippedSheets: [], types: m.types, loadCheck: m.loadCheck, removedRows: [], flags: [], marks: [], noScheduleOrLegend: false };
}
const AGENT4_WRONG = {
  sections: [
    { title: 'A. Service & Distribution', bullets: ['Service entrance assembly (ECFECI).', 'Distribution gear (ECFECI): panels A, B.'] },
    { title: 'B. Branch Power', bullets: ['Branch circuit wiring per plan.'] },
    { title: 'C. Lighting & Controls', bullets: ['Complete lighting package (ECFECI).', 'Controls & testing: occupancy sensors and photocells.'] },
    { title: 'D. Site Lighting, Underground Work & Allowances', bullets: ['Site lighting per plan.'] },
  ],
  exclusions: ['Painting excluded.'], fixture_types: ['A', 'B'], allowances_bullets: [],
  takeoff: [
    { name: 'Service & Distribution', items: [{ item: '1.1', description: '800A service entrance (ECFECI)', unit: 'EA', qty: 1, source: 'E1.6' }] },
    // Agent 4 folded A into B and wrote the wrong number.
    { name: 'Interior Lighting', items: [{ item: 'Type B', description: '8 ft LED linear (ECFECI)', unit: 'EA', qty: 37, source: 'E-3' }] },
  ],
};

describe('B1 — counted quantities are enforced on the GC proposal', () => {
  it('Agent 4 drops A and writes B = 37 -> the .docx says A 73 and B 52', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Enforce ${Date.now()}`, gc: 'Summit General Contractors', loc: '2860 N Old Lake Wilson Rd, Kissimmee, FL 34747' }).expect(200);
    const bidId = bid.body.id as string;
    await pool.query(
      `INSERT INTO takeoff_results (bid_id, agent2_output, agent4_output, agent4_price, agent4_status, count_result, review_status, review_items)
       VALUES ($1,'{}',$2,81485.60,'complete',$3,'clear','[]')`,
      [bidId, JSON.stringify(AGENT4_WRONG), JSON.stringify(countResult())]
    );
    const preview = await request(app).get(`/api/preconstruction/${bidId}/proposal-preview`).set(auth(u.token)).expect(200);
    expect(preview.body.accountCorrections).toEqual(expect.arrayContaining([
      'Type A was missing from the takeoff — added to Interior Lighting with the counted quantity 73.',
      'Type B: Interior Lighting "Type B — 8 ft LED linear (ECFECI)" said 37 — set to the counted quantity 52.',
    ]));
    const res = await request(app).get(`/api/preconstruction/${bidId}/generate-docx`).set(auth(u.token))
      .buffer(true).parse((r, cb) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(res.status).toBe(200);
    const xml = new AdmZip(res.body as Buffer).readAsText('word/document.xml');
    const rows = [...xml.matchAll(/<w:tr[ >].*?<\/w:tr>/gs)].map(r => [...r[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(t => t[1]).join('|'));
    expect(rows.find(r => r.includes('Type A'))).toMatch(/\|EA\|73\|/);
    expect(rows.find(r => r.includes('Type B'))).toMatch(/\|EA\|52\|/);
    expect(rows.some(r => /\|37\|/.test(r))).toBe(false);
  }, 180_000);
});
