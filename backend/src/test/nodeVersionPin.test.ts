// Fix round 2 / R2-S5 — regression guard for N10's own bug: render.yaml
// used to pin production to an EXACT Node patch (20.16.0). Node 20 reached
// end of life in April 2026, so that exact pin left production stuck on an
// unsupported runtime forever, with no routine Render bump ever able to
// move it forward. The fix pins a supported LTS MAJOR instead (Node 22,
// ">=22 <23" in backend/package.json's own engines, "22" — no patch — in
// render.yaml's NODE_VERSION) so this can't go stale the same way again.
//
// This can only check the DECLARED configuration, not literally boot the
// server under a real Node 22 binary — no nvm/n/asdf/volta and no network
// access are available in this sandbox to install one. What it CAN prove,
// and does: (1) the exact stale/EOL pin never comes back, (2) backend/
// package.json and render.yaml stay in sync with each other, and (3) the
// Node 22 floor this repo now declares is squarely inside the range
// pdfjs-dist@5 and pdf-parse (both read real PDF bytes for sheet indexing
// — estimating/pdfjsLoader.ts, estimating/sheets.ts) say THEY support,
// per those packages' own published engines fields. The existing real-PDF
// sheet-indexing suite (estimatingSheetsRoutes.test.ts) already drives the
// actual pdfjs-dist code path against real PDF bytes on whatever Node this
// sandbox runs — that suite passing is the closest thing to a live pdfjs-
// on-Node-22 proof available here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..', '..');

/** No YAML parser is a dependency of this project (and adding one just for
 *  this one-line check would be its own scope creep) — render.yaml's
 *  `NODE_VERSION` block has a fixed, simple two-line shape
 *  (`- key: NODE_VERSION` followed by `value: <x>`), so a plain regex over
 *  the raw text is exact and dependency-free. */
function renderYamlNodeVersion(): string | undefined {
  const raw = readFileSync(join(REPO_ROOT, 'render.yaml'), 'utf8');
  const m = /-\s*key:\s*NODE_VERSION\s*\n\s*value:\s*(\S+)/.exec(raw);
  return m?.[1];
}

function readBackendPackageJson(): { engines?: { node?: string } } {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'backend', 'package.json'), 'utf8'));
}

describe('Fix round 2 / R2-S5 — production Node version pin', () => {
  it('render.yaml pins NODE_VERSION to the Node 22 LTS major, never a bare/exact stale patch like the old 20.16.0', () => {
    const nodeVersion = renderYamlNodeVersion();
    expect(nodeVersion).toBe('22');
    expect(nodeVersion).not.toBe('20.16.0'); // the exact EOL pin this fix replaces
  });

  it('backend/package.json engines.node matches render.yaml\'s NODE_VERSION — a Node 22 major range, not the old >=20.16.0 floor', () => {
    const pkg = readBackendPackageJson();
    expect(pkg.engines?.node).toBe('>=22 <23');
  });

  it('pdfjs-dist@5 (the real sheet-indexing PDF parser) officially supports Node 22.3.0+, so the declared floor is inside its supported range', () => {
    const pdfjsPkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'node_modules', 'pdfjs-dist', 'package.json'), 'utf8'));
    // Exact string the review's own repro cited (">=22.3.0"); a plain
    // substring check is deliberately simpler than a semver range parse —
    // this is a documentation cross-check, not a live version probe.
    expect(pdfjsPkg.engines?.node as string).toContain('>=22.3.0');
  });

  it('pdf-parse (the fallback PDF text extractor) also officially supports Node 22.3.0+', () => {
    const pdfParsePkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'node_modules', 'pdf-parse', 'package.json'), 'utf8'));
    expect(pdfParsePkg.engines?.node as string).toContain('>=22.3.0');
  });
});
