import React from 'react';

/**
 * The shared status pill (audit ux #6, #7). `styles.css` already defines a
 * full `.badge` system (`.badge.won/.lost/.urgent/.normal/.critical`) used
 * consistently by the pipeline boards, but several screens re-implemented
 * the same pill shape with inline styles and ad-hoc colors instead of
 * reaching for it. `Badge` is the one component both old and new call sites
 * should use; its `tone` prop maps onto the existing classes rather than
 * introducing a second, parallel palette.
 *
 * A handful of call sites (a lead's stage pill, a manufacturer chip) carry a
 * genuinely per-item accent color rather than one of the five fixed tones —
 * `color` overrides the tone's background/text for exactly those, while
 * still going through the same shape/size/font as everything else.
 */

export type BadgeTone = 'neutral' | 'info' | 'good' | 'warn' | 'bad';

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'lost',
  info: 'normal',
  good: 'won',
  warn: 'urgent',
  bad: 'critical',
};

export interface BadgeProps {
  tone?: BadgeTone;
  /** 'md' (the board-card default) or 'sm' (a tighter inline pill). */
  size?: 'sm' | 'md';
  /** Overrides the tone's background/text with a specific accent (e.g. a
   *  lead stage's own color) — background is derived by adding alpha. */
  color?: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export default function Badge({ tone = 'neutral', size = 'md', color, children, className, style }: BadgeProps) {
  const classes = ['badge', size === 'sm' ? 'sm' : null, !color ? TONE_CLASS[tone] : null]
    .filter(Boolean)
    .join(' ') + (className ? ` ${className}` : '');
  const colorStyle: React.CSSProperties | undefined = color
    ? { background: color + '22', color, borderColor: color + '33' }
    : undefined;
  return (
    <span className={classes} style={{ ...colorStyle, ...style }}>
      {children}
    </span>
  );
}
