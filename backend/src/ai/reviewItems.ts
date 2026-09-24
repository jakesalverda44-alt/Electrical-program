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
import type { CountResult, CountMark } from './countingStage';
import { outsideAptInstall, describeAssignment } from '../bidstd/tradeAssignment';
import { facilityChecklistItems } from '../bidstd/facilityChecklists';
import { PANEL_CONFLICT, PANEL_LOAD_NOTE, panelNameOf, type PanelChoice } from './evidence/schedules';
import { KNOWN_SHEET_PREFIXES, matchesSheetPattern, type SheetPattern } from './sheetRefs';

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
  /** Fix round 4 / B13, N9 — a site-lighting (heads) member: the POLE count
   *  this answer sets, when it sets one. */
  poles?: number;
  /** Fix round 4 / B13, N9 — the answer is half done: the other number is
   *  still needed ('heads' after a pole-marker tally with unknown heads per
   *  pole; 'poles' after a heads answer the poles can't be derived from).
   *  The member stays open (blocking) until it is entered. */
  needs?: 'heads' | 'poles';
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
  /** Fix round 4 / S20 — a panel-conflict item: what each answer changes. */
  panelChoice?: PanelChoice;
  /** Evidence round 3.3 — a family item: the primary type keys whose total
   *  the answer replaces. */
  familyPrimary?: string[];
  /** Evidence round 4.5 — a grouped item: legend-only zero-count types with
   *  no plan presence and no schedule row, combined into ONE list. Fix
   *  round B6 — each member carries its OWN resolution (not on job / a
   *  count / confirmed markers); the group itself resolves only once every
   *  member has one (see applyGroupMemberResolution). */
  groupedTypes?: Array<{ key: string; type: string; description: string; resolution?: ReviewResolution }>;
  /** Fix round 3 / B10, B11 — a gap-fill/reconcile item's own types, ONE per
   *  type the finding covers (never fewer than 1). Each answers separately
   *  — a single number is never broadcast across several types (B11). The
   *  item's own top-level `resolution` mirrors the single member's when
   *  there is exactly one; for 2+, it is set only once every member has
   *  answered (see applyReconcileMemberResolution). */
  reconcileMembers?: Array<{
    key: string; type: string; description: string;
    /** The finding's own basis for this member: 'heads' for a site_lighting
     *  type (2.2/B2 already compare heads for these, never poles); 'count'
     *  otherwise. An entered/confirmed number is always in THIS unit. */
    unit: 'heads' | 'count';
    /** The member's current value, in `unit` — what "No more on this job —
     *  keep current count N" keeps. */
    currentQty: number;
    /** From the fixture schedule, when it states one. Only meaningful when
     *  unit is 'heads': poles are re-derived from a corrected heads answer
     *  ONLY when this is known (an exact multiple); when it's null, poles
     *  stay exactly as directly counted from the plans — never guessed. */
    headsPerPole: number | null;
    resolution?: ReviewResolution;
  }>;
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
    // Real-run fix 2 — a generic legend symbol drawn where another entity's
    // marks are: the same device under two names? Never merged silently.
    if (t.status === 'counted' && t.synonymQuestion) {
      const q = t.synonymQuestion;
      const names = q.candidates.map(k => (countResult?.types ?? []).find(x => x.key === k)?.type ?? k).join(' / ');
      items.push({
        id: `synonym:${t.key}`,
        kind: 'area',
        title: `${title}: the same device as ${names}?`,
        detail: `${q.coincident} of the ${q.count} ${t.type} marks sit where ${names} marks are. Different devices (keep ${t.count} ${t.type}), or ${t.type} is another name for ${names} (drop the ${t.type} line — ${names} keep their own counts)?`,
        options: [`Different devices — keep ${t.count}`, `The same device — drop ${t.type}`],
        keepQty: t.count,
        sumQty: 0,
        actions: ['answer'],
        ...base,
        fingerprint: `synonym|${q.coincident}|${t.count}`,
      });
    }
    // Fix round 3 / S17 — the schedule rows allow two quantities.
    if (t.status === 'counted' && t.scheduleQuestion) {
      const q = t.scheduleQuestion;
      items.push({
        id: `schedqty:${t.key}`,
        kind: 'area',
        title: `${title}: how many does the schedule mean?`,
        detail: `${q.reason} (${(t.scheduleRows ?? []).map(r => `${r.table} ${r.cells.slice(0, 3).filter(Boolean).join(' ')}`).slice(0, 6).join('; ')})`,
        options: [`${q.keep} in all`, `${q.add} in all`],
        keepQty: q.keep,
        sumQty: q.add,
        actions: ['answer', 'count'],
        ...base,
        fingerprint: `schedqty|${q.keep}|${q.add}`,
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
  // Fix round S3 — a device drawn at a host's position on ANOTHER sheet of
  // the level: the host's own outlet drawn twice, or a different device
  // there? Expanded as a separate device for now; the answer is enforced.
  for (const e of ev?.expansions ?? []) {
    if (e.status !== 'expanded' || !e.possibleAtHosts) continue;
    const t = (countResult?.types ?? []).find(x => x.key === e.deviceKey);
    if (!t || t.status !== 'counted') continue;
    const k = e.possibleAtHosts;
    items.push({
      id: `typicalat:${e.packageId}:${e.deviceKey}`,
      kind: 'area',
      title: `${t.type} at the ${e.host.toLowerCase()}: the same outlet on two sheets?`,
      detail: `${e.viewportLabel || 'The legend'} puts ${e.perHost} ${t.type} on each ${e.host.toLowerCase()}, and another sheet draws ${k} ${t.type} at the same place. The pole's own outlet drawn twice (count ${t.count - k}), or a different device there (${t.count})?`,
      options: [`Different devices — ${t.count}`, `The same outlet — ${t.count - k}`],
      keepQty: t.count,
      sumQty: t.count - k,
      typicalDevices: [{ key: e.deviceKey, perHost: -k }],
      actions: ['answer'],
      fingerprint: `typicalat|${e.deviceKey}|${k}|${t.count}`,
    });
  }
  // Fix round S2 — the legend names a device at each host but not how many:
  // never guessed. Blocking when none is drawn near a host (the estimator
  // enters the TOTAL of that device at the hosts); information when some are
  // drawn there (they are counted where drawn).
  for (const e of ev?.expansions ?? []) {
    if (e.status !== 'qty_unstated') continue;
    const typeName = (countResult?.types ?? []).find(t => t.key === e.deviceKey)?.type ?? e.deviceKey;
    const drawn = e.drawnAtHosts > 0;
    items.push({
      id: `typicalqty:${e.packageId}:${e.deviceKey}`,
      kind: 'count',
      ...(drawn ? { blocking: false } : {}),
      title: `Typical: ${e.host} — how many ${e.deviceText.toLowerCase()}?`,
      detail: `${e.viewportLabel || 'The legend'} says each ${e.host.toLowerCase()} has ${e.deviceText.toLowerCase()} but not how many ("${e.quote.slice(0, 160)}"). ${drawn ? `${e.drawnAtHosts} ${typeName} are drawn near the ${e.host.toLowerCase()}${(e.hostCount ?? 0) === 1 ? '' : 's'} and are counted where drawn — check none is missing.` : `None is drawn near one. Enter how many ${typeName} there are at the ${e.host.toLowerCase()}s in all (added to ${typeName}), or mark it not on this job.`}`,
      typicalDevices: [{ key: e.deviceKey, perHost: 1 }],
      actions: ['count', 'not_on_job'],
      fingerprint: `typicalqty|${e.deviceKey}|${e.drawnAtHosts}|${e.hostCount ?? ''}`,
    });
  }
  // Real-run fix 6 — a note's "typical" fixtures per SITE POLE ("parking lot
  // site lights typically have two 209W fixtures per pole") restates the
  // site family's heads, which its schedule already states per type (S1 1,
  // S2 2): the schedule is used and the note is shown, not blocking. Only
  // when every counted site type has its heads from the schedule.
  const siteCounted = (countResult?.types ?? []).filter(t => t.category === 'site_lighting' && t.status === 'counted' && t.count > 0);
  const siteHeadsKnown = siteCounted.length > 0 && siteCounted.every(t => t.heads != null);
  for (const [i, u] of (ev?.unmappedTypical ?? []).entries()) {
    if (siteHeadsKnown && /\b(site|parking|area)\b[^.]*\bpoles?\b|\bpoles?\b[^.]*\b(site|parking|area)\b/i.test(u.host)
      && /\b(fixtures?|luminaires?|heads?|lights?|\d+\s*W)\b/i.test(u.text)) {
      const heads = siteCounted.reduce((n, t) => n + (t.heads ?? 0), 0);
      items.push({
        id: `typicalheads:${slug(`${u.host} ${u.text}`)}`,
        kind: 'confirm',
        blocking: false,
        title: `Note: ${u.qty} × ${u.text} per ${u.host.toLowerCase()} — the fixture schedule's heads are used`,
        detail: `"${u.quote.slice(0, 160)}" — a general note. The fixture schedule states the heads per pole for each site type (${siteCounted.map(t => `${t.type} ${t.count} pole${t.count === 1 ? '' : 's'}, ${t.heads} head${t.heads === 1 ? '' : 's'}`).join('; ')} = ${heads} heads), and that is what the takeoff carries. Check the site plan if the note should override it.`,
        actions: ['confirm'],
        fingerprint: `typicalheads|${u.qty}|${heads}`,
      });
      continue;
    }
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
  // Fix round (review a479103, B2; fix round 3 / B10, B11) — every
  // reconciliation finding reaches the estimator, one way or the other:
  //   * an UNDER finding gap-fill found candidates for -> `gapfill:<type>`;
  //   * anything else (an UNDER finding with nothing found, or an OVER
  //     finding — gap-fill has nothing to search FOR on an over-count) ->
  //     `reconcile:<type>`, shown with both sides. An over-count is
  //     informational only: the plans are not wrong just because a
  //     schedule cell disagrees.
  // B10 — neither item ever offers "not on this job": the finding is about
  // a SECOND SOURCE disagreeing with the plans, never a reason the type
  // itself isn't on the job. Their actions are exactly:
  //   * 'markers'  — "Confirm the found marks on the plans" (gap-fill only:
  //     a jump to its own SUGGESTED markers in the Plans view, then "Use
  //     confirmed markers" here);
  //   * 'confirm'  — "No more on this job — keep current count N": rejects
  //     the suggestion/mismatch, keeps the type's CURRENT count exactly (for
  //     a gap-fill item, this also drops its own suggested markers — S18's
  //     est_markups source='gap_fill'/status='suggested' rows for this type
  //     — so a rejected suggestion never lingers to be confirmed later);
  //   * 'count'    — "Enter correct count", one field per type (B11): never
  //     a single number broadcast across every type a finding covers.
  // B11 — the unit an answer is IN follows the finding's own basis: heads
  // for a site_lighting type (the same basis reconcile() itself compares,
  // B2's actualUnitsOf), plain count otherwise. Poles are directly counted
  // from the plans; a heads answer only ever re-derives them when the
  // fixture schedule states heads-per-pole (an exact multiple) — when it
  // doesn't, poles are left exactly as counted, never guessed from heads.
  if (ev?.gapFill) {
    const typeByKey = new Map((countResult?.types ?? []).map(t => [t.key, t]));
    const suggestedByType = new Map<string, NonNullable<typeof ev.gapFill>['suggested']>();
    for (const s of ev.gapFill.suggested) {
      if (!suggestedByType.has(s.typeKey)) suggestedByType.set(s.typeKey, []);
      suggestedByType.get(s.typeKey)!.push(s);
    }
    const membersOf = (keys: string[]): NonNullable<ReviewItem['reconcileMembers']> => keys.map(k => {
      const t = typeByKey.get(k);
      const tgt = targetByKey.get(k);
      const heads = t?.category === 'site_lighting';
      return {
        key: k, type: t?.type ?? k, description: t?.description ?? '',
        unit: heads ? 'heads' as const : 'count' as const,
        currentQty: heads ? (t?.heads ?? 0) : (t?.count ?? 0),
        headsPerPole: heads ? (tgt?.headsPerPole ?? null) : null,
      };
    });
    for (const f of ev.gapFill.findings) {
      const keys = f.typeKey.split('+');
      const label = keys.map(k => typeByKey.get(k)?.type ?? k).join('/');
      const relevant = keys.flatMap(k => suggestedByType.get(k) ?? []);
      const members = membersOf(keys);
      const perType = members.length > 1
        ? ` Answer each type separately — ${members.map(m => `${m.type} (currently ${m.currentQty} ${m.unit})`).join(', ')}.`
        : '';
      if (f.direction === 'under' && relevant.length) {
        items.push({
          id: `gapfill:${f.typeKey}`,
          kind: 'count',
          title: `Gap-fill found ${relevant.length} possible ${label} — confirm on plans`,
          detail: `${f.reason} A targeted re-search suggested ${relevant.length} mark${relevant.length === 1 ? '' : 's'} on the plans (Plans view, shown as SUGGESTED).${perType} Confirm the found marks on the plans, answer "No more on this job" to keep the current count, or enter the correct count — nothing here is counted until you do.`,
          typeKey: keys.length === 1 ? keys[0] : f.typeKey,
          type: label,
          actions: ['markers', 'confirm', 'count'],
          reconcileMembers: members,
          fingerprint: `gapfill|${f.expected}|${f.actual}|${relevant.length}`,
        });
        continue;
      }
      items.push({
        id: `reconcile:${f.typeKey}`,
        kind: 'confirm',
        blocking: f.direction === 'under',
        title: `${f.direction === 'under' ? 'Possible shortfall' : 'Possible over-count'}: ${label} vs ${f.source}`,
        detail: `${f.reason}${f.direction === 'under' ? ' A targeted re-search found nothing more on the plans.' : ' The plans show more than the second source.'}${perType} Answer "No more on this job" to keep the current count, or enter the correct count.`,
        typeKey: keys.length === 1 ? keys[0] : undefined,
        type: label,
        actions: ['confirm', 'count'],
        reconcileMembers: members,
        fingerprint: `reconcile|${f.expected}|${f.actual}|${f.direction}`,
      });
    }
  }
  // Real-run fix 5 / review fix B1 — the dense-sheet consistency pass. It
  // NEVER lowers a count: pass 1's marks stay counted. Marks only pass 2
  // found are SUGGESTED (Plans view) — possible additions; pass-1 marks
  // pass 2 did not re-find are listed. One item for the check, answered
  // type by type: "keep the counted number" keeps pass 1's; "confirm the
  // found marks" ADDS the confirmed suggestions; or enter the count.
  // Blocking when there is something to confirm or the passes agree under
  // 85%.
  if (ev?.consistency && (ev.consistency.suggested.length || ev.consistency.entries.some(e => e.lowAgreement))) {
    const cons = ev.consistency;
    const typeByKey = new Map((countResult?.types ?? []).map(t => [t.key, t]));
    const keys = [...new Set([...cons.suggested.map(s => s.typeKey), ...cons.entries.filter(e => e.lowAgreement).map(e => e.typeKey)])].sort();
    const per = keys.map(k => {
      const es = cons.entries.filter(e => e.typeKey === k);
      const sum = (f: (e: typeof es[number]) => number) => es.reduce((n, e) => n + f(e), 0);
      const first = sum(e => e.first), agreed = sum(e => e.agreed);
      return { k, t: typeByKey.get(k), first, second: sum(e => e.second), agreed, notReseen: sum(e => e.onlyFirst), suggested: cons.suggested.filter(x => x.typeKey === k).length, rate: first ? agreed / first : 1, low: es.some(e => e.lowAgreement) };
    });
    const n = cons.suggested.length;
    const low = per.filter(p => p.low);
    items.push({
      id: `consistency:${keys.join('+')}`,
      kind: 'count',
      title: low.length
        ? `Dense-sheet check: the two counting passes disagree on ${low.map(p => `Type ${p.t?.type ?? p.k}`).join(', ')} — check the count on the plans`
        : `Dense-sheet check: ${n} possible mark${n === 1 ? '' : 's'} the second counting pass found — confirm on plans`,
      detail: `${per.map(p => `Type ${p.t?.type ?? p.k}: counted ${p.first} (first pass); the second pass (shifted tiles) found ${p.second}, re-finding ${p.agreed} of the ${p.first} (${Math.round(p.rate * 100)}%)${p.notReseen ? `; ${p.notReseen} counted mark${p.notReseen === 1 ? '' : 's'} it did not re-find (still counted)` : ''}${p.suggested ? `; ${p.suggested} more it found (SUGGESTED, not counted)` : ''}`).join('; ')}. The first pass's count stands. Confirm the suggested marks on the plans (they are added to it), answer "keep the counted number", or enter the count.`,
      typeKey: keys.length === 1 ? keys[0] : undefined,
      type: per.map(p => p.t?.type ?? p.k).join('/'),
      actions: ['markers', 'confirm', 'count'],
      reconcileMembers: per.map(p => ({ key: p.k, type: p.t?.type ?? p.k, description: p.t?.description ?? '', unit: 'count' as const, currentQty: p.t?.count ?? 0, headsPerPole: null })),
      fingerprint: `consistency|${per.map(p => `${p.k}:${p.first}/${p.agreed}/${p.suggested}`).join(';')}`,
    });
  }
  // Review fix S8 — a consistency pass that was skipped (cap, failure,
  // truncation) is said, never silent; it never blocks.
  if (ev?.consistency?.warnings?.length) {
    items.push({
      id: 'consistency-skipped',
      kind: 'confirm',
      blocking: false,
      title: 'Dense-sheet check skipped on part of the set',
      detail: `${ev.consistency.warnings.join('; ')}. Those counts are the first pass's, unchecked.`,
      actions: ['confirm'],
      fingerprint: `consistency-skipped|${ev.consistency.warnings.join('|')}`,
    });
  }
  // Evidence round 3.4 — a panel schedule the viewport reader found but the
  // schedule reader could not read completely: its branch circuits have no
  // source (Agent 1 no longer states them).
  if (ev?.panelsUnread?.length) {
    items.push({
      id: 'schedule:panels-unread',
      kind: 'confirm',
      title: `Panel schedule${ev.panelsUnread.length === 1 ? '' : 's'} not read completely — branch circuits not verified`,
      detail: `${ev.panelsUnread.join('; ')} could not be read row by row completely, so ${ev.panelsUnread.length === 1 ? 'its' : 'their'} branch circuits stay as the drawing analysis read them (not replaced, not verified) and no equipment quantity is taken from ${ev.panelsUnread.length === 1 ? 'it' : 'them'}. Check the circuits in Labor & Pricing and confirm here with a reason, or re-run the analysis.`,
      actions: ['confirm'],
      fingerprint: `panels-unread|${ev.panelsUnread.join('|')}`,
    });
  }
  // Evidence round 3.1 — a panel schedule the reader could not transcribe
  // completely: its quantities are still used, the gap is shown.
  // Fix round 3 / B12 — two panels of one name with different content: both
  // are counted (two panels, or a revision?) — blocking until the estimator
  // confirms, one item per panel name.
  const conflictNames = new Set<string>();
  // Fix round 4 / S20 — ENFORCED answers: two panels (keep both), or the
  // same panel — use one copy (its schedule quantities; the other copies'
  // circuit lines removed).
  for (const ch of ev?.panelChoices ?? []) {
    conflictNames.add(ch.name);
    items.push({
      id: `panel-dup:${ch.identity}`,
      kind: 'confirm',
      title: `Panel ${ch.name} is read on ${ch.copies.length} sheets with different circuits — two panels or one?`,
      detail: `${ch.copies.map(c => `${c.sheetLabel} (${c.rows} rows)`).join('; ')}. Both are counted now (circuits and equipment summed). Choose: two panels (keep both), or the same panel (a revision) — use one sheet's copy; the other copy's circuits and equipment then leave the takeoff.`,
      options: ['Two panels — keep both', ...ch.copies.map(c => `Same panel — use ${c.sheetLabel}'s copy`)],
      panelChoice: ch,
      actions: ['answer'],
      fingerprint: `panel-dup|${ch.identity}|${ch.copies.map(c => `${c.sheetLabel}:${c.rows}`).join(';')}`,
    });
  }
  for (const tbl of ev?.tables ?? []) {
    if (tbl.kind !== 'panel' || !tbl.warnings.some(w => w.includes(PANEL_CONFLICT))) continue;
    const name = panelNameOf(tbl.title);
    if (conflictNames.has(name)) continue;
    conflictNames.add(name);
    const copies = (ev?.tables ?? []).filter(x => x.kind === 'panel' && panelNameOf(x.title) === name);
    items.push({
      id: `panel-dup:${name}`,
      kind: 'confirm',
      title: `Panel ${name} is read on ${copies.length} sheets with different content — two panels or one?`,
      detail: `${copies.map(c => `${c.sheetLabel} (${c.rows.length} rows)`).join('; ')}. Both are counted now (their circuits and equipment are summed). If they are the SAME panel (a revision), correct the circuits and equipment in Labor & Pricing, then confirm here with a reason; if they are two panels, confirm that.`,
      actions: ['confirm'],
      fingerprint: `panel-dup|${name}|${copies.map(c => `${c.sheetLabel}:${c.rows.length}`).join(';')}`,
    });
  }
  // Fix round 4 / S20 — the same panel read twice with a different load:
  // one copy used, a note (never blocking).
  for (const tbl of ev?.tables ?? []) {
    const notes = tbl.warnings.filter(w => w.includes(PANEL_LOAD_NOTE));
    if (!notes.length) continue;
    items.push({
      id: `panel-load:${tbl.id}`,
      kind: 'confirm',
      blocking: false,
      title: `Panel ${panelNameOf(tbl.title)}: a load reads differently on two sheets`,
      detail: `${notes.join(' ')} The same circuits and descriptions, so one panel — counted once.`,
      actions: ['confirm'],
      fingerprint: `panel-load|${notes.join('|')}`,
    });
  }
  const incomplete = (w: string) => !w.includes(PANEL_CONFLICT) && !w.includes(PANEL_LOAD_NOTE);
  for (const tbl of ev?.tables ?? []) {
    if (!tbl.warnings.filter(incomplete).length) continue;
    items.push({
      id: `schedule:${tbl.id}`,
      kind: 'confirm',
      blocking: false,
      title: `Schedule read incompletely: ${tbl.title} (${tbl.sheetLabel})`,
      detail: `${tbl.warnings.filter(incomplete).join(' ')} Quantities taken from this table may be short — check it on the sheet.`,
      actions: ['confirm'],
      fingerprint: `schedule|${tbl.warnings.filter(incomplete).join('|')}`,
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
  // Fix round S13 — a high auto-accepted count is exactly where a repeated
  // over- or under-count is easiest to miss (nobody reads 40 marks one by
  // one): a non-blocking spot-check samples a handful of this type's own
  // placed marks and asks the estimator to eyeball just those against the
  // plans, never the type's own count: (that stays open on its own terms).
  for (const t of spotCheckSamples(countResult)) {
    items.push({
      id: `spotcheck:${t.typeKey}`,
      kind: 'confirm',
      blocking: false,
      title: `Spot-check: confirm these ${t.sample.length} marks — Type ${t.type} (${t.total} auto-counted)`,
      detail: `A random sample of ${t.sample.length} of the ${t.total} marks the drawing analysis placed for ${t.type}${t.description ? ` (${t.description})` : ''}, on ${[...new Set(t.sample.map(m => m.sheetKey))].join(', ')}: open the Plans view and confirm each one is real (not a double count, not a stray mark). Informational only — it never changes the count on its own.`,
      actions: ['confirm'],
      fingerprint: `spotcheck|${t.typeKey}|${t.total}`,
    });
  }
  const grouped = groupLegendZeroItems(items, countResult);
  return sortByRisk(grouped).map(i => ({ ...i, group: groupOf(i) }));
}

/** Fix round S13 — a 5-10% QA sample (7.5% here, min 3) of a high auto-
 *  accepted count's own placed marks, one non-blocking review item per
 *  qualifying type. Deterministic (a stride across the type's OWN marks,
 *  sorted for stability) — a repeated run always samples the same marks
 *  for the same count, so the item's fingerprint is stable across re-runs. */
export const SPOTCHECK_MIN_COUNT = 20;
export const SPOTCHECK_RATE = 0.075;
export const SPOTCHECK_MIN_SAMPLE = 3;
export function spotCheckSamples(countResult: CountResult | null): Array<{ typeKey: string; type: string; description: string; total: number; sample: CountMark[] }> {
  const out: Array<{ typeKey: string; type: string; description: string; total: number; sample: CountMark[] }> = [];
  for (const t of countResult?.types ?? []) {
    if (t.host || t.status !== 'counted' || t.count < SPOTCHECK_MIN_COUNT) continue;
    const marks = (countResult?.marks ?? [])
      .filter(m => m.typeKey === t.key)
      .slice()
      .sort((a, b) => a.sheetKey.localeCompare(b.sheetKey) || a.x - b.x || a.y - b.y);
    if (!marks.length) continue;
    const n = Math.min(marks.length, Math.max(SPOTCHECK_MIN_SAMPLE, Math.round(marks.length * SPOTCHECK_RATE)));
    const stride = marks.length / n;
    const sample: CountMark[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < n; i++) {
      const idx = Math.min(marks.length - 1, Math.floor(i * stride));
      if (seen.has(idx)) continue;
      seen.add(idx);
      sample.push(marks[idx]);
    }
    out.push({ typeKey: t.key, type: t.type, description: t.description, total: t.count, sample });
  }
  return out;
}

const EQUIPMENT_KEYWORD_RE = /\bmeter\s*base\b|\bwireway\b|\bdiscon(?:nect)?\b|\bLCP\b|\bdata\s*concentrator\b|\bpanel(?:board)?\b/i;
const PHONE_BOARD_RE = /phone[\s-]?board/i;

/** Evidence round 4.5 — legend-only zero-count types with no plan presence
 *  at all (never found on any counted sheet) AND no independent schedule
 *  row of their own are combined into ONE list, instead of one review item
 *  apiece. Nothing is dropped: every member is still listed (in
 *  `groupedTypes`), and fix round B6 gives each one its own action —
 *  the group resolves only once every member has answered (see
 *  applyGroupMemberResolution). A single qualifying item is left alone
 *  (grouping one item saves nothing).
 *
 *  Fix round B6 — equipment (by category, an equipment-schedule/panel row,
 *  or an equipment keyword in its own name) and phone-board receptacle
 *  types are individual $-risk items, at their own tier, however many
 *  legend-zero entries otherwise qualify: they are NEVER folded into this
 *  group. */
export function groupLegendZeroItems(items: ReviewItem[], countResult: CountResult | null): ReviewItem[] {
  const typeByKey = new Map((countResult?.types ?? []).map(t => [t.key, t]));
  const isGroupable = (i: ReviewItem): boolean => {
    if (i.kind !== 'count' || !i.id.startsWith('count:') || i.id.endsWith(':heads') || i.blocking === false) return false;
    const t = typeByKey.get(i.typeKey ?? '');
    if (!t || t.status !== 'zero' || t.reason !== 'not found on any counted plan sheet' || (t.scheduleRows?.length ?? 0) !== 0) return false;
    const text = `${t.type} ${t.description}`;
    if (t.category === 'equipment' || EQUIPMENT_KEYWORD_RE.test(text)) return false;
    if (PHONE_BOARD_RE.test(text)) return false;
    return true;
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
    title: `${n} legend items not found on any counted sheet — answer each one`,
    detail: `${groupedTypes.map(g => `${g.type}${g.description ? ` — ${g.description}` : ''}`).join('; ')}. None of these were found on any sheet the analysis counted, and none has its own schedule row. Answer EACH one on its own: not on this job (with a reason), a count, or confirmed markers on the plans — the group stays open until every item has its own answer.`,
    groupedTypes,
    actions: ['count', 'markers', 'not_on_job'],
    fingerprint: `legend-zero|${keySlug}`,
  };
  return [...rest, group];
}

/** Fix round B6 — resolves ONE member of a legend-zero group (or, when
 *  `memberKey` is omitted, every member that doesn't have an answer yet —
 *  the "apply to all" shortcut, still one resolution recorded per member,
 *  never a single blanket flag). Returns the updated item; its own
 *  top-level `resolution` is set (so `reviewItemIsOpen` treats the group as
 *  resolved) only once every member has answered. */
export function applyGroupMemberResolution(
  item: ReviewItem,
  memberKey: string | undefined,
  resolution: Omit<ReviewResolution, 'by' | 'at'>,
  by: string,
): ReviewItem {
  const at = new Date().toISOString();
  const full: ReviewResolution = { ...resolution, by, at };
  const groupedTypes = (item.groupedTypes ?? []).map(m => (memberKey ? m.key === memberKey : !m.resolution) ? { ...m, resolution: full } : m);
  const allAnswered = groupedTypes.length > 0 && groupedTypes.every(m => m.resolution);
  return {
    ...item,
    groupedTypes,
    resolution: allAnswered ? { action: 'confirm', reason: 'every item in the group answered', by, at } : item.resolution,
  };
}

/** Fix round 3 / B10, B11 — resolves ONE type of a `gapfill:`/`reconcile:`
 *  finding (`memberKey` omitted only ever applies the SAME resolution to
 *  every member that has none yet — legal only for a 'confirm' reject,
 *  since that never needs a per-member number; the route layer refuses a
 *  'count'/'markers' broadcast across 2+ unresolved members with a 400).
 *  With exactly one member, the item's own top-level `resolution` mirrors
 *  it directly (unchanged shape from before B11); with 2+, that mirror
 *  only appears once every member has answered. */
/** Fix round 4 / B13, N9 — a site-lighting member answers in HEADS, but
 *  "Use confirmed markers" tallies POLE symbols. Pure: the member's
 *  resolution for a markers tally or an entered number.
 *    * markers tally T: poles = T; heads = T x heads-per-pole when the
 *      schedule states it, else the heads are still needed;
 *    * a number while heads are still needed -> the heads (poles kept);
 *    * a number while poles are still needed -> the poles (heads kept);
 *    * a heads number: poles = heads / heads-per-pole when that is exact,
 *      else the poles are still needed (never left silently as counted). */
export function headsMemberResolution(
  member: { headsPerPole: number | null; resolution?: ReviewResolution },
  resolution: Omit<ReviewResolution, 'by' | 'at'>,
): Omit<ReviewResolution, 'by' | 'at'> {
  const hpp = member.headsPerPole;
  const prior = member.resolution;
  const n = resolution.qty;
  if (resolution.action === 'markers' && n != null) {
    return hpp ? { ...resolution, poles: n, qty: n * hpp } : { ...resolution, poles: n, qty: undefined, needs: 'heads' };
  }
  if (resolution.action !== 'count' || n == null) return resolution;
  if (prior?.needs === 'heads' && prior.poles != null) return { ...resolution, poles: prior.poles, qty: n };
  if (prior?.needs === 'poles' && prior.qty != null) return { ...resolution, qty: prior.qty, poles: n };
  if (hpp && n % hpp === 0) return { ...resolution, qty: n, poles: n / hpp };
  return { ...resolution, qty: n, needs: 'poles' };
}

export function applyReconcileMemberResolution(
  item: ReviewItem,
  memberKey: string | undefined,
  resolution: Omit<ReviewResolution, 'by' | 'at'>,
  by: string,
): ReviewItem {
  const at = new Date().toISOString();
  // Fix round 4 / B13, N9 — a heads member's tally / number becomes poles
  // and heads (or asks for the missing one).
  const reconcileMembers = (item.reconcileMembers ?? []).map(m => {
    if (!(memberKey ? m.key === memberKey : !m.resolution || !!m.resolution.needs)) return m;
    const r = m.unit === 'heads' && resolution.action !== 'confirm' ? headsMemberResolution(m, resolution) : resolution;
    return { ...m, resolution: { ...r, by, at } as ReviewResolution };
  });
  const full: ReviewResolution = { ...resolution, by, at };
  const allAnswered = reconcileMembers.length > 0 && reconcileMembers.every(m => m.resolution && !m.resolution.needs);
  return {
    ...item,
    reconcileMembers,
    resolution: allAnswered
      ? (reconcileMembers.length === 1 ? full : { action: 'confirm', reason: 'every type in this finding answered', by, at })
      : item.resolution,
  };
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
  // Fix round 3 / B12 — a doubled panel moves circuits and equipment.
  if (i.id.startsWith('panel-dup:') || i.id.startsWith('schedqty:')) return 11;
  // Fix round (B2) — a real reconciliation shortfall (a second source vs
  // the plans) is a direct $ risk signal, ranked with the other schedule-
  // derived mismatches.
  if (i.id.startsWith('gapfill:') || i.id.startsWith('consistency:')) return 12;
  if (i.id.startsWith('reconcile:')) return 13;
  if (i.id.startsWith('synonym:')) return 14;
  if (i.id.startsWith('typical:') || i.id.startsWith('typicalqty:') || i.id.startsWith('typicalat:')) return 15;
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
  if (i.blocking === false) return i.id.startsWith('photo:') ? 'photometric' : (i.id.startsWith('schedule:') || i.id.startsWith('panel-load:')) ? 'schedule' : i.id.startsWith('checklist:') ? 'checklist' : i.id.startsWith('reconcile:') ? 'reconcile' : i.id.startsWith('spotcheck:') ? 'spotcheck' : 'info';
  if (i.id.startsWith('legend-zero:')) return 'legend-zero';
  if (i.id.startsWith('gapfill:')) return 'gapfill';
  if (i.id.startsWith('consistency:')) return 'consistency';
  if (i.id.startsWith('reconcile:')) return 'reconcile';
  if (i.id.startsWith('schedule:') || i.id.startsWith('panel-dup:') || i.id.startsWith('panel-load:') || i.id.startsWith('schedqty:')) return 'schedule';
  if (i.id.startsWith('viewport:')) return 'viewport';
  if (i.id.startsWith('typical:') || i.id.startsWith('typicalqty:') || i.id.startsWith('typicalat:') || i.id.startsWith('typicalheads:')) return 'typical';
  if (i.id.startsWith('family:')) return 'family';
  if (i.id.startsWith('synonym:')) return 'synonym';
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
  opts: { pattern?: SheetPattern | null } = {},
): ReviewItem[] {
  const out: ReviewItem[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(missingSheets) ? missingSheets : []) {
    const text = typeof raw === 'string' ? raw : typeof (raw as { sheet?: unknown })?.sheet === 'string' ? String((raw as { sheet: string }).sheet) : '';
    // Real-run fix 1 — every whole-token id candidate in the text, never a
    // piece of a word ("Spec 16050" is not "pec160", "Section 16480" not
    // "ion164"), never a spec-section number.
    for (const cand of sheetIdCandidates(text)) {
      const key = normalize(cand.id);
      if (!key || seen.has(key) || known.loadedSheetKeys.has(key) || known.checkRefKeys.has(key)) continue;
      // The same rule as the sheet check (B1): a missing id must have the
      // shape of THIS set's sheet numbers. One that doesn't ("SGN101 Sign
      // Vendor Foundation Drawing" in a set numbered E-1 / C1.1 / PH0.1) is
      // a vendor's or another party's drawing: listed for information,
      // never blocking.
      const ofThisSet = !opts.pattern || matchesSheetPattern(cand.id, opts.pattern);
      seen.add(key);
      out.push(ofThisSet ? {
        id: `refsheet:${key}`,
        kind: 'confirm',
        title: `Referenced sheet ${cand.id.replace(/\s+/g, '')} not in analysis`,
        detail: `The drawing analysis found a reference to ${text.trim().slice(0, 160)}, which is not in the uploaded set and the sheet check did not flag. Upload it (it is analysed and counted into this run), or confirm the takeoff doesn't need it (with a reason).`,
        actions: ['confirm'],
        fingerprint: `refsheet|${key}`,
      } : {
        id: `refsheet:${key}`,
        kind: 'confirm',
        blocking: false,
        title: `Drawing ${cand.id.replace(/\s+/g, '')} named — not a sheet number of this set`,
        detail: `The drawing analysis found a reference to ${text.trim().slice(0, 160)}. "${cand.id}" does not have the shape of this set's sheet numbers (${[...opts.pattern!.prefixes].sort().slice(0, 12).join(', ')}…), so it is read as another party's drawing (a vendor, sign or civil drawing), not a missing sheet of this set. Listed for information — upload it if it carries electrical scope.`,
        actions: ['confirm'],
        fingerprint: `refsheet-other|${key}`,
      });
    }
  }
  return out;
}

/** A CSI / MasterFormat spec-section number: 5-6 digits ("16050",
 *  "015000") or "xx xx xx" ("26 05 19"), optionally after SECTION / SEC /
 *  SPEC / DIVISION. Never a sheet. */
const SPEC_SECTION_RE = /\b(?:SPEC(?:IFICATION)?S?|SECTIONS?|SECT?\.?|DIV(?:ISION)?|CSI)\b\.?\s*(?:SECTION\s*)?#?\s*\d/i;
const SPEC_NUMBER_RE = /(?<![A-Za-z0-9])\d{2}\s\d{2}\s\d{2}(?![0-9])|(?<![A-Za-z0-9.])\d{5,6}(?![0-9])/;

/** Real-run fix 1 — the sheet-id candidates in one "missing sheet" string:
 *  whole tokens only (bounded by a non-letter / non-digit on both sides:
 *  never the tail of "Spec", "Section" or "Sec"), never a spec-section
 *  number or anything in a string that cites one ("Spec Section 16480
 *  Panelboards", "Structural drawings (referenced Sec 01410 3.09)"), and
 *  never a word that merely ends in digits' neighbours. */
export function sheetIdCandidates(text: string): Array<{ id: string; index: number }> {
  const out: Array<{ id: string; index: number }> = [];
  const re = /(?<![A-Za-z0-9])([A-Za-z]{1,3}(?:\s?[-.]\s?|\s)?\d{1,4}(?:\.\d{1,2})?[A-Za-z]?)(?![A-Za-z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const id = m[1];
    const digits = /\d+/.exec(id)?.[0] ?? '';
    // A 5-6 digit run is a specification section; "SEC 014" / "ION 164"
    // never reach here (not whole tokens: the digits run on).
    if (digits.length >= 5) continue;
    // The id is the section word of a spec citation ("SECTION 1", "DIV 16").
    if (SPEC_SECTION_RE.test(text.slice(m.index, m.index + id.length + 12))) continue;
    if (SPEC_NUMBER_RE.test(text.slice(m.index, m.index + id.length + 8))) continue;
    // A bare word followed by a space and a number ("Sheet 3", "Sec 3") is
    // only a sheet id when the letters are a real sheet prefix — the
    // pattern check (the caller) decides the rest.
    const prefix = /^[A-Za-z]+/.exec(id)?.[0].toUpperCase() ?? '';
    if (/\s/.test(id) && !/[-.]/.test(id) && !KNOWN_SHEET_PREFIXES.has(prefix)) continue;
    out.push({ id: id.replace(/\s+/g, ' ').trim(), index: m.index });
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
  /** Fix round B6 — which member of a legend-zero group this resolves;
   *  omitted resolves every member of the group that has no answer yet. */
  memberKey?: unknown;
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
  /** Fix round 4 / S20 — lines (exact item text) that must leave the
   *  takeoff: the circuit lines of a panel copy the estimator dropped. */
  removeLines?: string[];
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
    const sq = res(`schedqty:${t.key}`);
    if (sq) qty = sq.qty ?? qty;
    const cov = res(`coverage:${t.key}`);
    if (cov) qty = cov.action === 'not_on_job' ? null : (cov.qty ?? qty);
    const rec = res(`recount:${t.key}`);
    if (rec) qty = rec.qty ?? qty;
    // Real-run fix 2 — "the same device under another name": no line.
    const syn = res(`synonym:${t.key}`);
    if (syn?.action === 'answer' && syn.qty === 0) qty = null;
    if (qty !== undefined && (qty === null || qty > 0)) byType.set(t.key, qty);
    if (t.category === 'site_lighting') {
      const heads = res(`count:${t.key}:heads`);
      if (heads) byType.set(`${t.key}:heads`, heads.action === 'not_on_job' ? null : (heads.qty ?? null));
      else if (t.heads != null && t.status === 'counted') byType.set(`${t.key}:heads`, t.heads);
    }
  }
  // Fix round 3 / B10, B11 — each gap-fill/reconcile member answers in its
  // OWN unit (heads for site_lighting, count otherwise; B11) and never a
  // single number broadcast to a sibling. "No more on this job — keep
  // current count" ('confirm') leaves the member exactly as it already is
  // — no byType write, by design, never null. An entered/confirmed 'count'
  // (a real number, in the member's own unit) is the ONLY thing that ever
  // raises a gap-fill suggestion into a real count (B2), and the ONLY
  // place poles are ever re-derived from a heads answer — only when the
  // fixture schedule states heads-per-pole, and only as an exact multiple;
  // otherwise poles stay exactly as directly counted from the plans.
  for (const i of list) {
    if (!i.id.startsWith('gapfill:') && !i.id.startsWith('reconcile:') && !i.id.startsWith('consistency:')) continue;
    for (const m of i.reconcileMembers ?? []) {
      const r = m.resolution;
      if (!r || r.action === 'confirm') continue;
      if (m.unit === 'heads') {
        // Fix round 4 / B13, N9 — poles and heads each from the answer when
        // it gives them (a half-done answer keeps the item open/blocking).
        if (r.poles != null) byType.set(m.key, r.poles);
        if (r.qty != null) byType.set(`${m.key}:heads`, r.qty);
      } else if (r.qty != null) {
        byType.set(m.key, r.qty);
      }
    }
  }
  // Evidence round 2.2 — a resolved typical host count adds per-host x count
  // of each device type (on top of what was drawn).
  for (const i of list) {
    if (!(i.id.startsWith('typical:') || i.id.startsWith('typicalqty:')) || !i.resolution || i.resolution.action !== 'count') continue;
    for (const d of i.typicalDevices ?? []) {
      const cur = byType.get(d.key);
      if (cur === null) continue; // the type itself is not on this job
      byType.set(d.key, (cur ?? 0) + d.perHost * (i.resolution.qty ?? 0));
    }
  }
  // Fix round S3 — "the same outlet on two sheets": subtract.
  for (const i of list) {
    if (!i.id.startsWith('typicalat:') || !i.resolution || i.resolution.action !== 'answer') continue;
    if (i.resolution.answer !== i.options?.[1]) continue;
    for (const d of i.typicalDevices ?? []) {
      const cur = byType.get(d.key);
      if (cur == null) continue;
      byType.set(d.key, Math.max(0, cur + d.perHost));
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
  // Fix round B6 — each grouped legend-zero member carries its OWN
  // resolution now; applied individually (a member can be "not on job"
  // while a sibling is a real count), whether or not the group as a whole
  // has every member answered yet.
  for (const i of list) {
    if (!i.id.startsWith('legend-zero:')) continue;
    for (const m of i.groupedTypes ?? []) {
      if (!m.resolution) continue;
      byType.set(m.key, m.resolution.action === 'not_on_job' ? null : (m.resolution.qty ?? null));
    }
  }
  // Fix round 4 / S20 — "the same panel — use <sheet>'s copy": that copy's
  // schedule quantities, and the other copies' circuit lines removed.
  const removeLines: string[] = [];
  for (const i of list) {
    if (!i.id.startsWith('panel-dup:') || !i.panelChoice || i.resolution?.action !== 'answer') continue;
    const idx = (i.options ?? []).indexOf(i.resolution.answer ?? '') - 1;
    const choice = idx >= 0 ? i.panelChoice.useCopy[idx] : undefined;
    if (!choice) continue;
    for (const [k, q] of Object.entries(choice.typeQty)) byType.set(k, q);
    removeLines.push(...choice.removeLines);
  }
  return { byType, extraLines, ...(removeLines.length ? { removeLines } : {}) };
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
