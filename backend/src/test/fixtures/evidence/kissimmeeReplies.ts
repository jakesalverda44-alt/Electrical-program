// Evidence round — the evidence readers' replies for the Kissimmee E-1 / E-2 /
// E-3 / E-4 / E-7 sheets, in the exact JSON shape the prompts ask for.
//
// HONEST PROVENANCE: no model was called (the hard rules forbid it). Each
// reply was TRANSCRIBED by the executor from the real sheets (pdftoppm crops
// of "1.0 - AZ #10077 - Kissimmee, FL FULL SET.pdf" pp. 49-52, 55 at 40-200
// DPI): viewport boxes are measured off the 40 DPI overview (1440 x 960 px),
// the legend / schedule text and every panel-schedule row are copied
// verbatim. Where a real model would have to judge (a viewport's kind, a
// device's target type) the reply gives the reading a careful model should
// give; the parsers' own validation is tested separately on bad replies.
import { displayedToPdf } from '../../../estimating/pageGeometry';
import { SHEET_H_PT, SHEET_W_PT, SHEET_ROTATION } from './buildRasterSheet';

const W = 1440, H = 960;
type Px = [number, number, number, number];
const box = (b: Px | null) => (b ? [b[0] / W, b[1] / H, b[2] / W, b[3] / H].map(n => Math.round(n * 1000) / 1000) : null);

interface Vp { number: string; title: string; scale: string; kind: string; box: Px; building?: Px | null; area_on_main?: Px | null }
const vpJson = (vps: Vp[]) => JSON.stringify({ viewports: vps.map(v => ({ ...v, box: box(v.box), building: box(v.building ?? null), area_on_main: box(v.area_on_main ?? null) })) });

const S8 = '1/8" = 1\'-0"';

/** Page number in the real set -> the viewport reader's reply. */
export const VIEWPORT_REPLIES: Record<number, string> = {
  49: vpJson([
    { number: '1', title: 'POWER PLAN', scale: S8, kind: 'main_plan', box: [58, 18, 895, 632], building: [172, 150, 750, 485] },
    { number: '2', title: 'ELECTRONIC SECURITY DETAIL', scale: S8, kind: 'detail', box: [58, 634, 478, 940] },
    // The main plan marks this area with the dashed "3/E1" boundary.
    { number: '3', title: 'RESTROOM POWER AND LIGHTING', scale: '1/4" = 1\'-0"', kind: 'enlarged_plan', box: [480, 634, 690, 940], area_on_main: [678, 134, 764, 254] },
    { number: '4', title: 'GENERAL NOTES', scale: '3/32" = 1\'-0"', kind: 'notes', box: [898, 18, 1330, 325] },
    { number: '5', title: 'POWER SCHEDULE', scale: S8, kind: 'legend', box: [898, 325, 1330, 625] },
    { number: '6', title: 'ELECTRICAL NOTES', scale: S8, kind: 'notes', box: [898, 627, 1115, 940] },
    { number: '7', title: 'RECEPTACLE DETAIL / SUPPLY FIXTURES', scale: '1" = 1\'-0"', kind: 'detail', box: [1117, 627, 1330, 940] },
  ]),
  50: vpJson([
    { number: '1', title: 'POWER POLE & JUNCTION BOX LOCATIONS', scale: S8, kind: 'main_plan', box: [58, 18, 895, 632], building: [190, 125, 775, 490] },
    { number: '2', title: 'CHECK OUT POWER POLE #2', scale: S8, kind: 'detail', box: [58, 634, 272, 940] },
    { number: '3', title: 'PARTS POD POWER POLE #3', scale: S8, kind: 'detail', box: [272, 634, 483, 940] },
    { number: '4', title: 'TESTER POWER POLE #4', scale: S8, kind: 'detail', box: [483, 634, 693, 940] },
    { number: '5', title: 'COMMERCIAL COUNTER POWER POLE #6', scale: S8, kind: 'detail', box: [693, 634, 903, 940] },
    { number: '6', title: 'OVERHEAD DOOR ALARM REQS.', scale: '1/4" = 1\'-0"', kind: 'detail', box: [903, 18, 1117, 165] },
    { number: '7', title: 'TYPICAL MAN DOOR', scale: '1/4" = 1\'-0"', kind: 'detail', box: [1117, 18, 1330, 165] },
    { number: '8', title: 'GENERAL WIRING AND POWER NOTES', scale: S8, kind: 'notes', box: [903, 165, 1330, 320] },
    { number: '9', title: 'POWER POLE LEGEND', scale: S8, kind: 'legend', box: [903, 320, 1330, 478] },
    { number: '10', title: 'POWER POLE NOTES', scale: S8, kind: 'notes', box: [903, 478, 1330, 632] },
    // Same scale as the main plan, but a zoom of the office area near pole 1/5.
    { number: '11', title: 'OFFICE AREA POWER PLAN', scale: S8, kind: 'enlarged_plan', box: [903, 634, 1330, 940], area_on_main: [195, 248, 272, 323] },
  ]),
  51: vpJson([
    { number: '1', title: 'LIGHTING PLAN', scale: S8, kind: 'main_plan', box: [58, 18, 895, 632], building: [185, 128, 790, 450] },
    { number: '2', title: 'LIGHTING CIRCUIT SYMBOLS', scale: S8, kind: 'legend', box: [903, 18, 1330, 170] },
    { number: '3', title: 'SIGNAGE INSTALLATION GENERAL NOTES', scale: '', kind: 'notes', box: [903, 170, 1330, 322] },
    { number: '4', title: 'LIGHT FIXTURE SCHEDULE', scale: S8, kind: 'schedule', box: [903, 322, 1330, 812] },
    { number: '5', title: 'LED STRIP FIXTURE MOUNTING DETAIL BETWEEN JOISTS', scale: S8, kind: 'detail', box: [58, 634, 478, 780] },
    { number: '6', title: 'LED STRIP FIXTURE MOUNTING DETAIL FIXTURE AT JOIST', scale: S8, kind: 'detail', box: [58, 780, 478, 940] },
    { number: '7', title: 'LIGHTING NOTES', scale: S8, kind: 'notes', box: [478, 634, 895, 940] },
  ]),
  52: vpJson([
    { number: '1', title: 'ALARM / PHONE BOARD REQUIREMENTS', scale: '3/4" = 1\'-0"', kind: 'detail', box: [58, 18, 487, 362] },
    { number: '2', title: 'SCHEMATIC ONE LINE - ELECTRICAL SERVICE', scale: '3/32" = 1\'-0"', kind: 'detail', box: [58, 365, 487, 650] },
    { number: '', title: 'LOAD TOTALS', scale: '', kind: 'schedule', box: [58, 700, 487, 905] },
    { number: '', title: 'PANEL A', scale: '', kind: 'schedule', box: [493, 18, 912, 445] },
    { number: '', title: 'PANEL B', scale: '', kind: 'schedule', box: [912, 18, 1330, 445] },
    { number: '3', title: 'GROUNDING / BONDING DIAGRAM', scale: '3/32" = 1\'-0"', kind: 'detail', box: [493, 485, 912, 712] },
  ]),
  55: vpJson([
    { number: '', title: 'SITE LIGHTING PLAN', scale: 'Not to Scale', kind: 'main_plan', box: [58, 18, 1330, 940], building: [540, 565, 925, 765] },
    { number: '', title: 'LUMINAIRE SCHEDULE', scale: '', kind: 'schedule', box: [1016, 38, 1282, 88] },
  ]),
};

const LEGEND9 = {
  1: 'OFFICE AREA POWER POLE - 3" DIA. PVC PIPE LABEL FOR POWER WITH BOTTOM OF PIPE 4" ABOVE FLOOR - TWO DUPLEX OUTLETS HARD WIRE TO JUNCTION BOX AT UNDERSIDE OF ROOF DECK BY G.C. ADDITIONALLY SIMPLEX OUTLETS IN JUNCTION BOXES ON FLOOR TO BE HARD WIRED TO POLE WITH FLEXIBLE CONDUIT AND CONNECTED TO MATCHING HOME RUN CIRCUITS IN THE JUNCTION BOX AT THE UNDERSIDE OF THE ROOF DECK.',
  2: 'CHECKOUT COUNTER POWER POLE WITH ONE DUPLEX OUTLET PRE-WIRED ON POLE TO BE HARD WIRED TO JUNCTION BOX AT THE INDERSIDE OF THE ROOF DECK BY G.C.',
  3: 'PARTS POD POWER POLE WITH ONE DUPLEX OUTLET PRE-WIRED ON POLE TO BE HARD WIRED TO JUNCTION BOX AT THE UNDERSIDE OF THE ROOF DECKBY THE G.C..',
  4: 'TEST STATION POWER POLE WITH ONE SIMPLEX OUTLET AND ONE DUPLEX OUTLET PRE-WIRED ON POLE TO BE HARD WIRED TO JUNCTION BOX AT THE UNDERSIDE OF THE ROOF DECK BY G.C. ATTACH TOP OF POWER POLE TO ROOF DECK AND STRAP POLE TO THE FACE OF THE FIXTURE UPRIGHT.',
  6: 'COMMERCIAL COUNTER POWER POLE WITH TWO DUPLEX OUTLETS PRE-WIRED ON POLE TO BE HARD WIRED TO JUNCTION BOX AT THE UNDERSIDE OF THE ROOF DECK BY G.C.',
};
const DUPLEX = 'DUPLEX RECEPTACLE / FLOOR RECEPTACLE';
const SIMPLEX = 'SIMPLEX RECEPTACLE';

/** Page number -> the typicals reader's reply (one call per sheet). */
export const TYPICALS_REPLIES: Record<number, string> = {
  49: JSON.stringify({ packages: [{
    viewport: '5', host: 'Junction box with 6\'-0" flex conduit at wall & H.P. counters', host_tag: '', host_marker: '', host_target: 'COIL + J',
    devices: [{ text: 'Receptacle mounted to base plate', target: DUPLEX, qty: 1 }],
    quote: 'JUNCTION BOX WITH 6\'-0" FLEX CONDUIT AT WALL & H.P. COUNTERS | G.C. (FIXTURE KICK PLATE BY OWNER) | J-BOX AT FLOOR LEVEL, FLEX CONDUIT SET UNDER DISPLAY FIXTURES. RECEPTACLE MOUNTED TO BASE PLATE. SEE DETAIL 7/E1',
  }] }),
  50: JSON.stringify({ packages: [
    { viewport: '9', host: 'Office area power pole', host_tag: '1', host_marker: 'hexagon tag 1', host_target: '',
      devices: [{ text: 'duplex outlets', target: DUPLEX, qty: 2 }, { text: 'simplex outlets in junction boxes on floor', target: SIMPLEX, qty: null }], quote: LEGEND9[1] },
    { viewport: '9', host: 'Checkout counter power pole', host_tag: '2', host_marker: 'hexagon tag 2', host_target: '',
      devices: [{ text: 'duplex outlet', target: DUPLEX, qty: 1 }], quote: LEGEND9[2] },
    { viewport: '9', host: 'Parts pod power pole', host_tag: '3', host_marker: 'hexagon tag 3', host_target: '',
      devices: [{ text: 'duplex outlet', target: DUPLEX, qty: 1 }], quote: LEGEND9[3] },
    { viewport: '9', host: 'Test station power pole', host_tag: '4', host_marker: 'hexagon tag 4', host_target: '',
      devices: [{ text: 'simplex outlet', target: SIMPLEX, qty: 1 }, { text: 'duplex outlet', target: DUPLEX, qty: 1 }], quote: LEGEND9[4] },
    { viewport: '9', host: 'Commercial counter power pole', host_tag: '6', host_marker: 'hexagon tag 6', host_target: '',
      devices: [{ text: 'duplex outlets', target: DUPLEX, qty: 2 }], quote: LEGEND9[6] },
  ] }),
};

const r = (cells: string[], y0: number, y1: number) => ({ cells, y0, y1 });
const F12 = '2#12,#12G,1/2"C', F10 = '2#10,#10G,1/2"C';
const PANEL_COLS = ['CKT #', 'BREAKER TRIP/POLES', 'CIRCUIT DESCRIPTION', 'A', 'B', 'C', 'FEEDER RACEWAY AND CONDUCTORS'];

function panelRows(rows: Array<[string, string, string, string, string, string, string]>): Array<{ cells: string[]; y0: number; y1: number }> {
  const top = 0.13, step = (0.97 - top) / rows.length;
  return rows.map((c, i) => r(c, Math.round((top + i * step) * 1000) / 1000, Math.round((top + (i + 1) * step) * 1000) / 1000));
}

/** Viewport title -> the schedule reader's reply (verbatim transcriptions). */
export const TABLE_REPLIES: Record<string, string> = {
  'PANEL A': JSON.stringify({ title: 'PANEL A', columns: PANEL_COLS, rows: panelRows([
    ['1', '20/1', 'WORK LIGHTING', '1,250', '', '', F12], ['3', '20/1', 'WORK LIGHTING', '', '984', '', F12], ['5', '20/1', 'WORK LIGHTING', '', '', '816', F12],
    ['7', '-/1', 'SPACE', '0', '', '', ''], ['9', '20/1', 'EXIT / EMERGENCY LIGHTING', '', '51', '', F12], ['11', '-/1', 'SPACE', '', '', '0', ''],
    ['13', '20/1', 'EXTERIOR BUILDING LIGHTING', '233', '', '', F12], ['15', '20/1', 'SITE LIGHTING', '', '209', '', F10], ['17', '20/1', 'SITE LIGHTING', '', '', '418', F10],
    ['19', '20/1', 'SITE LIGHTING', '209', '', '', F10], ['21', '-/1', 'SPACE', '', '0', '', ''], ['23', '-/1', 'SPACE', '', '', '0', ''],
    ['25', '-/1', 'SPACE', '0', '', '', ''], ['27', '20/1', 'WATER HEATER', '', '1,500', '', F12], ['29', '20/1', 'CK OUT REG & PRN', '', '', '1,920', F10],
    ['31', '20/1', 'CCTV MONITOR', '300', '', '', F10], ['33', '20/1', 'POD #1', '', '1,920', '', F10], ['35', '20/1', 'POD #2', '', '', '800', F10],
    ['37', '20/1', 'ALARM', '720', '', '', F12], ['39', '20/1', 'TEL CO', '', '720', '', F12], ['41', '20/1', 'ALARM RECEPTACLE', '', '', '360', F12],
    ['2', '20/1', 'SALES LIGHTING', '1,100', '', '', F12], ['4', '20/1', 'SALES LIGHTING', '', '744', '', F12], ['6', '20/1', 'FRONT WALL SIGN', '', '', '1,220', F10],
    ['8', '-/1', 'SPACE', '0', '', '', ''], ['10', '-/1', 'SPACE', '', '0', '', ''], ['12', '20/1', 'EXTERIOR SOFFIT LIGHTING', '', '', '637', F10],
    ['14', '20/1', 'SIDE WALL SIGN', '1,220', '', '', F10], ['16', '20/1', 'SIDE WALL SIGN', '', '1,220', '', F10], ['18', '20/1', 'PYLON SIGN', '', '', '1,220', F10],
    ['20', '-/1', 'SPACE', '0', '', '', ''], ['22', '20/1', 'RESTROOM LTS/FANS', '', '400', '', F12], ['24', '-/1', 'SPACE', '', '', '0', ''],
    ['26', '-/1', 'SPACE', '0', '', '', ''], ['28', '-/1', 'SPACE', '', '0', '', ''], ['30', '20/1', 'OFFICE TRAINING', '', '', '1,920', F10],
    ['32', '20/1', 'OFFICE IT', '1,920', '', '', F10], ['34', '20/1', 'EAS POST & ALARM', '', '930', '', F10], ['36', '20/1', 'OFFICE UPS', '', '', '260', F10],
    ['38', '20/1', 'COMMERCIAL', '1,820', '', '', F10], ['40', '20/1', 'COMMERCIAL', '', '800', '', F12], ['42', '20/1', 'COMMERCIAL', '', '', '800', F12],
  ]) }),
  'PANEL B': JSON.stringify({ title: 'PANEL B', columns: PANEL_COLS, rows: panelRows([
    ['1', '60/3', 'RTU-1', '6,124', '', '', '3#6,#10G,3/4"C'], ['3', '|', '', '', '6,124', '', ''], ['5', '|', '', '', '', '6,124', ''],
    ['7', '-/1', 'SPACE', '0', '', '', ''], ['9', '-/1', 'SPACE', '', '0', '', ''], ['11', '-/1', 'SPACE', '', '', '0', ''],
    ['13', '20/1', 'MAINT & OX-BLUE RECEPTACLE', '900', '', '', F12], ['15', '20/1', 'BATTERY CHARGER', '', '1,490', '', F12], ['17', '20/1', 'BATTERY CHARGER', '', '', '1,490', F12],
    ['19', '20/1', 'BATTERY CHARGER', '1,490', '', '', F12], ['21', '20/1', 'BATTERY CHARGER', '', '1,490', '', F12], ['23', '20/1', 'BATTERY CHARGER', '', '', '1,490', F12],
    ['25', '20/1', 'ALC PANEL', '480', '', '', F12], ['27', '-/1', 'SPACE', '', '0', '', ''], ['29', '20/1', 'BREAK ROOM FRIDGE', '', '', '400', F12],
    ['31', '-/1', 'SPACE', '0', '', '', ''], ['33', '-/1', 'SPACE', '', '0', '', ''], ['35', '-/1', 'SPACE', '', '', '0', ''],
    ['37', '-/1', 'SPACE', '0', '', '', ''], ['39', '-/1', 'SPACE', '', '0', '', ''], ['41', '-/1', 'SPACE', '', '', '0', ''],
    ['2', '60/3', 'RTU-2', '6,124', '', '', '3#6,#10G,3/4"C'], ['4', '|', '', '', '6,124', '', ''], ['6', '|', '', '', '', '6,124', ''],
    ['8', '-/1', 'SPACE', '0', '', '', ''], ['10', '-/1', 'SPACE', '', '0', '', ''], ['12', '-/1', 'SPACE', '', '', '0', ''],
    ['14', '-/1', 'SPACE', '0', '', '', ''], ['16', '-/1', 'SPACE', '', '0', '', ''], ['18', '-/1', 'SPACE', '', '', '0', ''],
    ['20', '20/1', 'MINI-TUNE', '1,500', '', '', F10], ['22', '-/1', 'SPACE', '', '0', '', ''], ['24', '20/1', 'TEST ACCESSORIES', '', '', '800', F10],
    ['26', '20/1', 'DRINKING FOUNTAIN', '480', '', '', F12], ['28', '20/1', 'LANDSCAPE CONTROL', '', '360', '', F12], ['30', '20/1', 'GENERAL RECEPTACLE', '', '', '900', F12],
    ['32', '20/1', 'DRINK MACHINE', '1,200', '', '', F10], ['34', '-/1', 'SPACE', '', '0', '', ''], ['36', '-/1', 'SPACE', '', '', '0', ''],
    ['38', '-/1', 'SPACE', '0', '', '', ''], ['40', '-/1', 'SPACE', '', '0', '', ''], ['42', '-/1', 'SPACE', '', '', '0', ''],
  ]) }),
  'LOAD TOTALS': JSON.stringify({ title: 'LOAD TOTALS', columns: PANEL_COLS.slice(0, 6).concat(['FEEDER RACEWAY AND CONDUCTORS']), rows: [
    r(['1', '200/3', 'FUSED DISCONNECT DISCON A', '8,752', '9,478', '10,371', '4#3/0,2"C'], 0.3, 0.36),
    r(['2', '200/3', 'FUSED DISCONNECT DISCON B', '18,298', '15,588', '17,328', '4#3/0,2"C'], 0.36, 0.42),
  ] }),
  'POWER SCHEDULE': JSON.stringify({ title: 'POWER SCHEDULE', columns: ['SYM', 'DESCRIPTION', 'FURN.', 'REMARKS'], rows: [
    r(['', 'EXHAUST FAN RECESSED', 'AUTOZONE', 'INSTALLED BY HVAC CONTRACTOR, WIRED BY ELECTRICAL CONTRACTOR.'], 0.1, 0.18),
    r(['', 'JUNCTION BOX', 'G.C.', 'SEE SHT. E2 FOR ADDITIONAL JUNCTION BOX LOCATIONS AND REQUIREMENTS AT DOORS FOR ALARMS.'], 0.18, 0.27),
    r(['', 'THERMOSTAT', 'AUTOZONE', 'WALL MOUNT ABOVE ELECTRICAL PANELS. 9\'-0" A.F.F. MAX.'], 0.27, 0.35),
    r(['', 'HVAC DISCONNECT WITH UNIT', '', 'REFER TO HVAC SPECIFICATIONS'], 0.35, 0.43),
    r(['', 'POWER POLES', 'AUTOZONE', 'REFER TO PLAN FOR LOCATION'], 0.43, 0.52),
    r(['', 'SIMPLEX RECPT.', 'G.C.', 'REFER TO PLAN FOR LOCATIONS'], 0.52, 0.6),
    r(['', 'DUPLEX RECPT./ FLOOR RECPT.', 'G.C.', 'REFER TO PLAN FOR LOCATIONS'], 0.6, 0.68),
    r(['', 'QUADPLEX RECPT.', 'G.C.', 'REFER TO PLAN FOR LOCATIONS'], 0.68, 0.77),
    r(['', 'WEATHERPROOF DUPLEX RECPT.(GFI)', 'G.C.', 'REFER TO PLAN FOR LOCATIONS'], 0.77, 0.85),
    r(['', 'JUNCTION BOX WITH 6\'-0" FLEX CONDUIT AT WALL & H.P. COUNTERS', 'G.C. (FIXTURE KICK PLATE BY OWNER)', 'J-BOX AT FLOOR LEVEL, FLEX CONDUIT SET UNDER DISPLAY FIXTURES. RECEPTACLE MOUNTED TO BASE PLATE. SEE DETAIL 7/E1'], 0.85, 0.95),
  ] }),
  'LIGHT FIXTURE SCHEDULE': JSON.stringify({ title: 'LIGHT FIXTURE SCHEDULE', columns: ['SYMBOL', 'DESCRIPTION', 'SUPPLIED', 'LAMPS', 'MOUNTING'], rows: [
    r(['A', '8\' LED STRIP 42 WATTS INPUT', 'AUTOZONE', '4 - 8.5 WATT T8 - 4\' LED TUBE', 'SEE PLAN FOR LOCATIONS'], 0.06, 0.09),
    r(['B', '8\' LED STRIP 21 WATTS INPUT', 'AUTOZONE', '2 - 8.5 WATT T8 - 4\' LED TUBE', 'SEE PLAN FOR LOCATIONS'], 0.09, 0.14),
    r(['C', '4\' LED STRIP 10.5 WATTS INPUT WALL LIGHT', 'AUTOZONE', '1 - 8.5 WATT T8 - 4\' LED TUBE', 'SURFACE MOUNTED @ 6\'-8" ABOVE FINISHED FLOOR CENTER ON WALL'], 0.14, 0.18),
    r(['D', 'D-Series Size 1 Luminaire DSXW1 LED 10C 1000 40K T3M MVOLT', 'AUTOZONE', '40 WATT', 'MOUNT TOP OF FIXTURE AT THE SAME ELEVATION AS TOP OF THE STOREFRONT'], 0.18, 0.22),
    r(['E', 'EMERGENCY LIGHT WITH BATTERY BACKUP ELM6LED', 'AUTOZONE', 'INCLUDED WITH FIXTURE', 'MOUNTED TO BOTTOM OF BAR JOIST OR UNISTRUT'], 0.22, 0.26),
    r(['F', 'EXIT SIGN WITH BATTERY BACKUP FOR REMOTE EXIT EMERGENCY HEAD', 'AUTOZONE', 'INCLUDED WITH FIXTURE', 'SEE PLAN FOR LOCATIONS AND MOUNTING INFORMATION'], 0.26, 0.32),
    r(['G', 'GOTHAM 8" LED DOWN LIGHT EVO R 40/30 8AR 120 TRW', 'AUTOZONE', '49 WATT', 'MOUNTED IN SOFFIT SEE PLAN FOR LOCATIONS'], 0.32, 0.35),
    r(['J', 'EXTERIOR EMERGENCY LIGHT WITH TWO HEADS', 'AUTOZONE', 'INCLUDED WITH FIXTURE', 'REMOTE HEAD MOUNTED OUTSIDE ABOVE DOOR WIRE TO EXIT LIGHT FIXTURE'], 0.35, 0.39),
    r(['K', 'EXIT SIGN WITH BATTERY BACKUP', 'AUTOZONE', 'INCLUDED WITH FIXTURE', 'MOUNTED TO BOTTOM OF BAR JOIST OR UNISTRUT'], 0.39, 0.43),
    r(['L', 'D-Series Size 1 Luminaire DSXW1 LED 10C 530 40K T3M MVOLT', 'AUTOZONE', '20 WATT', 'MOUNT TOP OF FIXTURE AT THE SAME ELEVATION AS TOP OF THE STOREFRONT'], 0.43, 0.46),
    r(['M', '4\' LED STRIP 21 WATTS INPUT', 'AUTOZONE', '2 - 8.5 WATT T8 - 4\' LED TUBE', 'SEE PLAN FOR LOCATIONS'], 0.46, 0.5),
    r(['N', '4\' LED STRIP 10.5 WATTS INPUT', 'AUTOZONE', '1 - 8.5 WATT T8 - 4\' LED TUBE', 'SEE PLAN FOR LOCATIONS'], 0.5, 0.53),
    r(['M', 'MOTION SENSOR FOR ALC PANEL', 'AUTOZONE', '', 'J-BOX HORIZONTAL BOTTOM OF JOIST OR UNISTRUT'], 0.53, 0.57),
    r(['M1', 'OCCUPANCY SENSOR-CMR-9', 'AUTOZONE', '', 'RESTROOM CEILING - CONNECT TO FAN & LIGHT'], 0.57, 0.6),
    r(['SITE LIGHT', 'D-Series Size 1 Luminaire DSX1 LED 60C 1000 40K T3M MVOLT', 'AUTOZONE', '209 WATT', 'SEE CIVIL SHEETS FOR POLE AND FIXTURE LOCATIONS'], 0.68, 0.71),
    r(['M2', 'MOTION SENSOR-10 MINUTE ON LSXR-50-HL', 'AUTOZONE', '', 'J-BOX HORIZONTAL MOUNT TO SIDE OF LIGHT FIXTURE INSTALL AISLEWAY LENS #50'], 0.71, 0.75),
  ] }),
  'LUMINAIRE SCHEDULE': JSON.stringify({ title: 'LUMINAIRE SCHEDULE', columns: ['', '', 'DESCRIPTION', 'LAMP', 'LUMENS', 'LLF', 'QTY'], rows: [
    r(['', '', 'LITHONIA - DSX1 LED P8 40K T4M MVOLT HS IES FULL CUTOFF DISTRIBUTION MOUNTED 0° DOWN POSITION MOUNTED HEIGHT = 28\'-0"', 'LED - 207 WATTS', 'ABSOLUTE', '0.95', '4'], 0.4, 1),
  ] }),
};

/** Displayed inches -> PDF points on a Kissimmee E-sheet (/Rotate 270). */
export function sheetPoint(xIn: number, yIn: number): { x: number; y: number } {
  const p = displayedToPdf(xIn * 72, yIn * 72, 0, 0, SHEET_W_PT, SHEET_H_PT, SHEET_ROTATION);
  return { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
}

/** E-2 main plan: the hexagon pole tags, measured on the 150 DPI crop
 *  e2-main.png (origin 380,600 px) — [tag, crop x, crop y]. */
const HEXAGONS: Array<[string, number, number]> = [
  ['1', 255, 470], ['2', 637, 803], ['3', 915, 675], ['3', 1097, 565], ['4', 990, 308], ['5', 300, 587], ['6', 1210, 178],
];
export const HOST_NAMES: Record<string, string> = {
  1: 'HOST TAG 1 OFFICE AREA POWER POLE', 2: 'HOST TAG 2 CHECKOUT COUNTER POWER POLE', 3: 'HOST TAG 3 PARTS POD POWER POLE',
  4: 'HOST TAG 4 TEST STATION POWER POLE', 6: 'HOST TAG 6 COMMERCIAL COUNTER POWER POLE',
};
/** What a counter asked for the host tags reports on E-2 (pole 5 carries
 *  no devices, so it is never a host target). */
export const E2_HOST_MARKS = HEXAGONS.filter(([t]) => HOST_NAMES[t]).map(([t, x, y]) => ({ type: HOST_NAMES[t], ...sheetPoint((380 + x) / 150, (600 + y) / 150) }));

/** E-1 #3 restroom plan: the two GFCIs the main plan also shows (B-26, B-13),
 *  measured on e1-restroom3.png (100 DPI, origin 1180,1590 px). The Opus
 *  baseline counted only the detail-ONLY GFCIs there (its own note); with the
 *  new instruction ("count every instance in every plan viewport, even where
 *  an enlarged plan repeats the main plan") the counter reports these too. */
export const E1_RESTROOM_REPEATS = [[262, 352], [262, 530]].map(([x, y]) => ({ type: 'GFCI', ...sheetPoint((1180 + x) / 100, (1590 + y) / 100) }));

// ── A fake-client responder for the three evidence readers ────────────────
import { systemText, userText, type FakeRequest, type FakeReply } from '../takeoff/fakeAnthropic';

export function isEvidenceRequest(req: FakeRequest): 'viewports' | 'typicals' | 'table' | null {
  const sys = systemText(req);
  if (sys.includes('DRAWING VIEWPORTS')) return 'viewports';
  if (sys.includes('TYPICAL DEVICE PACKAGES')) return 'typicals';
  if (sys.includes('transcribe ONE table')) return 'table';
  return null;
}

/** Answers the evidence readers from the transcriptions above. `pageOf`
 *  maps a sheet label ("E-2 \"Power Plan & Details\"") or a sheet key to the
 *  real set's page number. Unknown sheets get an empty reply. */
export function evidenceResponder(pageOf: (labelOrKey: string) => number | undefined) {
  return (req: FakeRequest): FakeReply => {
    const kind = isEvidenceRequest(req);
    const text = userText(req);
    if (kind === 'viewports') {
      const label = /SHEET: (.*?) — the whole sheet/.exec(text)?.[1] ?? '';
      const page = pageOf(label);
      return { text: (page && VIEWPORT_REPLIES[page]) || '{"viewports":[]}', usage: { input_tokens: 1700, output_tokens: 900 } };
    }
    if (kind === 'typicals') {
      const key = /--- viewport (.*?)@/.exec(text)?.[1] ?? '';
      const page = pageOf(key);
      return { text: (page && TYPICALS_REPLIES[page]) || '{"packages":[]}', usage: { input_tokens: 4200, output_tokens: 700 } };
    }
    if (kind === 'table') {
      const title = (/TABLE: (.*?) on /.exec(text)?.[1] ?? '').replace(/^#\d+\s+/, '');
      const reply = TABLE_REPLIES[title];
      if (!reply) throw new Error(`no transcription for table ${title}`);
      return { text: reply, usage: { input_tokens: 1600, output_tokens: 2400 } };
    }
    throw new Error('not an evidence request');
  };
}

// ── Evidence round Part 4: gap-fill / crop-check responder ─────────────────
//
// HONEST PROVENANCE, Part 4. GFCI: the real Opus baseline's own marks (11 —
// see kissimmeeBaseline) already account for every GFCI/WP-GFI symbol
// visible on the two crops this fixture carries (e1-main-east.png,
// e1-restroom3.png) — checked by hand against those PNGs. The other 5 (to
// reach the audited 16) are on the WEST portion of the real E-1 sheet, which
// this fixture does not carry a crop of (the report's own committed set is
// "the E-1 main plan (EAST part)"). This reply is therefore a SYNTHETIC
// stand-in for what a real gap-fill call would find there — never claimed as
// a transcription of a real image, unlike every other reply in this file.
// LUMINAIRE SCHEDULE's QTY 4 vs S1+S2's counted 3 (reconcile.ts 4.2(a)) is a
// REAL, current-data finding too; its gap-fill reply is honestly "nothing
// more found" — the audited answer really is 3, and gap-fill must not
// fabricate a 4th pole just because a schedule cell disagrees.
export function isGapFillRequest(req: FakeRequest): 'gapfill' | 'cropcheck' | null {
  const sys = systemText(req);
  if (sys.includes('MISSED instances of ONE symbol type')) return 'gapfill';
  if (sys.includes('verify SUGGESTED symbol marks')) return 'cropcheck';
  return null;
}

const GFCI_GAPFILL_MARKS = [
  { x: 0.62, y: 0.18, confidence: 'medium', note: 'small circle-slash by a sink note, west portion of the sheet' },
  { x: 0.30, y: 0.44, confidence: 'medium', note: 'GFCI symbol by the break-room counter, west portion' },
  { x: 0.71, y: 0.52, confidence: 'high', note: 'GFCI at the mop sink, west portion' },
  { x: 0.15, y: 0.66, confidence: 'medium', note: 'GFCI near the employee entrance, west portion' },
  { x: 0.44, y: 0.80, confidence: 'low', note: 'possible GFCI, partly obscured by a dimension line, west portion' },
];

/** Answers gap-fill (4.4) and crop-check (4.3) calls. Only the GFCI job
 *  finds anything (see the note above); every other job — WP GFI, and the
 *  S1+S2 site-light schedule-qty finding — gets an honest "nothing more
 *  found", so the audited numbers (WP GFI 4, site poles 3) are never
 *  disturbed by a reconciliation flag alone. */
export function gapFillResponder() {
  return (req: FakeRequest): FakeReply => {
    const kind = isGapFillRequest(req);
    const text = userText(req);
    if (kind === 'gapfill') {
      if (/^SYMBOL: GFCI\b/m.test(text)) return { text: JSON.stringify({ marks: GFCI_GAPFILL_MARKS }), usage: { input_tokens: 2600, output_tokens: 300 } };
      return { text: '{"marks":[]}', usage: { input_tokens: 2600, output_tokens: 20 } };
    }
    if (kind === 'cropcheck') {
      const ids = [...text.matchAll(/Candidate (c\d+):/g)].map(m => m[1]);
      const accept = /^CANDIDATE SYMBOL: GFCI\b/m.test(text);
      return {
        text: JSON.stringify({ decisions: ids.map(id => ({ id, decision: accept ? 'accept' : 'reject', note: accept ? 'matches the confirmed GFCI example' : 'no clear symbol here' })) }),
        usage: { input_tokens: 1800, output_tokens: 250 },
      };
    }
    throw new Error('not a gap-fill request');
  };
}
