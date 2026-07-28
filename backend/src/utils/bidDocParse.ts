// Non-AI extraction of amount + scope-of-work from a finished bid document.
// Regex/label-based only — reliable for APT's own proposal template
// (backend/src/utils/proposalDocx.ts), best-effort for other consistent formats.
import AdmZip from 'adm-zip';
import { PDFParse } from 'pdf-parse';

const SOW_SECTIONS: { key: string; label: string; header: RegExp }[] = [
  { key: 'A_ServiceDistribution',      label: 'Service & Distribution',                  header: /^A\.\s*SERVICE\s*&\s*DISTRIBUTION/i },
  { key: 'B_BranchPower',              label: 'Branch Power',                            header: /^B\.\s*BRANCH\s*POWER/i },
  { key: 'C_LightingControls',         label: 'Lighting & Controls',                     header: /^C\.\s*LIGHTING\s*&\s*CONTROLS/i },
  { key: 'D_SiteLightingUnderground',  label: 'Site Lighting, Underground & Allowances', header: /^D\.\s*SITE\s*LIGHTING/i },
  { key: 'E_LowVoltage',               label: 'Low Voltage Infrastructure',              header: /^E\.\s*LOW\s*VOLTAGE/i },
  { key: 'F_Coordination',             label: 'Project Coordination & Closeout',         header: /^F\.\s*PROJECT\s*COORDINATION/i },
];

// Any of these starting a line means "stop collecting bullets for the current section".
const SECTION_BOUNDARY = /^(EXCLUSIONS|ALLOWANCES|TERMS\s*&\s*CONDITIONS|PROPOSAL\s*PRICE|ACCEPTANCE\s*&\s*SIGNATURE|[A-F]\.\s*[A-Z])/i;

const AMOUNT_PATTERNS = [
  /Total\s+Proposed\s+Contract\s+Value:?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
  /Total\s+(?:Bid|Contract|Proposal)\s+(?:Amount|Value):?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
  /Grand\s+Total:?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
  // APT's own hand-built template: "Total for <project name>:" with the amount
  // on the following line, under a "Proposal Price Summary" heading.
  /Total\s+for\s+[^:$\n]*:?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
];

// Last-resort fallback: first bare "$X,XXX.XX" line under a "Price Summary" heading,
// skipping optional/adder lines so the base bid price wins over an add-on.
function findAmountNearPriceSummary(text: string): number | null {
  const idx = text.search(/price\s+summary/i);
  if (idx < 0) return null;
  const lines = text.slice(idx).split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/optional|adder/i.test(line)) continue;
    const m = line.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
    if (m) return Number(m[1].replace(/,/g, ''));
  }
  return null;
}

export function extractDocxText(buf: Buffer): string {
  const zip = new AdmZip(buf);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) return '';
  const xml = entry.getData().toString('utf8');
  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractPdfText(buf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    return result.text || '';
  } finally {
    await parser.destroy();
  }
}

// Flattens the first worksheet of an .xlsx to plain text, one line per row (cells
// tab-separated, in column order). Reads the sheet XML directly (xlsx is a zip of
// XML, same as docx) rather than pulling in a full spreadsheet library — this only
// ever needs a couple of header cells, not formulas/styles/formatting.
export function extractXlsxText(buf: Buffer): string {
  const zip = new AdmZip(buf);
  const sheetEntry = zip.getEntries().find(e => /^xl\/worksheets\/sheet1\.xml$/.test(e.entryName));
  if (!sheetEntry) return '';

  const shared: string[] = [];
  const sharedEntry = zip.getEntry('xl/sharedStrings.xml');
  if (sharedEntry) {
    const siMatches = sharedEntry.getData().toString('utf8').match(/<si>[\s\S]*?<\/si>/g) || [];
    for (const si of siMatches) {
      shared.push(si.replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
    }
  }

  const xml = sheetEntry.getData().toString('utf8');
  const cellRe = /<c([^>]*)>(?:<f>[^<]*<\/f>)?(?:<v>([^<]*)<\/v>)?<\/c>/g;
  const rows: Record<number, Record<string, string>> = {};
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(xml))) {
    const [, attrs, v] = m;
    if (v === undefined) continue;
    const refM = attrs.match(/\br="([A-Z]+)(\d+)"/);
    if (!refM) continue;
    const type = attrs.match(/\bt="([^"]+)"/)?.[1];
    const value = type === 's' ? (shared[Number(v)] ?? '') : v;
    const rowNum = Number(refM[2]);
    (rows[rowNum] ??= {})[refM[1]] = value;
  }

  return Object.keys(rows).map(Number).sort((a, b) => a - b)
    .map(r => Object.keys(rows[r]).sort().map(c => rows[r][c]).join('\t'))
    .join('\n');
}

export interface ParsedTakeoff {
  sqFt: number | null;
}

const SQFT_PATTERNS = [
  /([\d,]{3,7})\s*SF\s*gross/i,
  /(?:building\s+area|gross\s+(?:building\s+)?(?:area|footprint)|total\s+(?:building\s+)?(?:sq\.?\s*ft\.?|square\s+foot(?:age)?)):?\s*([\d,]{3,7})\s*(?:SF|sq\.?\s*ft\.?)?/i,
  /([\d,]{3,7})\s*(?:SF|sq\.?\s*ft\.?|square\s+feet)\b/i,
];

// Non-AI extraction of building square footage from a takeoff spreadsheet — reliable
// only for a consistent company template (a "Building area: X,XXX SF gross
// footprint…" header line, same as APT's Quantity Takeoff sheets).
export function parseTakeoffText(text: string): ParsedTakeoff {
  let sqFt: number | null = null;
  for (const pattern of SQFT_PATTERNS) {
    const m = text.match(pattern);
    if (m) { sqFt = Number(m[1].replace(/,/g, '')); break; }
  }
  return { sqFt };
}

export interface ParsedBidDoc {
  amount: number | null;
  scopeOfWork: Record<string, string[]>;
  scopeText: string;
}

export function parseBidDocText(text: string): ParsedBidDoc {
  let amount: number | null = null;
  for (const pattern of AMOUNT_PATTERNS) {
    const m = text.match(pattern);
    if (m) { amount = Number(m[1].replace(/,/g, '')); break; }
  }
  if (amount === null) amount = findAmountNearPriceSummary(text);

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const scopeOfWork: Record<string, string[]> = {};
  let active: string | null = null;

  for (const line of lines) {
    const section = SOW_SECTIONS.find(s => s.header.test(line));
    if (section) { active = section.key; scopeOfWork[active] = []; continue; }
    if (active) {
      if (SECTION_BOUNDARY.test(line)) { active = null; continue; }
      scopeOfWork[active].push(line);
    }
  }

  const scopeText = SOW_SECTIONS
    .filter(s => scopeOfWork[s.key]?.length)
    .map(s => `${s.label}:\n${scopeOfWork[s.key].map(b => `- ${b}`).join('\n')}`)
    .join('\n\n');

  return { amount, scopeOfWork, scopeText };
}
