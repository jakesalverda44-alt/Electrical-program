import { ChecklistData, LOADS } from './SiteVisitChecklist';

export interface ChecklistHeader {
  customer: string; genLabel: string; proposalNo: string; address: string; date: string;
}

const BLUE: [number, number, number] = [22, 74, 134];
const INK: [number, number, number] = [28, 36, 48];
const MUTED: [number, number, number] = [107, 118, 131];
const RULE: [number, number, number] = [190, 200, 212];

const PAGE_W = 612, PAGE_H = 792, MARGIN = 42;
const BOTTOM = PAGE_H - 48;

/** Draws the paper-style Site Visit Checklist. mode 'blank' = header identity
 *  filled, body left as write-in lines for the truck; 'filled' = all entered
 *  values typed in. Pure vector/text — small file, selectable, nothing clipped. */
export async function buildChecklistPdf(header: ChecklistHeader, data: ChecklistData, mode: 'blank' | 'filled') {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const filled = mode === 'filled';
  let y = 52;

  const ensureRoom = (need: number) => {
    if (y + need > BOTTOM) { doc.addPage(); y = 52; }
  };

  const sectionTitle = (t: string) => {
    ensureRoom(26);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...BLUE);
    doc.text(t, MARGIN, y);
    y += 14;
  };

  // Label + value on a write-in rule. Returns nothing; advances no shared state
  // (caller advances y per row).
  const field = (label: string, value: string, x: number, w: number, baseline: number) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK);
    doc.text(`${label}:`, x, baseline);
    const lx = x + doc.getTextWidth(`${label}:`) + 4;
    doc.setDrawColor(...RULE); doc.setLineWidth(0.75);
    doc.line(lx, baseline + 2, x + w, baseline + 2);
    if (filled || value) {
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...INK);
      const fit: string[] = doc.splitTextToSize(value, x + w - lx);
      doc.text(fit[0] || '', lx + 2, baseline);          // first line on the rule…
      for (let i = 1; i < fit.length; i++) {              // …overflow wraps below
        doc.text(fit[i], x + 8, baseline + 11 * i);
      }
      return 11 * Math.max(0, fit.length - 1);
    }
    return 0;
  };

  // A Yes/No- or Electric/Gas-style choice: filled mode prints the chosen word,
  // blank mode prints all options separated by " / " for circling by hand.
  const choice = (label: string, options: string[], value: string, x: number, baseline: number) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK);
    doc.text(`${label}:`, x, baseline);
    const lx = x + doc.getTextWidth(`${label}:`) + 5;
    doc.setFontSize(9.5);
    if (filled && value) {
      doc.text(value, lx, baseline);
      const w = doc.getTextWidth(value);
      doc.setDrawColor(...BLUE); doc.setLineWidth(1);
      doc.ellipse(lx + w / 2, baseline - 3, w / 2 + 7, 8);   // hand-circled look
    } else {
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED);
      doc.text(options.join('  /  '), lx, baseline);
    }
    doc.setTextColor(...INK);
  };

  // ── Header ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...BLUE);
  doc.text('ACCURATE POWER & TECHNOLOGY, INC.', PAGE_W / 2, y, { align: 'center' });
  y += 15;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
  doc.text('15519 U.S. Hwy 441, Suite A101, Eustis, FL 32726 · 352-735-8285', PAGE_W / 2, y, { align: 'center' });
  y += 14;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.setTextColor(...INK);
  doc.text('Site Visit Checklist', PAGE_W / 2, y, { align: 'center' });
  y += 22;

  field('Name', header.customer, MARGIN, 280, y);
  field('Gen Size / Brand', header.genLabel, MARGIN + 296, 234, y);
  y += 20;
  field('Date', header.date, MARGIN, 160, y);
  field('Proposal No.', header.proposalNo, MARGIN + 176, 190, y);
  field('Sq/Ft', filled ? data.sqft : data.sqft || '', MARGIN + 382, 148, y);
  y += 20;
  y += field('Address', header.address, MARGIN, PAGE_W - 2 * MARGIN, y);
  y += 24;

  // ── Service & System ──
  sectionTitle('Service & System');
  choice('Disconnect', ['Yes', 'No'], data.disc, MARGIN, y);
  choice('Em Panel', ['Yes', 'No'], data.em, MARGIN + 190, y);
  y += 20;
  field('Power Company', data.powerCo, MARGIN, 190, y);
  field('Service AMPS', data.serviceAmps, MARGIN + 206, 150, y);
  field('ATS Qty / AMPS', data.atsQtyAmps, MARGIN + 372, 158, y);
  y += 22;

  // AC units: existing entries in filled mode; three write-in unit lines in blank mode.
  const acRows = filled
    ? (data.acUnits.length ? data.acUnits : [{ size: '', type: '' as const, lra: '' }])
    : [0, 1, 2].map(() => ({ size: '', type: '' as const, lra: '' }));
  acRows.forEach((u, i) => {
    ensureRoom(20);
    field(`AC Unit ${i + 1} Size`, u.size, MARGIN, 170, y);
    field('Type', filled ? u.type : '', MARGIN + 186, 170, y);
    field('LRA', u.lra, MARGIN + 372, 158, y);
    y += 20;
  });
  ensureRoom(22);
  choice('Air Handler (Heat Strips)', ['Electric', 'Gas'], data.airHandler, MARGIN, y);
  choice('Gas Type', ['LP', 'NG'], data.gasType, MARGIN + 280, y);
  y += 26;

  // ── Loads table ──
  sectionTitle('Loads / Appliances');
  const COLS = [
    { h: 'Appliance', x: MARGIN, w: 150 },
    { h: 'Fuel', x: MARGIN + 154, w: 100 },
    { h: 'Volts', x: MARGIN + 258, w: 100 },
    { h: 'HP', x: MARGIN + 362, w: 70 },
    { h: 'AMPS', x: MARGIN + 436, w: 92 },
  ];
  const tableHead = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
    COLS.forEach(c => doc.text(c.h.toUpperCase(), c.x, y));
    y += 4;
    doc.setDrawColor(...RULE); doc.setLineWidth(1);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 13;
  };
  tableHead();
  const loadRow = (name: string, lv: { fuel?: string; volt?: string; hp?: string; amps?: string }) => {
    if (y + 16 > BOTTOM) { doc.addPage(); y = 52; tableHead(); }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(name, COLS[0].w)[0] || '', COLS[0].x, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED); doc.setFontSize(8.5);
    if (filled) {
      doc.setTextColor(...INK); doc.setFontSize(9);
      if (lv.fuel) doc.text(lv.fuel, COLS[1].x, y);
      if (lv.volt) doc.text(lv.volt, COLS[2].x, y);
      if (lv.hp) doc.text(lv.hp, COLS[3].x, y);
      if (lv.amps) doc.text(lv.amps, COLS[4].x, y);
    } else {
      doc.text('Electric / Gas', COLS[1].x, y);
      doc.text('120V / 240V', COLS[2].x, y);
    }
    y += 3;
    doc.setDrawColor(...RULE); doc.setLineWidth(0.5);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 13;
  };
  LOADS.forEach((row, i) => loadRow(row.n, data.loads[i] || {}));
  if (filled) {
    data.customLoads.filter(c => c.name.trim()).forEach(c => loadRow(c.name, c));
  } else {
    loadRow('', {}); loadRow('', {});
  }
  y += 10;

  // ── Footer fields ──
  ensureRoom(70);
  field('Gen Feed Length / Type', data.feedLen, MARGIN, 250, y);
  field('Gas Run Length', data.gasRunLength, MARGIN + 266, 262, y);
  y += 22;

  const bigField = (label: string, value: string, blankLines: number) => {
    ensureRoom(16 + blankLines * 16);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK);
    doc.text(`${label}:`, MARGIN, y);
    y += 14;
    if (filled && value.trim()) {
      doc.setFont('helvetica', 'normal');
      const wrapped: string[] = doc.splitTextToSize(value, PAGE_W - 2 * MARGIN - 8);
      wrapped.forEach((ln: string) => { ensureRoom(13); doc.text(ln, MARGIN + 4, y); y += 13; });
      y += 4;
    } else {
      doc.setDrawColor(...RULE); doc.setLineWidth(0.75);
      for (let i = 0; i < blankLines; i++) { ensureRoom(16); doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 16; }
    }
  };
  bigField('Gen Location Description', data.locDesc, 2);
  bigField('Notes', data.notes, 3);

  ensureRoom(24);
  y += 6;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text('Rough Sketches On Back', PAGE_W / 2, y, { align: 'center' });

  return doc;
}
