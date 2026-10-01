// Plans view — the AI-read scale hint. The latest takeoff run stores the
// vision-read viewports of every sheet it looked at
// (takeoff_results.count_result.sheets[].viewports[]); a scanned plan set has
// no text layer for the title-block parser, so this is often the only
// machine-read scale there is. It is exposed READ-ONLY on GET /sheets and is
// never written to est_sheets.ft_per_pt — the estimator confirms it.
//
// Sheet key format (ai/countingStage.ts): `${file name}#${1-based page}`, with
// `sheets[].file` / `sheets[].page` carrying the same two parts. Documents are
// matched by file name (the same convention estimating/aiMarkers.ts uses with
// resolveDocumentsForFiles); page_index = page - 1.
const PT_PER_INCH = 72;

export interface AiScale {
  ai_scale_label: string | null;
  /** RAW ft per PDF point (never pre-multiplied by half_size — the frontend's
   *  effectiveTitleBlockFtPerPt applies half-size once, at use time). */
  ai_ft_per_pt: number | null;
  ai_scale_ambiguous: boolean;
}

export const NO_AI_SCALE: AiScale = { ai_scale_label: null, ai_ft_per_pt: null, ai_scale_ambiguous: false };

interface ViewportLike { kind?: string; scale?: string; inPerFt?: number | null }

const NTS_RE = /\bN\.?\s*T\.?\s*S\.?\b|NOT\s+TO\s+SCALE/i;

/** Pure: the single main-plan scale of one sheet's viewports, or nothing.
 *  Only `main_plan` viewports count (legend / schedule / detail / enlarged
 *  plan scales say nothing about the main plan). Several distinct main-plan
 *  scales -> ambiguous, no value. NTS -> no value. */
export function aiScaleFromViewports(viewports: unknown): AiScale {
  if (!Array.isArray(viewports)) return NO_AI_SCALE;
  const distinct = new Map<string, { label: string; inPerFt: number | null }>();
  for (const raw of viewports as ViewportLike[]) {
    if (!raw || raw.kind !== 'main_plan') continue;
    const scale = typeof raw.scale === 'string' ? raw.scale.trim() : '';
    if (scale && NTS_RE.test(scale)) { distinct.set('nts', { label: scale, inPerFt: null }); continue; }
    const inPerFt = typeof raw.inPerFt === 'number' && Number.isFinite(raw.inPerFt) && raw.inPerFt > 0 ? raw.inPerFt : null;
    if (inPerFt == null || !scale) continue;
    distinct.set(inPerFt.toFixed(6), { label: scale, inPerFt });
  }
  if (distinct.size === 0) return NO_AI_SCALE;
  if (distinct.size > 1) return { ...NO_AI_SCALE, ai_scale_ambiguous: true };
  const only = [...distinct.values()][0];
  if (only.inPerFt == null) return NO_AI_SCALE; // NTS
  return { ai_scale_label: only.label, ai_ft_per_pt: 1 / (only.inPerFt * PT_PER_INCH), ai_scale_ambiguous: false };
}

interface CountSheetLike { key?: string; file?: string; page?: number; viewports?: unknown }

/** Pure: `${document_id}:${page_index}` -> AiScale for every sheet of the
 *  count result that maps to exactly one live document by file name.
 *  `documents` are the bid's current plan documents (id + name). */
export function buildAiScaleIndex(countResult: unknown, documents: Array<{ id: string; name: string }>): Map<string, AiScale> {
  const out = new Map<string, AiScale>();
  const sheets = (countResult as { sheets?: CountSheetLike[] } | null | undefined)?.sheets;
  if (!Array.isArray(sheets)) return out;
  const idsByName = new Map<string, string[]>();
  for (const d of documents) {
    const k = d.name.toLowerCase();
    idsByName.set(k, [...(idsByName.get(k) ?? []), d.id]);
  }
  for (const s of sheets) {
    // Prefer the explicit file/page fields; fall back to splitting the key.
    let file = typeof s.file === 'string' ? s.file : '';
    let page = typeof s.page === 'number' ? s.page : NaN;
    if ((!file || !Number.isFinite(page)) && typeof s.key === 'string') {
      const i = s.key.lastIndexOf('#');
      if (i > 0) { file = s.key.slice(0, i); page = Number(s.key.slice(i + 1)); }
    }
    if (!file || !Number.isInteger(page) || page < 1) continue;
    const ids = idsByName.get(file.toLowerCase());
    if (!ids || ids.length !== 1) continue; // unknown or duplicate file name: never guess
    const ai = aiScaleFromViewports(s.viewports);
    if (ai.ai_ft_per_pt == null && !ai.ai_scale_ambiguous) continue;
    out.set(`${ids[0]}:${page - 1}`, ai);
  }
  return out;
}
