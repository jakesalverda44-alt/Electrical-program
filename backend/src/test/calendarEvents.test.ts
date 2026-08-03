import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Mock only fetchUpcomingEvents — never let this test file hit Microsoft Graph over
// the network, regardless of whether GRAPH_* env vars happen to be configured.
vi.mock('../integrations/outlookCalendar', async () => {
  const actual = await vi.importActual<typeof import('../integrations/outlookCalendar')>(
    '../integrations/outlookCalendar'
  );
  return { ...actual, fetchUpcomingEvents: vi.fn() };
});

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { fetchUpcomingEvents } from '../integrations/outlookCalendar';

const mockFetchUpcoming = fetchUpcomingEvents as unknown as ReturnType<typeof vi.fn>;

describe('GET /api/calendar/events', () => {
  it('rejects unauthenticated callers', async () => {
    await request(app).get('/api/calendar/events').expect(401);
  });

  it('annotates each event with linkedLeadId, resolved in one query, null when no lead exists', async (ctx) => {
    if (!(await dbAvailable())) return ctx.skip();
    const u = await makeUser('owner');
    const linkedEventId = `evt-linked-${Date.now()}`;
    const unlinkedEventId = `evt-unlinked-${Date.now()}`;

    mockFetchUpcoming.mockResolvedValueOnce([
      { id: linkedEventId, subject: 'Linked', start: '', end: '', location: null, webLink: null, isAllDay: false, attendees: [] },
      { id: unlinkedEventId, subject: 'Unlinked', start: '', end: '', location: null, webLink: null, isAllDay: false, attendees: [] },
    ]);

    const { rows } = await pool.query(
      `INSERT INTO leads (name, stage, source, outlook_event_id) VALUES ($1,'site-scheduled','other',$2) RETURNING id`,
      [`Linked lead ${Date.now()}`, linkedEventId]
    );
    const leadId = rows[0].id as string;

    const res = await request(app).get('/api/calendar/events').set(auth(u.token)).expect(200);
    const linked = res.body.find((e: { id: string }) => e.id === linkedEventId);
    const unlinked = res.body.find((e: { id: string }) => e.id === unlinkedEventId);

    expect(linked.linkedLeadId).toBe(leadId);
    expect(unlinked.linkedLeadId).toBeNull();
  });

  it('returns an empty list without erroring when Graph returns nothing', async (ctx) => {
    if (!(await dbAvailable())) return ctx.skip();
    const u = await makeUser('owner');
    mockFetchUpcoming.mockResolvedValueOnce([]);
    const res = await request(app).get('/api/calendar/events').set(auth(u.token)).expect(200);
    expect(res.body).toEqual([]);
  });
});
