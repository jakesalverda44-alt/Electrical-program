import React from 'react';

/**
 * A real 404. The `default` case of renderView() used to title-case the unknown
 * path and render "<Whatever> — coming soon", so a typo or a stale bookmark
 * looked like a planned feature instead of a broken link (audit code #17).
 */
export default function NotFound({ path, onHome }: { path: string; onHome: () => void }) {
  return (
    <div className="scroll view-enter">
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 12, padding: '80px 24px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 40, fontWeight: 800, color: 'var(--text3)', letterSpacing: '-1px' }}>404</div>
        <div style={{ fontSize: 18, fontWeight: 800 }}>Page not found</div>
        <div style={{ fontSize: 13.5, color: 'var(--text2)', maxWidth: 420, lineHeight: 1.6 }}>
          There's nothing at <code style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>/{path}</code>.
          The link may be mistyped, or it may point at a section that has since been renamed.
        </div>
        <button className="btn" onClick={onHome} style={{ marginTop: 6 }}>Go to the dashboard</button>
      </div>
    </div>
  );
}
