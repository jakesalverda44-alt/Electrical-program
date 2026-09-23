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

export function fakeAnthropic(responder: Responder): { client: Anthropic; calls: FakeRequest[] } {
  const calls: FakeRequest[] = [];
  const run = async (req: FakeRequest) => {
    const i = calls.length;
    calls.push(req);
    return toMessage(req, await responder(req, i));
  };
  const client = {
    messages: {
      create: (req: FakeRequest) => run(req),
      stream: (req: FakeRequest) => ({ finalMessage: () => run(req) }),
    },
  } as unknown as Anthropic;
  return { client, calls };
}
