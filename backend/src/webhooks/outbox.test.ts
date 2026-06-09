import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { backoffMs, resolveWebhookUrl, buildWebhookPayload, MAX_ATTEMPTS } from './outbox';

describe('backoffMs', () => {
  it('grows monotonically with each failed attempt', () => {
    for (let a = 1; a < MAX_ATTEMPTS; a++) {
      expect(backoffMs(a + 1)).toBeGreaterThanOrEqual(backoffMs(a));
    }
  });

  it('starts at 1 minute and caps at 12 hours', () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(MAX_ATTEMPTS)).toBe(12 * 60 * 60_000);
    expect(backoffMs(MAX_ATTEMPTS + 5)).toBe(12 * 60 * 60_000);
  });

  it('clamps out-of-range attempts instead of returning undefined', () => {
    expect(backoffMs(0)).toBe(60_000);
    expect(backoffMs(-3)).toBe(60_000);
  });
});

describe('resolveWebhookUrl', () => {
  const saved: Record<string, string | undefined> = {};
  const KEYS = [
    'ZAPIER_WEBHOOK_EMAIL_NEW_LEAD', 'ZAPIER_WEBHOOK_PHONE_NEW_LEAD',
    'ZAPIER_WEBHOOK_QUOTED', 'ZAPIER_WEBHOOK_SITE_SCHEDULED',
  ];
  beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('returns undefined when nothing is configured', () => {
    expect(resolveWebhookUrl('new', 'email')).toBeUndefined();
  });

  it('matches stage:contact_method before stage:any', () => {
    process.env.ZAPIER_WEBHOOK_EMAIL_NEW_LEAD = 'https://hooks.test/email';
    expect(resolveWebhookUrl('new', 'email')).toBe('https://hooks.test/email');
    expect(resolveWebhookUrl('new', 'phone')).toBeUndefined();
  });

  it('falls back to the stage:any key', () => {
    process.env.ZAPIER_WEBHOOK_QUOTED = 'https://hooks.test/quoted';
    expect(resolveWebhookUrl('quoted', 'email')).toBe('https://hooks.test/quoted');
    expect(resolveWebhookUrl('quoted', 'phone')).toBe('https://hooks.test/quoted');
  });
});

describe('buildWebhookPayload', () => {
  it('snapshots the lead fields and the stage that fired', () => {
    const lead = {
      id: 'abc', name: 'Jane', email: 'j@x.com', phone: '555', address: '1 Main',
      source: 'kohler', contact_method: 'email', interest_level: 'hot',
      stage: 'new', notes: 'n', quoted_range: '10-12k', follow_up_date: '2026-06-10',
      extra_internal_field: 'must not leak',
    };
    const p = buildWebhookPayload(lead, 'quoted');
    expect(p).toEqual({
      lead_id: 'abc', name: 'Jane', email: 'j@x.com', phone: '555', address: '1 Main',
      source: 'kohler', contact_method: 'email', interest_level: 'hot',
      stage: 'quoted', notes: 'n', quoted_range: '10-12k', follow_up_date: '2026-06-10',
    });
  });
});
