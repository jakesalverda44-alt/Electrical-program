// @vitest-environment happy-dom
//
// The board card no longer carries a stage badge — the card sits in the stage's own
// column, so the badge only repeated the heading. What the column can't say is whether
// a card needs attention, and these lock which states earn a marker.
//
// The rule that matters: a card that is simply progressing shows nothing. If everything
// earns a pill, the pills stop meaning anything.
import { describe, it, expect } from 'vitest';
import { cardAttentionFor } from './cardAttention';
import { Gen } from '../../types';

const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const gen = (over: Partial<Gen>) => ({ id: 'g', customer: 'c', stage: 'sent', ...over }) as Gen;

describe('cards that need you', () => {
  it('flags a signed contract waiting on your countersignature, whatever its age', () => {
    const r = cardAttentionFor(gen({ stage: 'signed', signed_at: days(0) }));
    expect(r?.text).toMatch(/signature/i);
    expect(r?.kind).toBe('act');
  });

  it('stops flagging it once countersigned', () => {
    expect(cardAttentionFor(gen({
      stage: 'signed', signed_at: days(2), countersigned_at: days(1),
    }))).toBeNull();
  });

  it('distinguishes read-and-gone-quiet from never-opened', () => {
    const read = cardAttentionFor(gen({ stage: 'sent', sent_at: days(10), viewed_at: days(4) }));
    const unopened = cardAttentionFor(gen({ stage: 'sent', sent_at: days(6) }));
    expect(read?.text).toMatch(/read/i);
    expect(unopened?.text).toMatch(/unopened/i);
  });

  it('calls a long-unanswered proposal stale rather than merely unopened', () => {
    expect(cardAttentionFor(gen({ stage: 'sent', sent_at: days(45) }))?.text).toMatch(/stale/i);
  });

  it('flags a proposal that has sat unsent in Building', () => {
    expect(cardAttentionFor(gen({ stage: 'building', built_on: days(12) }))?.text).toMatch(/unsent/i);
  });
});

describe('cards that are fine', () => {
  it('says nothing about a proposal sent yesterday', () => {
    expect(cardAttentionFor(gen({ stage: 'sent', sent_at: days(1) }))).toBeNull();
  });

  it('says nothing about one read this morning', () => {
    expect(cardAttentionFor(gen({ stage: 'sent', sent_at: days(3), viewed_at: days(0) }))).toBeNull();
  });

  it('says nothing about a proposal still being built this week', () => {
    expect(cardAttentionFor(gen({ stage: 'building', built_on: days(2) }))).toBeNull();
  });

  it('says nothing about an awarded job — it is won, not pending', () => {
    expect(cardAttentionFor(gen({ stage: 'awarded', signed_at: days(9), countersigned_at: days(8) }))).toBeNull();
  });
});
