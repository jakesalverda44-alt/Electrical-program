// Lets a field rep turn today's Outlook appointment straight into a lead and drop into
// the Site Survey wizard, without first typing the customer into the CRM by hand.
// Mirrors CalendarEventPickerModal's event-picker UX (features/gen-pipeline) but creates
// a lead instead of a proposal, and — because a rep standing at a job site can't wait out
// a Graph outage — always offers a "no appointment" escape hatch regardless of whether
// the calendar loaded, came back empty, or failed.
import React, { useEffect, useState } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { useIsMobile } from '../../hooks/useIsMobile';
import { Lead } from '../../types';

interface CalendarEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  location: string | null;
  isAllDay: boolean;
  attendees: { name: string; email: string }[];
  linkedLeadId: string | null;
}

interface Props {
  onClose: () => void;
  onLeadReady: (lead: Lead) => void;
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

export default function SurveyFromCalendarModal({ onClose, onLeadReady }: Props) {
  const isMobile = useIsMobile();
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [blankLoading, setBlankLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<CalendarEvent[]>('/calendar/events')
      .then(r => setEvents(r.data))
      .catch(() => {
        // Graph being unreachable must never trap a rep at a blank screen — fall back to
        // an empty list so the "no appointment" button underneath is still reachable.
        setEvents([]);
        setError("Couldn't load the calendar. Start a blank survey instead.");
      });
  }, []);

  const pick = async (ev: CalendarEvent) => {
    setPickingId(ev.id);
    setError('');
    try {
      const { data } = await api.post<{ lead: Lead; created: boolean }>('/leads/from-calendar-event', { eventId: ev.id });
      onLeadReady(data.lead);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      setError(msg || 'Failed to start a survey from that appointment. Please try again.');
      setPickingId(null);
    }
  };

  const startBlank = async () => {
    setBlankLoading(true);
    setError('');
    try {
      const { data } = await api.post<Lead>('/leads/blank-survey');
      onLeadReady(data);
    } catch {
      setError('Failed to start a blank survey. Please try again.');
      setBlankLoading(false);
    }
  };

  const busy = pickingId !== null || blankLoading;

  return (
    <div
      className="overlay"
      onMouseDown={e => e.target === e.currentTarget && onClose()}
      style={isMobile ? { padding: 0, alignItems: 'stretch', justifyContent: 'stretch' } : undefined}
    >
      <div
        className="modal"
        style={isMobile
          ? { width: '100%', maxWidth: '100%', height: '100%', borderRadius: 0, display: 'flex', flexDirection: 'column' }
          : undefined}
      >
        <div className="modal-hdr">
          <h3>Start Site Survey</h3>
          <button className="close-x" onClick={onClose}><Icon name="x" size={16} stroke={2}/></button>
        </div>

        <div className="modal-body" style={isMobile ? { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' } : undefined}>
          <p style={{ fontSize: 12.5, color: 'var(--text3)', margin: '0 0 12px', lineHeight: 1.5 }}>
            Pick an upcoming appointment to pull its name, address, and contact into a new
            lead — or start a blank survey if there's nothing on the calendar.
          </p>

          {events === null && (
            <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>Loading events…</div>
          )}

          {events !== null && events.length === 0 && !error && (
            <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>
              No upcoming appointments found on the calendar.
            </div>
          )}

          {error && (
            <div style={{ fontSize: 12.5, color: '#E06A6A', marginBottom: 10, fontWeight: 600 }}>{error}</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, ...(isMobile ? { flex: 1 } : { maxHeight: 420, overflowY: 'auto' }) }}>
            {events?.map(ev => {
              const linked = !!ev.linkedLeadId;
              return (
                <button
                  key={ev.id}
                  type="button"
                  disabled={busy}
                  onClick={() => pick(ev)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                    minHeight: 44, padding: '12px 14px', border: '1px solid var(--border2)', borderRadius: 10,
                    background: 'var(--surface)', font: 'inherit', textAlign: 'left', cursor: 'pointer',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontSize: 13.5, fontWeight: 700, color: 'var(--text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {ev.subject}
                      </span>
                      {linked && (
                        <span style={{
                          flexShrink: 0, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em',
                          color: 'var(--green)', background: 'rgba(52,197,136,.12)', border: '1px solid rgba(52,197,136,.35)',
                          borderRadius: 5, padding: '1px 6px',
                        }}>
                          Survey started
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>
                      {fmtWhen(ev)}{ev.location ? ` · ${ev.location}` : ''}
                    </div>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)', flexShrink: 0 }}>
                    {pickingId === ev.id ? '…' : '→'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Present in every state — loading, populated, empty, and error — so a Graph
            outage or a truly empty calendar can never strand a rep without a way in. */}
        <div className="modal-foot">
          <button
            className="btn ghost"
            style={{ width: '100%', justifyContent: 'center', minHeight: 44 }}
            disabled={busy}
            onClick={startBlank}
          >
            {blankLoading ? 'Starting…' : 'No appointment — blank survey'}
          </button>
        </div>
      </div>
    </div>
  );
}
