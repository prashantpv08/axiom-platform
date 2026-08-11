import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseHandle, type DatabaseHandle } from '../src/database/client';
import { migrateDatabase } from '../src/database/migrate';
import {
  auditEvents,
  experienceApplicabilityDecisions,
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
const VIEWER_TOKEN = 'v'.repeat(43);

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
    await database.db.insert(users).values([
      { id: 'USER-OWNER', email: 'owner@example.test', displayName: 'Owner' },
      { id: 'USER-VIEWER', email: 'viewer@example.test', displayName: 'Viewer' }
    ]);
    await database.db.insert(memberships).values([
      { organizationId: 'ORG-ALPHA', userId: 'USER-OWNER', role: 'OWNER' },
      { organizationId: 'ORG-ALPHA', userId: 'USER-VIEWER', role: 'VIEWER' }
    ]);
    await database.db.insert(sessions).values([
      { id: 'SESSION-OWNER', userId: 'USER-OWNER', tokenHash: hashSessionToken(OWNER_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' },
      { id: 'SESSION-VIEWER', userId: 'USER-VIEWER', tokenHash: hashSessionToken(VIEWER_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' }
    ]);
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

  it('creates one audited human-confirmed graph decision with retry-safe exact-preview semantics', async () => {
    await database.pool.query("update knowledge_entities set text = 'Finance reviewers shall approve invoices.' where project_id = 'PROJ-ALPHA' and id = 'REQ-REVIEW'");
    const previewResponse = await app!.inject({ method: 'GET', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/business-context/preview', headers: { authorization: `Bearer ${OWNER_TOKEN}` } });
    expect(previewResponse.statusCode, previewResponse.body).toBe(200);
    const preview = previewResponse.json() as { sourceGraphVersion: number; contentHash: string; applicability: { status: string } };
    expect(preview.applicability.status).toBe('NEEDS_DECISION');

    const request = {
      method: 'POST' as const,
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/business-context/applicability-decisions',
      headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'if-match': '"PROJ-ALPHA:1"', 'idempotency-key': 'experience-decision-0001' },
      payload: {
        sourceGraphVersion: preview.sourceGraphVersion,
        previewContentHash: preview.contentHash,
        decision: 'NOT_APPLICABLE',
        rationale: 'The approved delivery scope is an API integration with no operator-facing experience.'
      }
    };
    const resolved = await app!.inject(request);
    expect(resolved.statusCode, resolved.body).toBe(201);
    expect(resolved.headers.etag).toBe('"PROJ-ALPHA:2"');
    expect(resolved.headers['idempotency-replayed']).toBe('false');
    expect(resolved.json()).toMatchObject({
      project: { id: 'PROJ-ALPHA', graphVersion: 2, rowVersion: 2, status: 'NEEDS_CLARIFICATION' },
      decision: {
        previousGraphVersion: 1,
        graphVersion: 2,
        decision: 'NOT_APPLICABLE',
        rationale: 'The approved delivery scope is an API integration with no operator-facing experience.',
        sourcePreviewContentHash: preview.contentHash,
        truthStatus: 'HUMAN_CONFIRMED',
        decidedByUserId: 'USER-OWNER'
      },
      preview: { sourceGraphVersion: 2, applicability: { status: 'NOT_APPLICABLE', decisionRequired: false } },
      replayed: false
    });

    const replay = await app!.inject(request);
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.json()).toMatchObject({ replayed: true, decision: { graphVersion: 2 } });
    expect(await database.db.select().from(experienceApplicabilityDecisions)).toHaveLength(1);
    expect((await database.db.select().from(auditEvents)).filter((event) => event.action === 'EXPERIENCE_APPLICABILITY_DECIDED')).toHaveLength(1);
    expect((await database.db.select().from(knowledgeEntities)).filter((entity) => entity.graphVersion === 2 && entity.id === 'DECISION-EXPERIENCE-APPLICABILITY-PROJ-ALPHA')).toHaveLength(1);

    const stale = await app!.inject({ ...request, headers: { ...request.headers, 'idempotency-key': 'experience-decision-0002' } });
    expect(stale.statusCode, stale.body).toBe(412);
    const keyConflict = await app!.inject({ ...request, payload: { ...request.payload, decision: 'APPLICABLE' } });
    expect(keyConflict.statusCode, keyConflict.body).toBe(409);
  });

  it('refuses anonymous, cross-tenant, and already-explicit applicability mutations', async () => {
    const previewResponse = await app!.inject({ method: 'GET', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/business-context/preview', headers: { authorization: `Bearer ${OWNER_TOKEN}` } });
    const preview = previewResponse.json() as { sourceGraphVersion: number; contentHash: string };
    const payload = { sourceGraphVersion: preview.sourceGraphVersion, previewContentHash: preview.contentHash, decision: 'APPLICABLE', rationale: 'The approved scope includes a browser portal for finance reviewers.' };
    const anonymous = await app!.inject({ method: 'POST', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/business-context/applicability-decisions', headers: { 'if-match': '"PROJ-ALPHA:1"', 'idempotency-key': 'experience-denial-0001' }, payload });
    expect(anonymous.statusCode).toBe(401);
    const crossTenant = await app!.inject({ method: 'POST', url: '/api/v1/organizations/ORG-BETA/projects/PROJ-ALPHA/business-context/applicability-decisions', headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'if-match': '"PROJ-ALPHA:1"', 'idempotency-key': 'experience-denial-0002' }, payload });
    expect(crossTenant.statusCode).toBe(403);
    const viewer = await app!.inject({ method: 'POST', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/business-context/applicability-decisions', headers: { authorization: `Bearer ${VIEWER_TOKEN}`, 'if-match': '"PROJ-ALPHA:1"', 'idempotency-key': 'experience-denial-0003' }, payload });
    expect(viewer.statusCode).toBe(403);
    const explicit = await app!.inject({ method: 'POST', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/business-context/applicability-decisions', headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'if-match': '"PROJ-ALPHA:1"', 'idempotency-key': 'experience-denial-0004' }, payload });
    expect(explicit.statusCode).toBe(409);
  });
});
