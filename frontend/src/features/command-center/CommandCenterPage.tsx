import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api/client';
import { useUser } from '../../contexts/AppContext';
import { BriefPayload, BriefAttentionItem, TodayEvent } from '../../types';
import BriefDrawer from './BriefDrawer';
import './command-center.css';

// One quote a day, rotated by day-of-year.
const QUOTES: Array<[string, string]> = [
  ['Energy and persistence conquer all things.', 'Benjamin Franklin'],
  ['Well done is better than well said.', 'Benjamin Franklin'],
  ['The way to get started is to quit talking and begin doing.', 'Walt Disney'],
  ['Opportunities don’t happen. You create them.', 'Chris Grosser'],
  ['Success is the sum of small efforts, repeated day in and day out.', 'Robert Collier'],
  ['The harder I work, the luckier I get.', 'Samuel Goldwyn'],
  ['Don’t watch the clock; do what it does. Keep going.', 'Sam Levenson'],
  ['It always seems impossible until it’s done.', 'Nelson Mandela'],
  ['Quality means doing it right when no one is looking.', 'Henry Ford'],
  ['Whether you think you can or you think you can’t, you’re right.', 'Henry Ford'],
  ['Amateurs sit and wait for inspiration. The rest of us just get up and go to work.', 'Stephen King'],
  ['Action is the foundational key to all success.', 'Pablo Picasso'],
];

function quoteOfTheDay(): [string, string] {
  const now = new Date();
  const day = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86_400_000);
  return QUOTES[day % QUOTES.length];
}

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
function eventMinutes(ev: TodayEvent): number | null {
  if (ev.isAllDay) return null;
  const m = /T(\d{2}):(\d{2})/.exec(ev.start);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

function fmtEventTime(ev: TodayEvent): string {
  const mins = eventMinutes(ev);
  if (mins === null) return 'All day';
  let h = Math.floor(mins / 60);
  const ampm = h >= 12 ? 'p' : 'a';
  h = h % 12 || 12;
  return `${h}:${String(mins % 60).padStart(2, '0')}${ampm}`;
}

function localDay(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Per-day "handled" checklist for the respond queue, kept on this device.
function loadDone(): Set<string> {
  try { return new Set<string>(JSON.parse(localStorage.getItem(`cc-done-${localDay()}`) || '[]')); }
  catch { return new Set(); }
}

function avatarHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

const MAX_REPLIES_SHOWN = 6;

interface ActionBox {
  key: string; n: number; ic: string; label: string; sub: string; nav: string; cls: string;
}

interface Props { onNav: (v: string) => void; }

export default function CommandCenterPage({ onNav }: Props) {
  const user = useUser();
  const [brief, setBrief] = useState<BriefPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [drawerItem, setDrawerItem] = useState<BriefAttentionItem | null>(null);
  const [marking, setMarking] = useState(false);
  const [done, setDone] = useState<Set<string>>(loadDone);
  const [baseline, setBaseline] = useState<number>(() => {
    const n = parseInt(localStorage.getItem(`cc-base-${localDay()}`) || '0', 10);
    return isNaN(n) ? 0 : n;
  });

  const load = useCallback(() => {
    api.get<BriefPayload>('/brief')
      .then(r => setBrief(r.data))
      .catch(() => setBrief(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);

  const toggleDone = (id: string) => setDone(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    localStorage.setItem(`cc-done-${localDay()}`, JSON.stringify([...next]));
    return next;
  });

  const markContacted = async (leadId: string) => {
    setMarking(true);
    try {
      await api.post(`/leads/${leadId}/log-activity`, { kind: 'call', direction: 'out' });
      if (drawerItem) toggleDone(drawerItem.id);
      setDrawerItem(null);
      load();
    } finally {
      setMarking(false);
    }
  };

  // ── Counts → quick boxes (no long lists on the command center) ──
  const count = (t: BriefAttentionItem['type']) => (brief?.attention || []).filter(a => a.type === t).length;
  const replies = (brief?.attention || []).filter(a => a.type === 'email');
  const boxes: ActionBox[] = !brief ? [] : ([
    { key: 'signed', n: count('gen-signed'), ic: '✍️', label: 'Signed — ready to award', sub: 'open the pipeline and award it', nav: 'gen-proposals', cls: 'purple' },
    { key: 'bids', n: count('bid'), ic: '⏰', label: 'Bids due soon', sub: 'due within 3 days', nav: 'pipeline', cls: 'red' },
    {
      key: 'leads', n: count('lead-call') + count('lead-stale'), ic: '📞', label: 'Leads need action',
      sub: 'calls & no-response nudges', nav: 'gen-leads', cls: 'green',
    },
    { key: 'tasks', n: count('task'), ic: '✅', label: 'Follow-ups due', sub: 'today or overdue', nav: 'followups', cls: 'blue' },
    {
      key: 'intake', n: brief.intake.unread, ic: '📥', label: 'New bids in intake',
      sub: [
        brief.intake.newToday > 0 && `${brief.intake.newToday} today`,
        brief.intake.newYesterday > 0 && `${brief.intake.newYesterday} yesterday`,
      ].filter(Boolean).join(' · ') || 'review and accept or decline',
      nav: 'intake', cls: 'blue',
    },
    {
      key: 'kohler',
      n: brief.kohlerFunnel.notAccepted || brief.kohlerFunnel.newToday + brief.kohlerFunnel.newYesterday,
      ic: '⚡', label: 'Kohler leads to accept',
      sub: [
        brief.kohlerFunnel.newToday > 0 && `${brief.kohlerFunnel.newToday} today`,
        brief.kohlerFunnel.newYesterday > 0 && `${brief.kohlerFunnel.newYesterday} yesterday`,
      ].filter(Boolean).join(' · ') || `${brief.kohlerFunnel.received} this month`,
      nav: 'gen-leads', cls: 'amber',
    },
  ] as ActionBox[]).filter(b => b.n > 0);

  const boxTotal = boxes.reduce((s, b) => s + b.n, 0);
  const repliesOpen = replies.filter(r => !done.has(r.id)).length;
  const remaining = boxTotal + repliesOpen;

  // Day baseline: progress = how much of today's peak workload has been cleared.
  useEffect(() => {
    if (!brief) return;
    setBaseline(prev => {
      const next = Math.max(prev, remaining);
      if (next !== prev) localStorage.setItem(`cc-base-${localDay()}`, String(next));
      return next;
    });
  }, [brief, remaining]);

  if (loading && !brief) return <div className="cc2-root"><div className="cc2-loading">Loading your day…</div></div>;
  if (!brief) return <div className="cc2-root"><div className="cc2-loading">Couldn’t load the brief. Retrying…</div></div>;

  const firstName = (user.name || '').split(/\s+/)[0] || 'there';
  const [quote, quoteBy] = quoteOfTheDay();
  const allClear = remaining === 0;
  const cleared = Math.max(baseline - remaining, 0);
  const pct = baseline > 0 ? Math.round((cleared / baseline) * 100) : 100;

  const statBits = [
    boxTotal > 0 && { ic: '🎯', tx: `${boxTotal} item${boxTotal === 1 ? '' : 's'} need action` },
    repliesOpen > 0 && { ic: '💬', tx: `${repliesOpen} repl${repliesOpen === 1 ? 'y' : 'ies'} owed` },
    brief.todayEvents.length > 0 && { ic: '📅', tx: `${brief.todayEvents.length} on the calendar` },
  ].filter(Boolean) as Array<{ ic: string; tx: string }>;

  // Insert the "now" marker into today's timeline.
  const nowMins = now.getHours() * 60 + now.getMinutes();
  let nowIdx = brief.todayEvents.length;
  for (let i = 0; i < brief.todayEvents.length; i++) {
    const m = eventMinutes(brief.todayEvents[i]);
    if (m !== null && m > nowMins) { nowIdx = i; break; }
  }

  return (
    <div className="cc2-root scroll view-enter">

      {/* ── Hero ── */}
      <div className="cc2-hero">
        <div className="blob b1" /><div className="blob b2" /><div className="blob b3" />
        <div className="cc2-hero-in">
          <div className="cc2-clock">
            {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            <span>{now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          </div>
          <div className="cc2-greet">{greetWord(now.getHours())}, <em>{firstName}</em>.</div>
          <div className="cc2-sub">
            {brief.daySummary && <span>{brief.daySummary} </span>}
            {allClear
              ? 'Nothing is waiting on you. Go make something happen.'
              : `${remaining} thing${remaining === 1 ? '' : 's'} need${remaining === 1 ? 's' : ''} you — knock them out below.`}
          </div>
          <div className="cc2-stats">
            {statBits.map((s, i) => <span className="pill" key={i}><i>{s.ic}</i>{s.tx}</span>)}
            {brief.kpis.wonThisMonth > 0 && (
              <span className="pill win"><i>🏆</i>{brief.kpis.wonThisMonth} job{brief.kpis.wonThisMonth === 1 ? '' : 's'} won this month</span>
            )}
          </div>
          {baseline > 0 && (
            <div className="cc2-prog">
              <div className="track"><div className="fill" style={{ width: pct + '%' }} /></div>
              <div className="lbl">{cleared} of {baseline} cleared{pct === 100 ? ' — day cleared 🎉' : ''}</div>
            </div>
          )}
        </div>
      </div>

      <div className="cc2-grid">
        {/* ── Left: quick counts + the respond queue ── */}
        <div>
          <div className="cc2-h"><span>Needs action</span><em>{boxTotal}</em><i /></div>
          {boxes.length === 0 && <div className="cc2-empty">All caught up. 🎉</div>}
          {boxes.length > 0 && (
            <div className="cc2-flow boxes">
              {boxes.map(b => (
                <div className={'cc2-chip ' + b.cls} key={b.key} onClick={() => onNav(b.nav)}>
                  <div className="n">{b.n}</div>
                  <div className="tx">
                    <b>{b.ic} {b.label}</b>
                    <span>{b.sub}</span>
                  </div>
                  <span className="go">→</span>
                </div>
              ))}
            </div>
          )}

          <div className="cc2-h"><span>Respond to</span><em>{replies.length}</em><i /></div>
          {replies.length === 0 && <div className="cc2-empty">Inbox is quiet — nobody’s waiting on you.</div>}
          {replies.slice(0, MAX_REPLIES_SHOWN).map(item => {
            const who = (item.subtitle || '?').trim();
            return (
              <div className={'cc2-reply' + (done.has(item.id) ? ' done' : '')} key={item.id} onClick={() => setDrawerItem(item)}>
                <div className="av" style={{ background: `hsl(${avatarHue(who)} 45% 38%)` }}>{who[0]?.toUpperCase() || '?'}</div>
                <div className="body">
                  <div className="t">{item.title}</div>
                  <div className="m">{item.subtitle}{item.receivedAt ? ` · ${timeAgo(item.receivedAt)}` : ''}</div>
                </div>
                <div className="acts" onClick={e => e.stopPropagation()}>
                  {item.cta.webLink && <a className="cc-btn p" href={item.cta.webLink} target="_blank" rel="noopener noreferrer">Open email</a>}
                  <button
                    className={'cc2-check' + (done.has(item.id) ? ' on' : '')}
                    title={done.has(item.id) ? 'Mark not handled' : 'Mark handled'}
                    onClick={() => toggleDone(item.id)}
                  >✓</button>
                </div>
              </div>
            );
          })}
          {replies.length > MAX_REPLIES_SHOWN && (
            <div className="cc2-more">+{replies.length - MAX_REPLIES_SHOWN} more in your inbox</div>
          )}
        </div>

        {/* ── Right: the day ── */}
        <div>
          <div className="cc2-card">
            <div className="ch">Today’s schedule</div>
            {brief.todayEvents.length === 0 && (
              <div className="cc2-empty pad">{brief.graphEnabled ? 'Clear calendar. Use it well.' : 'Mailbox not connected.'}</div>
            )}
            {brief.todayEvents.length > 0 && (
              <div className="cc2-tl">
                {brief.todayEvents.map((ev, i) => {
                  const past = (eventMinutes(ev) ?? 0) <= nowMins;
                  return (
                    <React.Fragment key={ev.id}>
                      {i === nowIdx && <div className="nowline"><b>now · {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</b></div>}
                      <div className={'ev' + (past && i < nowIdx ? ' past' : '')}>
                        <span className="dot" />
                        <span className="tm">{fmtEventTime(ev)}</span>
                        <span className="x">{ev.subject}{ev.location ? <em> · {ev.location}</em> : null}</span>
                      </div>
                    </React.Fragment>
                  );
                })}
                {nowIdx === brief.todayEvents.length && <div className="nowline end"><b>now · {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</b></div>}
              </div>
            )}
          </div>

          <div className="cc2-card">
            <div className="ch">The rundown</div>
            <ul className="cc2-run">
              {brief.briefBullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>

          <div className="cc2-quote">
            “{quote}”
            <span>— {quoteBy}</span>
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
