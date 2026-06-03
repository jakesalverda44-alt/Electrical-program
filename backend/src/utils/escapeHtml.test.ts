import { describe, it, expect } from 'vitest';
import { escapeHtml } from './escapeHtml';

describe('escapeHtml', () => {
  it('escapes script tags', () => {
    expect(escapeHtml('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes quotes and ampersands', () => {
    expect(escapeHtml(`Tom & "Jerry's"`))
      .toBe('Tom &amp; &quot;Jerry&#39;s&quot;');
  });

  it('handles null/undefined as empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('Acme Substation Upgrade')).toBe('Acme Substation Upgrade');
  });
});
