import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { renderPrebidScopeDocx, prebidScopeFilename } from './prebidScopeDocx';
import { extractDocxText } from '../utils/bidDocParse';
import { BidData } from './bidData';
import { CLOSING, PREBID_BANNER } from './boilerplate';

const fixture: BidData = JSON.parse(
  readFileSync(join(__dirname, '../test/fixtures/bidstd/bid_data.example.json'), 'utf8')
);

describe('prebidScopeFilename', () => {
  it('is [Project]_PreBid_Scope.docx', () => {
    expect(prebidScopeFilename(fixture)).toBe(`${fixture.project_slug}_PreBid_Scope.docx`);
  });
});

describe('renderPrebidScopeDocx', () => {
  it('renders the fixture (with its prebid block) without throwing', async () => {
    const buf = await renderPrebidScopeDocx(fixture);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('renders the internal banner instead of the logo', async () => {
    const buf = await renderPrebidScopeDocx(fixture);
    const text = extractDocxText(buf);
    expect(text).toContain(PREBID_BANNER);
  });

  it('renders To/From/Owner/Engineer/Sheets/received from the prebid block', async () => {
    const buf = await renderPrebidScopeDocx(fixture);
    const text = extractDocxText(buf);
    expect(text).toContain(`To:          ${fixture.prebid!.to}`);
    expect(text).toContain(`From:      ${fixture.prebid!.from}`);
    expect(text).toContain(`Owner:     ${fixture.prebid!.owner}`);
    expect(text).toContain(`Engineer: ${fixture.prebid!.engineer}`);
    expect(text).toContain(`Sheets:    ${fixture.prebid!.sheets}`);
    expect(text).toContain(fixture.prebid!.received!);
  });

  it('defaults To/From when the prebid block omits them', async () => {
    const noPrebid: BidData = { ...fixture, prebid: undefined };
    const buf = await renderPrebidScopeDocx(noPrebid);
    const text = extractDocxText(buf);
    expect(text).toContain('To:          Chris (Estimator)');
    expect(text).toContain('From:      Jake Salverda, Commercial A.E.');
  });

  it('renders scope, sections, and exclusions', async () => {
    const buf = await renderPrebidScopeDocx(fixture);
    const text = extractDocxText(buf);
    expect(text).toContain('SCOPE OF WORK');
    expect(text).toContain('A. Service & Distribution');
    expect(text).toContain('EXCLUSIONS & CLARIFICATIONS');
    expect(text).toContain(fixture.exclusions[0] as string);
  });

  it('renders INTERNAL NOTES & DISCREPANCIES from prebid.flags, when present', async () => {
    const buf = await renderPrebidScopeDocx(fixture);
    const text = extractDocxText(buf);
    expect(text).toContain('INTERNAL NOTES & DISCREPANCIES');
    for (const flag of fixture.prebid!.flags!) {
      expect(text).toContain(flag);
    }
  });

  it('omits INTERNAL NOTES & DISCREPANCIES when there are no flags', async () => {
    const noFlags: BidData = { ...fixture, prebid: { ...fixture.prebid, flags: [] } };
    const buf = await renderPrebidScopeDocx(noFlags);
    const text = extractDocxText(buf);
    expect(text).not.toContain('INTERNAL NOTES & DISCREPANCIES');
  });

  it('never renders a takeoff table, price, signature, or closing block', async () => {
    const buf = await renderPrebidScopeDocx(fixture);
    const text = extractDocxText(buf);
    expect(text).not.toContain('ELECTRICAL QUANTITY TAKEOFF');
    expect(text).not.toContain('Proposal Price Summary');
    expect(text).not.toContain(fixture.total_price);
    expect(text).not.toContain(CLOSING.respectfully);
    expect(text).not.toContain(CLOSING.thankYou);
    expect(text).not.toContain(CLOSING.costBasis);
  });
});
