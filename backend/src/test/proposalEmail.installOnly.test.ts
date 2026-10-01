import { describe, it, expect } from 'vitest';
import { proposalEmailHtml } from '../email/proposalEmail';

const base = { customerName: 'Pat', proposalNo: 'P-1', spec: '22kW Generac', total: '$1', deposit: '$1', link: 'https://x/p/1' };

describe('proposalEmailHtml install-only wording', () => {
  it('does not sell a standby generator', () => {
    const html = proposalEmailHtml({ ...base, installOnly: true });
    expect(html).toContain('installation proposal for your customer-furnished <strong>22kW Generac</strong> generator');
    expect(html).toContain('Installation — customer-furnished 22kW Generac');
    expect(html).not.toContain('Standby Generator');
    expect(html).not.toMatch(/standby\s+generator proposal/);
  });
  it('leaves the normal wording unchanged', () => {
    const html = proposalEmailHtml(base);
    expect(html).toContain('22kW Generac</strong> standby');
    expect(html).toContain('22kW Generac Standby Generator');
  });
});
