// Takeoff accuracy Task 13 / fix round 1 (B6) — render the Kissimmee
// reference proposal through the app's OWN composition path: the Cowork
// proposal's sections and takeoff as Agent 4 output -> the seeded AutoZone
// account rule (power poles: GC furnishes, APT installs) -> composeProposal
// (enforcement, composeBidData, blocking checks) -> the GC verify gate ->
// renderBidDocx, and with LibreOffice the PDF. Refuses to write anything the
// app itself would refuse. No network, no DB.
//   npx tsx scripts/renderProposalSample.ts <out-dir>
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { renderBidDocx } from '../src/utils/proposalDocx';
import { findSoffice, verifyBidDocx } from '../src/bidstd/verifyBid';
import { kissimmeeThroughCompose } from '../src/test/fixtures/bidstd/kissimmeeProposal';

async function main() {
  const out = process.argv[2] || '.';
  fs.mkdirSync(out, { recursive: true });
  const composed = kissimmeeThroughCompose();
  if (composed.dataProblems.length || composed.lineFailures.length) {
    throw new Error(`The app would refuse this proposal: ${JSON.stringify([...composed.dataProblems, ...composed.lineFailures])}`);
  }
  const d = composed.data;
  const v = await verifyBidDocx(await renderBidDocx(d), { kind: 'gc', ...composed.verifyOptions });
  if (!v.pass) throw new Error(`The GC verify gate fails this proposal: ${JSON.stringify(v.failures)}`);
  for (const c of composed.corrections) console.log(`correction: ${c}`);
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
