// Level 2 learning, Task 11 — "never a count change": the learning code is
// imported only by the counter's prompt path, the pipeline, the capture
// hooks, the routes and the gate; no merge / review-answer / pricing code
// imports it or reads `learning` from a count result.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '../..');
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === 'node_modules' || d.name === 'fixtures' ? [] : walk(p);
    return /\.ts$/.test(d.name) && !/\.test\.ts$/.test(d.name) ? [p] : [];
  });
}
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join('/');

describe('learning/ has no direct count path', () => {
  const files = walk(SRC);
  it('only these files import ai/learning', () => {
    const importers = files.filter(f => !rel(f).startsWith('ai/learning/') && /from '[^']*learning\/[a-zA-Z]+'/.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();
    const allowed = new Set([
      'ai/counter.ts', 'ai/countingStage.ts', 'ai/reviewItems.ts', // the prompt prefix; the review lesson hints (never an answer)
      'estimating/takeoffReview.ts', 'routes/estimating.ts', // capture hooks (enqueue only)
      'eval/learningGate.ts', 'services/learningCheck.ts', 'index.ts', 'routes/learning.ts', 'routes/preconstruction.ts', // the gate + Jake's check
    ]);
    expect(importers.filter(f => !allowed.has(f))).toEqual([]);
    expect(importers).toContain('ai/counter.ts');
  });
  it('merge, review answers, enforced counts and pricing never read learning', () => {
    for (const f of ['ai/countMerge.ts', 'estimating/reviewAnswers.ts', 'estimating/pricing.ts', 'estimating/bidEstimate.ts', 'estimating/accubidBidData.ts']) {
      const t = fs.readFileSync(path.join(SRC, f), 'utf8');
      expect(/learning/i.test(t), f).toBe(false);
    }
    const ri = fs.readFileSync(path.join(SRC, 'ai/reviewItems.ts'), 'utf8');
    const ec = ri.slice(ri.indexOf('export function enforcedCounts('), ri.indexOf('export function reviewResolutionsForAgent4('));
    expect(ec).not.toMatch(/learning|lessonHints/);
  });
});
