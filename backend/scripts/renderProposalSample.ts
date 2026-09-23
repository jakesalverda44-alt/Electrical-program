// Takeoff accuracy Task 13 — render the Kissimmee reference BidData (the
// Cowork proposal's content, with Jake's two corrections: disconnects are
// APT-furnished, change orders go through the GC) through the CRM renderer to
// .docx and, with LibreOffice, .pdf — for side-by-side comparison with the
// Cowork PDF. No network, no DB.
//   npx tsx scripts/renderProposalSample.ts <out-dir>
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { renderBidDocx } from '../src/utils/proposalDocx';
import { standardScope6, standardTerms } from '../src/bidstd/boilerplate';
import { formatSheetCitation } from '../src/bidstd/composeBidData';
import { findSoffice } from '../src/bidstd/verifyBid';
import type { BidData } from '../src/bidstd/bidData';

async function main() {
  const out = process.argv[2] || '.';
  fs.mkdirSync(out, { recursive: true });
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/test/fixtures/bidstd/kissimmee.bid_data.json'), 'utf8')) as BidData;
  const sheets = formatSheetCitation(['E-1', 'E-2', 'E-3', 'E-4', 'E-5', 'E-6', 'E-7', 'PH0.1', 'A-101', 'S-1']);
  d.scope = standardScope6(d.plan_date || '', sheets, d.client);
  d.terms = standardTerms(d.plan_date || '', { lightingBullet: 'Lighting fixtures furnished by the Owner through the Graybar national account. EC to receive, inventory, and install.' });
  const docx = await renderBidDocx(d);
  const docxPath = path.join(out, 'APT_Bid_AutoZone_10077_Kissimmee_CRM.docx');
  fs.writeFileSync(docxPath, docx);
  const soffice = findSoffice();
  if (soffice) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-'));
    execFileSync(soffice, [`-env:UserInstallation=file://${profile}`, '--headless', '--convert-to', 'pdf', '--outdir', out, docxPath], { timeout: 120_000 });
    fs.rmSync(profile, { recursive: true, force: true });
  }
  console.log(`Wrote ${docxPath}${soffice ? ' and the PDF' : ' (no LibreOffice: no PDF)'}`);
}
main().catch(e => { console.error(e); process.exit(1); });
