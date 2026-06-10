import { describe, it, expect } from 'vitest';
import { firstNameOf, leadFirstContactHtml, leadNudgeHtml, isPlaceholderLeadEmail } from './leadFirstContact';

describe('isPlaceholderLeadEmail', () => {
  it('flags Kohler refuse placeholders (case-insensitive)', () => {
    expect(isPlaceholderLeadEmail('refuse@kohler.com')).toBe(true);
    expect(isPlaceholderLeadEmail('REFUSE@KOHLER.COM')).toBe(true);
    expect(isPlaceholderLeadEmail('anything@kohler.com')).toBe(true);
    expect(isPlaceholderLeadEmail('refused@example.com')).toBe(true);
    expect(isPlaceholderLeadEmail('noemail@example.com')).toBe(true);
  });
  it('passes real homeowner addresses through', () => {
    expect(isPlaceholderLeadEmail('jane.homeowner@gmail.com')).toBe(false);
    expect(isPlaceholderLeadEmail('bob@kohlerplumbingco.com')).toBe(false);
    expect(isPlaceholderLeadEmail('')).toBe(false);
    expect(isPlaceholderLeadEmail(null)).toBe(false);
    expect(isPlaceholderLeadEmail(undefined)).toBe(false);
  });
});

describe('firstNameOf', () => {
  it('returns the first word of a full name', () => {
    expect(firstNameOf('Jane Q. Homeowner')).toBe('Jane');
  });

  it('falls back to "there" for empty / missing names', () => {
    expect(firstNameOf('')).toBe('there');
    expect(firstNameOf('   ')).toBe('there');
    expect(firstNameOf(null)).toBe('there');
    expect(firstNameOf(undefined)).toBe('there');
  });
});

describe('leadFirstContactHtml', () => {
  it('greets the lead by first name', () => {
    expect(leadFirstContactHtml('Jane')).toContain('Hi Jane,');
  });

  it('references the inline logo by Content-ID, not an external URL', () => {
    const html = leadFirstContactHtml('Jane');
    expect(html).toContain('src="cid:apt-logo"');
    expect(html).not.toMatch(/src="https?:/);
  });

  it('escapes HTML in the name to prevent injection', () => {
    const html = leadFirstContactHtml('<b>x</b>');
    expect(html).toContain('Hi &lt;b&gt;x&lt;/b&gt;,');
    expect(html).not.toContain('Hi <b>x</b>,');
  });
});

describe('leadNudgeHtml', () => {
  it('greets by first name and asks goal-discovery questions', () => {
    const html = leadNudgeHtml('Jane');
    expect(html).toContain('Hi Jane,');
    expect(html).toMatch(/what you\s+want to accomplish/i);
    expect(html).toMatch(/backup power/i);
    expect(html).toMatch(/whole-home|essentials/i);
    expect(html).toMatch(/natural gas|propane/i);
  });
  it('uses the inline logo and escapes the name', () => {
    expect(leadNudgeHtml('Jane')).toContain('src="cid:apt-logo"');
    expect(leadNudgeHtml('<i>x</i>')).toContain('Hi &lt;i&gt;x&lt;/i&gt;,');
  });
});
