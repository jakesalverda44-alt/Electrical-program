import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Real observed Bay to Bay Properties (via Procore) invitation — see intakeFormats.test.ts
// for the unit-level parser coverage of this same fixture. Here we exercise the full
// insert path: POST /api/intake/refresh -> ingestTaggedBidEmails() -> importOne().
const PROCORE_SUBJECT =
  '7-Eleven #42901 (REBID) - Tampa, FL: Invitation to bid on 7-Eleven #42901 (REBID) - Tampa, FL';
const PROCORE_BODY =
  '... Bid Due: Monday, September 14, 2026 at 03:00 pm Bay to Bay Properties 7-Eleven #42901 '
  + '(REBID) - Tampa, FL Invitation to Bid Estimating Department from Bay to Bay Properties has '
  + 'invited you to bid on project 7-Eleven #42901 (REBID) - Tampa, FL () . View in Procore '
  + 'Download Documents Bid Submission via ema...';
const PROCORE_BODY_HTML =
  '<html><body><p>' + PROCORE_BODY + '</p>'
  + '<a href="https://app.procore.com/invitations/778899">View in Procore</a> '
  + '<a href="https://app.procore.com/documents/downloads/445566"><span>Download</span> Documents</a>'
  + '</body></html>';

// Never let this test file hit Microsoft Graph over the network — mock only the two calls
// the ingest path makes, keep everything else (mapRaw, etc.) real.
vi.mock('../integrations/outlookMail', async () => {
  const actual = await vi.importActual<typeof import('../integrations/outlookMail')>(
    '../integrations/outlookMail'
  );
  return { ...actual, fetchTaggedBidEmails: vi.fn(), listAttachmentNames: vi.fn(async () => []) };
});

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { fetchTaggedBidEmails } from '../integrations/outlookMail';

const mockFetchTagged = fetchTaggedBidEmails as unknown as ReturnType<typeof vi.fn>;

describe('POST /api/intake/refresh — Procore format parser end-to-end', () => {
  it('ingests the Bay to Bay Properties fixture into a clean intake row', async (ctx) => {
    if (!(await dbAvailable())) return ctx.skip();
    const u = await makeUser('owner');
    const messageId = `procore-fixture-${Date.now()}`;
    const fromEmail = `bay_to_bay_properties_notifications+${Date.now()}@procoretech.com`;

    mockFetchTagged.mockResolvedValueOnce([{
      id: messageId,
      subject: PROCORE_SUBJECT,
      from: fromEmail,
      fromName: 'Estimating Department (Bay to Bay Properties, LLC)',
      receivedDateTime: new Date().toISOString(),
      bodyPreview: PROCORE_BODY.slice(0, 120),
      body: PROCORE_BODY,
      bodyHtml: PROCORE_BODY_HTML,
      webLink: 'https://outlook.office.com/mail/id/' + messageId,
      categories: ['new bid'],
      hasAttachments: false,
      isRead: false,
    }]);

    const res = await request(app).post('/api/intake/refresh').set(auth(u.token)).expect(200);
    expect(res.body.imported).toBe(1);

    const { rows } = await pool.query('SELECT * FROM intake_items WHERE graph_message_id=$1', [messageId]);
    expect(rows.length).toBe(1);
    const row = rows[0];

    expect(row.name).toBe('7-Eleven #42901 (REBID) - Tampa, FL');
    expect(row.gc).toBe('Bay to Bay Properties, LLC');
    expect(row.contact).toBeNull();
    expect(row.loc).toBe('Tampa, FL');
    expect(row.due).toBe('2026-09-14');
    expect(row.due_time).toBe('3:00 PM');
    expect(row.links).toEqual({
      procore: 'https://app.procore.com/invitations/778899',
      documents: 'https://app.procore.com/documents/downloads/445566',
    });
    expect(row.notes).toContain('bid due Monday, September 14, 2026 at 3:00 PM');
    expect(row.notes).toContain('Documents: link present');
    // The raw email snippet is preserved separately from the cleaned-up notes summary.
    expect(row.body_snippet).toContain('Bid Due: Monday, September 14, 2026');
  });

  it('never re-imports the same Graph message id (dedupe)', async (ctx) => {
    if (!(await dbAvailable())) return ctx.skip();
    const u = await makeUser('owner');
    const messageId = `procore-dedupe-${Date.now()}`;
    const msg = {
      id: messageId,
      subject: PROCORE_SUBJECT,
      from: `dedupe+${Date.now()}@procoretech.com`,
      fromName: 'Estimating Department (Bay to Bay Properties, LLC)',
      receivedDateTime: new Date().toISOString(),
      bodyPreview: PROCORE_BODY.slice(0, 120),
      body: PROCORE_BODY,
      bodyHtml: PROCORE_BODY_HTML,
      webLink: 'https://outlook.office.com/mail/id/' + messageId,
      categories: ['new bid'],
      hasAttachments: false,
      isRead: false,
    };

    mockFetchTagged.mockResolvedValueOnce([msg]);
    const first = await request(app).post('/api/intake/refresh').set(auth(u.token)).expect(200);
    expect(first.body.imported).toBe(1);

    mockFetchTagged.mockResolvedValueOnce([msg]);
    const second = await request(app).post('/api/intake/refresh').set(auth(u.token)).expect(200);
    expect(second.body.imported).toBe(0);

    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM intake_items WHERE graph_message_id=$1', [messageId]
    );
    expect(rows[0].n).toBe(1);
  });
});
