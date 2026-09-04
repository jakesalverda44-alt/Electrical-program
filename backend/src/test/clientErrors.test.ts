// Audit: frontend-code #15 (Medium) / Task 9 — the browser had nowhere to send
// a failure. `console` appears exactly twice in non-test frontend code, so a
// production error left no trace in the UI, the console, or on a server. This
// route is the sink: authenticated, rate limited, size capped, log-only.
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { logger } from '../utils/logger';
import { dbAvailable, makeUser, auth, TestUser } from './harness';

let ok = false;
let user: TestUser;
beforeAll(async () => {
  ok = await dbAvailable();
  if (ok) user = await makeUser('salesperson');
}, 30_000);

afterEach(() => { vi.restoreAllMocks(); });

const REPORT = {
  message: "Cannot read properties of undefined (reading 'map')",
  stack: 'Error: boom\n    at ProposalPreview (ProposalPreview.tsx:88:12)',
  context: 'ErrorBoundary (page)',
  url: 'https://crm.example.com/bid/abc',
  userAgent: 'Mozilla/5.0 (Macintosh)',
};

describe('POST /api/client-errors', () => {
  it('rejects an unauthenticated report with 401', async () => {
    const res = await request(app).post('/api/client-errors').send(REPORT);
    expect(res.status).toBe(401);
  });

  it('rejects a token that is not a real JWT with 401', async () => {
    const res = await request(app)
      .post('/api/client-errors')
      .set({ Authorization: 'Bearer not-a-token' })
      .send(REPORT);
    expect(res.status).toBe(401);
  });

  it('accepts a well-formed report and logs one warn line without storing it', async (ctx) => {
    if (!ok) return ctx.skip();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    const res = await request(app).post('/api/client-errors').set(auth(user.token)).send(REPORT);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    const [fields, msg] = warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(msg).toBe('client error');
    expect(fields.user).toBe(user.id);
    expect(fields.context).toBe('ErrorBoundary (page)');
    expect(fields.message).toBe(REPORT.message);
  });

  it('rejects a body over the 8 KB cap with 413', async (ctx) => {
    if (!ok) return ctx.skip();
    const res = await request(app)
      .post('/api/client-errors')
      .set(auth(user.token))
      .send({ ...REPORT, stack: 'y'.repeat(9_000) });

    expect(res.status).toBe(413);
    expect(res.body.error).toBe('Error report too large');
  });

  it('rejects a report with no message with 400', async (ctx) => {
    if (!ok) return ctx.skip();
    const res = await request(app)
      .post('/api/client-errors')
      .set(auth(user.token))
      .send({ context: 'nothing to say' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message/);
  });

  it('logs at most the first 2 KB of a long stack', async (ctx) => {
    if (!ok) return ctx.skip();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    // Under the 8 KB body cap, over the 2 KB log cap.
    const res = await request(app)
      .post('/api/client-errors')
      .set(auth(user.token))
      .send({ message: 'long stack', stack: 'z'.repeat(5_000) });

    expect(res.status).toBe(204);
    const [fields] = warn.mock.calls[0] as [Record<string, unknown>];
    expect((fields.stack as string).length).toBe(2_000);
  });
});
