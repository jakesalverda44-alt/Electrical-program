// Accuracy round C7 — the read-only "Suggested feeder routes" Plans layer:
// the feeder estimate's route on the sheet being viewed. Points are PDF
// user-space points (the frame est_markups use), drawn inside PlanViewer's
// own pdf→render <g transform>, so rotation (incl. /Rotate 270) and the
// MediaBox origin are handled exactly as every marker is.
import type { FeedersResponse } from '../FeedersPanel';
import type { Point } from './overlay';

export interface SuggestedRoute { id: string; label: string; points: Point[]; underground: boolean; status: 'estimated' | 'hold' }

export function feederRoutesForSheet(data: FeedersResponse | null | undefined, documentId: string, pageIndex: number): SuggestedRoute[] {
  if (!data || !Array.isArray(data.edges)) return [];
  return data.edges
    .filter(e => e.route && e.route.documentId === documentId && e.route.pageIndex === pageIndex && e.route.points.length > 1)
    .map(e => ({ id: e.id, label: `${e.from} → ${e.to}${e.lengthFt != null ? ` · ${e.lengthFt} ft (${e.tier === 'confirmed' ? 'confirmed scale' : 'suggested'})` : ''}`, points: e.route!.points, underground: e.underground, status: e.status }));
}
