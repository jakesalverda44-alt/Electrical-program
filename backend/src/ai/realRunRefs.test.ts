// Real-run fix 1 — "Referenced sheet X not in analysis" from spec-section
// citations. The live Kissimmee run (2026-09-24) raised 13 of them: Agent 1's
// missingSheets said "Spec 16050 …", "Spec Section 16480 …", "Section 02200
// …", "Structural drawings (referenced Sec 01410 3.09)", and the old
// extractor read "pec160", "ion164", "Sec014" out of the middle of words.
import { describe, it, expect } from 'vitest';
import { referencedSheetItems, reviewItemIsOpen, sheetIdCandidates } from './reviewItems';
import { learnSheetPattern, normalizeSheetId } from './sheetRefs';
import { loadKissimmeeLive, liveBlocking } from '../test/fixtures/realrun/kissimmeeLive';

const live = loadKissimmeeLive();
const pattern = learnSheetPattern(live.inventory.map(p => p.sheetNo));
const loaded = new Set(live.inventory.map(p => normalizeSheetId(p.sheetNo)).filter((k): k is string => !!k));

describe('real-run fix 1 — references must be sheet numbers of THIS set', () => {
  it('the live run raised 13 refsheet items, 12 of them spec sections read as sheets', () => {
    const before = liveBlocking(live).filter(i => i.id.startsWith('refsheet:')).map(i => i.id).sort();
    expect(before).toEqual([
      'refsheet:ION10', 'refsheet:ION104', 'refsheet:ION14', 'refsheet:ION155', 'refsheet:ION164', 'refsheet:ION165', 'refsheet:ION22',
      'refsheet:PEC10', 'refsheet:PEC160', 'refsheet:PEC164', 'refsheet:PEC165', 'refsheet:SEC14', 'refsheet:SGN101',
    ]);
  });

  it('the real missingSheets strings: no spec section, no truncated token, becomes a blocking sheet item', () => {
    const items = referencedSheetItems(live.agent1.missingSheets, { loadedSheetKeys: loaded, checkRefKeys: new Set() }, normalizeSheetId, { pattern });
    expect(items.filter(reviewItemIsOpen)).toEqual([]);
    // SGN101 (the sign vendor's foundation drawing) is not a sheet number of
    // this set (E-1, C1.1, PH0.1, A-1.2 …): information only, never dropped.
    expect(items.map(i => [i.id, i.blocking])).toEqual([['refsheet:SGN101', false]]);
    expect(items[0].title).toBe('Drawing SGN101 named — not a sheet number of this set');
  });

  it('each spec-citation string on its own yields no candidate at all', () => {
    for (const s of [
      'Spec 16050 Basic Electrical Materials and Methods', 'Spec 16400 Electric Service Entrance', 'Spec 01020 AutoZone Vendor List',
      'Spec Section 16480 Panelboards', 'Spec Section 15500 Mechanical Equipment', 'Spec Section 10426 Signs',
      'Section 16400 Fused Main Disconnects', 'Structural drawings (referenced Sec 01410 3.09)', 'Section 02200 Earthwork (referenced)',
      'Spec Section 01010 Summary of Work', 'Spec Section 01410 Testing', 'SECTION 26 05 19', 'Div 16 Electrical',
    ]) expect(sheetIdCandidates(s), s).toEqual([]);
  });

  it('real sheet ids still come through — whole tokens, several per string', () => {
    expect(sheetIdCandidates('E-9 (see note 5 on E-3)').map(c => c.id)).toEqual(['E-9', 'E-3']);
    expect(sheetIdCandidates('Photometric PH0.1 and C1.1').map(c => c.id)).toEqual(['PH0.1', 'C1.1']);
    expect(sheetIdCandidates('SGN101 Sign Vendor Foundation Drawing').map(c => c.id)).toEqual(['SGN101']);
    // Truncated pieces of words never are ids.
    expect(sheetIdCandidates('Specification160 Precast')).toEqual([]);
  });

  it('a missing sheet with this set\'s shape still blocks (E-8 in a set of E-1 … E-7)', () => {
    const items = referencedSheetItems(['E-8 Site Photometrics', 'Spec 16500 Lighting'], { loadedSheetKeys: loaded, checkRefKeys: new Set() }, normalizeSheetId, { pattern });
    expect(items.map(i => [i.id, i.blocking])).toEqual([['refsheet:E8', undefined]]);
    expect(items.filter(reviewItemIsOpen).length).toBe(1);
  });
});
