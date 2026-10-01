// Level 2 learning, Task 12 — lessons PROPOSED from repeated human answers
// (pure). A lesson is a short written hint the estimator approves, edits or
// dismisses; nothing is used unapproved, and nothing ever changes a count.
// Sources: other bids' review_items human answers (never automatic ones)
// and the example captures (marker corrections). takeoff_labeled_events is
// never read.
//
// Patterns:
//   1 unlisted-meaning   — an unscheduled tag drawn as the same symbol,
//                          answered (counted) as the same kind of fixture on
//                          ≥ 2 bids → a review suggestion (counter only if
//                          Jake ticks it, L-D3);
//   2 status-convention  — "shaded symbols are new, open are existing"
//                          answered on ≥ 2 bids → counter;
//   3 legend-not-drawn   — the same legend entry answered not on this job on
//                          ≥ 3 bids → a review hint ONLY (telling the counter
//                          "usually absent" could make it miss a real one);
//   4 repeated-confusion — ≥ 3 re-type / delete corrections of one class
//                          confused with another across ≥ 2 bids → counter;
//   5 manual             — "Make a lesson from this answer" (from-item).
// Suggested scope: all jobs, unless every evidence bid shares a project type
// (or a non-default account rule) — shown only; "all jobs" is preselected.
import { fp } from '../accountMemory';
import { looksLikeFixture } from '../remodel/unlisted';
import type { ReviewItem, ReviewResolution } from '../reviewItems';
import { deviceClassOf, type DeviceClass } from './meaning';
import type { LessonEvidence, LessonMatch, LessonRow, ScopeKind } from './learningDb';

export interface LessonSourceBid { bidId: string; bidName: string; projectType: string | null; ruleId: string | null; items: ReviewItem[] }
export interface ConfusionExample { bidId: string; bidName: string; from: DeviceClass | null; to: DeviceClass | null; notADevice: boolean; at: string; exampleId: string }
export interface Proposal { pattern: string; text: string; match: LessonMatch; appliesTo: Array<'counter' | 'review'>; evidence: LessonEvidence[]; suggestedScope: { kind: ScopeKind; value: string | null; label: string } }

const human = (r?: ReviewResolution): r is ReviewResolution => !!r && !r.auto;
const CLASS_WORDS: Record<string, string> = {
  'receptacle.duplex': 'duplex receptacles', 'receptacle.gfci': 'GFCI receptacles', 'receptacle.quad': 'quad receptacles', 'receptacle.simplex': 'simplex receptacles',
  'receptacle.floor': 'floor boxes', 'receptacle.weatherproof': 'weatherproof receptacles', 'switch.single': 'single-pole switches', 'switch.3way': '3-way switches',
  'switch.4way': '4-way switches', 'switch.dimmer': 'dimmers', 'switch.occupancy': 'occupancy sensors', 'fixture.troffer': 'troffers', 'fixture.highbay': 'high bays',
  'fixture.strip': 'strip lights', 'fixture.downlight': 'downlights', 'fixture.wallpack': 'wall packs', 'fixture.exit': 'exit signs', 'fixture.emergency': 'emergency lights',
  'fixture.pole': 'site pole lights', 'fixture.linear': 'linear fixtures', 'equipment.disconnect': 'disconnects', 'equipment.panel': 'panels', 'equipment.jbox': 'junction boxes',
  'equipment.motor': 'motors', 'equipment.fan': 'fans', 'equipment.thermostat': 'thermostats', 'tag.powerpole': 'power-pole tags', 'tag.keynote': 'keynote tags',
};
const words = (c: string | null) => (c ? CLASS_WORDS[c] ?? c : 'other symbols');

export function suggestedScopeOf(evidenceBids: Array<{ projectType: string | null; ruleId: string | null }>, defaultRuleId: string | null): Proposal['suggestedScope'] {
  const pts = new Set(evidenceBids.map(b => b.projectType));
  const rules = new Set(evidenceBids.map(b => b.ruleId));
  if (rules.size === 1 && [...rules][0] && [...rules][0] !== defaultRuleId) return { kind: 'account', value: [...rules][0], label: 'this client' };
  if (pts.size === 1 && [...pts][0]) return { kind: 'project_type', value: [...pts][0], label: `this project type: ${[...pts][0]}` };
  return { kind: 'all', value: null, label: 'all jobs' };
}

const cleanReason = (reason: string, tag: string) => reason.replace(new RegExp(`^\\s*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b\\s*`, 'i'), '').replace(/["”]?\s*[×x]\s*\d+\s*$/, '').trim();

/** Pattern 5 / the manual path: a lesson from one human-answered item. */
export function lessonFromItem(bid: LessonSourceBid, item: ReviewItem, defaultRuleId: string | null): Proposal | null {
  const r = item.resolution;
  if (!human(r)) return null;
  const ev: LessonEvidence = { bidId: bid.bidId, bidName: bid.bidName, itemId: item.id, answer: r.action === 'count' ? String(r.qty) : r.action === 'not_on_job' ? 'not on this job' : String(r.answer ?? r.action), reason: r.reason ?? null, at: r.at };
  const scope = suggestedScopeOf([bid], defaultRuleId);
  if (item.id.startsWith('unlisted:') && r.action === 'count') {
    const tag = item.type ?? item.id.slice('unlisted:'.length);
    const what = cleanReason(r.reason ?? '', tag);
    const category = looksLikeFixture(item.description ?? '') ? 'interior_lighting' : 'device';
    return {
      pattern: 'manual', appliesTo: ['review'],
      text: `An unscheduled tag drawn as "${item.description ?? 'this symbol'}" has been ${what} (${tag} on ${bid.bidName}).`.slice(0, 300),
      match: { itemPrefix: 'unlisted:', unlistedSymbolFp: fp(item.description), ...(deviceClassOf(what, category) ? { deviceClass: deviceClassOf(what, category)! } : {}) },
      evidence: [ev], suggestedScope: scope,
    };
  }
  const subject = item.title.replace(/: same area or different areas\?$/, '');
  return {
    pattern: 'manual', appliesTo: ['review'],
    text: `${subject}: answered "${ev.answer}"${r.reason ? ` — ${r.reason}` : ''} on ${bid.bidName}.`.slice(0, 300),
    match: { itemPrefix: `${item.id.split(':')[0]}:`, ...(item.typeKey ? { typeKey: item.typeKey } : {}) },
    evidence: [ev], suggestedScope: scope,
  };
}

/** Patterns 1-4 over every source (pure). */
export function proposeLessons(sources: LessonSourceBid[], confusions: ConfusionExample[], defaultRuleId: string | null): Proposal[] {
  const out: Proposal[] = [];
  const bidOf = new Map(sources.map(s => [s.bidId, s]));
  // 1 — unlisted meaning
  const unl = new Map<string, Array<{ bid: LessonSourceBid; item: ReviewItem; what: string }>>();
  for (const b of sources) for (const i of b.items ?? []) {
    if (!i.id.startsWith('unlisted:') || !human(i.resolution) || i.resolution.action !== 'count') continue;
    const tag = i.type ?? i.id.slice('unlisted:'.length);
    const what = cleanReason(i.resolution.reason ?? '', tag);
    const cls = deviceClassOf(what, looksLikeFixture(i.description ?? '') ? 'interior_lighting' : 'device');
    if (!cls || !cls.startsWith('fixture.')) continue;
    const k = `${fp(i.description)}|${cls}`;
    unl.set(k, [...(unl.get(k) ?? []), { bid: b, item: i, what }]);
  }
  for (const [k, hits] of unl) {
    const bids = [...new Set(hits.map(h => h.bid.bidId))];
    if (bids.length < 2) continue;
    const [symFp, cls] = k.split('|');
    out.push({
      pattern: 'unlisted-meaning', appliesTo: ['review'],
      text: `An unscheduled tag drawn as "${hits[0].item.description ?? ''}" has been ${hits[0].what} (${hits.map(h => `${h.item.type ?? '?'} on ${h.bid.bidName}`).slice(0, 3).join(', ')}).`.slice(0, 300),
      match: { itemPrefix: 'unlisted:', unlistedSymbolFp: symFp, deviceClass: cls },
      evidence: hits.map(h => ({ bidId: h.bid.bidId, bidName: h.bid.bidName, itemId: h.item.id, answer: String(h.item.resolution!.qty), reason: h.item.resolution!.reason ?? null, at: h.item.resolution!.at })),
      suggestedScope: suggestedScopeOf(bids.map(id => bidOf.get(id)!), defaultRuleId),
    });
  }
  // 2 — status convention
  const conv = sources.flatMap(b => (b.items ?? []).filter(i => i.id === 'remodel:conventions' && human(i.resolution) && /shaded|filled/i.test(i.resolution.answer ?? '')).map(i => ({ b, i })));
  if (new Set(conv.map(c => c.b.bidId)).size >= 2) {
    out.push({
      pattern: 'status-convention', appliesTo: ['counter'],
      text: 'When a sheet says shaded / filled symbols are new, shaded receptacles are new and open ones are existing.',
      match: { itemPrefix: 'remodel:conventions' },
      evidence: conv.map(c => ({ bidId: c.b.bidId, bidName: c.b.bidName, itemId: c.i.id, answer: c.i.resolution!.answer ?? '', reason: c.i.resolution!.reason ?? null, at: c.i.resolution!.at })),
      suggestedScope: { kind: 'all', value: null, label: 'all jobs' },
    });
  }
  // 3 — legend symbol usually not drawn
  const noj = new Map<string, Array<{ b: LessonSourceBid; itemId: string; type: string; description: string; r: ReviewResolution }>>();
  for (const b of sources) for (const i of b.items ?? []) {
    const rows = i.groupedTypes?.length ? i.groupedTypes.map(m => ({ type: m.type, description: m.description, r: m.resolution })) : i.id.startsWith('count:') && /^Counted 0/.test(i.detail) ? [{ type: i.type ?? '', description: i.description ?? '', r: i.resolution }] : [];
    for (const m of rows) {
      if (!human(m.r) || m.r.action !== 'not_on_job' || !m.description) continue;
      const k = fp(m.description);
      noj.set(k, [...(noj.get(k) ?? []), { b, itemId: i.id, type: m.type, description: m.description, r: m.r }]);
    }
  }
  for (const [k, hits] of noj) {
    const bids = [...new Set(hits.map(h => h.b.bidId))];
    if (bids.length < 3) continue;
    out.push({
      pattern: 'legend-not-drawn', appliesTo: ['review'],
      text: `The legend entry "${hits[0].description}" has been answered "not on this job" on ${bids.length} bids (${[...new Set(hits.map(h => h.b.bidName))].slice(0, 3).join(', ')}).`.slice(0, 300),
      match: { meaningFp: k },
      evidence: hits.map(h => ({ bidId: h.b.bidId, bidName: h.b.bidName, itemId: h.itemId, answer: 'not on this job', reason: h.r.reason ?? null, at: h.r.at })),
      suggestedScope: suggestedScopeOf(bids.map(id => bidOf.get(id)!), defaultRuleId),
    });
  }
  // 4 — repeated confusion (example captures)
  const conf = new Map<string, ConfusionExample[]>();
  for (const c of confusions) {
    if (!c.from) continue;
    const k = `${c.from}→${c.notADevice ? 'none' : c.to ?? 'none'}`;
    conf.set(k, [...(conf.get(k) ?? []), c]);
  }
  for (const [k, hits] of conf) {
    const bids = [...new Set(hits.map(h => h.bidId))];
    if (hits.length < 3 || bids.length < 2) continue;
    const [from, to] = k.split('→');
    out.push({
      pattern: 'repeated-confusion', appliesTo: ['counter'],
      text: (to === 'none' ? `Marks read as ${words(from)} have often not been devices at all — check the legend before counting one.` : `${words(to)[0].toUpperCase()}${words(to).slice(1)} have been mistaken for ${words(from)}.`).slice(0, 300),
      match: { deviceClass: from },
      evidence: hits.map(h => ({ bidId: h.bidId, bidName: h.bidName, itemId: `example:${h.exampleId}`, answer: to === 'none' ? 'not a device' : words(to), reason: null, at: h.at })),
      suggestedScope: suggestedScopeOf(bids.map(id => bidOf.get(id) ?? { projectType: null, ruleId: null }), defaultRuleId),
    });
  }
  return out;
}

/** Against the stored lessons: a proposal of an existing lineage (same
 *  pattern + match) appends evidence; a DISMISSED one comes back only with
 *  evidence from a bid not in the dismissed evidence. */
export function reconcileProposals(proposals: Proposal[], existing: LessonRow[]): { inserts: Proposal[]; appends: Array<{ lessonId: string; evidence: LessonEvidence[] }> } {
  const key = (pattern: string, m: LessonMatch) => `${pattern}|${JSON.stringify(Object.keys(m).sort().map(k => [k, (m as Record<string, unknown>)[k]]))}`;
  const latest = new Map<string, LessonRow>();
  for (const l of [...existing].sort((a, b) => a.version - b.version)) latest.set(key(l.pattern, l.match), l);
  const inserts: Proposal[] = [];
  const appends: Array<{ lessonId: string; evidence: LessonEvidence[] }> = [];
  for (const p of proposals) {
    const l = latest.get(key(p.pattern, p.match));
    if (!l) { inserts.push(p); continue; }
    const seen = new Set(l.evidence.map(e => `${e.bidId}|${e.itemId}`));
    const fresh = p.evidence.filter(e => !seen.has(`${e.bidId}|${e.itemId}`));
    if (!fresh.length) continue;
    if (l.status === 'dismissed') {
      const oldBids = new Set(l.evidence.map(e => e.bidId));
      if (fresh.some(e => !oldBids.has(e.bidId))) inserts.push(p);
      continue;
    }
    appends.push({ lessonId: l.id, evidence: [...l.evidence, ...fresh] });
  }
  return { inserts, appends };
}
