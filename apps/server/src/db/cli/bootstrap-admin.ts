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
const systemActions = createSystemActions(config.systemDatabaseUrl);
try {
  const result = await bootstrapAdmin(
    { systemActions, mailer: createMailerFromConfig(config.email), appUrl: config.auth.baseUrl },
    { email: values.email, name: values.name },
  );
  // The link goes only to this terminal: no Admin can sign in to Resend yet.
  console.log(
    result.emailSent
      ? 'Admin invited. The invite email has been sent.'
      : `Admin invited, but the email was not sent (check the SMTP settings). Open this link to set the password; it works once and lasts 7 days:\n${result.link}`,
  );
} catch (error) {
  console.error(error instanceof BootstrapRefusedError ? error.message : error);
  process.exitCode = 1;
} finally {
  await systemActions.close();
}
