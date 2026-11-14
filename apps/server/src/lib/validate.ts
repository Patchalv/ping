// Every route validates its params, query and body with a zod schema from packages/shared,
// then reads them only through c.req.valid(...). A failure throws ValidationError, which
// onError turns into a 400 the UI can show.
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
      throw new ValidationError(result.error.issues[0]?.message ?? 'Check the request.');
    }
  });
