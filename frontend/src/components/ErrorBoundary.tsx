import React from 'react';

interface Props {
  children: React.ReactNode;
  /**
   * 'root' (default) is the full-screen fallback in main.tsx. 'page' keeps the
   * shell and nav alive and replaces only the routed view, so one throwing page
   * no longer blanks the whole application (audit code #19).
   */
  variant?: 'root' | 'page';
  /** Changing this resets the boundary — used to clear the error on navigation. */
  resetKey?: string;
}
interface State { hasError: boolean; message?: string }

/**
 * Catches render-time errors anywhere in the tree and shows a friendly fallback
 * instead of a blank white screen. Without this, one unhandled exception unmounts
 * the entire app.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(err: unknown): State {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) };
  }

  componentDidUpdate(prev: Props) {
    // Navigating away from the page that threw should not leave the fallback up.
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, message: undefined });
    }
  }

  componentDidCatch(err: unknown, info: unknown) {
    console.error('[ErrorBoundary]', err, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.variant === 'page') {
      return (
        <div className="scroll view-enter">
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 12, padding: '70px 24px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>This page hit an error</div>
            <div style={{ fontSize: 13.5, color: 'var(--text2)', maxWidth: 440, lineHeight: 1.6 }}>
              The rest of the app is still working — use the navigation to go somewhere else,
              or reload to try this page again.
            </div>
            {this.state.message && (
              <div style={{
                fontSize: 12, color: 'var(--red)', maxWidth: 500, background: 'var(--red-soft)',
                border: '1px solid rgba(224,106,106,.3)', borderRadius: 8, padding: '10px 16px',
                textAlign: 'left', fontFamily: 'var(--mono)', wordBreak: 'break-word',
              }}>
                {this.state.message}
              </div>
            )}
            <button className="btn" onClick={() => window.location.reload()} style={{ marginTop: 4 }}>
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24,
        fontFamily: 'system-ui, sans-serif', background: '#0E1626', color: '#E6EDF7', textAlign: 'center',
      }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Something went wrong</div>
        <div style={{ fontSize: 14, color: '#94a3b8', maxWidth: 440, lineHeight: 1.6 }}>
          An unexpected error occurred. Try reloading the page. If the problem continues, contact an administrator.
        </div>
        {this.state.message && (
          <div style={{ fontSize: 12, color: '#f87171', maxWidth: 500, background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.3)', borderRadius: 8, padding: '10px 16px', textAlign: 'left', fontFamily: 'monospace', wordBreak: 'break-word' }}>
            {this.state.message}
          </div>
        )}
        <button
          onClick={() => window.location.reload()}
          style={{
            background: '#4D8DF7', color: '#fff', border: 'none', borderRadius: 8,
            padding: '10px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
