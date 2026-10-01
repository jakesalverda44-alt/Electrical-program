// Gap-closing T12 (J11) — the price refresh diff table for Jake: Chris's Kissimmee BOM (6/18/2026) net costs for the
// APPROVED list (THHN, EMT, PVC, MC, contactor) against the live library; migration 167 carries exactly these values.
// Test-only: prints the table; also shows what the Accubid import's own preview would do with the same BOM.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseAccubidBom } from '../estimating/accubidBom';
import { buildImportPreview } from '../estimating/accubidImport';
import { GAP_PRICE_MOVES } from './gapMigrations';
import { loadLiveLibrary0930 } from '../test/fixtures/realrun/live0930';

const bomText = (j: string) => fs.readFileSync(path.join(__dirname, '../test/fixtures/estimating/accubid', `${j}-bom.txt`), 'utf8');
/** The BOM row each approved code takes its net from (and its divisor to the library unit). */
const SOURCE: Record<string, { re: RegExp; per: number }> = {
  'THHN-12': { re: /^#12 Black Wire THHN/, per: 1 }, 'THHN-10': { re: /^#10 Black Wire THHN/, per: 1 }, 'THHN-6': { re: /^#6 Black Wire THHN/, per: 1 }, 'THHN-3_0': { re: /^#3\/0 Black Wire THHN/, per: 1 },
  'EMT-075': { re: /^3\/4" Conduit - EMT/, per: 1 }, 'EMT-100': { re: /^1" Conduit - EMT/, per: 1 }, 'PVC-100': { re: /^1" Conduit - PVC 40/, per: 1 }, 'PVC-200': { re: /^2" Conduit - PVC 40/, per: 1 },
  'MC-1202': { re: /^#12\/2C MC Cable/, per: 10 }, 'LC-CONTACTOR': { re: /^Lighting Contactor/, per: 1 },
};

describe('T12 — price refresh preview (Kissimmee BOM 6/18/2026, approved list)', () => {
  it('migration 167 = the BOM net for every approved code; prints the diff table and the 36th prices for the record', () => {
    const k = parseAccubidBom(bomText('kissimmee'));
    const s36 = parseAccubidBom(bomText('36th-street'));
    expect(k.reportDate).toBe('2026-06-18');
    const lib = loadLiveLibrary0930().library;
    const row = (bom: typeof k, re: RegExp) => bom.rows.find(r => re.test(r.description.replace(/\s+/g, ' ')));
    const lines: string[] = ['code | library $ | Chris K 6/18/2026 | ratio | Chris 36th (record)'];
    expect(GAP_PRICE_MOVES.map(m => m.code).sort()).toEqual(Object.keys(SOURCE).sort());
    for (const m of GAP_PRICE_MOVES) {
      const src = SOURCE[m.code];
      const r = row(k, src.re)!;
      expect(r, m.code).toBeTruthy();
      expect(Math.round((r.netCost! / src.per) * 100) / 100, m.code).toBe(m.to);
      const cur = lib.items.find(i => i.code === m.code)!.material_cost;
      const r36 = row(s36, src.re);
      lines.push(`${m.code} | ${cur} | ${m.to} | ${(cur / m.to).toFixed(2)} | ${r36?.netCost != null ? Math.round((r36.netCost / src.per) * 100) / 100 : '—'}`);
    }
    const preview = buildImportPreview(bomText('kissimmee'), lib, { updatePrices: true });
    const touched = preview.items.filter(i => i.materialCost != null && Object.keys(SOURCE).includes(i.code)).map(i => `${i.code} ${i.action} $${i.materialCost}`);
    // eslint-disable-next-line no-console
    console.log(`[T12 price refresh]\n${lines.join('\n')}\nimport preview on the approved codes: ${touched.join('; ') || '(the import targets bare-conduit codes, not the all-in EMT / PVC items — the migration sets the approved codes directly)'}`);
  });
});
