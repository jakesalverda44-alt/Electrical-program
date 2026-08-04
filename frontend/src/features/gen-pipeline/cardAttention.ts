// Whether a board card needs attention, and what to say about it.
//
// The card sits in its stage's own column, so a badge reading "Sent" on a card in the
// Sent column told nobody anything. This answers the question the column can't: is this
// one waiting on me, and how long has it been sitting?
//
// A card that is simply progressing returns null. That restraint is the point — if every
// card carries a pill, the pills stop meaning anything.
import { Gen } from '../../types';

export type AttentionKind = 'act' | 'warn' | 'idle';

export interface Attention {
  text: string;
  kind: AttentionKind;
}

function daysSince(ts?: string | null): number {
  if (!ts) return 0;
  const t = new Date(ts).getTime();
  if (isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / 86_400_000);
}

/** Thresholds are deliberately generous: a proposal read this morning is not a problem,
 *  and nagging about it would train the rep to ignore the marker. */
const READ_QUIET_DAYS = 3;
const UNOPENED_DAYS = 3;
const STALE_DAYS = 30;
const UNSENT_DAYS = 7;

export function cardAttentionFor(g: Gen): Attention | null {
  // Awarded is won. Nothing about it is pending, whatever its timestamps say.
  if (g.stage === 'awarded') return null;

  // The customer has done their part; the deal is now waiting on us. This outranks any
  // age-based marker, and has no threshold — it is actionable the moment it is true.
  if (g.signed_at && !g.countersigned_at) {
    return { text: 'Needs your signature', kind: 'act' };
  }

  if (g.stage === 'sent') {
    if (g.viewed_at) {
      const seen = daysSince(g.viewed_at);
      // Read and gone quiet is a different problem from never opened, and calls for a
      // different follow-up, so the card distinguishes them rather than saying "stale".
      return seen >= READ_QUIET_DAYS ? { text: `Read ${seen}d ago`, kind: 'warn' } : null;
    }
    const sent = daysSince(g.sent_at);
    if (sent >= STALE_DAYS) return { text: `Stale · ${sent}d`, kind: 'warn' };
    if (sent >= UNOPENED_DAYS) return { text: `Unopened ${sent}d`, kind: 'idle' };
    return null;
  }

  if (g.stage === 'building') {
    const age = daysSince(g.built_on);
    if (age >= UNSENT_DAYS) return { text: `Unsent ${age}d`, kind: 'idle' };
  }

  return null;
}
