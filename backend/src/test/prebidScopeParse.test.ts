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
});
