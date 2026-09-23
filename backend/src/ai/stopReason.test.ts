import { describe, expect, it } from 'vitest';
import { AgentTruncatedError, assertNotTruncated, isAgentTruncatedError } from './stopReason';

describe('assertNotTruncated', () => {
  it('throws the estimator-facing message on max_tokens', () => {
    expect(() => assertNotTruncated({ stop_reason: 'max_tokens' }, 'Agent 1', 16000))
      .toThrow('Agent 1 ran out of room — raise its Max Tokens in Settings → AI; it stopped at 16,000 tokens.');
  });

  it('passes every other stop reason', () => {
    for (const r of ['end_turn', 'stop_sequence', 'refusal', 'tool_use', null, undefined]) {
      expect(() => assertNotTruncated({ stop_reason: r as string | null }, 'Agent 2', 4000)).not.toThrow();
    }
    expect(() => assertNotTruncated(undefined, 'Agent 2', 4000)).not.toThrow();
  });

  it('carries a custom hint for calls with no Settings field', () => {
    try {
      assertNotTruncated({ stop_reason: 'max_tokens' }, 'Page classifier', 2500, 'fixed at 2,500 per 20-page batch');
      expect.unreachable();
    } catch (err) {
      expect(isAgentTruncatedError(err)).toBe(true);
      expect((err as Error).message).toBe('Page classifier ran out of room — raise its Max Tokens (fixed at 2,500 per 20-page batch); it stopped at 2,500 tokens.');
      expect((err as AgentTruncatedError).agentLabel).toBe('Page classifier');
    }
  });
});
