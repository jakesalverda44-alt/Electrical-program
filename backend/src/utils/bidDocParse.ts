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
];

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
