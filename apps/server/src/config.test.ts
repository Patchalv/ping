import { describe, expect, it } from 'vitest';
import { readConfig } from './config';

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://ping_app:x@db/ping',
  SYSTEM_DATABASE_URL: 'postgres://ping_system:x@db/ping',
  BETTER_AUTH_URL: 'https://ping.bypatrick.app',
  BETTER_AUTH_SECRET: 'a-long-random-secret',
};

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
