// Evidence round 1.2 / 1.3 — the counter's marks, attributed to the sheet's
// viewports and reconciled. Pure.
//
// 1.2  Every mark carries its viewport. A mark in a legend, schedule or
//      notes viewport is never a device; a mark in a detail is a TYPICAL's
//      drawing, not a device (typicals are expanded from their legend /
//      notes, Part 2) — both are kept as `excluded`, with the reason, never
//      dropped silently.
// 1.3  Enlarged plan vs the main plan, per type, per enlarged viewport:
//        * its area on the main plan is known (the drawing's callout /
//          boundary, from the viewport reader):
//            main shows none of the type there   -> take the enlarged marks
//                                                  ("see detail");
//            main shows as many or more           -> keep the main plan's;
//            main shows some, the enlarged more   -> the enlarged plan is the
//                                                  detailed view of that
//                                                  area: its marks replace
//                                                  the main plan's there
//                                                  (never summed);
//        * its area is NOT known:
//            main shows none of the type anywhere -> take the enlarged marks;
//            otherwise                            -> keep the main plan's for
//                                                  now and ASK (one grouped
//                                                  review item, both counts).
// Without a main plan viewport (detection failed or found none) nothing is
// changed — the sheet counts as one plan, exactly as before.
import { NEVER_COUNTED_KINDS, pdfToDisplayedIn, rectContains, viewportAt, viewportLabel, type SheetGeom, type Viewport, type ViewportKind } from './viewports';

export { viewportLabel };

export interface MarkIn { typeKey: string; x: number; y: number; tileIds?: string[] }

export interface ResolvedMark extends MarkIn {
  viewportId: string | null;
  viewportKind: ViewportKind | null;
}

export interface ExcludedMark extends ResolvedMark {
  reason: string;
}

export type EnlargedDecisionKind = 'take_enlarged' | 'keep_main' | 'enlarged_replaces_area' | 'ask';

export interface EnlargedDecision {
  viewportId: string;
  viewportLabel: string;
  typeKey: string;
  enlarged: number;
  /** Main-plan marks of the type inside the enlarged plan's area; null when
   *  the area is not known. */
  mainInArea: number | null;
  mainTotal: number;
  decision: EnlargedDecisionKind;
  note: string;
}

export interface SheetMarkResolution {
  counted: ResolvedMark[];
  excluded: ExcludedMark[];
  enlarged: EnlargedDecision[];
  /** 'ask' decisions: the enlarged marks NOT counted for now (they are added
   *  when the estimator answers "adds devices"). */
  pending: Array<{ typeKey: string; viewportId: string; viewportLabel: string; marks: ResolvedMark[] }>;
  notes: string[];
}

/** Pure: attribute and reconcile one sheet's placed marks. */
export function resolveSheetMarks(marks: MarkIn[], viewports: Viewport[] | null | undefined, g: SheetGeom | null): SheetMarkResolution {
  const out: SheetMarkResolution = { counted: [], excluded: [], enlarged: [], pending: [], notes: [] };
  const vps = viewports ?? [];
  const main = vps.filter(v => v.kind === 'main_plan');
  if (!g || !vps.length || !main.length) {
    out.counted = marks.map(m => ({ ...m, viewportId: null, viewportKind: null }));
    if (vps.length && !main.length) out.notes.push('No main plan viewport was identified on this sheet — every mark was counted as before.');
    return out;
  }
  const attributed: ResolvedMark[] = marks.map(m => {
    const p = pdfToDisplayedIn(m.x, m.y, g);
    const v = viewportAt(vps, p.x, p.y);
    return { ...m, viewportId: v?.id ?? null, viewportKind: v?.kind ?? null };
  });
  const byId = new Map(vps.map(v => [v.id, v]));
  const onMain: ResolvedMark[] = [];
  const inEnlarged = new Map<string, ResolvedMark[]>();
  let outside = 0;
  for (const m of attributed) {
    const kind = m.viewportKind;
    if (kind && NEVER_COUNTED_KINDS.has(kind)) {
      out.excluded.push({ ...m, reason: `drawn in the ${kind} ${viewportLabel(byId.get(m.viewportId!)!)} — a ${kind} symbol is not a device` });
      continue;
    }
    if (kind === 'detail' || kind === 'other') {
      out.excluded.push({ ...m, reason: `drawn in the detail ${viewportLabel(byId.get(m.viewportId!)!)} — a detail shows a typical; it is expanded from its legend/notes, not counted as a device` });
      continue;
    }
    if (kind === 'enlarged_plan') {
      if (!inEnlarged.has(m.viewportId!)) inEnlarged.set(m.viewportId!, []);
      inEnlarged.get(m.viewportId!)!.push(m);
      continue;
    }
    if (!kind) outside++;
    onMain.push(m);
  }
  if (outside) out.notes.push(`${outside} mark(s) fell outside every identified viewport — counted with the main plan.`);

  const dropFromMain = new Set<ResolvedMark>();
  const takeEnlarged: ResolvedMark[] = [];
  for (const [vpId, eMarks] of inEnlarged) {
    const vp = byId.get(vpId)!;
    const label = viewportLabel(vp);
    const types = [...new Set(eMarks.map(m => m.typeKey))];
    for (const typeKey of types) {
      const e = eMarks.filter(m => m.typeKey === typeKey);
      const mainOfType = onMain.filter(m => m.typeKey === typeKey);
      let inArea: ResolvedMark[] | null = null;
      if (vp.areaOnMain) {
        inArea = mainOfType.filter(m => {
          const p = pdfToDisplayedIn(m.x, m.y, g);
          return rectContains(vp.areaOnMain!, p.x, p.y, 0.1);
        });
      }
      const base = { viewportId: vpId, viewportLabel: label, typeKey, enlarged: e.length, mainInArea: inArea ? inArea.length : null, mainTotal: mainOfType.length };
      if (inArea) {
        if (inArea.length === 0) {
          takeEnlarged.push(...e);
          out.enlarged.push({ ...base, decision: 'take_enlarged', note: `${typeKey}: the main plan shows none in the area of ${label} — its ${e.length} counted.` });
        } else if (inArea.length >= e.length) {
          for (const m of e) out.excluded.push({ ...m, reason: `repeats the main plan in the area of ${label} (main ${inArea.length}, enlarged ${e.length}) — main plan kept` });
          out.enlarged.push({ ...base, decision: 'keep_main', note: `${typeKey}: ${label} repeats the main plan (${inArea.length} there) — main plan kept.` });
        } else {
          for (const m of inArea) {
            dropFromMain.add(m);
            out.excluded.push({ ...m, reason: `shown again on ${label}, which shows more of this type in that area (${e.length} vs ${inArea.length}) — counted there` });
          }
          takeEnlarged.push(...e);
          out.enlarged.push({ ...base, decision: 'enlarged_replaces_area', note: `${typeKey}: ${label} shows ${e.length} where the main plan shows ${inArea.length} — the enlarged plan's ${e.length} used for that area, not summed.` });
        }
      } else if (mainOfType.length === 0) {
        takeEnlarged.push(...e);
        out.enlarged.push({ ...base, decision: 'take_enlarged', note: `${typeKey}: only ${label} shows it on this sheet — its ${e.length} counted.` });
      } else {
        out.pending.push({ typeKey, viewportId: vpId, viewportLabel: label, marks: e });
        out.enlarged.push({ ...base, decision: 'ask', note: `${typeKey}: ${label} shows ${e.length} and the main plan ${mainOfType.length}, and where ${label} sits on the main plan is not known — main plan kept for now; needs the estimator.` });
      }
    }
  }
  out.counted = [...onMain.filter(m => !dropFromMain.has(m)), ...takeEnlarged];
  return out;
}

/** The COUNTER is told the sheet's viewports so it counts every plan
 *  viewport (enlarged ones in full, even where they repeat the main plan —
 *  the code reconciles them) and nothing in legends, schedules or notes. */
export function viewportPromptBlock(vps: Viewport[] | null | undefined, sanitize: (s: string) => string): string {
  if (!vps || !vps.length) return '';
  const lines = vps.map(v => `- ${sanitize(viewportLabel(v))} — ${v.kind.replace('_', ' ')}${v.scale ? ` (${sanitize(v.scale)})` : ''}`);
  return `\n\nVIEWPORTS ON THIS SHEET (from the drawing's own titles):\n${lines.join('\n')}\nCount every instance in EVERY plan viewport — the main plan AND each enlarged plan, even where an enlarged plan repeats devices the main plan also shows (the system reconciles them by viewport). Never count symbols inside a legend, schedule or notes block.`;
}
