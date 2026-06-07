import React, { useState, useMemo } from 'react';
import Icon from '../../components/Icon';
import { Bid, Gen, WonJob } from '../../types';
import { moneyShort as money } from '../../lib/money';

interface Props {
  bids: Bid[];
  gens: Gen[];
  wonJobs: WonJob[];
}

interface CalEvent {
  id: string;
  day: number;
  label: string;
  sub: string;
  color: string;
  bg: string;
  kind: 'bid-due' | 'bid-won' | 'gen-won' | 'gen-signed';
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// Parse "Mon D" due strings (e.g. "Jun 14") into a Date for a given year.
function parseDueDate(due: string, year: number): Date | null {
  const MONTHS: Record<string, number> = {
    jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11
  };
  const m = /([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2})/.exec(due || '');
  if (!m) return null;
  const mo = MONTHS[m[1].slice(0,3).toLowerCase()];
  if (mo === undefined) return null;
  return new Date(year, mo, parseInt(m[2]));
}

export default function CalendarPage({ bids, gens, wonJobs }: Props) {
  const today = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selected, setSelected] = useState<number | null>(null);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); setSelected(null); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); setSelected(null); };
  const goToday   = () => { setYear(today.getFullYear()); setMonth(today.getMonth()); setSelected(null); };

  // Build event map: day → events[]
  const eventMap = useMemo<Map<number, CalEvent[]>>(() => {
    const map = new Map<number, CalEvent[]>();
    const add = (day: number, ev: CalEvent) => {
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(ev);
    };

    // Bid due dates (active bids only)
    for (const b of bids) {
      if (b.stage === 'awarded' || b.stage === 'lost') continue;
      const d = parseDueDate(b.due, year);
      if (!d || d.getMonth() !== month || d.getFullYear() !== year) continue;
      add(d.getDate(), {
        id: 'bd-' + b.id, day: d.getDate(),
        label: b.name, sub: `${b.gc} · ${money(Number(b.amount))}`,
        color: b.due_days <= 3 ? 'var(--red)' : b.due_days <= 7 ? 'var(--orange)' : 'var(--blue)',
        bg:    b.due_days <= 3 ? 'rgba(224,106,106,.14)' : b.due_days <= 7 ? 'var(--orange-soft)' : 'var(--blue-soft)',
        kind: 'bid-due',
      });
    }

    // Won jobs
    for (const j of wonJobs) {
      if (!j.date_won) continue;
      const d = new Date(j.date_won);
      if (d.getMonth() !== month || d.getFullYear() !== year) continue;
      add(d.getDate(), {
        id: 'wj-' + j.id, day: d.getDate(),
        label: j.customer, sub: `${j.proposal_type} · ${money(Number(j.value))} won`,
        color: 'var(--green)', bg: 'var(--green-soft)',
        kind: j.proposal_type === 'Generator' ? 'gen-won' : 'bid-won',
      });
    }

    // Gen proposals signed
    for (const g of gens) {
      if (g.stage !== 'signed' || !(g as any).signed_at) continue;
      const d = new Date((g as any).signed_at);
      if (d.getMonth() !== month || d.getFullYear() !== year) continue;
      add(d.getDate(), {
        id: 'gs-' + g.id, day: d.getDate(),
        label: g.customer, sub: `${g.mfr} ${g.model} · ${g.kw}kW · signed`,
        color: 'var(--amber)', bg: 'var(--amber-soft)',
        kind: 'gen-signed',
      });
    }

    return map;
  }, [bids, gens, wonJobs, year, month]);

  // Calendar grid
  const firstDay  = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedEvents = selected ? (eventMap.get(selected) ?? []) : [];
  const isToday = (day: number) =>
    day === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  // Summary counts
  const totalDue   = [...eventMap.values()].flat().filter(e => e.kind === 'bid-due').length;
  const totalWon   = [...eventMap.values()].flat().filter(e => e.kind === 'bid-won' || e.kind === 'gen-won').length;
  const totalSigned = [...eventMap.values()].flat().filter(e => e.kind === 'gen-signed').length;

  return (
    <div className="scroll view-enter">
      <div style={{ padding: '20px 28px 40px', maxWidth: 1100 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          <button className="btn ghost" onClick={prevMonth} style={{ width: 36, height: 36, padding: 0, justifyContent: 'center' }}>
            <Icon name="arrow" size={15} stroke={2.2} style={{ transform: 'rotate(180deg)' }}/>
          </button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-.4px' }}>{MONTH_NAMES[month]} {year}</div>
          </div>
          <button className="btn ghost" onClick={nextMonth} style={{ width: 36, height: 36, padding: 0, justifyContent: 'center' }}>
            <Icon name="arrow" size={15} stroke={2.2}/>
          </button>
          <button className="btn ghost" onClick={goToday} style={{ fontSize: 12, height: 36, padding: '0 12px' }}>Today</button>
        </div>

        {/* Summary chips */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { label: 'Bids Due', count: totalDue,   color: 'var(--blue)',  bg: 'var(--blue-soft)'  },
            { label: 'Jobs Won', count: totalWon,   color: 'var(--green)', bg: 'var(--green-soft)' },
            { label: 'Signed',   count: totalSigned, color: 'var(--amber)', bg: 'var(--amber-soft)' },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 12px', borderRadius: 20,
              background: s.bg, border: '1px solid transparent', fontSize: 12, fontWeight: 700 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }}/>
              <span style={{ color: s.color }}>{s.count} {s.label}</span>
            </div>
          ))}
          <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, display: 'flex', alignItems: 'center', marginLeft: 'auto' }}>
            {[
              { dot: 'var(--blue)',  label: 'Bid due' },
              { dot: 'var(--green)', label: 'Won' },
              { dot: 'var(--amber)', label: 'Gen signed' },
              { dot: 'var(--red)',   label: 'Urgent' },
            ].map(l => (
              <span key={l.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 14 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: l.dot }}/>
                {l.label}
              </span>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
          {/* Day labels */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
            {DAY_NAMES.map(d => (
              <div key={d} style={{ padding: '9px 0', textAlign: 'center', fontSize: 11, fontWeight: 800,
                color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{d}</div>
            ))}
          </div>

          {/* Weeks */}
          {Array.from({ length: cells.length / 7 }, (_, wi) => (
            <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)',
              borderBottom: wi < cells.length / 7 - 1 ? '1px solid var(--border)' : 'none' }}>
              {cells.slice(wi * 7, wi * 7 + 7).map((day, di) => {
                const events = day ? (eventMap.get(day) ?? []) : [];
                const isSelected = day === selected;
                const isTodayCell = day ? isToday(day) : false;
                return (
                  <div key={di}
                    onClick={() => day && setSelected(isSelected ? null : day)}
                    style={{
                      minHeight: 88, padding: '8px 8px 6px', cursor: day ? 'pointer' : 'default',
                      borderRight: di < 6 ? '1px solid var(--border)' : 'none',
                      background: isSelected ? 'var(--blue-soft)' : day ? 'var(--surface)' : 'var(--panel)',
                      transition: 'background 120ms',
                    }}
                    onMouseEnter={e => { if (day && !isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--surface2)'; }}
                    onMouseLeave={e => { if (day && !isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--surface)'; }}
                  >
                    {day && (
                      <>
                        <div style={{ fontSize: 13, fontWeight: isTodayCell ? 900 : 600,
                          color: isTodayCell ? '#fff' : isSelected ? 'var(--blue)' : 'var(--text)',
                          width: 24, height: 24, borderRadius: '50%',
                          background: isTodayCell ? 'var(--blue)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          marginBottom: 4,
                        }}>{day}</div>
                        {/* Event dots / pills */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {events.slice(0, 3).map(ev => (
                            <div key={ev.id} style={{
                              fontSize: 10.5, fontWeight: 700, padding: '2px 6px', borderRadius: 5,
                              background: ev.bg, color: ev.color,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>{ev.label}</div>
                          ))}
                          {events.length > 3 && (
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', paddingLeft: 2 }}>
                              +{events.length - 3} more
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Day detail drawer */}
        {selected && selectedEvents.length > 0 && (
          <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, fontWeight: 800 }}>
                {MONTH_NAMES[month]} {selected} — {selectedEvents.length} event{selectedEvents.length !== 1 ? 's' : ''}
              </span>
              <button onClick={() => setSelected(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4 }}>
                <Icon name="x" size={15} stroke={2}/>
              </button>
            </div>
            {selectedEvents.map(ev => (
              <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: ev.bg, color: ev.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name={ev.kind === 'bid-due' ? 'clock' : ev.kind === 'gen-signed' ? 'doc' : 'check'} size={16} stroke={2}/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>{ev.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, marginTop: 2 }}>{ev.sub}</div>
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 6,
                  background: ev.bg, color: ev.color, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  {ev.kind === 'bid-due' ? 'Bid Due' : ev.kind === 'bid-won' ? 'Elec Won' : ev.kind === 'gen-won' ? 'Gen Won' : 'Signed'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
