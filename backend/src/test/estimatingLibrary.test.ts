// Task 5 — /api/estimating/library: reads are requireAuth, writes are
// requireAdmin, editing an item/assembly/factor sets source='manual',
// deactivate is a soft flag (never a hard delete), and bad input is a 400.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('GET /api/estimating/library', () => {
  it('returns the seeded items, assemblies (with components) and factors to any authenticated user', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('salesperson');
    const res = await request(app).get('/api/estimating/library').set(auth(u.token)).expect(200);
    expect(res.body.items.length).toBeGreaterThan(100);
    expect(res.body.assemblies.length).toBeGreaterThan(30);
    expect(res.body.factors.length).toBeGreaterThan(0);
    const withComponents = res.body.assemblies.find((a: { components: unknown[] }) => a.components.length > 0);
    expect(withComponents).toBeTruthy();
  });

  it('rejects an unauthenticated request', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    await request(app).get('/api/estimating/library').expect(401);
  });
});

describe('POST/PUT /api/estimating/library/items — admin only', () => {
  it('a non-admin cannot create or edit an item', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const estimator = await makeUser('estimator');
    await request(app).post('/api/estimating/library/items').set(auth(estimator.token))
      .send({ code: `T-${Date.now()}`, name: 'Test', category: 'Branch Power', unit: 'EA', material_cost: 1, labor_hours: 0.1 })
      .expect(403);

    const owner = await makeUser('owner');
    const created = await request(app).post('/api/estimating/library/items').set(auth(owner.token))
      .send({ code: `T-${Date.now()}-2`, name: 'Test', category: 'Branch Power', unit: 'EA', material_cost: 1, labor_hours: 0.1 })
      .expect(200);
    await request(app).put(`/api/estimating/library/items/${created.body.id}`).set(auth(estimator.token))
      .send({ material_cost: 5 }).expect(403);
  });

  it('an admin can create an item (source=manual) and editing it keeps source=manual', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const owner = await makeUser('owner');
    const code = `T-${Date.now()}-3`;
    const created = await request(app).post('/api/estimating/library/items').set(auth(owner.token))
      .send({ code, name: 'Test Item', category: 'Branch Power', unit: 'EA', material_cost: 10, labor_hours: 0.5, aliases: ['test item'] })
      .expect(200);
    expect(created.body.source).toBe('manual');
    expect(created.body.material_price_date).toBeNull();

    const updated = await request(app).put(`/api/estimating/library/items/${created.body.id}`).set(auth(owner.token))
      .send({ material_cost: 12.5 }).expect(200);
    expect(updated.body.material_cost).toBe(12.5);
    expect(updated.body.source).toBe('manual');
  });

  it('editing a SEEDED item sets source=manual (Jake corrected a seed value)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const owner = await makeUser('owner');
    const lib = await request(app).get('/api/estimating/library').set(auth(owner.token)).expect(200);
    const seedItem = lib.body.items.find((i: { source: string }) => i.source === 'seed');
    expect(seedItem).toBeTruthy();

    const updated = await request(app).put(`/api/estimating/library/items/${seedItem.id}`).set(auth(owner.token))
      .send({ material_cost: 999.99 }).expect(200);
    expect(updated.body.source).toBe('manual');

    // Restore so this test doesn't leave permanent drift for later runs.
    await request(app).put(`/api/estimating/library/items/${seedItem.id}`).set(auth(owner.token))
      .send({ material_cost: seedItem.material_cost }).expect(200);
  });

  it('deactivating an item is a soft flag, not a delete — it can be reactivated', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const owner = await makeUser('owner');
    const created = await request(app).post('/api/estimating/library/items').set(auth(owner.token))
      .send({ code: `T-${Date.now()}-4`, name: 'Deactivate me', category: 'Branch Power', unit: 'EA', material_cost: 1, labor_hours: 0.1 })
      .expect(200);

    const deactivated = await request(app).put(`/api/estimating/library/items/${created.body.id}`).set(auth(owner.token))
      .send({ active: false }).expect(200);
    expect(deactivated.body.active).toBe(false);
    // Deactivate-only never touches source.
    expect(deactivated.body.source).toBe('manual');

    const lib = await request(app).get('/api/estimating/library').set(auth(owner.token)).expect(200);
    expect(lib.body.items.find((i: { id: string }) => i.id === created.body.id)).toBeTruthy();

    const reactivated = await request(app).put(`/api/estimating/library/items/${created.body.id}`).set(auth(owner.token))
      .send({ active: true }).expect(200);
    expect(reactivated.body.active).toBe(true);
  });

  it('rejects a bad unit with 400', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const owner = await makeUser('owner');
    await request(app).post('/api/estimating/library/items').set(auth(owner.token))
      .send({ code: `T-${Date.now()}-5`, name: 'Bad unit', category: 'Branch Power', unit: 'GAL', material_cost: 1, labor_hours: 0.1 })
      .expect(400);
  });

  it('rejects negative material_cost/labor_hours with 400', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const owner = await makeUser('owner');
    await request(app).post('/api/estimating/library/items').set(auth(owner.token))
      .send({ code: `T-${Date.now()}-6`, name: 'Bad hours', category: 'Branch Power', unit: 'EA', material_cost: 1, labor_hours: -1 })
      .expect(400);
  });
});

describe('POST/PUT /api/estimating/library/assemblies', () => {
  it('creates an assembly with components and returns the resolved component list', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const owner = await makeUser('owner');
    const lib = await request(app).get('/api/estimating/library').set(auth(owner.token)).expect(200);
    const item = lib.body.items[0];

    const created = await request(app).post('/api/estimating/library/assemblies').set(auth(owner.token))
      .send({
        code: `ASM-T-${Date.now()}`, name: 'Test Assembly', category: 'Branch Power', unit: 'EA',
        components: [{ item_id: item.id, qty_per: 2 }],
      }).expect(200);
    expect(created.body.components).toEqual([
      { item_id: item.id, item_code: item.code, item_name: item.name, qty_per: 2 },
    ]);

    const updated = await request(app).put(`/api/estimating/library/assemblies/${created.body.id}`).set(auth(owner.token))
      .send({ components: [{ item_id: item.id, qty_per: 3 }] }).expect(200);
    expect(updated.body.components[0].qty_per).toBe(3);
    expect(updated.body.source).toBe('manual');
  });

  it('rejects an assembly with no components with 400', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const owner = await makeUser('owner');
    await request(app).post('/api/estimating/library/assemblies').set(auth(owner.token))
      .send({ code: `ASM-BAD-${Date.now()}`, name: 'No components', category: 'Branch Power', unit: 'EA', components: [] })
      .expect(400);
  });
});

describe('POST/PUT /api/estimating/library/factors', () => {
  it('creates and edits a labor factor (admin only)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const owner = await makeUser('owner');
    const estimator = await makeUser('estimator');
    await request(app).post('/api/estimating/library/factors').set(auth(estimator.token))
      .send({ code: `FAC-${Date.now()}`, label: 'Test Factor', pct: 5, group_key: 'test' }).expect(403);

    const created = await request(app).post('/api/estimating/library/factors').set(auth(owner.token))
      .send({ code: `FAC-${Date.now()}-2`, label: 'Test Factor', pct: 5, group_key: 'test' }).expect(200);
    expect(created.body.pct).toBe(5);

    const updated = await request(app).put(`/api/estimating/library/factors/${created.body.id}`).set(auth(owner.token))
      .send({ pct: 8 }).expect(200);
    expect(updated.body.pct).toBe(8);
  });
});
