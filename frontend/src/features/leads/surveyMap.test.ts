// frontend/src/features/leads/surveyMap.test.ts
import { describe, it, expect } from 'vitest';
import { surveyToGenFormFields } from './surveyMap';

describe('surveyToGenFormFields', () => {
  it('empty survey produces no fields', () => {
    expect(surveyToGenFormFields({})).toEqual({});
  });
  it('passes through simple answers', () => {
    expect(surveyToGenFormFields({ jobType: 'new-install', brand: 'Generac', fuel: 'LP', feedFt: 40 }))
      .toEqual({ jobType: 'new-install', brand: 'Generac', fuel: 'LP', feedFt: 40 });
  });
  it('gen stand replaces pad', () => {
    expect(surveyToGenFormFields({ base: 'stand-big' })).toEqual({ pad: false, genStand: 'big' });
    expect(surveyToGenFormFields({ base: 'pad' })).toEqual({ pad: true, genStand: 'none' });
    expect(surveyToGenFormFields({ base: 'existing-pad' })).toEqual({ pad: false, genStand: 'none' });
  });
  it('sizingNeeded suppresses size', () => {
    expect(surveyToGenFormFields({ size: '22KW', sizingNeeded: true })).toEqual({});
    expect(surveyToGenFormFields({ size: '22KW' })).toEqual({ size: '22KW' });
  });
  it('gasLine/removal only apply to swap-outs', () => {
    expect(surveyToGenFormFields({ jobType: 'new-install', gasLine: true, removal: true }))
      .toEqual({ jobType: 'new-install' });
    expect(surveyToGenFormFields({ jobType: 'swap-out', gasLine: true, removal: true }))
      .toEqual({ jobType: 'swap-out', gasLine: true, removal: true });
  });
  it('panelFt dropped when next to panel', () => {
    expect(surveyToGenFormFields({ panelRel: 'Next to panel', panelFt: 12 }))
      .toEqual({ panelRel: 'Next to panel' });
    expect(surveyToGenFormFields({ panelRel: 'Opposite side of panel', panelFt: 12 }))
      .toEqual({ panelRel: 'Opposite side of panel', panelFt: 12 });
  });
});
