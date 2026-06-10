import { describe, it, expect } from 'vitest';
import { isKohlerNotification } from '../integrations/outlookMail';
import { composeBullets, composeDaySummary, BriefPayload } from './brief';

describe('isKohlerNotification', () => {
  it('matches a Kohler sender address (case-insensitive)', () => {
    expect(isKohlerNotification({ from: 'noreply@KohlerLeads.com' })).toBe(true);
    expect(isKohlerNotification({ from: 'leads@kohler.com' })).toBe(true);
  });
  it('ignores non-Kohler senders and empty from', () => {
    expect(isKohlerNotification({ from: 'pm@summitgc.com' })).toBe(false);
    expect(isKohlerNotification({ from: null })).toBe(false);
  });
});

const base: Omit<BriefPayload, 'briefBullets'> = {
  generatedAt: '', graphEnabled: true,
  kpis: { activeBids: 0, activeBidsValue: 0, activeGens: 0, activeGensValue: 0, wonThisMonth: 0, wonThisMonthValue: 0, leadsNeedingCall: 0, unreadEmails: 0 },
  attention: [], kohlerFunnel: { received: 0, notAccepted: 0, accepted: 0, replied: 0, needCall: 0, newToday: 0, newYesterday: 0 },
  intake: { unread: 0, newToday: 0, newYesterday: 0 }, todayEvents: [], daySummary: '',
};

describe('composeBullets', () => {
  it('summarizes the Kohler funnel and unread emails', () => {
    const bullets = composeBullets({
      ...base,
      kpis: { ...base.kpis, unreadEmails: 4, wonThisMonthValue: 986760 },
      kohlerFunnel: { received: 14, notAccepted: 1, accepted: 9, replied: 4, needCall: 3, newToday: 0, newYesterday: 2 },
    });
    expect(bullets.some(b => /2 new Kohler leads came in yesterday/.test(b))).toBe(true);
    expect(bullets.some(b => /14 Kohler leads received this month — 1 not yet accepted/.test(b))).toBe(true);
    expect(bullets.some(b => /3 leads waiting on a call/.test(b))).toBe(true);
    expect(bullets.some(b => /4 Kohler leads replied/.test(b))).toBe(true);
    expect(bullets.some(b => /4 unread emails/.test(b))).toBe(true);
    expect(bullets.some(b => /\$986,760 won this month/.test(b))).toBe(true);
  });

  it('falls back to an all-clear line when nothing is pending', () => {
    expect(composeBullets(base)).toEqual(['All clear — nothing needs you right now.']);
  });

  it('summarizes intake arrivals as counts, not items', () => {
    const bullets = composeBullets({ ...base, intake: { unread: 5, newToday: 2, newYesterday: 3 } });
    expect(bullets.some(b => /2 new bids came in today — review them in the Intake Inbox/.test(b))).toBe(true);
    expect(bullets.some(b => /3 new bids came in yesterday/.test(b))).toBe(true);
  });

  it('counts bid-type attention items as bids due soon', () => {
    const bullets = composeBullets({
      ...base,
      attention: [{ id: 'bid:1', type: 'bid', chips: ['Elec'], title: 'X', subtitle: '', receivedAt: null, briefing: '', cta: {} }],
    });
    expect(bullets.some(b => /1 bid due within 3 days/.test(b))).toBe(true);
  });

  it('celebrates signed proposals waiting to be awarded', () => {
    const bullets = composeBullets({
      ...base,
      attention: [{ id: 'signed:1', type: 'gen-signed', chips: ['Gen'], title: 'X', subtitle: '', receivedAt: null, briefing: '', cta: {} }],
    });
    expect(bullets.some(b => /1 signed proposal waiting to be awarded/.test(b))).toBe(true);
  });

  it('summarizes due follow-ups and ghosted leads', () => {
    const bullets = composeBullets({
      ...base,
      attention: [
        { id: 'task:1', type: 'task', chips: ['Call'], title: 'T', subtitle: '', receivedAt: null, briefing: '', cta: {} },
        { id: 'stale:1', type: 'lead-stale', chips: ['Gen', 'Call'], title: 'S', subtitle: '', receivedAt: null, briefing: '', cta: {} },
        { id: 'stale:2', type: 'lead-stale', chips: ['Gen', 'Call'], title: 'S2', subtitle: '', receivedAt: null, briefing: '', cta: {} },
      ],
    });
    expect(bullets.some(b => /1 follow-up due today or overdue/.test(b))).toBe(true);
    expect(bullets.some(b => /2 leads have never responded since being added/.test(b))).toBe(true);
  });
});

describe('composeDaySummary', () => {
  const quiet = { newBids: 0, newLeads: 0, signed: 0, won: 0, wonValue: 0 };
  const busy = { newBids: 3, newLeads: 2, signed: 1, won: 1, wonValue: 18500 };

  it('recaps yesterday in the morning', () => {
    const s = composeDaySummary(8, busy, quiet);
    expect(s).toMatch(/^Since yesterday: /);
    expect(s).toContain('3 new bids hit intake');
    expect(s).toContain('1 proposal was signed');
    expect(s).toContain('1 job won ($18,500)');
  });

  it('shows today-so-far at midday and a recap in the evening', () => {
    expect(composeDaySummary(13, quiet, busy)).toMatch(/^So far today: /);
    expect(composeDaySummary(19, quiet, busy)).toMatch(/^Today's recap: /);
  });

  it('falls back to quiet-day copy', () => {
    expect(composeDaySummary(8, quiet, busy)).toBe('Yesterday was quiet — fresh slate today.');
    expect(composeDaySummary(14, busy, quiet)).toBe('Quiet so far today — good time to work the list.');
  });
});
