import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseHandle, type DatabaseHandle } from '../src/database/client';
import { compileArchitectureGeneration } from '../src/architecture/architecture.compiler';
import { ArchitectureDecisionSchema } from '../src/architecture/architecture.schema';
import { migrateDatabase } from '../src/database/migrate';
import {
  agentRuns, arbDecisions, architectureGenerations, architectureOptionVersions, auditEvents, clarificationQuestions, documentApprovals, engineeringPlanGenerations, knowledgeEntities, memberships, modelCalls, modelPolicies, organizations,
  projectDocuments, projectGaps, projectGraphs, projects, sessions, users, workItemGenerationItems, workItemGenerations,
  workItemReviewItems, workItemReviews, workItems, workItemVersions, workspaces
} from '../src/database/schema';
import { hashSessionToken } from '../src/identity/authentication/session-token';
import { createApplication } from '../src/platform/create-application';
import { seedApprovedNonVisualBusinessContext } from './helpers/approved-business-context.fixture';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl === undefined ? describe.skip : describe;
const OWNER_TOKEN = 'w'.repeat(43);
const REVIEWER_TOKEN = 'r'.repeat(43);
const VIEWER_TOKEN = 'v'.repeat(43);

describePostgres('PostgreSQL work-item generation and immutable preview', () => {
  let database: DatabaseHandle;
  let app: NestFastifyApplication | undefined;

  async function resetDatabase() {
    await database.pool.query('drop schema if exists public cascade');
    await database.pool.query('drop schema if exists axiom_internal cascade');
    await database.pool.query('create schema public');
    await migrateDatabase(database.db);
  }

  async function seed() {
    await database.db.insert(organizations).values([{ id: 'ORG-ALPHA', slug: 'alpha', name: 'Alpha' }, { id: 'ORG-BETA', slug: 'beta', name: 'Beta' }]);
    await database.db.insert(users).values([{ id: 'USER-OWNER', email: 'owner@example.test', displayName: 'Owner' }, { id: 'USER-REVIEWER', email: 'reviewer@example.test', displayName: 'Reviewer' }, { id: 'USER-VIEWER', email: 'viewer@example.test', displayName: 'Viewer' }]);
    await database.db.insert(memberships).values([{ organizationId: 'ORG-ALPHA', userId: 'USER-OWNER', role: 'OWNER' }, { organizationId: 'ORG-ALPHA', userId: 'USER-REVIEWER', role: 'REVIEWER' }, { organizationId: 'ORG-ALPHA', userId: 'USER-VIEWER', role: 'VIEWER' }]);
    await database.db.insert(sessions).values([{ id: 'SESSION-OWNER', userId: 'USER-OWNER', tokenHash: hashSessionToken(OWNER_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' }, { id: 'SESSION-REVIEWER', userId: 'USER-REVIEWER', tokenHash: hashSessionToken(REVIEWER_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' }, { id: 'SESSION-VIEWER', userId: 'USER-VIEWER', tokenHash: hashSessionToken(VIEWER_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' }]);
    await database.db.insert(workspaces).values({ id: 'WS-ALPHA', organizationId: 'ORG-ALPHA', name: 'Alpha Workspace' });
    await database.db.insert(modelPolicies).values({ id: 'MPOL-ALPHA', organizationId: 'ORG-ALPHA', economyModelDefinitionId: 'MODEL-AXIOM-STRUCTURED-FIXTURE-V1', balancedModelDefinitionId: 'MODEL-AXIOM-STRUCTURED-FIXTURE-V1', bestModelDefinitionId: 'MODEL-AXIOM-STRUCTURED-FIXTURE-V1', updatedByUserId: 'USER-OWNER' });
    await database.db.insert(projects).values({ id: 'PROJ-ALPHA', organizationId: 'ORG-ALPHA', workspaceId: 'WS-ALPHA', name: 'Alpha Product', status: 'HLD_READY', graphVersion: 1 });
    await database.db.insert(projectGraphs).values({ organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, summary: 'Approved graph', analyzer: 'fixture', analyzedAt: '2026-07-23T00:00:00.000Z' });
    await database.db.insert(knowledgeEntities).values([
      { id: 'REQ-ACCESS', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, category: 'REQUIREMENT', text: 'Administrators shall invite organization members with an approved role.', truthStatus: 'HUMAN_CONFIRMED', position: 0 },
      { id: 'NFR-AUDIT', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, category: 'NFR', text: 'Invitation changes shall create immutable audit evidence.', truthStatus: 'HUMAN_CONFIRMED', position: 1 },
      { id: 'GOAL-ONBOARDING', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, category: 'GOAL', text: 'The business objective is to reduce onboarding cost by 20%.', truthStatus: 'HUMAN_CONFIRMED', position: 2 },
      { id: 'DECISION-API-ONLY', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, category: 'DECISION', text: 'This project is API-only with no user interface.', truthStatus: 'HUMAN_CONFIRMED', position: 3 }
    ]);
    await seedApprovedNonVisualBusinessContext(database, {
      organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, userId: 'USER-OWNER', analyzedAt: '2026-07-23T00:00:00.000Z',
      entities: [
        { id: 'REQ-ACCESS', category: 'REQUIREMENT', text: 'Administrators shall invite organization members with an approved role.', truthStatus: 'HUMAN_CONFIRMED', sourceId: null },
        { id: 'NFR-AUDIT', category: 'NFR', text: 'Invitation changes shall create immutable audit evidence.', truthStatus: 'HUMAN_CONFIRMED', sourceId: null },
        { id: 'GOAL-ONBOARDING', category: 'GOAL', text: 'The business objective is to reduce onboarding cost by 20%.', truthStatus: 'HUMAN_CONFIRMED', sourceId: null },
        { id: 'DECISION-API-ONLY', category: 'DECISION', text: 'This project is API-only with no user interface.', truthStatus: 'HUMAN_CONFIRMED', sourceId: null }
      ]
    });
    const documentHashes = { requirements: '1'.repeat(64), srs: '2'.repeat(64), nfr: '3'.repeat(64) };
    await database.db.insert(projectDocuments).values([
      { id: 'DOC-REQUIREMENTS-PROJ-ALPHA', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', type: 'requirements', version: 1, sourceGraphVersion: 1, title: 'Requirements Catalogue', content: 'Approved requirements.', sha256: documentHashes.requirements, truthStatus: 'AI_SUGGESTED', metadata: {}, generatedAt: '2026-07-23T00:00:00.000Z' },
      { id: 'DOC-SRS-PROJ-ALPHA', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', type: 'srs', version: 1, sourceGraphVersion: 1, title: 'Software Requirements Specification', content: 'Approved SRS.', sha256: documentHashes.srs, truthStatus: 'AI_SUGGESTED', metadata: {}, generatedAt: '2026-07-23T00:00:00.000Z' },
      { id: 'DOC-NFR-PROJ-ALPHA', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', type: 'nfr', version: 1, sourceGraphVersion: 1, title: 'Non-Functional Requirements Specification', content: 'Approved NFR.', sha256: documentHashes.nfr, truthStatus: 'AI_SUGGESTED', metadata: {}, generatedAt: '2026-07-23T00:00:00.000Z' }
    ]);
    await database.db.insert(documentApprovals).values({
      id: 'DOCAPP-ALPHA', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1,
      payload: { id: 'DOCAPP-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, documentHashes, comment: 'Approved exact artifact fixture for work-item integration tests.', truthStatus: 'HUMAN_APPROVED', approvedByUserId: 'USER-OWNER', approvedAt: '2026-07-23T00:00:00.000Z' },
      approvedAt: '2026-07-23T00:00:00.000Z'
    });
    const architectureGeneration = compileArchitectureGeneration({
      generationId: 'ARCHGEN-WORKITEM-FIXTURE', generationVersion: 1, projectId: 'PROJ-ALPHA', projectName: 'Alpha Product', graphVersion: 1,
      graphSummary: 'Approved graph',
      entities: [
        { id: 'REQ-ACCESS', category: 'REQUIREMENT', text: 'Administrators shall invite organization members with an approved role.', truthStatus: 'HUMAN_CONFIRMED' },
        { id: 'NFR-AUDIT', category: 'NFR', text: 'Invitation changes shall create immutable audit evidence.', truthStatus: 'HUMAN_CONFIRMED' }
      ],
      gaps: [],
      requirementDocumentHashes: documentHashes,
      generatedAt: '2026-07-23T00:00:00.000Z'
    });
    const selectedArchitecture = architectureGeneration.options.find((option) => option.id === architectureGeneration.recommendedOptionId)!;
    const architectureDecision = ArchitectureDecisionSchema.parse({
      id: 'ADR-WORKITEM-FIXTURE', projectId: 'PROJ-ALPHA', graphVersion: 1, version: 1,
      generationId: architectureGeneration.id, generationContentHash: architectureGeneration.contentHash,
      selectedOptionId: selectedArchitecture.id, selectedOptionHash: selectedArchitecture.sha256,
      comment: 'The balanced architecture fixture is explicitly approved for exact work-item gate verification.',
      rejectedAlternatives: architectureGeneration.options.filter((option) => option.id !== selectedArchitecture.id).map((option) => ({ optionId: option.id, whyRejected: option.whyNot })),
      truthStatus: 'HUMAN_APPROVED', approvedByUserId: 'USER-OWNER', approvedAt: '2026-07-23T00:00:00.000Z'
    });
    await database.db.insert(architectureGenerations).values({
      id: architectureGeneration.id, organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1,
      version: architectureGeneration.version, contentHash: architectureGeneration.contentHash, compilerVersion: architectureGeneration.compilerVersion,
      payload: architectureGeneration, createdByUserId: 'USER-OWNER', createdAt: architectureGeneration.generatedAt
    });
    await database.db.insert(architectureOptionVersions).values(architectureGeneration.options.map((option, position) => ({
      generationId: architectureGeneration.id, organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', optionId: option.id,
      position, contentHash: option.sha256, payload: option
    })));
    await database.db.insert(arbDecisions).values({
      id: architectureDecision.id, organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1,
      version: architectureDecision.version, payload: architectureDecision, approvedAt: architectureDecision.approvedAt
    });
  }

  async function generate(key = 'work-items-generate-001', token = OWNER_TOKEN) {
    return app!.inject({ method: 'POST', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/work-item-generations', headers: { authorization: `Bearer ${token}`, 'idempotency-key': key, 'x-request-id': key }, payload: { sourceGraphVersion: 1, tier: 'BALANCED' } });
  }

  async function review(
    preview: { id: string; generationContentHash?: string; contentHash: string },
    payload: Record<string, unknown>,
    key = 'work-items-review-001',
    token = OWNER_TOKEN,
    ifMatch = `"${preview.id}:${preview.generationContentHash ?? preview.contentHash}"`
  ) {
    return app!.inject({
      method: 'POST',
      url: `/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/work-item-generations/${preview.id}/reviews`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key, 'if-match': ifMatch, 'x-request-id': key },
      payload
    });
  }

  beforeAll(() => {
    const parsed = new URL(testDatabaseUrl!);
    if (!parsed.pathname.startsWith('/axiom_test')) throw new Error('Work-item tests require axiom_test');
    database = createDatabaseHandle(testDatabaseUrl);
  });
  beforeEach(async () => { await resetDatabase(); await seed(); app = await createApplication({ databaseUrl: testDatabaseUrl! }); });
  afterEach(async () => { await app?.close(); app = undefined; });
  afterAll(async () => database.pool.end());

  it('persists one exact quality-gated Agile preview and immutable versions', async () => {
    const response = await generate();
    expect(response.statusCode).toBe(201);
    const preview = response.json<{ id: string; contentHash: string; qualityReport: { passed: boolean }; provenance: { tier: string; provider: string; budget: { status: string }; usage: { evidenceStatus: string }; attemptCount: number }; workItems: Array<{ id: string; type: string; parentId: string | null; version: number }> }>();
    expect(preview.qualityReport.passed).toBe(true);
    expect(preview.workItems.map((item) => item.type)).toEqual(['EPIC', 'STORY', 'STORY']);
    expect(preview.workItems.slice(1).every((item) => item.parentId === preview.workItems[0]?.id)).toBe(true);
    expect(preview.provenance).toMatchObject({ tier: 'BALANCED', provider: 'LOCAL_FIXTURE', budget: { status: 'NOT_APPLICABLE' }, usage: { evidenceStatus: 'NOT_APPLICABLE' }, attemptCount: 1 });
    expect(response.headers.etag).toBe(`"${preview.id}:${preview.contentHash}"`);
    expect(await database.db.select().from(workItemGenerations)).toHaveLength(1);
    expect(await database.db.select().from(workItems)).toHaveLength(3);
    expect(await database.db.select().from(workItemVersions)).toHaveLength(3);
    expect(await database.db.select().from(agentRuns)).toHaveLength(1);
    expect(await database.db.select().from(modelCalls)).toHaveLength(1);
    expect(await database.db.select().from(auditEvents).where(eq(auditEvents.action, 'WORK_ITEM_DRAFT_GENERATED'))).toHaveLength(1);
    const [project] = await database.db.select({ status: projects.status }).from(projects).where(eq(projects.id, 'PROJ-ALPHA'));
    expect(project?.status).toBe('BACKLOG_READY');
    await expect(database.pool.query("update work_item_versions set payload = '{}'::jsonb where work_item_id = $1", [preview.workItems[0]!.id])).rejects.toThrow(/immutable/u);
  });

  it('generates and replays one grounded full-lifecycle Engineering Plan before duplicate model execution', async () => {
    const request = (key: string, token = OWNER_TOKEN, organizationId = 'ORG-ALPHA') => app!.inject({
      method: 'POST',
      url: `/api/v1/organizations/${organizationId}/projects/PROJ-ALPHA/engineering-plans`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key, 'x-request-id': key },
      payload: { sourceGraphVersion: 1, tier: 'BALANCED' }
    });
    expect((await request('engineering-plan-viewer-001', VIEWER_TOKEN)).statusCode).toBe(403);
    expect((await request('engineering-plan-cross-tenant-001', OWNER_TOKEN, 'ORG-BETA')).statusCode).toBe(403);

    const firstResponse = await request('engineering-plan-generate-001');
    expect(firstResponse.statusCode).toBe(201);
    const first = firstResponse.json<{ id: string; version: number; replayed: boolean; qualityReport: { passed: boolean; metrics: { requiredDomainCount: number; coveredDomainCount: number; validSourceReferenceRate: number; prohibitedClaimCount: number } }; plan: { truthStatus: string; recommendations: Array<{ domain: string; truthStatus: string }> }; provenance: { provider: string; budget: { status: string } }; references: Array<{ id: string }> }>();
    expect(first).toMatchObject({ version: 1, replayed: false, qualityReport: { passed: true, metrics: { requiredDomainCount: 12, coveredDomainCount: 12, validSourceReferenceRate: 1, prohibitedClaimCount: 0 } }, plan: { truthStatus: 'AI_SUGGESTED' }, provenance: { provider: 'LOCAL_FIXTURE', budget: { status: 'NOT_APPLICABLE' } } });
    expect(new Set(first.plan.recommendations.map((recommendation) => recommendation.domain)).size).toBe(12);
    expect(first.plan.recommendations.every((recommendation) => recommendation.truthStatus === 'AI_SUGGESTED')).toBe(true);
    expect(first.references.map((reference) => reference.id)).toContain('OWASP_ASVS_5_0_0');

    const replayResponse = await request('engineering-plan-generate-001');
    expect(replayResponse.statusCode).toBe(201);
    expect(replayResponse.json()).toMatchObject({ id: first.id, version: 1, replayed: true });
    expect(await database.db.select().from(engineeringPlanGenerations)).toHaveLength(1);
    expect(await database.db.select().from(agentRuns)).toHaveLength(1);
    expect(await database.db.select().from(modelCalls)).toHaveLength(1);
    expect(await database.db.select().from(auditEvents).where(eq(auditEvents.action, 'ENGINEERING_PLAN_GENERATED'))).toHaveLength(1);

    const latest = await app!.inject({ method: 'GET', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/engineering-plans/latest', headers: { authorization: `Bearer ${VIEWER_TOKEN}` } });
    expect(latest.statusCode).toBe(200);
    expect(latest.json()).toMatchObject({ id: first.id, version: 1, replayed: false });
  }, 15_000);

  it('replays one generation for the same idempotency key and serializes concurrent retries', async () => {
    const responses = await Promise.all([generate('work-items-concurrent-001'), generate('work-items-concurrent-001')]);
    expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);
    expect(responses.map((response) => response.json<{ replayed: boolean }>().replayed).sort()).toEqual([false, true]);
    expect(await database.db.select().from(workItemGenerations)).toHaveLength(1);
    expect(await database.db.select().from(workItemVersions)).toHaveLength(3);
    expect(await database.db.select().from(auditEvents).where(eq(auditEvents.action, 'WORK_ITEM_DRAFT_GENERATED'))).toHaveLength(1);
  }, 10_000);

  it('regenerates stable IDs as new immutable versions and returns the latest exact preview', async () => {
    const first = (await generate('work-items-version-001')).json<{ id: string; workItems: Array<{ id: string; version: number }> }>();
    const second = (await generate('work-items-version-002')).json<{ id: string; workItems: Array<{ id: string; version: number }> }>();
    expect(second.id).not.toBe(first.id);
    expect(second.workItems.map((item) => item.id)).toEqual(first.workItems.map((item) => item.id));
    expect(second.workItems.every((item) => item.version === 2)).toBe(true);
    expect(await database.db.select().from(workItemVersions)).toHaveLength(6);
    const latest = await app!.inject({ method: 'GET', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/work-item-generations/latest', headers: { authorization: `Bearer ${VIEWER_TOKEN}` } });
    expect(latest.statusCode).toBe(200);
    expect(latest.json()).toMatchObject({ id: second.id, workItems: second.workItems });
    const denied = await app!.inject({ method: 'GET', url: '/api/v1/organizations/ORG-BETA/projects/PROJ-ALPHA/work-item-generations/latest', headers: { authorization: `Bearer ${OWNER_TOKEN}` } });
    expect(denied.statusCode).toBe(403);
  });

  it('blocks unauthorized or unapproved generation without persisting a draft', async () => {
    expect((await generate('viewer-generate-001', VIEWER_TOKEN)).statusCode).toBe(403);
    await database.db.delete(documentApprovals).where(and(eq(documentApprovals.organizationId, 'ORG-ALPHA'), eq(documentApprovals.projectId, 'PROJ-ALPHA')));
    const blocked = await generate('unapproved-generate-001');
    expect(blocked.statusCode).toBe(422);
    expect(blocked.body).toContain('no exact current-artifact approval');
    expect(await database.db.select().from(workItemGenerations)).toHaveLength(0);
    expect(await database.db.select().from(workItems)).toHaveLength(0);
  });

  it('does not accept an older approval after requirement artifacts are regenerated', async () => {
    await database.db.insert(projectDocuments).values([
      { id: 'DOC-REQUIREMENTS-PROJ-ALPHA', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', type: 'requirements', version: 2, sourceGraphVersion: 1, title: 'Requirements Catalogue', content: 'Regenerated requirements.', sha256: '4'.repeat(64), truthStatus: 'AI_SUGGESTED', metadata: {}, generatedAt: '2026-07-23T01:00:00.000Z' },
      { id: 'DOC-SRS-PROJ-ALPHA', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', type: 'srs', version: 2, sourceGraphVersion: 1, title: 'Software Requirements Specification', content: 'Regenerated SRS.', sha256: '5'.repeat(64), truthStatus: 'AI_SUGGESTED', metadata: {}, generatedAt: '2026-07-23T01:00:00.000Z' },
      { id: 'DOC-NFR-PROJ-ALPHA', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', type: 'nfr', version: 2, sourceGraphVersion: 1, title: 'Non-Functional Requirements Specification', content: 'Regenerated NFR.', sha256: '6'.repeat(64), truthStatus: 'AI_SUGGESTED', metadata: {}, generatedAt: '2026-07-23T01:00:00.000Z' }
    ]);

    const blocked = await generate('stale-artifact-approval-001');

    expect(blocked.statusCode).toBe(422);
    expect(blocked.body).toContain('no exact current-artifact approval');
    expect(await database.db.select().from(workItemGenerations)).toHaveLength(0);
  });

  it('does not accept an architecture decision after a newer option generation exists', async () => {
    const regenerated = compileArchitectureGeneration({
      generationId: 'ARCHGEN-WORKITEM-REGENERATED', generationVersion: 2, projectId: 'PROJ-ALPHA', projectName: 'Alpha Product', graphVersion: 1,
      graphSummary: 'Approved graph',
      entities: [
        { id: 'REQ-ACCESS', category: 'REQUIREMENT', text: 'Administrators shall invite organization members with an approved role.', truthStatus: 'HUMAN_CONFIRMED' },
        { id: 'NFR-AUDIT', category: 'NFR', text: 'Invitation changes shall create immutable audit evidence.', truthStatus: 'HUMAN_CONFIRMED' }
      ],
      gaps: [], requirementDocumentHashes: { requirements: '1'.repeat(64), srs: '2'.repeat(64), nfr: '3'.repeat(64) },
      generatedAt: '2026-07-23T01:00:00.000Z'
    });
    await database.db.insert(architectureGenerations).values({
      id: regenerated.id, organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1,
      version: regenerated.version, contentHash: regenerated.contentHash, compilerVersion: regenerated.compilerVersion,
      payload: regenerated, createdByUserId: 'USER-OWNER', createdAt: regenerated.generatedAt
    });
    await database.db.insert(architectureOptionVersions).values(regenerated.options.map((option, position) => ({
      generationId: regenerated.id, organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', optionId: option.id,
      position, contentHash: option.sha256, payload: option
    })));

    const blocked = await generate('stale-architecture-decision-001');

    expect(blocked.statusCode).toBe(422);
    expect(blocked.body).toContain('no exact latest-generation architecture decision');
    expect(await database.db.select().from(workItemGenerations)).toHaveLength(0);
  });

  it('returns stored clarification guidance before any Agent Kernel or persistence work', async () => {
    await database.db.insert(projectGaps).values([
      {
        id: 'GAP-AUTH-POLICY', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1,
        type: 'CONTRADICTION', category: 'SECURITY_PRIVACY', title: 'Conflicting invitation authentication policies',
        description: 'The approved sources require different authentication policies for invitation acceptance.',
        position: 0, impactAreas: ['security'], affectedEntityIds: ['REQ-ACCESS'], affectedArtifacts: ['BACKLOG'],
        rationale: 'Conflicting security policy cannot be selected safely during ticket generation.',
        severity: 'MEDIUM', status: 'OPEN', truthStatus: 'UNKNOWN'
      },
      {
        id: 'GAP-AUDIT-TESTABILITY', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1,
        type: 'UNTESTABLE', category: 'TESTABILITY', title: 'Audit immutability has no verifiable boundary',
        description: 'The current graph does not define how immutable invitation audit evidence will be verified.',
        position: 1, impactAreas: ['testing'], affectedEntityIds: ['NFR-AUDIT'], affectedArtifacts: ['BACKLOG'],
        rationale: 'An untestable security requirement cannot produce a verifiable implementation ticket.',
        severity: 'HIGH', status: 'OPEN', truthStatus: 'UNKNOWN'
      }
    ]);
    await database.db.insert(clarificationQuestions).values({
      id: 'QUESTION-AUTH-POLICY', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1,
      gapId: 'GAP-AUTH-POLICY', question: 'Which approved authentication policy must govern invitation acceptance?',
      whyItMatters: 'Selecting one without a recorded decision could weaken organization access controls.',
      affectedEntityIds: ['REQ-ACCESS'], options: [], status: 'OPEN', answer: null, answeredAt: null,
      truthStatus: 'UNKNOWN', position: 0
    });

    const response = await generate('clarification-required-001');

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: 'CLARIFICATION_REQUIRED',
        retryable: false,
        details: {
          blockers: [
            {
              gapId: 'GAP-AUDIT-TESTABILITY', type: 'UNTESTABLE', severity: 'HIGH', truthStatus: 'UNKNOWN', clarification: null
            },
            {
              gapId: 'GAP-AUTH-POLICY', type: 'CONTRADICTION', severity: 'MEDIUM', truthStatus: 'UNKNOWN',
              clarification: {
                id: 'QUESTION-AUTH-POLICY',
                question: 'Which approved authentication policy must govern invitation acceptance?',
                affectedEntityIds: ['REQ-ACCESS']
              }
            }
          ]
        }
      }
    });
    expect(await database.db.select().from(workItemGenerations)).toHaveLength(0);
    expect(await database.db.select().from(workItems)).toHaveLength(0);
    expect(await database.db.select().from(agentRuns)).toHaveLength(0);
    expect(await database.db.select().from(modelCalls)).toHaveLength(0);
  });

  it('prevents accepting a draft after a critical contradiction appears', async () => {
    const generated = (await generate('review-new-contradiction-generate')).json<{ id: string; contentHash: string; generationContentHash: string }>();
    await database.db.insert(projectGaps).values({
      id: 'GAP-NEW-CONTRADICTION', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1,
      type: 'CONTRADICTION', category: 'SECURITY_PRIVACY', title: 'Invitation policy changed after generation',
      description: 'New evidence conflicts with the invitation policy used by the generated backlog.',
      position: 0, impactAreas: ['security'], affectedEntityIds: ['REQ-ACCESS'], affectedArtifacts: ['BACKLOG'],
      rationale: 'The generated backlog must not be accepted against contradictory current evidence.',
      severity: 'LOW', status: 'OPEN', truthStatus: 'UNKNOWN'
    });

    const accepted = await review(generated, {
      decision: 'ACCEPT', reasonCategory: 'MEETS_REQUIREMENTS',
      comment: 'This decision must be rejected because new contradictory evidence is unresolved.'
    }, 'review-new-contradiction-accept');

    expect(accepted.statusCode).toBe(422);
    expect(accepted.body).toContain('GAP-NEW-CONTRADICTION');
    expect(await database.db.select().from(workItemReviews)).toHaveLength(0);
  });

  it('accepts the exact snapshot once, records an immutable categorized review, and replays safely', async () => {
    const generated = (await generate('review-accept-generate')).json<{ id: string; contentHash: string; generationContentHash: string; workItems: Array<{ id: string; version: number }> }>();
    const payload = { decision: 'ACCEPT', reasonCategory: 'MEETS_REQUIREMENTS', comment: 'The grounded backlog is ready for controlled connector preparation.' };
    const first = await review(generated, payload, 'review-accept-001');
    await database.db.insert(projectGraphs).values({ organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 2, summary: 'Later graph', analyzer: 'fixture', analyzedAt: '2026-07-23T01:00:00.000Z' });
    await database.db.update(projects).set({ graphVersion: 2 }).where(eq(projects.id, 'PROJ-ALPHA'));
    const replay = await review(generated, payload, 'review-accept-001');
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(first.json()).toMatchObject({ status: 'APPROVED', review: { decision: 'ACCEPT', reasonCategory: 'MEETS_REQUIREMENTS', reviewedByUserId: 'USER-OWNER' } });
    expect(await database.db.select().from(workItemReviews)).toHaveLength(1);
    expect(await database.db.select().from(workItemReviewItems)).toHaveLength(3);
    expect(await database.db.select().from(auditEvents).where(eq(auditEvents.action, 'WORK_ITEM_GENERATION_ACCEPTED'))).toHaveLength(1);
    await expect(database.pool.query("update work_item_reviews set comment = 'mutated review evidence' where generation_id = $1", [generated.id])).rejects.toThrow(/immutable/u);
    await expect(database.pool.query('update work_item_generation_items set position = position + 1 where generation_id = $1', [generated.id])).rejects.toThrow(/immutable/u);
  });

  it('accepts material edits as new immutable versions only after quality gates pass', async () => {
    const generated = (await generate('review-edit-generate')).json<{ id: string; contentHash: string; generationContentHash: string; workItems: Array<{ id: string; version: number; type: string }> }>();
    const story = generated.workItems.find((item) => item.type === 'STORY')!;
    const response = await review(generated, {
      decision: 'ACCEPT_WITH_EDITS',
      reasonCategory: 'PRIORITY_OR_ESTIMATE',
      comment: 'The first story needs an explicit delivery priority before publication preparation.',
      edits: [{ workItemId: story.id, expectedVersion: story.version, title: 'Deliver approved organization member invitations', priority: 'P1' }]
    }, 'review-edit-001');
    expect(response.statusCode).toBe(201);
    const reviewed = response.json<{ status: string; contentHash: string; generationContentHash: string; review: { decision: string }; workItems: Array<{ id: string; version: number; title: string }> }>();
    expect(reviewed).toMatchObject({ status: 'APPROVED', review: { decision: 'ACCEPT_WITH_EDITS' } });
    expect(reviewed.contentHash).not.toBe(reviewed.generationContentHash);
    expect(reviewed.workItems.find((item) => item.id === story.id)).toMatchObject({ version: story.version + 1, title: 'Deliver approved organization member invitations' });
    expect(await database.db.select().from(workItemVersions)).toHaveLength(4);
    const latest = await app!.inject({ method: 'GET', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/work-item-generations/latest', headers: { authorization: `Bearer ${VIEWER_TOKEN}` } });
    expect(latest.json()).toMatchObject({ contentHash: reviewed.contentHash, workItems: reviewed.workItems, review: { decision: 'ACCEPT_WITH_EDITS' } });
  });

  it('allows a reviewer to reject with a categorized reason while denying viewers and stale previews', async () => {
    const generated = (await generate('review-reject-generate')).json<{ id: string; contentHash: string; generationContentHash: string }>();
    const payload = { decision: 'REJECT', reasonCategory: 'MISSING_REQUIREMENT', comment: 'A required authorization scenario is missing from the generated backlog.' };
    expect((await review(generated, payload, 'viewer-review-001', VIEWER_TOKEN)).statusCode).toBe(403);
    const crossTenant = await app!.inject({ method: 'POST', url: `/api/v1/organizations/ORG-BETA/projects/PROJ-ALPHA/work-item-generations/${generated.id}/reviews`, headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'idempotency-key': 'cross-tenant-review-001', 'if-match': `"${generated.id}:${generated.generationContentHash}"` }, payload });
    expect(crossTenant.statusCode).toBe(403);
    expect((await review(generated, payload, 'stale-review-001', REVIEWER_TOKEN, `"${generated.id}:${'0'.repeat(64)}"`)).statusCode).toBe(409);
    const rejected = await review(generated, payload, 'review-reject-001', REVIEWER_TOKEN);
    expect(rejected.statusCode).toBe(201);
    expect(rejected.json()).toMatchObject({ status: 'REJECTED', review: { decision: 'REJECT', reasonCategory: 'MISSING_REQUIREMENT', reviewedByUserId: 'USER-REVIEWER' } });
    expect(await database.db.select().from(workItemVersions)).toHaveLength(3);
    expect(await database.db.select().from(auditEvents).where(eq(auditEvents.action, 'WORK_ITEM_GENERATION_REJECTED'))).toHaveLength(1);
  });

  it('blocks acceptance after the graph changes but still permits an attributable rejection', async () => {
    const generated = (await generate('review-stale-graph-generate')).json<{ id: string; contentHash: string; generationContentHash: string }>();
    await database.db.insert(projectGraphs).values({ organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 2, summary: 'Changed graph', analyzer: 'fixture', analyzedAt: '2026-07-23T01:00:00.000Z' });
    await database.db.update(projects).set({ graphVersion: 2 }).where(eq(projects.id, 'PROJ-ALPHA'));
    const accepted = await review(generated, { decision: 'ACCEPT', reasonCategory: 'MEETS_REQUIREMENTS', comment: 'This stale generation should not be accepted after graph changes.' }, 'review-stale-accept');
    expect(accepted.statusCode).toBe(422);
    const rejected = await review(generated, { decision: 'REJECT', reasonCategory: 'OTHER', comment: 'The canonical graph changed, so this generated snapshot is intentionally rejected.' }, 'review-stale-reject');
    expect(rejected.statusCode).toBe(201);
    expect(rejected.json()).toMatchObject({ status: 'REJECTED' });
  });

  it('guards and executes the work-item migration rollback', async () => {
    await generate('work-items-rollback-001');
    const engineeringPlanDownSql = await readFile(resolve('drizzle/0018_engineering_plans.down.sql'), 'utf8');
    await database.pool.query(engineeringPlanDownSql);
    const agentKernelDownSql = await readFile(resolve('drizzle/0013_agent_kernel_runs.down.sql'), 'utf8');
    await expect(database.pool.query(agentKernelDownSql)).rejects.toThrow(/retention workflow/u);
    const reviewScopeDownSql = await readFile(resolve('drizzle/0008_work_item_review_tenant_scope.down.sql'), 'utf8');
    await database.pool.query(reviewScopeDownSql);
    const reviewDownSql = await readFile(resolve('drizzle/0007_work_item_human_review.down.sql'), 'utf8');
    await database.pool.query(reviewDownSql);
    const downSql = await readFile(resolve('drizzle/0006_work_item_versions.down.sql'), 'utf8');
    await expect(database.pool.query(downSql)).rejects.toThrow(/retention workflow/u);
    await database.db.delete(workItemGenerationItems);
    await database.db.delete(workItemVersions);
    await database.db.delete(workItems);
    await database.db.delete(workItemGenerations);
    await database.pool.query('truncate table model_calls, agent_runs cascade');
    await app!.close(); app = undefined;
    await database.pool.query(agentKernelDownSql);
    await database.pool.query(downSql);
    const result = await database.pool.query<{ table_name: string | null }>("select to_regclass('public.work_item_versions')::text as table_name");
    expect(result.rows[0]?.table_name).toBeNull();
  });

  it('guards and executes the work-item review migration rollback', async () => {
    const generated = (await generate('review-rollback-generate')).json<{ id: string; contentHash: string; generationContentHash: string }>();
    await review(generated, { decision: 'REJECT', reasonCategory: 'OTHER', comment: 'Rollback protection must preserve this immutable human review record.' }, 'review-rollback-001');
    const downSql = await readFile(resolve('drizzle/0007_work_item_human_review.down.sql'), 'utf8');
    await expect(database.pool.query(downSql)).rejects.toThrow(/retention workflow/u);
    await database.db.delete(workItemReviewItems);
    await database.db.delete(workItemReviews);
    await app!.close(); app = undefined;
    const scopeDownSql = await readFile(resolve('drizzle/0008_work_item_review_tenant_scope.down.sql'), 'utf8');
    await database.pool.query(scopeDownSql);
    await database.pool.query(downSql);
    const result = await database.pool.query<{ table_name: string | null }>("select to_regclass('public.work_item_reviews')::text as table_name");
    expect(result.rows[0]?.table_name).toBeNull();
  });
});
