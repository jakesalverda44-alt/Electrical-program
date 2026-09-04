// @vitest-environment node
// Review finding B4: task 4's sweep converted the toasts it could grep for and
// left six failures rendering the green success check — including one titled
// "Save failed", the literal defect audit ux #3 describes. The ones it missed
// sat inside a *status branch* of a catch, or were `showToast?.(` (optional
// call), or were validation refusals rather than caught errors.
//
// A one-off grep cannot stop that happening again, so this test IS the grep:
// it scans the source for toasts whose copy says the action did not happen and
// requires each to carry an explicit variant. A new green "Delete failed"
// fails the suite.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = path.resolve(__dirname, '..');

/** `showToast(`, `showToast?.(`, `showToast (` — every call shape in the tree. */
const CALL = /showToast\s*\??\s*\.?\s*\(/;

/**
 * Copy that means "what you asked for did not happen". Deliberately broad: a
 * false positive costs one `variant:` keystroke, a false negative is a green
 * checkmark on a failure.
 */
const FAILURE_COPY = new RegExp([
  '[Ff]ail',                       // "Save failed", "Failed to add"
  "[Cc]ould ?n?o?t", 'Couldn',     // "Could not save", "Couldn't countersign"
  'required', 'must ',             // validation refusals
  'not allowed', 'Admin only', 'Only an ',
  'cannot', "can't", "Can't",
  'invalid', 'Invalid',
  'too large', 'exceeds',
  'Nothing ', 'No .* (found|on file|available)',
  'not saved', 'not updated',
  'reserved',
].join('|'));

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    if (!/\.(ts|tsx)$/.test(e.name) || e.name.includes('.test.')) return [];
    return [full];
  });
}

interface Offender { file: string; line: number; text: string; reason: string }

function findUnmarkedFailureToasts(): Offender[] {
  const out: Offender[] = [];
  for (const file of walk(SRC)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!CALL.test(line)) return;
      if (/variant:/.test(line)) return;
      const rel = path.relative(SRC, file);

      if (FAILURE_COPY.test(line)) {
        out.push({ file: rel, line: i + 1, text: line.trim(), reason: 'failure copy' });
        return;
      }
      // A toast raised from inside a catch, or from a status branch of one.
      const before = lines.slice(Math.max(0, i - 8), i).join('\n');
      if (/\}\s*catch|catch\s*\(|catch\s*\{|status\s*===\s*\d/.test(before)) {
        out.push({ file: rel, line: i + 1, text: line.trim(), reason: 'raised in an error branch' });
      }
    });
  }
  return out;
}

describe('toast variants', () => {
  it('no toast that reports a failure still renders as a success', () => {
    const offenders = findUnmarkedFailureToasts();
    const report = offenders.map(o => `  ${o.file}:${o.line}  (${o.reason})\n    ${o.text}`).join('\n');
    expect(offenders, `Add \`variant: 'error'\` (or 'info' if the action actually succeeded) to:\n${report}`)
      .toEqual([]);
  });

  it('the scanner actually catches an unmarked failure toast', () => {
    // Guards the guard: if CALL or FAILURE_COPY ever stops matching, the test
    // above would pass vacuously.
    expect(CALL.test("      showToast?.({ title: 'Save failed', sub: msg });")).toBe(true);
    expect(FAILURE_COPY.test("showToast({ title: 'Delete failed' })")).toBe(true);
    expect(FAILURE_COPY.test("showToast({ title: 'Name is required' })")).toBe(true);
    expect(FAILURE_COPY.test("showToast({ title: \"Couldn't countersign\" })")).toBe(true);
    // And does not flag a plain success.
    expect(FAILURE_COPY.test("showToast({ title: 'Document removed' })")).toBe(false);
    expect(FAILURE_COPY.test("showToast({ title: 'Saved' })")).toBe(false);
  });

  it('found a non-trivial number of files to scan', () => {
    // A broken path would make the first test pass on an empty file list.
    expect(walk(SRC).length).toBeGreaterThan(100);
  });
});
