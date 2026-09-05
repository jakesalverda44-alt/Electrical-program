// Pure parsers and formatters lifted out of PcWorkspace.tsx unchanged.
import { EstimateLineItem } from '../../../types';

// Fence-tolerant JSON parse for an agent's raw output (```json ... ``` or
// bare) — shared by TakeoffTab's Agent 2/3 structured view and Task
// 5.2's "Import from AI analysis" RFI button, rather than each keeping its
// own copy of the same try/parse dance.
export function parseAgentJson(raw: string | undefined | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;
    const start = candidate.indexOf('{');
    return JSON.parse(start >= 0 ? candidate.slice(start) : candidate) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Parse Agent 2's "Scope of Work" prose into its lettered sections (A–H).
// Tolerant of markdown headers (#, *, -) and ".", ")" after the letter.
export function parseScopeSections(agent2: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!agent2) return result;
  // Isolate the Scope of Work region so lettered headers elsewhere
  // (Quantity Takeoff, BOM, etc.) aren't captured.
  let region = agent2;
  const scopeStart = region.search(/scope of work/i);
  if (scopeStart >= 0) {
    region = region.slice(scopeStart);
    const exclIdx = region.search(/\n\s*[#*>-]*\s*exclusions/i);
    if (exclIdx > 0) region = region.slice(0, exclIdx);
  }
  const headerRe = /^[#*\s>-]*([A-H])[.)]\s+[^\n]+/gm;
  const matches = [...region.matchAll(headerRe)];
  for (let i = 0; i < matches.length; i++) {
    const letter = matches[i][1].toUpperCase();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : region.length;
    const body = region.slice(start, end).trim();
    if (body) result[letter] = body;
  }
  return result;
}

// Strip markdown so Agent 2 output reads cleanly inside plain textareas:
// removes bold/italic/heading/code markers and flattens markdown tables to readable lines.
export function cleanMarkdown(text: string): string {
  return text
    .split('\n')
    .map(raw => {
      let l = raw;
      // Drop table separator rows like |---|---| or | :--- | ---: |
      if (/^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*\|?\s*$/.test(l)) return null;
      // Flatten table data rows: | a | b | c | → a · b · c
      if (/^\s*\|.*\|\s*$/.test(l)) {
        const cells = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()).filter(Boolean);
        l = cells.join(' · ');
      }
      l = l.replace(/^\s*#{1,6}\s+/, '');        // heading markers
      l = l.replace(/^\s*>\s?/, '');             // blockquote
      l = l.replace(/^\s*[-*+]\s+/, '• ');       // list markers → bullet
      l = l.replace(/\*\*(.+?)\*\*/g, '$1');     // bold
      l = l.replace(/__(.+?)__/g, '$1');
      l = l.replace(/\*(.+?)\*/g, '$1');         // italics
      l = l.replace(/`([^`]+)`/g, '$1');         // inline code
      return l;
    })
    .filter((l): l is string => l !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Map a lettered scope-of-work object (the shape Agent 2 emits, and the same shape the
// bid importer parses out of a finished proposal) into the Scope of Work tab's A–G
// sections. Section letters don't line up one-to-one, hence the explicit remapping.
export function scopeSectionsFrom(sow: Record<string, string[]> | undefined): Record<string, string> {
  if (!sow) return {};
  const join = (arr?: string[]) => (arr ?? []).join('\n');
  const out: Record<string, string> = {};
  const put = (key: string, val: string) => { const c = cleanMarkdown(val); if (c) out[key] = c; };
  put('A', join(sow.A_ServiceDistribution));
  put('B', join(sow.B_BranchPower));
  put('C', join(sow.C_LightingControls));
  put('D', join(sow.E_LowVoltage));                         // Low Voltage → D
  put('F', join(sow.D_SiteLightingUnderground));            // Site → F
  put('G', join(sow.F_Coordination));                       // Coordination → G (Special Systems)
  return out;
}

// Map Agent 2 output into the Scope of Work tab's 7 sections (A–G).
// Handles both the new compact JSON format and the old prose format.
export function buildScopeFromAgent2(agent2?: string): Record<string, string> {
  if (!agent2) return {};

  // Try new JSON format first
  try {
    const j = JSON.parse(agent2) as Record<string, unknown>;
    const sow = j.scopeOfWork as Record<string, string[]> | undefined;
    if (sow) return scopeSectionsFrom(sow);
  } catch { /* fall through to prose parser */ }

  // Fall back to prose parser for old format
  const s = parseScopeSections(agent2);
  const out: Record<string, string> = {};
  const put = (key: string, val?: string) => {
    if (!val) return;
    const cleaned = cleanMarkdown(val);
    if (cleaned) out[key] = cleaned;
  };
  put('A', s.A);
  put('B', s.B);
  put('C', s.C);
  put('D', s.E);
  put('E', s.F);
  put('F', s.D);
  put('G', [s.G, s.H].filter(Boolean).join('\n\n'));
  return out;
}

// Mirror of backend isElectricalSheet (preconstruction.ts) — keep in sync.
const ELEC_INCLUDE = /^E\d|electrical|one.?line|panel.?sched|equip.?sched|fixture|lumin|lighting|schedule/i;
const EXCLUDE_ONLY = /^(A|S|C|L|M|P|G|FP|PL|CV|CI|LS)\d/i;
export function isElecSheet(name: string) {
  const base = name.replace(/\.[^.]+$/, '');
  if (ELEC_INCLUDE.test(base)) return true;
  if (EXCLUDE_ONLY.test(base)) return false;
  return true;
}

export function analysisErrorMessage(data: Record<string, unknown> | null | undefined) {
  const parts = [
    data?.agent1_output,
    data?.agent2_output,
    data?.agent3_output,
    data?.raw_response,
  ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  const first = parts[0];
  if (!first) return 'Analysis failed. Check server logs.';
  if (first.length <= 700) return first;
  return `${first.slice(0, 700)}...`;
}

// The AI vision pipeline can only read PDFs and images — this gates which project
// documents may be sent to it (via the "From Project Files" checkboxes). It does
// NOT gate what's visible in that list; all project files show there, non-eligible
// rows just get a disabled checkbox. Full view/download of every file lives in the
// hub's Files tab.
export function isPdfOrImage(d: { file_type?: string; name?: string }) {
  const t = (d.file_type || '').toLowerCase();
  const n = (d.name || '').toLowerCase();
  return t === 'application/pdf' || t.startsWith('image/')
    || n.endsWith('.pdf') || n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.png');
}

export function lookupUnitCost(
  cat: string,
  lib: { global: Record<string,number>; by_project_type: Record<string,Record<string,number>> },
  projectType?: string | null
): number {
  if (projectType && lib.by_project_type[projectType]?.[cat] !== undefined) {
    return lib.by_project_type[projectType][cat];
  }
  return lib.global[cat] ?? 0;
}

export function buildLineItemsFromTakeoff(
  agent2Output: string | undefined,
  lib: { global: Record<string,number>; by_project_type: Record<string,Record<string,number>> },
  projectType: string | null | undefined,
  overrides: Record<string, number>
): EstimateLineItem[] {
  if (!agent2Output) return [];
  try {
    const raw = agent2Output.trim();
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : raw;
    const start = candidate.indexOf('{');
    const j = JSON.parse(start >= 0 ? candidate.slice(start) : candidate) as { takeoff?: { category: string; item: string; qty: number; unit: string; spec?: string; confidence?: string; notes?: string }[] };
    if (!j.takeoff?.length) return [];
    return j.takeoff.map(row => {
      const key = `${row.category}||${row.item}`;
      const base = lookupUnitCost(row.category, lib, projectType);
      const unit_cost = overrides[key] !== undefined ? overrides[key] : base;
      return {
        category: row.category, item: row.item, qty: row.qty, unit: row.unit || 'EA', unit_cost,
        total: row.qty * unit_cost, overridden: overrides[key] !== undefined,
        // Task 5 — carried through so the Pricing tab can render a FIRM/APPROX/VERIFY chip.
        confidence: row.confidence,
      };
    });
  } catch {
    return [];
  }
}

export function parseAgent1Service(output: string): { voltage: string; ampacity: string; panel: string } {
  try {
    const raw = output.trim();
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : raw;
    const start = candidate.indexOf('{');
    const j = JSON.parse(start >= 0 ? candidate.slice(start) : candidate) as {
      service?: { voltage?: string; mainAmps?: number };
      panels?: Array<{ name?: string }>;
    };
    const voltage  = j.service?.voltage ?? '';
    const ampacity = j.service?.mainAmps != null ? String(j.service.mainAmps) : '';
    const panels   = j.panels ?? [];
    const main = panels.find(p => /^(MDP|MTP|MSB|MAIN|MPS|MLO)/i.test(p.name ?? '')) ?? panels[0];
    return { voltage, ampacity, panel: main?.name ?? '' };
  } catch {
    return { voltage: '', ampacity: '', panel: '' };
  }
}
