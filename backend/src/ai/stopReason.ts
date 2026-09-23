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

  constructor(agentLabel: string, maxTokens: number | null, hint?: string, message?: string) {
    super(message ?? `${agentLabel} ran out of room — raise its Max Tokens${hint ? ` (${hint})` : ' in Settings → AI'}${maxTokens ? `; it stopped at ${maxTokens.toLocaleString('en-US')} tokens` : ''}.`);
    this.name = 'AgentTruncatedError';
    this.agentLabel = agentLabel;
    this.maxTokens = maxTokens;
  }
}

export function isAgentTruncatedError(err: unknown): err is AgentTruncatedError {
  return err instanceof AgentTruncatedError
    || (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AgentTruncatedError');
}

/** Fix round 1 / N2 — a refusal is not an answer: the agent's output must
 *  never be parsed as if it were one. */
export class AgentRefusedError extends Error {
  readonly agentLabel: string;
  constructor(agentLabel: string) {
    super(`${agentLabel} declined to answer (the model refused this request). Re-run it; if it keeps refusing, check the uploaded documents.`);
    this.name = 'AgentRefusedError';
    this.agentLabel = agentLabel;
  }
}

/** Stop reasons that mean the reply was cut off. */
const TRUNCATED = new Set(['max_tokens', 'model_context_window_exceeded']);

/** Throws AgentTruncatedError when the response was cut off — it hit
 *  max_tokens, or (N2) the model's context window — and AgentRefusedError on
 *  a refusal. end_turn / stop_sequence / tool_use pass. */
export function assertNotTruncated(
  resp: { stop_reason?: string | null } | null | undefined,
  agentLabel: string,
  maxTokens: number | null,
  hint?: string,
): void {
  const reason = resp?.stop_reason ?? '';
  if (reason === 'model_context_window_exceeded') {
    throw new AgentTruncatedError(agentLabel, maxTokens, undefined,
      `${agentLabel} was cut off: its input plus output exceeded the model's context window. Split the upload into smaller sets (raising Max Tokens will not help).`);
  }
  if (TRUNCATED.has(reason)) throw new AgentTruncatedError(agentLabel, maxTokens, hint);
  if (reason === 'refusal') throw new AgentRefusedError(agentLabel);
}
