// Phase 3 Task 6.3 — the pre-bid scope docx builder, ported faithfully from
// the APT_Bid_System v4 skill's scripts/build_prebid.js
// (~/.claude/skills/apt-electrical-bid/scripts/build_prebid.js). Internal
// document for Chris (the estimator) — see docs/PreBid_Package_Spec.md:
// navy "PRE-BID PACKAGE — INTERNAL USE" banner instead of the logo, a
// To/From/Owner/Engineer/plan+received-date/sheet-list header, Scope +
// Sections A-F + Exclusions in the same visual style as the formal bid, an
// internal FLAGS section (INTERNAL NOTES & DISCREPANCIES) that exists ONLY
// here, and — deliberately — NO takeoff table, NO price, NO signature, NO
// closing block.
//
// build_prebid.js keeps its own small set of docx primitive helpers rather
// than importing build_bid.js's — this file does the same relative to
// proposalDocx.ts, faithfully mirroring that structure rather than sharing
// module internals across the two renderers.
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ShadingType,
} from 'docx';
import { BidData, Bullet } from './bidData';
import { SECTION_HEADERS, PREBID_BANNER } from './boilerplate';

const NAVY = '1F3864';
const WHITE = 'FFFFFF';
const BLACK = '000000';
const FONT = 'Arial';

const SIZE_BODY = 20;
const SIZE_HEADER = 22;
const SIZE_BANNER = 28;
const SP_HDR_BEFORE = 440;
const SP_HDR_AFTER = 160;
const SP_BUL_BEFORE = 40;
const SP_BUL_AFTER = 80;

const NO_BORDER = {
  top:    { style: BorderStyle.NONE, size: 0, color: 'auto' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  left:   { style: BorderStyle.NONE, size: 0, color: 'auto' },
  right:  { style: BorderStyle.NONE, size: 0, color: 'auto' },
} as const;

interface RunOpts {
  size?: number;
  bold?: boolean;
  italics?: boolean;
  color?: string;
}

function run(text: string, o: RunOpts = {}): TextRun {
  return new TextRun({
    text, font: FONT, size: o.size || SIZE_BODY,
    bold: !!o.bold, italics: !!o.italics, color: o.color || BLACK,
  });
}

interface LineOpts extends RunOpts {
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  before?: number;
  after?: number;
}

function line(text: string, o: LineOpts = {}): Paragraph {
  return new Paragraph({
    alignment: o.align || AlignmentType.LEFT,
    spacing: { before: o.before ?? 0, after: o.after ?? 60 },
    children: [run(text, o)],
  });
}

function band(text: string, size = SIZE_HEADER, pad = 60): Table {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    borders: NO_BORDER,
    rows: [new TableRow({ children: [new TableCell({
      width: { size: 9360, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: NAVY, color: 'auto' },
      margins: { top: pad, bottom: pad, left: 120, right: 120 },
      borders: NO_BORDER,
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        children: [run(text, { bold: true, color: WHITE, size })],
      })],
    })] })],
  });
}

function headerBlock(text: string): (Paragraph | Table)[] {
  return [
    new Paragraph({ spacing: { before: SP_HDR_BEFORE, after: 0 }, keepNext: true, children: [] }),
    band(text),
    new Paragraph({ spacing: { before: SP_HDR_AFTER, after: 0 }, keepNext: true, children: [] }),
  ];
}

function bullet(text: Bullet): Paragraph {
  const kids = typeof text === 'string'
    ? [run(text)]
    : [run(text.b, { bold: true }), run(text.t)];
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { before: SP_BUL_BEFORE, after: SP_BUL_AFTER },
    keepLines: true,
    children: kids,
  });
}

/** `[Project]_PreBid_Scope.docx` (PROJECT_INSTRUCTIONS §14 deliverables table). */
export function prebidScopeFilename(data: BidData): string {
  return `${data.project_slug}_PreBid_Scope.docx`;
}

/**
 * Render the internal pre-bid scope docx for Chris. Reads `data.prebid` for
 * To/From/Owner/Engineer/received/sheets/flags — all optional, with the same
 * defaults build_prebid.js uses (To: "Chris (Estimator)", From: "Jake
 * Salverda, Commercial A.E."). NO price, NO signature, NO closing block.
 */
export async function renderPrebidScopeDocx(data: BidData): Promise<Buffer> {
  const p = data.prebid ?? {};
  const body: (Paragraph | Table)[] = [];

  // Banner instead of the logo.
  body.push(band(PREBID_BANNER, SIZE_BANNER, 110));
  body.push(new Paragraph({ spacing: { before: 240, after: 0 }, children: [] }));

  // Header block.
  body.push(line(data.date));
  body.push(line(`To:          ${p.to || 'Chris (Estimator)'}`, { before: 120 }));
  body.push(line(`From:      ${p.from || 'Jake Salverda, Commercial A.E.'}`));
  body.push(line(`Re:          ${data.project_name}`, { before: 120, bold: true }));
  body.push(line(`GC:          ${data.client}`));
  if (p.owner) body.push(line(`Owner:     ${p.owner}`));
  if (p.engineer) body.push(line(`Engineer: ${p.engineer}`));
  body.push(line(`Address:  ${data.project_address}`));
  body.push(line(`Plans:      dated ${data.plan_date || '—'}` + (p.received ? `, received ${p.received}` : '')));
  if (p.sheets) body.push(line(`Sheets:    ${p.sheets}`));
  body.push(line(`Job No.   ${data.job_number}`));

  body.push(line(
    'Scope below is for internal review and pricing. Quantities are in the accompanying '
    + 'takeoff spreadsheet, confidence-coded FIRM / APPROX / VERIFY.',
    { italics: true, before: 240, after: 120 }
  ));

  // Scope + A-F.
  body.push(...headerBlock(SECTION_HEADERS.scope));
  data.scope.forEach((b) => body.push(bullet(b)));
  data.sections.forEach((s) => {
    body.push(...headerBlock(s.title));
    s.bullets.forEach((b) => body.push(bullet(b)));
  });

  // Exclusions.
  body.push(...headerBlock(SECTION_HEADERS.exclusions));
  data.exclusions.forEach((b) => body.push(bullet(b)));

  // Internal flags — exists ONLY on the pre-bid, never the GC bid.
  if (p.flags && p.flags.length) {
    body.push(...headerBlock('INTERNAL NOTES & DISCREPANCIES'));
    p.flags.forEach((b) => body.push(bullet(b)));
  }

  const doc = new Document({
    creator: 'Accurate Power & Technology',
    title: `Pre-Bid Scope — ${data.project_name}`,
    styles: { default: { document: { run: { font: FONT, size: SIZE_BODY } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, bottom: 1080, left: 1440, right: 1440 },
        },
      },
      children: body,
    }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
