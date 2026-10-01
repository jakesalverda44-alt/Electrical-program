// Level 2 learning, Tasks 11 + 13 — the bank a counting run may use: ONLY
// the examples and lessons of the newest passed learning release (L7). New
// captures and approvals wait as candidates until a release passes the
// check. Loaded before counting; a failure here means "no learning", never
// a failed run.
import crypto from 'crypto';
import { logger } from '../../utils/logger';
import { activeRelease, listExamples, listLessons, learningOffFor, type LearningOff } from './learningDb';
import { clusterOf } from './visualHash';
import type { LearningBank } from './counterLearning';
import type { BankExample } from './selectExamples';

export async function loadReleaseBank(): Promise<LearningBank | null> {
  const rel = await activeRelease();
  if (!rel) return null;
  const all = rel.exampleIds.length ? await listExamples({ ids: rel.exampleIds, withCrop: true, limit: 5000 }) : [];
  const live = all.filter(e => e.status !== 'retired' && e.crop);
  const clusters = clusterOf(live.map(e => ({ id: e.id, dhash: e.dhash, deviceClass: e.meaning.deviceClass, meaningFp: e.meaning.meaningFp })));
  const examples: Array<BankExample & { crop: Buffer }> = live.map(e => ({
    id: e.id, polarity: e.polarity, meaning: e.meaning, confusedWith: e.confusedWith, notADevice: e.notADevice, quality: e.quality,
    sourceBidId: e.sourceBidId, sourceBidName: e.sourceBidName, sourceDocSha: e.sourceDocSha, createdAt: e.createdAt, dhash: e.dhash,
    conflicted: clusters.get(e.id)?.conflicted ?? false, crop: e.crop!,
  }));
  const lessons = rel.lessonIds.length ? (await listLessons({ ids: rel.lessonIds })).filter(l => l.status === 'approved') : [];
  return { releaseId: rel.id, examples, lessons: lessons.map(l => ({ id: l.id, version: l.version, text: l.text, appliesTo: l.appliesTo, scopeKind: l.scopeKind, scopeValue: l.scopeValue, match: l.match })) };
}

export async function loadBankSafely(bidId: string): Promise<{ bank: LearningBank | null; off: LearningOff }> {
  try {
    return { bank: await loadReleaseBank(), off: await learningOffFor(bidId) };
  } catch (err) {
    logger.warn({ err, bidId }, '[learning] could not load the release bank — counting without learning');
    return { bank: null, off: { all: false, examples: new Set(), lessons: new Set() } };
  }
}

export function shaOf(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
