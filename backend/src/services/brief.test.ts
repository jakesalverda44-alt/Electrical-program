import { describe, it, expect } from 'vitest';
import { isKohlerNotification } from '../integrations/outlookMail';
import { composeBullets, BriefPayload } from './brief';

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
  intake: { unread: 0, newToday: 0, newYesterday: 0 }, todayEvents: [],
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
});
