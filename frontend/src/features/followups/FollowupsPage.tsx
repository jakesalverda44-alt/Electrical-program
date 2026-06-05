import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { useShowToast } from '../../contexts/AppContext';

interface Task {
  id: string;
  title: string;
  notes?: string;
  due_date?: string | null;
  status: 'open' | 'done';
  linked_type?: string | null;
  linked_name?: string | null;
  assigned_to_name?: string | null;
  created_at: string;
}

interface Props {
  onCountChange?: (n: number) => void;
}

const inputStyle: React.CSSProperties = {
  font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--text)',
  background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9,
  padding: '8px 10px', outline: 'none', boxSizing: 'border-box',
};

function dueMeta(due?: string | null): { label: string; color: string } {
  if (!due) return { label: 'No due date', color: 'var(--text3)' };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(due + 'T00:00:00');
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { label: `Overdue ${-days}d`, color: 'var(--red)' };
  if (days === 0) return { label: 'Due today', color: 'var(--amber)' };
  if (days === 1) return { label: 'Due tomorrow', color: 'var(--amber)' };
  return { label: `Due in ${days}d`, color: 'var(--text2)' };
}

export default function FollowupsPage({ onCountChange }: Props) {
  const showToast = useShowToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [linkedName, setLinkedName] = useState('');
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/tasks').then(({ data }) => setTasks(data)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { onCountChange?.(tasks.filter(t => t.status === 'open').length); }, [tasks, onCountChange]);

  const add = async () => {
    if (!title.trim()) return;
    const { data } = await api.post('/tasks', {
      title: title.trim(),
      due_date: due || null,
      linked_name: linkedName.trim() || null,
    });
    setTasks(prev => [data, ...prev]);
    setTitle(''); setDue(''); setLinkedName('');
    showToast?.({ title: 'Follow-up added', sub: data.title });
  };

  const toggle = async (t: Task) => {
    const status = t.status === 'done' ? 'open' : 'done';
    const { data } = await api.patch(`/tasks/${t.id}`, { status });
    setTasks(prev => prev.map(x => x.id === t.id ? data : x));
  };

  const remove = async (t: Task) => {
    await api.delete(`/tasks/${t.id}`);
    setTasks(prev => prev.filter(x => x.id !== t.id));
  };

  const visible = tasks.filter(t => filter === 'all' ? true : t.status === filter);
  const openCount = tasks.filter(t => t.status === 'open').length;
  const overdue = tasks.filter(t => t.status === 'open' && t.due_date && new Date(t.due_date + 'T00:00:00') < new Date(new Date().toDateString())).length;

  return (
    <div className="scroll view-enter">
      <div style={{ padding: '20px 28px 40px', maxWidth: 820 }}>
        <div className="stats" style={{ gridTemplateColumns: 'repeat(3,1fr)', padding: 0, marginBottom: 20 }}>
          {[
            { label: 'Open Follow-ups', val: String(openCount), tone: 'blue' },
            { label: 'Overdue', val: String(overdue), tone: overdue ? 'amber' : 'green' },
            { label: 'Completed', val: String(tasks.filter(t => t.status === 'done').length), tone: 'green' },
          ].map(s => (
            <div className="stat" key={s.label}>
              <div className="stat-top"><span className="stat-label">{s.label}</span>
                <span className={'stat-ic ' + s.tone}><Icon name="checkc" size={16} stroke={1.8}/></span></div>
              <div className="stat-val num">{s.val}</div>
            </div>
          ))}
        </div>

        {/* Add form */}
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-hdr"><span className="panel-title">New Follow-up</span></div>
          <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 5 }}>Task</div>
              <input style={{ ...inputStyle, width: '100%' }} value={title} placeholder="Call GC about addendum…"
                onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}/>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 5 }}>Related to</div>
              <input style={{ ...inputStyle, width: '100%' }} value={linkedName} placeholder="Customer / bid"
                onChange={e => setLinkedName(e.target.value)}/>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 5 }}>Due</div>
              <input type="date" style={{ ...inputStyle, width: '100%' }} value={due} onChange={e => setDue(e.target.value)}/>
            </div>
            <button className="btn" onClick={add} disabled={!title.trim()}>Add</button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-hdr">
            <span className="panel-title">Follow-ups<span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginLeft: 6 }}>· {visible.length}</span></span>
            <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} className="comm-filter">
              <option value="open">Open</option>
              <option value="done">Completed</option>
              <option value="all">All</option>
            </select>
          </div>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading…</div>
          ) : visible.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No follow-ups here.</div>
          ) : (
            visible.map(t => {
              const dm = dueMeta(t.due_date);
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
                  <button onClick={() => toggle(t)} aria-label={t.status === 'done' ? 'Reopen' : 'Complete'}
                    style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, cursor: 'pointer',
                      border: '2px solid ' + (t.status === 'done' ? 'var(--green)' : 'var(--border2)'),
                      background: t.status === 'done' ? 'var(--green)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {t.status === 'done' && <Icon name="check" size={12} stroke={3}/>}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', textDecoration: t.status === 'done' ? 'line-through' : 'none', opacity: t.status === 'done' ? 0.6 : 1 }}>{t.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                      {t.linked_name ? `${t.linked_name} · ` : ''}{t.assigned_to_name || ''}
                    </div>
                  </div>
                  {t.status === 'open' && <span style={{ fontSize: 12, fontWeight: 700, color: dm.color, whiteSpace: 'nowrap' }}>{dm.label}</span>}
                  <button onClick={() => remove(t)} aria-label="Delete" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4 }}>
                    <Icon name="x" size={15} stroke={2}/>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
