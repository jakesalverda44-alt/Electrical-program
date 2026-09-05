// @vitest-environment node
// Task 3 (audit ux #6) — `PcWorkspace.tsx` and three other files hardcoded a
// second red/amber/green palette (#EF4444/#F59E0B/#10B981) instead of the
// shared `--red`/`--amber`/`--green` tokens `styles.css` already defines,
// so a "Stop Item" warning read as a visibly different, more saturated red
// than a "Lost" badge on a pipeline card two clicks away. This is the grep
// the plan's checklist calls for, kept as a real test so a new hardcoded hex
// under `features/` fails the suite instead of waiting for the next audit.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const FEATURES_DIR = path.resolve(__dirname); // frontend/src/features

const FORBIDDEN_HEX = /#EF4444|#F59E0B|#10B981/i;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    if (!/\.(ts|tsx)$/.test(e.name) || e.name.includes('.test.')) return [];
    return [full];
  });
}

interface Offender { file: string; line: number; text: string }

function findHardcodedStatusHex(): Offender[] {
  const out: Offender[] = [];
  for (const file of walk(FEATURES_DIR)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (FORBIDDEN_HEX.test(line)) {
        out.push({ file: path.relative(FEATURES_DIR, file), line: i + 1, text: line.trim() });
      }
    });
  }
  return out;
}

describe('status color tokens (audit ux #6)', () => {
  it('no #EF4444 / #F59E0B / #10B981 remains under features/ — use var(--red)/var(--amber)/var(--green) instead', () => {
    const offenders = findHardcodedStatusHex();
    const report = offenders.map(o => `  ${o.file}:${o.line}\n    ${o.text}`).join('\n');
    expect(offenders, `Replace with the shared token:\n${report}`).toEqual([]);
  });

  it('the scanner actually catches a hardcoded status hex', () => {
    expect(FORBIDDEN_HEX.test("color: r === 'HIGH' ? '#EF4444' : '#F59E0B'")).toBe(true);
    expect(FORBIDDEN_HEX.test("background: 'var(--green)'")).toBe(false);
  });

  it('found a non-trivial number of files to scan', () => {
    expect(walk(FEATURES_DIR).length).toBeGreaterThan(50);
  });
});
