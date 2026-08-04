import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api/client';
import Icon from '../../components/Icon';
import { Gen } from '../../types';
import { useShowToast } from '../../contexts/AppContext';
import { GEN_SPEC_DETAIL } from '../builder/genData';

type MarkerType = 'service' | 'gas' | 'generator';

// labelDx/labelDy: label text offset from the marker anchor (x,y), so the wording can be
// dragged clear of the survey's own text with a leader line drawn back to the marker.
interface BaseMarker { id: string; type: MarkerType; x: number; y: number; label: string; labelDx: number; labelDy: number; }
interface DotMarker extends BaseMarker { type: 'service' | 'gas'; }
interface RectMarker extends BaseMarker { type: 'generator'; w: number; h: number; rotation: number; }
type Marker = DotMarker | RectMarker;

interface SurveyMarkup { baseDocId: string; naturalWidth: number; naturalHeight: number; markers: Marker[]; }

const MARKER_COLORS: Record<MarkerType, string> = { service: '#2563EB', gas: '#D97706', generator: '#1B3A6B' };
const MARKER_LABELS: Record<MarkerType, string> = { service: 'Electrical Service', gas: 'Gas Meter', generator: 'Generator' };
const DOT_RADIUS = 9;
const PX_PER_INCH = 3; // starting visual size only — user resizes to match the survey's printed scale

function uid() { return Math.random().toString(36).slice(2, 10); }

function genFootprint(gen: Gen): { w: number; h: number; label: string } {
  const detail = GEN_SPEC_DETAIL[gen.mfr]?.[gen.model];
  const m = detail?.dims?.match(/([\d.]+)\s*×\s*([\d.]+)/);
  if (m) {
    const w = Number(m[1]), d = Number(m[2]);
    return { w: w * PX_PER_INCH, h: d * PX_PER_INCH, label: `${gen.mfr} ${gen.model} generator (${w}×${d} in)` };
  }
  return { w: 48 * PX_PER_INCH, h: 30 * PX_PER_INCH, label: `${gen.mfr} ${gen.model} generator` };
}

function parseMarkup(raw: Gen['survey_markup']): SurveyMarkup | null {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as SurveyMarkup).markers)) {
      // Back-compat: markers saved before draggable labels have no labelDx/labelDy.
      const m = parsed as SurveyMarkup;
      m.markers = m.markers.map(mk => ({
        ...mk,
        labelDx: mk.labelDx ?? (mk.type === 'generator' ? 0 : DOT_RADIUS + 6),
        labelDy: mk.labelDy ?? (mk.type === 'generator' ? -((mk as RectMarker).h / 2 + 16) : 4),
      }));
      return m;
    }
  } catch { /* ignore */ }
  return null;
}

interface DocRow { id: string; name: string; display_name: string | null; category: string | null; file_type: string | null; }

export default function SurveyMarkupEditor({ gen, onUpdated }: { gen: Gen; onUpdated: (gen: Gen) => void }) {
  const showToast = useShowToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  const [surveyDoc, setSurveyDoc] = useState<DocRow | null | 'checking'>('checking');
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placing, setPlacing] = useState<MarkerType | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Labelling a survey in a ~480px drawer means squinting at a letter-size drawing.
  // Full screen and zoom are about being able to see what you are marking up.
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panFrom = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);

  // Escape leaves full screen. Bound on the document because the overlay is a plain div
  // — a keydown handler on it would only fire once something inside had focus.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreen]);
  const [uploading, setUploading] = useState(false);

  const drag = useRef<{ kind: 'move' | 'resize' | 'rotate' | 'label'; id: string; startX: number; startY: number; orig: Marker } | null>(null);

  // Load the raw "Survey" document + any saved markup on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/documents', { params: { linked_id: gen.id } });
        const doc = (data as DocRow[]).find(d => d.category === 'survey') || null;
        if (cancelled) return;
        setSurveyDoc(doc);
        const saved = parseMarkup(gen.survey_markup);
        if (saved && doc && saved.baseDocId === doc.id) {
          setMarkers(saved.markers);
        }
        if (doc) await loadDoc(doc);
      } catch {
        if (!cancelled) setSurveyDoc(null);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen.id]);

  const loadDoc = async (doc: DocRow) => {
    setLoading(true);
    try {
      const res = await api.get(`/documents/${doc.id}/view`, { responseType: 'blob' });
      const blob: Blob = res.data;
      const isPdf = (doc.file_type || blob.type || '').includes('pdf');
      if (isPdf) {
        const pdfjsLib = await import('pdfjs-dist');
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
        const buf = await blob.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        setImgUrl(canvas.toDataURL('image/png'));
        setNatural({ w: viewport.width, h: viewport.height });
      } else {
        // A data URL, not an object URL. html2canvas rasterizes the export inside a
        // cloned document where a blob: href does not resolve, so an image survey
        // exported as a broken-image icon — a finalized PDF with no survey in it. The
        // PDF branch above already produces a data URL via canvas, which is why that
        // path was fine.
        const url = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.onerror = () => reject(fr.error);
          fr.readAsDataURL(blob);
        });
        const dims = await new Promise<{ w: number; h: number }>(resolve => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.src = url;
        });
        setImgUrl(url);
        setNatural(dims);
      }
    } catch {
      showToast({ title: 'Could not load the survey', sub: 'Try re-uploading it' });
    } finally {
      setLoading(false);
    }
  };

  const uploadSurvey = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('linked_id', gen.id);
      fd.append('linked_name', gen.customer);
      fd.append('div', 'gen');
      fd.append('category', 'survey');
      const { data } = await api.post('/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setSurveyDoc(data);
      setMarkers([]);
      setSelectedId(null);
      await loadDoc(data);
    } catch {
      showToast({ title: 'Upload failed', sub: 'Try again' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // Screen point -> survey coordinates, via the SVG's own transform matrix. The old
  // version divided natural size by the element's on-screen rect, which only held while
  // the viewBox showed the whole survey — the moment it zooms, that maths puts markers
  // in the wrong place. getScreenCTM accounts for whatever the viewBox currently is.
  const svgPoint = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const addMarker = (e: React.MouseEvent) => {
    if (!placing || !natural) return;
    const { x, y } = svgPoint(e);
    if (placing === 'generator') {
      const fp = genFootprint(gen);
      const m: RectMarker = { id: uid(), type: 'generator', x, y, w: fp.w, h: fp.h, rotation: 0, label: fp.label, labelDx: 0, labelDy: -(fp.h / 2 + 16) };
      setMarkers(prev => [...prev, m]);
      setSelectedId(m.id);
    } else {
      const label = placing === 'service' ? "Main Service and ATS's Location" : 'Gas Meter';
      const m: DotMarker = { id: uid(), type: placing, x, y, label, labelDx: DOT_RADIUS + 6, labelDy: 4 };
      setMarkers(prev => [...prev, m]);
      setSelectedId(m.id);
    }
    setPlacing(null);
  };

  const startDrag = (kind: 'move' | 'resize' | 'rotate' | 'label', marker: Marker) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedId(marker.id);
    const { x, y } = svgPoint(e);
    drag.current = { kind, id: marker.id, startX: x, startY: y, orig: { ...marker } };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    // Panning takes precedence: while zoomed in, dragging empty space moves the view.
    const p = panFrom.current;
    if (p && natural) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (rect) {
        const perPxX = view.w / rect.width, perPxY = view.h / rect.height;
        setPan(clampPan(p.px - (e.clientX - p.mx) * perPxX, p.py - (e.clientY - p.my) * perPxY, zoom));
      }
      return;
    }
    const d = drag.current;
    if (!d) return;
    const { x, y } = svgPoint(e);
    const dx = x - d.startX, dy = y - d.startY;
    setMarkers(prev => prev.map(m => {
      if (m.id !== d.id) return m;
      if (d.kind === 'move') return { ...m, x: d.orig.x + dx, y: d.orig.y + dy };
      if (d.kind === 'label') return { ...m, labelDx: d.orig.labelDx + dx, labelDy: d.orig.labelDy + dy };
      if (m.type === 'generator' && d.orig.type === 'generator') {
        if (d.kind === 'resize') {
          const rot = -m.rotation * Math.PI / 180;
          const localDx = dx * Math.cos(rot) - dy * Math.sin(rot);
          const localDy = dx * Math.sin(rot) + dy * Math.cos(rot);
          return { ...m, w: Math.max(10, d.orig.w + localDx * 2), h: Math.max(10, d.orig.h + localDy * 2) };
        }
        if (d.kind === 'rotate') {
          const angle = Math.atan2(y - m.y, x - m.x) * 180 / Math.PI + 90;
          return { ...m, rotation: angle };
        }
      }
      return m;
    }));
  };
  const onMouseUp = () => { drag.current = null; panFrom.current = null; };

  // Only start a pan on empty survey — a mousedown that lands on a marker belongs to
  // that marker's own drag handler, and placing a marker shouldn't move the view.
  const onSvgMouseDown = (e: React.MouseEvent) => {
    if (placing || zoom === 1) return;
    if ((e.target as Element).tagName !== 'image') return;
    panFrom.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
  };

  const selected = markers.find(m => m.id === selectedId) || null;
  const setSelectedLabel = (label: string) => setMarkers(prev => prev.map(m => m.id === selectedId ? { ...m, label } : m));
  const deleteSelected = () => { setMarkers(prev => prev.filter(m => m.id !== selectedId)); setSelectedId(null); };

  const save = async (silent = false) => {
    if (!surveyDoc || typeof surveyDoc !== 'object' || !natural) return;
    setSaving(true);
    try {
      const markup: SurveyMarkup = { baseDocId: surveyDoc.id, naturalWidth: natural.w, naturalHeight: natural.h, markers };
      const { data } = await api.patch(`/gens/${gen.id}`, { survey_markup: markup });
      onUpdated(data.gen ?? data);
      if (!silent) showToast({ title: 'Markup saved' });
    } catch {
      showToast({ title: 'Save failed', sub: 'Try again' });
    } finally {
      setSaving(false);
    }
  };

  const finalize = async () => {
    if (!exportRef.current) return;
    setExporting(true);
    try {
      // The export rasterizes what is on screen, so a zoomed-in view would produce a PDF
      // of one corner of the survey. Show the whole thing first and let it paint.
      if (zoom !== 1) {
        resetView();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      }
      await save(true);
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const canvas = await html2canvas(exportRef.current, { scale: 1.5, backgroundColor: '#ffffff', useCORS: true });
      const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: canvas.width > canvas.height ? 'landscape' : 'portrait' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const scale = Math.min(pageW / canvas.width, pageH / canvas.height);
      const w = canvas.width * scale, h = canvas.height * scale;
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (pageW - w) / 2, (pageH - h) / 2, w, h);
      const fd = new FormData();
      fd.append('file', pdf.output('blob'), `Labeled Survey - ${gen.customer}.pdf`);
      fd.append('linked_id', gen.id);
      fd.append('linked_name', gen.customer);
      fd.append('div', 'gen');
      fd.append('category', 'labeled_survey');
      fd.append('display_name', `Labeled Survey — ${gen.customer}`);
      await api.post('/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      showToast({ title: 'Labeled survey saved', sub: 'Attached to this job' });
    } catch {
      showToast({ title: 'Export failed', sub: 'Try again' });
    } finally {
      setExporting(false);
    }
  };

  const toolbarBtn = (type: MarkerType, icon: string) => (
    <button key={type} className="btn ghost" disabled={!natural}
      onClick={() => setPlacing(p => p === type ? null : type)}
      style={{ fontSize: 12, height: 30, padding: '0 12px', ...(placing === type ? { background: MARKER_COLORS[type], color: '#fff', borderColor: MARKER_COLORS[type] } : {}) }}>
      <Icon name={icon as any} size={13} stroke={1.9}/>+ {MARKER_LABELS[type]}
    </button>
  );

  // Zoom and pan are expressed purely as the viewBox, so markers stay in survey
  // coordinates and nothing about the saved data changes when the view moves.
  const MAX_ZOOM = 8;
  const view = natural
    ? { w: natural.w / zoom, h: natural.h / zoom }
    : { w: 100, h: 100 };
  const viewBox = natural
    ? `${pan.x} ${pan.y} ${view.w} ${view.h}`
    : '0 0 100 100';

  // Keep the visible window inside the survey, so zooming out or panning can't strand
  // the user on blank space with no way back.
  const clampPan = (x: number, y: number, z: number) => {
    if (!natural) return { x: 0, y: 0 };
    const vw = natural.w / z, vh = natural.h / z;
    return {
      x: Math.min(Math.max(0, x), Math.max(0, natural.w - vw)),
      y: Math.min(Math.max(0, y), Math.max(0, natural.h - vh)),
    };
  };

  /** Zoom about a fixed survey point — the cursor for the wheel, the centre for the
   *  buttons — so the thing being looked at stays put instead of sliding away. */
  const zoomTo = (next: number, focus?: { x: number; y: number }) => {
    if (!natural) return;
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    const f = focus ?? { x: pan.x + view.w / 2, y: pan.y + view.h / 2 };
    const nvw = natural.w / z, nvh = natural.h / z;
    setZoom(z);
    setPan(clampPan(f.x - nvw / 2, f.y - nvh / 2, z));
  };

  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const onWheel = (e: React.WheelEvent) => {
    if (!natural) return;
    e.preventDefault();
    zoomTo(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), svgPoint(e));
  };

  return (
    <div
      style={fullscreen
        // Above the drawer (240) and the mobile nav (200): while labelling, this is the
        // only thing on screen.
        ? {
            position: 'fixed', inset: 0, zIndex: 300, background: 'var(--bg, #0b1220)',
            padding: '14px 16px', overflow: 'auto',
            display: 'flex', flexDirection: 'column',
          }
        : { marginTop: 4 }}
    >
      <input ref={fileRef} type="file" accept="application/pdf,image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadSurvey(f); }}/>

      {surveyDoc === 'checking' || loading ? (
        <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, padding: '20px 0', textAlign: 'center' }}>Loading…</div>
      ) : !surveyDoc && !imgUrl ? (
        <div style={{ border: '1.5px dashed var(--border2)', borderRadius: 10, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)', marginBottom: 10 }}>No survey uploaded yet</div>
          <button className="btn ghost" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? 'Uploading…' : 'Upload Survey (PDF or Image)'}
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, alignItems: 'center' }}>
            {toolbarBtn('service', 'bolt')}
            {toolbarBtn('gas', 'flame')}
            {toolbarBtn('generator', 'gear')}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
              <button className="btn ghost" onClick={() => zoomTo(zoom / 1.4)} disabled={zoom <= 1}
                title="Zoom out" aria-label="Zoom out"
                style={{ fontSize: 14, height: 30, width: 30, padding: 0, justifyContent: 'center' }}>−</button>
              <button className="btn ghost" onClick={resetView} disabled={zoom === 1}
                title="Fit the whole survey" style={{ fontSize: 11.5, height: 30, padding: '0 8px', minWidth: 52 }}>
                {Math.round(zoom * 100)}%
              </button>
              <button className="btn ghost" onClick={() => zoomTo(zoom * 1.4)} disabled={zoom >= MAX_ZOOM}
                title="Zoom in" aria-label="Zoom in"
                style={{ fontSize: 14, height: 30, width: 30, padding: 0, justifyContent: 'center' }}>+</button>
              <button className="btn ghost" onClick={() => setFullscreen(f => !f)}
                title={fullscreen ? 'Exit full screen' : 'Label full screen'}
                style={{ fontSize: 12, height: 30, padding: '0 10px' }}>
                {fullscreen ? 'Exit full screen' : 'Full screen'}
              </button>
              <button className="btn ghost" disabled={uploading} onClick={() => fileRef.current?.click()} style={{ fontSize: 12, height: 30, padding: '0 12px' }}>
                Replace Survey File
              </button>
            </div>
          </div>
          {zoom > 1 && (
            <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 8 }}>
              Drag the survey to move around. Scroll to zoom.
            </div>
          )}
          {placing && <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 8 }}>Click on the survey to place it.</div>}

          {selected && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '6px 10px' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase' }}>{MARKER_LABELS[selected.type]}</span>
              <input value={selected.label} onChange={e => setSelectedLabel(e.target.value)}
                style={{ flex: 1, font: 'inherit', fontSize: 12.5, fontWeight: 600, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 6, padding: '5px 8px', outline: 'none' }}/>
              <button onClick={deleteSelected} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Delete</button>
            </div>
          )}
          {selected && <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 8 }}>Drag the marker to reposition, or drag its label text to move the wording clear of the survey.</div>}

          <div ref={exportRef} style={{
            background: '#fff', border: '1px solid var(--border2)', borderRadius: 10,
            overflow: 'hidden', position: 'relative',
            // Full screen gives the drawing the rest of the window instead of a
            // drawer-width column.
            ...(fullscreen ? { flex: 1, minHeight: 0, display: 'flex' } : {}),
          }}>
            {imgUrl && natural && (
              <svg ref={svgRef} viewBox={viewBox}
                style={{
                  width: '100%', display: 'block',
                  // Full screen: fit the drawing to the available height rather than
                  // letting a tall survey run off the bottom of the screen.
                  ...(fullscreen ? { height: '100%', maxHeight: '100%' } : {}),
                  cursor: placing ? 'crosshair' : panFrom.current ? 'grabbing' : zoom > 1 ? 'grab' : 'default',
                  touchAction: 'none',
                }}
                onClick={addMarker} onMouseDown={onSvgMouseDown} onMouseMove={onMouseMove}
                onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onWheel={onWheel}>
                <image href={imgUrl} x={0} y={0} width={natural.w} height={natural.h}/>
                {markers.map(m => {
                  const isSel = m.id === selectedId;
                  if (m.type === 'generator') {
                    const handleDist = Math.max(m.w, m.h) / 2 + 24;
                    const rad = (m.rotation - 90) * Math.PI / 180;
                    const rotHandle = { x: m.x + handleDist * Math.cos(rad), y: m.y + handleDist * Math.sin(rad) };
                    const cornerLocal = { x: m.w / 2, y: m.h / 2 };
                    const cRad = m.rotation * Math.PI / 180;
                    const resizeHandle = {
                      x: m.x + cornerLocal.x * Math.cos(cRad) - cornerLocal.y * Math.sin(cRad),
                      y: m.y + cornerLocal.x * Math.sin(cRad) + cornerLocal.y * Math.cos(cRad),
                    };
                    const lx = m.x + m.labelDx, ly = m.y + m.labelDy;
                    return (
                      <g key={m.id} onClick={(e: React.MouseEvent) => { e.stopPropagation(); setSelectedId(m.id); }}>
                        <rect x={m.x - m.w / 2} y={m.y - m.h / 2} width={m.w} height={m.h}
                          fill={MARKER_COLORS.generator} fillOpacity={0.55} stroke={MARKER_COLORS.generator} strokeWidth={isSel ? 3 : 2}
                          transform={`rotate(${m.rotation} ${m.x} ${m.y})`} onMouseDown={startDrag('move', m)} style={{ cursor: 'move' }}/>
                        <line x1={m.x} y1={m.y} x2={lx} y2={ly} stroke={MARKER_COLORS.generator} strokeWidth={1} strokeDasharray="3 2"/>
                        <text x={lx} y={ly} textAnchor={m.labelDx < 0 ? 'end' : 'start'} fontSize={14} fontWeight={700}
                          fill={MARKER_COLORS.generator} stroke="#fff" strokeWidth={3} paintOrder="stroke"
                          onMouseDown={startDrag('label', m)} style={{ cursor: 'move' }}>{m.label}</text>
                        {isSel && (
                          <>
                            <line x1={m.x} y1={m.y} x2={rotHandle.x} y2={rotHandle.y} stroke="#888" strokeWidth={1}/>
                            <circle cx={rotHandle.x} cy={rotHandle.y} r={7} fill="#fff" stroke="#888" strokeWidth={1.5} onMouseDown={startDrag('rotate', m)} style={{ cursor: 'grab' }}/>
                            <rect x={resizeHandle.x - 6} y={resizeHandle.y - 6} width={12} height={12} fill="#fff" stroke={MARKER_COLORS.generator} strokeWidth={1.5}
                              transform={`rotate(${m.rotation} ${resizeHandle.x} ${resizeHandle.y})`} onMouseDown={startDrag('resize', m)} style={{ cursor: 'nwse-resize' }}/>
                          </>
                        )}
                      </g>
                    );
                  }
                  const lx = m.x + m.labelDx, ly = m.y + m.labelDy;
                  return (
                    <g key={m.id} onClick={(e: React.MouseEvent) => { e.stopPropagation(); setSelectedId(m.id); }}>
                      <line x1={m.x} y1={m.y} x2={lx} y2={ly} stroke={MARKER_COLORS[m.type]} strokeWidth={1} strokeDasharray="3 2"/>
                      <circle cx={m.x} cy={m.y} r={DOT_RADIUS} fill={MARKER_COLORS[m.type]} stroke="#fff" strokeWidth={isSel ? 3 : 2}
                        onMouseDown={startDrag('move', m)} style={{ cursor: 'move' }}/>
                      <text x={lx} y={ly} textAnchor={m.labelDx < 0 ? 'end' : 'start'} fontSize={13} fontWeight={700}
                        fill={MARKER_COLORS[m.type]} stroke="#fff" strokeWidth={3} paintOrder="stroke"
                        onMouseDown={startDrag('label', m)} style={{ cursor: 'move' }}>{m.label}</text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        </>
      )}

      {surveyDoc && typeof surveyDoc === 'object' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn ghost" style={{ flex: 1, justifyContent: 'center' }} disabled={saving} onClick={() => save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="btn amber" style={{ flex: 1, justifyContent: 'center' }} disabled={exporting} onClick={finalize}>
            {exporting ? 'Exporting…' : 'Finalize / Export Labeled Survey'}
          </button>
        </div>
      )}
    </div>
  );
}
