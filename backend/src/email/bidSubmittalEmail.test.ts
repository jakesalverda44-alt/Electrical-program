// Phase 4 Task 1 — locks the GC submittal email + internal Chris email
// against the authority template
// (~/.claude/skills/apt-electrical-bid/templates/submittal_email.md), and
// guards that the bid amount can never leak into either body.
import { describe, it, expect } from 'vitest';
import {
  defaultSubmittalSubject,
  defaultSubmittalBodyText,
  buildBidSubmittalHtml,
  defaultPrebidChrisSubject,
  buildPrebidChrisBodyHtml,
  SubmittalBidLike,
} from './bidSubmittalEmail';

const BID: SubmittalBidLike = { name: 'Test Plaza', loc: '123 Main St, Orlando, FL', amount: 425_000 };

describe('defaultSubmittalSubject', () => {
  it('matches "[Project Name] – [Location] | Electrical Proposal" verbatim', () => {
    expect(defaultSubmittalSubject(BID)).toBe('Test Plaza – 123 Main St, Orlando, FL | Electrical Proposal');
  });
});

describe('defaultSubmittalBodyText', () => {
  it('matches the template structure: "Hey," greeting and clarifications line', () => {
    const body = defaultSubmittalBodyText(BID);
    expect(body).toContain('Hey,');
    expect(body).toContain('Please find attached our electrical proposal for the Test Plaza at 123 Main St, Orlando, FL.');
    expect(body).toContain('Let us know if you have any clarifications.');
  });

  it('omits the trailing " at <loc>" when no location is on file', () => {
    const body = defaultSubmittalBodyText({ name: 'Test Plaza' });
    expect(body).toContain('Please find attached our electrical proposal for the Test Plaza.');
  });
});

describe('buildBidSubmittalHtml', () => {
  it("includes Jake's four-line signature verbatim", () => {
    const html = buildBidSubmittalHtml({ bodyText: defaultSubmittalBodyText(BID) });
    expect(html).toContain('Jake Salverda');
    expect(html).toContain('Commercial A.E. – Central FL Region');
    expect(html).toContain('Accurate Power &amp; Technology');
    expect(html).toContain('352-801-8997');
  });

  it('inserts "View and accept online: <link>" above the signature when a link is given', () => {
    const html = buildBidSubmittalHtml({ bodyText: defaultSubmittalBodyText(BID), proposalLink: 'https://example.com/bp/abc123' });
    const linkIdx = html.indexOf('View and accept online');
    const sigIdx = html.indexOf('Jake Salverda');
    expect(linkIdx).toBeGreaterThan(-1);
    expect(sigIdx).toBeGreaterThan(-1);
    expect(linkIdx).toBeLessThan(sigIdx);
    expect(html).toContain('https://example.com/bp/abc123');
  });

  it('omits the link line entirely when no link is given', () => {
    const html = buildBidSubmittalHtml({ bodyText: defaultSubmittalBodyText(BID) });
    expect(html).not.toContain('View and accept online');
  });

  // GUARD (Task 1.2): the built body must NEVER contain the bid amount, in
  // any of its usual formattings, even though a full bid row (amount and
  // all) is a valid input to every builder in this file.
  it('GUARD: never contains the bid amount, in any body/link combination', () => {
    const forbidden = ['425000', '425,000', '$425,000', '$425000'];
    const subject = defaultSubmittalSubject(BID);
    const bodyText = defaultSubmittalBodyText(BID);
    const htmlNoLink = buildBidSubmittalHtml({ bodyText });
    const htmlWithLink = buildBidSubmittalHtml({ bodyText, proposalLink: 'https://example.com/bp/abc123' });
    for (const needle of forbidden) {
      expect(subject).not.toContain(needle);
      expect(bodyText).not.toContain(needle);
      expect(htmlNoLink).not.toContain(needle);
      expect(htmlWithLink).not.toContain(needle);
    }
  });
});

describe('internal Chris email', () => {
  it('subject matches "[Project Name] – Pre-Bid Scope + Takeoff" verbatim', () => {
    expect(defaultPrebidChrisSubject(BID)).toBe('Test Plaza – Pre-Bid Scope + Takeoff');
  });

  it('body matches the template structure and confidence-coding note verbatim', () => {
    const html = buildPrebidChrisBodyHtml({ ...BID, planDate: '07.15.2026' });
    expect(html).toContain('Chris,');
    expect(html).toContain('Scope doc and takeoff attached for Test Plaza, 123 Main St, Orlando, FL.');
    expect(html).toContain('Drawings dated 07.15.2026.');
    expect(html).toContain('Confidence coded — FIRM off the schedules, APPROX are symbol counts with ranges, VERIFY needs a second look.');
    expect(html).toContain('Notes at the bottom of the takeoff.');
    expect(html).toContain('Jake');
  });

  // GUARD: same rule applies to the internal email — the template never
  // includes a price for Chris either (he prices it himself off the takeoff).
  it('GUARD: never contains the bid amount', () => {
    const html = buildPrebidChrisBodyHtml(BID);
    for (const needle of ['425000', '425,000', '$425,000']) {
      expect(html).not.toContain(needle);
    }
  });
});
