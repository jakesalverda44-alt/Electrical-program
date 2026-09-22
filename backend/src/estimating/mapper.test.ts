import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  normalize, mapTakeoffLine, mapTakeoffLines, fromTakeoffCategories, fromLegacyTakeoff,
  LibraryCandidate, NormalizedTakeoffLine,
} from './mapper';
import { SEED_ITEMS, SEED_ASSEMBLIES } from './seed/laborUnits';

function libraryFromSeed(): LibraryCandidate[] {
  const items: LibraryCandidate[] = SEED_ITEMS.map(i => ({
    kind: 'item', id: i.code, code: i.code, name: i.name, category: i.category, unit: i.unit, aliases: i.aliases,
  }));
  const assemblies: LibraryCandidate[] = SEED_ASSEMBLIES.map(a => ({
    kind: 'assembly', id: a.code, code: a.code, name: a.name, category: a.category, unit: a.unit, aliases: a.aliases,
  }));
  // Assemblies first so an equal-rank tie against an item resolves to the
  // assembly purely via the tie-break rule in mapTakeoffLine, not list order.
  return [...assemblies, ...items];
}

const SMALL_LIB: LibraryCandidate[] = [
  { kind: 'item', id: 'i-emt075', code: 'EMT-075', name: '3/4" EMT (incl. couplings/straps)', category: 'Branch Power', unit: 'C', aliases: ['3/4" emt (incl. couplings/straps)'] },
  { kind: 'item', id: 'i-dup', code: 'DEV-DUP', name: '20A 125V duplex receptacle, spec grade', category: 'Branch Power', unit: 'EA', aliases: ['duplex receptacle, spec grade', 'duplex receptacle'] },
  { kind: 'assembly', id: 'a-dup', code: 'ASM-DUPLEX', name: '20A duplex receptacle circuit, complete', category: 'Branch Power', unit: 'EA', aliases: ['20a 125v duplex receptacle, spec grade', 'duplex receptacle circuit'] },
];

function line(overrides: Partial<NormalizedTakeoffLine>): NormalizedTakeoffLine {
  return { category: 'Branch Power', description: '', qty: 1, unit: 'EA', ...overrides };
}

describe('normalize()', () => {
  it('unifies quote, decimal and "in" size notation to the same string', () => {
    expect(normalize('3/4" EMT')).toBe(normalize('.75" EMT'));
    expect(normalize('3/4" EMT')).toBe(normalize('3/4 in EMT'));
    expect(normalize('3/4" EMT')).toBe(normalize('3/4 inch EMT'));
  });

  it('is case-insensitive and collapses punctuation/whitespace', () => {
    expect(normalize('Duplex Receptacle, Spec Grade')).toBe('duplex receptacle spec grade');
    expect(normalize('  Duplex   Receptacle ')).toBe('duplex receptacle');
  });
});

describe('mapTakeoffLine — confidence tiers', () => {
  it('exact: normalized description equals a candidate name/alias exactly', () => {
    const m = mapTakeoffLine(line({ description: '3/4" EMT (incl. couplings/straps)', unit: 'C' }), SMALL_LIB);
    expect(m.matchConfidence).toBe('exact');
    expect(m.matchedCode).toBe('EMT-075');
  });

  it('alias: description contains a known alias as a substring', () => {
    const m = mapTakeoffLine(line({ description: 'Duplex receptacle, spec grade (kitchen area)' }), SMALL_LIB);
    expect(m.matchConfidence).toBe('alias');
  });

  it('fuzzy: shares enough core tokens without an exact/alias hit', () => {
    const m = mapTakeoffLine(line({ description: '.75 in EMT conduit run' }), SMALL_LIB);
    expect(m.matchConfidence).toBe('fuzzy');
    expect(m.matchedCode).toBe('EMT-075');
  });

  it('none: unrelated description matches nothing', () => {
    const m = mapTakeoffLine(line({ description: 'Fire alarm pull station, red' }), SMALL_LIB);
    expect(m.matchConfidence).toBe('none');
    expect(m.matchedCode).toBeNull();
  });

  it('a fuzzy candidate whose own name carries a conflicting rating token is disqualified, not just down-ranked', () => {
    // Regression: "400A ... service entrance assembly, NEMA 3R" and "800A ...
    // service entrance assembly, NEMA 3R" share every generic trade word
    // ("service", "entrance", "assembly", "nema") and differ only in the
    // rating. Plain (even frequency-weighted) token overlap let the 400A
    // fuzzy match out-score the 800A alias match on shared words alone,
    // silently pricing an 800A service against 400A hours/material. The
    // mapper must prefer the correct alias hit over ANY fuzzy candidate that
    // carries a rating the description doesn't have.
    const lib: LibraryCandidate[] = [
      { kind: 'assembly', id: 'a400', code: 'ASM-SVCENT-400', name: '400A 3PH service entrance assembly, NEMA 3R', category: 'Service & Distribution', unit: 'EA', aliases: ['400a service entrance assembly'] },
      { kind: 'assembly', id: 'a800', code: 'ASM-SVCENT-800', name: '800A 120/208V 3PH 4W service entrance assembly, NEMA 3R', category: 'Service & Distribution', unit: 'EA', aliases: ['800a 120/208v 3ph 4w service entrance assembly, nema 3r', '800a service entrance assembly'] },
    ];
    const m = mapTakeoffLine(line({
      category: 'Service & Distribution', unit: 'EA',
      description: '800A 120/208V 3PH 4W service entrance assembly, NEMA 3R (ECFECI)',
    }), lib);
    expect(m.matchedCode).toBe('ASM-SVCENT-800');
    expect(m.matchConfidence).toBe('alias');
  });
});

describe('mapTakeoffLine — tie-break and disambiguation', () => {
  it('prefers an assembly over a bare item when both match equally well', () => {
    const m = mapTakeoffLine(line({ description: '20A 125V duplex receptacle, spec grade' }), SMALL_LIB);
    expect(m.matchedKind).toBe('assembly');
    expect(m.matchedCode).toBe('ASM-DUPLEX');
  });

  it('same-unit candidates rank above a same-text candidate of the wrong unit', () => {
    const lib: LibraryCandidate[] = [
      { kind: 'item', id: 'a', code: 'A', name: 'Ground rod', category: 'Grounding', unit: 'LF', aliases: [] },
      { kind: 'item', id: 'b', code: 'B', name: 'Ground rod', category: 'Grounding', unit: 'EA', aliases: [] },
    ];
    const m = mapTakeoffLine(line({ description: 'Ground rod', category: 'Grounding', unit: 'EA' }), lib);
    expect(m.matchedCode).toBe('B');
  });
});

describe('mapTakeoffLine — VERIFY quantities are never coerced', () => {
  it('a string qty like "VERIFY" maps to qty 0 and sourceConfidence VERIFY', () => {
    const m = mapTakeoffLine(line({ description: '20A 125V duplex receptacle, spec grade', qty: 'VERIFY' }), SMALL_LIB);
    expect(m.qty).toBe(0);
    expect(m.isVerifyQty).toBe(true);
    expect(m.sourceConfidence).toBe('VERIFY');
  });

  it('a numeric qty passed as a numeric string is NOT treated as VERIFY', () => {
    const m = mapTakeoffLine(line({ description: '20A 125V duplex receptacle, spec grade', qty: '12' }), SMALL_LIB);
    expect(m.qty).toBe(12);
    expect(m.isVerifyQty).toBe(false);
  });

  it("a takeoff-stated confidence (FIRM/APPROX) passes through untouched", () => {
    const m = mapTakeoffLine(line({ description: '20A 125V duplex receptacle, spec grade', qty: 5, sourceConfidence: 'APPROX' }), SMALL_LIB);
    expect(m.sourceConfidence).toBe('APPROX');
    expect(m.isVerifyQty).toBe(false);
  });
});

describe('adapters', () => {
  it('fromTakeoffCategories reads the bidstd TakeoffCategory/TakeoffItem shape, carrying the short item id through', () => {
    const lines = fromTakeoffCategories([
      { name: 'Branch Power', items: [{ item: '5.1', description: 'Duplex receptacle', unit: 'EA', qty: 10, conf: 'FIRM' }] },
    ]);
    expect(lines).toEqual([{
      category: 'Branch Power', description: 'Duplex receptacle', takeoffItemId: '5.1',
      qty: 10, unit: 'EA', sourceConfidence: 'FIRM',
    }]);
  });

  it('falls back to the item id as the match text when description is blank (but still reports it as takeoffItemId too)', () => {
    const lines = fromTakeoffCategories([
      { name: 'Branch Power', items: [{ item: 'Duplex receptacle', description: '', unit: 'EA', qty: 10 }] },
    ]);
    expect(lines[0].description).toBe('Duplex receptacle');
    expect(lines[0].takeoffItemId).toBe('Duplex receptacle');
  });

  it('fromLegacyTakeoff reads the Agent 2/4 { category, item, spec, qty, unit, confidence } shape — item is the short id, spec is the match text', () => {
    const lines = fromLegacyTakeoff([
      { category: 'LIGHTING', item: '2.1', spec: 'LED Troffer 2x4', qty: 48, unit: 'EA', confidence: 'VERIFIED' },
    ]);
    // "VERIFIED" isn't one of FIRM/APPROX/VERIFY — normalizeSourceConfidence drops
    // anything it doesn't recognize rather than guessing.
    expect(lines).toEqual([{
      category: 'LIGHTING', description: 'LED Troffer 2x4', takeoffItemId: '2.1',
      qty: 48, unit: 'EA', sourceConfidence: null,
    }]);
  });

  it('fromLegacyTakeoff falls back to `item` as the match text when spec is absent (older callers/fixtures)', () => {
    const lines = fromLegacyTakeoff([
      { category: 'LIGHTING', item: 'LED Troffer 2x4', qty: 48, unit: 'EA' },
    ]);
    expect(lines[0].description).toBe('LED Troffer 2x4');
    expect(lines[0].takeoffItemId).toBe('LED Troffer 2x4');
  });
});

describe('mapper on real fixture phrasing (SEED_ITEMS/SEED_ASSEMBLIES vs bid_data.example.json)', () => {
  it('maps at least 85% of a real bid takeoff to something', () => {
    const fixturePath = path.join(__dirname, '../test/fixtures/bidstd/bid_data.example.json');
    const bidData = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
      takeoff: { name: string; items: { item: string; description: string; unit: string; qty: number | string; conf?: string }[] }[];
    };
    const takeoffLines = fromTakeoffCategories(bidData.takeoff);
    const library = libraryFromSeed();
    const mapped = mapTakeoffLines(takeoffLines, library);

    const matched = mapped.filter(m => m.matchConfidence !== 'none');
    const rate = matched.length / mapped.length;
    // eslint-disable-next-line no-console
    console.log(`[mapper fixture] ${matched.length}/${mapped.length} lines matched (${(rate * 100).toFixed(1)}%)`);
    for (const m of mapped) {
      // eslint-disable-next-line no-console
      console.log(`  [${m.matchConfidence.padEnd(5)}] ${m.description} -> ${m.matchedCode ?? '(none)'}`);
    }

    expect(rate).toBeGreaterThanOrEqual(0.85);
  });
});
