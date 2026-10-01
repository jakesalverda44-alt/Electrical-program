// Level 2 learning, Task 15 — "Learning used on this run": the examples and
// approved lessons the counter was shown, and the lessons hinted on review
// questions, each with "Turn off for this bid" (takes effect on the next
// analysis run). Collapsed; hidden when nothing was used.
import React, { useEffect, useState } from 'react';
import { learningApi, type BidLearning } from '../../../../api/learning';

/** `initial` comes with GET /review (the panel already reads it); nothing is fetched here. */
export default function LearningUsedStrip({ bidId, initial }: { bidId: string; initial: BidLearning | null | undefined }) {
  const [data, setData] = useState<BidLearning | null>(initial ?? null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { setData(initial ?? null); }, [initial]);
  const lr = data?.learning;
  const examples = lr?.examplesUsed ?? [];
  const lessons = lr?.lessonsUsed ?? [];
  const hints = data?.reviewHints ?? [];
  const hintLessons = [...new Map(hints.flatMap(h => h.hints).map(h => [h.lessonId, h])).values()];
  if (!examples.length && !lessons.length && !hintLessons.length) return null;
  const lessonCount = lessons.length + hintLessons.filter(h => !lessons.some(l => l.lessonId === h.lessonId)).length;
  const off = async (body: { refKind: 'example' | 'lesson' | 'all'; refId?: string }) => {
    try { const r = await learningApi.setOff(bidId, body); setData(d => (d ? { ...d, off: r.off } : d)); setNote(r.note); } catch { setNote('Could not turn it off.'); }
  };
  const isOff = (kind: 'example' | 'lesson', id: string) => !!data?.off.all || (kind === 'example' ? data?.off.examples.includes(id) : data?.off.lessons.includes(id));
  return (
    <details className="tr-resolved" data-testid="learning-used">
      <summary>Learning used on this run: {examples.length} symbol example{examples.length === 1 ? '' : 's'}, {lessonCount} lesson{lessonCount === 1 ? '' : 's'}</summary>
      <ul className="tr-list">
        {lessons.map((l, i) => (
          <li key={l.lessonId} className="tr-item" data-testid={`learning-lesson-${l.lessonId}`}>
            Used lesson: L{i + 1} v{l.version} — “{l.text}” <span className="tr-sub">({l.sheets.join(', ')})</span>{' '}
            {isOff('lesson', l.lessonId) ? <span className="tr-sub">off for this bid</span>
              : <button type="button" className="btn ghost sm" data-testid={`learning-off-lesson-${l.lessonId}`} onClick={() => void off({ refKind: 'lesson', refId: l.lessonId })}>Turn off for this bid</button>}
          </li>
        ))}
        {hintLessons.filter(h => !lessons.some(l => l.lessonId === h.lessonId)).map(h => (
          <li key={h.lessonId} className="tr-item" data-testid={`learning-hint-${h.lessonId}`}>
            Review hint: v{h.version} — “{h.text}”{' '}
            {isOff('lesson', h.lessonId) ? <span className="tr-sub">off for this bid</span>
              : <button type="button" className="btn ghost sm" onClick={() => void off({ refKind: 'lesson', refId: h.lessonId })}>Turn off for this bid</button>}
          </li>
        ))}
        {examples.map((e, i) => (
          <li key={`${e.id}|${e.targetKey}`} className="tr-item" data-testid={`learning-example-${e.id}`}>
            Example X{i + 1} for {e.targetKey} ({e.polarity === 'positive' ? 'is' : 'is not'} “{e.meaning}”) — from {e.sourceBidName ?? 'another bid'}{' '}
            {isOff('example', e.id) ? <span className="tr-sub">off for this bid</span>
              : <button type="button" className="btn ghost sm" onClick={() => void off({ refKind: 'example', refId: e.id })}>Turn off for this bid</button>}
          </li>
        ))}
      </ul>
      <div className="tr-actions">
        {!data?.off.all && <button type="button" className="btn ghost sm" onClick={() => void off({ refKind: 'all' })}>Turn all learning off for this bid</button>}
        <span className="tr-sub">{note ?? 'Takes effect on the next analysis run.'}</span>
      </div>
    </details>
  );
}
