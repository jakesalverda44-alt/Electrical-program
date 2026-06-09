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

/**
 * Maps Postgres constraint-violation error codes that stem from bad client input
 * to a user-facing 400 message, or returns null when the error is not input-related
 * (the caller should rethrow so it surfaces as a 500). Use as a safety net around
 * writes for cases schema validation can't catch — e.g. a well-formed UUID that
 * references a non-existent row (foreign-key violation).
 */
export function inputErrorMessage(err: unknown): string | null {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case '23514': return 'A field has an invalid value.';         // check_violation
    case '23503': return 'A referenced record does not exist.';   // foreign_key_violation
    case '23502': return 'A required field is missing.';          // not_null_violation
    case '22P02': return 'A field is malformed.';                 // invalid_text_representation
    case '22007':
    case '22008': return 'A date field is invalid.';              // datetime field overflow/format
    default: return null;
  }
}
