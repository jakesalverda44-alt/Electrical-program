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
import { PANEL_CONFLICT, panelNameOf } from './evidence/schedules';

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
   *  no plan presence and no schedule row, combined into ONE list. Fix
   *  round B6 — each member carries its OWN resolution (not on job / a
   *  count / confirmed markers); the group itself resolves only once every
   *  member has one (see applyGroupMemberResolution). */
  groupedTypes?: Array<{ key: string; type: string; description: string; resolution?: ReviewResolution }>;
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
  // Fix round (review a479103, B2) — every reconciliation finding reaches
  // the estimator, one way or the other:
  //   * an UNDER finding gap-fill found candidates for -> `gapfill:<type>`,
  //     "N possible <type> — confirm on plans" (the estimator confirms the
  //     SUGGESTED markers in the Plans view, then resolves this with the
  //     same "Use confirmed markers" action any count item has);
  //   * anything else (an UNDER finding with nothing found, or an OVER
  //     finding — gap-fill has nothing to search FOR on an over-count) ->
  //     `reconcile:<type>`, shown with both sides. An over-count is
  //     informational only: the plans are not wrong just because a
  //     schedule cell disagrees.
  if (ev?.gapFill) {
    const typeByKey = new Map((countResult?.types ?? []).map(t => [t.key, t]));
    const suggestedByType = new Map<string, NonNullable<typeof ev.gapFill>['suggested']>();
    for (const s of ev.gapFill.suggested) {
      if (!suggestedByType.has(s.typeKey)) suggestedByType.set(s.typeKey, []);
      suggestedByType.get(s.typeKey)!.push(s);
    }
    for (const f of ev.gapFill.findings) {
      const keys = f.typeKey.split('+');
      const label = keys.map(k => typeByKey.get(k)?.type ?? k).join('/');
      const relevant = keys.flatMap(k => suggestedByType.get(k) ?? []);
      if (f.direction === 'under' && relevant.length) {
        items.push({
          id: `gapfill:${f.typeKey}`,
          kind: 'count',
          title: `Gap-fill found ${relevant.length} possible ${label} — confirm on plans`,
          detail: `${f.reason} A targeted re-search suggested ${relevant.length} mark${relevant.length === 1 ? '' : 's'} on the plans (Plans view, shown as SUGGESTED) — confirm the real ones there, then use "Use confirmed markers" here. Nothing here is counted until you do.`,
          typeKey: keys.length === 1 ? keys[0] : f.typeKey,
          type: label,
          actions: ['markers', 'count', 'not_on_job'],
          fingerprint: `gapfill|${f.expected}|${f.actual}|${relevant.length}`,
        });
        continue;
      }
      items.push({
        id: `reconcile:${f.typeKey}`,
        kind: 'confirm',
        blocking: f.direction === 'under',
        title: `${f.direction === 'under' ? 'Possible shortfall' : 'Possible over-count'}: ${label} vs ${f.source}`,
        detail: `${f.reason}${f.direction === 'under' ? ' A targeted re-search found nothing more on the plans — confirm the count as it stands (with a reason), or correct it.' : ' The plans show more than the second source — confirm the count (with a reason), or correct it.'}`,
        typeKey: keys.length === 1 ? keys[0] : undefined,
        type: label,
        actions: ['confirm', 'count'],
        fingerprint: `reconcile|${f.expected}|${f.actual}|${f.direction}`,
      });
    }
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
  for (const tbl of ev?.tables ?? []) {
    if (!tbl.warnings.filter(w => !w.includes(PANEL_CONFLICT)).length) continue;
    items.push({
      id: `schedule:${tbl.id}`,
      kind: 'confirm',
      blocking: false,
      title: `Schedule read incompletely: ${tbl.title} (${tbl.sheetLabel})`,
      detail: `${tbl.warnings.filter(w => !w.includes(PANEL_CONFLICT)).join(' ')} Quantities taken from this table may be short — check it on the sheet.`,
      actions: ['confirm'],
      fingerprint: `schedule|${tbl.warnings.filter(w => !w.includes(PANEL_CONFLICT)).join('|')}`,
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
  if (i.id.startsWith('gapfill:')) return 12;
  if (i.id.startsWith('reconcile:')) return 13;
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
  if (i.blocking === false) return i.id.startsWith('photo:') ? 'photometric' : i.id.startsWith('schedule:') ? 'schedule' : i.id.startsWith('checklist:') ? 'checklist' : i.id.startsWith('reconcile:') ? 'reconcile' : i.id.startsWith('spotcheck:') ? 'spotcheck' : 'info';
  if (i.id.startsWith('legend-zero:')) return 'legend-zero';
  if (i.id.startsWith('gapfill:')) return 'gapfill';
  if (i.id.startsWith('reconcile:')) return 'reconcile';
  if (i.id.startsWith('schedule:') || i.id.startsWith('panel-dup:')) return 'schedule';
  if (i.id.startsWith('viewport:')) return 'viewport';
  if (i.id.startsWith('typical:') || i.id.startsWith('typicalqty:') || i.id.startsWith('typicalat:')) return 'typical';
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
}

export function enforcedCounts(countResult: CountResult | null, items: ReviewItem[] | null | undefined): EnforcedCounts {
  const byType = new Map<string, number | null>();
  const extraLines: EnforcedCounts['extraLines'] = [];
  const list = items ?? [];
  const res = (id: string) => list.find(i => i.id === id)?.resolution;
  // Fix round (B2) — `gapfill:`/`reconcile:` ids can name several types at
  // once ("S1+S2", one catalog family sharing a schedule row); index every
  // member key back to its item so a single type's own qty lookup still
  // finds it.
  const byMemberKey = (prefix: 'gapfill:' | 'reconcile:') => {
    const m = new Map<string, ReviewItem>();
    for (const i of list) {
      if (!i.id.startsWith(prefix) || !i.resolution) continue;
      for (const k of i.id.slice(prefix.length).split('+')) m.set(k, i);
    }
    return m;
  };
  const gapfillByKey = byMemberKey('gapfill:');
  const reconcileByKey = byMemberKey('reconcile:');
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
    // B2 — "Use confirmed markers" (or a typed count) on a gapfill: item is
    // the ONLY way a gap-fill suggestion ever becomes a real count; a
    // reconcile: item (no candidates, or an over-count) works the same way
    // for a manual correction/confirmation.
    const gf = gapfillByKey.get(t.key)?.resolution;
    if (gf) qty = gf.action === 'not_on_job' ? null : (gf.qty ?? qty);
    const rc = reconcileByKey.get(t.key)?.resolution;
    if (rc) qty = rc.action === 'not_on_job' ? null : (rc.qty ?? qty);
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
