// Next round A3 — the sheet check for the Documents step. Runs by itself
// whenever the analysis inputs change (files added / removed, Project Files
// ticked / unticked), shows a spinner while the server classifies and reads
// references (~1 min for a new set, instant for files it has seen), and
// hands the Run button its "Run without N sheets" count.
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../../api/client';

export interface SheetCheckPage {
  key: string;
  file: string;
  page: number;
  sheetNo: string;
  title: string;
  discipline: string;
  cls: string;
  hasTextLayer: boolean;
  role: 'analysis' | 'reference' | 'excluded';
  reason: string;
  referencedBy?: string[];
  override?: { decision: 'include' | 'exclude'; reason: string; by: string; at: string };
}

export interface SheetCheckMissing {
  id: string;
  kind: 'sheet' | 'discipline';
  label: string;
  notProvidedText: string;
  referencedBy: Array<{ fromLabel: string; note?: string; context: string; source: string }>;
  skip?: { reason: string; by: string; at: string; auto?: boolean };
}

export interface SheetCheckData {
  status: 'idle' | 'running' | 'complete' | 'error';
  pages: SheetCheckPage[];
  missing: SheetCheckMissing[];
  unskippedMissing?: number;
  unclassifiedFiles: string[];
  otherFiles: string[];
  error: string | null;
  checkedAt: string | null;
}

export type SheetCheckUpdate =
  | { action: 'include' | 'exclude'; pageKey: string; reason: string }
  | { action: 'clear'; pageKey: string }
  | { action: 'skip'; refId: string; reason: string }
  | { action: 'unskip'; refId: string }
  | { action: 'skip_all_missing'; reason?: string };

/** "Run without 2 sheets" while referenced sheets are missing and not skipped. */
export function runButtonLabel(unskippedMissing: number | undefined, base = 'Run AI Analysis'): string {
  const n = unskippedMissing ?? 0;
  return n > 0 ? `Run without ${n} sheet${n === 1 ? '' : 's'}` : base;
}

const POLL_MS = 1500;
const DEBOUNCE_MS = 1200;

export function useSheetCheck(opts: {
  bidId: string;
  /** Changes whenever the analysis inputs change ('' = no inputs). */
  inputKey: string;
  /** The same inputs /analyze would get. */
  buildForm: () => FormData | null;
  canRun: boolean;
}) {
  const { bidId, inputKey, buildForm, canRun } = opts;
  const [data, setData] = useState<SheetCheckData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const buildRef = useRef(buildForm);
  buildRef.current = buildForm;

  const stopPoll = () => { if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null; } };

  const load = useCallback(async (): Promise<SheetCheckData | null> => {
    try {
      const res = await api.get<SheetCheckData>(`/preconstruction/${bidId}/sheet-check`);
      const d = res?.data ?? null;
      if (alive.current && d) setData(d);
      return d;
    } catch {
      return null;
    }
  }, [bidId]);

  const poll = useCallback(() => {
    stopPoll();
    pollTimer.current = setTimeout(async () => {
      const d = await load();
      if (alive.current && d?.status === 'running') poll();
    }, POLL_MS);
  }, [load]);

  const run = useCallback(async () => {
    const fd = buildRef.current();
    if (!fd || !canRun) return;
    setError(null);
    try {
      const res = await api.post<SheetCheckData>(`/preconstruction/${bidId}/sheet-check/run`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (!alive.current) return;
      if (res?.data) setData(res.data);
      if (res?.data?.status === 'running') poll();
    } catch (err: unknown) {
      if (alive.current) setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'The sheet check could not start.');
    }
  }, [bidId, canRun, poll]);

  const update = useCallback(async (body: SheetCheckUpdate): Promise<boolean> => {
    try {
      const res = await api.put<SheetCheckData>(`/preconstruction/${bidId}/sheet-check`, body);
      if (alive.current && res?.data) setData(res.data);
      return true;
    } catch (err: unknown) {
      if (alive.current) setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'The change could not be saved.');
      return false;
    }
  }, [bidId]);

  useEffect(() => {
    alive.current = true;
    void load().then(d => { if (d?.status === 'running') poll(); });
    return () => { alive.current = false; stopPoll(); };
  }, [load, poll]);

  // Automatic: a new check whenever the inputs change (never on first load —
  // the stored check is shown until something changes).
  const lastKey = useRef(inputKey);
  useEffect(() => {
    if (inputKey === lastKey.current) return;
    lastKey.current = inputKey;
    if (!inputKey || !canRun) return;
    const t = setTimeout(() => { void run(); }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [inputKey, canRun, run]);

  return { data, error, run, update, reload: load };
}
