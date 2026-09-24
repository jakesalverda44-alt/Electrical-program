import { describe, expect, it } from 'vitest';
import { extractJSONText, parseAIJSON } from './json';

describe('AI JSON extraction', () => {
  it('parses JSON wrapped in a markdown json fence', () => {
    const parsed = parseAIJSON('```json\n{ "project_info": { "name": "Test" }, "panels": [] }\n```');
    expect(parsed?.project_info).toEqual({ name: 'Test' });
    expect(parsed?.panels).toEqual([]);
  });

  it('extracts the first balanced JSON object from surrounding text', () => {
    const json = extractJSONText('Here is the result:\n{ "a": { "b": "brace } in string" } }\nThanks');
    expect(json).toBe('{ "a": { "b": "brace } in string" } }');
  });

  it('returns null for incomplete JSON', () => {
    expect(parseAIJSON('```json\n{ "a": 1\n```')).toBeNull();
  });
});

describe('AI JSON extraction — robust fences (takeoff accuracy, live Agent 4 failure)', () => {
  it('a string value containing ``` no longer cuts the JSON short', () => {
    const text = '```json\n{ "plan_date": "2025-02-07", "takeoff_notes": ["see detail ```A``` on E-2"], "sheets": ["E-1"] }\n```';
    expect(parseAIJSON(text)).toEqual({ plan_date: '2025-02-07', takeoff_notes: ['see detail ```A``` on E-2'], sheets: ['E-1'] });
  });

  it('an unterminated fence (no closing ```) still yields the complete object', () => {
    const text = '```json\n{ "plan_date": "2025-02-07", "sheets": ["E-1", "E-2"], "sections": [] }\n';
    expect(parseAIJSON(text)).toEqual({ plan_date: '2025-02-07', sheets: ['E-1', 'E-2'], sections: [] });
  });

  it('an unterminated fence whose JSON contains ``` is not cut at the inner fence', () => {
    const text = '```json\n{ "note": "```", "sheets": ["E-1"] }';
    expect(parseAIJSON(text)).toEqual({ note: '```', sheets: ['E-1'] });
  });

  it('a broken fenced block falls back to brace-scanning the whole text', () => {
    const text = 'Draft:\n```json\n{ "a": \n```\nFinal answer: { "a": 2 }';
    expect(parseAIJSON(text)).toEqual({ a: 2 });
  });

  it('a truncated reply is still null (never a partial object)', () => {
    expect(parseAIJSON('```json\n{ "plan_date": "x", "sheets": [ "E-1"')).toBeNull();
  });
});

describe('AI JSON extraction — a truncated reply never yields a nested fragment', () => {
  it('a truncated Agent 4 reply whose first section closed is null, not that section', () => {
    const text = '```json\n{ "plan_date": "x", "sections": [ { "title": "A. Service & Distribution", "bullets": [] }, { "title": "B. Branch';
    expect(parseAIJSON(text)).toBeNull();
  });
});
