// Every environment variable the server reads. Each has a working local default for the
// Docker stack; production (NODE_ENV=production) must set the ones marked required.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RolePasswords } from './db/migrate';
import type { SmtpSettings } from './lib/email';
import type { StorageSettings } from './lib/storage/storage';

const envLocal = fileURLToPath(new URL('../../../.env.local', import.meta.url));

/** Loads the repo's gitignored .env.local, if there is one. Shell variables win. */
export function loadEnvLocal(): void {
  if (existsSync(envLocal)) {
    process.loadEnvFile(envLocal);
  }
}

export type ServerConfig = {
  /** ping_app, through the pooler. */
  databaseUrl: string;
  /** ping_system, through the pooler. */
  systemDatabaseUrl: string;
  auth: {
    secret: string;
    baseUrl: string;
    trustedOrigins: string[];
  };
  /** Which deployment this is (PING_ENVIRONMENT). Staging marks its email and its UI. */
  environment: PingEnvironment;
  /** Error reporting for the server and the SPA. Off when SENTRY_DSN is unset. */
  sentry?: SentrySettings;
  email: EmailSettings;
  /**
   * Object storage for Attachments. Undefined in a deployment whose storage settings
   * aren't set yet: it still boots, and adding an Attachment fails.
   */
  storage?: StorageSettings;
};

/**
 * How email goes out (platform.md › Email). With no SMTP settings, local development
 * prints each email, and production or staging fail every send into "Email not sent,
 * Resend", so a deploy before the secrets are set still boots.
 */
export type EmailSettings = {
  environment: PingEnvironment;
  smtp?: SmtpSettings;
  /** Staging only sends to these addresses, lowercased. */
  allowlist: string[];
};

const PING_ENVIRONMENTS = ['production', 'staging', 'local'] as const;

export type PingEnvironment = (typeof PING_ENVIRONMENTS)[number];

function readEnvironment(env: NodeJS.ProcessEnv, isProduction: boolean): PingEnvironment {
  const name = env.PING_ENVIRONMENT;
  const environment = name ? PING_ENVIRONMENTS.find((known) => known === name) : undefined;
  if (name && !environment) {
    throw new Error('PING_ENVIRONMENT must be production, staging or local');
  }
  if (!environment && isProduction) {
    throw new Error('PING_ENVIRONMENT must be set when NODE_ENV=production');
  }
  return environment ?? 'local';
}

function readEmail(env: NodeJS.ProcessEnv, environment: PingEnvironment): EmailSettings {
  const { SMTP_HOST: host, SMTP_USER: user, SMTP_PASSWORD: password } = env;
  const given = [host, user, password].filter(Boolean).length;
  if (given > 0 && given < 3) {
    throw new Error('Set all of SMTP_HOST, SMTP_USER and SMTP_PASSWORD, or none of them');
  }
  const port = Number(env.SMTP_PORT ?? '587');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be a port number, such as 587');
  }
  const allowlist = (env.EMAIL_ALLOWLIST ?? '')
    .split(',')
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean);

  return {
    environment,
    ...(host && user && password ? { smtp: { host, port, user, password } } : {}),
    allowlist,
  };
}

/** The local MinIO in compose.yaml, and the bucket tests and `pnpm dev` create in it. */
export const LOCAL_STORAGE: StorageSettings = {
  endpoint: 'http://localhost:9000',
  region: 'auto',
  bucket: 'ping-attachments',
  accessKeyId: 'ping',
  secretAccessKey: 'ping-minio-local',
};

/**
 * Object storage (platform.md › Object storage). Set the endpoint, bucket and both keys,
 * or none: production and staging then boot without storage, and local development uses
 * MinIO.
 */
function readStorage(env: NodeJS.ProcessEnv, isProduction: boolean): StorageSettings | undefined {
  const {
    STORAGE_ENDPOINT: endpoint,
    STORAGE_BUCKET: bucket,
    STORAGE_ACCESS_KEY_ID: accessKeyId,
    STORAGE_SECRET_ACCESS_KEY: secretAccessKey,
  } = env;
  const given = [endpoint, bucket, accessKeyId, secretAccessKey].filter(Boolean).length;
  if (given > 0 && given < 4) {
    throw new Error(
      'Set all of STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY, or none of them',
    );
  }
  if (endpoint && bucket && accessKeyId && secretAccessKey) {
    const { protocol } = new URL(endpoint);
    if (isProduction && protocol !== 'https:') {
      throw new Error('STORAGE_ENDPOINT must use https when NODE_ENV=production');
    }
    return { endpoint, bucket, accessKeyId, secretAccessKey, region: env.STORAGE_REGION || 'auto' };
  }
  return isProduction ? undefined : LOCAL_STORAGE;
}

const SENTRY_ENVIRONMENTS = ['production', 'staging'] as const;

/** Where Sentry reports, for the server and the SPA. */
export type SentrySettings = { dsn: string; environment: (typeof SENTRY_ENVIRONMENTS)[number] };

/** Sentry's EU region (platform.md › Monitoring). A DSN anywhere else is refused. */
const SENTRY_EU_INGEST = '.ingest.de.sentry.io';

function readSentry(env: NodeJS.ProcessEnv): SentrySettings | undefined {
  const dsn = env.SENTRY_DSN;
  if (!dsn) return undefined;
  if (!new URL(dsn).hostname.endsWith(SENTRY_EU_INGEST)) {
    throw new Error(`SENTRY_DSN must point at Sentry's EU region (*${SENTRY_EU_INGEST})`);
  }
  const environment = SENTRY_ENVIRONMENTS.find((name) => name === env.SENTRY_ENVIRONMENT);
  if (!environment) {
    throw new Error('SENTRY_ENVIRONMENT must be production or staging when SENTRY_DSN is set');
  }
  return { dsn, environment };
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const isProduction = env.NODE_ENV === 'production';
  const required = (name: string, localDefault: string): string => {
    const value = env[name];
    if (value) return value;
    if (isProduction) throw new Error(`${name} must be set when NODE_ENV=production`);
    return localDefault;
  };

  // Locally people open Vite on 5173, even though the server itself runs on SERVER_PORT.
  const baseUrl = required('BETTER_AUTH_URL', 'http://localhost:5173');
  const trustedOrigins = env.BETTER_AUTH_TRUSTED_ORIGINS
    ? env.BETTER_AUTH_TRUSTED_ORIGINS.split(',').map((origin) => origin.trim())
    : isProduction
      ? [baseUrl]
      : [baseUrl, 'http://localhost:5173', 'http://localhost:3000'];

  const environment = readEnvironment(env, isProduction);

  return {
    databaseUrl: required('DATABASE_URL', 'postgres://ping_app:ping_app@localhost:6432/ping'),
    systemDatabaseUrl: required(
      'SYSTEM_DATABASE_URL',
      'postgres://ping_system:ping_system@localhost:6432/ping',
    ),
    auth: {
      secret: required('BETTER_AUTH_SECRET', 'ping-local-dev-secret-not-for-production-use'),
      baseUrl,
      trustedOrigins,
    },
    environment,
    sentry: readSentry(env),
    email: readEmail(env, environment),
    storage: readStorage(env, isProduction),
  };
}

/** The owner role, for migrations and the dev seed only. The running app never uses it. */
export function migrationDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.MIGRATION_DATABASE_URL ?? 'postgres://ping:ping@localhost:5432/ping';
}

/** The local role passwords `pnpm db:migrate` sets. Hosted environments set their own. */
export const LOCAL_ROLE_PASSWORDS: RolePasswords = {
  pingApp: 'ping_app',
  pingSystem: 'ping_system',
};
