// Level 2 learning, Tasks 11 + 13 — the counter's learning prefix: the
// selected example crops (resized to the run's tile px/in and JPEG-encoded
// the same way as the tiles) and the approved counter lessons, inserted
// BEFORE "SHEET:". COUNTER_SYSTEM is unchanged; with nothing selected the
// request is byte-identical to a run without learning. Nothing here can
// change a count: it only adds prompt text and images, and the record of
// what was used (countResult.learning) is read by no count path.
import sharp from 'sharp';
import type Anthropic from '@anthropic-ai/sdk';
import type { CountSheet } from '../countSheets';
import type { CountTarget } from '../countTargets';
import { selectExamples, selectLessons, EXAMPLES_HEADER, LESSONS_HEADER, lessonLine, imageTokens, type BankExample, type BankLesson, type SelectContext } from './selectExamples';

export interface LearningRecord {
  releaseId: number | null;
  examplesUsed: Array<{ id: string; targetKey: string; polarity: 'positive' | 'negative'; sourceBidName: string | null; meaning: string; sheets: string[] }>;
  lessonsUsed: Array<{ lessonId: string; version: number; text: string; sheets: string[] }>;
  tokensEst: number;
  skipped: Array<{ id: string; reason: string }>;
}

export interface CounterLearning {
  prefix(sheet: Pick<CountSheet, 'key' | 'label'>, targets: CountTarget[], pxPerIn: number): Promise<Anthropic.ContentBlockParam[]>;
  record(): LearningRecord;
}

export interface LearningBank { releaseId: number | null; examples: Array<BankExample & { crop: Buffer }>; lessons: BankLesson[] }

/** The quality ladder the tiles use (countRender.encodeTile). */
async function encodeLikeTile(png: Buffer, pxPerIn: number): Promise<Buffer> {
  const side = Math.max(16, Math.round(1.2 * pxPerIn));
  for (const quality of [85, 72, 60, 48]) {
    const out = await sharp(png).grayscale().resize({ width: side, height: side, fit: 'fill' }).jpeg({ quality }).toBuffer();
    if (out.length <= 4_500_000) return out;
  }
  throw new Error('example crop could not be encoded');
}

/** undefined when there is nothing to use (the run is then exactly as without learning). */
export function makeCounterLearning(bank: LearningBank | null, ctx: SelectContext & { projectType: string | null; accountRuleId: string | null }): CounterLearning | undefined {
  if (!bank || (!bank.examples.length && !bank.lessons.some(l => l.appliesTo.includes('counter')))) return undefined;
  if (ctx.off.all) return undefined;
  const cropById = new Map(bank.examples.map(e => [e.id, e.crop]));
  const memo = new Map<string, Promise<Anthropic.ContentBlockParam[]>>();
  const used = new Map<string, LearningRecord['examplesUsed'][number]>();
  const lessonsUsed = new Map<string, LearningRecord['lessonsUsed'][number]>();
  const skipped = new Map<string, string>();
  let tokensEst = 0;
  const build = async (sheet: Pick<CountSheet, 'key' | 'label'>, targets: CountTarget[], pxPerIn: number): Promise<Anthropic.ContentBlockParam[]> => {
    const sel = selectExamples(targets, bank.examples, ctx, pxPerIn);
    for (const s of sel.skipped) skipped.set(s.id, s.reason);
    const lessons = selectLessons(targets, bank.lessons, ctx, 'counter');
    const blocks: Anthropic.ContentBlockParam[] = [];
    if (sel.picked.length) {
      blocks.push({ type: 'text', text: EXAMPLES_HEADER });
      for (const p of sel.picked) {
        blocks.push({ type: 'text', text: p.line });
        blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: (await encodeLikeTile(cropById.get(p.example.id)!, pxPerIn)).toString('base64') } });
        const u = used.get(`${p.example.id}|${p.target.key}`) ?? { id: p.example.id, targetKey: p.target.key, polarity: p.role, sourceBidName: p.example.sourceBidName, meaning: p.example.meaning.description, sheets: [] };
        if (!u.sheets.includes(sheet.label)) u.sheets.push(sheet.label);
        used.set(`${p.example.id}|${p.target.key}`, u);
      }
      tokensEst += sel.picked.length * imageTokens(pxPerIn) + Math.ceil(sel.textChars / 4);
    }
    if (lessons.length) {
      blocks.push({ type: 'text', text: `${LESSONS_HEADER}\n${lessons.map((l, i) => lessonLine(l, i + 1)).join('\n')}` });
      for (const l of lessons) {
        const u = lessonsUsed.get(l.id) ?? { lessonId: l.id, version: l.version, text: l.text, sheets: [] };
        if (!u.sheets.includes(sheet.label)) u.sheets.push(sheet.label);
        lessonsUsed.set(l.id, u);
      }
      tokensEst += lessons.reduce((n, l) => n + Math.ceil(l.text.length / 4) + 8, 0);
    }
    // The last learning block carries the cache breakpoint: sheets with the
    // same targets reuse the prefix.
    if (blocks.length) (blocks[blocks.length - 1] as { cache_control?: { type: 'ephemeral' } }).cache_control = { type: 'ephemeral' };
    return blocks;
  };
  return {
    prefix(sheet, targets, pxPerIn) {
      const k = `${sheet.key}|${targets.map(t => t.key).join(',')}|${Math.round(pxPerIn)}`;
      if (!memo.has(k)) memo.set(k, build(sheet, targets, pxPerIn));
      return memo.get(k)!;
    },
    record() {
      return { releaseId: bank.releaseId, examplesUsed: [...used.values()], lessonsUsed: [...lessonsUsed.values()], tokensEst, skipped: [...skipped.entries()].map(([id, reason]) => ({ id, reason })) };
    },
  };
}
