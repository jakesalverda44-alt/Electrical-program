import React, { useEffect } from 'react';
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
};

export default function BriefDrawer({ item, onClose, onNav, onMarkContacted, markingContacted }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cta = item?.cta;

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
