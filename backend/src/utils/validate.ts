import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

/**
 * Returns middleware that validates req.body against a Zod schema.
 * On success the parsed (and coerced) value replaces req.body; on failure it
 * responds 400 with a concise field-level message.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const first = result.error.issues[0];
      const path = first?.path.join('.') || 'body';
      return res.status(400).json({ error: `${path}: ${first?.message || 'Invalid input'}` });
    }
    req.body = result.data;
    next();
  };
}
