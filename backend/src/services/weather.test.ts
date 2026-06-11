import { describe, it, expect } from 'vitest';
import { describeWeatherCode } from './weather';

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
