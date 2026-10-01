import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { missingKickoffLabels, buildAwardKickoffEmail } from '../routes/gens';

describe('missingKickoffLabels', () => {
  it('lists labels for absent categories, excluding contract', () => {
    expect(missingKickoffLabels([])).toEqual(['Sizer Report', 'Survey', 'Labeled Survey', 'Site Visit Checklist']);
    expect(missingKickoffLabels(['contract', 'sizer_report', 'survey'])).toEqual(['Labeled Survey', 'Site Visit Checklist']);
    expect(missingKickoffLabels(['contract', 'sizer_report', 'survey', 'labeled_survey', 'site_checklist'])).toEqual([]);
  });
});

describe('kickoff email gating', () => {
  let ok = false;
  beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

  // POST /api/gens returns the created gen row directly (res.json(gen)).
  async function createGen(token: string) {
    const res = await request(app).post('/api/gens').set(auth(token))
      .send({ customer: `Kickoff Test ${Date.now()}`, mfr: 'Kohler', model: '20RCA', kw: 20, amount: 15000 })
      .expect(200);
    return res.body as { id: string };
  }

  async function addContractDoc(genId: string) {
    await pool.query(
      `INSERT INTO documents (linked_id, div, name, display_name, category, uploaded_by)
       VALUES ($1, 'gen', 'signed-proposal.pdf', 'Signed Proposal', 'contract', 'test')`,
      [genId],
    );
  }

  it('400s without a contract doc, before any email-config check', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGen(u.token);
    const res = await request(app).post(`/api/gens/${gen.id}/kickoff-email`).set(auth(u.token)).expect(400);
    expect(res.body.error).toMatch(/Signed proposal required/);
  });

  it('passes the contract gate once a contract doc exists (503 = unconfigured mail, not 400)', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGen(u.token);
    await addContractDoc(gen.id);
    // Test env has no Microsoft Graph config, so the draft step itself fails
    // with 503 — proving the request got past the 400 contract gate.
    const res = await request(app).post(`/api/gens/${gen.id}/kickoff-email`).set(auth(u.token)).expect(503);
    expect(res.body.error).toMatch(/Email is not configured/);
    // Stamp must only be written on successful drafts.
    const { rows } = await pool.query('SELECT kickoff_email_drafted_at FROM generator_proposals WHERE id=$1', [gen.id]);
    expect(rows[0].kickoff_email_drafted_at).toBeNull();
  });

  it('award transition no longer auto-drafts (stamp stays null)', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGen(u.token);
    await request(app).patch(`/api/gens/${gen.id}/stage`).set(auth(u.token)).send({ stage: 'awarded' }).expect(200);
    const { rows } = await pool.query('SELECT kickoff_email_drafted_at, stage FROM generator_proposals WHERE id=$1', [gen.id]);
    expect(rows[0].stage).toBe('awarded');
    expect(rows[0].kickoff_email_drafted_at).toBeNull();
  });
});

describe('kickoff email by product type', () => {
  it('describes the charger job, not a generator, for an EV proposal', () => {
    const { subject, html } = buildAwardKickoffEmail({
      product_type: 'ev_charger',
      customer: 'Jane Homeowner',
      form_data: {
        city: 'Eustis', phone: '(352) 555-0100', email: 'jane@example.com', address: '12 Oak St',
        distanceTier: 'f16to25', panelUpgrade: true,
        customItems: [{ id: 'a', desc: 'Extra 40 ft of run', amount: 400, taxable: false }],
      },
      totals_data: { deposit: 0 },
    });

    expect(subject).toBe('New EV Charger Install - Jane Homeowner - Eustis');
    expect(html).toContain('customer-supplied Tesla Wall Connector');
    expect(html).toContain('16 to 25 feet');
    expect(html).toContain('service upgrade to 200A');
    expect(html).toContain('Extra 40 ft of run');
    // The generator body would otherwise emit "We will be installing a ." here.
    expect(html).not.toContain('SMM');
    expect(html).not.toContain('em-panel');
  });

  it('still builds the generator body for a generator proposal', () => {
    const { subject, html } = buildAwardKickoffEmail({
      product_type: 'generator',
      customer: 'John Buyer',
      mfr: 'Kohler',
      form_data: { brand: 'Kohler', size: '20KW', city: 'Tavares', atsQty: 1, atsSize: '200A', smmQty: 1, fuel: 'LP' },
      totals_data: { deposit: 7500 },
    });

    expect(subject).toBe('New Kohler Install - John Buyer - Tavares');
    expect(html).toContain('Kohler 20KW Generator');
    expect(html).toContain('SMM: Yes (1).');
    expect(html).toContain('deposit of $7,500');
  });

  it('treats a proposal with no product_type as a generator', () => {
    const { subject } = buildAwardKickoffEmail({
      customer: 'Legacy Row', mfr: 'Generac',
      form_data: { brand: 'Generac', size: '22KW', city: 'Mount Dora' },
      totals_data: {},
    });
    expect(subject).toBe('New Generac Install - Legacy Row - Mount Dora');
  });
});


describe('buildAwardKickoffEmail — install-only', () => {
  const gen = (form: Record<string, unknown>) => ({
    id: 'g1', customer: 'Pat Owner', mfr: 'Generac', form_data: { brand: 'Generac', size: '22KW', city: 'Eustis', atsQty: 1, atsSize: '200A', smmQty: 0, ...form },
    totals_data: { deposit: 1000 },
  });

  it('uses the install-only subject and lists the scope', () => {
    const { subject, html } = buildAwardKickoffEmail(gen({
      jobType: 'install-only',
      installOnly: { setGenerator: true, ats: 'customer-install', conduit: 'run', runFt: 40, gas: false, permit: true, unitDesc: 'Guardian 7043' },
    }));
    expect(subject).toBe('New Generac Install-Only (customer-furnished) - Pat Owner - Eustis');
    expect(html).toContain('Customer-furnished Generac 22KW Generator');
    expect(html).toContain('Set &amp; place the generator.');
    expect(html).toContain('Install the customer-furnished 200A ATS.');
    expect(html).toContain('Run conduit &amp; wire, generator to ATS (~40 ft).');
    expect(html).toContain('Gas by others.');
    expect(html).toContain('Permit: APT pulls it.');
    expect(html).toContain('Guardian 7043');
  });

  it('reports the other modes', () => {
    const { html } = buildAwardKickoffEmail(gen({
      jobType: 'install-only',
      installOnly: { setGenerator: false, ats: 'existing', conduit: 'wire-only', runFt: 25, gas: true, permit: false },
    }));
    expect(html).toContain('not setting it');
    expect(html).toContain('ATS is already installed.');
    expect(html).toContain('Pull wire through existing conduit (~25 ft).');
    expect(html).toContain('Gas connection at the generator is included.');
    expect(html).toContain('Permit: not included.');
  });

  it('leaves the new-install and swap-out emails unchanged', () => {
    expect(buildAwardKickoffEmail(gen({ jobType: 'new-install' })).subject).toBe('New Generac Install - Pat Owner - Eustis');
    const swap = buildAwardKickoffEmail(gen({ jobType: 'swap-out' }));
    expect(swap.subject).toBe('New Generac Install - Pat Owner - Eustis');
    expect(swap.html).toContain('Existing 200A ATS');
    expect(swap.html).not.toContain('customer-furnished');
  });
});
