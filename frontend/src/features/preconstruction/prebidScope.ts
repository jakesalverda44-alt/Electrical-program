// Maps Cowork pre-bid scope sections into the CRM's Scope of Work sections (SCOPE_SECS).
//
// Mapping is by TITLE, never by letter. The two schemes collide: Cowork D is Site while
// CRM D is Low Voltage / Data, and Cowork E is Low Voltage while CRM E is Fire Alarm.
// Letter alignment would file site lighting under Low Voltage and low voltage under Fire
// Alarm — plausible-looking and wrong. buildScopeFromAgent2 in PcWorkspace.tsx already
// does the same kind of deliberate remapping for Agent 2 output.
export interface PrebidSection { id: string; title: string; items: string[] }

// Keys are normalized titles; values are SCOPE_SECS ids.
const TITLE_TO_SECTION: Record<string, string> = {
  'SERVICE & DISTRIBUTION': 'A',
  'BRANCH POWER': 'B',
  'LIGHTING & CONTROLS': 'C',
  'SITE LIGHTING, UNDERGROUND WORK & ALLOWANCES': 'F',
  'LOW VOLTAGE INFRASTRUCTURE': 'D',
  'PROJECT COORDINATION & CLOSEOUT': 'G',
};

// Same shape of normalization the takeoff categories use: drop a trailing parenthetical
// and any em/en-dash qualifier, so "Branch Power — Car Wash Equipment" and "Low Voltage
// Infrastructure (Conduit & Boxes Only)" still resolve. Sections are job-type dependent,
// so this has to tolerate wording it has never seen.
function normalizeTitle(raw: string): string {
  return raw
    .replace(/\s*\(.*\)\s*$/, '')
    .replace(/\s*[—–-]\s+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function buildScopeFromPrebid(sections: PrebidSection[]): Record<string, string> {
  const blocks: Record<string, string[]> = {};

  for (const sec of sections) {
    const items = (sec.items ?? []).map(i => i.trim()).filter(Boolean);
    if (!items.length) continue;

    const target = TITLE_TO_SECTION[normalizeTitle(sec.title)];
    const lines = items.map(i => `• ${i}`);

    // An unrecognized section keeps its heading and lands in G rather than being dropped:
    // an overloaded Special Systems box is a far better failure than missing scope.
    if (target) (blocks[target] ??= []).push(...lines);
    else (blocks.G ??= []).push(`${sec.title}:`, ...lines);
  }

  const out: Record<string, string> = {};
  for (const [id, lines] of Object.entries(blocks)) out[id] = lines.join('\n');
  return out;
}
