import React from 'react';
import Icon from './Icon';

/**
 * Shown when the app's own dashboard fetch fails. Before this the app rendered
 * its normal shell with empty `bids`/`gens`/`wonJobs`, so every board and stat
 * read as a legitimate "no records" state and a user could conclude their
 * pipeline had been deleted (audit ux #1 / code #2).
 */
export default function BootError({ message, onRetry, retrying }: {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center',
    }}>
      <span style={{
        width: 46, height: 46, borderRadius: 12, display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'var(--red-soft)', color: 'var(--red)',
      }}>
        <Icon name="alert" size={24} stroke={2}/>
      </span>
      <div style={{ fontSize: 19, fontWeight: 800 }}>Couldn't load your data</div>
      <div style={{ fontSize: 13.5, color: 'var(--text2)', maxWidth: 420, lineHeight: 1.6 }}>
        {message} Nothing has been lost — this is a problem reaching the server, not with
        your records.
      </div>
      <button className="btn" onClick={onRetry} disabled={retrying} style={{ marginTop: 4 }}>
        {retrying ? 'Retrying…' : 'Try again'}
      </button>
    </div>
  );
}
