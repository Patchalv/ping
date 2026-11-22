// Asking for an email change through Better Auth's change-email flow, and hearing whether
// the link went. Better Auth calls Ping's sendVerificationEmail from inside changeEmail
// but swallows (and logs) anything it throws, so the outcome travels back through
// AsyncLocalStorage, scoped to the one request.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Auth } from '.';

/** `sent`: the link went. `held`: staging kept it back. `failed`: the send failed. */
export type EmailChangeSend = 'sent' | 'held' | 'failed';

const outcome = new AsyncLocalStorage<{ result?: EmailChangeSend }>();

/** Called by the send callback in createAuth with what happened to the link. */
export function reportEmailChangeSend(result: EmailChangeSend): void {
  const store = outcome.getStore();
  if (store) store.result = result;
}

/**
 * Runs Better Auth's change-email flow for the signed-in Staff member (from `headers`),
 * which emails a link to `newEmail`. The caller checks permission and that the address is
 * free first: Better Auth answers success for an address in use, to hide it.
 */
export async function requestEmailChange(
  auth: Auth,
  input: { headers: Headers; newEmail: string },
): Promise<EmailChangeSend> {
  const store: { result?: EmailChangeSend } = {};
  await outcome.run(store, () =>
    auth.api.changeEmail({ body: { newEmail: input.newEmail }, headers: input.headers }),
  );
  if (!store.result) throw new Error('Better Auth sent no email-change link');
  return store.result;
}
