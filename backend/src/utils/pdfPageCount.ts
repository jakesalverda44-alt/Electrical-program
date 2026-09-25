// Review N7 — a PDF's page count without a second in-memory copy of the
// file: the bytes go to a temp file once and poppler's `pdfinfo` reads the
// count (pdf.js needs its own copy of the whole buffer, doubling memory on a
// 30-100 MB plan set). Null when the file is not a readable PDF or pdfinfo is
// not installed (poppler-utils — the same Aptfile entry as pdftotext).
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileP = promisify(execFile);

export async function countPdfPages(buf: Buffer): Promise<number | null> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'apt-pagecount-'));
  try {
    const pdfPath = path.join(tmp, 'in.pdf');
    await fs.writeFile(pdfPath, buf);
    const { stdout } = await execFileP('pdfinfo', [pdfPath], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    const m = /^Pages:\s+(\d+)/m.exec(stdout);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
