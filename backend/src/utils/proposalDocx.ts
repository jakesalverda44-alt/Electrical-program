// Phase 3 Task 2 — the proposal renderer, ported faithfully from the
// APT_Bid_System v4 skill's scripts/build_bid.js
// (~/.claude/skills/apt-electrical-bid/scripts/build_bid.js). Every visual
// spec here — fonts, colors, spacing, column widths — is locked to that
// script; see docs/Bid_Output_Standards.md before changing any of it.
//
// renderBidDocx(data: BidData) is the new entry point: it renders exactly
// what's in the composed BidData (see backend/src/bidstd/composeBidData.ts),
// no boilerplate baked in here — the 6 scope bullets, 10 terms, section
// titles etc. are already-resolved strings on `data` by the time this file
// sees them (backend/src/bidstd/boilerplate.ts is the source of truth for
// that content).
//
// buildProposalDocx(legacyJSON, meta) stays for backward compatibility with
// already-generated proposals stored in the old ProposalJSON shape (Agent 4's
// pre-Phase-3 output contract) — it maps that shape onto BidData and renders
// through the exact same renderBidDocx, so old and new proposals come out of
// one renderer. The full-fidelity legacyProposalToBidData adapter lives in
// backend/src/bidstd/composeBidData.ts (Task 5); this file's local
// legacyToBidData is a minimal, rendering-only version of that same mapping.
import {
  Document, Packer, Paragraph, TextRun, ImageRun,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, ShadingType,
} from 'docx';
import * as fs from 'fs';
import * as path from 'path';
import { BidData, TakeoffCategory, Bullet } from '../bidstd/bidData';
import { SECTION_HEADERS, CLOSING } from '../bidstd/boilerplate';

/* ---------------------------------------------------------------- CONSTANTS
 * Ported verbatim from build_bid.js v4. */
const NAVY   = '1F3864';   // section bands, price total, closing line
const ACCENT = 'D9E1F2';   // light navy fill — takeoff category rows
const WHITE  = 'FFFFFF';
const BLACK  = '000000';
const FONT   = 'Arial';

const SIZE_BODY   = 20;    // half-points -> 10 pt
const SIZE_HEADER = 22;    // 11 pt section band text
const SIZE_TOTAL  = 24;    // 12 pt price total

const SP_HDR_BEFORE = 440; // twips before a section band (~0.3")
const SP_HDR_AFTER  = 160;
const SP_BUL_BEFORE = 40;
const SP_BUL_AFTER  = 80;

// Takeoff column widths (DXA) — must total 9360.
const COLS = [620, 3640, 720, 700, 3680] as const;

const NO_BORDER = {
  top:    { style: BorderStyle.NONE, size: 0, color: 'auto' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  left:   { style: BorderStyle.NONE, size: 0, color: 'auto' },
  right:  { style: BorderStyle.NONE, size: 0, color: 'auto' },
} as const;
const THIN = { style: BorderStyle.SINGLE, size: 4, color: '9AA5B1' } as const;
const CELL_BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN } as const;

/* ------------------------------------------------------------------ HELPERS */
interface RunOpts {
  size?: number;
  bold?: boolean;
  italics?: boolean;
  color?: string;
}

function run(text: string, o: RunOpts = {}): TextRun {
  return new TextRun({
    text, font: FONT, size: o.size || SIZE_BODY,
    bold: !!o.bold, italics: !!o.italics,
    color: o.color || BLACK,
  });
}

interface LineOpts extends RunOpts {
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  before?: number;
  after?: number;
  keepNext?: boolean;
}

/** Plain body line. */
function line(text: string, o: LineOpts = {}): Paragraph {
  return new Paragraph({
    alignment: o.align || AlignmentType.LEFT,
    spacing: { before: o.before ?? 0, after: o.after ?? 60 },
    keepNext: !!o.keepNext,
    keepLines: true,
    children: [run(text, o)],
  });
}

/** Navy band header, centered white bold. CRITICAL: centered, not left. */
function sectionHeader(text: string): Table {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    borders: NO_BORDER,
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: 9360, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: NAVY, color: 'auto' },
        margins: { top: 60, bottom: 60, left: 120, right: 120 },
        borders: NO_BORDER,
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 0 },
          keepNext: true,
          children: [run(text, { bold: true, color: WHITE, size: SIZE_HEADER })],
        })],
      })],
    })],
  });
}

/** Wrapper that supplies the 440-before / 160-after spacing around a band. */
function headerBlock(text: string): (Paragraph | Table)[] {
  return [
    new Paragraph({ spacing: { before: SP_HDR_BEFORE, after: 0 }, keepNext: true, children: [] }),
    sectionHeader(text),
    new Paragraph({ spacing: { before: SP_HDR_AFTER, after: 0 }, keepNext: true, children: [] }),
  ];
}

/** Flatten a Bullet (string | {b,t}) into plain text, e.g. for a banned-word scan. */
export function bulletText(b: Bullet): string {
  return typeof b === 'string' ? b : `${b.b ?? ''}${b.t ?? ''}`;
}

/** Bullet. `text` may be a string, or {b:"bold lead", t:"rest"} for mixed runs. */
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

type ImgType = 'jpg' | 'png' | 'gif' | 'bmp';

function extToImgType(name: string): ImgType {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext === 'png' ? 'png' : ext === 'gif' ? 'gif' : ext === 'bmp' ? 'bmp' : 'jpg';
}

/** Resolve the first candidate asset filename that exists in `assetsDir`. */
function loadAsset(assetsDir: string, names: string[]): { buf: Buffer; type: ImgType } | null {
  for (const name of names) {
    const p = path.join(assetsDir, name);
    if (fs.existsSync(p)) {
      return { buf: fs.readFileSync(p), type: extToImgType(name) };
    }
  }
  return null;
}

function image(
  asset: { buf: Buffer; type: ImgType },
  wPx: number, hPx: number,
  align: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.CENTER,
  keepNext = false,
): Paragraph {
  return new Paragraph({
    alignment: align,
    spacing: { before: 0, after: 120 },
    keepNext,
    children: [new ImageRun({
      data: asset.buf,
      type: asset.type,
      transformation: { width: wPx, height: hPx },
    })],
  });
}

/* ------------------------------------------------------------ TAKEOFF TABLE */
interface CellOpts {
  fill?: string;
  bold?: boolean;
  color?: string;
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  span?: number;
}

function cell(text: string, i: number, o: CellOpts = {}): TableCell {
  return new TableCell({
    width: { size: COLS[i], type: WidthType.DXA },
    shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: 'auto' } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    borders: CELL_BORDER,
    columnSpan: o.span,
    children: [new Paragraph({
      alignment: o.align || AlignmentType.LEFT,
      spacing: { before: 0, after: 0 },
      children: [run(text, { bold: o.bold, color: o.color, size: 18 })],
    })],
  });
}

function takeoffTable(categories: TakeoffCategory[]): Table {
  const rows: TableRow[] = [];

  // Column header row — navy, white bold.
  rows.push(new TableRow({
    tableHeader: true,
    children: ['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'SOURCE / NOTES'].map((h, i) =>
      cell(h, i, { fill: NAVY, bold: true, color: WHITE, align: AlignmentType.CENTER })),
  }));

  categories.forEach((cat) => {
    // Category band — light navy fill, navy bold text, spans all 5 columns.
    rows.push(new TableRow({
      children: [cell((cat.name || '').toUpperCase(), 0, {
        fill: ACCENT, bold: true, color: NAVY, span: 5,
      })],
    }));
    cat.items.forEach((it) => {
      rows.push(new TableRow({
        children: [
          cell(it.item || '', 0, { align: AlignmentType.CENTER }),
          cell(it.description || '', 1),
          cell(it.unit || '', 2, { align: AlignmentType.CENTER }),
          cell(String(it.qty ?? ''), 3, { align: AlignmentType.CENTER }),
          cell(it.source || '', 4),
        ],
      }));
    });
  });

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [...COLS],
    rows,
  });
}

/* ------------------------------------------------------------------- BUILD  */
function assetsDir(): string {
  return path.resolve(__dirname, '../../assets');
}

function loadLogo(): { buf: Buffer; type: ImgType } | null {
  // Official 2026 assets first, old generic names as a fallback so an
  // environment missing the new files still renders (no signature/logo).
  return loadAsset(assetsDir(), ['APT_Logo_2026.jpg', 'logo.png', 'logo.jpg', 'logo.jpeg']);
}

function loadSignature(): { buf: Buffer; type: ImgType } | null {
  return loadAsset(assetsDir(), ['Jake_2026_Signature.png', 'signature.png', 'signature.jpg', 'sig.png', 'sig.jpg']);
}

/**
 * Render a composed BidData into the standard APT proposal .docx. Faithful,
 * data-only port of build_bid.js's build() — no boilerplate strings live
 * here; every string this function prints comes straight off `data` except
 * the four fixed band headers (SCOPE OF WORK / EXCLUSIONS & CLARIFICATIONS /
 * ELECTRICAL QUANTITY TAKEOFF / TERMS...) and the closing block, both of
 * which are boilerplate.ts constants, and the A–F section titles come from
 * `data.sections[].title`.
 */
export async function renderBidDocx(data: BidData): Promise<Buffer> {
  if (!data.total_price || !String(data.total_price).trim()) {
    throw new Error('Proposal has no price — re-run the proposal step');
  }

  const logo = loadLogo();
  const sig = loadSignature();
  const body: (Paragraph | Table)[] = [];

  // 1. Logo
  if (logo) body.push(image(logo, 280, 224));

  // 2. Header block
  body.push(line(data.date));
  body.push(line(data.client, { bold: true, before: 120 }));
  if (data.contact) body.push(line(`Attn: ${data.contact}`));
  if (data.email) body.push(line(data.email));
  body.push(line(`Re: ${data.project_name}`, { before: 120 }));
  body.push(line(data.project_address));
  body.push(line(`Job No. ${data.job_number}`));

  // 3. Bold opening statement
  body.push(line(
    `Please accept this proposal to complete the electrical work for ${data.project_name} you have out for bid.`,
    { bold: true, before: 240, after: 120 }));

  // 4-10. Scope + lettered sections
  body.push(...headerBlock(SECTION_HEADERS.scope));
  data.scope.forEach((b) => body.push(bullet(b)));

  data.sections.forEach((s) => {
    body.push(...headerBlock(s.title));
    s.bullets.forEach((b) => body.push(bullet(b)));
  });

  // 11. Exclusions
  body.push(...headerBlock(SECTION_HEADERS.exclusions));
  data.exclusions.forEach((b) => body.push(bullet(b)));

  // 12. Takeoff
  body.push(...headerBlock(SECTION_HEADERS.takeoff));
  body.push(takeoffTable(data.takeoff));

  // 13. Terms
  body.push(...headerBlock(SECTION_HEADERS.terms));
  data.terms.forEach((b) => body.push(bullet(b)));

  // 14. Price summary
  body.push(line('Proposal Price Summary', { bold: true, before: 320, after: 40 }));
  body.push(line(`Total for ${data.project_name}:  ${data.total_price}`,
    { bold: true, color: NAVY, size: SIZE_TOTAL, after: 160 }));
  (data.alternates || []).forEach((b) => body.push(bullet(b)));

  // 15. Signature / acceptance block
  body.push(line(CLOSING.respectfully, { before: 240, after: 40, keepNext: true }));
  if (sig) body.push(image(sig, 500, 167, AlignmentType.LEFT, true));
  body.push(line(CLOSING.costBasis, { align: AlignmentType.CENTER, before: 60, after: 160, keepNext: true }));
  body.push(line(CLOSING.acceptance, { after: 200, keepNext: true }));
  body.push(line(CLOSING.print, { after: 120, keepNext: true }));
  body.push(line(CLOSING.sign, { after: 120, keepNext: true }));
  body.push(line(CLOSING.date, { after: 240, keepNext: true }));
  body.push(line(CLOSING.thankYou, { align: AlignmentType.CENTER, bold: true, color: NAVY, before: 240 }));

  const doc = new Document({
    creator: 'Accurate Power & Technology',
    title: `APT Electrical Proposal — ${data.project_name}`,
    styles: { default: { document: { run: { font: FONT, size: SIZE_BODY } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },          // US Letter, DXA
          margin: { top: 1080, bottom: 1080, left: 1440, right: 1440 },
        },
      },
      children: body,
    }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

/* ------------------------------------------------------- LEGACY COMPAT PATH
 * Pre-Phase-3 Agent 4 output contract — kept only so already-generated
 * proposals (agent4_output rows written before this migration) still render.
 * Agent 4's NEW contract (Task 5) emits data-only JSON in the BidData shape
 * instead. */
export interface ProposalJSON {
  date?: string;
  gcName?: string;
  gcContact?: string;
  gcEmail?: string;
  projectName?: string;
  projectAddress?: string;
  jobNumber?: string;
  drawingDate?: string;
  sheets?: string[];
  openingStatement?: string;
  scopeOfWork?: {
    standard6Bullets?: string[];
    A_ServiceDistribution?: string[];
    B_BranchPower?: string[];
    C_LightingControls?: string[];
    D_SiteLightingUnderground?: string[];
    E_LowVoltage?: string[];
    F_Coordination?: string[];
  };
  exclusions?: string[];
  allowances?: Array<{ item: string; footage: number; unit: string; notes: string }>;
  takeoff?: Array<{ category: string; item: string; description: string; unit: string; qty: number; sourceNotes: string; confidence?: string }>;
  terms?: string[];
  totalPrice?: string;
  rfisToResolve?: string[];
}

// Optional authoritative project fields sourced from the bid record. These take
// precedence over Agent 4's generated values where provided — the same
// route-level authority pattern generate-docx has always used.
export interface BidMeta {
  projectName?: string;
  projectAddress?: string;
  gcName?: string;
  gcContact?: string;
  // The DB-validated agent4_price (see run-agent4's parseMoney gate), pre-formatted
  // by the caller. Authoritative over data.totalPrice, the LLM's echo of what the
  // estimator typed — same precedence pattern as projectName/gcName above.
  totalPrice?: string;
}

// Claude occasionally returns array items as objects instead of strings.
// Flatten any such value to a readable string so the docx builder never crashes.
function toStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return [o.item, o.text, o.description, o.question, o.risks, o.risk, o.note]
      .filter(Boolean).map(String).join(' — ') || JSON.stringify(v);
  }
  return String(v ?? '');
}

// Format any date-ish input as "Month DD, YYYY" (e.g. "June 8, 2026"). Falls
// back to today when the value is missing or unparseable — never emits ISO.
function formatDate(v: unknown): string {
  const today = new Date();
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const s = toStr(v).trim();
  if (!s) return fmt(today);
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
  return isNaN(parsed.getTime()) ? fmt(today) : fmt(parsed);
}

// The old A_ServiceDistribution.. F_Coordination keys, mapped onto the new
// standard section titles — same six sections, same order, canonical names.
const LEGACY_SECTION_MAP: [keyof NonNullable<ProposalJSON['scopeOfWork']>, string][] = [
  ['A_ServiceDistribution', SECTION_HEADERS.A],
  ['B_BranchPower', SECTION_HEADERS.B],
  ['C_LightingControls', SECTION_HEADERS.C],
  ['D_SiteLightingUnderground', SECTION_HEADERS.D],
  ['E_LowVoltage', SECTION_HEADERS.E],
  ['F_Coordination', SECTION_HEADERS.F],
];

/**
 * Minimal legacy adapter used only to keep buildProposalDocx rendering during
 * the Task 5 transition. This is intentionally NOT the full-fidelity
 * legacyProposalToBidData adapter (backend/src/bidstd/composeBidData.ts,
 * Task 5.3) — it doesn't need to satisfy validateBidData or the verify gate,
 * only to render the old shape through the new template without throwing.
 */
function legacyToBidData(data: ProposalJSON, bidMeta: BidMeta): BidData {
  const projectName = toStr(bidMeta.projectName) || toStr(data.projectName) || '—';
  const projectAddress = toStr(bidMeta.projectAddress) || toStr(data.projectAddress);
  const client = toStr(bidMeta.gcName) || toStr(data.gcName) || '—';
  const totalPrice = toStr(bidMeta.totalPrice) || toStr(data.totalPrice);

  const sow = data.scopeOfWork ?? {};
  const sections = LEGACY_SECTION_MAP
    .map(([key, title]) => ({
      title,
      bullets: (sow[key] ?? []).map(toStr).filter(b => b.trim().length > 0),
    }))
    .filter(s => s.bullets.length > 0);

  const takeoffByCategory = new Map<string, BidData['takeoff'][number]>();
  for (const t of data.takeoff ?? []) {
    const name = toStr(t.category) || 'Uncategorized';
    if (!takeoffByCategory.has(name)) takeoffByCategory.set(name, { name, items: [] });
    takeoffByCategory.get(name)!.items.push({
      item: toStr(t.item),
      description: toStr(t.description),
      unit: toStr(t.unit),
      qty: t.qty ?? '',
      source: toStr(t.sourceNotes),
    });
  }

  return {
    project_slug: projectName.replace(/[^a-z0-9]+/gi, '') || 'Project',
    location_slug: (projectAddress.split(',')[1] || '').trim().replace(/[^a-z0-9]+/gi, '') || 'FL',
    date: formatDate(data.date),
    client,
    contact: toStr(bidMeta.gcContact) || toStr(data.gcContact) || undefined,
    email: toStr(data.gcEmail) || undefined,
    project_name: projectName,
    project_address: projectAddress,
    job_number: toStr(data.jobNumber),
    total_price: totalPrice,
    scope: (sow.standard6Bullets ?? []).map(toStr),
    sections,
    exclusions: (data.exclusions ?? []).map(toStr),
    takeoff: [...takeoffByCategory.values()],
    terms: (data.terms ?? []).map(toStr),
  };
}

/**
 * Kept working during the Task 5 transition: maps the pre-Phase-3 Agent 4
 * output shape onto BidData and renders it through the exact same
 * renderBidDocx used for the new shape.
 */
export async function buildProposalDocx(data: ProposalJSON, bidMeta: BidMeta = {}): Promise<Buffer> {
  const bidData = legacyToBidData(data, bidMeta);
  return renderBidDocx(bidData);
}
