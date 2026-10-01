import { describe, it, expect } from 'vitest';
import { aiRfiSuggestions, newAiRfiQuestions } from './rfiSuggestions';

const json = (rfis: unknown) => JSON.stringify({ rfis });

describe('aiRfiSuggestions', () => {
  it('reads bare JSON', () => {
    expect(aiRfiSuggestions(json([{ question: 'A?' }, { question: 'B?' }]))).toEqual(['A?', 'B?']);
  });
  it('reads fenced JSON', () => {
    expect(aiRfiSuggestions('```json\n' + json([{ question: 'A?' }]) + '\n```')).toEqual(['A?']);
  });
  it('drops blanks and missing questions, trims', () => {
    expect(aiRfiSuggestions(json([{ question: '  ' }, {}, null, { question: '  C?  ' }]))).toEqual(['C?']);
  });
  it('dedupes by case and whitespace, first wins', () => {
    expect(aiRfiSuggestions(json([{ question: 'Who?' }, { question: '  who? ' }, { question: 'WHO?' }]))).toEqual(['Who?']);
  });
  it('returns [] for garbage, empty, or no rfis array', () => {
    expect(aiRfiSuggestions('not json')).toEqual([]);
    expect(aiRfiSuggestions(undefined)).toEqual([]);
    expect(aiRfiSuggestions(null)).toEqual([]);
    expect(aiRfiSuggestions('{"rfis":"x"}')).toEqual([]);
  });
});

describe('newAiRfiQuestions', () => {
  it('filters out questions already on the list (case/whitespace-insensitive)', () => {
    const out = newAiRfiQuestions(json([{ question: 'A?' }, { question: 'B?' }]), [{ question: ' a? ' }]);
    expect(out).toEqual(['B?']);
  });
});
