import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api/client';
import { useUser } from '../../contexts/AppContext';
import { BriefPayload, BriefAttentionItem, TodayEvent } from '../../types';
import KpiCounter from './KpiCounter';
import BriefDrawer from './BriefDrawer';
import './command-center.css';

const money = (n: number) => '$' + (Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + 'K' : Math.round(n).toString());

function greetWord(h: number) { return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return '';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Event start comes back as ET wall-clock ISO without offset (e.g. "2026-06-10T09:00:00…").
// Pull the HH:MM straight out of the string so the browser timezone can't shift it.
function fmtEventTime(ev: TodayEvent): string {
  if (ev.isAllDay) return 'All day';
  const m = /T(\d{2}):(\d{2})/.exec(ev.start);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const ampm = h >= 12 ? 'p' : 'a';
  h = h % 12 || 12;
  return `${h}:${m[2]}${ampm}`;
}

const Chip = ({ k }: { k: string }) => (
  <span className={'cc-chip ' + (k === 'Elec' ? 'elec' : k === 'Gen' ? 'gen' : 'call')}>{k}</span>
);

interface Props { onNav: (v: string) => void; }

export default function CommandCenterPage({ onNav }: Props) {
  const user = useUser();
  const [brief, setBrief] = useState<BriefPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [drawerItem, setDrawerItem] = useState<BriefAttentionItem | null>(null);
  const [marking, setMarking] = useState(false);

  const load = useCallback(() => {
    api.get<BriefPayload>('/brief')
      .then(r => setBrief(r.data))
      .catch(() => setBrief(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const markContacted = async (leadId: string) => {
    setMarking(true);
    try {
      await api.post(`/leads/${leadId}/log-activity`, { kind: 'call', direction: 'out' });
      setDrawerItem(null);
      load();
    } finally {
      setMarking(false);
    }
  };

  const openRow = (item: BriefAttentionItem) => setDrawerItem(item);

  if (loading && !brief) return <div className="cc-root"><div className="cc-loading">Loading your command center…</div></div>;
  if (!brief) return <div className="cc-root"><div className="cc-loading">Couldn’t load the brief. Retrying…</div></div>;

  const k = brief.kpis;
  const f = brief.kohlerFunnel;
  const calls = brief.attention.filter(a => a.type === 'lead-call');
  const replies = brief.attention.filter(a => a.type !== 'lead-call');
  const firstName = (user.name || '').split(/\s+/)[0] || 'there';

  const Row = ({ item }: { item: BriefAttentionItem }) => (
    <div className="cc-row" onClick={() => openRow(item)}>
      {item.chips.map(c => <Chip key={c} k={c} />)}
      <div className="info">
        <div className="t">{item.title}</div>
        <div className="m">{item.subtitle}{item.receivedAt ? ` · ${timeAgo(item.receivedAt)}` : ''}</div>
      </div>
      <div className="cta" onClick={e => e.stopPropagation()}>
        {item.cta.webLink && (
          <a className="cc-btn p" href={item.cta.webLink} target="_blank" rel="noopener noreferrer">Open email</a>
        )}
        {item.cta.tel && <a className="cc-btn p" href={item.cta.tel}>Call now</a>}
        <button className="cc-btn" onClick={() => openRow(item)}>Brief</button>
      </div>
    </div>
  );

  return (
    <div className="cc-root scroll view-enter">
      <div className="cc-top">
        <div className="cc-greet">{greetWord(now.getHours())}, <b>{firstName}</b> — here’s everything that needs you today.</div>
        <div className="cc-clock">
          <div className="t">{now.toLocaleTimeString('en-US', { hour12: false })}</div>
          <div className="d">{now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
        </div>
      </div>

      <div className="cc-kpis">
        <div className="cc-kpi k-amber"><div className="bar" /><div className="lab">Open pipeline</div>
          <div className="val"><KpiCounter value={k.activeBidsValue + k.activeGensValue} format={money} /></div>
          <div className="note">{k.activeBids + k.activeGens} active opportunities</div></div>
        <div className="cc-kpi k-blue"><div className="bar" /><div className="lab">Electrical</div>
          <div className="val"><KpiCounter value={k.activeBidsValue} format={money} /></div>
          <div className="note">{k.activeBids} active bids</div></div>
        <div className="cc-kpi k-green"><div className="bar" /><div className="lab">Won this month</div>
          <div className="val"><KpiCounter value={k.wonThisMonthValue} format={money} /></div>
          <div className="note">{k.wonThisMonth} job{k.wonThisMonth === 1 ? '' : 's'}</div></div>
        <div className="cc-kpi k-amber"><div className="bar" /><div className="lab">Generators</div>
          <div className="val"><KpiCounter value={k.activeGensValue} format={money} /></div>
          <div className="note">{k.activeGens} in progress</div></div>
        <div className="cc-kpi k-red"><div className="bar" /><div className="lab">Need you</div>
          <div className="val"><KpiCounter value={k.leadsNeedingCall + k.unreadEmails} /></div>
          <div className="note">{k.leadsNeedingCall} calls · {k.unreadEmails} emails</div></div>
      </div>

      <div className="cc-grid">
        <div>
          <div className="cc-card glow">
            <h2><span className="cc-live" /> Needs your attention <span className="ct">{brief.attention.length} items</span></h2>
            {brief.attention.length === 0 && <div className="cc-empty">Nothing needs you right now. 🎉</div>}
            {replies.length > 0 && <div className="cc-sec-title">Replies &amp; updates to respond to</div>}
            {replies.map(item => <Row key={item.id} item={item} />)}
            {calls.length > 0 && <div className="cc-sec-title">Calls to make</div>}
            {calls.map(item => <Row key={item.id} item={item} />)}
          </div>

          <div className="cc-card">
            <h2>Kohler lead funnel <span className="ct">this month</span></h2>
            <div className="cc-funnel">
              <div className="cc-fstep"><div className="n">{f.received}</div><div className="l">Received</div></div>
              <div className="cc-fstep"><div className="n">{f.accepted}</div><div className="l">Accepted</div></div>
              <div className="cc-fstep"><div className="n">{f.replied}</div><div className="l">Replied</div></div>
              <div className={'cc-fstep' + (f.needCall > 0 ? ' alert' : '')}><div className="n">{f.needCall}</div><div className="l">Need call</div></div>
            </div>
            {!brief.graphEnabled && <div className="cc-empty">Connect the mailbox to see Received / Replied counts.</div>}
          </div>
        </div>

        <div>
          <div className="cc-card">
            <h2>Today <span className="ct">{now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span></h2>
            <div className="cc-ag">
              {brief.todayEvents.length === 0 && <div className="cc-empty">{brief.graphEnabled ? 'No meetings today.' : 'Mailbox not connected.'}</div>}
              {brief.todayEvents.map(ev => (
                <div className="cc-agi" key={ev.id}>
                  <div className="tm">{fmtEventTime(ev)}</div>
                  <div><div className="x">{ev.subject}</div>{ev.location && <div className="y">{ev.location}</div>}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="cc-card">
            <h2>Morning brief</h2>
            <ul className="cc-brief">
              {brief.briefBullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        </div>
      </div>

      <BriefDrawer
        item={drawerItem}
        onClose={() => setDrawerItem(null)}
        onNav={onNav}
        onMarkContacted={markContacted}
        markingContacted={marking}
      />
    </div>
  );
}
