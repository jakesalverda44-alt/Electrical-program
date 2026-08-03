// The signed contract, on the card it belongs to.
//
// The archive PDF is normally produced in the CUSTOMER's browser right after they sign
// (ProposalPublicPage). That rasterize can fail quietly — an 8-page render at scale 1.5
// on a phone can exhaust memory, or the buyer can close the tab before the upload lands.
// When it does, the proposal is still signed but the job has no contract on file.
//
// Everything needed to reproduce the document byte-for-byte is on the row already
// (form_data, totals_data, signature_data, initials_data, signed_at), so this rebuilds
// the identical PDF from the rep's browser instead of depending on the customer's. It
// uses the same rasterizer the customer-side path uses, so a rebuilt archive is not a
// second, drifting rendering of the contract.
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

interface Props {
  gen: Gen;
}

export default function SignedContractCard({ gen }: Props) {
  const showToast = useShowToast();
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [building, setBuilding] = useState(false);
  const [staged, setStaged] = useState(false);
  const offscreenRef = useRef<HTMLDivElement>(null);

  const signedAt = gen.signed_at;

  useEffect(() => {
    if (!signedAt) return;
    api.get<DocRow[]>('/documents', { params: { linked_id: gen.id } })
      .then(r => setDocs(r.data))
      .catch(() => setDocs([]));
  }, [gen.id, signedAt]);

  const existing = docs?.find(isSignedContract) ?? null;

  const form = useMemo(() => {
    const raw = parseSnapshot<GenForm>(gen.form_data);
    return raw ? migrateGenForm(raw as unknown as Record<string, unknown>) as unknown as GenForm : null;
  }, [gen.form_data]);

  const totals = useMemo(() => {
    const snap = parseSnapshot<GenTotals>(gen.totals_data);
    if (snap) return snap as GenTotals;
    return form ? calcGenTotals(form) : null;
  }, [gen.totals_data, form]);

  const signedDate = signedAt
    ? new Date(signedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';

  const open = async () => {
    if (!existing) return;
    try {
      const res = await api.get(`/documents/${existing.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      showToast({ title: "Couldn't open the contract", sub: 'Try again in a moment.' });
    }
  };

  const rebuild = async () => {
    if (!form || !totals) {
      showToast({ title: "Can't rebuild this one", sub: 'The saved proposal data is incomplete.' });
      return;
    }
    setBuilding(true);
    // Mount the document offscreen, let it paint, then rasterize it. Two frames is what
    // the customer-side path waits for images to settle before capture.
    setStaged(true);
    try {
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      if (!offscreenRef.current) throw new Error('render failed');
      const blob = await buildContractPdf(offscreenRef.current);

      const fd = new FormData();
      const name = signedContractFilename(gen.customer);
      fd.append('file', blob, name);
      fd.append('linked_id', gen.id);
      fd.append('linked_name', gen.customer);
      fd.append('div', 'gen');
      fd.append('category', 'contract');
      fd.append('display_name', name);
      const { data } = await api.post<DocRow>('/documents', fd, { timeout: 120_000 });

      setDocs(prev => [data, ...(prev ?? [])]);
      showToast({ title: 'Signed contract archived', sub: 'Saved to this job’s files.' });
    } catch {
      showToast({ title: 'Rebuild failed', sub: 'Try again, or print the proposal link instead.' });
    } finally {
      setStaged(false);
      setBuilding(false);
    }
  };

  if (!signedAt) return null;

  return (
    <div style={{ border: '1px solid var(--border2)', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="clip" size={15} stroke={2}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Signed Contract</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>
            {docs === null ? 'Checking…'
              : existing ? `Signed ${signedDate}`
              : `Signed ${signedDate} — not archived`}
          </div>
        </div>
        {docs !== null && (existing ? (
          <button className="btn ghost" onClick={open} style={{ minHeight: 36 }}>Open</button>
        ) : (
          <button className="btn" onClick={rebuild} disabled={building} style={{ minHeight: 36 }}>
            {building ? 'Building…' : 'Rebuild'}
          </button>
        ))}
      </div>

      {/* Offscreen render target — mounted only while rebuilding. Kept on-screen-sized
          and merely shifted out of view rather than display:none, because html2canvas
          cannot capture an element that was never laid out. */}
      {staged && form && totals && (
        <div style={{ position: 'fixed', left: -10000, top: 0, width: 760, background: '#fff', pointerEvents: 'none' }} aria-hidden>
          <div ref={offscreenRef}>
            <ProposalPreview
              embed
              form={form}
              totals={totals}
              proposalNo={gen.proposal_no || ''}
              signatureImage={gen.signature_data || undefined}
              initialsImage={gen.initials_data || undefined}
              signedDate={signedDate || undefined}
            />
          </div>
        </div>
      )}
    </div>
  );
}
