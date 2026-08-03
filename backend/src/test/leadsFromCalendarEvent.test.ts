import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Mock only fetchEventDetail — never let this test file hit Microsoft Graph over the
// network, regardless of whether GRAPH_* env vars happen to be configured.
vi.mock('../integrations/outlookCalendar', async () => {
  const actual = await vi.importActual<typeof import('../integrations/outlookCalendar')>(
    '../integrations/outlookCalendar'
  );
  return { ...actual, fetchEventDetail: vi.fn() };
});

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { fetchEventDetail } from '../integrations/outlookCalendar';

const mockFetchDetail = fetchEventDetail as unknown as ReturnType<typeof vi.fn>;

describe('POST /api/leads/from-calendar-event', () => {
  it('rejects unauthenticated callers', async () => {
    await request(app).post('/api/leads/from-calendar-event').send({ eventId: 'x' }).expect(401);
  });

  it('second call with the same eventId returns the first lead and inserts nothing', async (ctx) => {
    if (!(await dbAvailable())) return ctx.skip();
    const u = await makeUser('owner');
    const eventId = `evt-dedupe-${Date.now()}`;

    const { rows } = await pool.query(
      `INSERT INTO leads (name, stage, source, outlook_event_id) VALUES ($1,'site-scheduled','other',$2) RETURNING id`,
      [`Dedupe lead ${Date.now()}`, eventId]
    );
    const leadId = rows[0].id as string;

    const res = await request(app).post('/api/leads/from-calendar-event').set(auth(u.token))
      .send({ eventId }).expect(200);

    expect(res.body.created).toBe(false);
    expect(res.body.lead.id).toBe(leadId);
    expect(mockFetchDetail).not.toHaveBeenCalled();

    const { rows: count } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM leads WHERE outlook_event_id=$1', [eventId]
    );
    expect(count[0].n).toBe(1);
  });

  it('404s when the calendar event does not exist', async (ctx) => {
    if (!(await dbAvailable())) return ctx.skip();
    const u = await makeUser('owner');
    mockFetchDetail.mockResolvedValueOnce(null);

    const res = await request(app).post('/api/leads/from-calendar-event').set(auth(u.token))
      .send({ eventId: `evt-missing-${Date.now()}` }).expect(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('400s when eventId is missing from the body', async (ctx) => {
    if (!(await dbAvailable())) return ctx.skip();
    const u = await makeUser('owner');
    await request(app).post('/api/leads/from-calendar-event').set(auth(u.token)).send({}).expect(400);
  });

  it('creates a lead from event detail via the plain mapping — no LLM on this path', async (ctx) => {
    if (!(await dbAvailable())) return ctx.skip();
    const u = await makeUser('owner');
    const eventId = `evt-create-${Date.now()}`;
    mockFetchDetail.mockResolvedValueOnce({
      subject: 'Smith Generator Install',
      location: '123 Main St',
      attendees: [
        { name: 'Jake S', email: 'JakeS@accuratepowerandtechnology.com' },
        { name: 'John Smith', email: 'john@example.com' },
      ],
      bodyText: 'Bring the sizer report',
      start: '2026-08-10T14:00:00Z',
    });

    const res = await request(app).post('/api/leads/from-calendar-event').set(auth(u.token))
      .send({ eventId }).expect(201);

    expect(res.body.created).toBe(true);
    const lead = res.body.lead;
    expect(lead.name).toBe('Smith Generator Install');
    expect(lead.address).toBe('123 Main St');
    expect(lead.email).toBe('john@example.com');
    expect(lead.notes).toContain('John Smith');
    expect(lead.notes).toContain('Bring the sizer report');
    expect(lead.stage).toBe('site-scheduled');
    expect(lead.source).toBe('other');
    expect(lead.outlook_event_id).toBe(eventId);
    expect(lead.salesperson_id).toBe(u.id);
  });

  it('maps an event with a blank subject, no location, no body, and no attendees without throwing', async (ctx) => {
    if (!(await dbAvailable())) return ctx.skip();
    const u = await makeUser('owner');
    const eventId = `evt-sparse-${Date.now()}`;
    mockFetchDetail.mockResolvedValueOnce({
      subject: '', location: null, attendees: [], bodyText: null, start: null,
    });

    const res = await request(app).post('/api/leads/from-calendar-event').set(auth(u.token))
      .send({ eventId }).expect(201);

    expect(res.body.lead.name).toMatch(/^Untitled appointment — /);
    expect(res.body.lead.address).toBeNull();
    expect(res.body.lead.email).toBeNull();
  });
});

describe('POST /api/leads/blank-survey', () => {
  it('rejects unauthenticated callers', async () => {
    await request(app).post('/api/leads/blank-survey').expect(401);
  });

  it('creates a lead named "Walk-up — {today}" with stage new and source other', async (ctx) => {
    if (!(await dbAvailable())) return ctx.skip();
    const u = await makeUser('owner');
    const res = await request(app).post('/api/leads/blank-survey').set(auth(u.token)).expect(201);

    expect(res.body.name).toMatch(/^Walk-up — /);
    expect(res.body.stage).toBe('new');
    expect(res.body.source).toBe('other');
    expect(res.body.salesperson_id).toBe(u.id);
    expect(res.body.salesperson_name).toBe(u.name);
  });
});
