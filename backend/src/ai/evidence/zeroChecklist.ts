// Fewer-questions round Task 2 (Jake's approval 1) — ONE checklist for the
// zero-count equipment rows that come from the notes, schedules and
// equipment lists (and, D1, the legend-symbol equipment types): each row
// shows the text it comes from, quoted, and what the checklist PROPOSES.
// Pure. A proposal is never a count: nothing counts until the estimator
// answers a row (one by one, or "Confirm all" for the rows that carry a
// proposal from a quote or the account rule — never a legend row).
//
// Proposal tiers (first that applies):
//   covered    — a counted line already carries this row's circuit and name
//                ("PYLON SIGN, circuit A-18" ⊂ SIGNS "pylon sign A-18")
//                → not on this job;
//   classified — the row says another party installs it ("installed by
//                AutoZone vendor") → not on this job (by others);
//   stated     — the row states a quantity (statedQuantity) → that count;
//   named      — the tag names one unit ("AHU #2") → 1.
// Labels (never a proposal): Owner furnishes / APT installs ("<account>
// furnished"), low-voltage / controls words, and for a legend row its twin
// text row ("T" = "TSTAT", counted once) or the panels that name it.
import type { CountResult } from '../countingStage';
import type { GroupedMember, ReviewItem } from '../reviewItems';
import { statedQuantity, namedUnitTag } from './statedQuantity';
import { tradeAssignmentOf, describeAssignment } from '../../bidstd/tradeAssignment';
import { circuitsOf } from './consolidate';

/** D1 (Jake: yes) — legend-symbol equipment zeros join the checklist as
 *  "enter each" rows: no proposal, never in Confirm all. */
export const CHECKLIST_LEGEND_EQUIPMENT = true;
export const CHECKLIST_ID = 'textzero:equipment';

export interface ZeroChecklistOptions {
  /** The matched account rule's aliases ("AutoZone"): "<alias> furnished" = Owner. */
  accountAliases?: string[];
  /** Agent 1's panels (name, fedFrom) — a legend type the panels name. */
  agent1Panels?: Array<{ name?: string; fedFrom?: string }>;
  legendEquipment?: boolean;
}

const EQUIPMENT_KEYWORD_RE = /\bmeter\s*base\b|\bwireway\b|\bdiscon(?:nect)?\b|\bLCP\b|\bdata\s*concentrator\b|\bpanel(?:board)?\b/i;
const LOW_VOLTAGE_RE = /\bdata\s*concentrator\b|\balarm\b|\bsecurity\b|\bphone\s*board\b|\bthermostats?\b|\bcctv\b|\bcameras?\b|\bintercom\b|\btelephone\b/i;
const SYNONYMS: Array<[RegExp, string]> = [[/\bfused\s+switch(?:es)?\b|\bdisconnects?\b|\bdiscon\b|\bsafety\s+switch(?:es)?\b/gi, ' disconnect '], [/\btstats?\b/gi, ' thermostat ']];
const GENERIC = new Set(['with', 'above', 'below', 'from', 'unit', 'units', 'box', 'boxes', 'control', 'controls', 'panel', 'panels', 'electric', 'electrical', 'power', 'direct',
  'equipment', 'connection', 'circuit', 'nema', 'furnished', 'installed', 'contractor', 'provided', 'board', 'room', 'closet', 'wall', 'roof', 'north', 'south', 'east', 'west', 'facing', 'store', 'models', 'model', 'cable', 'factory', 'wired', 'only', 'each', 'type', 'existing', 'new']);

/** Significant nouns, singular, with the synonym table applied. */
export function nounsOf(text: string): Set<string> {
  let t = ` ${String(text ?? '').toLowerCase()} `;
  for (const [re, w] of SYNONYMS) t = t.replace(re, w);
  return new Set(t.split(/[^a-z]+/).filter(w => w.length >= 4).map(w => w.replace(/(?:es|s)$/, m => (w.endsWith('ss') ? m : ''))).filter(w => w.length >= 4 && !GENERIC.has(w)));
}

export interface ChecklistBuild { item: ReviewItem | null; absorbed: string[] }

export function buildZeroChecklist(items: ReviewItem[], countResult: CountResult | null, opts: ZeroChecklistOptions = {}): ChecklistBuild {
  if (!countResult?.evidence) return { item: null, absorbed: [] };
  const legendEq = opts.legendEquipment ?? CHECKLIST_LEGEND_EQUIPMENT;
  const typeByKey = new Map(countResult.types.map(t => [t.key, t]));
  const targetByKey = new Map(countResult.targets.map(t => [t.key, t]));
  const candidates: Array<{ item: ReviewItem; rowKind: 'text' | 'legend' }> = [];
  for (const i of items) {
    if (i.kind !== 'count' || !i.id.startsWith('count:') || i.id.endsWith(':heads') || i.blocking === false || !i.typeKey) continue;
    const t = typeByKey.get(i.typeKey);
    const tgt = targetByKey.get(i.typeKey);
    if (!t || !tgt || t.status !== 'zero' || t.host || tgt.role === 'host' || t.legendUnused) continue;
    if (tgt.source === 'equipment_schedule' || tgt.source === 'panel_circuits') { candidates.push({ item: i, rowKind: 'text' }); continue; }
    if (legendEq && tgt.source === 'legend' && (tgt.category === 'equipment' || EQUIPMENT_KEYWORD_RE.test(`${tgt.type} ${tgt.description}`))) candidates.push({ item: i, rowKind: 'legend' });
  }
  if (!candidates.length) return { item: null, absorbed: [] };

  const panelNames = new Set((opts.agent1Panels ?? []).map(p => String(p.name ?? '').toUpperCase().trim()).filter(n => /^[A-Z]{1,3}$/.test(n)));
  for (const tb of countResult.evidence?.tables ?? []) if (tb.kind === 'panel') { const n = /\b([A-Z]{1,3})\b/.exec(tb.title.toUpperCase().replace(/PANEL(?:BOARD)?|SCHEDULE/g, ' '))?.[1]; if (n) panelNames.add(n); }
  const counted = countResult.types.filter(t => t.status === 'counted' && t.count > 0 && !t.host);
  const texts = candidates.filter(c => c.rowKind === 'text');

  const members: GroupedMember[] = candidates.map(({ item, rowKind }) => {
    const t = typeByKey.get(item.typeKey!)!;
    const tgt = targetByKey.get(item.typeKey!)!;
    const desc = tgt.description || t.description || '';
    const sheet = tgt.sourceSheet || (tgt.source === 'legend' ? 'the legend' : tgt.source === 'panel_circuits' ? 'a panel schedule' : 'the equipment list');
    const field = tgt.source === 'legend' ? 'legend' : tgt.source === 'panel_circuits' ? 'panel schedule' : 'equipment list';
    const alsoDrawn = t.sheets.filter(s => s.count > 0 && !s.used).map(s => ({ sheet: s.label.split(' ')[0], count: s.count }));
    const m: GroupedMember = {
      key: t.key, type: t.type, description: desc, ...(item.fingerprint ? { fingerprint: item.fingerprint } : {}),
      rowKind, quote: { text: desc, sheet, field }, ...(alsoDrawn.length ? { alsoDrawn } : {}),
    };
    const labels: string[] = [];
    const a = tradeAssignmentOf(desc, { accountAliases: opts.accountAliases });
    if (a?.aptScope === 'install') labels.push(`${describeAssignment(a).replace(/^furnished by Owner/, 'Owner furnishes')}`.replace('installed by APT', 'APT installs'));
    else if (a?.aptScope === 'connection') labels.push(describeAssignment(a));
    if (!a && LOW_VOLTAGE_RE.test(`${t.type} ${desc}`)) labels.push('low-voltage / controls — usually by others; APT\'s?');
    if (rowKind === 'text') {
      // covered: a counted line carries this row's circuit AND a shared noun.
      const own = circuitsOf(desc, panelNames);
      const myNouns = nounsOf(`${t.type} ${desc}`);
      const covering = own.size ? counted.filter(c => {
        const ct = targetByKey.get(c.key);
        const ctext = `${c.type} ${ct?.description ?? c.description}`;
        const cc = circuitsOf(ctext.replace(/\b(?:CONTROLS|SERVES|FEEDS|FOR)\b/gi, ' '), panelNames);
        return [...own].some(x => cc.has(x)) && [...nounsOf(ctext)].some(n => myNouns.has(n));
      }) : [];
      if (covering.length === 1) {
        const c = covering[0];
        m.proposal = { action: 'not_on_job', reason: `Covered by ${c.type} (${[...own].map(x => x.replace(/^([A-Z]+)(\d+)$/, '$1-$2')).join(', ')}) — already a counted line ("${(targetByKey.get(c.key)?.description ?? c.description).slice(0, 100)}")`, tier: 'covered' };
      } else if (a?.aptScope === 'none') {
        m.proposal = { action: 'not_on_job', reason: `By others per ${sheet}: "${desc.slice(0, 140)}"`, tier: 'classified' };
      } else {
        const sq = statedQuantity(desc);
        if (sq && 'qty' in sq) m.proposal = { action: 'count', qty: sq.qty, reason: `Stated: "${sq.quote}" (${sheet})`, tier: 'stated' };
        else if (sq && 'conflict' in sq) labels.push(`the text states two quantities (${sq.conflict.join(' vs ')}) — enter the count`);
        else if (namedUnitTag(t.type)) m.proposal = { action: 'count', qty: 1, reason: `Named unit ${t.type} (${sheet})`, tier: 'named' };
      }
    } else {
      // D1 legend row: never a proposal — a twin text row, or the panels that name it, as labels.
      const mine = nounsOf(`${t.type} ${desc}`);
      const twins = texts.filter(x => [...nounsOf(`${x.item.type} ${x.item.description}`)].some(n => mine.has(n)));
      if (twins.length === 1) {
        const tw = twins[0].item;
        m.twinOf = tw.typeKey;
        labels.push(`the same item as ${tw.type} ("${(tw.description ?? '').slice(0, 80)}")? — counted once: answer this row "not on this job" if so`);
      }
      const naming = (opts.agent1Panels ?? []).filter(p => p.name && p.fedFrom && [...nounsOf(p.fedFrom)].some(n => mine.has(n)) && new RegExp(`\\b${(desc.match(/\b\d{2,4}\s?A\b/i)?.[0] ?? '§§').replace(/\s/g, '\\s?')}`, 'i').test(p.fedFrom));
      const named = [...new Set(naming.map(p => /\(?([A-Z][A-Z0-9 ]*?)\s*\(/.exec(String(p.fedFrom))?.[1]?.trim() ?? String(p.fedFrom)))];
      if (named.length >= 2 && named.length === naming.length) labels.push(`the panels name ${named.length}: ${naming.map(p => `"${p.fedFrom}" (feeds ${p.name})`).join(', ')} — enter the count`);
      labels.push('a legend symbol — needs your number');
    }
    if (labels.length) m.label = labels.join('; ');
    return m;
  });
  members.sort((a, b) => (a.rowKind === b.rowKind ? 0 : a.rowKind === 'text' ? -1 : 1) || a.type.localeCompare(b.type));
  const n = members.length;
  const withProposal = members.filter(m => m.proposal).length;
  const item: ReviewItem = {
    id: CHECKLIST_ID,
    kind: 'count',
    title: `${n} item${n === 1 ? '' : 's'} from the notes / schedules ${n === 1 ? "wasn't" : "weren't"} drawn as symbols — confirm counts`,
    detail: `${members.map(m => `${m.type}${m.description && m.description !== m.type ? ` — ${m.description}` : ''}${m.proposal ? ` (proposed: ${m.proposal.action === 'count' ? m.proposal.qty : 'not on this job'})` : ''}`).join('; ')}. None of these was found as a symbol on the counted plan sheets. Answer EACH row: a count, confirmed markers, or not on this job (with a reason). ${withProposal ? `${withProposal} row${withProposal === 1 ? ' carries' : 's carry'} a proposal taken from its own text (shown quoted) — "Confirm all" applies those; ` : ''}nothing is counted until you answer.`,
    category: 'equipment',
    groupedTypes: members,
    actions: ['count', 'markers', 'not_on_job', 'confirm'],
    fingerprint: `textzero|${members.map(m => m.key).sort().join('|')}`,
  };
  return { item, absorbed: candidates.map(c => c.item.id) };
}
