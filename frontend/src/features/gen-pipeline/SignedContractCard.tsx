// The contract, on the card it belongs to — and the place it gets executed.
//
// The buyer-signed archive PDF is normally produced in the CUSTOMER's browser right after
// they sign (ProposalPublicPage). That rasterize can fail quietly — an 8-page render on a
// phone can exhaust memory, or the buyer can close the tab before the upload lands. When
// it does, the proposal is still signed but the job has no contract on file.
//
// Everything needed to reproduce the document is on the row already (form_data,
// totals_data, signature_data, initials_data, signed_at, and the countersignature), so
// this rebuilds it from the rep's browser instead of depending on the customer's, using
// the same rasterizer so a rebuilt archive is not a second, drifting rendering.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api/client';
import Icon from '../../components/Icon';
import { useShowToast } from '../../contexts/AppContext';
import ProposalPreview from '../builder/ProposalPreview';
import { GenForm } from '../builder/genData';
import { GenTotals, calcGenTotals, migrateGenForm } from '../builder/genCalc';
import { buildContractPdf, signedContractFilename } from '../../lib/signedContractPdf';
import { Gen } from '../../types';

interface DocRow {
  id: string;
  name: string;
  category: string;
}

function parseSnapshot<T extends object>(raw: unknown): Partial<T> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Partial<T>; } catch { return null; }
  }
  return raw as Partial<T>;
}

// Matches the name the customer-side upload route writes, so a rebuild and an
// automatic archive are recognised as the same artifact.
function isSignedContract(d: DocRow) {
  return d.category === 'contract' && d.name.startsWith('Signed Proposal');
}

// The fully executed copy is filed alongside the buyer-signed one rather than replacing
// it: deleting documents needs admin, and keeping both leaves a record of what the
// customer actually signed before APT countersigned it.
function executedContractFilename(customer: string) {
  return `Executed Contract - ${customer || 'Customer'}.pdf`;
}
function isExecutedContract(d: DocRow) {
  return d.category === 'contract' && d.name.startsWith('Executed Contract');
}

interface Props {
  gen: Gen;
  /** Siblings in the same option group — named in the countersign confirmation, since
   *  executing the contract supersedes every one of them. */
  siblings?: Gen[];
  onUpdated?: (gen: Gen) => void;
}

export default function SignedContractCard({ gen, siblings = [], onUpdated }: Props) {
  const showToast = useShowToast();
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [building, setBuilding] = useState(false);
  const [staged, setStaged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [countersigning, setCountersigning] = useState(false);
  // The countersigned row, held locally so the offscreen render picks up the new marks
  // in the same pass rather than waiting for the parent to hand `gen` back down.
  const [fresh, setFresh] = useState<Gen | null>(null);
  const offscreenRef = useRef<HTMLDivElement>(null);

  const g = fresh ?? gen;
  const signedAt = g.signed_at;
  const countersignedAt = g.countersigned_at;

  useEffect(() => {
    if (!signedAt) return;
    api.get<DocRow[]>('/documents', { params: { linked_id: gen.id } })
      .then(r => setDocs(r.data))
      .catch(() => setDocs([]));
  }, [gen.id, signedAt]);

  const executedDoc = docs?.find(isExecutedContract) ?? null;
  const signedDoc = docs?.find(isSignedContract) ?? null;
  // Once executed, the executed copy is the one worth opening.
  const current = executedDoc ?? signedDoc;

  const form = useMemo(() => {
    const raw = parseSnapshot<GenForm>(g.form_data);
    return raw ? migrateGenForm(raw as unknown as Record<string, unknown>) as unknown as GenForm : null;
  }, [g.form_data]);

  const totals = useMemo(() => {
    const snap = parseSnapshot<GenTotals>(g.totals_data);
    if (snap) return snap as GenTotals;
    return form ? calcGenTotals(form) : null;
  }, [g.totals_data, form]);

  const fmt = (d?: string | null) => d
    ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';
  const signedDate = fmt(signedAt);
  const countersignDate = fmt(countersignedAt);

  // Only siblings still in play get superseded; ones already awarded or superseded are
  // left alone by the backend, so naming them would overstate what is about to happen.
  const atRisk = siblings.filter(s =>
    s.id !== gen.id && s.stage !== 'awarded' && s.stage !== 'superseded');

  const open = async () => {
    if (!current) return;
    try {
      const res = await api.get(`/documents/${current.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      showToast({ title: "Couldn't open the contract", sub: 'Try again in a moment.' });
    }
  };

  // Renders the document offscreen from stored data and files the resulting PDF.
  // `executed` picks which name it is filed under, which is also how the card tells the
  // buyer-signed copy from the fully executed one.
  const archive = async (executed: boolean) => {
    if (!form || !totals) {
      showToast({ title: "Can't rebuild this one", sub: 'The saved proposal data is incomplete.' });
      return false;
    }
    setBuilding(true);
    setStaged(true);
    try {
      // Let the offscreen copy mount and paint before capturing it. Two frames is what
      // the customer-side path waits for images to settle.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      if (!offscreenRef.current) throw new Error('render failed');
      const blob = await buildContractPdf(offscreenRef.current);

      const name = executed ? executedContractFilename(g.customer) : signedContractFilename(g.customer);
      const fd = new FormData();
      fd.append('file', blob, name);
      fd.append('linked_id', gen.id);
      fd.append('linked_name', g.customer);
      fd.append('div', 'gen');
      fd.append('category', 'contract');
      fd.append('display_name', name);
      const { data } = await api.post<DocRow>('/documents', fd, { timeout: 120_000 });

      setDocs(prev => [data, ...(prev ?? [])]);
      return true;
    } catch {
      showToast({ title: 'Rebuild failed', sub: 'Try again, or print the proposal link instead.' });
      return false;
    } finally {
      setStaged(false);
      setBuilding(false);
    }
  };

  const rebuild = async () => {
    const ok = await archive(!!countersignedAt);
    if (ok) showToast({ title: 'Contract archived', sub: 'Saved to this job’s files.' });
  };

  const countersign = async () => {
    setConfirming(false);
    setCountersigning(true);
    try {
      const { data } = await api.post<{ gen: Gen }>(`/gens/${gen.id}/countersign`);
      setFresh(data.gen);
      onUpdated?.(data.gen);
      showToast({ title: 'Contract executed', sub: 'Awarded, and the job is now on the board.' });
      // File the executed copy so the document on record shows both signatures rather
      // than staying half-executed. Non-fatal — Rebuild can produce it later.
      await archive(true);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      if (status === 400) {
        showToast({ title: 'No signature on file', sub: 'Add your signature in Settings first.' });
      } else {
        showToast({ title: "Couldn't countersign", sub: msg || 'Try again in a moment.' });
      }
    } finally {
      setCountersigning(false);
    }
  };

  if (!signedAt) return null;

  const statusLine = countersignedAt
    ? `Executed ${countersignDate}`
    : `Signed ${signedDate} — awaiting your signature`;

  return (
    <div style={{ border: '1px solid var(--border2)', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Icon name="clip" size={15} stroke={2}/>
        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            {countersignedAt ? 'Executed Contract' : 'Signed Contract'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>
            {docs === null ? 'Checking…' : current ? statusLine : `${statusLine} · not archived`}
          </div>
        </div>

        {docs !== null && (
          <div style={{ display: 'flex', gap: 6 }}>
            {current && (
              <button className="btn ghost" onClick={open} style={{ minHeight: 36 }}>Open</button>
            )}
            {!current && (
              <button className="btn ghost" onClick={rebuild} disabled={building} style={{ minHeight: 36 }}>
                {building ? 'Building…' : 'Rebuild'}
              </button>
            )}
            {!countersignedAt && (
              <button className="btn" onClick={() => setConfirming(true)} disabled={countersigning || building}
                style={{ minHeight: 36 }}>
                {countersigning ? 'Signing…' : 'Countersign'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Countersigning executes the contract AND awards the deal, which books a won job,
          earns commission, creates a project, and supersedes the other options. None of
          that should happen behind a one-word button, so spell it out first. */}
      {confirming && (
        <div className="overlay" onClick={() => setConfirming(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-hdr"><h3>Countersign &amp; award</h3></div>
            <div className="modal-body" style={{ fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.65 }}>
              <div style={{ marginBottom: 10 }}>
                Signing <strong>{g.customer}</strong> executes the contract and awards the deal. That will:
              </div>
              <ul style={{ margin: '0 0 12px 18px', padding: 0 }}>
                <li>book it as a won job and earn the commission</li>
                <li>create the project</li>
                <li>move the card to Awarded</li>
              </ul>
              {atRisk.length > 0 && (
                <div style={{ padding: '10px 12px', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 8, marginBottom: 4 }}>
                  <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
                    {atRisk.length} other option{atRisk.length === 1 ? '' : 's'} will be superseded:
                  </div>
                  <ul style={{ margin: '0 0 0 18px', padding: 0 }}>
                    {atRisk.map(s => (
                      <li key={s.id}>{s.mfr} {s.kw ? `${s.kw}KW` : ''} — {s.proposal_no || 'no number'}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>This can’t be undone from here.</div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirming(false)}>Cancel</button>
              <button className="btn" onClick={countersign}>Countersign &amp; award</button>
            </div>
          </div>
        </div>
      )}

      {/* Offscreen render target — mounted only while archiving. Kept on-screen-sized and
          merely shifted out of view rather than display:none, because html2canvas cannot
          capture an element that was never laid out. */}
      {staged && form && totals && (
        <div style={{ position: 'fixed', left: -10000, top: 0, width: 760, background: '#fff', pointerEvents: 'none' }} aria-hidden>
          <div ref={offscreenRef}>
            <ProposalPreview
              embed
              form={form}
              totals={totals}
              proposalNo={g.proposal_no || ''}
              signatureImage={g.signature_data || undefined}
              initialsImage={g.initials_data || undefined}
              signedDate={signedDate || undefined}
              countersignImage={g.countersignature_data || undefined}
              countersignDate={countersignDate || undefined}
            />
          </div>
        </div>
      )}
    </div>
  );
}
