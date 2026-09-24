// Real-run fix 4 — "Panel schedules not read completely" on the live
// Kissimmee run (2026-09-24).
//
// WHY (from the live data): both real panel schedules WERE read completely
// — E-4's PANEL A and PANEL B, 42 rows each, circuits 1-41 odd and 2-42
// even, no gap. The blocking item came from two E-5 viewports the viewport
// reader classed as schedules because their titles say PANELBOARD: "PANELBOARD
// - DIAGRAM" and "3 PANELBOARD - MOUNTING HEIGHT SECTION". They are drawings,
// the table reader correctly found no rows, and panelsUnread counted them.
//
// And the reader itself: a vision read that comes back with one side only
// (odd circuits, say) is now read again side by side — one call for the odd
// circuits, one for the even — and merged by circuit number. Tested here on
// the REAL crops of page 52 (the raster E-4 page carries the four real
// Panel A / Panel B crops at their real positions): the reader renders its
// crop from that page, and the replies are the live run's own transcription
// of those panels (the first, partial reply is that transcription cut to its
// odd side — the failure mode this guards against, simulated).
import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import { runEvidenceStage } from './evidenceStage';
import { isCompletePanel, mergePanelReads, panelContinuity, circuitSummaryRows, type ScheduleTable } from './schedules';
import { isPanelScheduleTitle } from '../countingStage';
import { buildRasterSet, BLANK_PAGE, KISSIMMEE_E4 } from '../../test/fixtures/evidence/buildRasterSheet';
import { VIEWPORT_REPLIES } from '../../test/fixtures/evidence/kissimmeeReplies';
import { fakeAnthropic, systemText, userText, type FakeRequest } from '../../test/fixtures/takeoff/fakeAnthropic';
import { loadKissimmeeLive } from '../../test/fixtures/realrun/kissimmeeLive';
import { isPdftoppmAvailable } from '../documentPrep';

const live = loadKissimmeeLive();
const liveTable = (title: string) => live.countResult.evidence.tables.find(t => t.title === title)!;
const cktOf = (cells: string[]) => Number(cells[0]);
const reply = (t: ScheduleTable, rows: string[][]) => JSON.stringify({ title: t.title, columns: t.columns, rows: rows.map(cells => ({ cells })) });

describe('real-run fix 4 — why the live run said "not read completely"', () => {
  it('both real panel schedules were complete; the unread "panels" were two E-5 drawings', () => {
    const a = liveTable('PANEL A'), b = liveTable('PANEL B');
    expect([a.rows.length, b.rows.length, isCompletePanel(a), isCompletePanel(b)]).toEqual([42, 42, true, true]);
    expect(live.countResult.evidence.panelsUnread).toEqual([
      'PANELBOARD - DIAGRAM (E-5 "Lighting Control Panel Details")',
      'PANELBOARD - MOUNTING HEIGHT SECTION (E-5 "Lighting Control Panel Details")',
    ]);
    expect(live.countResult.evidence.tables.filter(t => /PANELBOARD/.test(t.title)).map(t => t.rows.length)).toEqual([0, 0]);
  });

  it('a panel\'s diagram / section / mounting drawing is not its schedule', () => {
    for (const t of ['PANELBOARD - DIAGRAM', '3 PANELBOARD - MOUNTING HEIGHT SECTION', 'PANEL A ELEVATION', 'PANELBOARD RISER DIAGRAM', 'PANEL ONE-LINE']) expect(isPanelScheduleTitle(t), t).toBe(false);
    for (const t of ['PANEL A', 'PANEL B', 'PANELBOARD LP-1', 'PANEL SCHEDULE A', 'A PANEL']) expect(isPanelScheduleTitle(t), t).toBe(true);
    expect(isPanelScheduleTitle('LOAD TOTALS')).toBe(false);
  });

  it('merging the side reads: complete only when every circuit is there', () => {
    const a = liveTable('PANEL A');
    const odd = { ...a, rows: a.rows.filter(r => cktOf(r.cells) % 2 === 1) };
    const even = { ...a, rows: a.rows.filter(r => cktOf(r.cells) % 2 === 0) };
    expect(panelContinuity(odd).join(' ')).toMatch(/only the odd side was read/);
    const m = mergePanelReads({ ...odd, warnings: panelContinuity(odd) }, [odd, even]);
    expect([m.rows.length, isCompletePanel(m), m.sidesRead]).toEqual([42, true, true]);
    // A side read that skips circuits leaves the panel incomplete — never papered over.
    const evenGap = { ...even, rows: even.rows.filter(r => cktOf(r.cells) !== 18) };
    const m2 = mergePanelReads({ ...odd, warnings: panelContinuity(odd) }, [odd, evenGap]);
    expect(isCompletePanel(m2)).toBe(false);
    expect(m2.warnings.join(' ')).toMatch(/circuit\(s\) 18 missing/);
  });
});

describe('real-run fix 4 — a one-sided vision read of the real E-4 crops is completed side by side', () => {
  let have = false;
  let pdf: Buffer;
  beforeAll(async () => {
    have = await isPdftoppmAvailable();
    if (!have) return;
    pdf = await buildRasterSet(Array.from({ length: 52 }, (_, i) => (i + 1 === 52 ? KISSIMMEE_E4 : BLANK_PAGE)));
  }, 60_000);

  it('Panel A: the first read has only the odd side; the odd / even reads complete it (42 rows, 21 circuits each side)', async (ctx) => {
    if (!have) return ctx.skip();
    const a = liveTable('PANEL A'), b = liveTable('PANEL B'), lt = liveTable('LOAD TOTALS');
    const images: Array<{ label: string; w: number; h: number; ink: number }> = [];
    const { client, calls } = fakeAnthropic(async (req: FakeRequest) => {
      const sys = systemText(req), text = userText(req);
      if (sys.includes('DRAWING VIEWPORTS')) return { text: VIEWPORT_REPLIES[52] };
      if (sys.includes('TYPICAL DEVICE PACKAGES')) return { text: '{"packages":[]}' };
      if (!sys.includes('transcribe ONE table')) throw new Error('unexpected call');
      const img = (req.messages[0].content as Array<{ type: string; source?: { data: string } }>).find(x => x.type === 'image')!;
      const { data, info } = await sharp(Buffer.from(img.source!.data, 'base64')).grayscale().raw().toBuffer({ resolveWithObject: true });
      const ink = data.reduce((n, v) => n + (v < 128 ? 1 : 0), 0) / data.length;
      const title = /TABLE: (.*?) on /.exec(text)?.[1] ?? '';
      images.push({ label: `${title}${/ODD/.test(text) ? ' odd' : /EVEN/.test(text) ? ' even' : ''}`, w: info.width, h: info.height, ink });
      if (title === 'PANEL A') {
        if (/Read ONLY the ODD/.test(text)) return { text: reply(a, a.rows.filter(r => cktOf(r.cells) % 2 === 1).map(r => r.cells)) };
        if (/Read ONLY the EVEN/.test(text)) return { text: reply(a, a.rows.filter(r => cktOf(r.cells) % 2 === 0).map(r => r.cells)) };
        return { text: reply(a, a.rows.filter(r => cktOf(r.cells) % 2 === 1).map(r => r.cells)) }; // the partial read
      }
      if (title === 'PANEL B') return { text: reply(b, b.rows.map(r => r.cells)) };
      if (title === 'LOAD TOTALS') return { text: reply(lt, lt.rows.map(r => r.cells)) };
      return { text: '{"title":"","columns":[],"rows":[]}' };
    });
    const ev = await runEvidenceStage({
      client, model: 'claude-opus-5-5', maxTokens: 16000, targets: [], pdfs: new Map([['set.pdf', pdf]]),
      pages: [{ key: 'set.pdf#52', file: 'set.pdf', page: 52, label: 'E-4 "Lighting Control Panel Details"', counted: false }],
    });
    const pa = ev.tables.find(t => t.title === 'PANEL A')!;
    expect([pa.rows.length, isCompletePanel(pa), pa.sidesRead]).toEqual([42, true, true]);
    // Panel B read complete the first time: never re-read.
    expect(images.filter(i => i.label.startsWith('PANEL B')).map(i => i.label)).toEqual(['PANEL B']);
    expect(images.filter(i => i.label.startsWith('PANEL A')).map(i => i.label)).toEqual(['PANEL A', 'PANEL A odd', 'PANEL A even']);
    // Every Panel A read got the real crop of Panel A (ink on it, the
    // viewport's shape), at the reader's full crop resolution.
    for (const i of images.filter(x => x.label.startsWith('PANEL A'))) {
      expect(i.ink).toBeGreaterThan(0.01);
      expect(Math.abs(i.w / i.h - 419 / 427)).toBeLessThan(0.05);
    }
    expect(calls.length).toBe(1 + 3 + 2); // viewports, 3 tables, 2 side reads (no legend / notes: no typicals call)
    // The complete panel now feeds the branch-circuit rows (both panels).
    expect([...new Set(circuitSummaryRows(ev.tables).map(r => r.panel))].sort()).toEqual(['A', 'B']);
  });
});
