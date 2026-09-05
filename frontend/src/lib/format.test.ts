import { describe, it, expect } from 'vitest';
import { fmtSize } from './format';

describe('fmtSize', () => {
  it('returns an empty string for a falsy size', () => {
    expect(fmtSize(0)).toBe('');
    expect(fmtSize(null)).toBe('');
    expect(fmtSize(undefined)).toBe('');
  });

  it('formats bytes', () => {
    expect(fmtSize(512)).toBe('512 B');
  });

  it('formats kilobytes, rounded', () => {
    expect(fmtSize(48_000)).toBe('47 KB');
  });

  it('formats megabytes with one decimal', () => {
    expect(fmtSize(1_258_291)).toBe('1.2 MB');
  });
});
