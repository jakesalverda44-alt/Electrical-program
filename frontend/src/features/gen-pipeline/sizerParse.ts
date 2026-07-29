import { AcUnit, ChecklistData, LoadRow, LOADS } from './SiteVisitChecklist';

// Reads a Generac/Kohler NEC sizing-report PDF and maps its data onto the Site Visit
// Checklist. Runs client-side (pdfjs-dist) when a sizer is uploaded so the tech gets a
// pre-filled checklist to verify/edit on-site — never the source of truth on its own.

/** Extract the PDF as text lines, grouped by y-coordinate (same approach as the
 *  standalone Job Kickoff Tool) so "Dryer 5.5 22.92 X 5.5" stays one line. */
export async function extractPdfLines(file: File): Promise<string[]> {
  const pdfjsLib = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const out: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const rows: Record<number, { x: number; s: string }[]> = {};
    for (const it of tc.items as { str: string; transform: number[] }[]) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      (rows[y] = rows[y] || []).push({ x: it.transform[4], s: it.str });
    }
    Object.keys(rows).map(Number).sort((a, b) => b - a).forEach(y => {
      const line = rows[y].sort((a, b) => a.x - b.x).map(o => o.s).join(' ').replace(/\s+/g, ' ').trim();
      if (line) out.push(line);
    });
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface SizerResult {
  fields: Partial<Pick<ChecklistData, 'gasType' | 'airHandler' | 'sqft'>> & { acUnits?: AcUnit[] };
  loads: Record<number, LoadRow>;
  notesLine: string;
}

export function parseSizerLines(lines: string[]): SizerResult {
  const text = lines.join('\n');
  const fields: SizerResult['fields'] = {};
  const loads: Record<number, LoadRow> = {};

  // Fuel choice → gas type
  if (/liquid\s*propane|\bpropane\b|\bLP\b/i.test(text)) fields.gasType = 'LP';
  else if (/natural\s*gas|\bNG\b/i.test(text)) fields.gasType = 'NG';

  // LRA — line like "Largest Motor's Starting Amps (LRA) 86.3 83.9 83.9"; take the last (utilized) value
  const lraLine = lines.find(l => /LRA\)/i.test(l) || /Starting Amps/i.test(l));
  let lraVal: string | undefined;
  if (lraLine) {
    const nums = lraLine.match(/[\d.]+/g);
    if (nums && nums.length) lraVal = nums[nums.length - 1];
  }

  // AC unit size — "3.0 Ton Unit"
  const ac = text.match(/([\d.]+)\s*Ton\s*Unit/i) || text.match(/([\d.]+)\s*Ton/i);
  if (ac) fields.acUnits = [{ size: `${ac[1]} Ton`, type: '', lra: lraVal || '' }];

  // Electric heat / heat pump → air handler is electric (has heat strips / electric heat load)
  if (/heat\s*pump|heat\s*strip|electric\s*heat/i.test(text)) fields.airHandler = 'Electric';

  // Square footage — "Square Footage ... ) 2,450"
  const sqft = text.match(/Square Footage[^\n]*?\)\s*([\d,]+)/i);
  if (sqft) fields.sqft = sqft[1].replace(/,/g, '');

  // Appliance nameplate amps — lines shaped "<name> <est_kw> <nameplate_amps> [X] <load_kw>".
  // Map to the checklist's fixed LOADS rows by exact normalized name.
  const applianceAmps: Record<string, number> = {};
  for (const l of lines) {
    const m = l.match(/^([A-Za-z][A-Za-z .\-/&]+?)\s+([\d.]+)\s+([\d.]+)/);
    if (!m) continue;
    const amps = parseFloat(m[3]);
    if (!isNaN(amps)) applianceAmps[norm(m[1])] = amps;
  }
  LOADS.forEach((row, i) => {
    const amps = applianceAmps[norm(row.n)];
    if (amps === undefined) return;               // not on this sizer
    loads[i] = { fuel: 'Electric', amps: String(Math.round(amps)) };
  });

  // Summary note so the extra sizer data (sqft, recommended size, BTU) isn't lost
  const parts: string[] = [];
  const rec = text.match(/(\d+)\s*kW[^\n]*Recommended/i);
  if (rec) parts.push(`${rec[1]}kW recommended`);
  if (sqft) parts.push(`${sqft[1]} sqft`);
  if (fields.gasType) parts.push(fields.gasType === 'LP' ? 'Liquid Propane' : 'Natural Gas');
  const btu = text.match(/BTU\s*load\s*required\s*([\d,]+)/i);
  if (btu) parts.push(`BTU ${btu[1]}`);
  if (lraVal) parts.push(`LRA ${lraVal}`);
  const notesLine = parts.length ? `Sizer: ${parts.join(' · ')}.` : '';

  return { fields, loads, notesLine };
}

/** Full pipeline: extract + parse a sizer PDF File into checklist patches. */
export async function parseSizerFile(file: File): Promise<SizerResult> {
  const lines = await extractPdfLines(file);
  return parseSizerLines(lines);
}
