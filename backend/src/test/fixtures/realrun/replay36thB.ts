// Price accuracy round D1-D4 — the LATEST live 36th Street run (2026-09-29b,
// remodel mode on) replayed through the current code. No model is called.
//
// What is REAL (the live run's stored output, fixture
// 36th-street-live-2026-09-29b.json): Agent 1's analysis, the page
// inventory, the evidence readers' viewports and tables, the titles the
// titles reader returned, E1.0's printed rule ("SHADED SYMBOL DENOTES NEW
// RECEPTICLE", as the counter quoted it), and EVERY mark the live counter
// placed on E1.0, E2.0, A2.0 and A3.0 with its live status:
//   * E1.0: 1 duplex new, 13 duplex + 7 GFI + 3 "42" + 2 WP existing, and
//     the 9 types the live run reported "unknown" (disconnects, $, panels,
//     AHU #1, COMP #1/#2, DISC-A/B, the phone triangle) — unknown;
//   * E2.0: every mark new (no rule on that sheet);
//   * A2.0 / A3.0: every mark (the live counter gave no status there);
//   * the unlisted tag H (13 marks on E2.0).
// What is MOCKED (only a live re-run can prove the model answers it):
//   * the close-up status check (D2) — `crops` below decides each answer;
//   * a demolition-sheet "marked for removal" flag (D3 rule a) — only when a
//     test passes `markedOnA2`; the live counter was never asked.
import fs from 'fs';
import path from 'path';
import { fakeAnthropic, systemText, userText, type FakeReply, type FakeRequest } from '../takeoff/fakeAnthropic';
import { gapFillResponder, isGapFillRequest } from '../evidence/kissimmeeReplies';
import { runCountingStage, type CountingStageOutput } from '../../../ai/countingStage';
import { buildReviewItems, type ReviewItem } from '../../../ai/reviewItems';
import { DEFAULT_EVIDENCE_MODEL } from '../../../routes/preconstruction';
import { agent1Input, cache36th, isCounter, isTitles, keyMap36th, pdfs36th, REPLAY_MODEL, toTiles, unlistedIn, type Live36th, type Mark } from './replay36th';

export interface Live36thB extends Live36th {
  countResult: Live36th['countResult'] & {
    remodel: {
      marks: Array<{ sheetKey: string; typeKey: string; x: number; y: number; status: string }>;
      unknownStatus: Array<{ typeKey: string; sheets: Array<{ label: string; count: number }> }>;
      conventions: Array<{ status: string; rule: string; quote: string; sheetKey: string }>;
      titleReads: { pages: Array<{ key: string; label: string; titles: string[]; source: string }> };
    };
    unlisted?: { tags: Array<{ tag: string; symbol?: string; marks: Array<{ x: number; y: number; sheetKey: string }> }> };
  };
}

let cache: Live36thB | null = null;
export function load36thB(): Live36thB {
  if (!cache) cache = JSON.parse(fs.readFileSync(path.join(__dirname, '36th-street-live-2026-09-29b.json'), 'utf8')) as Live36thB;
  return JSON.parse(JSON.stringify(cache)) as Live36thB;
}

const PAGE_OF: Record<string, number> = { 'E1.0': 15, 'E2.0': 16, 'A2.0': 4, 'A3.0': 5 };
const pageOf = (sheetKey: string) => Number(sheetKey.split('#').pop());

export interface LiveMark { page: number; liveKey: string; x: number; y: number; circuit?: string; status: string }

/** Every live mark with its live status. */
export function liveMarks36thB(run: Live36thB): LiveMark[] {
  const unknownOnE1 = new Set(run.countResult.remodel.unknownStatus.filter(u => u.sheets.some(s => s.label.startsWith('E1.0'))).map(u => u.typeKey));
  const install = run.countResult.marks.map(m => {
    const page = pageOf(m.sheetKey);
    return { page, liveKey: m.typeKey, x: m.x, y: m.y, circuit: m.circuit, status: page === 15 && unknownOnE1.has(m.typeKey) ? 'unknown' : 'new' };
  });
  const other = run.countResult.remodel.marks.map(m => ({ page: pageOf(m.sheetKey), liveKey: m.typeKey, x: m.x, y: m.y, status: m.status === 'demo' ? '' : m.status }));
  return [...install, ...other];
}

/** The close-up check's mocked answer for one mark. */
export type CropAnswer = { answer: string; confidence: 'high' | 'low' };
export type CropPolicy = (m: { typeKey: string; x: number; y: number; liveStatus: string; index: number }) => CropAnswer;

/** Chris's takeoff: 5 new duplex + 2 GFCI (the WP GFCIs at the condensers).
 *  The live run's 1 new duplex and the first 4 live existing duplex answer
 *  "filled"; the 2 WP answer "filled"; every other receptacle "open".
 *  Which duplex marks are really shaded is not known from the export. */
export const chrisCrops: CropPolicy = m => {
  if (m.typeKey === 'DUPLEX RECEPTACLE') return { answer: m.index < 5 ? 'filled' : 'open', confidence: 'high' };
  if (m.typeKey === 'WP') return { answer: 'filled', confidence: 'high' };
  return { answer: 'open', confidence: 'high' };
};

export const isStatusCrop = (req: FakeRequest) => systemText(req).includes('STATUS CLOSE-UP CHECK');

export function cropResponder(run: Live36thB, policy: CropPolicy) {
  const live = liveMarks36thB(run);
  const seen: Array<{ typeKey: string; x: number; y: number }> = [];
  const indexOf = (typeKey: string, x: number, y: number) => {
    // Order within a type = the live order on E1.0 (new first, then existing).
    const same = live.filter(m => m.page === 15 && m.liveKey === typeKey).sort((a, b) => (a.status === 'new' ? 0 : 1) - (b.status === 'new' ? 0 : 1));
    let best = 0, bd = Infinity;
    same.forEach((m, i) => { const d = Math.hypot(m.x - x, m.y - y); if (d < bd) { bd = d; best = i; } });
    return { index: best, liveStatus: same[best]?.status ?? '' };
  };
  return (req: FakeRequest): FakeReply => {
    const text = userText(req);
    const answers: unknown[] = [];
    for (const m of text.matchAll(/CROP (c\d+) — type (.+?) — at PDF ([\d.]+),([\d.]+)/g)) {
      const [id, typeKey, x, y] = [m[1], m[2], Number(m[3]), Number(m[4])];
      seen.push({ typeKey, x, y });
      const { index, liveStatus } = indexOf(typeKey, x, y);
      const a = policy({ typeKey, x, y, liveStatus, index });
      answers.push({ id, answer: a.answer, confidence: a.confidence });
    }
    return { text: JSON.stringify({ answers }) };
  };
}

export function counter36thB(run: Live36thB, key: (liveKey: string) => string | null, opts: { markedOnA2?: number } = {}) {
  const live = liveMarks36thB(run);
  const conv = run.countResult.remodel.conventions;
  const unlisted = run.countResult.unlisted?.tags ?? [];
  return (req: FakeRequest): FakeReply => {
    const text = userText(req);
    const sheet = /SHEET: (\S+)/.exec(text)?.[1] ?? '';
    const page = PAGE_OF[sheet] ?? 0;
    let a2 = 0;
    const marks: Mark[] = live.filter(m => m.page === page).flatMap(m => {
      const kk = key(m.liveKey);
      if (!kk) return [];
      let status = m.status || undefined;
      // D3 rule (a): the first N receptacles on A2.0 are marked for removal.
      if (page === 4 && opts.markedOnA2 && /RECEPTACLE|GFI|^42$|^WP$/.test(kk) && a2++ < opts.markedOnA2) status = 'demo';
      return [{ key: kk, x: m.x, y: m.y, circuit: m.circuit, status }];
    });
    const { marks: outMarks, rects } = toTiles(req, text, marks);
    const ul = !text.includes('CONSISTENCY PASS') && page !== 4 && page !== 5
      ? unlisted.flatMap(t => unlistedIn(rects, t.tag, t.symbol ?? 'tagged symbol', t.marks.filter(m => pageOf(m.sheetKey) === page)))
      : [];
    const conventions = text.includes('STATUS (remodel job)') ? conv.filter(c => pageOf(c.sheetKey) === page).map(c => ({ status: c.status, rule: c.rule, quote: c.quote })) : [];
    return { text: JSON.stringify({ marks: outMarks, unreadable: [], unlisted: ul, notes: [], ...(conventions.length ? { conventions } : {}) }) };
  };
}

export function titles36thB(run: Live36thB) {
  return (req: FakeRequest): FakeReply => {
    const label = /SHEET: (\S+)/.exec(userText(req))?.[1] ?? '';
    const p = run.countResult.remodel.titleReads.pages.find(x => x.label.startsWith(`${label} `) && x.source === 'vision');
    return { text: JSON.stringify({ titles: p?.titles ?? [], conventions: [] }) };
  };
}

export async function replay36thB(opts: { remodel?: { buildType?: string | null; answer?: string | null } | null; crops?: CropPolicy; markedOnA2?: number; mutate?: (run: Live36thB) => void; /** Accuracy round Task 0 — replay another export of the same shape (the 2026-09-30 run). */ run?: Live36thB } = {}): Promise<{ stage: CountingStageOutput; review: ReviewItem[]; calls: FakeRequest[]; misses: string[]; run: Live36thB }> {
  const run = opts.run ?? load36thB();
  opts.mutate?.(run);
  const key = keyMap36th(run);
  const counter = counter36thB(run, key, { markedOnA2: opts.markedOnA2 });
  const titles = titles36thB(run);
  const crops = cropResponder(run, opts.crops ?? chrisCrops);
  const gf = gapFillResponder();
  const { client, calls } = fakeAnthropic(req => (isCounter(req) ? counter(req)
    : isTitles(req) ? titles(req)
    : isStatusCrop(req) ? crops(req)
    : isGapFillRequest(req) ? gf(req)
    : (() => { throw new Error(`unexpected model call: ${JSON.stringify(req.system).slice(0, 120)}`); })()));
  const cacheObj = cache36th(run);
  const stage = await runCountingStage({
    client, model: REPLAY_MODEL, maxTokens: 32000,
    agent1: agent1Input(run), inventory: run.inventory, pdfs: await pdfs36th(),
    evidence: { model: DEFAULT_EVIDENCE_MODEL, maxTokens: 16000, cache: cacheObj },
    ...(opts.remodel === null ? {} : { remodel: opts.remodel ?? { buildType: null, answer: null } }),
  });
  return { stage, review: buildReviewItems(stage.countResult), calls, misses: cacheObj.misses, run };
}
