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
  // FIX-4 — generate-takeoff-xlsx now runs verifyBidText(kind:'gc') on the
  // takeoff's own flattened text (item/description/unit/qty/source/conf/
  // furnish_by), independent of the sections/scope text — so this fixture's
  // takeoff needs its own 3+ ECFECI mentions to stay gate-passing (real
  // gear-line takeoffs naturally carry several, per PROJECT_INSTRUCTIONS §7).
  takeoff: [
    { name: 'Service & Distribution', items: [
      { item: '1.1', description: '800A service entrance assembly (ECFECI)', unit: 'EA', qty: 1, source: 'E1.6 Riser Diagram', conf: 'VERIFIED' },
    ] },
    { name: 'Interior Lighting', items: [
      { item: '2.1', description: 'Type A troffer (ECFECI)', unit: 'EA', qty: 20, source: 'E2.0 Luminaire Schedule', conf: 'ASSUMED', furnish_by: 'APT (ECFECI)' },
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

  // FIX-9 — a GET must never write. Preview shows the would-be job number
  // (composeBidData/jobNumber is pure and always computes one when the bid
  // row has none) without persisting it; only the generate-* endpoints do.
  it('computes an ephemeral job number for preview without persisting it', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBidWithAgent4(u.token, 'PreviewJobNo', CLEAN_AGENT4_OUTPUT);

    const res = await request(app)
      .get(`/api/preconstruction/${bidId}/proposal-preview`).set(auth(u.token))
      .expect(200);
    expect(res.body.job_number).toMatch(/^JS\.\d{8}$/);

    const { rows } = await pool.query('SELECT job_number FROM bids WHERE id=$1', [bidId]);
    expect(rows[0].job_number).toBeNull();
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

    // Phase 4 Task 6.2 — same-day collision detection may suffix this
    // (-2, -3, ...) if another bid generated earlier today already holds
    // the plain JS.MMDDYYYY; the exact "-N, first free" arithmetic is
    // covered precisely by boilerplate.test.ts's resolveUniqueJobNumber
    // unit tests, so this just confirms a job number was generated and
    // persisted in the right family of formats.
    const { rows } = await pool.query('SELECT job_number FROM bids WHERE id=$1', [bidId]);
    expect(rows[0].job_number).toMatch(/^JS\.\d{8}(-\d+)?$/);
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

  // FIX-11 — the new-shape branch has always required a validated price
  // before returning (422); the legacy branch didn't, so a legacy row with
  // neither agent4_price nor its own embedded totalPrice sailed through
  // composeCurrentBidData only to 500 later inside renderBidDocx's own price
  // guard. Same 422 as the new path now.
  it('a legacy-shape row with no validated price 422s instead of 500ing', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `LegacyNoPrice ${Date.now()}`, gc: 'G' }).expect(200);
    const bidId = bid.body.id as string;
    const legacyNoPrice = {
      scopeOfWork: { A_ServiceDistribution: ['Service entrance (ECFECI).'] },
      exclusions: ['Painting excluded.'],
      // no totalPrice field at all, and agent4_price is NULL below.
    };
    await pool.query(
      `INSERT INTO takeoff_results (bid_id, agent2_output, agent4_output, agent4_price, agent4_status)
       VALUES ($1,'{}',$2,NULL,'complete')`,
      [bidId, JSON.stringify(legacyNoPrice)]
    );

    const res = await request(app)
      .get(`/api/preconstruction/${bidId}/generate-docx`).set(auth(u.token))
      .expect(422);
    expect(res.body.error).toMatch(/no validated price/i);
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

  // FIX-4 — generate-takeoff-xlsx previously shipped a GC-facing file with
  // no verification gate at all (unlike generate-docx). A takeoff item
  // carrying "TBD" must now block with 422 and file nothing.
  it('blocks with 422 and files nothing when a takeoff item carries banned language ("TBD")', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const doctoredTakeoff = {
      ...CLEAN_AGENT4_OUTPUT,
      takeoff: CLEAN_AGENT4_OUTPUT.takeoff.map((cat, i) =>
        i === 0
          ? { ...cat, items: [...cat.items, { item: '1.2', description: 'Panel count TBD', unit: 'EA', qty: 1, source: 'Field' }] }
          : cat
      ),
    };
    const bidId = await makeBidWithAgent4(u.token, 'XlsxTBD', doctoredTakeoff);

    const res = await request(app)
      .get(`/api/preconstruction/${bidId}/generate-takeoff-xlsx`).set(auth(u.token))
      .expect(422);
    expect(res.body.failures.some((f: { check: string }) => f.check === 'banned_language')).toBe(true);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM documents WHERE linked_id=$1 AND category='takeoff'`, [bidId]
    );
    expect(rows[0].n).toBe(0);
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

  // FIX-3 — generate-prebid-package used replaceExisting:true on the SAME
  // prebid_scope/prebid_takeoff categories import-prebid files human-
  // uploaded documents under — every regeneration hard-deleted whatever the
  // estimator had imported. Import-prebid docs must now survive.
  it('import-prebid document rows survive a generate-prebid-package call', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBidWithAgent4(u.token, 'PrebidKeepImports', CLEAN_AGENT4_OUTPUT);

    await request(app)
      .post(`/api/preconstruction/${bidId}/import-prebid`).set(auth(u.token))
      .attach('takeoff', Buffer.from('not actually a spreadsheet'), 'imported.xlsx')
      .attach('scope', Buffer.from('not actually a document'), 'imported.docx')
      .expect(200);

    const before = await pool.query(
      `SELECT id, category FROM documents WHERE linked_id=$1 ORDER BY category`, [bidId]
    );
    expect(before.rows.map(r => r.category)).toEqual(['prebid_scope', 'prebid_takeoff']);
    const importedIds = before.rows.map(r => r.id as string);

    await request(app)
      .post(`/api/preconstruction/${bidId}/generate-prebid-package`).set(auth(u.token))
      .expect(200);

    const after = await pool.query(
      `SELECT id, category FROM documents WHERE linked_id=$1 ORDER BY category`, [bidId]
    );
    // 2 imported + 2 newly generated = 4 rows, not 2 — the imports weren't
    // deleted, and the generation still filed its own new rows.
    expect(after.rows.length).toBe(4);
    for (const id of importedIds) {
      expect(after.rows.some(r => r.id === id)).toBe(true);
    }
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
