// Takeoff accuracy Task 12 — the pre-bid package for Chris lives at the END
// of the Takeoff step now (Jake's order: analysis -> pre-bid package -> Chris
// prices it -> proposal). It builds from the pre-bid DRAFT (scope + takeoff,
// no price), which is composed right after the analysis once the takeoff
// review is clear — no Agent 4 proposal run needed. A bid from before drafts
// still builds from its Agent 4 output.
import React, { useEffect, useRef, useState } from 'react';
import api from '../../../api/client';
import Icon from '../../../components/Icon';
import type { Bid, Toast } from '../../../types';
import type { AiResults } from './shared';

interface Props {
  bid: Bid;
  aiResults: AiResults;
  setAiResults: (r: Record<string, unknown> | null) => void;
  generatePrebidPackage: () => void;
  prebidBusy: boolean;
  prebidResult: { scopeDocumentId: string | null; takeoffDocumentId: string | null } | null;
  downloadFiledDocument: (docId: string, filename: string) => void;
  emailPrebidToChris: () => void;
  chrisDraftBusy: boolean;
  chrisDraftLink: string | null;
  showToast: (t: Toast) => void;
}

export default function PrebidPackagePanel({
  bid, aiResults, setAiResults, generatePrebidPackage, prebidBusy, prebidResult, downloadFiledDocument,
  emailPrebidToChris, chrisDraftBusy, chrisDraftLink, showToast,
}: Props) {
  const draftStatus = aiResults?.draft_status as string | null | undefined;
  const reviewBlocked = aiResults?.review_status === 'needs_review' || aiResults?.review_status === 'pending';
  // A bid from before drafts (and before run ids) builds from its Agent 4 output.
  const legacy = !aiResults?.draft_output && !!aiResults?.agent4_output && !aiResults?.run_id;
  // Fix round 1 / S12 — a draft whose scope inputs changed is never used.
  const stale = draftStatus === 'complete' && !!aiResults?.draft_stale;
  const ready = (draftStatus === 'complete' && !stale) || legacy;
  const [starting, setStarting] = useState(false);

  // Poll while the draft composes (it runs in the background).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (draftStatus !== 'running') return;
    let cancelled = false;
    const tick = async () => {
      try {
        const { data } = await api.get(`/preconstruction/${bid.id}/results`);
        if (cancelled) return;
        if (data?.draft_status === 'running') timer.current = setTimeout(tick, 4000);
        else setAiResults(data);
      } catch { if (!cancelled) timer.current = setTimeout(tick, 8000); }
    };
    timer.current = setTimeout(tick, 4000);
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
  }, [draftStatus, bid.id, setAiResults]);

  if (aiResults?.status !== 'complete' && !legacy) return null;

  const compose = async () => {
    setStarting(true);
    try {
      await api.post(`/preconstruction/${bid.id}/compose-draft`);
      setAiResults({ ...(aiResults ?? {}), draft_status: 'running', draft_error: null });
    } catch (err) {
      showToast({ variant: 'error', title: 'Could not compose the pre-bid draft', sub: (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Try again' });
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="panel" style={{ margin: '12px 24px 16px' }} data-testid="prebid-package">
      <div className="panel-hdr">
        <span className="panel-title">
          <span className="pt-ic"><Icon name="users" size={14} stroke={1.9}/></span>
          Pre-Bid Package for Chris
          <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Internal only · no price</span>
        </span>
      </div>
      <div style={{ padding: '14px 20px' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 12 }}>
          The internal scope docx and a confidence-coded takeoff xlsx for Chris to price, built from the pre-bid draft
          (composed right after the analysis). His price, notes and included / not-included list then go into the proposal
          in Review &amp; Proposal.
        </div>
        {reviewBlocked && (
          <div data-testid="prebid-waiting-review" style={{ fontSize: 12.5, color: 'var(--amber)', fontWeight: 700, marginBottom: 10 }}>
            Resolve the takeoff review above — the pre-bid draft is composed as soon as it’s clear.
          </div>
        )}
        {!reviewBlocked && draftStatus === 'running' && (
          <div data-testid="prebid-composing" style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 10 }}>Composing the pre-bid draft…</div>
        )}
        {!reviewBlocked && draftStatus === 'error' && (
          <div data-testid="prebid-draft-error" style={{ fontSize: 12.5, color: 'var(--red)', marginBottom: 10 }}>
            The pre-bid draft did not compose: {String(aiResults?.draft_error ?? 'unknown error')}
          </div>
        )}
        {!reviewBlocked && stale && (
          <div data-testid="prebid-draft-stale" style={{ fontSize: 12.5, color: 'var(--amber)', fontWeight: 700, marginBottom: 10 }}>
            The pre-bid draft is out of date — the scope inputs changed after it was composed. Compose it again before building the package.
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn ghost" onClick={generatePrebidPackage} disabled={prebidBusy || !ready} style={{ fontSize: 13 }}>
            <Icon name="doc" size={14} stroke={1.9}/> {prebidBusy ? 'Generating…' : 'Generate Pre-Bid Package for Chris'}
          </button>
          {!reviewBlocked && !legacy && draftStatus !== 'running' && (draftStatus !== 'complete' || stale) && (
            <button className="btn ghost" onClick={() => void compose()} disabled={starting} style={{ fontSize: 13 }}>
              {starting ? 'Starting…' : draftStatus === 'error' || stale ? 'Compose the draft again' : 'Compose pre-bid draft'}
            </button>
          )}
        </div>
        {prebidResult && (
          <div style={{ marginTop: 12, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {prebidResult.scopeDocumentId && (
              <button onClick={() => downloadFiledDocument(prebidResult.scopeDocumentId!, `PreBid Scope — ${bid.name}.docx`)}
                style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                <Icon name="doc" size={12} stroke={2}/> Download Pre-Bid Scope
              </button>
            )}
            {prebidResult.takeoffDocumentId && (
              <button onClick={() => downloadFiledDocument(prebidResult.takeoffDocumentId!, `PreBid Takeoff — ${bid.name}.xlsx`)}
                style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                <Icon name="doc" size={12} stroke={2}/> Download Pre-Bid Takeoff
              </button>
            )}
          </div>
        )}
        {prebidResult && (prebidResult.scopeDocumentId || prebidResult.takeoffDocumentId) && (
          <div style={{ marginTop: 12 }}>
            <button className="btn ghost" onClick={emailPrebidToChris} disabled={chrisDraftBusy} style={{ fontSize: 12.5 }}>
              <Icon name="mail" size={13} stroke={1.9}/> {chrisDraftBusy ? 'Drafting…' : 'Email to Chris (draft)'}
            </button>
            {chrisDraftLink && (
              <a href={chrisDraftLink} target="_blank" rel="noreferrer" style={{ marginLeft: 10, fontSize: 12, fontWeight: 700, color: 'var(--blue)' }}>Open draft in Outlook →</a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
