// @vitest-environment happy-dom
// Audit frontend-code #15 (Medium) — 35 `.catch(() => {})` sites, and `console`
// used exactly twice in non-test code, so a production failure left no trace in
// the UI, the console, or on a server. This is the sink; its one hard rule is
// that reporting a failure must never become a second failure.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reportError, resetReportErrorLimit } from './reportError';

const TOKEN = 'jwt.token.value';

beforeEach(() => {
  resetReportErrorLimit();
  localStorage.clear();
  localStorage.setItem('crm_token', TOKEN);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(impl: () => unknown) {
  const fetchMock = vi.fn(impl as never);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const bodyOf = (fetchMock: ReturnType<typeof stubFetch>, call = 0) =>
  JSON.parse((fetchMock.mock.calls[call][1] as { body: string }).body);

describe('reportError', () => {
  it('posts the message, stack, context and page to /api/client-errors', () => {
    const fetchMock = stubFetch(() => Promise.resolve({ ok: true }));

    reportError(new Error('ProposalPreview exploded'), 'ErrorBoundary (page)');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { keepalive?: boolean }];
    expect(url).toBe('/api/client-errors');
    expect(init.method).toBe('POST');
    // Survives the page unload a crash often precedes.
    expect(init.keepalive).toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);

    const body = bodyOf(fetchMock);
    expect(body.message).toBe('ProposalPreview exploded');
    expect(body.context).toBe('ErrorBoundary (page)');
    expect(typeof body.stack).toBe('string');
    expect(body.url).toContain('http');
  });

  it('never throws when fetch rejects', () => {
    stubFetch(() => Promise.reject(new Error('offline')));

    expect(() => reportError(new Error('boom'), 'test')).not.toThrow();
  });

  it('never throws when fetch is missing entirely', () => {
    vi.stubGlobal('fetch', undefined);

    expect(() => reportError(new Error('boom'), 'test')).not.toThrow();
  });

  it('never throws when fetch throws synchronously', () => {
    stubFetch(() => { throw new Error('CSP blocked it'); });

    expect(() => reportError(new Error('boom'), 'test')).not.toThrow();
  });

  it('stays silent with no session token — there is nobody to attribute it to', () => {
    localStorage.removeItem('crm_token');
    const fetchMock = stubFetch(() => Promise.resolve({ ok: true }));

    reportError(new Error('boom'), 'test');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores a request we cancelled ourselves', () => {
    const fetchMock = stubFetch(() => Promise.resolve({ ok: true }));

    reportError(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED', isAxiosError: true }), 'useApi /x');
    reportError(Object.assign(new Error('aborted'), { name: 'AbortError' }), 'useApi /x');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rate limits to 10 reports a minute so a render loop cannot flood', () => {
    const fetchMock = stubFetch(() => Promise.resolve({ ok: true }));

    for (let i = 0; i < 25; i++) reportError(new Error(`boom ${i}`), 'loop');

    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('describes a non-Error axios rejection using the same message the UI shows', () => {
    const fetchMock = stubFetch(() => Promise.resolve({ ok: true }));

    reportError({ isAxiosError: true, response: { status: 500, data: {} } }, 'useMutation');

    expect(bodyOf(fetchMock).message).toBe('500: Server error');
  });

  it('truncates a very long message and stack rather than posting them whole', () => {
    const fetchMock = stubFetch(() => Promise.resolve({ ok: true }));
    const err = new Error('x'.repeat(5_000));
    err.stack = 'y'.repeat(20_000);

    reportError(err, 'test');

    const body = bodyOf(fetchMock);
    expect(body.message.length).toBe(2_000);
    expect(body.stack.length).toBe(4_000);
  });
});
