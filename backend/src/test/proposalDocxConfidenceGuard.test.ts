// Task 5.4 (phase 2 takeoff fidelity): confidence is internal, never customer-
// facing. Agent 1 emits VERIFIED/ASSUMED/NOT SHOWN and the Pricing tab now
// renders a FIRM/APPROX/VERIFY chip for the estimator (Task 5.1/5.2) — but the
// playbook bans tolerance language on bids, and the proposal .docx is the
// document that actually goes to the GC. This guards that the rendered
// takeoff table never leaks those tokens.
//
// FIX-5 (post-review): the original version of this test sent an OLD-shape
// ProposalJSON body whose `takeoff[]` rows carry a `confidence` field the
// legacy contract's schema doesn't define. legacyProposalToBidData (the only
// thing that ever reads an old-shape row) never mapped `confidence` onto the
// composed takeoff item at all — so the docx was guaranteed to be conf-free
// by construction, regardless of whether renderBidDocx's own rendering logic
// was correct. The test was vacuous: it could never fail, even if
// renderBidDocx started printing `it.conf` directly into a cell.
//
// Repointed at the REAL vector: a NEW-shape compose, where confidence flows
// through two live paths — Agent 4's own `conf` echo on a takeoff item, AND
// (higher priority) a saved bid_estimates.line_items row's confidence,
// exactly as composeBidData.ts's SavedConfidenceItem precedence documents.
// Both paths are exercised here; renderBidDocx's takeoff table must still
// never print any of the internal tokens.
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

// A gate-passing new-shape Agent 4 output (verifyBidDocx(kind:'gc') AND
// validateBidData both run on generate-docx post-FIX-7) whose takeoff items
// carry `conf` directly — the first of the two live confidence paths.
const NEW_SHAPE_AGENT4_OUTPUT = {
  sections: [
    { title: 'A. Service & Distribution', bullets: [
      'Service entrance assembly and MDP (ECFECI).',
      'Distribution gear (ECFECI): panels A, B, with feeders and disconnects throughout.',
    ] },
    { title: 'B. Branch Power', bullets: ['Branch circuit wiring per plan.'] },
    { title: 'C. Lighting & Controls', bullets: [
      'Complete lighting package (ECFECI) — Southern Lighting Source.',
      'Controls & testing: occupancy sensors and photocells; functional testing prior to final inspection.',
    ] },
    { title: 'D. Site Lighting, Underground Work & Allowances', bullets: ['Site lighting per allowance.'] },
  ],
  fixture_types: ['A'],
  exclusions: ['Painting and patching.'],
  takeoff: [
    { name: 'Interior Lighting', items: [
      { item: '2.1', description: 'LED Troffer 2x4', unit: 'EA', qty: 48, source: 'Per schedule E-401', conf: 'VERIFIED' },
    ] },
    { name: 'Branch Power', items: [
      // This item's confidence is overridden below by a saved bid_estimates
      // line — Agent 4's own 'ASSUMED' echo (-> APPROX) must lose to it.
      { item: '3.1', description: 'Duplex Receptacle', unit: 'EA', qty: 64, source: 'Per plan', conf: 'ASSUMED' },
    ] },
    { name: 'Low Voltage Infrastructure (Conduit & Boxes Only)', items: [
      { item: '4.1', description: 'Data Cable', unit: 'LF', qty: 1200, source: 'Estimated run length' },
    ] },
  ],
};

describe('generate-docx — confidence never leaks into the GC-facing document (new-shape, FIX-5)', () => {
  it('never contains FIRM/APPROX/VERIFY/VERIFIED/ASSUMED in the rendered takeoff table', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `ConfidenceGuard ${Date.now()}`, gc: 'ABC Construction', loc: '1234 Main St, Eustis, FL' }).expect(200);
    const bidId = bid.body.id as string;

    await pool.query(
      `INSERT INTO takeoff_results (bid_id, agent2_output, agent4_output, agent4_price, agent4_status)
       VALUES ($1,'{}',$2::text,425000,'complete')`,
      [bidId, JSON.stringify(NEW_SHAPE_AGENT4_OUTPUT)]
    );
    // The second live confidence path: composeBidData prefers this saved
    // value over item 3.1's own 'ASSUMED' echo — normalizeConfidence maps
    // 'NOT SHOWN' -> 'VERIFY', so if either path leaked, this is the one
    // most likely to (it's the one composeBidData treats as authoritative).
    await pool.query(
      `INSERT INTO bid_estimates (bid_id, line_items) VALUES ($1, $2::jsonb)`,
      [bidId, JSON.stringify([{ category: 'Branch Power', item: '3.1', confidence: 'NOT SHOWN' }])]
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

    // Confirm the preview endpoint DOES carry conf (composeCurrentBidData
    // exposes it for the estimator-facing preview/pre-bid xlsx) — the
    // guarantee under test is specifically that renderBidDocx never prints
    // it, not that it's stripped from the composed data entirely.
    const preview = await request(app)
      .get(`/api/preconstruction/${bidId}/proposal-preview`).set(auth(u.token))
      .expect(200);
    const branchPower = preview.body.takeoff.find((c: { name: string }) => c.name === 'Branch Power');
    expect(branchPower.items[0].conf).toBe('VERIFY'); // saved line item won over Agent 4's 'ASSUMED'
  });
});

// Kept cheap: the legacy (pre-Phase-3) shape structurally cannot carry a
// `conf` field through to the composed takeoff item at all
// (legacyProposalToBidData never reads `confidence` off a takeoff row) — so
// this is a real, if narrower, guarantee: an old proposal renders clean too.
describe('generate-docx — legacy-shape rows also render conf-free (cheap regression case)', () => {
  it('a legacy-shape row with a stray confidence field on a takeoff item still renders clean', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `ConfidenceGuardLegacy ${Date.now()}`, gc: 'ABC Construction' }).expect(200);
    const bidId = bid.body.id as string;

    const legacyProposalData = {
      scopeOfWork: {
        standard6Bullets: ['All work per plan.'],
        A_ServiceDistribution: [
          'Service entrance assembly and MDP (ECFECI).',
          'Distribution gear (ECFECI): panels A, B, with feeders and disconnects throughout.',
        ],
        B_BranchPower: ['Branch circuit wiring per plan.'],
        C_LightingControls: ['Complete lighting package (ECFECI).', 'Controls and testing.', 'LED fixtures per schedule.'],
        D_SiteLightingUnderground: ['Site lighting per allowance.'],
      },
      exclusions: ['Painting and patching.'],
      // A stray `confidence` field the legacy schema doesn't define —
      // legacyProposalToBidData must not carry it through.
      takeoff: [
        { category: 'Interior Lighting', item: 'LED Troffer 2x4', description: '40W 4000K fixture', unit: 'EA', qty: 48, sourceNotes: 'Per schedule E-401', confidence: 'VERIFIED' },
      ],
      totalPrice: '$425,000',
    };
    await pool.query(
      `INSERT INTO takeoff_results (bid_id, agent2_output, agent4_output, agent4_price, agent4_status)
       VALUES ($1,'{}',$2::text,425000,'complete')`,
      [bidId, JSON.stringify(legacyProposalData)]
    );

    const res = await request(app)
      .get(`/api/preconstruction/${bidId}/generate-docx`).set(auth(u.token))
      .buffer(true).parse(binaryParser)
      .expect(200);
    const text = extractDocxText(res.body as Buffer);
    expect(text).toContain('LED Troffer 2x4');
    for (const banned of BANNED) {
      expect(text).not.toContain(banned);
    }
  });
});
