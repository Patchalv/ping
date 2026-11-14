# Deploy runbook

How staging and prod are set up and deployed. The decisions behind it are in [platform.md](spec/platform.md). Every account is Patrick's during the proof of concept.

| | Prod | Staging |
| --- | --- | --- |
| URL | https://ping.bypatrick.app | https://staging.ping.bypatrick.app |
| Fly app | `bypatrick-ping` (`fly.prod.toml`) | `bypatrick-ping-staging` (`fly.staging.toml`) |
| Neon | the project's main branch | the `staging` branch |
| GitHub environment | `production` | `staging` |
| Deployed by | `promote.yml`, run by hand | `deploy.yml`, on every merge to `master` |

If a Fly app name is taken, pick another and change `app` in the toml file and the `*.fly.dev` URLs in both workflows.

## How a deploy works

1. A merge to `master` starts **Deploy staging** (`.github/workflows/deploy.yml`). It runs CI, migrates the staging database as `neondb_owner`, deploys staging, then runs the pooler smoke test inside the staging Machine. Any failure fails the run.
2. **Promote to prod** (`.github/workflows/promote.yml`) is run by hand from the Actions tab or with `gh workflow run promote.yml`. It takes a commit on `master`, or the newest one if you leave it empty. It refuses unless Deploy staging succeeded on that exact commit. Then it migrates the prod database and deploys prod.

There's no Fly `release_command`. Migrations must work with the previous release, because the old code runs against the new schema until the deploy finishes.

The pooler smoke test (`apps/server/src/db/cli/pooler-smoke.ts`) connects as `ping_app` through Neon's pooler, using the Machine's own `DATABASE_URL`. It runs 160 short transactions on 4 connections, each setting its own `app.staff_id`, and fails if any of them sees another's, or sees one outside its own transaction. It also fails if no database backend ever served two of the connections, because then a leak had no chance to show. It writes nothing.

## Secrets: where each one lives

| Secret | Where | Used by |
| --- | --- | --- |
| `FLY_API_TOKEN` | GitHub environments `staging` and `production`, a deploy token for that app | the deploy and smoke-test steps |
| `MIGRATION_DATABASE_URL` | GitHub environments `staging` and `production`, `neondb_owner` on that branch's **direct** host | the migration step |
| `DATABASE_URL` | `fly secrets`, both apps: `ping_app` on the **pooled** host | the app |
| `SYSTEM_DATABASE_URL` | `fly secrets`, both apps: `ping_system` on the **pooled** host | the app |
| `BETTER_AUTH_SECRET` | `fly secrets`, both apps, a different random value each | the app |
| `SENTRY_DSN` | `fly secrets`, both apps, the same DSN | the app and the SPA |

`NODE_ENV`, `PORT`, `BETTER_AUTH_URL` and `SENTRY_ENVIRONMENT` aren't secret and are in the toml files. Brevo and R2 credentials arrive with their own slices ([#32](https://github.com/Patchalv/ping/issues/32), [#50](https://github.com/Patchalv/ping/issues/50)).

The running app never holds the `neondb_owner` credential, and GitHub never holds the app's.

## First-time setup (before the first deploy)

Do these in order. Steps marked **DPA** include accepting that vendor's data processing agreement.

### 1. Neon

1. Create a project in **AWS Europe Central 1 (Frankfurt)**, `aws-eu-central-1`, on Postgres 18. **DPA.**
2. Create a branch named `staging` from the main branch **now, while main is still empty**. Staging must never hold a copy of prod's data.
3. For each branch, copy two connection strings for `neondb_owner` from the Connect dialog: the **direct** one (host without `-pooler`) and the **pooled** one (host with `-pooler`). Keep `?sslmode=require` on both.
4. Run the first migration on each branch from your laptop. It creates the `ping_app` and `ping_system` roles, which have no password yet:

   ```bash
   NODE_ENV=production MIGRATION_DATABASE_URL='<owner direct URL for this branch>' pnpm db:migrate
   ```

5. Give both roles a password on each branch, a different one per role and branch. Generate each with `openssl rand -hex 32` and save it in your password manager (hex needs no escaping in a URL), then:

   ```bash
   psql '<owner direct URL for this branch>' -c "alter role ping_app password '<ping_app password>'" -c "alter role ping_system password '<ping_system password>'"
   ```
6. Build the app's two URLs for each branch from the **pooled** owner URL, swapping in the role and its password: `postgres://ping_app:<password>@<pooled host>/neondb?sslmode=require`, and the same for `ping_system`.

### 2. Sentry

1. Create an organisation in the **EU (Frankfurt) region**, so its DSN host ends in `.ingest.de.sentry.io`. The server refuses any other DSN. **DPA.**
2. Create one project, platform Node.js, called `ping`. Staging and prod share its DSN and report as the environments `staging` and `production`.
3. In the project's security and privacy settings, keep **Data Scrubber** and **Use Default Scrubbers** on, and turn on **Prevent Storing of IP Addresses**.

The app also scrubs before sending: no request bodies, cookies, headers, query strings or email addresses, and failed queries lose their parameters.

### 3. Fly

1. Accept Fly's DPA. **DPA.**
2. Create both apps in your personal organisation:

   ```bash
   fly apps create bypatrick-ping
   ```

   ```bash
   fly apps create bypatrick-ping-staging
   ```

3. Give each app a shared IPv4 and an IPv6. Never a dedicated IPv4, which costs money:

   ```bash
   fly ips allocate-v4 --shared --app bypatrick-ping
   ```

   ```bash
   fly ips allocate-v6 --app bypatrick-ping
   ```

   Then the same two for `bypatrick-ping-staging`. `fly ips list --app <app>` must show `shared` for v4.
4. Set the runtime secrets on each app with its own branch's URLs. `--stage` stores them without starting a Machine:

   ```bash
   fly secrets set --stage --app bypatrick-ping-staging DATABASE_URL='<staging ping_app pooled URL>' SYSTEM_DATABASE_URL='<staging ping_system pooled URL>' BETTER_AUTH_SECRET="$(openssl rand -base64 48)" SENTRY_DSN='<Sentry DSN>'
   ```

   Then the same for `bypatrick-ping` with the main branch's URLs and a new secret.
5. Create a deploy token for each app. Each token works for its own app only. The smoke test also uses it for `fly ssh console`, which nobody has checked yet: see [If the smoke step can't reach the Machine](#if-the-smoke-step-cant-reach-the-machine).

   ```bash
   fly tokens create deploy --app bypatrick-ping-staging --expiry 8760h
   ```

   ```bash
   fly tokens create deploy --app bypatrick-ping --expiry 8760h
   ```

   They expire in a year. Put a reminder in your calendar.

### 4. Domains (Fly and Cloudflare)

1. Ask Fly for a certificate for each hostname:

   ```bash
   fly certs add ping.bypatrick.app --app bypatrick-ping
   ```

   ```bash
   fly certs add staging.ping.bypatrick.app --app bypatrick-ping-staging
   ```

2. In Cloudflare DNS for `bypatrick.app`, add an `A` record to the app's shared IPv4 and an `AAAA` record to its IPv6, for each hostname, with the proxy status **DNS only** (grey cloud). A proxied record would buffer the live-update stream and break Fly's certificate.
3. `fly certs show <hostname> --app <app>` should report the certificate as issued within a few minutes.

### 5. GitHub

1. Create two environments in the repo settings: `staging` and `production`. In each, set **Deployment branches and tags** to **Selected branches** with only `master`. Without that, a copy of `promote.yml` edited on another branch could skip the staging check and still reach the prod secrets.
2. Add each environment's two secrets:

   ```bash
   gh secret set FLY_API_TOKEN --env staging
   ```

   ```bash
   gh secret set MIGRATION_DATABASE_URL --env staging
   ```

   ```bash
   gh secret set FLY_API_TOKEN --env production
   ```

   ```bash
   gh secret set MIGRATION_DATABASE_URL --env production
   ```

   Each one prompts for the value. `MIGRATION_DATABASE_URL` is the `neondb_owner` **direct** URL for that environment's branch.

## After the first merge

1. Watch **Deploy staging** in the Actions tab. All of CI, the migration, the deploy and the pooler smoke test must pass. The smoke step prints `POOLER SMOKE PASSED`.

   If it prints `Pooler smoke: inconclusive`, nothing leaked, but Neon's pooler gave each connection its own backend, so the test proved nothing. Re-run the job. If it stays inconclusive, raise the rounds (`checkPoolerIsolation(url, { rounds })` in `src/db/cli/pooler-smoke.ts`) rather than accept it. `failed` with `leak:` lines means `app.staff_id` crossed between requests: don't promote, and treat it as a security incident.
2. Open https://staging.ping.bypatrick.app/healthz.
3. Run promote:

   ```bash
   gh workflow run promote.yml
   ```

4. Open https://ping.bypatrick.app/healthz.
5. Check that prod has exactly one Machine, and staging at most one:

   ```bash
   fly scale show --app bypatrick-ping
   ```

## First Admin (`bootstrap-admin`)

After the first prod deploy that includes [Invites, bootstrap-admin and email](https://github.com/Patchalv/ping/issues/32), Patrick creates the first Admin from inside the prod Machine, so the command uses the Machine's own credentials:

```bash
fly ssh console --app bypatrick-ping
```

The exact command is added here by that slice.

## Memory

Prod runs in 256 MB to stay under Fly's $5 waiver ([platform.md › Cost](spec/platform.md#cost)). Moving it to 512 MB is a cost Spark has to agree to first.

| Date | Where | Load | Peak |
| --- | --- | --- | --- |
| 2026-11-14 | Local Docker, `--memory=256m`, Sentry on (proxy, not staging) | idle | 86 MiB |
| 2026-11-14 | Local Docker, `--memory=256m`, Sentry on (proxy, not staging) | 20 signed-in sessions for 35 s, about 12,000 requests a second | 135 MiB |
| _to do_ | Staging | several signed-in sessions with open live-update streams | _to do_ |

There are no live-update streams yet, and staging has no Staff member to sign in until `bootstrap-admin` exists. Measure staging once both arrive, and again whenever something large lands:

```bash
SESSIONS=12 SECONDS=120 node scripts/memory-load.ts https://staging.ping.bypatrick.app '<password>' '<email>' ['<email>' ...]
```

Read the peak from the Memory graph on the app's Fly dashboard (Metrics) while it runs, and add a row above.

## If the smoke step can't reach the Machine

Two things the smoke step depends on can only be checked on the first staging run, because no Machine exists before it:

- that an app-scoped deploy token may open `fly ssh console`;
- that a `fly ssh console --command` session sees the Machine's secrets and `[env]`. Without them `readConfig` stops with "DATABASE_URL must be set".

If either fails, run the check from Actions instead, which platform.md allows because it uses an owner URL:

1. Add a third secret to the `staging` environment, `SMOKE_DATABASE_URL`: `neondb_owner` on the staging branch's **pooled** host. `set_config(..., true)` staying inside a transaction is a pooler property, not a role property, and the check writes nothing.
2. In `deploy.yml`, replace the `flyctl ssh console` line with `DATABASE_URL="$SMOKE_DATABASE_URL" pnpm --filter @ping/server exec tsx src/db/cli/pooler-smoke.ts | tee smoke.log`, with `SMOKE_DATABASE_URL: ${{ secrets.SMOKE_DATABASE_URL }}` and `NODE_ENV: production` plus placeholder `SYSTEM_DATABASE_URL`, `BETTER_AUTH_URL` and `BETTER_AUTH_SECRET` values in the step's `env`.

## Never run `pnpm db:seed` against Neon

`db:seed` loads fake Staff members and resets the `ping_app` and `ping_system` passwords to the local ones in `.env.example`, which are public. Run it only against the local Docker stack.

## Monthly

On the first of each month, look at Fly usage. If the month's projection reaches $4.50, turn staging off first ([platform.md › Cost](spec/platform.md#cost)).
