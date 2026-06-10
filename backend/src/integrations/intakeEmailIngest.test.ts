import { describe, it, expect } from 'vitest';
import { parseDueDate, parseProjectName } from './intakeEmailIngest';

const NOW = new Date('2026-06-10T12:00:00Z');

describe('parseDueDate', () => {
  it('reads a cued numeric date with explicit year', () => {
    expect(parseDueDate('Bids due 6/20/2026 at 2pm', NOW)).toBe('2026-06-20');
  });

  it('reads a numeric date without a year, inferring the current year', () => {
    expect(parseDueDate('Please submit by 7/15', NOW)).toBe('2026-07-15');
  });

  it('rolls a past, year-less date forward to next year', () => {
    // 1/5 already passed in 2026 → assume 2027
    expect(parseDueDate('due 1/5', NOW)).toBe('2027-01-05');
  });

  it('reads a month-name date', () => {
    expect(parseDueDate('Proposals due June 20, 2026', NOW)).toBe('2026-06-20');
  });

  it('handles 2-digit years', () => {
    expect(parseDueDate('bid date 06-20-26', NOW)).toBe('2026-06-20');
  });

  it('returns null when no date is present', () => {
    expect(parseDueDate('Invitation to bid on the new clinic', NOW)).toBeNull();
  });

  it('prefers the date that follows a due cue', () => {
    // sent date 6/1 appears first, but the real due date is cued
    expect(parseDueDate('Sent 6/1. Bids due 6/25/2026.', NOW)).toBe('2026-06-25');
  });
});

describe('parseProjectName', () => {
  it('strips an "Invitation to Bid:" prefix', () => {
    expect(parseProjectName('Invitation to Bid: Lakeside Medical Office')).toBe('Lakeside Medical Office');
  });

  it('strips ITB and a trailing due fragment', () => {
    expect(parseProjectName('ITB - Riverside Warehouse - Bids Due 6/20')).toBe('Riverside Warehouse');
  });

  it('strips a Re:/Fwd: prefix', () => {
    expect(parseProjectName('FW: Bid Invitation — Oak Street Retail')).toBe('Oak Street Retail');
  });

  it('falls back to the raw subject when nothing matches', () => {
    expect(parseProjectName('Downtown Parking Structure')).toBe('Downtown Parking Structure');
  });
});
