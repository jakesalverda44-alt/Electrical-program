import { describe, it, expect } from 'vitest';
import { aiScaleFromViewports, buildAiScaleIndex } from './aiScale';

const main = (scale: string, inPerFt: number | null) => ({ kind: 'main_plan', scale, inPerFt });

describe('aiScaleFromViewports', () => {
  it('a single main-plan scale is exposed with the raw ft/pt', () => {
    const r = aiScaleFromViewports([main(`1/4" = 1'-0"`, 0.25)]);
    expect(r.ai_scale_label).toBe(`1/4" = 1'-0"`);
    expect(r.ai_ft_per_pt).toBeCloseTo(1 / (0.25 * 72), 9);
    expect(r.ai_scale_ambiguous).toBe(false);
  });
  it('the same scale on two main-plan viewports is still one distinct scale', () => {
    const r = aiScaleFromViewports([main(`1/4" = 1'-0"`, 0.25), main(`1/4"=1'-0"`, 0.25)]);
    expect(r.ai_ft_per_pt).not.toBeNull();
    expect(r.ai_scale_ambiguous).toBe(false);
  });
  it('several different main-plan scales -> ambiguous, no value', () => {
    const r = aiScaleFromViewports([main(`1/4" = 1'-0"`, 0.25), main(`1/8" = 1'-0"`, 0.125)]);
    expect(r).toEqual({ ai_scale_label: null, ai_ft_per_pt: null, ai_scale_ambiguous: true });
  });
  it('NTS -> no value (and not ambiguous)', () => {
    expect(aiScaleFromViewports([main('NOT TO SCALE', null)])).toEqual({ ai_scale_label: null, ai_ft_per_pt: null, ai_scale_ambiguous: false });
    expect(aiScaleFromViewports([main('N.T.S.', null)]).ai_ft_per_pt).toBeNull();
  });
  it('NTS next to a real scale -> ambiguous', () => {
    expect(aiScaleFromViewports([main('NTS', null), main(`1/4" = 1'-0"`, 0.25)]).ai_scale_ambiguous).toBe(true);
  });
  it('legend / schedule / detail / enlarged_plan scales are ignored', () => {
    const r = aiScaleFromViewports([
      { kind: 'legend', scale: `1" = 1'`, inPerFt: 1 }, { kind: 'schedule', scale: `1/2" = 1'-0"`, inPerFt: 0.5 },
      { kind: 'detail', scale: `3" = 1'-0"`, inPerFt: 3 }, { kind: 'enlarged_plan', scale: `1/2" = 1'-0"`, inPerFt: 0.5 },
      main(`1/8" = 1'-0"`, 0.125),
    ]);
    expect(r.ai_scale_label).toBe(`1/8" = 1'-0"`);
    expect(aiScaleFromViewports([{ kind: 'legend', scale: `1/4" = 1'-0"`, inPerFt: 0.25 }]).ai_ft_per_pt).toBeNull();
  });
  it('a main plan with no stated scale / junk input -> nothing', () => {
    expect(aiScaleFromViewports([main('', null)]).ai_ft_per_pt).toBeNull();
    expect(aiScaleFromViewports(undefined).ai_ft_per_pt).toBeNull();
    expect(aiScaleFromViewports('x').ai_scale_ambiguous).toBe(false);
  });
  it('engineering scale 1" = 20\' -> inPerFt 0.05', () => {
    expect(aiScaleFromViewports([main(`1" = 20'`, 0.05)]).ai_ft_per_pt).toBeCloseTo(20 / 72, 9);
  });
});

describe('buildAiScaleIndex', () => {
  const cr = { sheets: [
    { key: 'Plans.pdf#3', file: 'Plans.pdf', page: 3, viewports: [main(`1/4" = 1'-0"`, 0.25)] },
    { key: 'Plans.pdf#4', file: 'Plans.pdf', page: 4, viewports: [main(`1/4" = 1'-0"`, 0.25), main(`1/8" = 1'-0"`, 0.125)] },
    { key: 'Other.pdf#1', file: 'Other.pdf', page: 1, viewports: [main(`1/4" = 1'-0"`, 0.25)] },
    { key: 'Dup.pdf#1', file: 'Dup.pdf', page: 1, viewports: [main(`1/4" = 1'-0"`, 0.25)] },
    { key: 'Plans.pdf#5', viewports: [] },
  ] };
  const docs = [{ id: 'd1', name: 'plans.PDF' }, { id: 'd2', name: 'Dup.pdf' }, { id: 'd3', name: 'Dup.pdf' }];
  it('maps "<file>#<1-based page>" to document_id:page_index (case-insensitive file name)', () => {
    const idx = buildAiScaleIndex(cr, docs);
    expect(idx.get('d1:2')?.ai_scale_label).toBe(`1/4" = 1'-0"`);
    expect(idx.get('d1:3')?.ai_scale_ambiguous).toBe(true);
  });
  it('skips files that are not a plan document, and never guesses between duplicate names', () => {
    const idx = buildAiScaleIndex(cr, docs);
    expect([...idx.keys()].sort()).toEqual(['d1:2', 'd1:3']);
  });
  it('falls back to the key when file/page are absent; tolerates no count result', () => {
    const idx = buildAiScaleIndex({ sheets: [{ key: 'Plans.pdf#2', viewports: [main(`1/8" = 1'-0"`, 0.125)] }] }, docs);
    expect(idx.get('d1:1')?.ai_ft_per_pt).toBeCloseTo(1 / (0.125 * 72), 9);
    expect(buildAiScaleIndex(null, docs).size).toBe(0);
  });
});
