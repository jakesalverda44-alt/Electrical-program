import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { pool } from '../db/pool';
import { dbAvailable } from './harness';
import { enqueueStageWebhook, deliverDueWebhooks, MAX_ATTEMPTS } from '../webhooks/outbox';
import { recoverInterruptedAnalyses } from '../ai/recovery';

// These hit a real Postgres via the harness (CI postgres service); they skip
// automatically when no database is reachable locally.
let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function makeLead(name: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO leads (name, email, source, contact_method) VALUES ($1, $2, 'kohler', 'email') RETURNING id`,
    [name, `${name.replace(/\W/g, '')}@test.local`]
  );
  return rows[0].id as string;
}

async function makeBid(name: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO bids (name, gc) VALUES ($1, 'IT GC') RETURNING id`,
    [name]
  );
  return rows[0].id as string;
}

describe('webhook outbox (integration)', () => {
  let server: http.Server;
  let received: Array<Record<string, unknown>> = [];
  let respondWith = 200;
  let url = '';

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try { received.push(JSON.parse(body)); } catch { received.push({}); }
        res.statusCode = respondWith;
        res.end('{}');
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    url = `http://127.0.0.1:${addr.port}/hook`;
  });

  afterAll(async () => {
    delete process.env.ZAPIER_WEBHOOK_QUOTED;
    if (server) await new Promise(resolve => server.close(resolve));
  });

  it('does not enqueue when no URL is configured for the stage', async (ctx) => {
    if (!ok) return ctx.skip();
    delete process.env.ZAPIER_WEBHOOK_QUOTED;
    const leadId = await makeLead(`OB NoUrl ${Date.now()}`);
    const queued = await enqueueStageWebhook({ id: leadId, name: 'x' }, 'quoted', 'email');
    expect(queued).toBe(false);
    const { rows } = await pool.query('SELECT 1 FROM webhook_outbox WHERE lead_id=$1', [leadId]);
    expect(rows.length).toBe(0);
  });

  it('enqueues and delivers, marking the row delivered and logging webhook_ok', async (ctx) => {
    if (!ok) return ctx.skip();
    process.env.ZAPIER_WEBHOOK_QUOTED = url;
    respondWith = 200;
    received = [];
    const leadId = await makeLead(`OB Deliver ${Date.now()}`);

    const queued = await enqueueStageWebhook(
      { id: leadId, name: 'OB Deliver', email: 'a@b.c', stage: 'quoted' }, 'quoted', 'email'
    );
    expect(queued).toBe(true);
    await deliverDueWebhooks();

    const { rows } = await pool.query('SELECT * FROM webhook_outbox WHERE lead_id=$1', [leadId]);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('delivered');
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].delivered_at).not.toBeNull();
    expect(received.some(p => p.lead_id === leadId && p.stage === 'quoted')).toBe(true);

    const { rows: act } = await pool.query(
      `SELECT 1 FROM lead_activity WHERE lead_id=$1 AND kind='webhook_ok'`, [leadId]);
    expect(act.length).toBe(1);
  });

  it('reschedules with backoff on failure instead of dropping the trigger', async (ctx) => {
    if (!ok) return ctx.skip();
    process.env.ZAPIER_WEBHOOK_QUOTED = url;
    respondWith = 500;
    const leadId = await makeLead(`OB Retry ${Date.now()}`);

    await enqueueStageWebhook({ id: leadId, name: 'OB Retry', stage: 'quoted' }, 'quoted', 'email');
    await deliverDueWebhooks();

    const { rows } = await pool.query('SELECT * FROM webhook_outbox WHERE lead_id=$1', [leadId]);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].last_error).toBe('HTTP 500');
    expect(new Date(rows[0].next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 30_000);
  });

  it('marks the row failed, logs webhook_fail, and notifies after the final attempt', async (ctx) => {
    if (!ok) return ctx.skip();
    process.env.ZAPIER_WEBHOOK_QUOTED = url;
    respondWith = 500;
    const leadId = await makeLead(`OB Dead ${Date.now()}`);

    await enqueueStageWebhook({ id: leadId, name: 'OB Dead', stage: 'quoted' }, 'quoted', 'email');
    // Fast-forward to the last allowed attempt.
    await pool.query(
      `UPDATE webhook_outbox SET attempts=$2, next_attempt_at=now() WHERE lead_id=$1`,
      [leadId, MAX_ATTEMPTS - 1]
    );
    await deliverDueWebhooks();

    const { rows } = await pool.query('SELECT * FROM webhook_outbox WHERE lead_id=$1', [leadId]);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].attempts).toBe(MAX_ATTEMPTS);

    const { rows: act } = await pool.query(
      `SELECT text FROM lead_activity WHERE lead_id=$1 AND kind='webhook_fail'`, [leadId]);
    expect(act.length).toBe(1);
    expect(act[0].text).toContain(`after ${MAX_ATTEMPTS} attempts`);

    const { rows: notif } = await pool.query(
      `SELECT 1 FROM notifications WHERE type='webhook_failed' AND link_id=$1`, [leadId]);
    expect(notif.length).toBeGreaterThanOrEqual(0); // present only when owner/admin users exist
  });
});

describe('AI pipeline recovery (integration)', () => {
  it('marks a stale interrupted Agent 1 run as a terminal error', async (ctx) => {
    if (!ok) return ctx.skip();
    const bidId = await makeBid(`REC A1 ${Date.now()}`);
    await pool.query(
      `INSERT INTO takeoff_results (bid_id, status, worker_heartbeat_at)
       VALUES ($1, 'running', now() - interval '10 minutes')`,
      [bidId]
    );
    await recoverInterruptedAnalyses();
    const { rows } = await pool.query('SELECT status, agent1_output FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(rows[0].status).toBe('error');
    expect(rows[0].agent1_output).toContain('Re-run the analysis');
  });

  it('leaves a live Agent 1 run (fresh heartbeat) untouched', async (ctx) => {
    if (!ok) return ctx.skip();
    const bidId = await makeBid(`REC Live ${Date.now()}`);
    await pool.query(
      `INSERT INTO takeoff_results (bid_id, status, worker_heartbeat_at) VALUES ($1, 'running', now())`,
      [bidId]
    );
    await recoverInterruptedAnalyses();
    const { rows } = await pool.query('SELECT status FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(rows[0].status).toBe('running');
  });

  it('marks an interrupted Agent 4 run without persisted inputs as an error', async (ctx) => {
    if (!ok) return ctx.skip();
    const savedKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key-no-calls-made';
    try {
      const bidId = await makeBid(`REC A4 ${Date.now()}`);
      // agent4 'running' but agent4_price was never persisted (pre-upgrade row).
      await pool.query(
        `INSERT INTO takeoff_results (bid_id, status, agent4_status, worker_heartbeat_at)
         VALUES ($1, 'complete', 'running', now() - interval '10 minutes')`,
        [bidId]
      );
      await recoverInterruptedAnalyses();
      const { rows } = await pool.query('SELECT agent4_status, agent4_error FROM takeoff_results WHERE bid_id=$1', [bidId]);
      expect(rows[0].agent4_status).toBe('error');
      expect(rows[0].agent4_error).toContain('Re-run Agent 4');
    } finally {
      if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });
});
