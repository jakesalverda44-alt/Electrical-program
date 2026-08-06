import { describe, it, expect } from 'vitest';
import { describeWeatherCode, backoffMs, parseRetryAfter, ForecastHttpError } from './weather';

describe('describeWeatherCode', () => {
  it('maps the common WMO codes', () => {
    expect(describeWeatherCode(0)).toEqual({ label: 'Sunny', emoji: '☀️' });
    expect(describeWeatherCode(2)).toEqual({ label: 'Partly cloudy', emoji: '⛅' });
    expect(describeWeatherCode(3)).toEqual({ label: 'Overcast', emoji: '☁️' });
    expect(describeWeatherCode(63).label).toBe('Rain');
    expect(describeWeatherCode(81).label).toBe('Showers');
    expect(describeWeatherCode(95).label).toBe('Thunderstorm');
  });
  it('falls back to Cloudy for unknown codes', () => {
    expect(describeWeatherCode(42)).toEqual({ label: 'Cloudy', emoji: '☁️' });
  });
});

describe('parseRetryAfter', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfter('120')).toBe(120_000);
    expect(parseRetryAfter(' 30 ')).toBe(30_000);
  });
  it('reads an HTTP date, relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:05:00 GMT', now)).toBe(300_000);
  });
  it('never returns a negative wait for a date already past', () => {
    const now = Date.parse('2026-01-01T00:10:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:05:00 GMT', now)).toBe(0);
  });
  it('returns null when absent or unparseable', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('backoffMs', () => {
  it('doubles each consecutive failure', () => {
    expect(backoffMs(1)).toBe(2 * 60_000);
    expect(backoffMs(2)).toBe(4 * 60_000);
    expect(backoffMs(3)).toBe(8 * 60_000);
  });

  it('caps at an hour instead of growing forever', () => {
    expect(backoffMs(20)).toBe(60 * 60_000);
  });

  // The whole point of the change: a rate-limited poll must wait *longer* than a
  // successful one (15 min), or the retries are what keep the limit tripped.
  it('waits half an hour on a 429 with no Retry-After', () => {
    expect(backoffMs(1, new ForecastHttpError(429, null))).toBe(30 * 60_000);
  });

  it('honors Retry-After on a 429', () => {
    expect(backoffMs(1, new ForecastHttpError(429, 90_000))).toBe(90_000);
  });

  it('still caps a hostile Retry-After at an hour', () => {
    expect(backoffMs(1, new ForecastHttpError(429, 24 * 60 * 60_000))).toBe(60 * 60_000);
  });

  it('treats a non-429 HTTP error with the normal exponential schedule', () => {
    expect(backoffMs(2, new ForecastHttpError(503, null))).toBe(4 * 60_000);
  });
});
