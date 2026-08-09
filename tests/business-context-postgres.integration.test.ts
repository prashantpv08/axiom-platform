import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseHandle, type DatabaseHandle } from '../src/database/client';
import { migrateDatabase } from '../src/database/migrate';
import {
  auditEvents,
  knowledgeEntities,
  memberships,
  organizations,
  projectGaps,
  projectGraphs,
  projectSources,
  projects,
  sessions,
  users,
  workspaces
} from '../src/database/schema';
import { hashSessionToken } from '../src/identity/authentication/session-token';
import { createApplication } from '../src/platform/create-application';
import { BusinessContextService } from '../src/experience/business-context.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl === undefined ? describe.skip : describe;
const OWNER_TOKEN = 'b'.repeat(43);

describePostgres('PostgreSQL Business Context preview boundary', () => {
  let database: DatabaseHandle;
  let app: NestFastifyApplication | undefined;

  async function resetDatabase() {
    await database.pool.query('drop schema if exists public cascade');
    await database.pool.query('drop schema if exists axiom_internal cascade');
    await database.pool.query('create schema public');
    await migrateDatabase(database.db);
  }

  async function seed() {
    await database.db.insert(organizations).values([
      { id: 'ORG-ALPHA', slug: 'alpha', name: 'Alpha' },
      { id: 'ORG-BETA', slug: 'beta', name: 'Beta' }
    ]);
    await database.db.insert(users).values({ id: 'USER-OWNER', email: 'owner@example.test', displayName: 'Owner' });
    await database.db.insert(memberships).values({ organizationId: 'ORG-ALPHA', userId: 'USER-OWNER', role: 'OWNER' });
    await database.db.insert(sessions).values({ id: 'SESSION-OWNER', userId: 'USER-OWNER', tokenHash: hashSessionToken(OWNER_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' });
    await database.db.insert(workspaces).values({ id: 'WS-ALPHA', organizationId: 'ORG-ALPHA', name: 'Alpha Workspace' });
    await database.db.insert(projects).values([
      { id: 'PROJ-ALPHA', organizationId: 'ORG-ALPHA', workspaceId: 'WS-ALPHA', name: 'Invoice Review', status: 'ANALYZED', graphVersion: 1 },
      { id: 'PROJ-DRAFT', organizationId: 'ORG-ALPHA', workspaceId: 'WS-ALPHA', name: 'Draft Product', status: 'DRAFT', graphVersion: 0 }
    ]);
    await database.db.insert(projectGraphs).values({ organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, summary: 'Invoice review business context.', analyzer: 'fixture', analyzedAt: '2026-08-03T00:00:00.000Z' });
    await database.db.insert(projectSources).values({ id: 'SRC-BRIEF', organizationId: 'ORG-ALPHA', workspaceId: 'WS-ALPHA', projectId: 'PROJ-ALPHA', name: 'brief.md', kind: 'FILE', mimeType: 'text/markdown', size: 120, sha256: 'a'.repeat(64), extractedText: 'Finance reviewers approve invoices in a browser portal.', rawPath: '/local/brief.md', status: 'EXTRACTED', createdAt: '2026-08-03T00:00:00.000Z' });
    await database.db.insert(knowledgeEntities).values([
      { id: 'DEC-OUTCOME', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, category: 'DECISION', text: 'The product goal is to reduce invoice review time by 30%.', truthStatus: 'SOURCE_GROUNDED', sourceId: 'SRC-BRIEF', quote: 'The product goal is to reduce invoice review time by 30%.', startOffset: 0, endOffset: 57, position: 0 },
      { id: 'REQ-REVIEW', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, category: 'REQUIREMENT', text: 'Finance reviewers shall approve invoices in the browser portal.', truthStatus: 'SOURCE_GROUNDED', sourceId: 'SRC-BRIEF', quote: 'Finance reviewers shall approve invoices in the browser portal.', startOffset: 58, endOffset: 119, position: 1 },
      { id: 'NFR-LATENCY', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, category: 'NFR', text: 'P95 review latency shall remain below 500 ms.', truthStatus: 'HUMAN_CONFIRMED', sourceId: null, position: 2 }
    ]);
    await database.db.insert(projectGaps).values({ id: 'GAP-RECOVERY', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, position: 0, type: 'UNTESTABLE', category: 'FAILURE_HANDLING', title: 'Recovery outcome is unknown', description: 'The source does not define recovery.', severity: 'HIGH', impactAreas: ['failure_handling'], affectedEntityIds: ['REQ-REVIEW'], affectedArtifacts: ['SRS'], rationale: 'Recovery must be explicit.', status: 'OPEN', truthStatus: 'UNKNOWN' });
  }

  beforeAll(() => {
    const parsed = new URL(testDatabaseUrl!);
    if (!parsed.pathname.startsWith('/axiom_test')) throw new Error('Business Context tests require axiom_test');
    database = createDatabaseHandle(testDatabaseUrl);
  });
  beforeEach(async () => { await resetDatabase(); await seed(); app = await createApplication({ databaseUrl: testDatabaseUrl! }); });
  afterEach(async () => { await app?.close(); app = undefined; });
  afterAll(async () => database.pool.end());

  it('returns the current grounded preview without creating audit or provider evidence', async () => {
    const directPreview = await app!.get(BusinessContextService).preview({ organizationId: 'ORG-ALPHA', userId: 'USER-OWNER', sessionId: 'SESSION-OWNER', role: 'OWNER' }, 'PROJ-ALPHA');
    expect(directPreview.applicability.status).toBe('APPLICABLE');
    const response = await app!.inject({ method: 'GET', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/business-context/preview', headers: { authorization: `Bearer ${OWNER_TOKEN}` } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      projectId: 'PROJ-ALPHA', sourceGraphVersion: 1,
      applicability: { status: 'APPLICABLE', decisionRequired: false },
      coverage: { eligibleEntityCount: 3, classifiedEntityCount: 3 },
      blockingGapIds: ['GAP-RECOVERY']
    });
    expect(await database.db.select().from(auditEvents)).toHaveLength(0);
  });

  it('fails closed for anonymous, cross-tenant, and unanalyzed access', async () => {
    const anonymous = await app!.inject({ method: 'GET', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/business-context/preview' });
    expect(anonymous.statusCode).toBe(401);
    const crossTenant = await app!.inject({ method: 'GET', url: '/api/v1/organizations/ORG-BETA/projects/PROJ-ALPHA/business-context/preview', headers: { authorization: `Bearer ${OWNER_TOKEN}` } });
    expect(crossTenant.statusCode).toBe(403);
    const notReady = await app!.inject({ method: 'GET', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-DRAFT/business-context/preview', headers: { authorization: `Bearer ${OWNER_TOKEN}` } });
    expect(notReady.statusCode).toBe(409);
  });
});
