import React, { useEffect, useState } from 'react';
import api from '../../api/client';
import { BriefAttentionItem } from '../../types';

interface Props {
  item: BriefAttentionItem | null;
  onClose: () => void;
  onNav: (v: string) => void;
  onMarkContacted?: (leadId: string) => void;
  markingContacted?: boolean;
}

const TYPE_SUB: Record<BriefAttentionItem['type'], string> = {
  'lead-call': 'Lead · call to make',
  email: 'Unread email',
  bid: 'Active bid',
  task: 'Follow-up due',
  'lead-stale': 'Lead · no response yet',
  'gen-signed': 'Signed proposal · ready to award',
};

export default function BriefDrawer({ item, onClose, onNav, onMarkContacted, markingContacted }: Props) {
  // 'idle' | 'busy' | 'done' | 'fail' — per-item, reset when the drawer switches items.
  const [draftState, setDraftState] = useState<'idle' | 'busy' | 'done' | 'fail'>('idle');

  useEffect(() => { setDraftState('idle'); }, [item?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cta = item?.cta;

  const draftReply = async () => {
    if (!item || draftState === 'busy' || draftState === 'done') return;
    setDraftState('busy');
    try {
      const graphId = item.id.slice('email:'.length);
      await api.post(`/brief/email/${encodeURIComponent(graphId)}/draft-reply`);
      setDraftState('done');
    } catch {
      setDraftState('fail');
    }
  };

  return (
    <>
      <div className={'cc-scrim' + (item ? ' open' : '')} onClick={onClose} />
      <div className={'cc-drawer' + (item ? ' open' : '')} role="dialog" aria-hidden={!item}>
        {item && (
          <>
            <div className="dh">
              <div>
                <h3>{item.title}</h3>
                <div className="sub">{item.subtitle || TYPE_SUB[item.type]}</div>
              </div>
              <button className="close" onClick={onClose} aria-label="Close">✕</button>
            </div>
            <div className="dbody">
              <div className="cc-ai">
                <div className="tag">⚡ Brief</div>
                {item.briefing}
              </div>
              <div className="cc-actions">
                {cta?.webLink && (
                  <a className="cc-btn p" href={cta.webLink} target="_blank" rel="noopener noreferrer">
                    Open in Outlook
                  </a>
                )}
                {item.type === 'email' && item.id.startsWith('email:') && (
                  <button className="cc-btn" disabled={draftState === 'busy' || draftState === 'done'} onClick={draftReply}>
                    {draftState === 'busy' ? 'Creating draft…'
                      : draftState === 'done' ? 'Draft ready in Outlook ✓'
                      : draftState === 'fail' ? 'Failed — try again'
                      : 'Draft reply in Outlook'}
                  </button>
                )}
                {cta?.tel && (
                  <a className="cc-btn p" href={cta.tel}>Call now</a>
                )}
                {cta?.leadId && onMarkContacted && (
                  <button className="cc-btn" disabled={markingContacted} onClick={() => onMarkContacted(cta.leadId!)}>
                    {markingContacted ? 'Logging…' : 'Mark contacted'}
                  </button>
                )}
                {cta?.navTo && (
                  <button className="cc-btn" onClick={() => { onNav(cta.navTo!); onClose(); }}>
                    Go to record
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
