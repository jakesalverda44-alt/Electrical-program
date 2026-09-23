// Estimating Phase B, Task 7 — exhaustive tests for tagSuggest.ts: whole-
// token matching, title-block exclusion (rotation-aware, all four
// rotations), the table-region heuristic, and schedule-sheet exclusion.
import { describe, it, expect } from 'vitest';
import { suggestTagMarkers, TextItem, candidateTagsFromDescription, buildLineTagIndex, tokenize } from './tagSuggest';
import { PageGeometry } from './overlay';

function item(str: string, x: number, y: number, extra: Partial<TextItem> = {}): TextItem {
  return { str, transform: [10, 0, 0, 10, x, y], ...extra };
}

describe('suggestTagMarkers — whole-token matching', () => {
  const geom: PageGeometry = { widthPt: 800, heightPt: 600, rotation: 0 };

  it('matches a bare tag exactly', () => {
    const out = suggestTagMarkers([item('A', 100, 100)], ['A'], { geom });
    expect(out.length).toBe(1);
    expect(out[0].tag).toBe('A');
  });

  it('does NOT match tag "A" inside "A1" (no separator)', () => {
    const out = suggestTagMarkers([item('A1', 100, 100)], ['A'], { geom });
    expect(out).toEqual([]);
  });

  it('does NOT match tag "A" inside "AMP" (no separator)', () => {
    const out = suggestTagMarkers([item('AMP', 100, 100)], ['A'], { geom });
    expect(out).toEqual([]);
  });

  it('DOES match tag "A" when separated by a hyphen ("A-1" tokenizes to ["A","1"])', () => {
    const out = suggestTagMarkers([item('A-1', 100, 100)], ['A'], { geom });
    expect(out.map(c => c.tag)).toEqual(['A']);
  });

  it('is case-insensitive', () => {
    const out = suggestTagMarkers([item('type a', 100, 100)], ['A'], { geom });
    expect(out.some(c => c.tag === 'A')).toBe(true);
  });

  it('matches "Type A" as two tokens, and a tag list with "TYPE" or "A" each independently matches', () => {
    const out = suggestTagMarkers([item('Type A', 100, 100)], ['TYPE', 'A', 'B'], { geom });
    expect(out.map(c => c.tag).sort()).toEqual(['A', 'TYPE']);
  });

  it('an item matching no tag produces nothing', () => {
    const out = suggestTagMarkers([item('LIGHTING PLAN', 100, 100)], ['A', 'B1'], { geom });
    expect(out).toEqual([]);
  });

  it('returns [] for an empty tag list or an empty item list', () => {
    expect(suggestTagMarkers([item('A', 1, 1)], [], { geom })).toEqual([]);
    expect(suggestTagMarkers([], ['A'], { geom })).toEqual([]);
  });

  it('centers the candidate point using width/height when the item provides them', () => {
    const out = suggestTagMarkers([item('A', 100, 100, { width: 20, height: 10 })], ['A'], { geom });
    expect(out[0].point).toEqual({ x: 110, y: 105 });
  });

  it('falls back to the item origin when width/height are absent', () => {
    const out = suggestTagMarkers([item('A', 100, 100)], ['A'], { geom });
    expect(out[0].point).toEqual({ x: 100, y: 100 });
  });

  it('carries the full item text for a hover/tooltip', () => {
    const out = suggestTagMarkers([item('Type A - LED troffer', 100, 100)], ['A'], { geom });
    expect(out[0].text).toBe('Type A - LED troffer');
  });
});

describe('suggestTagMarkers — title-block strip exclusion (rotation-aware)', () => {
  // 800x600 page. At rotation 0, the strip is displayed x >= 0.75*800=600 —
  // an item's raw PDF x IS its displayed x, so x=650 is in the strip and
  // x=100 is not.
  it('rotation 0: excludes an item in the displayed right 25%, keeps one outside it', () => {
    const geom: PageGeometry = { widthPt: 800, heightPt: 600, rotation: 0 };
    const inStrip = suggestTagMarkers([item('A', 650, 300)], ['A'], { geom });
    const outsideStrip = suggestTagMarkers([item('A', 100, 300)], ['A'], { geom });
    expect(inStrip).toEqual([]);
    expect(outsideStrip.length).toBe(1);
  });

  // At rotation 90, displayed width becomes 600 (heightPt), and pdf(x,y) ->
  // displayed (y, x) at scale 1 (per overlay.ts's verified matrix: case 90
  // is [0,1,1,0,0,0], i.e. displayedX=pdfY, displayedY=pdfX). So a PDF point
  // whose Y is large (>=0.75*600=450) lands in the displayed strip — even
  // though its raw PDF X is nowhere near the "right side" of the unrotated
  // page. This is the rotation-awareness this heuristic exists to prove.
  it('rotation 90: a PDF point with a large Y (not X) lands in the displayed strip', () => {
    const geom: PageGeometry = { widthPt: 800, heightPt: 600, rotation: 90 };
    const displayedInStrip = suggestTagMarkers([item('A', 100, 500)], ['A'], { geom }); // pdfY=500 -> displayedX=500 >= 450
    const displayedOutsideStrip = suggestTagMarkers([item('A', 100, 100)], ['A'], { geom }); // displayedX=100
    expect(displayedInStrip).toEqual([]);
    expect(displayedOutsideStrip.length).toBe(1);
  });

  it('rotation 180: the strip flips to the LEFT side of raw PDF coordinates', () => {
    const geom: PageGeometry = { widthPt: 800, heightPt: 600, rotation: 180 };
    // case 180: displayedX = -x + width. A raw PDF x near 0 displays near the
    // right edge (in the strip); a raw PDF x near width displays near 0 (not).
    const nearZero = suggestTagMarkers([item('A', 50, 300)], ['A'], { geom }); // displayedX = 800-50=750 -> in strip
    const nearWidth = suggestTagMarkers([item('A', 750, 300)], ['A'], { geom }); // displayedX = 800-750=50 -> not
    expect(nearZero).toEqual([]);
    expect(nearWidth.length).toBe(1);
  });

  it('rotation 270: mirrors rotation 90\'s Y-driven strip test', () => {
    const geom: PageGeometry = { widthPt: 800, heightPt: 600, rotation: 270 };
    // case 270: displayedX = -y + height(=600). A small pdfY displays near
    // the right edge (in the strip, since 600-small is large).
    const smallY = suggestTagMarkers([item('A', 100, 50)], ['A'], { geom }); // displayedX = 600-50=550 >= 450 -> in strip
    const largeY = suggestTagMarkers([item('A', 100, 550)], ['A'], { geom }); // displayedX = 600-550=50 -> not
    expect(smallY).toEqual([]);
    expect(largeY.length).toBe(1);
  });

  // Fix round 1 / S1 — a non-zero page origin (overlay.ts's originXPt/
  // originYPt) needs to be subtracted before the strip boundary check,
  // same as the geometry fix itself; this only started working once
  // overlay.ts's pdfToScreen/renderedSize gained origin support (this
  // function was already rotation-aware via those same two calls, so
  // origin support here comes for free from that one shared fix).
  it('a non-zero origin shifts the strip boundary, not just the raw comparison', () => {
    // width 800, origin x0=200 -> the page spans absolute x in [200,1000].
    // Right-25% boundary in absolute x = 200 + 0.75*800 = 800.
    const geom: PageGeometry = { widthPt: 800, heightPt: 600, rotation: 0, originXPt: 200, originYPt: 0 };
    // Absolute x=850 -> relX=650 -> in strip (650 >= 600).
    const inStrip = suggestTagMarkers([item('A', 850, 300)], ['A'], { geom });
    // Absolute x=750 -> relX=550 -> NOT in strip, even though a
    // zero-origin (buggy) check (raw 750 >= 0.75*800=600) would have
    // wrongly included it.
    const outsideStrip = suggestTagMarkers([item('A', 750, 300)], ['A'], { geom });
    expect(inStrip).toEqual([]);
    expect(outsideStrip.length).toBe(1);
  });
});

// Fix round 1 / N9 — a suggested marker's center used to always add
// width/2 to x, regardless of the text run's OWN rotation (its
// transform's [a,b,c,d], not the page's /Rotate) — a run printed
// vertically got its center offset sideways, beside the tag instead of
// on it.
describe('suggestTagMarkers — marker centering respects the text item\'s own rotation (N9)', () => {
  const geom: PageGeometry = { widthPt: 800, heightPt: 600, rotation: 0 };

  it('a vertically-printed run (transform [0,10,-10,0,x,y]) centers along Y, not X', () => {
    const verticalItem: TextItem = { str: 'A1', transform: [0, 10, -10, 0, 100, 100], width: 20, height: 10 };
    const out = suggestTagMarkers([verticalItem], ['A1'], { geom });
    // Old (buggy) behavior would have been (100+20/2, 100+10/2) =
    // (110, 105) — sideways of the actual vertical run. The run's local
    // +x is (0,1) (from [a,b]=[0,10] normalized) and local +y is (-1,0)
    // (from [c,d]=[-10,0] normalized): center = (100 + 20/2*0 + 10/2*-1,
    // 100 + 20/2*1 + 10/2*0) = (95, 110).
    expect(out[0].point).toEqual({ x: 95, y: 110 });
  });

  it('ordinary horizontal text (transform [10,0,0,10,x,y]) is unaffected — same as before N9', () => {
    const horizontalItem: TextItem = { str: 'A1', transform: [10, 0, 0, 10, 100, 100], width: 20, height: 10 };
    const out = suggestTagMarkers([horizontalItem], ['A1'], { geom });
    expect(out[0].point).toEqual({ x: 110, y: 105 });
  });
});

describe('suggestTagMarkers — table-region heuristic', () => {
  const geom: PageGeometry = { widthPt: 800, heightPt: 600, rotation: 0 };

  function buildGrid(rows: number, cols: number, colXs: number[], rowYs: number[], tagText: string): TextItem[] {
    const items: TextItem[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Only tag the first column's text so we can tell whether the TAG
        // ITSELF was excluded (not just untagged filler cells).
        items.push(item(c === 0 ? tagText : `VAL${r}${c}`, colXs[c], rowYs[r]));
      }
    }
    return items;
  }

  it('excludes a tag sitting inside a dense aligned grid (a schedule table)', () => {
    const colXs = [50, 150, 250, 350];
    const rowYs = [500, 480, 460, 440, 420]; // 5 rows, well left of the title-block strip (x<600)
    const items = buildGrid(5, 4, colXs, rowYs, 'A');
    const out = suggestTagMarkers(items, ['A'], { geom });
    expect(out).toEqual([]); // every "A" cell sits in the detected table
  });

  it('does NOT exclude a handful of scattered tags with no grid pattern', () => {
    const items = [item('A', 100, 500), item('A', 250, 300), item('A', 400, 150)];
    const out = suggestTagMarkers(items, ['A'], { geom });
    expect(out.length).toBe(3);
  });

  it('a small grid below the row/column thresholds is NOT treated as a table', () => {
    // Only 2 rows x 2 cols — below MIN_ROWS_FOR_TABLE/MIN_ITEMS_PER_ROW.
    const items = buildGrid(2, 2, [100, 200], [500, 480], 'A');
    const out = suggestTagMarkers(items, ['A'], { geom });
    expect(out.length).toBe(2); // both "A" cells kept
  });
});

describe('suggestTagMarkers — schedule-like sheet kinds never produce suggestions', () => {
  const geom: PageGeometry = { widthPt: 800, heightPt: 600, rotation: 0 };
  const items = [item('A', 100, 100)];

  it('schedule, cover, and riser sheets return [] regardless of content', () => {
    expect(suggestTagMarkers(items, ['A'], { geom, sheetKind: 'schedule' })).toEqual([]);
    expect(suggestTagMarkers(items, ['A'], { geom, sheetKind: 'cover' })).toEqual([]);
    expect(suggestTagMarkers(items, ['A'], { geom, sheetKind: 'riser' })).toEqual([]);
  });

  it('plan, detail, and other sheet kinds process normally', () => {
    expect(suggestTagMarkers(items, ['A'], { geom, sheetKind: 'plan' }).length).toBe(1);
    expect(suggestTagMarkers(items, ['A'], { geom, sheetKind: 'detail' }).length).toBe(1);
    expect(suggestTagMarkers(items, ['A'], { geom, sheetKind: 'other' }).length).toBe(1);
  });

  it('no sheetKind at all processes normally (opts.sheetKind is optional)', () => {
    expect(suggestTagMarkers(items, ['A'], { geom }).length).toBe(1);
  });
});

describe('candidateTagsFromDescription — Task 7 (deferral closed)', () => {
  it('extracts every plan-tag-like token (letters+digits together, 2-6 chars, has a digit)', () => {
    // Fix round 1 / S3 — "2x4" tokenizes to "2X4" (x is alphanumeric, no
    // separator) and used to be treated as tag-like as "A1" by the old
    // "2-6 chars, has a digit" rule alone; it's now explicitly excluded as
    // a dimension pattern (^\d+X\d+$) — a fixture SIZE, never a plan tag.
    expect(candidateTagsFromDescription('Type A1 - 2x4 LED troffer')).toEqual(['A1']);
  });

  // Fix round 1 / S3 — the old rule ("2-6 chars, contains a digit") let a
  // spec-heavy description flood the sheet with false suggested markers:
  // a wire gauge ("#12" -> "12"), amp/voltage ratings ("20A", "125V"), and
  // a fixture dimension ("2X4") all read as tag-like. A real device tag
  // always mixes letters and digits AND isn't one of these specific shapes.
  it('rejects rating/spec tokens (amps, volts, watts, poles, wire gauge, NEMA enclosure ratings) and dimension pairs', () => {
    expect(candidateTagsFromDescription('#12 THHN wire')).toEqual([]);
    expect(candidateTagsFromDescription('20A 125V duplex receptacle, NEMA 3R enclosure')).toEqual([]);
    expect(candidateTagsFromDescription('2P breaker, 4KVA transformer, 500KCMIL feeder, 4AWG ground')).toEqual([]);
    expect(candidateTagsFromDescription('2X4 LED troffer, 4X8 panel')).toEqual([]);
  });

  it('still extracts a real device tag even alongside rating/dimension noise in the same description', () => {
    expect(candidateTagsFromDescription('A1 - 2x4 LED troffer, 20A 125V')).toEqual(['A1']);
  });

  it('rejects a pure number even inside the 2-6 char range (no letter at all)', () => {
    expect(candidateTagsFromDescription('circuit 12 panel 1234')).toEqual([]);
  });

  it('extracts multiple distinct candidates in description order, deduped', () => {
    expect(candidateTagsFromDescription('ATS1 feeding panel A1, also A1 again')).toEqual(['ATS1', 'A1']);
  });

  it('rejects ordinary words with no digit, even if short', () => {
    expect(candidateTagsFromDescription('LED troffer fixture')).toEqual([]);
  });

  it('rejects a bare single-character token (too short) and an over-long one', () => {
    expect(candidateTagsFromDescription('A 1 PANELBOARD1234')).toEqual([]);
  });

  it('a hyphenated equipment tag like "ATS-1" does NOT qualify — the hyphen splits letters from digits into two tokens, neither of which alone is both short-and-digit-bearing (a known, documented limitation)', () => {
    expect(candidateTagsFromDescription('ATS-1 automatic transfer switch (APT ECFECI)')).toEqual([]);
  });

  it('a hyphen-free equipment tag qualifies directly', () => {
    expect(candidateTagsFromDescription('ATS1 automatic transfer switch')).toEqual(['ATS1']);
  });

  it('an empty description yields no candidates', () => {
    expect(candidateTagsFromDescription('')).toEqual([]);
  });
});

describe('buildLineTagIndex — Task 7 (deferral closed)', () => {
  it('maps a candidate tag to the one line that produced it', () => {
    const idx = buildLineTagIndex([{ line_key: 'l1', description: 'Type A1 fixture' }]);
    expect(idx.get('A1')).toEqual(['l1']);
  });

  it('maps a tag claimed by two different lines to both line_keys', () => {
    const idx = buildLineTagIndex([
      { line_key: 'l1', description: 'Type A1 fixture, 2x4' },
      { line_key: 'l2', description: 'Type A1 emergency variant' },
    ]);
    expect(idx.get('A1')).toEqual(['l1', 'l2']);
  });

  it('skips a line with no line_key (not yet saved — nothing to assign a marker to)', () => {
    const idx = buildLineTagIndex([{ description: 'Type A1 fixture' }]);
    expect(idx.has('A1')).toBe(false);
  });

  it('a line with no candidate tags contributes nothing', () => {
    const idx = buildLineTagIndex([{ line_key: 'l1', description: 'Generic conduit run' }]);
    expect(idx.size).toBe(0);
  });
});

describe('tokenize — exported for reuse by candidate-tag extraction', () => {
  it('splits on any non-alphanumeric run and uppercases', () => {
    expect(tokenize('Type A-1, panel 2')).toEqual(['TYPE', 'A', '1', 'PANEL', '2']);
  });
});
