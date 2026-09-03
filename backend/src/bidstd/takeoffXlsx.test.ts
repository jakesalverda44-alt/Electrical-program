import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import ExcelJS from 'exceljs';
import { renderTakeoffXlsx, takeoffXlsxFilename, wantsFurnish } from './takeoffXlsx';
import { BidData } from './bidData';
import { TAKEOFF_CATEGORIES } from './boilerplate';

const fixture: BidData = JSON.parse(
  readFileSync(join(__dirname, '../test/fixtures/bidstd/bid_data.example.json'), 'utf8')
);

async function readBack(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  // exceljs's own @types/node (nested, a different version than the repo's
  // top-level one) makes its Buffer type structurally incompatible with ours
  // — a pre-existing cross-package @types/node version mismatch, not a real
  // type error, so this cast is safe.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buf as any);
  return wb.getWorksheet('Quantity Takeoff')!;
}

/** The column-header row is the first row whose first cell reads "ITEM" —
 *  found dynamically rather than assuming a fixed row number, since the
 *  header block's row count varies with which optional fields are present. */
function findHeaderRow(ws: ExcelJS.Worksheet): ExcelJS.Row {
  let found: ExcelJS.Row | undefined;
  ws.eachRow(row => {
    if (!found && row.getCell(1).value === 'ITEM') found = row;
  });
  if (!found) throw new Error('column-header row (ITEM) not found');
  return found;
}

describe('takeoffXlsxFilename', () => {
  it('GC mode: [Project]_Quantity_Takeoff.xlsx', () => {
    expect(takeoffXlsxFilename(fixture, false)).toBe(`${fixture.project_slug}_Quantity_Takeoff.xlsx`);
  });
  it('pre-bid mode: [Project]_PreBid_Quantity_Takeoff.xlsx', () => {
    expect(takeoffXlsxFilename(fixture, true)).toBe(`${fixture.project_slug}_PreBid_Quantity_Takeoff.xlsx`);
  });
});

describe('wantsFurnish', () => {
  it('true when any item carries furnish_by', () => {
    expect(wantsFurnish(fixture)).toBe(true); // fixture's 1.1/1.2 carry "APT (ECFECI)"
  });
  it('false when no item carries furnish_by', () => {
    const stripped: BidData = {
      ...fixture,
      takeoff: fixture.takeoff.map(c => ({ ...c, items: c.items.map(i => ({ ...i, furnish_by: undefined })) })),
    };
    expect(wantsFurnish(stripped)).toBe(false);
  });
});

describe('renderTakeoffXlsx — GC mode', () => {
  it('renders without throwing and returns the GC filename', async () => {
    const { buffer, filename } = await renderTakeoffXlsx(fixture);
    expect(buffer.length).toBeGreaterThan(0);
    expect(filename).toBe(`${fixture.project_slug}_Quantity_Takeoff.xlsx`);
  });

  it('column headers omit CONF. (GC mode has no confidence column)', async () => {
    const { buffer } = await renderTakeoffXlsx(fixture, { furnish: false });
    const ws = await readBack(buffer);
    const values = findHeaderRow(ws).values as unknown[];
    expect(values).toContain('ITEM');
    expect(values).toContain('DESCRIPTION');
    expect(values).toContain('SOURCE / BASIS / NOTES');
    expect(values).not.toContain('CONF.');
  });

  it('includes the FURNISH BY column automatically (fixture items carry furnish_by)', async () => {
    const { buffer } = await renderTakeoffXlsx(fixture);
    const ws = await readBack(buffer);
    expect(findHeaderRow(ws).values as unknown[]).toContain('FURNISH BY');
  });

  it('every standard category renders as a navy/accent band row, in the standard order', async () => {
    const { buffer } = await renderTakeoffXlsx(fixture);
    const ws = await readBack(buffer);
    const bandTexts: string[] = [];
    ws.eachRow(row => {
      const v = row.getCell(1).value;
      if (typeof v === 'string' && TAKEOFF_CATEGORIES.some(c => v === c.toUpperCase())) {
        bandTexts.push(v);
      }
    });
    expect(bandTexts).toEqual(TAKEOFF_CATEGORIES.map(c => c.toUpperCase()));
  });

  it('building_area and interior_breakdown appear in the header block', async () => {
    const { buffer } = await renderTakeoffXlsx(fixture);
    const ws = await readBack(buffer);
    const allText: string[] = [];
    ws.eachRow(row => allText.push(String(row.getCell(1).value ?? '')));
    expect(allText.some(t => t.startsWith('Building area:'))).toBe(true);
    expect(allText.some(t => t.startsWith('Interior breakdown:'))).toBe(true);
  });

  it('the NOTES block renders every takeoff_notes entry', async () => {
    const { buffer } = await renderTakeoffXlsx(fixture);
    const ws = await readBack(buffer);
    const allText: string[] = [];
    ws.eachRow(row => allText.push(String(row.getCell(1).value ?? '')));
    for (const note of fixture.takeoff_notes ?? []) {
      expect(allText.some(t => t.includes(note))).toBe(true);
    }
  });
});

describe('renderTakeoffXlsx — pre-bid mode', () => {
  it('adds the CONF. column and fills FIRM green / non-FIRM yellow', async () => {
    const data: BidData = {
      ...fixture,
      takeoff: [{
        name: 'Service & Distribution',
        items: [
          { item: '1.1', description: 'Firm item', unit: 'EA', qty: 1, conf: 'FIRM', source: 'x' },
          { item: '1.2', description: 'Approx item', unit: 'EA', qty: 2, conf: 'APPROX', source: 'x' },
          { item: '1.3', description: 'Verify item', unit: 'EA', qty: 3, conf: 'VERIFY', source: 'x' },
        ],
      }],
    };
    const { buffer, filename } = await renderTakeoffXlsx(data, { prebid: true, furnish: false });
    expect(filename).toBe(`${fixture.project_slug}_PreBid_Quantity_Takeoff.xlsx`);
    const ws = await readBack(buffer);

    const headerRow = findHeaderRow(ws);
    expect(headerRow.values as unknown[]).toContain('CONF.');
    // CONF. is the 5th column (ITEM,DESCRIPTION,UNIT,QTY,CONF.) — furnish disabled.
    const confCol = (headerRow.values as unknown[]).indexOf('CONF.');

    let firmRow = -1, approxRow = -1, verifyRow = -1;
    ws.eachRow((row, rowNumber) => {
      const desc = row.getCell(2).value;
      if (desc === 'Firm item') firmRow = rowNumber;
      if (desc === 'Approx item') approxRow = rowNumber;
      if (desc === 'Verify item') verifyRow = rowNumber;
    });
    expect(firmRow).toBeGreaterThan(0);
    expect(approxRow).toBeGreaterThan(0);
    expect(verifyRow).toBeGreaterThan(0);

    const fillOf = (row: number) => (ws.getCell(row, confCol).fill as ExcelJS.FillPattern).fgColor?.argb;
    expect(fillOf(firmRow)).toBe('FFE2EFDA');
    expect(fillOf(approxRow)).toBe('FFFFF2CC');
    expect(fillOf(verifyRow)).toBe('FFFFF2CC');
  });

  it('never appears on GC mode (conf is dropped entirely)', async () => {
    const { buffer } = await renderTakeoffXlsx(fixture, { prebid: false, furnish: false });
    const ws = await readBack(buffer);
    expect(findHeaderRow(ws).values as unknown[]).not.toContain('CONF.');
  });
});

describe('renderTakeoffXlsx — furnish override', () => {
  it('opts.furnish=true forces the column on even with no furnish_by data', async () => {
    const stripped: BidData = {
      ...fixture,
      takeoff: fixture.takeoff.map(c => ({ ...c, items: c.items.map(i => ({ ...i, furnish_by: undefined })) })),
    };
    const { buffer } = await renderTakeoffXlsx(stripped, { furnish: true });
    const ws = await readBack(buffer);
    expect(findHeaderRow(ws).values as unknown[]).toContain('FURNISH BY');
  });

  it('opts.furnish=false suppresses the column even with furnish_by data present', async () => {
    const { buffer } = await renderTakeoffXlsx(fixture, { furnish: false });
    const ws = await readBack(buffer);
    expect(findHeaderRow(ws).values as unknown[]).not.toContain('FURNISH BY');
  });
});
