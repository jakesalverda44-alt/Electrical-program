// Takeoff accuracy, Task 1 (Decision 9, last bullet): every agent call checks
// `stop_reason === 'max_tokens'` and FAILS the run instead of silently
// handing a truncated (and often unparseable, or parseable-but-partial) JSON
// body downstream. Before this, a truncated Agent 1 batch was only logged and
// then silently skipped by the batch merge, so the takeoff simply lost the
// sheets that batch covered.
//
// Pure: no I/O. Every call site passes the response it just got and a human
// label; the thrown message is what the estimator sees in the UI.

export class AgentTruncatedError extends Error {
  readonly agentLabel: string;
  readonly maxTokens: number | null;

  constructor(agentLabel: string, maxTokens: number | null, hint?: string) {
    super(`${agentLabel} ran out of room — raise its Max Tokens${hint ? ` (${hint})` : ' in Settings → AI'}${maxTokens ? `; it stopped at ${maxTokens.toLocaleString('en-US')} tokens` : ''}.`);
    this.name = 'AgentTruncatedError';
    this.agentLabel = agentLabel;
    this.maxTokens = maxTokens;
  }
}

export function isAgentTruncatedError(err: unknown): err is AgentTruncatedError {
  return err instanceof AgentTruncatedError
    || (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AgentTruncatedError');
}

/** Throws AgentTruncatedError when the response stopped because it hit
 *  max_tokens. Any other stop_reason (end_turn, stop_sequence, refusal, ...)
 *  passes — refusals and parse failures are handled by each call site's own
 *  existing error path. */
export function assertNotTruncated(
  resp: { stop_reason?: string | null } | null | undefined,
  agentLabel: string,
  maxTokens: number | null,
  hint?: string,
): void {
  if (resp?.stop_reason === 'max_tokens') {
    throw new AgentTruncatedError(agentLabel, maxTokens, hint);
  }
}
