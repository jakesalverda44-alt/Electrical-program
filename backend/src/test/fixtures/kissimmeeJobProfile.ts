// Job profile fix round — the REAL Kissimmee set (AutoZone #10077, 55 pages)
// as the production path sees it:
//
//   * pages: `kissimmee-az10077-pages.json.gz` is the unmodified output of
//     backend/src/ai/pdfText.ts extractPdfPageTexts (pdftotext -layout) on
//     the real PDF (sha256 in the file) — every page, not excerpts.
//   * inventory: the sheet check's classifier output for this set. The
//     classifier is a Haiku title-block call, so it is mocked here; each
//     sheet number / title is copied from that page's own title block (and
//     the civil cover's sheet index). PH0.1 (a civil-prepared photometric
//     plan) is classified electrical, as a lighting sheet would be — it
//     carries the civil engineer and the 12/3/2025 bid-set date, which the
//     profile must NOT pick up over the E-sheets.
//   * reply: a realistic structured reply from the job-profile model, every
//     quote copied verbatim from the text the model is shown.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import type { InventoryPage, ModelReply } from '../../ai/jobProfile';

export interface KissimmeeFixture { source: string; pdfSha256: string; extractedWith: string; pageCount: number; pages: string[] }

export function loadKissimmeePages(): KissimmeeFixture {
  const gz = fs.readFileSync(path.join(__dirname, 'kissimmee-az10077-pages.json.gz'));
  return JSON.parse(zlib.gunzipSync(gz).toString('utf8')) as KissimmeeFixture;
}

export const KISSIMMEE_PDF_PATH =
  '/Users/jakesalverda/Library/CloudStorage/OneDrive-AccuratePowerandTechnology/Bids/Summit GC/Autozone Kissimmee, FL/Plans/1.0 - AZ #10077 - Kissimmee, FL FULL SET.pdf';

type Row = [sheetNo: string, title: string, discipline: string];

/** Page 1..55, in order. */
export const KISSIMMEE_SHEETS: Row[] = [
  ['C0.1', 'COVER SHEET', 'cover'],
  ['V0.1', 'ALTA/NSPS LAND TITLE SURVEY', 'civil'],
  ['V1.1', 'ALTA/NSPS LAND TITLE SURVEY', 'civil'],
  ['V1.2', 'ALTA/NSPS LAND TITLE SURVEY', 'civil'],
  ['C0.2', 'GENERAL NOTES SHEET', 'civil'],
  ['C0.3', 'GENERAL NOTES SHEET', 'civil'],
  ['D0.1', 'DEMOLITION PLAN', 'civil'],
  ['C1.1', 'STORMWATER POLLUTION PREVENTION PLAN', 'civil'],
  ['C1.2', 'STORMWATER POLLUTION PREVENTION PLAN DETAILS SHEET', 'civil'],
  ['C2.1', 'SITE DIMENSION PLAN', 'civil'],
  ['C2.2', 'TRUCK TURN EXHIBIT', 'civil'],
  ['C3.1', 'GRADING AND STORM DRAINAGE PLAN', 'civil'],
  ['C3.2', 'SITE CROSS SECTIONS', 'civil'],
  ['C3.3', 'SANITARY SEWER PLAN AND PROFILE', 'civil'],
  ['C4.1', 'COMPOSITE UTILITY PLAN', 'civil'],
  ['C5.1', 'AUTOZONE DETAILS SHEET', 'civil'],
  ['C6.1', 'AGENCY DETAILS SHEET', 'civil'],
  ['C6.2', 'AGENCY DETAILS SHEET', 'civil'],
  ['PH0.1', 'PHOTOMETRIC PLAN', 'electrical'],
  ['L1.0', 'TREE RETENTION PLAN & LANDSCAPE PLAN', 'other'],
  ['L5.0', 'LANDSCAPE NOTES AND DETAILS', 'other'],
  ['IR1.0', 'IRRIGATION PLAN', 'plumbing'],
  ['IR5.0', 'IRRIGATION NOTES AND DETAILS', 'plumbing'],
  ['IR5.1', 'IRRIGATION SPECIFICATIONS', 'plumbing'],
  ['A-0', 'COVER SHEET / CODE ANALYSIS', 'architectural'],
  ['A-1', 'FLOOR PLAN / DOOR SCHEDULE / WALL DETAILS', 'architectural'],
  ['A-1.1', 'LIFE SAFETY PLAN', 'architectural'],
  ['A-1.2', 'REFLECTED CEILING PLAN', 'architectural'],
  ['A-2', 'EXTERIOR ELEVATIONS', 'architectural'],
  ['A-3', 'EXTERIOR WALL SECTIONS', 'architectural'],
  ['A-3.1', 'EXTERIOR WALL SECTIONS', 'architectural'],
  ['A-3.2', 'EXTERIOR WALL SECTIONS', 'architectural'],
  ['A-4', 'TILE PLAN / INTERIOR ELEVATIONS / RESTROOM PLAN & ELEVATIONS', 'architectural'],
  ['A-5', 'STOREFRONT / VESTIBULE PLAN / DETAILS', 'architectural'],
  ['A-6', 'DETAILS', 'architectural'],
  ['A-6.1', 'ROOF HATCH DETAILS', 'architectural'],
  ['SG-1', 'SIGNAGE', 'other'],
  ['S0', 'GENERAL NOTES', 'structural'],
  ['S0.1', 'TYPICAL DETAILS', 'structural'],
  ['S0.2', 'TYPICAL DETAILS', 'structural'],
  ['S1.0', 'FOUNDATION PLAN AND DETAILS', 'structural'],
  ['S2.0', 'ROOF FRAMING PLAN AND DETAILS', 'structural'],
  ['S2.1', 'CANOPY FRAMING', 'structural'],
  ['S3.0', 'PRE-ENGINEERED METAL BUILDING', 'structural'],
  ['M-1', 'HEATING AND COOLING', 'mechanical'],
  ['M-1.1', 'HEATING AND COOLING', 'mechanical'],
  ['P-1', 'PLUMBING PLAN/NOTES', 'plumbing'],
  ['P-2', 'PLUMBING PLAN', 'plumbing'],
  ['E-1', 'POWER PLAN / GENERAL NOTES', 'electrical'],
  ['E-2', 'CONDUIT / POWER AND DATA PLANS', 'electrical'],
  ['E-3', 'LIGHTING PLANS AND DETAILS', 'electrical'],
  ['E-4', 'PANELBOARD / 1-LINE DIAGRAMS AND DETAILS', 'electrical'],
  ['E-5', 'LIGHTING CONTROL PANEL AND DETAILS', 'electrical'],
  ['E-6', 'VENSTAR HVAC AND LIGHTING CONTROL', 'electrical'],
  ['E-7', 'SITE LIGHTING PLAN', 'electrical'],
];

export const KISSIMMEE_FILE = '1.0 - AZ #10077 - Kissimmee, FL FULL SET.pdf';

export function kissimmeeInventory(opts: { sha: string; documentId?: string; uploadedAt?: string; texts?: string[]; file?: string }): InventoryPage[] {
  return KISSIMMEE_SHEETS.map(([sheetNo, title, discipline], i) => ({
    ...(opts.documentId ? { documentId: opts.documentId } : {}),
    file: opts.file ?? KISSIMMEE_FILE, sha: opts.sha, page: i + 1, sheetNo, title, discipline,
    uploadedAt: opts.uploadedAt ?? '2026-09-24T12:00:00.000Z',
    textChars: opts.texts?.[i]?.length ?? 0,
  }));
}

/** A realistic model reply for the pages the production selection picks
 *  (C0.1, A-0 covers; A-1.1 + C2.1 code / area; PH0.1 + E-1..E-7 title
 *  blocks). Every quote is verbatim from the compacted text it was shown. */
export const KISSIMMEE_MODEL_REPLY: ModelReply = {
  brand: { value: 'AutoZone', sheet: 'C0.1', quote: 'AutoZone Store No. FL10077', confidence: 'high' },
  project_name: { value: 'AutoZone Store No. FL10077', sheet: 'C0.1', quote: 'AutoZone Store No. FL10077', confidence: 'high' },
  project_type: { value: 'retail', sheet: 'C0.1', quote: 'AutoZone Store No. FL10077', confidence: 'medium' },
  store_number: { value: '10077', sheet: 'E-1', quote: 'AutoZone Store No. 10077', confidence: 'high' },
  prototype: { value: '7N2-L', sheet: 'E-1', quote: '7N2-L', confidence: 'medium' },
  site_address: {
    street: '2860 N OLD LAKE WILSON RD.', city: 'KISSIMMEE', state: 'FLORIDA', zip: '34747',
    sheet: 'C0.1', quote: '2860 N OLD LAKE WILSON RD., KISSIMMEE, FLORIDA 34747', confidence: 'high',
  },
  building_sf: { value: '7381', label: 'building', sheet: 'C2.1', quote: 'BUILDING AREA: | 7,381 S.F.', confidence: 'high' },
  plan_date: { value: '2025-09-22', kind: 'issue', sheet: 'E-1', quote: '09/22/2025', confidence: 'high' },
  owner: { value: 'AUTOZONE STORES LLC', sheet: 'C0.1', quote: 'Owner / Developer: AUTOZONE STORES LLC', confidence: 'high' },
  architect: { value: 'AUTOZONE, INC.', sheet: 'C0.1', quote: 'AUTOZONE, INC.', confidence: 'medium' },
  engineer: { value: 'DANNY E. DOSS P.E.', sheet: 'E-1', quote: 'ENGINEER: DANNY E. DOSS P.E.', confidence: 'high' },
  build_type: { value: '', sheet: '', quote: '', confidence: 'none' },
  other_brands: [],
  systems: {
    fuel: { present: 'unknown', sheet: '', quote: '' },
    site_lighting: { present: 'yes', sheet: 'E-7', quote: 'SITE LIGHTING PLAN' },
    fire_alarm: { present: 'unknown', sheet: '', quote: '' },
    generator: { present: 'unknown', sheet: '', quote: '' },
    ev: { present: 'unknown', sheet: '', quote: '' },
  },
};
