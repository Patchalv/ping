// Playwright's database: recreates `ping_e2e` from nothing, migrates it and loads the
// seed Staff members, and makes sure the local MinIO has its Attachments bucket. Run by
// playwright.config.ts before it starts the built app.
import pg from 'pg';
import {
  LOCAL_ROLE_PASSWORDS,
  LOCAL_STORAGE,
  loadEnvLocal,
  migrationDatabaseUrl,
} from '../../config';
import { ensureLocalBucket } from '../../lib/storage/storage';
import { runMigrations } from '../migrate';
import { seed } from '../seed';

loadEnvLocal();
const name = 'ping_e2e';
const serverUrl = new URL(migrationDatabaseUrl());
serverUrl.pathname = '/postgres';

const client = new pg.Client({ connectionString: serverUrl.toString() });
await client.connect();
await client.query(`drop database if exists ${client.escapeIdentifier(name)} with (force)`);
await client.query(`create database ${client.escapeIdentifier(name)}`);
await client.end();

const ownerUrl = new URL(serverUrl);
ownerUrl.pathname = `/${name}`;
await runMigrations(ownerUrl.toString(), { rolePasswords: LOCAL_ROLE_PASSWORDS });
await seed(ownerUrl.toString());
await ensureLocalBucket(LOCAL_STORAGE);
console.log(`Prepared ${name}.`);
