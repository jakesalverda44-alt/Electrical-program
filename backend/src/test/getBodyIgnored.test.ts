import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../index';

describe('GET with an oversized body', () => {
  it('is not rejected with 413 (body parsing skipped for GET)', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(200_000) });
    const res = await request(app).get('/api/health')
      .set('Content-Type', 'application/json').send(big);
    expect(res.status).not.toBe(413);
    expect(res.status).toBe(200);
  });

  it('still rejects an oversized POST body', async () => {
    const res = await request(app).post('/api/health')
      .set('Content-Type', 'application/json').send(JSON.stringify({ pad: 'x'.repeat(200_000) }));
    expect(res.status).toBe(413);
  });
});
