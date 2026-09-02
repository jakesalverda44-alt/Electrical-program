import { describe, it, expect } from 'vitest';
import { confidenceToPlaybook } from './confidence';

describe('confidenceToPlaybook (pure)', () => {
  it('maps VERIFIED to FIRM', () => {
    expect(confidenceToPlaybook('VERIFIED')).toBe('FIRM');
  });

  it('maps ASSUMED to APPROX', () => {
    expect(confidenceToPlaybook('ASSUMED')).toBe('APPROX');
  });

  it('maps NOT SHOWN to VERIFY', () => {
    expect(confidenceToPlaybook('NOT SHOWN')).toBe('VERIFY');
  });

  it('passes through already-playbook values unchanged', () => {
    expect(confidenceToPlaybook('FIRM')).toBe('FIRM');
    expect(confidenceToPlaybook('APPROX')).toBe('APPROX');
    expect(confidenceToPlaybook('VERIFY')).toBe('VERIFY');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(confidenceToPlaybook('verified')).toBe('FIRM');
    expect(confidenceToPlaybook('  Assumed  ')).toBe('APPROX');
    expect(confidenceToPlaybook('not shown')).toBe('VERIFY');
  });

  it('returns null for unknown values', () => {
    expect(confidenceToPlaybook('MAYBE')).toBeNull();
    expect(confidenceToPlaybook('')).toBeNull();
  });

  it('returns null for absent values', () => {
    expect(confidenceToPlaybook(undefined)).toBeNull();
    expect(confidenceToPlaybook(null)).toBeNull();
  });
});
