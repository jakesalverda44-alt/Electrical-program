// Tolerant extraction of the JSON object an agent returned.
//
// Takeoff accuracy (Task 1 follow-up, a live Agent 4 failure on the AutoZone
// bid): the old version took the NON-greedy fence match /```json ... ```/ as
// the only candidate. A string value containing ``` cut the JSON short, and a
// reply with an unterminated fence (truncated, or the model never closed it)
// could match up to a ``` inside the JSON — either way a complete object was
// reported as unparseable. Now several candidates are tried in order and the
// first one whose balanced object actually PARSES wins:
//   1. the non-greedy fenced block (the common, well-formed case),
//   2. everything from the first opening fence to the LAST closing fence
//      (a ``` inside a string value), or to the end of the text when the
//      fence is never closed,
//   3. the text with its closed fenced blocks removed (a broken fenced draft
//      followed by the real answer in prose),
//   4. the whole text.
// Brace scanning only ever starts at the FIRST '{' of a candidate, so a
// truncated reply can never come back as one of its nested fragments.

/** The balanced {...} starting at `start`, string- and escape-aware; null
 *  when it never closes. */
function scanFrom(source: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/** The first balanced object in `source`. Deliberately ONLY from the first
 *  '{': if that object never closes (a truncated reply), every later '{' is
 *  nested inside it, and returning one of those would hand back a silently
 *  partial object — so a truncated reply yields nothing. */
function scanObject(source: string): { json: string; parses: boolean } | null {
  const start = source.indexOf('{');
  if (start < 0) return null;
  const json = scanFrom(source, start);
  return json ? { json, parses: parses(json) } : null;
}

function parses(json: string): boolean {
  try { JSON.parse(json); return true; } catch { return false; }
}

export function extractJSONText(text: string): string | null {
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  const open = /```(?:json)?[ \t]*\r?\n?/i.exec(text);
  if (open) {
    const rest = text.slice(open.index + open[0].length);
    const lastClose = rest.lastIndexOf('```');
    candidates.push(lastClose >= 0 ? rest.slice(0, lastClose) : rest);
  }
  // The text with every closed fenced block removed — prose around a broken
  // fenced draft can still carry the real answer.
  const unfenced = text.replace(/```[\s\S]*?```/g, ' ');
  if (unfenced !== text) candidates.push(unfenced);
  candidates.push(text);

  let firstBalanced: string | null = null;
  for (const c of candidates) {
    const found = scanObject(c.trim());
    if (!found) continue;
    if (found.parses) return found.json;
    firstBalanced ??= found.json;
  }
  // Nothing parses: keep returning the first balanced candidate (callers
  // that store it verbatim, like agent2_output, keep today's behavior;
  // parseAIJSON below still reports null for it).
  return firstBalanced;
}

export function parseAIJSON(text: string): Record<string, unknown> | null {
  const json = extractJSONText(text);
  if (!json) return null;
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}
