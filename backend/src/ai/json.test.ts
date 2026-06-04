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
