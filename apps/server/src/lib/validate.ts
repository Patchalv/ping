// Every route validates its params, query and body with a zod schema from packages/shared,
// then reads them only through c.req.valid(...). A failure throws ValidationError with
// every failing field, which onError turns into a 400 the UI can show.
import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { ZodType } from 'zod';
import { ValidationError } from './errors';

export const validate = <Target extends keyof ValidationTargets, Schema extends ZodType>(
  target: Target,
  schema: Schema,
) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      const issues = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      throw new ValidationError(issues[0]?.message ?? 'Check the request.', issues);
    }
  });
