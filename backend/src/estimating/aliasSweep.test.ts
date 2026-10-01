// Fix round B2 — before / after mapper sweep over every Agent 2 row of the
// exports that carry them (Kissimmee 0928 / 0930, 36th 0929 / 0929b / 0930;
// Kissimmee 0924 holds counts only). BEFORE = the exported live library, the
// mapper alone (what the app did before the accuracy round). AFTER = the
// library as migration 158 leaves it, decideRows (a bid being estimated) then
// the mapper. Every change must be a deliberate decision by code; no row
// reaches an alias-only unit through the mapper, and no probe row moves family.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadLiveLibrary0930 } from '../test/fixtures/realrun/live0930';
import { libraryAfterMigrations } from '../eval/replayEval';
import { parseAgent2Takeoff, toLibraryCandidates, mapRawTakeoffRows, type RawTakeoffRow } from './bidEstimate';
import { mapTakeoffLines, fromLegacyTakeoff, ALIAS_ONLY_CODE_RE } from './mapper';
import { decideRows } from './equipmentConnection';

const FIX = path.join(__dirname, '../test/fixtures');
const SOURCES: Array<[string, string]> = [
  ['kissimmee 0928', 'estimating/price-accuracy/kissimmee-run-2026-09-28.json'],
  ['kissimmee 0930', 'realrun/kissimmee-live-2026-09-30.json'],
  ['36th 0929', 'estimating/36th-street-run-2026-09-29.json'],
  ['36th 0929b', 'estimating/price-accuracy/36th-street-run-2026-09-29b.json'],
  ['36th 0930', 'realrun/36th-street-live-2026-09-30.json'],
];
const DECIDED = /^(?:TERM-|PP-SET$|DEV-SIMPLEX$|FAN-CEIL$|LTG-POLE(?:-30|HEAD)?$|POLE-ANCHOR$|RISER-PIPEPOLE$|ASM-SW200F$|DISC-\d+$)/;

describe('B2 — mapper sweep, before → after, every Agent 2 row', () => {
  const lib = loadLiveLibrary0930().library;
  const before = toLibraryCandidates(lib);
  const after = toLibraryCandidates(libraryAfterMigrations(lib));
  for (const [name, file] of SOURCES) {
    it(name, () => {
      const run = JSON.parse(fs.readFileSync(path.join(FIX, file), 'utf8'));
      const rows = parseAgent2Takeoff('```json\n' + JSON.stringify(run.agent2) + '\n```');
      const b = mapTakeoffLines(fromLegacyTakeoff(rows), before);
      const decided = decideRows(rows) as RawTakeoffRow[];
      const a = mapRawTakeoffRows(decided, after);
      const changes: string[] = [];
      rows.forEach((r, i) => {
        const was = b[i].matchedCode ?? (b[i].note ? 'hold' : 'none');
        const now = a[i].matchedCode ?? (decided[i].note ? `note:${decided[i].note}` : decided[i].holdReason ? `hold:${decided[i].holdReason}` : 'none');
        if (was === now) return;
        changes.push(`${r.item.slice(0, 70)}  ${was} → ${now}`);
        // a changed match into a priced unit is only ever a decideRows decision (by code)
        if (a[i].matchedCode && a[i].matchedCode !== b[i].matchedCode) expect(decided[i].libraryCode, `${r.item} → ${a[i].matchedCode}`).toBe(a[i].matchedCode);
        if (ALIAS_ONLY_CODE_RE.test(a[i].matchedCode ?? '')) expect(DECIDED.test(a[i].matchedCode!), r.item).toBe(true);
        // the speed controls, emergency and track heads, exhaust combos never become a fan / pole head
        if (/^FSC|speed controls\b|emergency|track|exhaust fan \/ /i.test(r.item)) expect(a[i].matchedCode ?? '', r.item).not.toMatch(/^(?:FAN-CEIL|LTG-POLEHEAD|POLE-ANCHOR|RISER-PIPEPOLE)$/);
      });
      // eslint-disable-next-line no-console
      console.log(`[B2 sweep] ${name}: ${rows.length} rows, ${changes.length} changed\n  ${changes.join('\n  ')}`);
      // the mapper alone (no decideRows) never lands on an alias-only unit
      const alone = mapTakeoffLines(fromLegacyTakeoff(rows), after);
      expect(alone.filter(m => ALIAS_ONLY_CODE_RE.test(m.matchedCode ?? '')).map(m => m.description)).toEqual([]);
    });
  }
});
