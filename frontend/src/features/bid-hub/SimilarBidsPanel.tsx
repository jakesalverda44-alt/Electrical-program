// Overview-tab teaser for the Compare tab: the five closest past bids at a glance,
// with a button through to the full Compare view for the real diff.
import React, { useEffect, useState } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { moneyShort } from '../../lib/money';

interface SimilarBid {
  id: string; name: string; stage: string;
  brand: string | null; sq_ft: number | null; amount: string | null;
}

interface Props {
  bidId: string;
  onGoCompare: () => void;
}

function OutcomeBadge({ stage }: { stage: string }) {
  const cls = stage === 'awarded' ? 'won' : stage === 'lost' ? 'lost' : 'normal';
  const label = stage === 'awarded' ? 'Won' : stage === 'lost' ? 'Lost' : 'Open';
  return <span className={`badge ${cls}`}>{label}</span>;
}

export default function SimilarBidsPanel({ bidId, onGoCompare }: Props) {
  const [rows, setRows] = useState<SimilarBid[]>([]);
  const [noClassification, setNoClassification] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/preconstruction/${bidId}/comparables`)
      .then(({ data }) => {
        if (cancelled) return;
        setRows((data.comparables ?? []).slice(0, 5));
        const subj = data.bid;
        setNoClassification(!subj?.brand && !subj?.project_type);
      })
      .catch(() => { if (!cancelled) { setRows([]); setNoClassification(false); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bidId]);

  return (
    <div className="panel">
      <div className="panel-hdr"><span className="panel-title">Similar Past Bids</span></div>
      {loading ? (
        <div style={{ padding: '16px 18px', fontSize: 12.5, color: 'var(--text3)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '16px 18px', fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.6 }}>
          {noClassification ? 'Set a brand or project type to find similar bids.' : 'No comparable past bids yet.'}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {rows.map(r => {
              const sf = r.sq_ft ? Number(r.sq_ft) : null;
              const amt = r.amount ? Number(r.amount) : null;
              const perSf = amt && sf ? amt / sf : null;
              return (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  padding: '10px 18px', borderBottom: '1px solid var(--border2)',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {r.name}
                      <OutcomeBadge stage={r.stage}/>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                      {r.brand ? `${r.brand} · ` : ''}
                      {sf ? `${sf.toLocaleString()} SF` : '—'}
                      {perSf ? ` · $${perSf.toFixed(2)}/SF` : ''}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, flexShrink: 0 }}>{moneyShort(amt)}</div>
                </div>
              );
            })}
          </div>
          <div style={{ padding: 12 }}>
            <button className="btn ghost" style={{ width: '100%', justifyContent: 'center', color: 'var(--blue)' }} onClick={onGoCompare}>
              Compare in detail <Icon name="arrow" size={13} stroke={2.2}/>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
