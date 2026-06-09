import { describe, it, expect } from 'vitest';
import { firstNameOf, leadFirstContactHtml } from './leadFirstContact';

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
