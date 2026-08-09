import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseHandle, type DatabaseHandle } from '../src/database/client';
import { migrateDatabase } from '../src/database/migrate';
import { analysisRuns, auditEvents, knowledgeEntities, memberships, organizations, projectGaps, projectGraphs, projects, sessions, users, workspaces } from '../src/database/schema';
import { hashSessionToken } from '../src/identity/authentication/session-token';
import { createApplication } from '../src/platform/create-application';
import { AnalysisWorker } from '../src/sources/analysis-worker';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl === undefined ? describe.skip : describe;
const OWNER_TOKEN = 's'.repeat(43);
const VIEWER_TOKEN = 't'.repeat(43);

describePostgres('PostgreSQL source ingestion and durable analysis', () => {
  let database: DatabaseHandle;
  let app: NestFastifyApplication | undefined;
  let storageRoot: string;

  async function resetDatabase() {
    await database.pool.query('drop schema if exists public cascade');
    await database.pool.query('drop schema if exists axiom_internal cascade');
    await database.pool.query('create schema public');
    await migrateDatabase(database.db);
  }

  async function seed() {
    await database.db.insert(organizations).values([{ id: 'ORG-ALPHA', slug: 'alpha-source', name: 'Alpha' }, { id: 'ORG-BETA', slug: 'beta-source', name: 'Beta' }]);
    await database.db.insert(users).values([{ id: 'USER-OWNER', email: 'source-owner@example.test', displayName: 'Owner' }, { id: 'USER-VIEWER', email: 'source-viewer@example.test', displayName: 'Viewer' }]);
    await database.db.insert(memberships).values([{ organizationId: 'ORG-ALPHA', userId: 'USER-OWNER', role: 'OWNER' }, { organizationId: 'ORG-ALPHA', userId: 'USER-VIEWER', role: 'VIEWER' }]);
    await database.db.insert(sessions).values([{ id: 'SESSION-SOURCE-OWNER', userId: 'USER-OWNER', tokenHash: hashSessionToken(OWNER_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' }, { id: 'SESSION-SOURCE-VIEWER', userId: 'USER-VIEWER', tokenHash: hashSessionToken(VIEWER_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' }]);
    await database.db.insert(workspaces).values({ id: 'WS-ALPHA', organizationId: 'ORG-ALPHA', name: 'Alpha Workspace' });
    await database.db.insert(projects).values({ id: 'PROJ-ALPHA', organizationId: 'ORG-ALPHA', workspaceId: 'WS-ALPHA', name: 'Alpha Product', status: 'DRAFT', graphVersion: 0 });
  }

  function upload(key: string, text: string, token = OWNER_TOKEN) {
    return app!.inject({
      method: 'POST', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/sources',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
      payload: { name: 'brief.md', kind: 'FILE', mimeType: 'text/markdown', contentBase64: Buffer.from(text, 'utf8').toString('base64') }
    });
  }

  beforeAll(async () => {
    const parsed = new URL(testDatabaseUrl!);
    if (!parsed.pathname.startsWith('/axiom_test')) throw new Error('Source analysis tests require axiom_test');
    database = createDatabaseHandle(testDatabaseUrl);
  });
  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), 'axiom-source-test-'));
    process.env.AXIOM_LOCAL_SOURCE_ROOT = storageRoot;
    await resetDatabase();
    await seed();
    app = await createApplication({ databaseUrl: testDatabaseUrl! });
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
    delete process.env.AXIOM_LOCAL_SOURCE_ROOT;
    await rm(storageRoot, { recursive: true, force: true });
  });
  afterAll(async () => database.pool.end());

  it('versions grounded sources, queues outside the request, and commits one canonical graph in the worker', async () => {
    const text = 'Administrators shall invite members. P95 latency must remain below 500 ms.';
    const uploaded = await upload('source-upload-001', text);
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json()).toMatchObject({ version: 1, status: 'EXTRACTED', validationStatus: 'VALIDATED' });
    expect(uploaded.headers['idempotency-replayed']).toBe('false');
    const replay = await upload('source-upload-001', text);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect((await database.db.select().from(projects))[0]).toMatchObject({ status: 'SOURCES_READY', graphVersion: 0 });

    const queued = await app!.inject({
      method: 'POST', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/analysis-runs',
      headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'idempotency-key': 'analysis-queue-001' }, payload: {}
    });
    expect(queued.statusCode).toBe(202);
    const run = queued.json<{ id: string; status: string }>();
    expect(run.status).toBe('QUEUED');
    const latestQueued = await app!.inject({ method: 'GET', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/analysis-runs', headers: { authorization: `Bearer ${OWNER_TOKEN}` } });
    expect(latestQueued.statusCode).toBe(200);
    expect(latestQueued.json()).toMatchObject({ run: { id: run.id, status: 'QUEUED' } });
    expect(await new AnalysisWorker(database.db, 'integration-worker').processNext()).toBe(true);

    const completed = await app!.inject({ method: 'GET', url: `/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/analysis-runs/${run.id}`, headers: { authorization: `Bearer ${OWNER_TOKEN}` } });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ status: 'SUCCEEDED', graphVersion: 1, attempts: 1, errorCode: null });
    expect((await database.db.select().from(projects))[0]).toMatchObject({ status: 'NEEDS_CLARIFICATION', graphVersion: 1 });
    expect(await database.db.select().from(projectGraphs)).toHaveLength(1);
    const entities = await database.db.select().from(knowledgeEntities);
    expect(entities).toEqual(expect.arrayContaining([expect.objectContaining({ truthStatus: 'SOURCE_GROUNDED', quote: 'Administrators shall invite members.', startOffset: 0, endOffset: 36 })]));
    expect((await database.db.select().from(projectGaps)).length).toBeGreaterThan(0);
    expect((await database.db.select().from(auditEvents)).map((event) => event.action)).toEqual(expect.arrayContaining(['PROJECT_SOURCE_UPLOADED', 'PROJECT_ANALYSIS_QUEUED', 'PROJECT_ANALYSIS_SUCCEEDED']));

    const nextVersion = await upload('source-upload-002', `${text} Retry failures must be visible.`);
    expect(nextVersion.json()).toMatchObject({ version: 2, status: 'EXTRACTED' });
    expect((await database.db.select().from(projects))[0]).toMatchObject({ status: 'SOURCES_READY', graphVersion: 1 });
  });

  it('enforces permissions, tenant scope, one active run, and cancellation', async () => {
    expect((await upload('viewer-source-001', 'Users shall authenticate.', VIEWER_TOKEN)).statusCode).toBe(403);
    await upload('owner-source-001', 'Users shall authenticate.');
    const first = await app!.inject({ method: 'POST', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/analysis-runs', headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'idempotency-key': 'analysis-active-001' }, payload: {} });
    expect(first.statusCode).toBe(202);
    const second = await app!.inject({ method: 'POST', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/analysis-runs', headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'idempotency-key': 'analysis-active-002' }, payload: {} });
    expect(second.statusCode).toBe(409);
    const runId = first.json<{ id: string }>().id;
    const cancelled = await app!.inject({ method: 'POST', url: `/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/analysis-runs/${runId}/cancel`, headers: { authorization: `Bearer ${OWNER_TOKEN}` } });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ status: 'CANCELLED' });
    expect(await new AnalysisWorker(database.db, 'idle-worker').processNext()).toBe(false);
    expect((await database.db.select().from(analysisRuns))[0]).toMatchObject({ status: 'CANCELLED', attempts: 0 });
    const crossTenant = await app!.inject({ method: 'GET', url: '/api/v1/organizations/ORG-BETA/projects/PROJ-ALPHA/sources', headers: { authorization: `Bearer ${OWNER_TOKEN}` } });
    expect(crossTenant.statusCode).toBe(403);
  });
});
