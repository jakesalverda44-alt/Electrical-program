// Next round — a Kissimmee-SHAPED plan set with real text layers (pdftotext
// reads its notes), for the sheet check, references and the analysis plan.
// Mirrors the live AutoZone #10077 failure: E-7's general notes point at the
// photometric sheet (which the title-block classifier calls 'civil') and at a
// mechanical sheet that is not in the upload.
//
// The bytes are built by the same dependency-free vector PDF writer as
// kissimmee-mini.pdf and are well over 4 KB. Tests always go through
// ownedBuffer(): a Buffer that owns its whole ArrayBuffer (never Node's
// shared pool) — the live upload shape that exposed the pdf.js
// detached-buffer bug, which tiny pooled fixture buffers hid.
import { buildSymbolPdf, type SymbolPage, type TextSpec } from './buildSymbolPdf';

const W = 1728;
const H = 1296;

function titleBlock(sheetNo: string, title: string): TextSpec[] {
  const x = W * 0.92;
  return [{ x, y: 120, size: 16, text: sheetNo }, { x, y: 90, size: 8, text: title }];
}

function notes(lines: string[], x = 72, y0 = 1200): TextSpec[] {
  return lines.map((text, i) => ({ x, y: y0 - i * 16, size: 9, text }));
}

/** Boilerplate notes so each sheet carries a realistic amount of text. */
const GENERAL = [
  'ALL WORK SHALL COMPLY WITH THE 2023 NEC AND LOCAL AMENDMENTS.',
  'ALL CONDUCTORS SHALL BE COPPER THHN/THWN-2 UNLESS NOTED OTHERWISE.',
  'MINIMUM CONDUCTOR SIZE #12 AWG. GFCI PROTECTION PER NEC 210.8.',
  'EXIT AND EMERGENCY FIXTURES LISTED PER UL 924.',
  'FIELD VERIFY ALL EXISTING CONDITIONS PRIOR TO BID.',
];

export const KISSIMMEE_SET_CLASSIFIED = [
  { page: 1, sheetNo: 'G-0.1', title: 'COVER SHEET', discipline: 'cover', cls: 'detail' },
  { page: 2, sheetNo: 'A-1.1', title: 'FLOOR PLAN', discipline: 'architectural', cls: 'plan' },
  { page: 3, sheetNo: 'E-0.1', title: 'ELECTRICAL SCHEDULES', discipline: 'electrical', cls: 'schedule' },
  { page: 4, sheetNo: 'E-1', title: 'ELECTRICAL SITE PLAN', discipline: 'electrical', cls: 'plan' },
  { page: 5, sheetNo: 'E-3', title: 'LIGHTING PLAN', discipline: 'electrical', cls: 'plan' },
  { page: 6, sheetNo: 'E-7', title: 'ELECTRICAL DETAILS', discipline: 'electrical', cls: 'detail' },
  // The live failure: the photometric site plan read as a civil sheet.
  { page: 7, sheetNo: 'PH0.1', title: 'PHOTOMETRIC SITE PLAN', discipline: 'civil', cls: 'plan' },
  { page: 8, sheetNo: 'C-3.1', title: 'UTILITY PLAN', discipline: 'civil', cls: 'plan' },
];

export function kissimmeeSetPages(): SymbolPage[] {
  return [
    { mediaBox: [0, 0, W, H], symbols: [], texts: [...notes(['AUTOZONE STORE #10077', 'KISSIMMEE, FL', 'SHEET INDEX', ...GENERAL]), ...titleBlock('G-0.1', 'COVER SHEET')] },
    { mediaBox: [0, 0, W, H], symbols: [], texts: [...notes(['FLOOR PLAN', 'SEE E-3 FOR LIGHTING.', ...GENERAL]), ...titleBlock('A-1.1', 'FLOOR PLAN')] },
    {
      mediaBox: [0, 0, W, H], symbols: [], texts: [...notes([
        'LUMINAIRE SCHEDULE',
        'A  4 FT LED LINEAR WRAPAROUND  32W', 'B  8 FT LED LINEAR WRAPAROUND  64W',
        'S1  LED AREA LIGHT SINGLE HEAD 25 FT POLE', 'S2  LED AREA LIGHT TWIN HEAD 25 FT POLE',
        'W1  LED WALL PACK FULL CUTOFF', 'W2  LED WALL PACK FORWARD THROW',
        'SYMBOL LEGEND',
        'SIMPLEX RECEPTACLE, G.C. FURNISHED/INSTALLED',
        'DUPLEX RECEPTACLE / FLOOR RECEPTACLE, G.C.',
        'EXHAUST FAN RECESSED, INSTALLED BY HVAC, WIRED BY EC',
        ...GENERAL,
      ]), ...titleBlock('E-0.1', 'ELECTRICAL SCHEDULES')],
    },
    { mediaBox: [0, 0, W, H], symbols: [{ type: 'S1', x: 250, y: 250 }, { type: 'S2', x: 1300, y: 300 }], texts: [...notes(['ELECTRICAL SITE PLAN', 'POLE BASES PER DETAIL 3/E-7.', ...GENERAL]), ...titleBlock('E-1', 'ELECTRICAL SITE PLAN')] },
    { mediaBox: [0, 0, W, H], symbols: [{ type: 'A', x: 300, y: 400 }], texts: [...notes(['LIGHTING PLAN', 'FIXTURE LOCATIONS PER REFLECTED CEILING PLAN.', ...GENERAL]), ...titleBlock('E-3', 'LIGHTING PLAN')] },
    {
      mediaBox: [0, 0, W, H], symbols: [], texts: [...notes([
        'GENERAL NOTES',
        '1. ALL WORK PER NEC.',
        '2. COORDINATE ROOF PENETRATIONS WITH THE GC.',
        '3. SITE LIGHTING POLES AND WALL PACKS PER PHOTOMETRIC PLAN PH0.1.',
        '4. SEE M-1 FOR RTU ELECTRICAL DATA.',
        '5. SITE CONDUIT ROUTING: SEE CIVIL.',
        '6. POWER TO OWNER EQUIPMENT: SEE OWNER-PROVIDED VENDOR DRAWINGS FOR REQUIREMENTS.',
        ...GENERAL,
      ]), ...titleBlock('E-7', 'ELECTRICAL DETAILS')],
    },
    { mediaBox: [0, 0, W, H], symbols: [{ type: 'S1', x: 250, y: 250 }, { type: 'W1', x: 900, y: 900 }], texts: [...notes(['PHOTOMETRIC SITE PLAN', 'CALCULATED FOOTCANDLES AT GRADE', ...GENERAL]), ...titleBlock('PH0.1', 'PHOTOMETRIC SITE PLAN')] },
    { mediaBox: [0, 0, W, H], symbols: [], texts: [...notes(['UTILITY PLAN', 'STORM AND SANITARY BY OTHERS.', ...GENERAL]), ...titleBlock('C-3.1', 'UTILITY PLAN')] },
  ];
}

export function buildKissimmeeSetPdf(): Buffer {
  return buildSymbolPdf(kissimmeeSetPages());
}

/** A copy that owns its whole ArrayBuffer (Buffer.alloc is never pooled). */
export function ownedBuffer(src: Buffer): Buffer {
  const b = Buffer.alloc(src.length);
  src.copy(b);
  return b;
}
