// The staging pooler smoke test. The deploy workflow runs it inside the staging Machine
// (`fly ssh console`), so it connects exactly as the app does: as ping_app, through Neon's
// pooler, with the Machine's own DATABASE_URL. GitHub never holds that credential.
//
// Exits 1 unless the check passed, including when it was inconclusive.
import { loadEnvLocal, readConfig } from '../../config';
import { checkPoolerIsolation } from '../pooler-smoke';

loadEnvLocal();
const result = await checkPoolerIsolation(readConfig().databaseUrl);

console.log(
  `Pooler smoke: ${result.outcome}, ${result.transactions} transactions, ` +
    `shared backend: ${result.sharedBackend ? 'yes' : 'no'}`,
);
for (const leak of result.leaks) console.log(`  leak: ${leak}`);

if (result.outcome === 'passed') {
  // The workflow looks for this line, in case `fly ssh console` drops the exit code.
  console.log('POOLER SMOKE PASSED');
} else {
  process.exitCode = 1;
}
