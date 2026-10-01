import { describe, it, expect } from 'vitest';
import api from './client';

describe('api client GET requests', () => {
  it('never include a body or Content-Type', async () => {
    let seen: { data?: unknown; ct?: unknown } = {};
    const res = await api.get('/documents', {
      params: { linked_id: 'b1' },
      data: { big: 'x'.repeat(200_000) },
      headers: { 'Content-Type': 'application/json' },
      adapter: async (config) => {
        seen = { data: config.data, ct: config.headers.get?.('Content-Type') };
        return { data: [], status: 200, statusText: 'OK', headers: {}, config };
      },
    });
    expect(res.status).toBe(200);
    expect(seen.data).toBeUndefined();
    expect(seen.ct).toBeFalsy();
  });

  it('keeps the body on a POST', async () => {
    let data: unknown;
    await api.post('/x', { a: 1 }, {
      adapter: async (config) => { data = config.data; return { data: {}, status: 200, statusText: 'OK', headers: {}, config }; },
    });
    expect(data).toBeTruthy();
  });
});
