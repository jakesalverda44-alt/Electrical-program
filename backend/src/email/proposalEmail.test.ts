// Audit: Security #9 (High) / Task 6.1 — proposalEmailHtml never imported
// escapeHtml, and senderNote/total/deposit/proposalNo come straight off
// req.body (routes/gens.ts's POST /:id/send) for a REAL send to the customer
// via graphSendMail, not a draft. A crafted note or customer name could inject
// markup — e.g. a fake "Review & Sign" link — into mail sent from our own
// mailbox. Pure function — no DB, no network.
import { describe, it, expect } from 'vitest';
import { proposalEmailHtml } from './proposalEmail';

const BASE = {
  customerName: 'Jane Doe',
  proposalNo: 'GEN-0001',
  total: '$15,000.00',
  deposit: '$3,000.00',
  link: 'https://example.com/p/abc123',
};

describe('proposalEmailHtml — escapes every interpolated value (Task 6.1)', () => {
  it('renders a senderNote containing a hostile <a href> tag as escaped text, not live markup', () => {
    const html = proposalEmailHtml({
      ...BASE,
      senderNote: 'Click here <a href="https://evil.example/phish">to review</a>',
    });
    expect(html).not.toContain('<a href="https://evil.example/phish">');
    expect(html).toContain('&lt;a href=&quot;https://evil.example/phish&quot;&gt;');
  });

  it('escapes a hostile customerName', () => {
    const html = proposalEmailHtml({ ...BASE, customerName: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes hostile total, deposit, and proposalNo values', () => {
    const html = proposalEmailHtml({
      ...BASE,
      total: '<script>alert(1)</script>',
      deposit: '"><svg onload=alert(1)>',
      proposalNo: '</td></tr><tr><td>injected',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<svg onload=alert(1)>');
    expect(html).not.toContain('</td></tr><tr><td>injected');
  });

  it('escapes defaultMessage and gasContacts (settings-sourced, still interpolated raw before this fix), keeping nl2br working', () => {
    const html = proposalEmailHtml({
      ...BASE,
      defaultMessage: 'Line one\n<b>bold injection</b>\nLine two',
      gasContacts: 'Contact: <script>x</script>\nPhone: 555-1234',
    });
    expect(html).not.toContain('<b>bold injection</b>');
    expect(html).not.toContain('<script>x</script>');
    // nl2br still turns real newlines into <br> after escaping.
    expect(html).toContain('Line one<br>');
    expect(html).toContain('Phone: 555-1234');
  });

  it('still renders normal values with no escaping artifacts', () => {
    const html = proposalEmailHtml(BASE);
    expect(html).toContain('Dear Jane Doe,');
    expect(html).toContain('GEN-0001');
    expect(html).toContain('$15,000.00');
    expect(html).toContain('$3,000.00');
    expect(html).toContain(BASE.link);
  });
});
