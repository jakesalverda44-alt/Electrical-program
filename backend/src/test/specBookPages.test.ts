// Plans-panel fix round — review eb39943, B1 (blocker) fix: computeSpecBookPages
// is a deterministic, text-only annotation used ONLY by the sheet summary. It
// never touches discipline/role/selection — the tests below prove both halves:
// the function's own guard (a sheet number always wins) and that
// applySelection is completely blind to the flag it produces.
import { describe, it, expect } from 'vitest';
import { looksLikeSpecText, computeSpecBookPages, type SpecCandidatePage } from '../ai/specBookPages';
import { applySelection, type CheckedPage } from '../services/sheetCheck';

const SPEC_TEXT = `SECTION 26 05 19 - LOW-VOLTAGE ELECTRICAL POWER CONDUCTORS AND CABLES
PART 1 - GENERAL
1.1 SUMMARY
A. Section includes building wires and cables rated 600 V and less, and associated connectors, splices, and terminations.
B. Related sections: Section 26 05 00 - Common Work Results for Electrical.
1.2 REFERENCES
A. NFPA 70 - National Electrical Code.
B. UL 83 - Thermoplastic-Insulated Wires and Cables.
1.3 SUBMITTALS
A. Product data for each type of product specified.
`.repeat(2);

// Reproduced from the review: Kissimmee E-1's real title-block-strip crop is
// mostly dense running notes above the title block ("WORK INCLUDED: A.
// CONDUIT, WIRES… SERVICE ENTRANCE, ELECTRIC AND TELEPHONE… PANELBOARDS: A.
// INSTALL…") — long, dense text, but it carries a real sheet number (E-1).
const E1_NOTES_TEXT = `
GENERAL NOTES
WORK INCLUDED: A. CONDUIT, WIRES, FIXTURES, PANELBOARDS AND ALL OTHER MATERIAL AND EQUIPMENT REQUIRED TO PROVIDE A COMPLETE ELECTRICAL SYSTEM. B. SERVICE ENTRANCE, ELECTRIC AND TELEPHONE, SHALL BE COORDINATED WITH THE UTILITY COMPANY. PANELBOARDS: A. INSTALL PANELBOARDS PLUMB AND SECURE TO STRUCTURE, PROVIDE TYPED DIRECTORY CARDS FOR EACH PANEL. B. PROVIDE COPPER BUS AND GROUND BUS IN EACH PANEL. C. ALL BREAKERS SHALL BE BOLT-ON TYPE.
`.repeat(3);

function candidate(overrides: Partial<SpecCandidatePage>): SpecCandidatePage {
  return { key: 'sha#1', sha: 'sha', sheetNo: '', text: '', ...overrides };
}

describe('looksLikeSpecText', () => {
  it('recognizes dense text with section numbering', () => {
    expect(looksLikeSpecText(SPEC_TEXT)).toBe(true);
  });
  it('never matches short text, however it is worded', () => {
    expect(looksLikeSpecText('SECTION 26 05 19')).toBe(false); // a title-block label, not a page of running text
  });
  it('never matches dense text with no section numbering', () => {
    expect(looksLikeSpecText(E1_NOTES_TEXT)).toBe(false);
  });
  it('handles empty/undefined text', () => {
    expect(looksLikeSpecText('')).toBe(false);
    expect(looksLikeSpecText(undefined)).toBe(false);
  });
});

describe('computeSpecBookPages — the sheet-number guard always wins', () => {
  it('E-0.1 "ELECTRICAL SPECIFICATIONS" is never a spec-book page: it has a sheet number', () => {
    const pages = [candidate({ key: 'sha#1', sheetNo: 'E-0.1', text: SPEC_TEXT })];
    expect(computeSpecBookPages(pages).size).toBe(0);
  });

  it('a Division 26 notes sheet printed WITH a sheet number stays a plan sheet', () => {
    const pages = [candidate({ key: 'sha#2', sheetNo: 'E-2', text: SPEC_TEXT })];
    expect(computeSpecBookPages(pages).size).toBe(0);
  });

  it('E-1\'s real dense notes (no section numbering, has a sheet number) is never spec', () => {
    const pages = [candidate({ key: 'sha#1', sheetNo: 'E-1', text: E1_NOTES_TEXT })];
    expect(computeSpecBookPages(pages)).toEqual(new Set());
  });

  it('a page with dense spec text and NO sheet number is a spec-book page', () => {
    const pages = [candidate({ key: 'sha#1', sheetNo: '', text: SPEC_TEXT })];
    expect(computeSpecBookPages(pages)).toEqual(new Set(['sha#1']));
  });
});

describe('computeSpecBookPages — a bound spec book (file-level majority)', () => {
  it('the real Kissimmee-style spec book: every page counts as spec, in the summary only', () => {
    const specSha = 'spec-sha';
    const pages: SpecCandidatePage[] = [
      candidate({ key: `${specSha}#1`, sha: specSha, sheetNo: '', text: 'PROJECT MANUAL\nTABLE OF CONTENTS' }), // short title page, no sheet number
      ...Array.from({ length: 140 }, (_, i) => candidate({ key: `${specSha}#${i + 2}`, sha: specSha, sheetNo: '', text: SPEC_TEXT })),
      candidate({ key: `${specSha}#142`, sha: specSha, sheetNo: '', text: 'END OF PROJECT MANUAL' }),
    ];
    const spec = computeSpecBookPages(pages);
    expect(spec.size).toBe(142);
    // The plan set's own sheets, in a different file, are never touched.
    const planSha = 'plan-sha';
    const planPages: SpecCandidatePage[] = [
      candidate({ key: `${planSha}#1`, sha: planSha, sheetNo: 'E-1', text: E1_NOTES_TEXT }),
      candidate({ key: `${planSha}#2`, sha: planSha, sheetNo: 'E-0.1', text: SPEC_TEXT }),
    ];
    expect(computeSpecBookPages([...pages, ...planPages]).size).toBe(142);
  });

  it('a file that is NOT predominantly spec-like only flags the pages that individually match', () => {
    const sha = 'mixed-sha';
    const pages: SpecCandidatePage[] = [
      candidate({ key: `${sha}#1`, sha, sheetNo: 'E-1', text: E1_NOTES_TEXT }),
      candidate({ key: `${sha}#2`, sha, sheetNo: 'E-2', text: E1_NOTES_TEXT }),
      candidate({ key: `${sha}#3`, sha, sheetNo: '', text: SPEC_TEXT }), // one stray unnumbered spec page, not a majority
      ...Array.from({ length: 7 }, (_, i) => candidate({ key: `${sha}#${i + 4}`, sha, sheetNo: `E-${i + 4}`, text: E1_NOTES_TEXT })),
    ];
    expect(computeSpecBookPages(pages)).toEqual(new Set([`${sha}#3`]));
  });

  it('no candidate pages at all -> an empty set, never throws', () => {
    expect(computeSpecBookPages([])).toEqual(new Set());
  });
});

describe('applySelection is completely blind to specBookPage — selection is byte-identical to main', () => {
  function checkedPage(overrides: Partial<CheckedPage>): CheckedPage {
    return {
      key: 'sha#1', file: 'set.pdf', sha: 'sha', page: 1, sheetNo: 'E-1', title: 'POWER PLAN',
      discipline: 'electrical', cls: 'plan', textChars: 500, hasTextLayer: true, classified: true,
      refs: [], role: 'excluded', reason: '', ...overrides,
    } as CheckedPage;
  }

  it('the same page selects identically whether or not specBookPage is set', () => {
    const withoutFlag = applySelection([checkedPage({})], {});
    const withFlag = applySelection([checkedPage({ specBookPage: true })], {});
    // Strip the flag itself before comparing — everything else (role, reason,
    // discipline, refs, revisionProposals, duplicateSheets) must match exactly.
    const strip = (p: CheckedPage) => { const { specBookPage: _specBookPage, ...rest } = p; return rest; };
    expect(withFlag.pages.map(strip)).toEqual(withoutFlag.pages.map(strip));
    expect(withFlag.refs).toEqual(withoutFlag.refs);
    expect(withFlag.revisionProposals).toEqual(withoutFlag.revisionProposals);
    expect(withFlag.duplicateSheets).toEqual(withoutFlag.duplicateSheets);
  });

  it('a spec-book-flagged page with no sheet number is excluded/included exactly as its discipline says, same as any other page', () => {
    const specLike = checkedPage({ key: 'sha#2', sheetNo: '', title: '', discipline: 'other', specBookPage: true });
    const plain = checkedPage({ key: 'sha#2', sheetNo: '', title: '', discipline: 'other' });
    const a = applySelection([specLike], {});
    const b = applySelection([plain], {});
    expect(a.pages[0].role).toBe(b.pages[0].role);
    expect(a.pages[0].reason).toBe(b.pages[0].reason);
  });
});
