// Phase 3 Task 6 — the generation flow: verify-gate, file everything,
// pre-bid package. End-to-end route tests against the isolated test DB.
import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

// A gate-passing new-shape Agent 4 output — 4 ECFECI mentions, correctly
// placed (A/B window and C/D window both satisfied), no banned language, no
// placeholders, no square footage.
const CLEAN_AGENT4_OUTPUT = {
  sections: [
    { title: 'A. Service & Distribution', bullets: [
      'Service entrance assembly and MDP (ECFECI).',
      'Distribution gear (ECFECI): panels A, B.',
    ] },
    { title: 'B. Branch Power', bullets: ['Branch circuit wiring per plan.'] },
    { title: 'C. Lighting & Controls', bullets: [
      'Complete lighting package (ECFECI) — Southern Lighting Source.',
      'Controls & testing: occupancy sensors and photocells.',
    ] },
    { title: 'D. Site Lighting, Underground Work & Allowances', bullets: ['Site lighting per photometric plan.'] },
  ],
  exclusions: ['Painting and patching are excluded from this scope.'],
  fixture_types: ['A', 'AE'],
  allowances_bullets: ["160' allowance - service feeder from transformer secondary to MDP."],
  takeoff: [
    { name: 'Service & Distribution', items: [
      { item: '1.1', description: '800A service entrance assembly (ECFECI)', unit: 'EA', qty: 1, source: 'E1.6 Riser Diagram', conf: 'VERIFIED' },
    ] },
    { name: 'Interior Lighting', items: [
      { item: '2.1', description: 'Type A troffer', unit: 'EA', qty: 20, source: 'E2.0 Luminaire Schedule', conf: 'ASSUMED' },
    ] },
  ],
};

// Same shape, but with an "RFI" bullet doctored in — must fail the GC gate.
const DOCTORED_AGENT4_OUTPUT = {
  ...CLEAN_AGENT4_OUTPUT,
  exclusions: [...CLEAN_AGENT4_OUTPUT.exclusions, 'Submit an RFI to resolve panel schedule discrepancies.'],
};

async function makeBidWithAgent4(token: string, name: string, output: unknown, price = 248750) {
  const bid = await request((await import('../index')).app).post('/api/bids').set(auth(token))
    .send({ name: `${name} ${Date.now()}`, gc: 'ABC Construction', loc: '1234 Main St, Eustis, FL' }).expect(200);
  const bidId = bid.body.id as string;
  await pool.query(
    `INSERT INTO takeoff_results (bid_id, agent2_output, agent4_output, agent4_price, agent4_status)
     VALUES ($1,'{}',$2,$3,'complete')`,
    [bidId, JSON.stringify(output), price]
  );
  return bidId;
}

describe('proposal-preview (Task 7)', () => {
  it('returns the composed BidData — sections by real titles, exclusions, terms, price', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBidWithAgent4(u.token, 'Preview', CLEAN_AGENT4_OUTPUT);

    const res = await request(app)
      .get(`/api/preconstruction/${bidId}/proposal-preview`).set(auth(u.token))
      .expect(200);
    expect(res.body.sections.map((s: { title: string }) => s.title)).toContain('A. Service & Distribution');
    expect(res.body.exclusions).toContain('Painting and patching are excluded from this scope.');
    expect(res.body.terms).toHaveLength(10);
    expect(res.body.total_price).toBe('$248,750');
    // conf is present on the composed data but never rendered by the GC docx/xlsx.
    expect(res.body.takeoff[0].items[0].conf).toBe('FIRM');
  });

  it('404s when there is no proposal data yet', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `PreviewNone ${Date.now()}`, gc: 'G' }).expect(200);
    await request(app)
      .get(`/api/preconstruction/${bid.body.id}/proposal-preview`).set(auth(u.token))
      .expect(404);
  });

  it('renders a legacy-shape row through the adapter path too', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const legacy = {
      scopeOfWork: { A_ServiceDistribution: ['Service entrance (ECFECI).'] },
      exclusions: ['Painting excluded.'],
      totalPrice: '$50,000',
    };
    const bidId = await makeBidWithAgent4(u.token, 'PreviewLegacy', legacy);
    const res = await request(app)
      .get(`/api/preconstruction/${bidId}/proposal-preview`).set(auth(u.token))
      .expect(200);
    expect(res.body.sections[0].title).toBe('A. Service & Distribution');
    expect(res.body.total_price).toBe('$248,750'); // agent4_price wins, not the '$50,000' in the blob
  });
});

describe('generate-docx — verify gate (Task 6)', () => {
  it('blocks a doctored document with 422 + failures[], and files nothing', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBidWithAgent4(u.token, 'Doctored', DOCTORED_AGENT4_OUTPUT);

    const res = await request(app)
      .get(`/api/preconstruction/${bidId}/generate-docx`).set(auth(u.token))
      .expect(422);
    expect(res.body.error).toMatch(/verification gate/i);
    expect(Array.isArray(res.body.failures)).toBe(true);
    expect(res.body.failures.some((f: { check: string }) => f.check === 'banned_language')).toBe(true);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM documents WHERE linked_id=$1`, [bidId]
    );
    expect(rows[0].n).toBe(0);
  });

  it('the pass path files the docx AND the composed bid_data.json, then streams the docx', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBidWithAgent4(u.token, 'Clean', CLEAN_AGENT4_OUTPUT);

    const res = await request(app)
      .get(`/api/preconstruction/${bidId}/generate-docx`).set(auth(u.token))
      .expect(200);
    expect(res.headers['content-type']).toMatch(/wordprocessingml/);

    const { rows } = await pool.query(
      `SELECT category FROM documents WHERE linked_id=$1 ORDER BY category`, [bidId]
    );
    expect(rows.map(r => r.category)).toEqual(['bid_data', 'proposal']);
  });

  it('generates and persists a job number on first use', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBidWithAgent4(u.token, 'JobNo', CLEAN_AGENT4_OUTPUT);

    await request(app).get(`/api/preconstruction/${bidId}/generate-docx`).set(auth(u.token)).expect(200);

    const { rows } = await pool.query('SELECT job_number FROM bids WHERE id=$1', [bidId]);
    expect(rows[0].job_number).toMatch(/^JS\.\d{8}$/);
  });

  it('a legacy-shape (pre-Phase-3) agent4_output still renders and files (backward compatible)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const legacy = {
      scopeOfWork: {
        standard6Bullets: ['All work per plan.'],
        A_ServiceDistribution: ['Service entrance assembly and MDP (ECFECI).', 'Distribution gear (ECFECI): panel A.'],
        B_BranchPower: ['Branch wiring per plan.'],
        C_LightingControls: ['Complete lighting package (ECFECI) — Southern Lighting Source.'],
        D_SiteLightingUnderground: ['Site lighting per plan.'],
      },
      exclusions: ['Painting excluded.'],
      totalPrice: '$100,000',
    };
    const bidId = await makeBidWithAgent4(u.token, 'Legacy', legacy);
    const res = await request(app)
      .get(`/api/preconstruction/${bidId}/generate-docx`).set(auth(u.token))
      .expect(200);
    expect(res.headers['content-type']).toMatch(/wordprocessingml/);
  });
});

describe('generate-takeoff-xlsx (Task 6)', () => {
  it('streams a GC-mode xlsx and files it under category takeoff', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBidWithAgent4(u.token, 'Xlsx', CLEAN_AGENT4_OUTPUT);

    const res = await request(app)
      .get(`/api/preconstruction/${bidId}/generate-takeoff-xlsx`).set(auth(u.token))
      .buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);

    const wb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(res.body as any);
    const ws = wb.getWorksheet('Quantity Takeoff')!;
    let headerRow: ExcelJS.Row | undefined;
    ws.eachRow(row => { if (!headerRow && row.getCell(1).value === 'ITEM') headerRow = row; });
    expect(headerRow?.values as unknown[]).not.toContain('CONF.');

    const { rows } = await pool.query(
      `SELECT category FROM documents WHERE linked_id=$1 AND category='takeoff'`, [bidId]
    );
    expect(rows.length).toBe(1);
  });
});

describe('generate-prebid-package (Task 6)', () => {
  it('files both deliverables under prebid_scope/prebid_takeoff and returns both ids; the xlsx has CONF.', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBidWithAgent4(u.token, 'Prebid', CLEAN_AGENT4_OUTPUT);

    const res = await request(app)
      .post(`/api/preconstruction/${bidId}/generate-prebid-package`).set(auth(u.token))
      .expect(200);
    expect(res.body.scopeDocumentId).toBeTruthy();
    expect(res.body.takeoffDocumentId).toBeTruthy();

    const { rows } = await pool.query(
      `SELECT category, file_data FROM documents WHERE linked_id=$1 ORDER BY category`, [bidId]
    );
    const categories = rows.map(r => r.category);
    expect(categories).toContain('prebid_scope');
    expect(categories).toContain('prebid_takeoff');

    const takeoffRow = rows.find(r => r.category === 'prebid_takeoff')!;
    const wb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(Buffer.from(takeoffRow.file_data, 'base64') as any);
    const ws = wb.getWorksheet('Quantity Takeoff')!;
    let headerRow: ExcelJS.Row | undefined;
    ws.eachRow(row => { if (!headerRow && row.getCell(1).value === 'ITEM') headerRow = row; });
    expect(headerRow?.values as unknown[]).toContain('CONF.');
  });

  it('the prebid scope docx has no price, signature, or takeoff table', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBidWithAgent4(u.token, 'PrebidNoPrice', CLEAN_AGENT4_OUTPUT);

    await request(app).post(`/api/preconstruction/${bidId}/generate-prebid-package`).set(auth(u.token)).expect(200);

    const { rows } = await pool.query(
      `SELECT file_data FROM documents WHERE linked_id=$1 AND category='prebid_scope'`, [bidId]
    );
    const { extractDocxText } = await import('../utils/bidDocParse');
    const text = extractDocxText(Buffer.from(rows[0].file_data, 'base64'));
    expect(text).toContain('PRE-BID PACKAGE');
    expect(text).not.toContain('Proposal Price Summary');
    expect(text).not.toContain('Respectfully,');
    expect(text).not.toContain('ELECTRICAL QUANTITY TAKEOFF');
  });

  it('estimator language ("field verify") in a bullet does not block the pre-bid package (internal kind relaxes it)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const withEstimatorLanguage = {
      ...CLEAN_AGENT4_OUTPUT,
      sections: CLEAN_AGENT4_OUTPUT.sections.map((s, i) =>
        i === 0 ? { ...s, bullets: [...s.bullets, 'Panel count field verify against riser.'] } : s
      ),
    };
    const bidId = await makeBidWithAgent4(u.token, 'PrebidRelaxed', withEstimatorLanguage);
    const res = await request(app)
      .post(`/api/preconstruction/${bidId}/generate-prebid-package`).set(auth(u.token))
      .expect(200);
    expect(res.body.scopeDocumentId).toBeTruthy();
  });

  it('an unfilled placeholder still gates the pre-bid package (kind:internal keeps this check)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const withPlaceholder = {
      ...CLEAN_AGENT4_OUTPUT,
      exclusions: [...CLEAN_AGENT4_OUTPUT.exclusions, 'Received from [SOURCE NAME].'],
    };
    const bidId = await makeBidWithAgent4(u.token, 'PrebidPlaceholder', withPlaceholder);
    const res = await request(app)
      .post(`/api/preconstruction/${bidId}/generate-prebid-package`).set(auth(u.token))
      .expect(422);
    expect(res.body.failures.some((f: { check: string }) => f.check === 'placeholders')).toBe(true);
  });

  it('400s with a clear message when there is no scope data at all', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `NoScope ${Date.now()}`, gc: 'G' }).expect(200);
    const res = await request(app)
      .post(`/api/preconstruction/${bid.body.id}/generate-prebid-package`).set(auth(u.token))
      .expect(400);
    expect(res.body.error).toMatch(/no proposal data|no scope data/i);
  });

  it('400s when agent4_output has an empty sections array (parsed but nothing to build from)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBidWithAgent4(u.token, 'EmptySections', { sections: [], takeoff: [] }, 100000);
    const res = await request(app)
      .post(`/api/preconstruction/${bidId}/generate-prebid-package`).set(auth(u.token))
      .expect(400);
    expect(res.body.error).toMatch(/no scope data/i);
  });
});
