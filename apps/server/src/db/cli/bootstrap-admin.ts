// `bootstrap-admin --email <email> --name <name>`: invites the first Admin and sends the
// normal invite email (product.md › The first Admin). It never sets a password, and it
// refuses if any Admin exists, active or Invited. In prod, Patrick runs it once:
//
//   fly ssh console --app bypatrick-ping --command \
//     "sh -c 'cd /app/apps/server && node --import tsx src/db/cli/bootstrap-admin.ts --email … --name …'"
//
// Locally: pnpm --filter @ping/server exec tsx src/db/cli/bootstrap-admin.ts --email … --name …
import { parseArgs } from 'node:util';
import { loadEnvLocal, readConfig } from '../../config';
import { createMailerFromConfig } from '../../lib/email';
import { captureError, flushSentry, initSentry } from '../../sentry';
import { createSystemActions } from '../../system-actions';
import { BootstrapRefusedError, bootstrapAdmin } from '../../system-actions/bootstrap-admin';

loadEnvLocal();
const { values } = parseArgs({
  options: { email: { type: 'string' }, name: { type: 'string' } },
  strict: true,
});
if (!values.email || !values.name) {
  console.error('Usage: bootstrap-admin --email <email> --name <name>');
  process.exit(2);
}

const config = readConfig();
initSentry(config.sentry);
const systemActions = createSystemActions(config.systemDatabaseUrl);
const route = { method: 'CLI', path: 'bootstrap-admin' };
try {
  const result = await bootstrapAdmin(
    { systemActions, mailer: createMailerFromConfig(config.email), appUrl: config.auth.baseUrl },
    { email: values.email, name: values.name },
  );
  const done = result.reissued
    ? 'A fresh invite link was issued; the old one no longer works.'
    : 'Admin invited.';
  if (result.emailSent) {
    console.log(`${done} The invite email has been sent.`);
  } else {
    // A failed send is reported like any failed invite email; one held back by staging's
    // allowlist is working as configured. The link goes only to this terminal: no Admin
    // can sign in to Resend yet.
    let cause = 'the address is not on EMAIL_ALLOWLIST';
    if (result.error !== undefined) {
      captureError(result.error, route);
      cause = result.error instanceof Error ? result.error.message : 'unknown error';
    }
    console.log(
      `${done} The email was not sent (${cause}). Open this link to set the password; it works once and lasts 7 days:\n${result.link}`,
    );
  }
} catch (error) {
  if (error instanceof BootstrapRefusedError) {
    console.error(error.message);
  } else {
    captureError(error, route);
    console.error(error);
  }
  process.exitCode = 1;
} finally {
  await Promise.allSettled([systemActions.close(), flushSentry()]);
}
