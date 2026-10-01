// Level 2 learning, Task 15 — Settings → "Counting lessons & examples".
// Lessons: proposed / approved / dismissed / retired, each with its evidence,
// a scope picker ("All jobs" preselected, per Jake) and "Use in: counting /
// review questions"; approve, edit & approve (a new version), dismiss,
// retire, restore. Examples: the crops with what they were verified as.
// Releases: "Check and release" (Jake's button — live AI calls, a cost
// dialog first) and the last results.
import React, { useCallback, useEffect, useState } from 'react';
import api from '../../../api/client';
import { learningApi, type Example, type Lesson, type LessonStatus, type Release, type ScopeKind } from '../../../api/learning';
import { useConfirm } from '../../../components/ConfirmDialog';
import { SectionTitle } from '../shared';

const TABS: Array<{ id: LessonStatus; label: string }> = [
  { id: 'proposed', label: 'Proposed' }, { id: 'approved', label: 'Approved' }, { id: 'dismissed', label: 'Dismissed' }, { id: 'retired', label: 'Retired' },
];

function errorOf(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

/** The crop needs the auth header, so it is fetched as a blob (never a bare <img src>). */
function ExampleCrop({ id, alt }: { id: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    api.get(`/learning/examples/${id}/crop.png`, { responseType: 'blob' })
      .then(r => { if (!live || typeof URL.createObjectURL !== 'function') return; made = URL.createObjectURL(r.data as Blob); setUrl(made); })
      .catch(() => { /* the crop is optional */ });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [id]);
  return url ? <img alt={alt} width={120} height={120} src={url} /> : <div style={{ width: 120, height: 120, background: 'var(--surface2)' }} aria-label={alt} />;
}

function LessonRow({ lesson, onChanged, setError }: { lesson: Lesson; onChanged: () => void; setError: (s: string | null) => void }) {
  const [text, setText] = useState(lesson.text);
  const [editing, setEditing] = useState(false);
  const [scope, setScope] = useState<ScopeKind>('all');
  const [counter, setCounter] = useState(lesson.appliesTo.includes('counter'));
  const [review, setReview] = useState(lesson.appliesTo.includes('review'));
  const [versions, setVersions] = useState<Lesson[] | null>(null);
  const sug = lesson.suggestedScope;
  const run = async (f: () => Promise<unknown>) => { setError(null); try { await f(); onChanged(); } catch (err) { setError(errorOf(err, 'Not saved')); } };
  const approve = (edited: boolean) => run(() => learningApi.approve(lesson.id, {
    ...(edited ? { text } : {}), scope_kind: scope, scope_value: scope === 'all' ? null : sug?.value ?? null,
    applies_to: [...(counter ? ['counter' as const] : []), ...(review ? ['review' as const] : [])],
  }));
  return (
    <li className="tr-item" data-testid={`lesson-${lesson.id}`}>
      <div className="tr-item-head"><strong>{lesson.status === 'approved' ? `L v${lesson.version}` : `v${lesson.version}`}</strong> <span className="tr-chip tr-chip-q">{lesson.pattern}</span></div>
      {editing
        ? <textarea aria-label="Lesson text" rows={2} maxLength={300} value={text} onChange={e => setText(e.target.value)} style={{ width: '100%' }} />
        : <div>{lesson.text}</div>}
      <ul className="tr-notes" data-testid={`lesson-evidence-${lesson.id}`}>
        {lesson.evidence.map(e => <li key={`${e.bidId}|${e.itemId}`}><a href={`/preconstruction?bid=${e.bidId}`}>{e.bidName}</a> — {e.itemId}: {e.answer}{e.reason ? ` (“${e.reason}”)` : ''} · {String(e.at).slice(0, 10)}</li>)}
      </ul>
      {lesson.status === 'proposed' && (
        <>
          <div className="tr-actions" role="group" aria-label="Scope">
            <label><input type="radio" name={`scope-${lesson.id}`} checked={scope === 'all'} onChange={() => setScope('all')} /> All jobs</label>
            {sug?.kind === 'project_type' && <label><input type="radio" name={`scope-${lesson.id}`} checked={scope === 'project_type'} onChange={() => setScope('project_type')} /> This project type: {sug.value}</label>}
            {sug?.kind === 'account' && <label><input type="radio" name={`scope-${lesson.id}`} checked={scope === 'account'} onChange={() => setScope('account')} /> This client</label>}
          </div>
          <div className="tr-actions" role="group" aria-label="Use in">
            <span className="tr-sub">Use in:</span>
            <label><input type="checkbox" checked={counter} onChange={e => setCounter(e.target.checked)} /> Counting</label>
            <label><input type="checkbox" checked={review} onChange={e => setReview(e.target.checked)} /> Review questions</label>
          </div>
          <div className="tr-actions">
            <button type="button" className="btn primary sm" data-testid={`lesson-approve-${lesson.id}`} disabled={!counter && !review} onClick={() => void approve(editing && text !== lesson.text)}>{editing ? 'Save & approve' : 'Approve'}</button>
            {!editing && <button type="button" className="btn ghost sm" onClick={() => setEditing(true)}>Edit &amp; approve</button>}
            <button type="button" className="btn ghost sm" data-testid={`lesson-dismiss-${lesson.id}`} onClick={() => void run(() => learningApi.dismiss(lesson.id))}>Dismiss</button>
          </div>
        </>
      )}
      {lesson.status === 'approved' && (
        <div className="tr-actions">
          <span className="tr-sub">{lesson.scopeKind === 'all' ? 'All jobs' : lesson.scopeKind === 'project_type' ? `Project type: ${lesson.scopeValue}` : 'This client'} · used in {lesson.appliesTo.join(' + ')}</span>
          <button type="button" className="btn ghost sm" onClick={() => void run(() => learningApi.retire(lesson.id))}>Retire</button>
        </div>
      )}
      <button type="button" className="tr-link" onClick={async () => setVersions(versions ? null : await learningApi.versions(lesson.id))}>{versions ? 'Hide versions' : 'Versions'}</button>
      {versions && (
        <ul className="tr-notes">
          {versions.map(v => (
            <li key={v.id}>v{v.version} ({v.status}): {v.text}
              {v.status === 'retired' && <> <button type="button" className="tr-link" onClick={() => void run(() => learningApi.restore(v.id))}>Restore v{v.version}</button></>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function LearningSection() {
  const confirm = useConfirm();
  const [tab, setTab] = useState<LessonStatus>('proposed');
  const [view, setView] = useState<'lessons' | 'examples'>('lessons');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [examples, setExamples] = useState<Example[]>([]);
  const [rel, setRel] = useState<{ releases: Release[]; activeId: number | null; waiting: { examples: number; lessons: number }; estimatedCost: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setLessons(await learningApi.lessons(tab));
      setRel(await learningApi.releases());
      if (view === 'examples') setExamples(await learningApi.examples());
    } catch (err) { setError(errorOf(err, 'Could not load')); }
  }, [tab, view]);
  useEffect(() => { void load(); }, [load]);
  const last = rel?.releases[0];
  return (
    <div data-testid="learning-section">
      <SectionTitle title="Counting lessons & examples" sub="Lessons are hints to the AI. They never change a count. Every use is shown on the run." />
      {error && <div className="tr-warn" role="alert">{error}</div>}
      <div className="tr-actions" role="tablist" aria-label="Learning">
        <button type="button" role="tab" aria-selected={view === 'lessons'} className="btn ghost sm" onClick={() => setView('lessons')}>Lessons</button>
        <button type="button" role="tab" aria-selected={view === 'examples'} className="btn ghost sm" onClick={() => setView('examples')}>Examples</button>
      </div>
      <div className="tr-bulk" data-testid="learning-releases">
        <span>{rel ? `${rel.waiting.examples} new example${rel.waiting.examples === 1 ? '' : 's'}, ${rel.waiting.lessons} approved lesson${rel.waiting.lessons === 1 ? '' : 's'} waiting.` : '…'}</span>
        <button type="button" className="btn primary sm" data-testid="learning-check-release"
          onClick={async () => {
            const ok = await confirm({
              title: 'Check and release?',
              body: <div>This runs the counter on the held-out jobs (Kissimmee and 36th Street) with and without the new examples and lessons — about {rel?.estimatedCost ?? '$12–15'} of AI calls. Each job is checked only against examples from OTHER jobs (never its own drawings); a job with none is reported “no change” and costs nothing. The release goes live only if no item gets worse.</div>,
              confirmLabel: 'Run the check',
            });
            if (!ok) return;
            try {
              const r = await learningApi.createRelease();
              await learningApi.checkRelease(r.id);
              setNote('Checking — this takes a while. The result appears below.');
              void load();
            } catch (err) { setError(errorOf(err, 'The check could not start')); }
          }}>Check and release</button>
        <button type="button" className="btn ghost sm" onClick={() => void learningApi.checkLessons().then(load)}>Check for new lessons</button>
      </div>
      {note && <div className="tr-sub">{note}</div>}
      {last && (
        <div className="tr-sub" data-testid="learning-last-release">
          Last release #{last.id}: {last.status}{rel?.activeId === last.id ? ' (in use)' : ''}
          {Array.isArray((last.eval as { jobs?: unknown[] } | null)?.jobs) && (
            <ul className="tr-notes">
              {((last.eval as { jobs: Array<{ label: string; note: string; gate?: { rows: Array<{ id: string; aWorst: number | null; bWorst: number | null; verdict: string }> } }> }).jobs).map(j => (
                <li key={j.label}>{j.label}: {j.note}
                  {j.gate && <table><tbody>{j.gate.rows.map(r => <tr key={r.id}><td>{r.id}</td><td>{r.aWorst ?? '—'}</td><td>{r.bWorst ?? '—'}</td><td>{r.verdict}</td></tr>)}</tbody></table>}
                </li>
              ))}
            </ul>
          )}
          {rel && rel.releases.length > 1 && rel.releases.filter(r => r.status === 'passed' && r.id !== rel.activeId).slice(0, 1).map(r => (
            <button key={r.id} type="button" className="tr-link" onClick={() => void learningApi.rollback(r.id).then(load)}>Roll back to #{r.id}</button>
          ))}
        </div>
      )}
      {view === 'lessons' ? (
        <>
          <div className="tr-actions" role="tablist" aria-label="Lesson status">
            {TABS.map(t => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="btn ghost sm" data-testid={`lessons-tab-${t.id}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
          </div>
          {lessons.length === 0 ? <div className="tr-sub">None.</div> : (
            <ul className="tr-list">{lessons.map(l => <LessonRow key={l.id} lesson={l} onChanged={() => void load()} setError={setError} />)}</ul>
          )}
        </>
      ) : (
        <ul className="tr-list" data-testid="learning-examples" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {examples.map(e => (
            <li key={e.id} className="tr-item" style={{ width: 200 }} data-testid={`example-${e.id}`}>
              <ExampleCrop id={e.id} alt={`Example: ${e.meaning.description}`} />
              <div><span className="tr-chip tr-chip-q">{e.polarity === 'positive' ? 'Is' : 'Is not'}</span> {e.notADevice ? 'not a device' : e.meaning.description}</div>
              {e.confusedWith && <div className="tr-sub">read as: {e.confusedWith.description}</div>}
              {e.conflicted && <div className="tr-chip tr-chip-warn">Means different things on different sets</div>}
              <div className="tr-sub">{e.sourceBidName ?? 'a bid'} · {e.status}</div>
              {e.status !== 'retired' && <button type="button" className="btn ghost sm" onClick={() => void learningApi.retireExample(e.id).then(load)}>Retire</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
