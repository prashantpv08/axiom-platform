import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { createDatabaseHandle } from '../src/database/client';
import { migrateDatabase } from '../src/database/migrate';

const DISPOSABLE_DATABASE = 'axiom_migration_rollback_verification';
const DEFAULT_ADMIN_URL = 'postgresql://axiom:axiom-local-only@localhost:54329/postgres';
const FORWARD_MIGRATION = /^\d{4}_[a-z0-9_]+\.sql$/u;

function targetUrl(adminUrl: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${DISPOSABLE_DATABASE}`;
  return url.toString();
}

async function rollbackFiles(): Promise<string[]> {
  const files = await readdir(resolve('drizzle'));
  const forward = files.filter((file) => FORWARD_MIGRATION.test(file)).sort();
  const missing = forward.filter((file) => !files.includes(file.replace(/\.sql$/u, '.down.sql')));
  if (missing.length > 0) throw new Error(`Missing rollback migrations: ${missing.join(', ')}`);
  return forward.map((file) => file.replace(/\.sql$/u, '.down.sql')).reverse();
}

async function main(): Promise<void> {
  const adminUrl = process.env.MIGRATION_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_URL;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  let created = false;

  try {
    const existing = await admin.query<{ exists: boolean }>(
      'select exists(select 1 from pg_database where datname = $1) as exists',
      [DISPOSABLE_DATABASE],
    );
    if (existing.rows[0]?.exists === true) {
      throw new Error(`Refusing to replace pre-existing database ${DISPOSABLE_DATABASE}`);
    }

    await admin.query(`create database "${DISPOSABLE_DATABASE}" template template0`);
    created = true;

    const target = createDatabaseHandle(targetUrl(adminUrl));
    try {
      await migrateDatabase(target.db);
      for (const file of await rollbackFiles()) {
        const sql = await readFile(resolve('drizzle', file), 'utf8');
        await target.pool.query(sql.replaceAll('--> statement-breakpoint', ''));
      }

      const remaining = await target.pool.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
      );
      if (remaining.rows.length > 0) {
        throw new Error(`Rollback left public tables: ${remaining.rows.map((row) => row.table_name).join(', ')}`);
      }
    } finally {
      await target.pool.end();
    }

    console.log('Forward migrations and complete reverse-order rollback passed in a disposable database.');
  } finally {
    if (created) await admin.query(`drop database "${DISPOSABLE_DATABASE}" with (force)`);
    await admin.end();
  }
}

void main();
