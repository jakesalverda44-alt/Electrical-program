// @vitest-environment node
// Task 4 (audit ux #8, #23; code #14) — at least 7 files each defined their
// own local `fmtDate`, 4 their own `dayOf`, and 5 their own `fmtSize`, with
// inconsistent output (some showed the year, some didn't). `lib/date.ts` and
// `lib/format.ts` are now the one source of truth. This is the plan's grep
// check as a real, permanent test (mirroring `statusColorTokens.test.ts`).
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const FEATURES_DIR = path.resolve(__dirname); // frontend/src/features

const FORBIDDEN_DEF = /function\s+(fmtDate|fmtSize|dayOf)\b|const\s+(fmtDate|fmtSize|dayOf)\s*=/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    if (!/\.(ts|tsx)$/.test(e.name) || e.name.includes('.test.')) return [];
    return [full];
  });
}

interface Offender { file: string; line: number; text: string }

function findLocalDefs(): Offender[] {
  const out: Offender[] = [];
  for (const file of walk(FEATURES_DIR)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (FORBIDDEN_DEF.test(line)) {
        out.push({ file: path.relative(FEATURES_DIR, file), line: i + 1, text: line.trim() });
      }
    });
  }
  return out;
}

describe('date/size formatter duplication (audit ux #8, #23)', () => {
  it('no file under features/ defines its own fmtDate / fmtSize / dayOf', () => {
    const offenders = findLocalDefs();
    const report = offenders.map(o => `  ${o.file}:${o.line}\n    ${o.text}`).join('\n');
    expect(offenders, `Import from lib/date.ts or lib/format.ts instead:\n${report}`).toEqual([]);
  });

  it('the scanner actually catches a local definition of each kind', () => {
    expect(FORBIDDEN_DEF.test("function fmtDate(d: string) { return d; }")).toBe(true);
    expect(FORBIDDEN_DEF.test("const fmtDate = (d) => d;")).toBe(true);
    expect(FORBIDDEN_DEF.test("function fmtSize(n: number) { return n; }")).toBe(true);
    expect(FORBIDDEN_DEF.test("const dayOf = (d) => new Date(d);")).toBe(true);
    // Does not flag a differently-named helper or a plain call.
    expect(FORBIDDEN_DEF.test("export function fmtCalendarDateLong(iso: string) {}")).toBe(false);
    expect(FORBIDDEN_DEF.test("import { fmtDate } from '../../lib/date';")).toBe(false);
    expect(FORBIDDEN_DEF.test("{fmtDate(lead.follow_up_date, { year: 'never' })}")).toBe(false);
  });

  it('found a non-trivial number of files to scan', () => {
    expect(walk(FEATURES_DIR).length).toBeGreaterThan(50);
  });
});
