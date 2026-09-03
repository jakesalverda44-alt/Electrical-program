import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { verifyBidText, verifyBidDocx, findSoffice } from './verifyBid';
import { renderBidDocx } from '../utils/proposalDocx';
import { BidData } from './bidData';

const fixture: BidData = JSON.parse(
  readFileSync(join(__dirname, '../test/fixtures/bidstd/bid_data.example.json'), 'utf8')
);

describe('verifyBidText — pure core, GC kind', () => {
  const CLEAN_TEXT = [
    'A. Service & Distribution',
    'Service entrance assembly and MDP (ECFECI).',
    'Distribution gear (ECFECI): panels A, B.',
    'B. Branch Power',
    'Branch circuits per plan.',
    'C. Lighting & Controls',
    'Complete lighting package (ECFECI).',
    'D. Site Lighting, Underground Work & Allowances',
    'Site lighting per plan.',
  ].join('\n');

  it('passes on clean text with 3+ ECFECI mentions in the right windows', () => {
    const result = verifyBidText(CLEAN_TEXT, 'gc');
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('fails on an unfilled bracketed placeholder', () => {
    const result = verifyBidText(`${CLEAN_TEXT}\nJob No. [JOB NUMBER]`, 'gc');
    expect(result.pass).toBe(false);
    const f = result.failures.find(f => f.check === 'placeholders');
    expect(f).toBeTruthy();
    expect(f!.matches).toContain('[JOB NUMBER]');
  });

  it('fails on "RFI"', () => {
    const result = verifyBidText(`${CLEAN_TEXT}\nSubmit an RFI for this.`, 'gc');
    const f = result.failures.find(f => f.check === 'banned_language');
    expect(f).toBeTruthy();
    expect(f!.matches.some(m => /RFI/.test(m))).toBe(true);
  });

  it('fails on "TBD"', () => {
    const result = verifyBidText(`${CLEAN_TEXT}\nFixture count TBD.`, 'gc');
    const f = result.failures.find(f => f.check === 'banned_language');
    expect(f).toBeTruthy();
    expect(f!.matches).toContain('TBD');
  });

  it('fails on "1,234 SF"', () => {
    const result = verifyBidText(`${CLEAN_TEXT}\nBuilding is 1,234 SF.`, 'gc');
    const f = result.failures.find(f => f.check === 'square_footage');
    expect(f).toBeTruthy();
    expect(f!.matches.some(m => m.includes('1,234'))).toBe(true);
  });

  it('fails when ECFECI is stripped entirely', () => {
    const stripped = CLEAN_TEXT.replace(/\s*\(ECFECI\)/g, '');
    const result = verifyBidText(stripped, 'gc');
    const f = result.failures.find(f => f.check === 'ecfeci');
    expect(f).toBeTruthy();
  });

  it('fails when ECFECI count is under 3 even if placement windows are satisfied', () => {
    // Only 2 total mentions (one in each required window) — the count check
    // must still fail even though both placement checks pass individually.
    const text = [
      'A. Service & Distribution',
      'Service entrance assembly and MDP (ECFECI).',
      'B. Branch Power',
      'C. Lighting & Controls',
      'Complete lighting package (ECFECI).',
      'D. Site Lighting, Underground Work & Allowances',
    ].join('\n');
    const result = verifyBidText(text, 'gc');
    const f = result.failures.find(f => f.check === 'ecfeci');
    expect(f).toBeTruthy();
    expect(f!.detail).toMatch(/only 2 ECFECI/);
  });

  it('fails when ECFECI is missing from the Section A window specifically', () => {
    const text = [
      'A. Service & Distribution',
      'Service entrance assembly and MDP.', // no ECFECI here
      'B. Branch Power',
      'C. Lighting & Controls',
      'Complete lighting package (ECFECI). Distribution gear (ECFECI). Panels (ECFECI).',
      'D. Site Lighting, Underground Work & Allowances',
    ].join('\n');
    const result = verifyBidText(text, 'gc');
    const f = result.failures.find(f => f.check === 'ecfeci');
    expect(f).toBeTruthy();
    expect(f!.detail).toMatch(/A\. Service & Distribution/);
  });

  it('"Discounted" does NOT trip the "counted" banned-word check', () => {
    const result = verifyBidText(`${CLEAN_TEXT}\nA 5% discount is offered. Discounted pricing applies.`, 'gc');
    expect(result.failures.find(f => f.check === 'banned_language')).toBeUndefined();
  });

  it('"accounted" does NOT trip the "counted" banned-word check', () => {
    const result = verifyBidText(`${CLEAN_TEXT}\nThis has been accounted for in the estimate.`, 'gc');
    expect(result.failures.find(f => f.check === 'banned_language')).toBeUndefined();
  });

  it('real "counted" still trips the check (word-boundary regex isn\'t over-broad)', () => {
    const result = verifyBidText(`${CLEAN_TEXT}\nFixtures were counted from the schedule.`, 'gc');
    const f = result.failures.find(f => f.check === 'banned_language');
    expect(f).toBeTruthy();
    expect(f!.matches).toContain('counted');
  });
});

describe('verifyBidText — internal kind relaxes banned/SF/ECFECI, keeps placeholders', () => {
  it('an internal doc with estimator language, SF, and no ECFECI still passes', () => {
    const text = 'This item was field verify counted at 1,234 SF. No ECFECI language here at all.';
    const result = verifyBidText(text, 'internal');
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('an internal doc still fails on an unfilled placeholder', () => {
    const result = verifyBidText('Received from [SOURCE NAME].', 'internal');
    expect(result.pass).toBe(false);
    expect(result.failures[0].check).toBe('placeholders');
  });
});

describe('verifyBidDocx — end to end with the renderer', () => {
  it('the fixture rendered by renderBidDocx passes the GC gate', async () => {
    const buf = await renderBidDocx(fixture);
    const result = await verifyBidDocx(buf, { kind: 'gc' });
    expect(result.failures).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('a doctored fixture with an "RFI" bullet fails the GC gate', async () => {
    const doctored: BidData = {
      ...fixture,
      exclusions: [...fixture.exclusions, 'Submit an RFI before proceeding.'],
    };
    const buf = await renderBidDocx(doctored);
    const result = await verifyBidDocx(buf, { kind: 'gc' });
    expect(result.pass).toBe(false);
    expect(result.failures.some(f => f.check === 'banned_language')).toBe(true);
  });

  it('a doctored fixture with an unfilled placeholder fails the GC gate', async () => {
    const doctored: BidData = {
      ...fixture,
      sections: fixture.sections.map((s, i) => i === 0
        ? { ...s, bullets: [...s.bullets, 'See sheet [SHEET NUMBER] for details.'] }
        : s),
    };
    const buf = await renderBidDocx(doctored);
    const result = await verifyBidDocx(buf, { kind: 'gc' });
    expect(result.pass).toBe(false);
    expect(result.failures.some(f => f.check === 'placeholders')).toBe(true);
  });

  it('a doctored fixture with ECFECI stripped from every bullet fails the GC gate', async () => {
    const stripEcfeci = (b: BidData['sections'][number]['bullets'][number]) =>
      typeof b === 'string' ? b.replace(/\s*\(ECFECI\)/g, '') : { b: b.b.replace(/\s*\(ECFECI\)/g, ''), t: b.t.replace(/\s*\(ECFECI\)/g, '') };
    const doctored: BidData = {
      ...fixture,
      sections: fixture.sections.map(s => ({ ...s, bullets: s.bullets.map(stripEcfeci) })),
      takeoff: fixture.takeoff.map(cat => ({
        ...cat,
        items: cat.items.map(it => ({ ...it, description: it.description.replace(/\s*\(ECFECI\)/g, '') })),
      })),
    };
    const buf = await renderBidDocx(doctored);
    const result = await verifyBidDocx(buf, { kind: 'gc' });
    expect(result.pass).toBe(false);
    expect(result.failures.some(f => f.check === 'ecfeci')).toBe(true);
  });

  it('the same doctored RFI fixture passes as an internal document', async () => {
    const doctored: BidData = {
      ...fixture,
      exclusions: [...fixture.exclusions, 'Submit an RFI before proceeding.'],
    };
    const buf = await renderBidDocx(doctored);
    const result = await verifyBidDocx(buf, { kind: 'internal' });
    expect(result.pass).toBe(true);
  });

  it('never fails just because soffice is unavailable', async () => {
    const buf = await renderBidDocx(fixture);
    const result = await verifyBidDocx(buf, { kind: 'gc' });
    // pdf is present only when soffice converted successfully; its absence
    // must never affect pass/fail.
    expect(result.pass).toBe(true);
    if (result.pdf) expect(result.pdf.length).toBeGreaterThan(0);
  });
});

describe('findSoffice', () => {
  it('returns a string or null, never throws', () => {
    const result = findSoffice();
    expect(result === null || typeof result === 'string').toBe(true);
  });
});
