// Kissimmee live run 2026-09-30: "Lighting contactors (Work, Sales, Sign x2, Site x2)" x6
// fuzzy-matched LC-RELAYPANEL ($650 / 4 h). It is per-contactor: LC-CONTACTOR.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { toLibraryCandidates, parseAgent2Takeoff } from './bidEstimate';
import { mapTakeoffLines, fromLegacyTakeoff, LibraryCandidate } from './mapper';

const R = path.join(__dirname, '../test/fixtures/realrun');
const live = JSON.parse(fs.readFileSync(path.join(R, 'live-library-2026-09-30.json'), 'utf8'));
const run = JSON.parse(fs.readFileSync(path.join(R, 'kissimmee-live-2026-09-30.json'), 'utf8'));
const lib = { items: live.library.items ?? live.library, assemblies: live.library.assemblies ?? [], factors: [] } as any;
const cands = toLibraryCandidates(lib);
const rows = parseAgent2Takeoff('```json\n' + JSON.stringify(run.agent2) + '\n```');
const row = rows.find(r => /^Lighting contactors \(/i.test(r.item))!;

describe('contactor rows', () => {
  it('the real 6-contactor row suggests LC-CONTACTOR, not the relay panel', () => {
    expect(row.qty).toBe(6);
    const [m] = mapTakeoffLines(fromLegacyTakeoff([row]), cands);
    expect(m.matchedCode).toBe('LC-CONTACTOR');
    expect(m.confirmReason).toBeNull();
  });

  it('without a contactor unit in the library it never suggests the panel', () => {
    const noContactor = cands.filter((c: LibraryCandidate) => c.code !== 'LC-CONTACTOR');
    const [m] = mapTakeoffLines(fromLegacyTakeoff([row]), noContactor);
    expect(m.matchedCode).toBeNull();
  });

  it('the enclosure row is untouched by the contactor rule', () => {
    const enc = rows.find(r => /contactor enclosure/i.test(r.item))!;
    const [m] = mapTakeoffLines(fromLegacyTakeoff([enc]), cands);
    expect(m.matchedCode).not.toBe('LC-RELAYPANEL');
  });
});
