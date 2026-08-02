import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePrebidScope } from '../utils/prebidScopeParse';

const fixture = (n: string) => readFileSync(join(__dirname, 'fixtures/prebid', n));
const autozone = () => parsePrebidScope(fixture('autozone_scope.docx'));

describe('parsePrebidScope', () => {
  it('extracts the six lettered sections with their items', () => {
    const s = autozone().sections;
    expect(s.map(x => x.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(s[0].title).toMatch(/Service & Distribution/);
    expect(s[0].items.length).toBeGreaterThan(2);
  });

  it('classifies the furnish model as OFEI and keeps the source paragraph', () => {
    const p = autozone();
    expect(p.furnishModel).toBe('OFEI');
    expect(p.furnishNote).toMatch(/Owner Furnished|OFEI/i);
  });

  it('reads the header metadata block', () => {
    const m = autozone().meta;
    expect(m['GC']).toMatch(/Summit/);
    expect(m['Job Number']).toBeTruthy();
  });

  it('decodes XML entities in item text', () => {
    const joined = autozone().sections.flatMap(s => s.items).join(' ');
    expect(joined).not.toMatch(/&amp;|&apos;|&quot;/);
    expect(joined).toMatch(/&/);
  });

  it('collects the general items that precede the lettered sections', () => {
    expect(autozone().generalItems.some(i => /permit/i.test(i))).toBe(true);
  });

  it('suggests a brand from the Re: line', () => {
    expect(autozone().suggestedBrand).toMatch(/AutoZone/);
  });

  it('parses the other two current-generation documents to the same shape', () => {
    for (const f of ['indianoaks_scope.docx', 'nickmoes_scope.docx']) {
      const p = parsePrebidScope(fixture(f));
      expect(p.sections.map(s => s.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
      expect(p.sections.every(s => s.items.length > 0)).toBe(true);
    }
  });

  it('returns an empty shape rather than throwing on a non-docx buffer', () => {
    const p = parsePrebidScope(Buffer.from('not a zip'));
    expect(p.sections).toEqual([]);
    expect(p.furnishModel).toBeNull();
  });

  it('gives each empty result its own array/object instances, not a shared singleton', () => {
    const a = parsePrebidScope(Buffer.from('not a zip'));
    const b = parsePrebidScope(Buffer.from('also not a zip'));
    expect(a.sections).not.toBe(b.sections);
    expect(a.meta).not.toBe(b.meta);
    expect(a.generalItems).not.toBe(b.generalItems);
    a.sections.push({ id: 'X', title: 'mutated', items: [] });
    a.meta['leak'] = 'leak';
    a.generalItems.push('leak');
    expect(b.sections).toEqual([]);
    expect(b.meta).toEqual({});
    expect(b.generalItems).toEqual([]);
  });

  it('does not swallow a prose paragraph starting with "Label:" into meta', () => {
    const m = parsePrebidScope(fixture('indianoaks_scope.docx')).meta;
    // The real fixture's "NOTE: The architectural/engineering drawing title blocks..."
    // paragraph runs 350+ chars across multiple sentences — a header value, not a fact.
    expect(m['NOTE']).toBeUndefined();
    // Genuine header keys on the same document must still come through.
    expect(m['GC / Client']).toMatch(/Bay to Bay/);
    expect(m['Job No.']).toBeTruthy();
  });
});
