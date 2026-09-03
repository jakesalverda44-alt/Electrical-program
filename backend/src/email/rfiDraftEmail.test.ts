import { describe, it, expect } from 'vitest';
import { rfiDraftSubject, buildRfiDraftHtml } from './rfiDraftEmail';

describe('rfiDraftSubject', () => {
  it('matches "[Project Name] – RFIs / Bid Clarifications" verbatim', () => {
    expect(rfiDraftSubject('Test Plaza')).toBe('Test Plaza – RFIs / Bid Clarifications');
  });
  it('falls back to "Project" when blank', () => {
    expect(rfiDraftSubject('')).toBe('Project – RFIs / Bid Clarifications');
  });
});

describe('buildRfiDraftHtml', () => {
  it('lists every open RFI question as a numbered (<ol>) item', () => {
    const html = buildRfiDraftHtml('Test Plaza', [
      { question: 'Confirm service entrance rating.' },
      { question: 'Is a photometric plan required?' },
    ]);
    expect(html).toContain('<ol>');
    expect(html).toContain('Confirm service entrance rating.');
    expect(html).toContain('Is a photometric plan required?');
    expect((html.match(/<li/g) || []).length).toBe(2);
  });

  it('escapes HTML in question text', () => {
    const html = buildRfiDraftHtml('Test Plaza', [{ question: '<script>alert(1)</script>' }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
