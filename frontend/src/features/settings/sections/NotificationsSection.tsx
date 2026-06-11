import React, { useState, useEffect, useRef } from 'react';
import api from '../../../api/client';
import Icon from '../../../components/Icon';
import { User } from '../../../types';
import { AppSettings } from '../../../hooks/useAppSettings';
import { Field, SectionTitle, SaveBar, Toggle, RolePill, inputStyle, initials, timeAgo, ROLE_OPTIONS, ROLE_LABELS, ROLE_COLORS } from '../shared';
import { isPushSupported, isSubscribed, isIOS, isStandalone, enablePush, disablePush } from '../../../push';

/**
 * Per-device Web Push toggle. Subscriptions are tied to the browser/device, not the
 * saved settings form, so this manages its own state and side-effects independently.
 */
function DevicePushCard() {
  const supported = isPushSupported();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const needsInstall = isIOS() && !isStandalone();

  useEffect(() => { if (supported) isSubscribed().then(setOn); }, [supported]);

  const flip = async () => {
    setErr(''); setBusy(true);
    try {
      if (on) { await disablePush(); setOn(false); }
      else { await enablePush(); setOn(true); }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Could not change notification settings.');
    } finally { setBusy(false); }
  };

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>Push Alerts on This Device</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>Get a notification on this phone/computer for new leads that need a call and signed proposals — even when the app is closed.</div>
        </div>
        {supported && !needsInstall && <Toggle on={on} onToggle={busy ? () => {} : flip}/>}
      </div>
      {!supported && (
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>This browser doesn't support push notifications.</div>
      )}
      {supported && needsInstall && (
        <div style={{ background: 'var(--blue-soft)', border: '1px solid rgba(77,141,247,.25)', borderRadius: 10, padding: '12px 16px', fontSize: 12.5, color: 'var(--blue)' }}>
          To enable alerts on iPhone/iPad: tap the <strong>Share</strong> icon → <strong>Add to Home Screen</strong>, then open the CRM from that new icon and flip this toggle on.
        </div>
      )}
      {busy && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>Working…</div>}
      {err && <div style={{ fontSize: 12, color: '#e06a6a', marginTop: 6 }}>{err}</div>}
    </div>
  );
}

const NOTIF_EVENTS = [
  { key: 'proposal_sent',     label: 'Proposal Sent',     desc: 'When you send a generator proposal to a customer.' },
  { key: 'proposal_viewed',   label: 'Proposal Viewed',   desc: 'When a customer opens their proposal link.' },
  { key: 'proposal_signed',   label: 'Proposal Signed',   desc: 'When a customer accepts and signs.' },
  { key: 'job_won',           label: 'Job Won',           desc: 'When a bid or proposal is marked as awarded.' },
  { key: 'job_lost',          label: 'Job Lost / Declined', desc: 'When a proposal is declined.' },
];
interface ReminderTypePref { app: boolean; email: boolean; days?: number }
interface ReminderPrefs { recipients: string[]; types: Record<string, ReminderTypePref> }

const REMINDER_DEFAULTS: ReminderPrefs = {
  recipients: [],
  types: {
    followup_due:             { app: true, email: true },
    proposal_viewed_unsigned: { app: true, email: true, days: 3 },
    bid_due_soon:             { app: true, email: false, days: 3 },
  },
};

const REMINDER_TYPES: { key: string; label: string; desc: string; hasDays: boolean }[] = [
  { key: 'followup_due',             label: 'Follow-up due',            desc: 'When a follow-up task reaches its due date.', hasDays: false },
  { key: 'proposal_viewed_unsigned', label: 'Proposal viewed, not signed', desc: "When a customer opens a proposal but hasn't signed after N days.", hasDays: true },
  { key: 'bid_due_soon',             label: 'Bid due soon',             desc: 'When a bid is within N days of its due date.', hasDays: true },
];

function parseReminders(raw: string): ReminderPrefs {
  try {
    const r = (JSON.parse(raw || '{}').reminders ?? {}) as Partial<ReminderPrefs>;
    return {
      recipients: Array.isArray(r.recipients) ? r.recipients : [],
      types: {
        followup_due:             { ...REMINDER_DEFAULTS.types.followup_due, ...(r.types?.followup_due ?? {}) },
        proposal_viewed_unsigned: { ...REMINDER_DEFAULTS.types.proposal_viewed_unsigned, ...(r.types?.proposal_viewed_unsigned ?? {}) },
        bid_due_soon:             { ...REMINDER_DEFAULTS.types.bid_due_soon, ...(r.types?.bid_due_soon ?? {}) },
      },
    };
  } catch { return REMINDER_DEFAULTS; }
}

export function NotificationsSection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  // Flat event booleans (proposal_sent, etc.) live at the top level; reminder config lives under `reminders`.
  const parsePrefs = (): Record<string, boolean> => {
    try { const o = JSON.parse(settings.notifications_json || '{}'); delete o.reminders; return o; } catch { return {}; }
  };
  const parseEmails = (): string[] => {
    try { return JSON.parse(settings.bid_notify_emails || '[]'); } catch { return []; }
  };

  const [prefs,   setPrefs]   = useState<Record<string, boolean>>(parsePrefs);
  const [reminders, setReminders] = useState<ReminderPrefs>(() => parseReminders(settings.notifications_json));
  const [bidOn,   setBidOn]   = useState(settings.bid_notify_enabled !== 'false');
  const [emails,  setEmails]  = useState<string[]>(parseEmails);
  const [emailIn, setEmailIn] = useState('');
  const [remIn,   setRemIn]   = useState('');
  const [orig,    setOrig]    = useState('');
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);

  const snapshot = (p: Record<string, boolean>, r: ReminderPrefs, b: boolean, e: string[]) =>
    JSON.stringify({ p, r, b, e });

  useEffect(() => {
    const p = parsePrefs(); const r = parseReminders(settings.notifications_json);
    const b = settings.bid_notify_enabled !== 'false'; const e = parseEmails();
    setPrefs(p); setReminders(r); setBidOn(b); setEmails(e);
    setOrig(snapshot(p, r, b, e));
  }, [settings]);

  const hasChanges = snapshot(prefs, reminders, bidOn, emails) !== orig;
  const toggle     = (k: string) => setPrefs(p => ({ ...p, [k]: !p[k] }));

  const setRem = (key: string, patch: Partial<ReminderTypePref>) =>
    setReminders(r => ({ ...r, types: { ...r.types, [key]: { ...r.types[key], ...patch } } }));

  const addEmail = () => {
    const v = emailIn.trim().toLowerCase();
    if (!v || emails.includes(v)) return;
    setEmails(prev => [...prev, v]);
    setEmailIn('');
  };

  const addRem = () => {
    const v = remIn.trim().toLowerCase();
    if (!v || reminders.recipients.includes(v)) return;
    setReminders(r => ({ ...r, recipients: [...r.recipients, v] }));
    setRemIn('');
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/settings', {
        notifications_json:  JSON.stringify({ ...prefs, reminders }),
        bid_notify_enabled:  bidOn ? 'true' : 'false',
        bid_notify_emails:   JSON.stringify(emails),
      });
      setOrig(snapshot(prefs, reminders, bidOn, emails)); onSaved();
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  };

  return (
    <div>
      <SectionTitle title="Notifications" sub="Choose which events and reminders are sent, and how."/>

      <DevicePushCard/>

      {/* New bid email team */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>New Bid Notification</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Email the team list below whenever a new electrical bid is added to the pipeline.</div>
          </div>
          <Toggle on={bidOn} onToggle={() => setBidOn(o => !o)}/>
        </div>

        {/* Email chip list */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input
            type="email"
            value={emailIn}
            onChange={e => setEmailIn(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addEmail())}
            placeholder="estimator@accuratepower.com"
            style={{ flex: 1, height: 38, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border2)',
              background: 'var(--surface)', color: 'var(--text)', fontSize: 13, outline: 'none' }}
          />
          <button className="btn ghost" onClick={addEmail} style={{ height: 38, padding: '0 16px' }}>Add</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {emails.map(em => (
            <span key={em} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600,
              background: 'var(--blue-soft)', color: 'var(--blue)', border: '1px solid rgba(77,141,247,.25)',
              borderRadius: 20, padding: '4px 10px 4px 12px' }}>
              {em}
              <button onClick={() => setEmails(prev => prev.filter(x => x !== em))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--blue)', fontSize: 15, lineHeight: 1, padding: 0, display: 'flex' }}>×</button>
            </span>
          ))}
          {emails.length === 0 && <span style={{ fontSize: 12, color: 'var(--text3)' }}>No recipients added yet.</span>}
        </div>
      </div>

      {/* Proposal/job event toggles */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Proposal &amp; Job Events</div>
      <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '4px 0', marginBottom: 20 }}>
        {NOTIF_EVENTS.map((ev, i) => (
          <div key={ev.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: i < NOTIF_EVENTS.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{ev.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{ev.desc}</div>
            </div>
            <Toggle on={!!prefs[ev.key]} onToggle={() => toggle(ev.key)}/>
          </div>
        ))}
      </div>
      {/* Follow-up reminders — per type, choose App and/or Email */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Follow-up Reminders</div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>Choose how each reminder is delivered. App shows in the bell; Email sends to the recipients below.</div>
      <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '4px 0', marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 64px 92px', gap: 8, padding: '8px 18px', fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          <span>Reminder</span><span style={{ textAlign: 'center' }}>App</span><span style={{ textAlign: 'center' }}>Email</span><span style={{ textAlign: 'center' }}>Days</span>
        </div>
        {REMINDER_TYPES.map((rt, i) => {
          const cfg = reminders.types[rt.key];
          return (
            <div key={rt.key} style={{ display: 'grid', gridTemplateColumns: '1fr 64px 64px 92px', gap: 8, alignItems: 'center', padding: '12px 18px', borderTop: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{rt.label}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{rt.desc}</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center' }}><Toggle on={cfg.app} onToggle={() => setRem(rt.key, { app: !cfg.app })}/></div>
              <div style={{ display: 'flex', justifyContent: 'center' }}><Toggle on={cfg.email} onToggle={() => setRem(rt.key, { email: !cfg.email })}/></div>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                {rt.hasDays ? (
                  <input type="number" min={0} max={60} value={cfg.days ?? 3}
                    onChange={e => setRem(rt.key, { days: Math.max(0, parseInt(e.target.value) || 0) })}
                    style={{ width: 60, ...inputStyle, textAlign: 'center', padding: '6px 8px' }}/>
                ) : <span style={{ fontSize: 12, color: 'var(--text3)' }}>—</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Reminder email recipients */}
      <Field label="Reminder Email Recipients" desc="Who receives reminder emails. Leave empty to send to owners/administrators only.">
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input type="email" value={remIn} onChange={e => setRemIn(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addRem())}
            placeholder="you@accuratepower.com"
            style={{ flex: 1, height: 38, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, outline: 'none' }}/>
          <button className="btn ghost" onClick={addRem} style={{ height: 38, padding: '0 16px' }}>Add</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {reminders.recipients.map(em => (
            <span key={em} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, background: 'var(--blue-soft)', color: 'var(--blue)', border: '1px solid rgba(77,141,247,.25)', borderRadius: 20, padding: '4px 10px 4px 12px' }}>
              {em}
              <button onClick={() => setReminders(r => ({ ...r, recipients: r.recipients.filter(x => x !== em) }))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--blue)', fontSize: 15, lineHeight: 1, padding: 0, display: 'flex' }}>×</button>
            </span>
          ))}
          {reminders.recipients.length === 0 && <span style={{ fontSize: 12, color: 'var(--text3)' }}>Owners &amp; administrators (default).</span>}
        </div>
      </Field>

      <div style={{ background: 'var(--amber-soft)', border: '1px solid rgba(224,165,59,.3)', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: 'var(--amber)', margin: '20px 0' }}>
        Email delivery requires email settings to be configured under <strong>Integrations → Email Delivery</strong>.
      </div>
      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={hasChanges}/>
    </div>
  );
}
