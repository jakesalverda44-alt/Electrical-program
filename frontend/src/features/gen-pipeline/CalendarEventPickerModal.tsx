// Lets a rep create a generator proposal straight from an upcoming Outlook calendar
// appointment instead of retyping the customer's name/address/phone: pick an event,
// its subject/location/attendees/body gets run through the same AI extraction as
// Build from Notes, and a pre-filled proposal is created for review.
import React, { useEffect, useState } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { Gen } from '../../types';

interface CalendarEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  location: string | null;
  isAllDay: boolean;
  attendees: { name: string; email: string }[];
}

interface Props {
  onClose: () => void;
  onCreated: (gen: Gen) => void;
}

function fmtWhen(ev: CalendarEvent) {
  if (!ev.start) return '';
  const d = new Date(ev.start);
  if (isNaN(d.getTime())) return '';
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  if (ev.isAllDay) return `${dateStr} · All day`;
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${dateStr} · ${timeStr}`;
}

export default function CalendarEventPickerModal({ onClose, onCreated }: Props) {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<CalendarEvent[]>('/gens/calendar-events')
      .then(r => setEvents(r.data))
      .catch(() => setEvents([]));
  }, []);

  const pick = async (ev: CalendarEvent) => {
    setCreatingId(ev.id);
    setError('');
    try {
      const { data } = await api.post<Gen>('/gens/from-calendar-event', { eventId: ev.id });
      onCreated(data);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      setError(msg || 'Failed to create a proposal from that event. Please try again.');
      setCreatingId(null);
    }
  };

  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-hdr">
          <h3>Create Proposal from Calendar</h3>
          <button className="close-x" onClick={onClose}><Icon name="x" size={16} stroke={2}/></button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 12.5, color: 'var(--text3)', margin: '0 0 12px', lineHeight: 1.5 }}>
            Pick an upcoming appointment — the customer's name, address, phone, and any generator
            details in it get pulled into a new draft proposal for you to review.
          </p>

          {events === null && (
            <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>Loading events…</div>
          )}

          {events !== null && events.length === 0 && (
            <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>
              No upcoming events found on the calendar.
            </div>
          )}

          {error && (
            <div style={{ fontSize: 12.5, color: '#E06A6A', marginBottom: 10, fontWeight: 600 }}>{error}</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
            {events?.map(ev => (
              <div key={ev.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                padding: '10px 12px', border: '1px solid var(--border2)', borderRadius: 9,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ev.subject}
                    {new Date(ev.end || ev.start).getTime() < Date.now() && (
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em',
                        color: 'var(--text3)', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 5, padding: '1px 6px' }}>
                        Past
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>
                    {fmtWhen(ev)}{ev.location ? ` · ${ev.location}` : ''}
                  </div>
                  {ev.attendees.length > 0 && (
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ev.attendees.map(a => a.name || a.email).join(', ')}
                    </div>
                  )}
                </div>
                <button
                  className="btn amber"
                  style={{ fontSize: 12, flexShrink: 0, height: 32, padding: '0 12px' }}
                  disabled={creatingId !== null}
                  onClick={() => pick(ev)}
                >
                  {creatingId === ev.id ? 'Creating…' : 'Create Proposal'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
