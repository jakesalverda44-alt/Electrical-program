// Takeoff accuracy, Task 7 — the Needs-review list (Decision 6) and its gate.
//
// Two kinds of item, one list:
//   * 'count'          — a type from the schedule/legend whose final count is
//                        0 or unreadable (or a pole type's heads when the
//                        schedule gives no heads-per-pole). Never ASSUMED:
//                        the estimator enters a count, confirms markers on
//                        the plans, or marks it "Not on this job" (reason
//                        required).
//   * 'scope_question' — a furnish/install term an account rule marks `ask`
//                        with no explicit statement on the drawings (Task 8).
//                        Answered from the listed options.
// Any open item puts the takeoff in 'needs_review', which blocks Agent 4,
// proposal .docx / GC takeoff .xlsx generation and the proposal send.
//
// Pure: building, merging (a re-run keeps the estimator's earlier
// resolutions — their work is never silently discarded) and validating a
// resolution. The DB/route half lives in routes/preconstruction.ts.
import type { CountResult } from './countingStage';
import { outsideAptInstall, describeAssignment } from '../bidstd/tradeAssignment';
import { facilityChecklistItems } from '../bidstd/facilityChecklists';

export type ReviewItemKind = 'count' | 'scope_question' | 'area' | 'confirm';
export type ResolutionAction = 'count' | 'markers' | 'not_on_job' | 'answer' | 'confirm';

export interface ReviewResolution {
  action: ResolutionAction;
  qty?: number;
  reason?: string;
  answer?: string;
  /** Scope questions (fix round 1 / B7) — the structured parties the answer
   *  stands for, so nothing downstream re-parses display text. */
  furnishBy?: string;
  installBy?: string;
  by: string;
  at: string;
  /** True when this resolution was made on an earlier analysis run and
   *  carried forward to this one. */
  carriedOver?: boolean;
}

export interface ReviewItem {
  /** Stable across re-runs: `count:<TYPEKEY>`, `count:<TYPEKEY>:heads`,
   *  `scope:<term>`, `area:<TYPEKEY>`, `coverage:<TYPEKEY>`,
   *  `unscheduled:<slug>`, `counting:not_run`, `counting:no_schedule`,
   *  `sheet:<file#page>`, `file:<name>`. */
  id: string;
  kind: ReviewItemKind;
  title: string;
  detail: string;
  // count
  typeKey?: string;
  type?: string;
  description?: string;
  category?: string;
  aiCount?: number;
  sheets?: string[];
  /** B3 — an unscheduled Agent 1 row: the text a resolved count is written
   *  back under (takeoff item), in `category`. */
  rowItem?: string;
  /** Actions the estimator may use on this item (UI + validation). */
  actions?: ResolutionAction[];
  // scope question
  term?: string;
  question?: string;
  options?: string[];
  /** B7 — per option, the parties it stands for (same order as options). */
  optionParties?: Array<{ furnishBy: string; installBy: string }>;
  notes?: string[];
  // area question (B4)
  keepQty?: number;
  sumQty?: number;
  /** N4 — what the item was built from; a resolution is carried to a new
   *  run only when this is unchanged. */
  fingerprint?: string;
  /** Next round A6/A7 — false for information only (e.g. a zero count for
   *  a type another trade / the Owner / a vendor installs): shown, never
   *  blocking. Absent = blocking. */
  blocking?: boolean;
  /** Next round A7 — the cause group the UI lists it under. */
  group?: string;
  /** Next round A6 — a pre-filled scope answer ("by G.C." -> APT). */
  suggested?: string;
  /** Evidence round 2.2 — a typical item: the device types and per-host
   *  quantities a resolved host count adds. */
  typicalDevices?: Array<{ key: string; perHost: number }>;
  /** Evidence round 3.3 — a family item: the primary type keys whose total
   *  the answer replaces. */
  familyPrimary?: string[];
  /** Evidence round 4.5 — a grouped item: legend-only zero-count types with
   *  no plan presence and no schedule row, combined into ONE "confirm none
   *  of these" item. A bulk not_on_job resolution zeroes every member. */
  groupedTypes?: Array<{ key: string; type: string; description: string }>;
  /** N4 — an earlier run's resolution for this item that was NOT carried
   *  over because the drawings/counts changed; shown for re-confirmation. */
  previousResolution?: ReviewResolution;
  resolution?: ReviewResolution;
}

export interface ScopeQuestionInput {
  term: string;
  label: string;
  question: string;
  options: string[];
  optionParties?: Array<{ furnishBy: string; installBy: string }>;
  notes: string[];
  /** Next round A6 — the pre-filled answer. */
  suggested?: string;
}

/** Open AND blocking (an information item — `blocking: false` — never
 *  holds the proposal). */
export function reviewItemIsOpen(i: ReviewItem): boolean {
  return !i.resolution && i.blocking !== false;
}

export function reviewStatus(items: ReviewItem[]): 'clear' | 'needs_review' {
  return items.some(reviewItemIsOpen) ? 'needs_review' : 'clear';
}

function slug(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

const AREA_SAME = (n: number) => `Same area — keep ${n}`;
const AREA_DIFFERENT = (n: number) => `Different areas — sum ${n}`;

export interface BuildReviewItemsOptions {
  /** Evidence round 4.6 — the bid's project type, for facility checklists
   *  (fuel/c-store, car wash, storage, prototype retail). Absent = none. */
  projectType?: string | null;
}

export function buildReviewItems(countResult: CountResult | null, scopeQuestions: ScopeQuestionInput[] = [], opts: BuildReviewItemsOptions = {}): ReviewItem[] {
  const items: ReviewItem[] = [];
  const targetByKey = new Map((countResult?.targets ?? []).map(t => [t.key, t]));

  // B2 — counting did not run, or ran with nothing from a schedule/legend:
  // the fixture counts are Agent 1's own and unverified. Never "clear".
  if (countResult && !countResult.ran) {
    items.push({
      id: 'counting:not_run',
      kind: 'confirm',
      title: countResult.noScheduleOrLegend ? 'No fixture schedule/legend found — counts not verified' : 'Counting did not run — counts not verified',
      detail: `Counting did not run: ${countResult.notRunReason ?? 'unknown reason'}. Confirm the fixture/device takeoff as the drawing analysis read it (with a reason), or enter the fixture types and re-run the analysis so they are counted.`,
      actions: ['confirm'],
      fingerprint: `not_run|${countResult.notRunReason ?? ''}`,
    });
  } else if (countResult && countResult.noScheduleOrLegend) {
    items.push({
      id: 'counting:no_schedule',
      kind: 'confirm',
      title: 'No fixture schedule/legend found — counts not verified',
      detail: 'The drawing analysis found no luminaire schedule and no device/symbol legend, so no fixture or device types were counted — those quantities are the analysis\'s own reading. Confirm them (with a reason), or enter the fixture types and re-run the analysis so they are counted.',
      actions: ['confirm'],
      fingerprint: `no_schedule|${countResult.targets.map(t => t.key).join(',')}`,
    });
  }
  // S3 — plan pages / files the counter never looked at.
  for (const s of (countResult?.skippedSheets ?? []) as Array<{ file: string; page: number; label: string; reason: string; suspect?: boolean }>) {
    if (!s.suspect) continue;
    items.push({
      id: `sheet:${s.file}#${s.page}`,
      kind: 'confirm',
      title: `Not counted: ${s.label}`,
      detail: `This page looks like an electrical plan but was not counted (${s.reason}). Confirm nothing on it is missing from the takeoff, or re-run the analysis after fixing the upload.`,
      actions: ['confirm'],
      fingerprint: `sheet|${s.reason}`,
    });
  }
  for (const f of countResult?.unclassifiedFiles ?? []) {
    items.push({
      id: `file:${f}`,
      kind: 'confirm',
      title: `Not counted: ${f}`,
      detail: 'The page classifier returned nothing for this PDF, so none of its pages were counted. Confirm it holds no electrical plans, or re-run the analysis.',
      actions: ['confirm'],
      fingerprint: 'file',
    });
  }

  for (const t of countResult?.types ?? []) {
    // Evidence round — a host marker is a multiplier, not a line (its own
    // review comes through the typical it multiplies); a merged type is part
    // of another type (3.3) and carries no count of its own.
    if (t.host || targetByKey.get(t.key)?.role === 'host' || t.status === 'merged') continue;
    const sheets = t.sheets.filter(s => s.count > 0).map(s => `${s.label}: ${s.count}${s.used ? '' : ` (not used — ${s.ignoredReason ?? 'ignored'})`}`);
    const fp = `${t.status}|${t.count}|${sheets.join(';')}`;
    const base = { typeKey: t.key, type: t.type, description: t.description, category: t.category, aiCount: t.count, sheets, fingerprint: fp };
    const title = `Type ${t.type}${t.description ? ` — ${t.description}` : ''}`;
    if (t.status !== 'counted') {
      const tgt = targetByKey.get(t.key);
      // Decision 4 — a type another trade / the Owner / a vendor installs:
      // a zero count is information, not a block.
      const info = outsideAptInstall(tgt?.assignment);
      items.push({
        id: `count:${t.key}`,
        kind: 'count',
        title,
        detail: `${t.status === 'zero' ? `Counted 0: ${t.reason}.` : `Could not be counted: ${t.reason}.`}${info ? ` Its schedule says ${describeAssignment(tgt!.assignment!)} — listed for information, not blocking.` : ''}`,
        actions: ['count', 'markers', 'not_on_job'],
        ...(info ? { blocking: false } : {}),
        ...base,
      });
    }
    if (t.status === 'counted' && t.areaQuestion) {
      const q = t.areaQuestion;
      items.push({
        id: `area:${t.key}`,
        kind: 'area',
        title: `${title}: same area or different areas?`,
        detail: `${q.sheets.map(s => `${s.label} ${s.count}`).join(' / ')} — same area (keep ${q.keep}) or different areas (sum ${q.sum})?`,
        options: [AREA_SAME(q.keep), AREA_DIFFERENT(q.sum)],
        keepQty: q.keep,
        sumQty: q.sum,
        actions: ['answer', 'count'],
        ...base,
      });
    }
    // Evidence round 1.3 — an enlarged plan whose place on the main plan is
    // not known shows this type too: repeats (keep) or adds (sum)?
    if (t.status === 'counted' && t.viewportQuestion) {
      const q = t.viewportQuestion;
      items.push({
        id: `viewport:${t.key}`,
        kind: 'area',
        title: `${title}: does the enlarged plan repeat the main plan?`,
        detail: `${q.items.map(x => `${x.sheet} ${x.viewport}: ${x.count}`).join('; ')} — where it sits on the main plan is not known. Repeats the main plan (keep ${q.keep}) or adds devices (${q.add})?`,
        options: [`Repeats the main plan — keep ${q.keep}`, `Adds devices — ${q.add}`],
        keepQty: q.keep,
        sumQty: q.add,
        actions: ['answer', 'count'],
        ...base,
        fingerprint: `viewport|${q.keep}|${q.add}|${q.items.map(x => `${x.sheet}:${x.viewport}:${x.count}`).join(';')}`,
      });
    }
    if (t.status === 'counted' && t.coverage?.length) {
      items.push({
        id: `coverage:${t.key}`,
        kind: 'count',
        title: `${title}: partial coverage`,
        detail: `${t.coverage.join(' ')} Enter the full count, confirm ${t.count} (with a reason), or mark it not on this job.`,
        actions: ['count', 'markers', 'confirm', 'not_on_job'],
        ...base,
      });
    }
    const target = targetByKey.get(t.key);
    if (t.category === 'site_lighting' && t.status === 'counted' && t.count > 0 && t.heads == null) {
      items.push({
        id: `count:${t.key}:heads`,
        kind: 'count',
        title: `Type ${t.type} — fixture heads`,
        detail: `${t.count} pole${t.count === 1 ? '' : 's'} counted, but the schedule does not say how many heads each pole carries.`,
        typeKey: `${t.key}:heads`, type: `${t.type} heads`, description: target?.description ?? t.description, category: t.category,
        aiCount: 0, sheets, actions: ['count', 'not_on_job'], fingerprint: fp,
      });
    }
  }
  // Fix round S2 — the dense-area recount found FEWER of a type than the
  // first pass: the estimator decides (never silently accepted).
  const lowerByType = new Map<string, string[]>();
  for (const sh of countResult?.sheets ?? []) {
    for (const l of sh.retry?.lower ?? []) {
      lowerByType.set(l.typeKey, [...(lowerByType.get(l.typeKey) ?? []), `${sh.label}: first pass ${l.first}, recount ${l.retry}`]);
    }
  }
  for (const [key, notes] of lowerByType) {
    const t = (countResult?.types ?? []).find(x => x.key === key);
    if (!t || t.status !== 'counted' || t.host) continue;
    items.push({
      id: `recount:${key}`,
      kind: 'count',
      title: `Type ${t.type}${t.description ? ` — ${t.description}` : ''}: the recount found fewer`,
      detail: `The sheet was re-counted at a higher resolution because some symbols could not be read, and the recount found fewer (${notes.join('; ')}). The takeoff has ${t.count}. Enter the right count, or confirm ${t.count} (with a reason).`,
      typeKey: t.key, type: t.type, description: t.description, category: t.category, aiCount: t.count,
      sheets: notes, actions: ['count', 'confirm'], fingerprint: `recount|${t.count}|${notes.join(';')}`,
    });
  }
  // B3 — Agent 1 rows that match no scheduled type: held, never dropped.
  for (const r of countResult?.removedRows ?? []) {
    if (!r.unscheduled) continue;
    const qty = Number(r.row.qty);
    if (!(qty > 0)) continue;
    const item = String(r.row.item ?? '').trim() || 'Unnamed fixture';
    const sheet = String(r.row.sourceSheet ?? '').trim();
    items.push({
      id: `unscheduled:${slug(`${item} ${sheet}`)}`,
      kind: 'count',
      title: `Unscheduled fixture: ${item}`,
      detail: `The drawing analysis found ${qty} × ${item}${sheet ? ` (${sheet})` : ''}, but it is not on the fixture schedule. Count it, or mark it not on this job.`,
      rowItem: item,
      category: String(r.row.category ?? 'Interior Lighting'),
      aiCount: qty,
      sheets: sheet ? [`${sheet}: ${qty}`] : [],
      actions: ['count', 'not_on_job'],
      fingerprint: `unscheduled|${qty}|${sheet}`,
    });
  }
  // Evidence round 2.2 — a typical package whose hosts were not counted:
  // the multiplier is never guessed. The estimator enters the host count
  // (each device type gets per-host x count) or marks it not on this job.
  const ev = countResult?.evidence;
  const byPackage = new Map<string, NonNullable<typeof ev>['expansions']>();
  for (const e of ev?.expansions ?? []) {
    if (e.status !== 'no_multiplier') continue;
    byPackage.set(e.packageId, [...(byPackage.get(e.packageId) ?? []), e]);
  }
  for (const [pkg, es] of byPackage) {
    const e0 = es[0];
    const typeName = (k: string) => (countResult?.types ?? []).find(t => t.key === k)?.type ?? k;
    items.push({
      id: `typical:${pkg}`,
      kind: 'count',
      title: `Typical: ${e0.host} — how many?`,
      detail: `${e0.viewportLabel || 'The legend'} says each ${e0.host.toLowerCase()} carries ${es.map(e => `${e.perHost} × ${typeName(e.deviceKey)}`).join(' + ')} ("${e0.quote.slice(0, 160)}"), but ${e0.reason}. Enter how many ${e0.host.toLowerCase()}s there are (each adds its devices), or mark it not on this job.`,
      typicalDevices: es.map(e => ({ key: e.deviceKey, perHost: e.perHost })),
      actions: ['count', 'not_on_job'],
      fingerprint: `typical|${es.map(e => `${e.deviceKey}x${e.perHost}`).join(',')}|${e0.reason}`,
    });
  }
  for (const [i, u] of (ev?.unmappedTypical ?? []).entries()) {
    items.push({
      id: `unscheduled:TYPICAL-${slug(`${u.host} ${u.text}`)}-${i + 1}`,
      kind: 'count',
      title: `Typical device not matched to a type: ${u.text}`,
      detail: `Each ${u.host.toLowerCase()} carries ${u.qty} × ${u.text} ("${u.quote.slice(0, 160)}"), which matches no legend or schedule type. Enter the total, or mark it not on this job.`,
      rowItem: `${u.text} (at ${u.host.toLowerCase()}s, typical)`,
      category: 'Branch Power',
      aiCount: 0,
      actions: ['count', 'not_on_job'],
      fingerprint: `typicalx|${u.qty}|${u.quote.slice(0, 60)}`,
    });
  }
  // Evidence round 3.3 — a family member that counted MORE than the type it
  // is the same fixture as: the estimator decides which count stands.
  for (const d of ev?.families ?? []) {
    if (!d.question) continue;
    const q = d.question;
    const primaryKeys = q.intoKeys;
    if (primaryKeys.length !== 1) {
      items.push({
        id: `family:${q.key}`,
        kind: 'confirm',
        title: `Same fixture on two schedules: ${q.key} = ${q.into}`,
        detail: `${q.key} has the same catalog number as ${q.into} (${d.family}). ${q.into} counted ${q.primaryCount} in total; ${q.key} counted ${q.memberCount}. Check the plans; confirm ${q.into}'s counts (with a reason), or correct them with markers.`,
        actions: ['confirm'],
        fingerprint: `family|${q.primaryCount}|${q.memberCount}`,
      });
      continue;
    }
    items.push({
      id: `family:${q.key}`,
      kind: 'area',
      title: `Same fixture on two schedules: ${q.key} = ${q.into}`,
      detail: `${q.key} has the same catalog number as ${q.into} (${d.family}). ${q.into} counted ${q.primaryCount}; ${q.key} counted ${q.memberCount}. They are one fixture — which count stands?`,
      options: [`Keep ${q.into} — ${q.primaryCount}`, `Use ${q.key}'s count — ${q.memberCount}`],
      keepQty: q.primaryCount,
      sumQty: q.memberCount,
      familyPrimary: primaryKeys,
      actions: ['answer'],
      fingerprint: `family|${q.primaryCount}|${q.memberCount}`,
    });
  }
  // Evidence round 3.4 — a panel schedule the viewport reader found but the
  // schedule reader could not read completely: its branch circuits have no
  // source (Agent 1 no longer states them).
  if (ev?.panelsUnread?.length) {
    items.push({
      id: 'schedule:panels-unread',
      kind: 'confirm',
      title: `Panel schedule${ev.panelsUnread.length === 1 ? '' : 's'} not read — branch circuits missing from the takeoff`,
      detail: `${ev.panelsUnread.join('; ')} could not be read row by row, so the takeoff has no branch-circuit count from ${ev.panelsUnread.length === 1 ? 'it' : 'them'}. Add the circuits in Labor & Pricing (then confirm here with a reason), or re-run the analysis.`,
      actions: ['confirm'],
      fingerprint: `panels-unread|${ev.panelsUnread.join('|')}`,
    });
  }
  // Evidence round 3.1 — a panel schedule the reader could not transcribe
  // completely: its quantities are still used, the gap is shown.
  for (const tbl of ev?.tables ?? []) {
    if (!tbl.warnings.length) continue;
    items.push({
      id: `schedule:${tbl.id}`,
      kind: 'confirm',
      blocking: false,
      title: `Schedule read incompletely: ${tbl.title} (${tbl.sheetLabel})`,
      detail: `${tbl.warnings.join(' ')} Quantities taken from this table may be short — check it on the sheet.`,
      actions: ['confirm'],
      fingerprint: `schedule|${tbl.warnings.join('|')}`,
    });
  }
  // Next round A7 — a type counted only on the photometric sheet (the
  // fallback, A3): shown for information, never blocking.
  for (const t of countResult?.types ?? []) {
    if (t.status === 'counted' && t.photometricOnly) {
      items.push({
        id: `photo:${t.key}`, kind: 'count', blocking: false,
        title: `Type ${t.type}${t.description ? ` — ${t.description}` : ''}: counted from the photometric sheet`,
        detail: `Not shown on the electrical plans; ${t.count} counted on ${t.sheets.filter(x => x.used).map(x => x.label).join(', ')}. Check it if the site plan should show it.`,
        typeKey: t.key, type: t.type, category: t.category, aiCount: t.count, actions: ['count', 'not_on_job'],
        fingerprint: `photo|${t.count}`,
      });
    }
  }
  for (const q of scopeQuestions) {
    items.push({
      ...(q.suggested ? { suggested: q.suggested } : {}),
      id: `scope:${q.term}`,
      kind: 'scope_question',
      title: q.label,
      detail: q.question,
      term: q.term,
      question: q.question,
      options: q.options,
      ...(q.optionParties ? { optionParties: q.optionParties } : {}),
      notes: q.notes,
      actions: ['answer'],
      fingerprint: `scope|${q.options.join('|')}|${q.notes.join('|')}`,
    });
  }
  // 4.6 — facility punch lists (fuel/c-store, car wash, storage, prototype
  // retail), on the same queue, always non-blocking. Independent of the
  // counting/evidence stage (it's about the project type, not the drawings),
  // so — unlike grouping and $ risk ordering below — it is never gated on
  // whether the evidence round ran.
  for (const c of facilityChecklistItems(opts.projectType)) {
    items.push({
      id: `checklist:${c.kind}:${c.id}`,
      kind: 'confirm',
      blocking: false,
      title: c.text,
      detail: `${c.kind.replace(/_/g, ' ')} checklist — not evidence-driven; check it against the drawings.`,
      actions: ['confirm'],
      fingerprint: `checklist|${c.kind}|${c.id}`,
    });
  }
  // Evidence round 4.5 — grouping and $ risk ordering are switched by the
  // SAME `evidence` input as Parts 1-3 (countingStage's own rule): without
  // it, the rest of this function behaves exactly as it did before Part 4,
  // byte for byte — a run that never went through the evidence round is
  // never reshuffled or re-grouped by it.
  if (!countResult?.evidence) return items.map(i => ({ ...i, group: groupOf(i) }));
  const grouped = groupLegendZeroItems(items, countResult);
  return sortByRisk(grouped).map(i => ({ ...i, group: groupOf(i) }));
}

/** Evidence round 4.5 — legend-only zero-count types with no plan presence
 *  at all (never found on any counted sheet) AND no independent schedule
 *  row of their own are combined into ONE "confirm none of these" item,
 *  instead of one review item apiece. Nothing is dropped: every member is
 *  still listed (in `groupedTypes`), and resolving the group with a reason
 *  marks every member not on this job — the same outcome as resolving each
 *  one, in one motion. A single qualifying item is left alone (grouping one
 *  item saves nothing). */
export function groupLegendZeroItems(items: ReviewItem[], countResult: CountResult | null): ReviewItem[] {
  const typeByKey = new Map((countResult?.types ?? []).map(t => [t.key, t]));
  const isGroupable = (i: ReviewItem): boolean => {
    if (i.kind !== 'count' || !i.id.startsWith('count:') || i.id.endsWith(':heads') || i.blocking === false) return false;
    const t = typeByKey.get(i.typeKey ?? '');
    return !!t && t.status === 'zero' && t.reason === 'not found on any counted plan sheet' && (t.scheduleRows?.length ?? 0) === 0;
  };
  const members = items.filter(isGroupable);
  if (members.length < 2) return items;
  const memberIds = new Set(members.map(m => m.id));
  const rest = items.filter(i => !memberIds.has(i.id));
  const groupedTypes = members.map(m => ({ key: m.typeKey!, type: m.type!, description: m.description ?? '' })).sort((a, b) => a.type.localeCompare(b.type));
  const keySlug = groupedTypes.map(g => g.key).sort().join('|');
  const n = groupedTypes.length;
  const group: ReviewItem = {
    id: `legend-zero:${slug(keySlug)}`,
    kind: 'count',
    title: `${n} legend items not found on any counted sheet — confirm none on this job`,
    detail: `${groupedTypes.map(g => `${g.type}${g.description ? ` — ${g.description}` : ''}`).join('; ')}. None of these were found on any sheet the analysis counted, and none has its own schedule row — confirm none of them are on this job (one reason covers all), or resolve one alone by entering a count, placing/confirming markers, or re-running the analysis after adding it as a fixture type.`,
    groupedTypes,
    actions: ['not_on_job'],
    fingerprint: `legend-zero|${keySlug}`,
  };
  return [...rest, group];
}

/** Evidence round 4.5 — $ risk ordering: equipment, then poles, then
 *  fixture-family / typical-multiplier mismatches (often many devices at
 *  once), then wet/hazard-location devices, then everything else
 *  (commodity devices and admin/structural items last). A stable sort:
 *  items of the same tier keep their original relative order. */
export function riskRank(i: ReviewItem): number {
  if (i.id.startsWith('counting:')) return -20;
  if (i.id.startsWith('sheet:') || i.id.startsWith('file:') || i.id.startsWith('refsheet:')) return -15;
  if (i.category === 'equipment') return 0;
  if (i.category === 'site_lighting' || i.category === 'exterior_building') return 5;
  if (i.id.startsWith('family:')) return 10;
  if (i.id.startsWith('typical:')) return 15;
  if (isHazardOrWetDescription(`${i.type ?? ''} ${i.description ?? ''}`)) return 25;
  if (i.category === 'device' || i.category === 'interior_lighting' || i.category === 'lighting_control' || i.category === 'panel_circuit') return 30;
  if (i.id.startsWith('legend-zero:')) return 33;
  if (i.id.startsWith('unscheduled:')) return 35;
  if (i.kind === 'scope_question') return 40;
  return 45;
}

const HAZARD_RE = /\bweatherproof\b|\bWP\b|\bGFCI\b|\bGFI\b|\bwet\b|\bhazardous?\b|\bexplosion[- ]?proof\b/i;
function isHazardOrWetDescription(s: string): boolean {
  return HAZARD_RE.test(s);
}

function sortByRisk(items: ReviewItem[]): ReviewItem[] {
  return items.map((it, i) => ({ it, i })).sort((a, b) => (riskRank(a.it) - riskRank(b.it)) || (a.i - b.i)).map(x => x.it);
}

/** Next round A7 — the cause an item is listed under (one group, one bulk
 *  action): 'zero', 'unreadable', 'area:<sheets>', 'coverage', 'heads',
 *  'unscheduled', 'scope', 'sheets', 'refsheets', 'counting', 'info'. */
export function groupOf(i: ReviewItem): string {
  if (i.blocking === false) return i.id.startsWith('photo:') ? 'photometric' : i.id.startsWith('schedule:') ? 'schedule' : i.id.startsWith('checklist:') ? 'checklist' : 'info';
  if (i.id.startsWith('legend-zero:')) return 'legend-zero';
  if (i.id.startsWith('schedule:')) return 'schedule';
  if (i.id.startsWith('viewport:')) return 'viewport';
  if (i.id.startsWith('typical:')) return 'typical';
  if (i.id.startsWith('family:')) return 'family';
  if (i.id.startsWith('counting:')) return 'counting';
  if (i.id.startsWith('refsheet:')) return 'refsheets';
  if (i.id.startsWith('sheet:') || i.id.startsWith('file:')) return 'sheets';
  if (i.id.startsWith('scope:')) return 'scope';
  if (i.id.startsWith('unscheduled:')) return 'unscheduled';
  if (i.id.startsWith('coverage:')) return 'coverage';
  if (i.id.startsWith('recount:')) return 'recount';
  if (i.id.endsWith(':heads')) return 'heads';
  if (i.kind === 'area') {
    const labels = (i.detail.split(' — ')[0] ?? '').split(' / ').map(x => x.replace(/\s+\d+$/, '').split(' ')[0]).filter(Boolean).sort();
    return `area:${labels.join(' / ')}`;
  }
  if (i.kind === 'count') return /^Could not be counted/.test(i.detail) ? 'unreadable' : 'zero';
  return 'other';
}

/** Next round A4 — the post-Agent-1 safety net: a sheet Agent 1 says the
 *  drawings reference (its `missingSheets`, after the hygiene dropped the
 *  ones actually loaded) that the sheet check did not already know about
 *  (as present, missing or skipped). One blocking item per sheet: upload it
 *  (the supplement pass), or confirm the takeoff doesn't need it (reason). */
export function referencedSheetItems(
  missingSheets: unknown,
  known: { loadedSheetKeys: Set<string>; checkRefKeys: Set<string> },
  normalize: (raw: string) => string | null,
): ReviewItem[] {
  const out: ReviewItem[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(missingSheets) ? missingSheets : []) {
    const text = typeof raw === 'string' ? raw : typeof (raw as { sheet?: unknown })?.sheet === 'string' ? String((raw as { sheet: string }).sheet) : '';
    const id = /([A-Za-z]{1,3}\s?[-.]?\s?\d{1,3}(?:\.\d{1,2})?[A-Za-z]?)/.exec(text)?.[1] ?? '';
    const key = id ? normalize(id) : null;
    if (!key || seen.has(key) || known.loadedSheetKeys.has(key) || known.checkRefKeys.has(key)) continue;
    seen.add(key);
    out.push({
      id: `refsheet:${key}`,
      kind: 'confirm',
      title: `Referenced sheet ${id.replace(/\s+/g, '')} not in analysis`,
      detail: `The drawing analysis found a reference to ${text.trim().slice(0, 160)}, which is not in the uploaded set and the sheet check did not flag. Upload it (it is analysed and counted into this run), or confirm the takeoff doesn't need it (with a reason).`,
      actions: ['confirm'],
      fingerprint: `refsheet|${key}`,
    });
  }
  return out;
}

/** A re-run rebuilds the list; any item with the same id that the estimator
 *  already resolved keeps that resolution (flagged carriedOver) — but only
 *  when the item was built from the same evidence (N4: its fingerprint). When
 *  the drawings or counts changed, the earlier answer is shown as
 *  `previousResolution` and the item is open again for re-confirmation.
 *  Resolutions for items that no longer exist are dropped. A carried-over
 *  scope answer is kept only if it is still a valid option. */
export function carryOverResolutions(fresh: ReviewItem[], previous: ReviewItem[] | null | undefined): ReviewItem[] {
  const prev = new Map((previous ?? []).filter(p => p.resolution).map(p => [p.id, p]));
  return fresh.map(i => {
    const p = prev.get(i.id);
    if (!p) return i;
    const r = p.resolution!;
    if ((i.kind === 'scope_question' || i.kind === 'area') && r.action === 'answer' && !(i.options ?? []).includes(r.answer ?? '')) {
      return { ...i, previousResolution: r };
    }
    if (p.fingerprint !== undefined && i.fingerprint !== undefined && p.fingerprint !== i.fingerprint) {
      return { ...i, previousResolution: r };
    }
    return { ...i, resolution: { ...r, carriedOver: true } };
  });
}

export interface ResolveInput {
  action: ResolutionAction;
  qty?: unknown;
  reason?: unknown;
  answer?: unknown;
  /** Next round A7 — bulk 'answer': each item's own option at this index
   *  (e.g. every "same area?" question in a group: 0 = keep, 1 = sum). */
  answerIndex?: unknown;
  /** Next round A7 — bulk 'answer': each item's pre-filled answer. */
  useSuggested?: unknown;
}

/** Next round A7 — the per-item input of a bulk resolution. */
export function perItemInput(item: ReviewItem, input: ResolveInput): ResolveInput | { error: string } {
  if (input.action !== 'answer') return input;
  if (input.useSuggested === true) {
    if (!item.suggested) return { error: `${item.title} has no pre-filled answer.` };
    return { ...input, answer: item.suggested };
  }
  if (input.answerIndex !== undefined && input.answerIndex !== null) {
    const idx = Number(input.answerIndex);
    const opt = Number.isInteger(idx) ? item.options?.[idx] : undefined;
    if (opt === undefined) return { error: `${item.title}: no option ${String(input.answerIndex)}.` };
    return { ...input, answer: opt };
  }
  return input;
}

export type ResolveCheck =
  | { ok: true; resolution: Omit<ReviewResolution, 'by' | 'at'> }
  | { ok: false; error: string };

/** N6 — a reason is a real explanation: 10+ characters with a word in it. */
export function isRealReason(reason: string): boolean {
  return reason.trim().length >= 10 && /[A-Za-z]{3,}/.test(reason);
}

/** Validates a resolution against its item. `markerCount` is the number of
 *  CONFIRMED markers for the type on the sheets it is counted from (computed
 *  by the route) — only used for action 'markers'. */
export function validateResolution(item: ReviewItem, input: ResolveInput, markerCount: number | null): ResolveCheck {
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  const allowed = item.actions ?? (item.kind === 'scope_question' ? ['answer'] : ['count', 'markers', 'not_on_job']);
  if (!allowed.includes(input.action)) {
    if (item.kind === 'scope_question') return { ok: false, error: 'A scope question is answered by choosing one of its options.' };
    return { ok: false, error: `This item is resolved by: ${allowed.join(', ')}.` };
  }
  if (input.action === 'answer') {
    const answer = typeof input.answer === 'string' ? input.answer.trim() : '';
    const idx = (item.options ?? []).indexOf(answer);
    if (idx < 0) return { ok: false, error: `Choose one of: ${(item.options ?? []).join(', ')}.` };
    if (item.kind === 'area') {
      const qty = answer === item.options![0] ? item.keepQty : item.sumQty;
      return { ok: true, resolution: { action: 'answer', answer, qty, ...(reason ? { reason } : {}) } };
    }
    const parties = item.optionParties?.[idx];
    return { ok: true, resolution: { action: 'answer', answer, ...(parties ? { furnishBy: parties.furnishBy, installBy: parties.installBy } : {}), ...(reason ? { reason } : {}) } };
  }
  switch (input.action) {
    case 'count': {
      const qty = typeof input.qty === 'number' ? input.qty : Number(input.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 100_000) {
        return { ok: false, error: 'Enter a whole-number count of at least 1 (use "Not on this job" if there are none).' };
      }
      return { ok: true, resolution: { action: 'count', qty, ...(reason ? { reason } : {}) } };
    }
    case 'markers': {
      if (!markerCount || markerCount < 1) {
        return { ok: false, error: 'No confirmed markers for this type on the sheets it is counted from — confirm or place them in the Plans view first.' };
      }
      return { ok: true, resolution: { action: 'markers', qty: markerCount } };
    }
    case 'not_on_job': {
      if (!isRealReason(reason)) return { ok: false, error: 'Say why this is not on this job (at least 10 characters).' };
      return { ok: true, resolution: { action: 'not_on_job', reason } };
    }
    case 'confirm': {
      if (!isRealReason(reason)) return { ok: false, error: 'Give the reason you are confirming this (at least 10 characters).' };
      return { ok: true, resolution: { action: 'confirm', reason, ...(item.aiCount != null && item.kind === 'count' ? { qty: item.aiCount } : {}) } };
    }
    default:
      return { ok: false, error: 'Unknown action.' };
  }
}

/** Fix round 1 / B1 — the quantities the GC documents MUST carry, decided by
 *  the counter and the estimator. Keyed by count type key; `null` = not on
 *  this job (the line must not appear). Poles' heads under `<KEY>:heads`.
 *  Unscheduled rows resolved with a count are returned separately. */
export interface EnforcedCounts {
  byType: Map<string, number | null>;
  extraLines: Array<{ category: string; item: string; qty: number }>;
}

export function enforcedCounts(countResult: CountResult | null, items: ReviewItem[] | null | undefined): EnforcedCounts {
  const byType = new Map<string, number | null>();
  const extraLines: EnforcedCounts['extraLines'] = [];
  const list = items ?? [];
  const res = (id: string) => list.find(i => i.id === id)?.resolution;
  for (const t of countResult?.types ?? []) {
    if (t.host || t.status === 'merged') continue;
    let qty: number | null | undefined;
    const direct = res(`count:${t.key}`);
    if (t.status === 'counted') qty = t.count;
    if (direct) qty = direct.action === 'not_on_job' ? null : (direct.qty ?? qty);
    const area = res(`area:${t.key}`);
    if (area) qty = area.qty ?? qty;
    const vq = res(`viewport:${t.key}`);
    if (vq) qty = vq.qty ?? qty;
    const cov = res(`coverage:${t.key}`);
    if (cov) qty = cov.action === 'not_on_job' ? null : (cov.qty ?? qty);
    const rec = res(`recount:${t.key}`);
    if (rec) qty = rec.qty ?? qty;
    if (qty !== undefined && (qty === null || qty > 0)) byType.set(t.key, qty);
    if (t.category === 'site_lighting') {
      const heads = res(`count:${t.key}:heads`);
      if (heads) byType.set(`${t.key}:heads`, heads.action === 'not_on_job' ? null : (heads.qty ?? null));
      else if (t.heads != null && t.status === 'counted') byType.set(`${t.key}:heads`, t.heads);
    }
  }
  // Evidence round 2.2 — a resolved typical host count adds per-host x count
  // of each device type (on top of what was drawn).
  for (const i of list) {
    if (!i.id.startsWith('typical:') || !i.resolution || i.resolution.action !== 'count') continue;
    for (const d of i.typicalDevices ?? []) {
      const cur = byType.get(d.key);
      if (cur === null) continue; // the type itself is not on this job
      byType.set(d.key, (cur ?? 0) + d.perHost * (i.resolution.qty ?? 0));
    }
  }
  // Evidence round 3.3 — "use the other schedule's count" for a family.
  for (const i of list) {
    if (!i.id.startsWith('family:') || !i.resolution || i.resolution.action !== 'answer') continue;
    const prim = i.familyPrimary ?? [];
    if (i.resolution.qty === i.keepQty || prim.length !== 1) continue;
    byType.set(prim[0], i.resolution.qty ?? null);
  }
  for (const i of list) {
    if (!i.id.startsWith('unscheduled:') || !i.resolution || i.resolution.action !== 'count') continue;
    extraLines.push({ category: i.category ?? 'Interior Lighting', item: i.rowItem ?? i.title, qty: i.resolution.qty! });
  }
  // Evidence round 4.5 — "confirm none of these" on a grouped legend-zero
  // item zeroes every member it lists, the same as resolving each alone.
  for (const i of list) {
    if (!i.id.startsWith('legend-zero:') || !i.resolution || i.resolution.action !== 'not_on_job') continue;
    for (const m of i.groupedTypes ?? []) byType.set(m.key, null);
  }
  return { byType, extraLines };
}

/** The block Agent 4 receives, authoritative over Agent 1/2 for these items. */
export function reviewResolutionsForAgent4(items: ReviewItem[] | null | undefined): string | null {
  const resolved = (items ?? []).filter(i => i.resolution);
  if (!resolved.length) return null;
  const lines = resolved.map(i => {
    const r = i.resolution!;
    if (i.kind === 'scope_question') {
      return r.furnishBy ? `- ${i.title}: furnished by ${r.furnishBy}, installed by ${r.installBy}.` : `- ${i.title}: ${r.answer}`;
    }
    if (i.kind === 'confirm') return `- ${i.title}: confirmed by the estimator (${r.reason}).`;
    if (r.action === 'not_on_job') return `- ${i.title}: NOT ON THIS JOB — omit it from the takeoff and scope.`;
    if (i.kind === 'area') return `- ${i.title.replace(/: same area or different areas\?$/, '')}: ${r.qty} EA (${r.answer}).`;
    if (r.action === 'confirm') return `- ${i.title}: ${r.qty ?? i.aiCount} EA (confirmed by the estimator).`;
    return `- ${i.title}: ${r.qty} EA (${r.action === 'markers' ? 'confirmed on the plans' : 'counted by the estimator'}).`;
  });
  return `--- ESTIMATOR-RESOLVED TAKEOFF REVIEW (AUTHORITATIVE) ---\nThese override the drawing analysis and scope for the items named. Use these quantities and answers exactly.\n${lines.join('\n')}`;
}
