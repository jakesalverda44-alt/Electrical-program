// Takeoff accuracy Task 1 — stop_reason 'max_tokens' fails the run with an
// estimator-facing message (Decision 9), driven through the REAL runPipeline
// with a fake Anthropic client (no network), plus the settings round-trip for
// the new counter keys and the previously-dropped ai_prep_* keys.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { pool } from '../db/pool';
import { app } from '../index';
import { dbAvailable, makeUser, auth } from './harness';
import { fakeAnthropic, systemText } from './fixtures/takeoff/fakeAnthropic';
import { runPipeline, loadAIConfig } from '../routes/preconstruction';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function makeBid(): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO bids (name, gc, loc) VALUES ($1, 'Summit General Contractors', 'Kissimmee, FL') RETURNING id`,
    [`Truncation ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`]
  );
  await pool.query(`INSERT INTO takeoff_results (bid_id, status) VALUES ($1, 'running')`, [rows[0].id]);
  return rows[0].id as string;
}

async function imageFile(name: string): Promise<Express.Multer.File> {
  const buf = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  return { originalname: name, buffer: buf, mimetype: 'image/jpeg', size: buf.length } as Express.Multer.File;
}

const AGENT1_OK = JSON.stringify({
  project: { name: 'AutoZone', sheets: ['E-3'] }, service: {}, panels: [{ name: 'LP', amps: 225 }],
  equipment: [], quantities: [{ category: 'Branch Power', item: 'Duplex', qty: 4, unit: 'EA', sourceSheet: 'E-3', confidence: 'VERIFIED' }],
  allowances: [], ecfeciItems: [], flags: [], scopeNotes: [], missingSheets: [],
});

describe('runPipeline — max_tokens fails the run (no silent truncation)', () => {
  it('Agent 1 truncated -> status error with "Agent 1 ran out of room"', async (ctx) => {
    if (!ok) return ctx.skip();
    const bidId = await makeBid();
    const { client } = fakeAnthropic(() => ({ text: '{"project":{"name":"Auto', stop_reason: 'max_tokens' }));
    const config = await loadAIConfig();
    await runPipeline(bidId, [await imageFile('E-3 Lighting Plan.jpg')], client, config);
    const { rows } = await pool.query('SELECT status, agent1_output FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(rows[0].status).toBe('error');
    expect(rows[0].agent1_output).toMatch(/^Agent 1 ran out of room — raise its Max Tokens in Settings → AI; it stopped at [\d,]+ tokens\.$/);
  });

  it('Agent 2 truncated -> status error with "Agent 2 ran out of room"', async (ctx) => {
    if (!ok) return ctx.skip();
    const bidId = await makeBid();
    const { client, calls } = fakeAnthropic((req) => {
      const sys = systemText(req);
      if (sys.includes('Senior Electrical Drawing Analyzer')) return { text: AGENT1_OK };
      if (sys.includes('Senior Electrical Estimator')) return { text: '{"scopeOfWork":{', stop_reason: 'max_tokens' };
      return { text: '{}' };
    });
    const config = await loadAIConfig();
    await runPipeline(bidId, [await imageFile('E-3 Lighting Plan.jpg')], client, config);
    const { rows } = await pool.query('SELECT status, agent2_output FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(rows[0].status).toBe('error');
    expect(rows[0].agent2_output).toMatch(/^Agent 2 ran out of room/);
    // Agent 3 never ran after the failure.
    expect(calls.some(c => systemText(c).includes('Chief Electrical Estimator'))).toBe(false);
  });
});

describe('runPipeline — every agent call streams (SDK refuses non-streaming above ~21,333 max_tokens)', () => {
  it('Agents 1-3 with 32,000 Max Tokens all complete over messages.stream', async (ctx) => {
    if (!ok) return ctx.skip();
    const bidId = await makeBid();
    const { client, paths, calls } = fakeAnthropic((req) => {
      const sys = systemText(req);
      if (sys.includes('Senior Electrical Drawing Analyzer')) return { text: AGENT1_OK };
      if (sys.includes('Senior Electrical Estimator')) return { text: '{"takeoff":[]}' };
      return { text: '{"overallRisk":"LOW"}' };
    });
    const config = { ...(await loadAIConfig()), maxTokensA1: 32000, maxTokensA2: 32000, maxTokensA3: 32000 };
    await runPipeline(bidId, [await imageFile('E-3 Lighting Plan.jpg')], client, config);
    const { rows } = await pool.query('SELECT status FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(rows[0].status).toBe('complete');
    expect(paths.length).toBe(calls.length);
    expect(new Set(paths)).toEqual(new Set(['stream']));
    expect(calls.map(c => c.max_tokens)).toEqual([32000, 32000, 32000]);
  });
});

describe('Settings — counter keys and ai_prep_* persist', () => {
  it('PUT then GET round-trips ai_takeoff_counter_model / ai_max_tokens_counter / ai_prep_dpi_plan', async (ctx) => {
    if (!ok) return ctx.skip();
    const admin = await makeUser('owner');
    const before = await request(app).get('/api/settings').set(auth(admin.token)).expect(200);
    const prev = Object.fromEntries((before.body as { key: string; value: string }[]).map(r => [r.key, r.value]));
    // Migration 112's insert-if-absent seed.
    expect(prev.ai_takeoff_counter_model).toBeDefined();
    try {
      await request(app).put('/api/settings').set(auth(admin.token))
        .send({ ai_takeoff_counter_model: 'claude-opus-5', ai_max_tokens_counter: '40000', ai_prep_dpi_plan: '150' })
        .expect(200);
      const res = await request(app).get('/api/settings').set(auth(admin.token)).expect(200);
      const byKey = Object.fromEntries((res.body as { key: string; value: string }[]).map(r => [r.key, r.value]));
      expect(byKey.ai_takeoff_counter_model).toBe('claude-opus-5');
      expect(byKey.ai_max_tokens_counter).toBe('40000');
      expect(byKey.ai_prep_dpi_plan).toBe('150');
      const cfg = await loadAIConfig();
      expect(cfg.modelCounter).toBe('claude-opus-5');
      expect(cfg.maxTokensCounter).toBe(40000);
    } finally {
      await request(app).put('/api/settings').set(auth(admin.token))
        .send({ ai_takeoff_counter_model: prev.ai_takeoff_counter_model ?? 'claude-opus-5-5', ai_max_tokens_counter: prev.ai_max_tokens_counter ?? '32000', ai_prep_dpi_plan: prev.ai_prep_dpi_plan ?? '' })
        .expect(200);
    }
  });
});
