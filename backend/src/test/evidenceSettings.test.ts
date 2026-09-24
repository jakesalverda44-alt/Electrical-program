// Evidence round — the evidence readers' model and max tokens are settings
// (Settings -> AI -> Evidence Readers): code defaults when unset, and a save
// round-trips into loadAIConfig. Test DB only; every value is put back.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { dbAvailable, makeUser, auth } from './harness';
import { loadAIConfig, DEFAULT_EVIDENCE_MODEL, DEFAULT_MAX_TOKENS_EVIDENCE } from '../routes/preconstruction';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('ai_takeoff_evidence_model / ai_max_tokens_evidence', () => {
  it('defaults, then PUT -> GET -> loadAIConfig', async (ctx) => {
    if (!ok) return ctx.skip();
    const admin = await makeUser('owner');
    const before = await request(app).get('/api/settings').set(auth(admin.token)).expect(200);
    const prev = Object.fromEntries((before.body as { key: string; value: string }[]).map(r => [r.key, r.value]));
    try {
      await request(app).put('/api/settings').set(auth(admin.token)).send({ ai_takeoff_evidence_model: '', ai_max_tokens_evidence: '' }).expect(200);
      let cfg = await loadAIConfig();
      expect([cfg.modelEvidence, cfg.maxTokensEvidence]).toEqual([DEFAULT_EVIDENCE_MODEL, DEFAULT_MAX_TOKENS_EVIDENCE]);
      await request(app).put('/api/settings').set(auth(admin.token)).send({ ai_takeoff_evidence_model: 'claude-opus-5-5', ai_max_tokens_evidence: '24000' }).expect(200);
      const res = await request(app).get('/api/settings').set(auth(admin.token)).expect(200);
      const byKey = Object.fromEntries((res.body as { key: string; value: string }[]).map(r => [r.key, r.value]));
      expect(byKey.ai_takeoff_evidence_model).toBe('claude-opus-5-5');
      cfg = await loadAIConfig();
      expect([cfg.modelEvidence, cfg.maxTokensEvidence]).toEqual(['claude-opus-5-5', 24000]);
    } finally {
      await request(app).put('/api/settings').set(auth(admin.token))
        .send({ ai_takeoff_evidence_model: prev.ai_takeoff_evidence_model ?? '', ai_max_tokens_evidence: prev.ai_max_tokens_evidence ?? '' }).expect(200);
    }
  });
});
