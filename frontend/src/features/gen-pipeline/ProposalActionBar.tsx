// The top of the proposal drawer: who the customer is, where the deal stands, and the
// one thing to do next.
//
// The Overview tab used to open with a price and a stage selector, then a screen of
// read-only detail, with every action — view, send, kickoff, close, delete — stranded at
// the bottom. Sending wasn't there at all; it only existed in the builder after a save,
// so a rep couldn't resend from the record. And the customer's phone and email sat unused
// in form_data while the drawer showed only a city.
//
// So: contact details you can act on, a single primary button that follows the stage, and
// everything rare or destructive folded into an overflow.
import React, { useMemo, useState } from 'react';
import Icon from '../../components/Icon';
import { Gen } from '../../types';
import { GenForm } from '../builder/genData';
import { moneyFull } from '../../lib/money';

function parseSnapshot<T extends object>(raw: unknown): Partial<T> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Partial<T>; } catch { return null; }
  }
  return raw as Partial<T>;
}

function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

function ago(days: number | null): string {
  if (days === null) return '';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export interface ActionBarProps {
  gen: Gen;
  onView: () => void;
  onEdit: () => void;
  onSend: () => void;
  onCountersign: () => void;
  onKickoff: () => void;
  onAddOption: () => void;
  onBuildFromNotes: () => void;
  onCloseJob: () => void;
  onDelete: () => void;
  canDelete: boolean;
  closingJob?: boolean;
}

/** The single most useful next action, and what to call it, for each stage. */
function primaryAction(gen: Gen, p: ActionBarProps): { label: string; onClick: () => void } | null {
  if (gen.stage === 'building') return { label: 'Send proposal', onClick: p.onSend };
  if (gen.stage === 'sent')     return { label: 'Resend proposal', onClick: p.onSend };
  if (gen.stage === 'signed')   return { label: 'Countersign & award', onClick: p.onCountersign };
  if (gen.stage === 'awarded')  return { label: 'Open kickoff', onClick: p.onKickoff };
  return null;
}

/** One line saying what state the deal is actually in — the thing a rep would otherwise
 *  work out by reading timestamps. Ordered most-urgent first. */
function statusLine(gen: Gen): { text: string; tone: 'wait' | 'act' | 'good' } | null {
  if (gen.stage === 'awarded') return { text: 'Won. Kickoff is the next step.', tone: 'good' };
  if (gen.signed_at && !gen.countersigned_at) {
    return { text: 'Signed by the customer — waiting on your signature.', tone: 'act' };
  }
  if (gen.countersigned_at) return { text: 'Executed by both parties.', tone: 'good' };
  if (gen.stage === 'sent') {
    const sent = daysSince(gen.sent_at);
    if (gen.viewed_at) {
      const seen = daysSince(gen.viewed_at);
      return { text: `Opened ${ago(seen)}, not signed yet.`, tone: seen !== null && seen >= 3 ? 'act' : 'wait' };
    }
    if (sent !== null && sent >= 3) return { text: `Sent ${ago(sent)}, never opened.`, tone: 'act' };
    return { text: `Sent ${ago(sent)}. Not opened yet.`, tone: 'wait' };
  }
  if (gen.stage === 'building') return { text: 'Not sent yet.', tone: 'wait' };
  return null;
}

export default function ProposalActionBar(props: ActionBarProps) {
  const { gen } = props;
  const [menu, setMenu] = useState(false);

  const form = useMemo(() => parseSnapshot<GenForm>(gen.form_data), [gen.form_data]);
  const phone = (form?.phone || '').trim();
  const email = (form?.email || '').trim();
  const street = (form?.address || '').trim();
  const cityLine = [form?.city, form?.state].filter(Boolean).join(', ');
  const fullAddress = [street, cityLine, form?.zip].filter(Boolean).join(' ') || gen.loc || '';

  const primary = primaryAction(gen, props);
  const status = statusLine(gen);
  const stageAge = daysSince(gen.stage === 'sent' ? gen.sent_at : gen.built_on);

  const toneColor = status?.tone === 'act' ? 'var(--amber)'
    : status?.tone === 'good' ? 'var(--green)'
    : 'var(--text3)';

  const contactBtn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    fontSize: 12.5, fontWeight: 600, color: 'var(--text2)',
    textDecoration: 'none', minHeight: 32,
  };

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Identity: amount and machine on one line, so the scan is price-first. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 2 }}>
        <span className="num" style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)', letterSpacing: '-.02em' }}>
          {moneyFull(Number(gen.amount))}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text3)' }}>
          {gen.mfr}{gen.kw ? ` ${Number(gen.kw)}kW` : ''}
          {stageAge !== null && gen.stage !== 'awarded' ? ` · ${ago(stageAge)}` : ''}
        </span>
      </div>

      {status && (
        <div style={{ fontSize: 12.5, fontWeight: 700, color: toneColor, marginBottom: 12 }}>
          {status.text}
        </div>
      )}

      {/* Contact — tappable, because this is what a rep standing at a truck needs. */}
      {(phone || email || fullAddress) && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center',
          padding: '10px 12px', marginBottom: 12,
          background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 10,
        }}>
          {phone && (
            <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} style={contactBtn}>
              <Icon name="phone" size={13} stroke={1.9}/>{phone}
            </a>
          )}
          {email && (
            <a href={`mailto:${email}`} style={{ ...contactBtn, minWidth: 0 }}>
              <Icon name="mail" size={13} stroke={1.9}/>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 190 }}>{email}</span>
            </a>
          )}
          {fullAddress && (
            <a href={`https://maps.apple.com/?q=${encodeURIComponent(fullAddress)}`}
              target="_blank" rel="noreferrer" style={contactBtn}>
              <Icon name="pin" size={13} stroke={1.9}/>{cityLine || fullAddress}
            </a>
          )}
        </div>
      )}

      {/* Actions. One primary that follows the stage; view and edit always; the rest
          folded away so Delete stops sitting beside buttons pressed daily. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {primary && (
          <button className="btn" style={{ flex: 1, justifyContent: 'center', minHeight: 40 }}
            onClick={primary.onClick}>
            {primary.label}
          </button>
        )}
        <button className="btn ghost" style={{ minHeight: 40 }} onClick={props.onView} title="View the customer's proposal">
          <Icon name="eye" size={15} stroke={1.9}/>View
        </button>
        <button className="btn ghost" style={{ minHeight: 40 }} onClick={props.onEdit} title="Edit in the builder">
          <Icon name="edit" size={15} stroke={1.9}/>Edit
        </button>
        <div style={{ position: 'relative' }}>
          <button className="btn ghost" style={{ minHeight: 40, padding: '0 10px' }}
            aria-label="More actions" aria-expanded={menu}
            onClick={() => setMenu(m => !m)}>
            ⋯
          </button>
          {menu && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setMenu(false)}/>
              <div style={{
                position: 'absolute', right: 0, top: '100%', marginTop: 6, zIndex: 41,
                background: 'var(--panel)', border: '1px solid var(--border2)', borderRadius: 10,
                boxShadow: 'var(--shadow)', minWidth: 210, overflow: 'hidden',
              }}>
                {[
                  { label: 'Add option for this customer', fn: props.onAddOption },
                  { label: 'Build from site notes', fn: props.onBuildFromNotes },
                  ...(gen.stage === 'awarded' ? [{ label: props.closingJob ? 'Closing…' : 'Close job', fn: props.onCloseJob }] : []),
                ].map(item => (
                  <button key={item.label} onClick={() => { setMenu(false); item.fn(); }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px',
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 13, fontWeight: 600, color: 'var(--text2)',
                    }}>
                    {item.label}
                  </button>
                ))}
                {props.canDelete && (
                  <button onClick={() => { setMenu(false); props.onDelete(); }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px',
                      background: 'none', border: 'none', borderTop: '1px solid var(--border2)',
                      cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--red, #ef4444)',
                    }}>
                    Delete proposal
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
