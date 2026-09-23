// Takeoff accuracy Task 1 follow-up — the live AutoZone Agent 4 failure
// ("AI response could not be parsed as valid JSON", log showed only a
// 300-char preview). The failure path now reports stop_reason, output tokens
// and the TAIL of the reply; max_tokens gets "raise Max Tokens"; and a reply
// whose JSON contains ``` inside a string, or whose fence is never closed,
// now parses.
//
// The Anthropic SDK is replaced by a fake for this file (no network); the
// API-key lookup is stubbed so the route reaches it. getSetting is mocked
// per-file — nothing here touches process.env or the real key.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

const reply = { text: '', stop_reason: 'end_turn', output_tokens: 7912 };
const seen: Array<{ path: 'create' | 'stream'; max_tokens: number }> = [];
vi.mock('@anthropic-ai/sdk', () => {
  const message = () => ({
    id: 'fake', type: 'message', role: 'assistant', model: 'fake',
    content: [{ type: 'text', text: reply.text }],
    stop_reason: reply.stop_reason, stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: reply.output_tokens },
  });
  return {
    default: class FakeAnthropic {
      messages = {
        // Same rule as the real SDK 0.100.x: a non-streaming call with a
        // budget that may exceed 10 minutes is refused outright.
        create: async (req: { max_tokens: number }) => {
          seen.push({ path: 'create', max_tokens: req.max_tokens });
          if (req.max_tokens > 21_333) throw new Error('Streaming is required for operations that may take longer than 10 minutes.');
          return message();
        },
        stream: (req: { max_tokens: number }) => ({
          finalMessage: async () => { seen.push({ path: 'stream', max_tokens: req.max_tokens }); return message(); },
        }),
      };
    },
  };
});
vi.mock('../db/getSetting', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/getSetting')>();
  return {
    ...actual,
    getSetting: async (key: string) => {
      if (key === 'ai_anthropic_key') return 'sk-test-not-a-real-key';
      // The live setting that broke non-streaming Agent 4.
      if (key === 'ai_max_tokens_agent4') return '32000';
      return actual.getSetting(key);
    },
  };
});

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function setup(): Promise<{ user: TestUser; bidId: string }> {
  const user = await makeUser('owner');
  const { rows } = await pool.query(
    `INSERT INTO bids (name, gc, loc, salesperson_id) VALUES ($1, 'Summit General Contractors', 'Kissimmee, FL', $2) RETURNING id`,
    [`A4Fail ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]
  );
  await pool.query(
    `INSERT INTO takeoff_results (bid_id, status, agent1_output, agent2_output) VALUES ($1,'complete','{}','{"takeoff":[]}')`,
    [rows[0].id]
  );
  return { user, bidId: rows[0].id as string };
}

async function runAndWait(user: TestUser, bidId: string) {
  await request(app).post(`/api/preconstruction/${bidId}/run-agent4`).set(auth(user.token)).send({ price: '79112.23' }).expect(200);
  for (let i = 0; i < 100; i++) {
    const { rows } = await pool.query('SELECT agent4_status, agent4_error, agent4_output FROM takeoff_results WHERE bid_id=$1', [bidId]);
    if (rows[0].agent4_status !== 'running') return rows[0];
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error('agent4 never finished');
}

describe('Agent 4 failure reporting', () => {
  it('an unparseable reply reports stop_reason, output tokens and the END of the text', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await setup();
    reply.text = '```json\n{ "plan_date": "February 7, 2025", "sheets": [ "E-1", "E-2", "E-3"  ] , "sections": [ { "title": "A. Service & Distribution", "bullets": [ "Furnish';
    reply.stop_reason = 'end_turn';
    const row = await runAndWait(user, bidId);
    expect(row.agent4_status).toBe('error');
    expect(row.agent4_error).toMatch(/^AI response could not be parsed as valid JSON \(stop_reason: end_turn, 7912 of \d+ output tokens, \d+ characters\)\. Try re-running Agent 4\. End of the response: …/);
    expect(row.agent4_error).toContain('"bullets": [ "Furnish');
  });

  it('a max_tokens stop says to raise Max Tokens', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await setup();
    reply.text = '```json\n{ "plan_date": "x"';
    reply.stop_reason = 'max_tokens';
    const row = await runAndWait(user, bidId);
    expect(row.agent4_status).toBe('error');
    expect(row.agent4_error).toMatch(/^Agent 4 ran out of room — raise its Max Tokens in Settings → AI/);
  });

  it('a reply with ``` inside a string value and no closing fence now parses and completes', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await setup();
    reply.text = '```json\n{ "plan_date": "February 7, 2025", "sheets": ["E-1"], "sections": [ { "title": "A. Service & Distribution", "bullets": ["See ```E-2``` note"] } ], "exclusions": [], "allowances_bullets": [], "fixture_types": [], "takeoff": [], "alternates": [], "takeoff_notes": [] }\n';
    reply.stop_reason = 'end_turn';
    const row = await runAndWait(user, bidId);
    expect(row.agent4_error).toBeNull();
    expect(row.agent4_status).toBe('complete');
    expect(JSON.parse(row.agent4_output).sections[0].bullets[0]).toBe('See ```E-2``` note');
  });

  it('Max Tokens 32,000 goes through the STREAMING path (the SDK refuses it non-streaming)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await setup();
    seen.length = 0;
    reply.text = '{"sections":[],"takeoff":[]}';
    reply.stop_reason = 'end_turn';
    const row = await runAndWait(user, bidId);
    expect(row.agent4_status).toBe('complete');
    expect(seen).toEqual([{ path: 'stream', max_tokens: 32000 }]);
  });
});
