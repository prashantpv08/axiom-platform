import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseHandle, type DatabaseHandle } from '../src/database/client';
import { migrateDatabase } from '../src/database/migrate';
import { auditEvents, idempotencyRecords, memberships, organizations, projects, sessions, users, workspaces } from '../src/database/schema';
import { hashSessionToken } from '../src/identity/authentication/session-token';
import { PostgresProjectRepository } from '../src/projects/postgres-project.repository';
import { createApplication } from '../src/platform/create-application';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl === undefined ? describe.skip : describe;
const USER_A_TOKEN = 'a'.repeat(43);
const USER_B_TOKEN = 'b'.repeat(43);

describePostgres('PostgreSQL project tenant boundary', () => {
  let database: DatabaseHandle;
  let app: NestFastifyApplication | undefined;

  async function resetDatabase(): Promise<void> {
    await database.pool.query('drop schema if exists public cascade');
    await database.pool.query('drop schema if exists axiom_internal cascade');
    await database.pool.query('create schema public');
    await migrateDatabase(database.db);
  }

  async function seedProjects(): Promise<void> {
    await database.db.insert(organizations).values([
      { id: 'ORG-ALPHA', slug: 'alpha', name: 'Alpha' },
      { id: 'ORG-BETA', slug: 'beta', name: 'Beta' }
    ]);
    await database.db.insert(users).values([
      { id: 'USER-ALPHA', email: 'alpha@example.test', displayName: 'Alpha User' },
      { id: 'USER-BETA', email: 'beta@example.test', displayName: 'Beta User' }
    ]);
    await database.db.insert(memberships).values([
      { organizationId: 'ORG-ALPHA', userId: 'USER-ALPHA', role: 'OWNER' },
      { organizationId: 'ORG-BETA', userId: 'USER-BETA', role: 'VIEWER' }
    ]);
    await database.db.insert(sessions).values([
      {
        id: 'SESSION-ALPHA',
        userId: 'USER-ALPHA',
        tokenHash: hashSessionToken(USER_A_TOKEN),
        expiresAt: '2099-01-01T00:00:00.000Z'
      },
      {
        id: 'SESSION-BETA',
        userId: 'USER-BETA',
        tokenHash: hashSessionToken(USER_B_TOKEN),
        expiresAt: '2099-01-01T00:00:00.000Z'
      }
    ]);
    await database.db.insert(workspaces).values([
      { id: 'WS-ALPHA', organizationId: 'ORG-ALPHA', name: 'Alpha Workspace' },
      { id: 'WS-BETA', organizationId: 'ORG-BETA', name: 'Beta Workspace' }
    ]);
    await database.db.insert(projects).values([
      {
        id: 'PROJ-ALPHA-NEW',
        organizationId: 'ORG-ALPHA',
        workspaceId: 'WS-ALPHA',
        name: 'Alpha New',
        status: 'ANALYZED',
        graphVersion: 3,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z'
      },
      {
        id: 'PROJ-ALPHA-OLD',
        organizationId: 'ORG-ALPHA',
        workspaceId: 'WS-ALPHA',
        name: 'Alpha Old',
        status: 'DRAFT',
        graphVersion: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z'
      },
      {
        id: 'PROJ-BETA-PRIVATE',
        organizationId: 'ORG-BETA',
        workspaceId: 'WS-BETA',
        name: 'Beta Private',
        status: 'BACKLOG_READY',
        graphVersion: 7,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-04T00:00:00.000Z'
      }
    ]);
  }

  beforeAll(() => {
    const parsed = new URL(testDatabaseUrl!);
    if (!parsed.pathname.startsWith('/axiom_test')) {
      throw new Error('Project integration tests require a dedicated axiom_test database');
    }
    database = createDatabaseHandle(testDatabaseUrl);
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedProjects();
    app = await createApplication({ databaseUrl: testDatabaseUrl! });
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  afterAll(async () => {
    await database.pool.end();
  });

  it('requires organization scope at the repository boundary', async () => {
    const repository = new PostgresProjectRepository(database.db);
    const alpha = await repository.listProjects({ organizationId: 'ORG-ALPHA' }, { limit: 100 });

    expect(alpha.projects.map((project) => project.id)).toEqual(['PROJ-ALPHA-NEW', 'PROJ-ALPHA-OLD']);
    expect(alpha.projects).not.toContainEqual(expect.objectContaining({ name: 'Beta Private' }));
    await expect(
      repository.findProject({ organizationId: 'ORG-ALPHA' }, 'PROJ-BETA-PRIVATE')
    ).resolves.toBeNull();
  });

  it('lists only workspaces inside the authorized organization', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-ALPHA/workspaces',
      headers: { authorization: `Bearer ${USER_A_TOKEN}`, 'x-request-id': 'workspaces-list-001' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      workspaces: [{ id: 'WS-ALPHA', name: 'Alpha Workspace', rowVersion: 1 }],
      nextCursor: null
    });
    expect(response.body).not.toContain('Beta Workspace');
  });

  it('paginates only projects inside the authorized organization', async () => {
    const first = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-ALPHA/projects?limit=1',
      headers: { authorization: `Bearer ${USER_A_TOKEN}`, 'x-request-id': 'projects-page-001' }
    });

    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    const firstPage = first.json<{ projects: Array<{ id: string; name: string }>; nextCursor: string | null }>();
    expect(firstPage.projects).toEqual([expect.objectContaining({ id: 'PROJ-ALPHA-NEW', name: 'Alpha New' })]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(first.body).not.toContain('Beta');

    const second = await app!.inject({
      method: 'GET',
      url: `/api/v1/organizations/ORG-ALPHA/projects?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
      headers: { authorization: `Bearer ${USER_A_TOKEN}`, 'x-request-id': 'projects-page-002' }
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      projects: [expect.objectContaining({ id: 'PROJ-ALPHA-OLD', name: 'Alpha Old' })],
      nextCursor: null
    });
  });

  it('returns scoped detail and a no-leak not-found response for another tenant project', async () => {
    const allowed = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA-NEW',
      headers: { authorization: `Bearer ${USER_A_TOKEN}`, 'x-request-id': 'project-detail-001' }
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({ id: 'PROJ-ALPHA-NEW', name: 'Alpha New', graphVersion: 3 });

    const hidden = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-BETA-PRIVATE',
      headers: { authorization: `Bearer ${USER_A_TOKEN}`, 'x-request-id': 'project-hidden-001' }
    });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Project was not found',
        requestId: 'project-hidden-001',
        retryable: false
      }
    });
    expect(hidden.body).not.toContain('Beta');
  });

  it('denies another organization path while permitting a viewer in their own organization', async () => {
    const denied = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-BETA/projects',
      headers: { authorization: `Bearer ${USER_A_TOKEN}`, 'x-request-id': 'projects-cross-tenant-001' }
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.body).not.toContain('Beta Private');

    const viewer = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-BETA/projects',
      headers: { authorization: `Bearer ${USER_B_TOKEN}`, 'x-request-id': 'projects-viewer-001' }
    });
    expect(viewer.statusCode).toBe(200);
    expect(viewer.json()).toMatchObject({
      projects: [expect.objectContaining({ id: 'PROJ-BETA-PRIVATE', name: 'Beta Private' })]
    });
  });

  it('rejects anonymous access and invalid pagination without querying unscoped data', async () => {
    const anonymous = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-ALPHA/projects',
      headers: { 'x-request-id': 'projects-anonymous-001' }
    });
    expect(anonymous.statusCode).toBe(401);

    const invalid = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-ALPHA/projects?cursor=not-a-cursor',
      headers: { authorization: `Bearer ${USER_A_TOKEN}`, 'x-request-id': 'projects-cursor-001' }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      error: { code: 'INVALID_REQUEST', message: 'Project cursor is invalid', retryable: false }
    });
  });

  it('creates a row-versioned project and immutable audit event in the scoped workspace', async () => {
    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/projects',
      headers: {
        authorization: `Bearer ${USER_A_TOKEN}`,
        'idempotency-key': 'project-create-001',
        'x-request-id': 'project-create-request-001'
      },
      payload: { workspaceId: 'WS-ALPHA', name: 'Created Project' }
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.etag).toMatch(/^"PROJ-.+:1"$/u);
    expect(response.headers['idempotency-replayed']).toBe('false');
    const created = response.json<{ id: string; rowVersion: number }>();
    expect(created).toMatchObject({ workspaceId: 'WS-ALPHA', name: 'Created Project', status: 'DRAFT', graphVersion: 0, rowVersion: 1 });

    const [stored] = await database.db
      .select()
      .from(projects)
      .where(and(eq(projects.organizationId, 'ORG-ALPHA'), eq(projects.id, created.id)))
      .limit(1);
    expect(stored).toMatchObject({ organizationId: 'ORG-ALPHA', workspaceId: 'WS-ALPHA', rowVersion: 1 });

    const [event] = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, 'project-create-request-001'))
      .limit(1);
    expect(event).toMatchObject({
      organizationId: 'ORG-ALPHA',
      actorUserId: 'USER-ALPHA',
      action: 'PROJECT_CREATED',
      targetType: 'Project',
      targetId: created.id,
      metadata: { workspaceId: 'WS-ALPHA', rowVersion: 1, sessionId: 'SESSION-ALPHA' }
    });
    await expect(
      database.pool.query("update audit_events set action = 'ALTERED' where request_id = 'project-create-request-001'")
    ).rejects.toThrow(/audit events are immutable/u);
  });

  it('replays the stored creation response and rejects reuse for different input', async () => {
    const request = {
      method: 'POST' as const,
      url: '/api/v1/organizations/ORG-ALPHA/projects',
      headers: {
        authorization: `Bearer ${USER_A_TOKEN}`,
        'idempotency-key': 'project-replay-001',
        'x-request-id': 'project-replay-request-001'
      },
      payload: { workspaceId: 'WS-ALPHA', name: 'Retry Safe Project' }
    };
    const first = await app!.inject(request);
    const replay = await app!.inject({ ...request, headers: { ...request.headers, 'x-request-id': 'project-replay-request-002' } });

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.json()).toEqual(first.json());

    const conflict = await app!.inject({
      ...request,
      headers: { ...request.headers, 'x-request-id': 'project-replay-request-003' },
      payload: { workspaceId: 'WS-ALPHA', name: 'Different Project' }
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: { code: 'CONFLICT', message: 'Idempotency key was already used for a different request' }
    });

    const createdRows = await database.db.select().from(projects).where(eq(projects.name, 'Retry Safe Project'));
    const events = await database.db.select().from(auditEvents).where(eq(auditEvents.targetId, first.json<{ id: string }>().id));
    expect(createdRows).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it('rolls back idempotency and audit state when scoped workspace validation fails', async () => {
    for (const workspaceId of ['WS-MISSING', 'WS-BETA']) {
      const response = await app!.inject({
        method: 'POST',
        url: '/api/v1/organizations/ORG-ALPHA/projects',
        headers: {
          authorization: `Bearer ${USER_A_TOKEN}`,
          'idempotency-key': `invalid-${workspaceId.toLowerCase()}`,
          'x-request-id': `invalid-${workspaceId.toLowerCase()}`
        },
        payload: { workspaceId, name: 'Must Not Exist' }
      });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain('Beta Workspace');
    }

    expect(await database.db.select().from(projects).where(eq(projects.name, 'Must Not Exist'))).toHaveLength(0);
    expect(await database.db.select().from(auditEvents).where(eq(auditEvents.action, 'PROJECT_CREATED'))).toHaveLength(0);
    expect(await database.db.select().from(idempotencyRecords).where(eq(idempotencyRecords.scope, 'PROJECT_CREATE'))).toHaveLength(0);
  });

  it('denies project creation to a viewer', async () => {
    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-BETA/projects',
      headers: {
        authorization: `Bearer ${USER_B_TOKEN}`,
        'idempotency-key': 'viewer-create-001',
        'x-request-id': 'viewer-create-001'
      },
      payload: { workspaceId: 'WS-BETA', name: 'Viewer Project' }
    });
    expect(response.statusCode).toBe(403);
    expect(await database.db.select().from(projects).where(eq(projects.name, 'Viewer Project'))).toHaveLength(0);
  });

  it('archives and restores the exact prior status with versioned immutable audit evidence', async () => {
    const archived = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA-NEW/archive',
      headers: {
        authorization: `Bearer ${USER_A_TOKEN}`,
        'if-match': '"PROJ-ALPHA-NEW:1"',
        'x-request-id': 'project-archive-001'
      }
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.headers.etag).toBe('"PROJ-ALPHA-NEW:2"');
    expect(archived.json()).toMatchObject({
      id: 'PROJ-ALPHA-NEW',
      status: 'ARCHIVED',
      rowVersion: 2,
      archivedAt: expect.any(String)
    });

    const restored = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA-NEW/restore',
      headers: {
        authorization: `Bearer ${USER_A_TOKEN}`,
        'if-match': '"PROJ-ALPHA-NEW:2"',
        'x-request-id': 'project-restore-001'
      }
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.headers.etag).toBe('"PROJ-ALPHA-NEW:3"');
    expect(restored.json()).toMatchObject({ status: 'ANALYZED', rowVersion: 3, archivedAt: null });

    const [stored] = await database.db.select().from(projects).where(eq(projects.id, 'PROJ-ALPHA-NEW')).limit(1);
    expect(stored).toMatchObject({
      status: 'ANALYZED',
      rowVersion: 3,
      archivedFromStatus: null,
      archivedAt: null
    });
    const events = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, 'PROJ-ALPHA-NEW'));
    expect(events).toEqual([
      expect.objectContaining({
        action: 'PROJECT_ARCHIVED',
        metadata: {
          previousStatus: 'ANALYZED',
          status: 'ARCHIVED',
          previousRowVersion: 1,
          rowVersion: 2,
          sessionId: 'SESSION-ALPHA'
        }
      }),
      expect.objectContaining({
        action: 'PROJECT_RESTORED',
        metadata: {
          previousStatus: 'ARCHIVED',
          status: 'ANALYZED',
          previousRowVersion: 2,
          rowVersion: 3,
          sessionId: 'SESSION-ALPHA'
        }
      })
    ]);
  });

  it('requires a matching current ETag and leaves state untouched after precondition failures', async () => {
    const missing = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA-NEW/archive',
      headers: { authorization: `Bearer ${USER_A_TOKEN}`, 'x-request-id': 'project-precondition-missing' }
    });
    expect(missing.statusCode).toBe(428);
    expect(missing.json()).toMatchObject({ error: { code: 'PRECONDITION_REQUIRED' } });

    const stale = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA-NEW/archive',
      headers: {
        authorization: `Bearer ${USER_A_TOKEN}`,
        'if-match': '"PROJ-ALPHA-NEW:99"',
        'x-request-id': 'project-precondition-stale'
      }
    });
    expect(stale.statusCode).toBe(412);
    expect(stale.json()).toMatchObject({
      error: { code: 'PRECONDITION_FAILED', message: 'Project has changed since it was loaded' }
    });

    const wrongProject = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA-NEW/archive',
      headers: {
        authorization: `Bearer ${USER_A_TOKEN}`,
        'if-match': '"PROJ-ALPHA-OLD:1"',
        'x-request-id': 'project-precondition-wrong-project'
      }
    });
    expect(wrongProject.statusCode).toBe(400);
    const [stored] = await database.db.select().from(projects).where(eq(projects.id, 'PROJ-ALPHA-NEW')).limit(1);
    expect(stored).toMatchObject({ status: 'ANALYZED', rowVersion: 1, archivedAt: null });
    expect(await database.db.select().from(auditEvents).where(eq(auditEvents.targetId, 'PROJ-ALPHA-NEW'))).toHaveLength(0);
  });

  it('serializes competing archive commands and records only one winning transition', async () => {
    const request = {
      method: 'POST' as const,
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA-NEW/archive',
      headers: {
        authorization: `Bearer ${USER_A_TOKEN}`,
        'if-match': '"PROJ-ALPHA-NEW:1"'
      }
    };
    const responses = await Promise.all([
      app!.inject({ ...request, headers: { ...request.headers, 'x-request-id': 'project-race-001' } }),
      app!.inject({ ...request, headers: { ...request.headers, 'x-request-id': 'project-race-002' } })
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 412]);
    expect(await database.db.select().from(auditEvents).where(eq(auditEvents.targetId, 'PROJ-ALPHA-NEW'))).toHaveLength(1);
  });

  it('rejects invalid state, cross-tenant lifecycle access, and viewer mutation', async () => {
    const restoreActive = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA-NEW/restore',
      headers: {
        authorization: `Bearer ${USER_A_TOKEN}`,
        'if-match': '"PROJ-ALPHA-NEW:1"',
        'x-request-id': 'project-restore-active'
      }
    });
    expect(restoreActive.statusCode).toBe(409);

    const hidden = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-BETA-PRIVATE/archive',
      headers: {
        authorization: `Bearer ${USER_A_TOKEN}`,
        'if-match': '"PROJ-BETA-PRIVATE:1"',
        'x-request-id': 'project-archive-hidden'
      }
    });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).not.toContain('Beta Private');

    const viewer = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-BETA/projects/PROJ-BETA-PRIVATE/archive',
      headers: {
        authorization: `Bearer ${USER_B_TOKEN}`,
        'if-match': '"PROJ-BETA-PRIVATE:1"',
        'x-request-id': 'project-archive-viewer'
      }
    });
    expect(viewer.statusCode).toBe(403);
    const [beta] = await database.db.select().from(projects).where(eq(projects.id, 'PROJ-BETA-PRIVATE')).limit(1);
    expect(beta).toMatchObject({ status: 'BACKLOG_READY', rowVersion: 1 });
  });

  it('provides a guarded executable rollback for the archive lifecycle migration', async () => {
    const archived = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA-NEW/archive',
      headers: {
        authorization: `Bearer ${USER_A_TOKEN}`,
        'if-match': '"PROJ-ALPHA-NEW:1"',
        'x-request-id': 'project-rollback-archive'
      }
    });
    expect(archived.statusCode).toBe(200);

    const downSql = await readFile(resolve('drizzle/0004_project_archive_lifecycle.down.sql'), 'utf8');
    await expect(database.pool.query(downSql)).rejects.toThrow(/restore archived projects/u);

    const restored = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA-NEW/restore',
      headers: {
        authorization: `Bearer ${USER_A_TOKEN}`,
        'if-match': '"PROJ-ALPHA-NEW:2"',
        'x-request-id': 'project-rollback-restore'
      }
    });
    expect(restored.statusCode).toBe(200);
    await app!.close();
    app = undefined;
    await database.pool.query(downSql);

    const columns = await database.pool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name in ('archived_at', 'archived_from_status')"
    );
    expect(columns.rows).toHaveLength(0);
  });
});
