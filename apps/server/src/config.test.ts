import { describe, expect, it } from 'vitest';
import { readConfig } from './config';

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://ping_app:x@db/ping',
  SYSTEM_DATABASE_URL: 'postgres://ping_system:x@db/ping',
  BETTER_AUTH_URL: 'https://ping.bypatrick.app',
  BETTER_AUTH_SECRET: 'a-long-random-secret',
  PING_ENVIRONMENT: 'production',
};

describe('readConfig › environment', () => {
  it('is local in development', () => {
    expect(readConfig({}).environment).toBe('local');
  });

  it('reads PING_ENVIRONMENT', () => {
    expect(readConfig({ ...production, PING_ENVIRONMENT: 'staging' }).environment).toBe('staging');
  });

  it('refuses an unknown PING_ENVIRONMENT', () => {
    expect(() => readConfig({ ...production, PING_ENVIRONMENT: 'stage' })).toThrow(
      'PING_ENVIRONMENT',
    );
  });
});

describe('readConfig › email', () => {
  it('needs PING_ENVIRONMENT in production', () => {
    expect(() => readConfig(production)).not.toThrow();
    const { PING_ENVIRONMENT: _, ...withoutEnvironment } = production;
    expect(() => readConfig(withoutEnvironment)).toThrow('PING_ENVIRONMENT');
  });

  it('is local, with no SMTP, in development', () => {
    expect(readConfig({}).email).toEqual({ environment: 'local', allowlist: [] });
  });

  it('starts without SMTP settings, so a deploy before the secrets are set still boots', () => {
    expect(readConfig(production).email.smtp).toBeUndefined();
  });

  it('reads the SMTP settings and the staging allowlist', () => {
    const config = readConfig({
      ...production,
      PING_ENVIRONMENT: 'staging',
      SMTP_HOST: 'smtp-relay.brevo.com',
      SMTP_USER: 'user@smtp-brevo.com',
      SMTP_PASSWORD: 'smtp-key',
      EMAIL_ALLOWLIST: 'a@example.com, B@example.com',
    });
    expect(config.email).toEqual({
      environment: 'staging',
      smtp: {
        host: 'smtp-relay.brevo.com',
        port: 587,
        user: 'user@smtp-brevo.com',
        password: 'smtp-key',
      },
      allowlist: ['a@example.com', 'b@example.com'],
    });
  });

  it('refuses an SMTP_PORT that is not a port number', () => {
    expect(() =>
      readConfig({
        ...production,
        SMTP_HOST: 'smtp-relay.brevo.com',
        SMTP_USER: 'user@smtp-brevo.com',
        SMTP_PASSWORD: 'smtp-key',
        SMTP_PORT: '58 7',
      }),
    ).toThrow('SMTP_PORT');
  });

  it('refuses half an SMTP setup', () => {
    expect(() => readConfig({ ...production, SMTP_HOST: 'smtp-relay.brevo.com' })).toThrow(
      'SMTP_HOST, SMTP_USER and SMTP_PASSWORD',
    );
  });

  it('refuses an unknown PING_ENVIRONMENT', () => {
    expect(() => readConfig({ ...production, PING_ENVIRONMENT: 'prod' })).toThrow(
      'PING_ENVIRONMENT',
    );
  });
});

describe('readConfig › Sentry', () => {
  it('is off without a DSN, even in production', () => {
    expect(readConfig(production).sentry).toBeUndefined();
  });

  it('reads the DSN and environment', () => {
    const config = readConfig({
      ...production,
      SENTRY_DSN: 'https://abc@o42.ingest.de.sentry.io/7',
      SENTRY_ENVIRONMENT: 'staging',
    });
    expect(config.sentry).toEqual({
      dsn: 'https://abc@o42.ingest.de.sentry.io/7',
      environment: 'staging',
    });
  });

  it('refuses a DSN without an environment, so staging never reports as prod', () => {
    expect(() =>
      readConfig({ ...production, SENTRY_DSN: 'https://abc@o42.ingest.de.sentry.io/7' }),
    ).toThrow('SENTRY_ENVIRONMENT');
  });

  it('refuses an environment other than production or staging', () => {
    expect(() =>
      readConfig({
        ...production,
        SENTRY_DSN: 'https://abc@o42.ingest.de.sentry.io/7',
        SENTRY_ENVIRONMENT: 'prod',
      }),
    ).toThrow('production or staging');
  });

  it('refuses a DSN outside Sentry’s EU region', () => {
    expect(() =>
      readConfig({
        ...production,
        SENTRY_DSN: 'https://abc@o42.ingest.us.sentry.io/7',
        SENTRY_ENVIRONMENT: 'production',
      }),
    ).toThrow('EU');
  });
});

describe('readConfig › storage', () => {
  const r2 = {
    STORAGE_ENDPOINT: 'https://account.eu.r2.cloudflarestorage.com',
    STORAGE_BUCKET: 'ping-prod',
    STORAGE_ACCESS_KEY_ID: 'key',
    STORAGE_SECRET_ACCESS_KEY: 'secret',
  };

  it('uses the local MinIO in development', () => {
    expect(readConfig({}).storage).toEqual({
      endpoint: 'http://localhost:9000',
      region: 'auto',
      bucket: 'ping-attachments',
      accessKeyId: 'ping',
      secretAccessKey: 'ping-minio-local',
    });
  });

  it('starts without storage in production, so a deploy before the secrets are set still boots', () => {
    expect(readConfig(production).storage).toBeUndefined();
  });

  it('reads R2’s settings, with region auto', () => {
    expect(readConfig({ ...production, ...r2 }).storage).toEqual({
      endpoint: r2.STORAGE_ENDPOINT,
      region: 'auto',
      bucket: 'ping-prod',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    });
  });

  it('refuses half a storage setup', () => {
    expect(() => readConfig({ ...production, STORAGE_BUCKET: 'ping-prod' })).toThrow(
      'STORAGE_ENDPOINT',
    );
  });

  it('refuses a plain-http endpoint in production, except on this machine', () => {
    expect(() =>
      readConfig({ ...production, ...r2, STORAGE_ENDPOINT: 'http://minio.internal:9000' }),
    ).toThrow('https');
    expect(
      readConfig({ ...production, ...r2, STORAGE_ENDPOINT: 'http://localhost:9000' }).storage
        ?.endpoint,
    ).toBe('http://localhost:9000');
  });
});
