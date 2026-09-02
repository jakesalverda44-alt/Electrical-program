import { describe, it, expect } from 'vitest';
import { detectFormat, parseProcore } from './intakeFormats';
import { GraphMailMessage } from './outlookMail';

// Real observed Bay to Bay Properties (via Procore) invitation — the highest-volume sender
// hitting the Intake Inbox. Subject/body text captured verbatim (see the 2026-09-02 plan).
const PROCORE_SUBJECT =
  '7-Eleven #42901 (REBID) - Tampa, FL: Invitation to bid on 7-Eleven #42901 (REBID) - Tampa, FL';
const PROCORE_BODY =
  '... Bid Due: Monday, September 14, 2026 at 03:00 pm Bay to Bay Properties 7-Eleven #42901 '
  + '(REBID) - Tampa, FL Invitation to Bid Estimating Department from Bay to Bay Properties has '
  + 'invited you to bid on project 7-Eleven #42901 (REBID) - Tampa, FL () . View in Procore '
  + 'Download Documents Bid Submission via ema...';
// Small synthetic HTML carrying the two links the plain-text body loses (toPlainText() in
// outlookMail.ts strips all markup — bodyHtml is the only place these survive).
const PROCORE_BODY_HTML =
  '<html><body><p>' + PROCORE_BODY + '</p>'
  + '<a href="https://app.procore.com/invitations/778899">View in Procore</a> '
  + '<a href="https://app.procore.com/documents/downloads/445566"><span>Download</span> Documents</a>'
  + '</body></html>';

function procoreMsg(overrides: Partial<GraphMailMessage> = {}): GraphMailMessage {
  return {
    id: 'msg-procore-1',
    subject: PROCORE_SUBJECT,
    from: 'bay_to_bay_properties_notifications@procoretech.com',
    fromName: 'Estimating Department (Bay to Bay Properties, LLC)',
    receivedDateTime: '2026-08-20T14:00:00Z',
    bodyPreview: PROCORE_BODY.slice(0, 120),
    body: PROCORE_BODY,
    bodyHtml: PROCORE_BODY_HTML,
    webLink: 'https://outlook.office.com/mail/id/msg-procore-1',
    categories: ['new bid'],
    hasAttachments: true,
    isRead: false,
    ...overrides,
  };
}

describe('detectFormat', () => {
  it('recognizes a procoretech.com relay sender', () => {
    expect(detectFormat(procoreMsg())).toBe('procore');
  });

  it('recognizes a procore.com sender', () => {
    expect(detectFormat(procoreMsg({ from: 'notify@procore.com' }))).toBe('procore');
  });

  it('recognizes the "View in Procore" body cue even off the known relay domains', () => {
    expect(detectFormat(procoreMsg({ from: 'estimating@somegc.com' }))).toBe('procore');
  });

  it('returns null for an unrelated (Kingdom-style) email', () => {
    expect(detectFormat({
      from: 'ian@kingdomconstruction.org',
      body: 'Invitation to Bid from Kingdom Construction for Alachua County. BID DUE DATE: 07/17/2026',
      bodyHtml: null,
    })).toBeNull();
  });
});

describe('parseProcore — Bay to Bay Properties fixture', () => {
  const parsed = parseProcore(procoreMsg());

  it('strips the duplicated suffix invitation phrase from the subject', () => {
    expect(parsed.name).toBe('7-Eleven #42901 (REBID) - Tampa, FL');
  });

  it('unwraps the junk-wrapped sender display name to the legal GC name', () => {
    // Verified by running extractCandidates() on the fixture's fromName — the parenthetical
    // "Bay to Bay Properties, LLC" wins over the junk "Estimating Department" wrapper.
    expect(parsed.gc).toBe('Bay to Bay Properties, LLC');
  });

  it('never treats the procoretech.com relay address as a contact', () => {
    expect(parsed.contact).toBeNull();
  });

  it('reads the due date and time', () => {
    expect(parsed.due).toBe('2026-09-14');
    expect(parsed.dueTime).toBe('3:00 PM');
  });

  it('derives the location from the cleaned project name', () => {
    expect(parsed.loc).toBe('Tampa, FL');
  });

  it('captures both the View in Procore and Download Documents links, entity-decoded', () => {
    expect(parsed.links.procore).toBe('https://app.procore.com/invitations/778899');
    expect(parsed.links.documents).toBe('https://app.procore.com/documents/downloads/445566');
  });

  it('builds a one-line notes summary', () => {
    expect(parsed.summary).toContain('bid due Monday, September 14, 2026 at 3:00 PM');
    expect(parsed.summary).toContain('Documents: link present');
  });
});

describe('parseProcore — resilience', () => {
  it('returns nulls gracefully when the body has none of the expected fields', () => {
    const msg = procoreMsg({
      subject: 'Some other subject with no cut phrase',
      body: 'Nothing useful here.',
      bodyHtml: null,
      fromName: null,
    });
    const parsed = parseProcore(msg);
    expect(parsed.due).toBeNull();
    expect(parsed.dueTime).toBeNull();
    expect(parsed.links).toEqual({});
    expect(parsed.contact).toBeNull();
  });

  it('does not capture a relative or javascript: href as a link', () => {
    const msg = procoreMsg({
      bodyHtml: '<a href="/relative">View in Procore</a> <a href="javascript:void(0)">Download Documents</a>',
    });
    const parsed = parseProcore(msg);
    expect(parsed.links.procore).toBeUndefined();
    expect(parsed.links.documents).toBeUndefined();
  });

  it('picks up a non-relay email in the body as the contact when one is present', () => {
    const msg = procoreMsg({
      body: PROCORE_BODY + ' Questions? Contact john@baytobayproperties.com for details.',
    });
    expect(parseProcore(msg).contact).toBe('john@baytobayproperties.com');
  });
});
