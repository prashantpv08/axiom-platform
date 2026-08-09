import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseHandle, type DatabaseHandle } from '../src/database/client';
import { migrateDatabase } from '../src/database/migrate';
import {
  auditEvents,
  businessContextReviews,
  businessContextVersions,
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

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl === undefined ? describe.skip : describe;
const OWNER_TOKEN = 'k'.repeat(43);
const REVIEWER_TOKEN = 'l'.repeat(43);
const VIEWER_TOKEN = 'm'.repeat(43);

describePostgres('PostgreSQL Business Context versions and exact review', () => {
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
      { id: 'USER-REVIEWER', email: 'reviewer@example.test', displayName: 'Reviewer' },
      { id: 'USER-VIEWER', email: 'viewer@example.test', displayName: 'Viewer' }
    ]);
    await database.db.insert(memberships).values([
      { organizationId: 'ORG-ALPHA', userId: 'USER-OWNER', role: 'OWNER' },
      { organizationId: 'ORG-ALPHA', userId: 'USER-REVIEWER', role: 'REVIEWER' },
      { organizationId: 'ORG-ALPHA', userId: 'USER-VIEWER', role: 'VIEWER' }
    ]);
    await database.db.insert(sessions).values([
      { id: 'SESSION-OWNER', userId: 'USER-OWNER', tokenHash: hashSessionToken(OWNER_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' },
      { id: 'SESSION-REVIEWER', userId: 'USER-REVIEWER', tokenHash: hashSessionToken(REVIEWER_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' },
      { id: 'SESSION-VIEWER', userId: 'USER-VIEWER', tokenHash: hashSessionToken(VIEWER_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' }
    ]);
    await database.db.insert(workspaces).values({ id: 'WS-ALPHA', organizationId: 'ORG-ALPHA', name: 'Alpha Workspace' });
    await database.db.insert(projects).values({
      id: 'PROJ-ALPHA',
      organizationId: 'ORG-ALPHA',
      workspaceId: 'WS-ALPHA',
      name: 'Invoice Review',
      status: 'ANALYZED',
      graphVersion: 1
    });
    await database.db.insert(projectGraphs).values({
      organizationId: 'ORG-ALPHA',
      projectId: 'PROJ-ALPHA',
      graphVersion: 1,
      summary: 'Grounded invoice-review context.',
      analyzer: 'fixture',
      analyzedAt: '2026-08-04T00:00:00.000Z'
    });
    await database.db.insert(projectSources).values({
      id: 'SRC-BRIEF',
      organizationId: 'ORG-ALPHA',
      workspaceId: 'WS-ALPHA',
      projectId: 'PROJ-ALPHA',
      name: 'brief.md',
      kind: 'FILE',
      mimeType: 'text/markdown',
      size: 180,
      sha256: 'a'.repeat(64),
      extractedText: 'Grounded invoice review brief.',
      rawPath: '/local/brief.md',
      status: 'EXTRACTED',
      createdAt: '2026-08-04T00:00:00.000Z'
    });
    await database.db.insert(knowledgeEntities).values([
      {
        id: 'DEC-OUTCOME',
        organizationId: 'ORG-ALPHA',
        projectId: 'PROJ-ALPHA',
        graphVersion: 1,
        category: 'DECISION',
        text: 'The product goal is to reduce invoice review time by 30%.',
        truthStatus: 'SOURCE_GROUNDED',
        sourceId: 'SRC-BRIEF',
        position: 0
      },
      {
        id: 'REQ-REVIEW',
        organizationId: 'ORG-ALPHA',
        projectId: 'PROJ-ALPHA',
        graphVersion: 1,
        category: 'REQUIREMENT',
        text: 'Finance reviewers shall approve invoices in the browser portal.',
        truthStatus: 'SOURCE_GROUNDED',
        sourceId: 'SRC-BRIEF',
        position: 1
      },
      {
        id: 'NFR-LATENCY',
        organizationId: 'ORG-ALPHA',
        projectId: 'PROJ-ALPHA',
        graphVersion: 1,
        category: 'NFR',
        text: 'P95 review latency shall remain below 500 ms.',
        truthStatus: 'HUMAN_CONFIRMED',
        sourceId: null,
        position: 2
      }
    ]);
  }

  async function preview() {
    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/business-context/preview',
      headers: { authorization: `Bearer ${OWNER_TOKEN}` }
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ contentHash: string; workflows: Array<{ id: string }> }>();
  }

  function generate(contentHash: string, ifMatch: string, key: string, token = OWNER_TOKEN) {
    return app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/business-context/generations',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key, 'if-match': ifMatch },
      payload: { sourceGraphVersion: 1, previewContentHash: contentHash }
    });
  }

  beforeAll(() => {
    const parsed = new URL(testDatabaseUrl!);
    if (!parsed.pathname.startsWith('/axiom_test')) throw new Error('Business Context versioning tests require axiom_test');
    database = createDatabaseHandle(testDatabaseUrl);
  });
  beforeEach(async () => {
    await resetDatabase();
    await seed();
    app = await createApplication({ databaseUrl: testDatabaseUrl! });
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });
  afterAll(async () => database.pool.end());

  it('persists, exactly approves, replays safely, and invalidates the current approval on regeneration', async () => {
    const exactPreview = await preview();
    const generatedResponse = await generate(exactPreview.contentHash, '"PROJ-ALPHA:1"', 'business-context-generate-001');
    expect(generatedResponse.statusCode, generatedResponse.body).toBe(201);
    const generated = generatedResponse.json<{
      project: { rowVersion: number };
      baseline: { version: { id: string; version: number; contentHash: string }; review: null };
      replayed: boolean;
    }>();
    expect(generated).toMatchObject({
      project: { rowVersion: 2 },
      baseline: { version: { version: 1, contentHash: exactPreview.contentHash }, review: null },
      replayed: false
    });
    const replay = await generate(exactPreview.contentHash, '"PROJ-ALPHA:1"', 'business-context-generate-001');
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toMatchObject({ replayed: true, baseline: { version: { id: generated.baseline.version.id } } });
    expect(await database.db.select().from(businessContextVersions)).toHaveLength(1);

    const approvedResponse = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/business-context/reviews',
      headers: { authorization: `Bearer ${REVIEWER_TOKEN}`, 'idempotency-key': 'business-context-review-001', 'if-match': '"PROJ-ALPHA:2"' },
      payload: {
        sourceGraphVersion: 1,
        contextVersionId: generated.baseline.version.id,
        contextContentHash: generated.baseline.version.contentHash,
        decision: 'ACCEPT',
        feedbackCategory: 'APPROVAL',
        comment: 'The exact grounded business context is complete and approved for experience planning.',
        proposedGraphChanges: []
      }
    });
    expect(approvedResponse.statusCode, approvedResponse.body).toBe(201);
    expect(approvedResponse.json()).toMatchObject({
      project: { rowVersion: 3 },
      baseline: { review: { decision: 'ACCEPT', truthStatus: 'HUMAN_APPROVED', reviewedByUserId: 'USER-REVIEWER' } }
    });
    const viewerRead = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/business-context/current',
      headers: { authorization: `Bearer ${VIEWER_TOKEN}` }
    });
    expect(viewerRead.statusCode).toBe(200);
    expect(viewerRead.json()).toMatchObject({ version: { id: generated.baseline.version.id }, review: { decision: 'ACCEPT' } });

    const regenerated = await generate(exactPreview.contentHash, '"PROJ-ALPHA:3"', 'business-context-generate-002');
    expect(regenerated.statusCode, regenerated.body).toBe(201);
    expect(regenerated.json()).toMatchObject({ project: { rowVersion: 4 }, baseline: { version: { version: 2 }, review: null } });
    expect(await database.db.select().from(businessContextVersions)).toHaveLength(2);
    expect(await database.db.select().from(businessContextReviews)).toHaveLength(1);
    expect((await database.db.select().from(auditEvents)).map((event) => event.action)).toEqual(
      expect.arrayContaining(['BUSINESS_CONTEXT_GENERATED', 'BUSINESS_CONTEXT_APPROVED'])
    );
    await database.db.insert(projectGraphs).values({
      organizationId: 'ORG-ALPHA',
      projectId: 'PROJ-ALPHA',
      graphVersion: 2,
      summary: 'New canonical graph after a material source or clarification change.',
      analyzer: 'fixture',
      analyzedAt: '2026-08-04T03:00:00.000Z'
    });
    await database.db.update(projects).set({ graphVersion: 2, rowVersion: 5 }).where(eq(projects.id, 'PROJ-ALPHA'));
    const staleRead = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/business-context/current',
      headers: { authorization: `Bearer ${VIEWER_TOKEN}` }
    });
    expect(staleRead.statusCode).toBe(200);
    expect(staleRead.json()).toEqual({ projectId: 'PROJ-ALPHA', graphVersion: 2, version: null, review: null });
    expect(await database.db.select().from(businessContextVersions)).toHaveLength(2);
    expect(await database.db.select().from(businessContextReviews)).toHaveLength(1);
  });

  it('fails closed for stale previews and roles, blocks unsafe approval, and preserves proposed edits as non-canonical review', async () => {
    const exactPreview = await preview();
    expect((await generate(exactPreview.contentHash, '"PROJ-ALPHA:1"', 'business-context-viewer-001', VIEWER_TOKEN)).statusCode).toBe(403);
    expect((await generate('f'.repeat(64), '"PROJ-ALPHA:1"', 'business-context-stale-001')).statusCode).toBe(412);
    expect(await database.db.select().from(businessContextVersions)).toHaveLength(0);

    await database.db.insert(projectGaps).values({
      id: 'GAP-RECOVERY',
      organizationId: 'ORG-ALPHA',
      projectId: 'PROJ-ALPHA',
      graphVersion: 1,
      position: 0,
      type: 'UNTESTABLE',
      category: 'FAILURE_HANDLING',
      title: 'Recovery outcome is unknown',
      description: 'The source does not define recovery.',
      severity: 'HIGH',
      impactAreas: ['failure_handling'],
      affectedEntityIds: ['REQ-REVIEW'],
      affectedArtifacts: ['EXPERIENCE'],
      rationale: 'Recovery must be explicit.',
      status: 'OPEN',
      truthStatus: 'UNKNOWN'
    });
    const blockedPreview = await preview();
    const generated = (await generate(blockedPreview.contentHash, '"PROJ-ALPHA:1"', 'business-context-generate-blocked')).json<{
      baseline: { version: { id: string; contentHash: string } };
    }>();
    const unsafeApproval = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/business-context/reviews',
      headers: { authorization: `Bearer ${REVIEWER_TOKEN}`, 'idempotency-key': 'business-context-unsafe-approval', 'if-match': '"PROJ-ALPHA:2"' },
      payload: {
        sourceGraphVersion: 1,
        contextVersionId: generated.baseline.version.id,
        contextContentHash: generated.baseline.version.contentHash,
        decision: 'ACCEPT',
        feedbackCategory: 'APPROVAL',
        comment: 'This approval must fail while the exact version contains a critical gap.',
        proposedGraphChanges: []
      }
    });
    expect(unsafeApproval.statusCode).toBe(422);
    expect(await database.db.select().from(businessContextReviews)).toHaveLength(0);

    const editReview = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/business-context/reviews',
      headers: { authorization: `Bearer ${REVIEWER_TOKEN}`, 'idempotency-key': 'business-context-edit-review', 'if-match': '"PROJ-ALPHA:2"' },
      payload: {
        sourceGraphVersion: 1,
        contextVersionId: generated.baseline.version.id,
        contextContentHash: generated.baseline.version.contentHash,
        decision: 'ACCEPT_WITH_EDITS',
        feedbackCategory: 'WORKFLOW',
        comment: 'The happy path is grounded, but recovery behavior must be confirmed in canonical truth.',
        proposedGraphChanges: [{
          target: 'WORKFLOW',
          targetItemId: blockedPreview.workflows[0]!.id,
          proposedValue: 'Finance reviewers can recover a failed approval without losing the invoice decision.',
          rationale: 'The current source leaves the critical recovery outcome untestable.'
        }]
      }
    });
    expect(editReview.statusCode, editReview.body).toBe(201);
    expect(editReview.json()).toMatchObject({
      baseline: {
        review: {
          decision: 'ACCEPT_WITH_EDITS',
          truthStatus: 'HUMAN_REVIEWED',
          proposedGraphChanges: [{ status: 'PROPOSED_GRAPH_MUTATION' }]
        }
      }
    });
    expect(await database.db.select().from(auditEvents).where(eq(auditEvents.action, 'BUSINESS_CONTEXT_APPROVED'))).toHaveLength(0);
    const regenerated = (await generate(blockedPreview.contentHash, '"PROJ-ALPHA:3"', 'business-context-regenerate-rejected')).json<{
      project: { rowVersion: number };
      baseline: { version: { id: string; contentHash: string } };
    }>();
    expect(regenerated.project.rowVersion).toBe(4);
    const rejected = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/business-context/reviews',
      headers: { authorization: `Bearer ${REVIEWER_TOKEN}`, 'idempotency-key': 'business-context-reject-review', 'if-match': '"PROJ-ALPHA:4"' },
      payload: {
        sourceGraphVersion: 1,
        contextVersionId: regenerated.baseline.version.id,
        contextContentHash: regenerated.baseline.version.contentHash,
        decision: 'REJECT',
        feedbackCategory: 'OTHER',
        comment: 'This version is rejected until the critical recovery decision is grounded.',
        proposedGraphChanges: []
      }
    });
    expect(rejected.statusCode, rejected.body).toBe(201);
    expect(rejected.json()).toMatchObject({ baseline: { review: { decision: 'REJECT', truthStatus: 'HUMAN_REVIEWED' } } });
    expect(await database.db.select().from(businessContextReviews)).toHaveLength(2);
    const crossTenant = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-BETA/projects/PROJ-ALPHA/business-context/current',
      headers: { authorization: `Bearer ${OWNER_TOKEN}` }
    });
    expect(crossTenant.statusCode).toBe(403);
  });
});
