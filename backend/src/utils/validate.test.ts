import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validateBody } from './validate';

function run(schema: Parameters<typeof validateBody>[0], body: unknown) {
  const req = { body } as any;
  const json = vi.fn();
  const res = { status: vi.fn().mockReturnValue({ json }), json } as any;
  const next = vi.fn();
  validateBody(schema)(req, res, next);
  return { req, res, next, json };
}

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email().optional(),
});

describe('validateBody', () => {
  it('calls next and keeps parsed body on valid input', () => {
    const { next, req } = run(schema, { name: 'Acme' });
    expect(next).toHaveBeenCalledOnce();
    expect(req.body).toEqual({ name: 'Acme' });
  });

  it('responds 400 with a field-scoped message on invalid input', () => {
    const { res, next, json } = run(schema, { name: '' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: expect.stringContaining('name') });
  });

  it('rejects a malformed email', () => {
    const { res } = run(schema, { name: 'Acme', email: 'not-an-email' });
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
