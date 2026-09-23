// Fix round 1 / S14 — a takeoff section row never sits alone at the bottom
// of a page. The review's LibreOffice sweep rendered the Kissimmee proposal
// with 0-24 extra takeoff lines: without keep-with-next, 5 of the 25 variants
// ended a page on a lone section band (the extra-line counts below are the
// ones that did, re-checked by mutation when this fix went in). Skipped when
// LibreOffice isn't installed.
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { renderBidDocx } from './proposalDocx';
import { findSoffice } from '../bidstd/verifyBid';
import { kissimmeeThroughCompose } from '../test/fixtures/bidstd/kissimmeeProposal';

describe('takeoff section rows keep with their first item (LibreOffice)', () => {
  it('no page ends on a lone section band', async (ctx) => {
    const soffice = findSoffice();
    if (!soffice) return ctx.skip();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-'));
    const sections = kissimmeeThroughCompose().data.takeoff.map(c => c.name);
    const orphans: string[] = [];
    try {
      for (const extra of [0, 8, 13, 14, 19, 20]) {
        const d = kissimmeeThroughCompose().data;
        for (let k = 0; k < extra; k++) d.takeoff[0].items.push({ item: `Extra ${k}`, description: 'extra line for pagination', unit: 'EA', qty: 1, source: 'E-1' });
        const f = path.join(dir, `v${extra}.docx`);
        fs.writeFileSync(f, await renderBidDocx(d));
        execFileSync(soffice, [`-env:UserInstallation=file://${path.join(dir, 'profile')}`, '--headless', '--convert-to', 'pdf', '--outdir', dir, f], { stdio: 'ignore', timeout: 120_000 });
        const pages = execFileSync('pdftotext', ['-layout', path.join(dir, `v${extra}.pdf`), '-']).toString().split('\f');
        pages.forEach((p, i) => {
          const lines = p.split('\n').map(l => l.trim()).filter(Boolean);
          const last = lines[lines.length - 1];
          if (last && sections.includes(last)) orphans.push(`+${extra} lines, page ${i + 1} ends on "${last}"`);
        });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(orphans).toEqual([]);
  }, 600_000);
});
