// Accuracy round C2 — sheet scale tiers on the real Kissimmee text runs and viewports.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { sheetScale, graphicScaleFromRuns, statedBuildingArea, buildingBoxFromMarks, describeScale } from './sheetScale';
import { loadKissimmeeLive0930 } from '../test/fixtures/realrun/live0930';

const text = JSON.parse(fs.readFileSync(path.join(__dirname, '../test/fixtures/realrun/kissimmee-2026-09-30-textruns.json'), 'utf8'));
const live = loadKissimmeeLive0930();
const sheet = (page: number) => live.countResult.sheets.find(s => s.page === page)!;
const vps = (page: number) => (sheet(page).viewports ?? []) as never[];

describe('C2 — graphic scale bar (C4.1, PH0.1 text layers)', () => {
  it('C4.1: 0/20/40 at 72 pt per 20 ft → 0.2778 ft/pt, and the stated building area', () => {
    const bar = graphicScaleFromRuns(text.pages['C4.1'].runs)!;
    expect(bar.ftPerPt).toBeCloseTo(0.2778, 3);
    expect(bar.labels).toEqual([-20, 0, 20, 40]);
    expect(statedBuildingArea(text.pages['C4.1'].runs)).toBe(7381);
    const s = sheetScale({ label: 'C4.1', textRuns: text.pages['C4.1'].runs });
    expect([s.tier, s.source, s.area.status]).toEqual(['suggested', 'scale_bar', 'not_checked']);
    expect(s.reasons).toContain('area not checked');
  });
  it('PH0.1 has the same 1" = 20\' bar', () => {
    expect(graphicScaleFromRuns(text.pages['PH0.1'].runs)!.ftPerPt).toBeCloseTo(0.2778, 3);
  });
});

describe('C2 — main-plan viewport scale', () => {
  it('E-1 "1/8\\" = 1\'-0\\"" → 0.1111 ft/pt, area check against the bid SF passes', () => {
    const main = vps(49).find((v: { kind: string }) => v.kind === 'main_plan');
    const box = buildingBoxFromMarks(live.countResult.marks.filter(m => m.sheetKey.endsWith('#49')), main);
    const s = sheetScale({ label: 'E-1', viewports: vps(49), buildingBoxPt: box, knownAreas: [{ sqFt: 7147, source: 'bid SF' }] });
    expect(s.tier).toBe('suggested');
    expect(s.ftPerPt).toBeCloseTo(1 / 9, 4);
    expect(s.area.status).toBe('ok');
    expect(describeScale(s)).toMatch(/0\.1111 ft\/pt \(E-1 1\/8" = 1'-0" \(main-plan viewport "POWER PLAN", vision-read\); area [\d,]+ vs 7,147 SF ✓\)/);
  });
  it('E-7 "Not to Scale" → unverified', () => {
    const s = sheetScale({ label: 'E-7', viewports: vps(55) });
    expect([s.tier, s.ftPerPt]).toEqual(['unverified', null]);
    expect(s.basis).toMatch(/Not to Scale/);
  });
  it('half size doubles the viewport scale', () => {
    const s = sheetScale({ label: 'E-1', viewports: vps(49), row: { half_size: true } });
    expect(s.ftPerPt).toBeCloseTo(2 / 9, 4);
  });
  it('area check both ways: a wrong scale fails and is unverified', () => {
    const box = { w: 600, h: 1000 };
    expect(sheetScale({ label: 'X', viewports: [{ kind: 'main_plan', scale: '1/8" = 1\'-0"', inPerFt: 0.125 }], buildingBoxPt: box, knownAreas: [{ sqFt: 7400, source: 'bid' }] }).tier).toBe('suggested');
    const bad = sheetScale({ label: 'X', viewports: [{ kind: 'main_plan', scale: '1/4" = 1\'-0"', inPerFt: 0.25 }], buildingBoxPt: box, knownAreas: [{ sqFt: 7400, source: 'bid' }] });
    expect(bad.tier).toBe('unverified');
    expect(bad.reasons[0]).toMatch(/building-area check failed/);
  });
  it('confirmed wins; disagreeing candidates are unverified', () => {
    expect(sheetScale({ label: 'X', row: { ft_per_pt: '0.1111', scale_source: 'calibrated' }, viewports: vps(49) })).toMatchObject({ tier: 'confirmed', source: 'calibrated' });
    expect(sheetScale({ label: 'X', row: { suggested_ft_per_pt: 0.2 }, viewports: vps(49) }).tier).toBe('unverified');
  });
});
