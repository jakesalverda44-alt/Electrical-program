// UI cleanup round 2B — one collapsible section of Labor & Pricing. The body is
// hidden (never unmounted) when closed, so typed-but-unsaved values survive a
// fold. `pinned` is always visible: anything that blocks Save or sending lives
// there (or outside a card), never in the folding body.
import React, { useId } from 'react';
import Icon from '../../../components/Icon';
import { useStoredDisclosure } from '../useStoredDisclosure';

export interface PricingCardProps {
  storageKey: string;
  defaultOpen: boolean;
  title: string;
  testId: string;
  /** Always shown in the header. */
  summary?: React.ReactNode;
  /** Always visible, between header and body — never folded away. */
  pinned?: React.ReactNode;
  /** Default true; false = a plain heading and the body is always shown. */
  collapsible?: boolean;
  children?: React.ReactNode;
}

export function PricingCard({ storageKey, defaultOpen, title, testId, summary, pinned, collapsible = true, children }: PricingCardProps) {
  const { open, toggle } = useStoredDisclosure(storageKey, defaultOpen);
  const bodyId = useId();
  return (
    <section className="lp-card" data-testid={testId}>
      <h3 className="lp-card-title">
        {collapsible ? (
          <button type="button" className="lp-card-toggle" aria-expanded={open} aria-controls={bodyId} data-testid={`${testId}-toggle`} onClick={toggle}>
            <Icon name="chevron-down" size={14} stroke={2} style={open ? undefined : { transform: 'rotate(-90deg)' }} />
            <span className="lp-card-name">{title}</span>
            {summary != null && <span className="lp-card-summary" data-testid={`${testId}-summary`}>{summary}</span>}
          </button>
        ) : (
          <span className="lp-card-static">
            <span className="lp-card-name">{title}</span>
            {summary != null && <span className="lp-card-summary" data-testid={`${testId}-summary`}>{summary}</span>}
          </span>
        )}
      </h3>
      {pinned != null && <div className="lp-card-pinned">{pinned}</div>}
      {children != null && <div id={bodyId} className="lp-card-body" data-testid={`${testId}-body`} hidden={collapsible && !open}>{children}</div>}
    </section>
  );
}
