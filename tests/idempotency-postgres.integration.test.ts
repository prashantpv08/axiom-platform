import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseHandle, type DatabaseHandle } from '../src/database/client';
import {
  claimPostgresIdempotency,
  completePostgresIdempotency,
  lockActivePostgresIdempotency,
  releasePostgresIdempotency
} from '../src/database/idempotency/postgres-idempotency';
import { migrateDatabase } from '../src/database/migrate';
import { organizations } from '../src/database/schema';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl === undefined ? describe.skip : describe;
const requestHash = 'a'.repeat(64);

describePostgres('PostgreSQL idempotency coordinator', () => {
  let database: DatabaseHandle;

  async function resetDatabase() {
    await database.pool.query('drop schema if exists public cascade');
    await database.pool.query('drop schema if exists axiom_internal cascade');
    await database.pool.query('create schema public');
    await migrateDatabase(database.db);
    await database.db.insert(organizations).values([
      { id: 'ORG-ALPHA', slug: 'alpha', name: 'Alpha' },
      { id: 'ORG-BETA', slug: 'beta', name: 'Beta' }
    ]);
  }

  beforeAll(() => {
    const parsed = new URL(testDatabaseUrl!);
    if (!parsed.pathname.startsWith('/axiom_test')) throw new Error('Idempotency tests require axiom_test');
    database = createDatabaseHandle(testDatabaseUrl);
  });
  beforeEach(resetDatabase);
  afterAll(async () => database.pool.end());

  it('claims, isolates, conflicts, completes, and replays by organization', async () => {
    const alpha = await claimPostgresIdempotency(database.db, {
      organizationId: 'ORG-ALPHA',
      scope: 'TEST_OPERATION',
      key: 'same-key',
      requestHash
    });
    expect(alpha).toMatchObject({ kind: 'ACQUIRED' });

    await expect(claimPostgresIdempotency(database.db, {
      organizationId: 'ORG-BETA',
      scope: 'TEST_OPERATION',
      key: 'same-key',
      requestHash
    })).resolves.toMatchObject({ kind: 'ACQUIRED' });
    await expect(claimPostgresIdempotency(database.db, {
      organizationId: 'ORG-ALPHA',
      scope: 'TEST_OPERATION',
      key: 'same-key',
      requestHash
    })).resolves.toEqual({ kind: 'IN_PROGRESS' });
    await expect(claimPostgresIdempotency(database.db, {
      organizationId: 'ORG-ALPHA',
      scope: 'TEST_OPERATION',
      key: 'same-key',
      requestHash: 'b'.repeat(64)
    })).resolves.toEqual({ kind: 'HASH_CONFLICT' });

    if (alpha.kind !== 'ACQUIRED') throw new Error('Expected Alpha claim to be acquired');
    await completePostgresIdempotency(database.db, {
      recordId: alpha.recordId,
      responseStatus: 201,
      responsePayload: { id: 'RESULT-1' },
      completedAt: '2026-08-11T00:00:00.000Z'
    });
    await expect(claimPostgresIdempotency(database.db, {
      organizationId: 'ORG-ALPHA',
      scope: 'TEST_OPERATION',
      key: 'same-key',
      requestHash
    })).resolves.toEqual({ kind: 'REPLAY', responsePayload: { id: 'RESULT-1' } });
  });

  it('locks and releases only an active reservation with the exact identity and hash', async () => {
    const acquired = await claimPostgresIdempotency(database.db, {
      organizationId: 'ORG-ALPHA',
      scope: 'LONG_OPERATION',
      key: 'long-key',
      requestHash
    });
    expect(acquired).toMatchObject({ kind: 'ACQUIRED' });

    await expect(database.db.transaction((transaction) => lockActivePostgresIdempotency(transaction, {
      organizationId: 'ORG-ALPHA',
      scope: 'LONG_OPERATION',
      key: 'long-key',
      requestHash
    }))).resolves.toBe(acquired.kind === 'ACQUIRED' ? acquired.recordId : null);
    await expect(database.db.transaction((transaction) => lockActivePostgresIdempotency(transaction, {
      organizationId: 'ORG-ALPHA',
      scope: 'LONG_OPERATION',
      key: 'long-key',
      requestHash: 'b'.repeat(64)
    }))).resolves.toBeNull();

    await releasePostgresIdempotency(database.db, {
      organizationId: 'ORG-ALPHA',
      scope: 'LONG_OPERATION',
      key: 'long-key',
      requestHash: 'b'.repeat(64)
    });
    await expect(claimPostgresIdempotency(database.db, {
      organizationId: 'ORG-ALPHA',
      scope: 'LONG_OPERATION',
      key: 'long-key',
      requestHash
    })).resolves.toEqual({ kind: 'IN_PROGRESS' });

    await releasePostgresIdempotency(database.db, {
      organizationId: 'ORG-ALPHA',
      scope: 'LONG_OPERATION',
      key: 'long-key',
      requestHash
    });
    await expect(claimPostgresIdempotency(database.db, {
      organizationId: 'ORG-ALPHA',
      scope: 'LONG_OPERATION',
      key: 'long-key',
      requestHash
    })).resolves.toMatchObject({ kind: 'ACQUIRED' });
  });
});
