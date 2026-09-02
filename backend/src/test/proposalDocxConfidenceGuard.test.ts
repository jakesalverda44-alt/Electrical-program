// Task 5.4 (phase 2 takeoff fidelity): confidence is internal, never customer-
// facing. Agent 1 emits VERIFIED/ASSUMED/NOT SHOWN and the Pricing tab now
// renders a FIRM/APPROX/VERIFY chip for the estimator (Task 5.1/5.2) — but the
// playbook bans tolerance language on bids, and the proposal .docx is the
// document that actually goes to the GC. This guards that buildProposalDocx's
// takeoff table never leaks those tokens, even when the stored Agent 4 JSON
// carries a stray `confidence` field on a takeoff row (the schema doesn't
// define one — proposalDocx.ts only reads category/item/description/unit/qty/
// sourceNotes — so this proves the renderer safely ignores it rather than
// someone naively spreading the whole row object into a cell in the future).
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Response } from 'superagent';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { extractDocxText } from '../utils/bidDocParse';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const BANNED = ['FIRM', 'APPROX', 'VERIFY', 'VERIFIED', 'ASSUMED'];

// supertest/superagent has no built-in parser for the .docx content type, so
// res.body would otherwise come back as {} — buffer the raw bytes ourselves.
function binaryParser(res: Response, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('generate-docx — confidence never leaks into the GC-facing document', () => {
  it('never contains FIRM/APPROX/VERIFY/VERIFIED/ASSUMED in the rendered takeoff table', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `ConfidenceGuard ${Date.now()}`, gc: 'G' }).expect(200);
    const bidId = bid.body.id as string;

    const proposalData = {
      date: '2026-09-02',
      gcName: 'ABC Construction',
      projectName: 'Circle K #4521',
      projectAddress: '1234 Main St, Eustis, FL',
      openingStatement: 'The project is understood to be electrical work.',
      scopeOfWork: {
        standard6Bullets: ['All work per plan.'],
        A_ServiceDistribution: ['Service entrance assembly and MDP (ECFECI).'],
        B_BranchPower: ['Branch circuit wiring per plan.'],
        C_LightingControls: ['Complete lighting package (ECFECI).', 'Controls and testing.', 'LED fixtures per schedule.'],
        D_SiteLightingUnderground: ['Site lighting per allowance.'],
        E_LowVoltage: ['Conduit and boxes only.'],
        F_Coordination: ['Coordinate with GC.'],
      },
      exclusions: ['Painting and patching.'],
      allowances: [{ item: 'Underground conduit', footage: 400, unit: 'LF', notes: 'Per site plan' }],
      // Takeoff rows carry a stray `confidence` field the schema doesn't
      // define — proposalDocx.ts must not render it into any cell.
      takeoff: [
        { category: 'Interior Lighting', item: 'LED Troffer 2x4', description: '40W 4000K fixture', unit: 'EA', qty: 48, sourceNotes: 'Per schedule E-401', confidence: 'VERIFIED' },
        { category: 'Branch Power', item: 'Duplex Receptacle', description: '20A 125V', unit: 'EA', qty: 64, sourceNotes: 'Per plan', confidence: 'ASSUMED' },
        { category: 'Low Voltage', item: 'Data Cable', description: 'Cat6 plenum', unit: 'LF', qty: 1200, sourceNotes: 'Estimated run length', confidence: 'NOT SHOWN' },
      ],
      terms: ['Based on drawings dated 2026-09-02.'],
      totalPrice: '$425,000',
      rfisToResolve: [],
    };

    await pool.query(
      `INSERT INTO takeoff_results (bid_id, agent2_output, agent4_output, agent4_price, agent4_status)
       VALUES ($1,'{}',$2::text,425000,'complete')`,
      [bidId, JSON.stringify(proposalData)]
    );

    const res = await request(app)
      .get(`/api/preconstruction/${bidId}/generate-docx`).set(auth(u.token))
      .buffer(true).parse(binaryParser)
      .expect(200);
    expect(res.headers['content-type']).toMatch(/wordprocessingml/);

    const text = extractDocxText(res.body as Buffer);
    // Sanity: the takeoff rows we sent really did render (proves this test
    // actually exercises the takeoff table, not an empty/skipped section).
    expect(text).toContain('LED Troffer 2x4');
    expect(text).toContain('Duplex Receptacle');
    expect(text).toContain('Data Cable');

    for (const banned of BANNED) {
      expect(text).not.toContain(banned);
    }
  });
});
