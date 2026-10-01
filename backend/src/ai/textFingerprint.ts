// Fewer-questions round Task 6 / Level 2 — the exact-match text key: lowercase,
// punctuation removed, stopwords removed, numbers kept, unique tokens sorted.
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'w', 'by', 'per', 'is', 'are', 'be', 'as', 'each', 'all', 'from']);
export function fp(s: string | null | undefined): string {
  return [...new Set(String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w && !STOP.has(w)))].sort().join(' ');
}
