// Accuracy round C1–C5 together — every feeder of a bid with its length
// estimate (or the specific hold). Pure: the DB loader (feederEstimateDb.ts)
// and the replay eval feed it the same inputs.
import { feederGraph, type FeederEdge, type FeederGraph, type FeederGraphInput } from './feederGraph';
import { sheetScale, buildingBoxFromMarks, type SheetScale, type EstSheetScaleRow, type KnownArea, type ViewportLike } from './sheetScale';
import { endpointCandidates, pickEnds, nodeLocations, type Endpoint, type EndpointHold, type TextSheet, type LocateLike, type PinLike } from './feederEndpoints';
import { routeFeeder, type FeederRoute, type FeederEstimateSettings } from './feederRoute';
import type { RelationSheet } from '../ai/evidence/sheetRelation';

export interface CountResultForFeeders {
  types?: Array<{ key: string; type?: string; description?: string; status?: string; count?: number; host?: boolean; category?: string }>;
  marks?: Array<{ typeKey: string; sheetKey: string; x: number; y: number; circuit?: string | null }>;
  sheets?: Array<{ key: string; label: string; geometry?: { widthPt: number; heightPt: number; originX: number; originY: number; rotation: number } | null; viewports?: ViewportLike[] | null }>;
  markers?: { sheetDocuments?: Array<{ sheetKey?: string; documentId?: string; pageIndex?: number; label?: string }> };
  /** Builder R's C3 locate-only marks. */
  locate?: LocateLike[];
}

export interface FeederEstimateInput {
  graph: FeederGraphInput;
  countResult: CountResultForFeeders | null;
  /** est_sheets rows (document_id, page_index + the scale columns). */
  estSheets: Array<EstSheetScaleRow & { document_id: string; page_index: number }>;
  /** Confirmed count markups (any label) — est_markups points are PDF points. */
  pins: Array<{ document_id: string; page_index: number; label: string | null; points: unknown }>;
  /** Vector sheets' text runs (site / utility / photometric plans). */
  textSheets: Array<TextSheet & { documentId?: string; pageIndex?: number; site?: boolean }>;
  knownAreas: KnownArea[];
  settings: FeederEstimateSettings;
  slackPct: number;
  deckFt: number | null;
}

export interface FeederEstimate {
  edge: FeederEdge;
  from: Endpoint | EndpointHold | undefined;
  to: Endpoint | EndpointHold | undefined;
  route: FeederRoute;
}

export interface FeederEstimateResult {
  graph: FeederGraph;
  estimates: FeederEstimate[];
  scales: SheetScale[];
  /** E1 — the same scales by sheet key, and the site / civil sheets. */
  scaleBySheet: Record<string, SheetScale>;
  siteSheets: string[];
  /** Every resolved endpoint by node (first by priority). */
  endpointOf: Record<string, Endpoint>;
  sheetOf: Record<string, { documentId: string | null; pageIndex: number | null; label: string }>;
}

const SITE_RE = /\bsite\b|utility|civil|photometric|parking/i;

export function estimateFeeders(inp: FeederEstimateInput): FeederEstimateResult {
  const graph = feederGraph(inp.graph);
  const cr = inp.countResult ?? {};
  const sheetOf: FeederEstimateResult['sheetOf'] = {};
  for (const d of cr.markers?.sheetDocuments ?? []) {
    if (!d.sheetKey) continue;
    sheetOf[d.sheetKey] = { documentId: d.documentId ?? null, pageIndex: d.pageIndex ?? null, label: d.label ?? cr.sheets?.find(s => s.key === d.sheetKey)?.label ?? d.sheetKey };
  }
  for (const t of inp.textSheets) if (!sheetOf[t.sheetKey]) sheetOf[t.sheetKey] = { documentId: t.documentId ?? null, pageIndex: t.pageIndex ?? null, label: t.label };
  const keyOfPage = (docId: string, page: number) => Object.entries(sheetOf).find(([, v]) => v.documentId === docId && v.pageIndex === page)?.[0] ?? null;
  const rowOf = (key: string) => { const s = sheetOf[key]; return s?.documentId ? inp.estSheets.find(r => r.document_id === s.documentId && Number(r.page_index) === s.pageIndex) ?? null : null; };

  // Scales, per sheet that can hold an endpoint.
  const scales = new Map<string, SheetScale>();
  const siteSheets = new Set<string>();
  const siteMarkTypes = new Set((cr.types ?? []).filter(t => /site|exterior/i.test(t.category ?? '')).map(t => t.key));
  for (const s of cr.sheets ?? []) {
    const main = (s.viewports ?? []).find(v => v.kind === 'main_plan');
    if (main && SITE_RE.test(main.title ?? '')) siteSheets.add(s.key);
    const marks = (cr.marks ?? []).filter(m => m.sheetKey === s.key && !siteMarkTypes.has(m.typeKey));
    scales.set(s.key, sheetScale({ label: s.label, row: rowOf(s.key), viewports: s.viewports ?? [], buildingBoxPt: buildingBoxFromMarks(marks, main), knownAreas: inp.knownAreas }));
  }
  for (const t of inp.textSheets) {
    if (t.site || SITE_RE.test(t.label)) siteSheets.add(t.sheetKey);
    const prev = scales.get(t.sheetKey);
    const withText = sheetScale({ label: t.label, row: rowOf(t.sheetKey), viewports: (cr.sheets ?? []).find(s => s.key === t.sheetKey)?.viewports ?? [], textRuns: t.runs, knownAreas: inp.knownAreas });
    // A scale bar in the text layer beats a raster-only read.
    if (!prev || withText.tier !== 'unverified' || prev.tier === 'unverified') scales.set(t.sheetKey, withText);
  }

  // Endpoints.
  const pins: PinLike[] = [];
  for (const p of inp.pins) {
    const key = keyOfPage(p.document_id, Number(p.page_index));
    const pts = Array.isArray(p.points) ? p.points as unknown[] : [];
    const first = pts[0] as { x?: number; y?: number } | number[] | undefined;
    const xy = Array.isArray(first) ? { x: Number(first[0]), y: Number(first[1]) } : first ? { x: Number(first.x), y: Number(first.y) } : null;
    if (key && xy && Number.isFinite(xy.x) && Number.isFinite(xy.y) && p.label) pins.push({ sheetKey: key, label: p.label, x: xy.x, y: xy.y });
  }
  const hints = [
    ...((inp.graph.takeoffRows ?? []).map(r => `${r.item ?? ''} ${r.spec ?? ''}`)),
    ...(((inp.graph.agent1 as { scopeNotes?: string[] } | null)?.scopeNotes ?? []).map(String)),
  ];
  const endpoints = endpointCandidates(graph.nodes, { pins, locate: cr.locate ?? [], types: cr.types, marks: cr.marks, textSheets: inp.textSheets, hints });

  const relationSheets = new Map<string, RelationSheet>();
  for (const s of cr.sheets ?? []) relationSheets.set(s.key, { key: s.key, label: s.label, geometry: (s.geometry ?? null) as never, viewports: (s.viewports ?? null) as never, marks: (cr.marks ?? []).filter(m => m.sheetKey === s.key) });
  const labelOf = (k: string) => (sheetOf[k]?.label ?? k).replace(/\s+".*$/, '');
  const locations = nodeLocations(inp.graph.agent1 as never);
  const estimates: FeederEstimate[] = graph.edges.map(edge => {
    const [from, to] = pickEnds(endpoints.get(edge.from), endpoints.get(edge.to));
    const route = routeFeeder({ edge, from, to, scales, relationSheets, siteSheets, settings: inp.settings, slackPct: inp.slackPct, deckFt: inp.deckFt, labelOf, locations });
    return { edge, from, to, route };
  });
  const endpointOf: Record<string, Endpoint> = {};
  for (const [node, v] of endpoints) if (Array.isArray(v) && v.length) endpointOf[node] = v[0];
  return { graph, estimates, scales: [...scales.values()], scaleBySheet: Object.fromEntries(scales), siteSheets: [...siteSheets], endpointOf, sheetOf };
}
