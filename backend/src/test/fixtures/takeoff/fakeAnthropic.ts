// Takeoff accuracy — a fake Anthropic client for driving the REAL pipeline
// in tests. Never a network call: every messages.create / messages.stream
// goes to a responder the test supplies, which decides the reply from the
// request (the system prompt identifies which agent is calling).
import type Anthropic from '@anthropic-ai/sdk';

export interface FakeRequest {
  model: string;
  max_tokens: number;
  system?: unknown;
  messages: Array<{ role: string; content: unknown }>;
  [k: string]: unknown;
}

export interface FakeReply {
  text: string;
  stop_reason?: 'end_turn' | 'max_tokens' | 'refusal' | 'stop_sequence';
  usage?: { input_tokens: number; output_tokens: number };
}

export type Responder = (req: FakeRequest, callIndex: number) => FakeReply | Promise<FakeReply>;

/** The system prompt text of a request (string or [{type:'text',text}]). */
export function systemText(req: FakeRequest): string {
  const s = req.system;
  if (typeof s === 'string') return s;
  if (Array.isArray(s)) return s.map(b => (b as { text?: string }).text ?? '').join('\n');
  return '';
}

/** All text blocks of the (single) user message, joined. */
export function userText(req: FakeRequest): string {
  const c = req.messages[0]?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter(b => (b as { type: string }).type === 'text').map(b => (b as { text: string }).text).join('\n');
  return '';
}

export function imageCount(req: FakeRequest): number {
  const c = req.messages[0]?.content;
  return Array.isArray(c) ? c.filter(b => (b as { type: string }).type === 'image').length : 0;
}

function toMessage(req: FakeRequest, r: FakeReply): Anthropic.Message {
  return {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model: req.model,
    content: [{ type: 'text', text: r.text, citations: null }],
    stop_reason: r.stop_reason ?? 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: r.usage?.input_tokens ?? 100, output_tokens: r.usage?.output_tokens ?? 50 },
  } as unknown as Anthropic.Message;
}

/** The Anthropic SDK (0.100.x) refuses a NON-streaming messages.create whose
 *  max_tokens implies it may run past 10 minutes (calculateNonstreamingTimeout
 *  — about 21,333 tokens). The fake enforces the same rule so a call site that
 *  regresses to messages.create with a big budget fails in tests exactly as it
 *  did live (Agent 4 at 32,000). */
export const SDK_NONSTREAMING_MAX_TOKENS = 21_333;

export function fakeAnthropic(responder: Responder): { client: Anthropic; calls: FakeRequest[]; paths: Array<'create' | 'stream'> } {
  const calls: FakeRequest[] = [];
  const paths: Array<'create' | 'stream'> = [];
  const run = async (req: FakeRequest, path: 'create' | 'stream') => {
    const i = calls.length;
    calls.push(req);
    paths.push(path);
    return toMessage(req, await responder(req, i));
  };
  const client = {
    messages: {
      create: (req: FakeRequest) => {
        if (req.max_tokens > SDK_NONSTREAMING_MAX_TOKENS) {
          return Promise.reject(new Error('Streaming is required for operations that may take longer than 10 minutes. See https://github.com/anthropics/anthropic-sdk-typescript#long-requests for more details'));
        }
        return run(req, 'create');
      },
      stream: (req: FakeRequest) => ({ finalMessage: () => run(req, 'stream') }),
    },
  } as unknown as Anthropic;
  return { client, calls, paths };
}

/** Evidence round — the viewport / typicals / schedule readers' requests
 *  (their system prompts), answered EMPTY: no viewports found, no typical
 *  packages, so the counting stage behaves exactly as before. For tests that
 *  are not about the evidence round; kissimmeeReplies.ts has the real ones. */
export function emptyEvidenceReply(req: FakeRequest): FakeReply | null {
  const sys = systemText(req);
  if (sys.includes('DRAWING VIEWPORTS')) return { text: '{"viewports":[]}' };
  if (sys.includes('TYPICAL DEVICE PACKAGES')) return { text: '{"packages":[]}' };
  if (sys.includes('transcribe ONE table')) return { text: '{"title":"","columns":[],"rows":[]}' };
  return null;
}
