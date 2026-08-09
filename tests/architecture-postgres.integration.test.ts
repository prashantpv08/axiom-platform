import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseHandle, type DatabaseHandle } from '../src/database/client';
import { migrateDatabase } from '../src/database/migrate';
import {
  arbDecisions,
  architectureGenerations,
  architectureOptionVersions,
  auditEvents,
  businessContextReviews,
  businessContextVersions,
  knowledgeEntities,
  memberships,
  organizations,
  projectDocuments,
  projectGraphs,
  projectSources,
  projects,
  sessions,
  users,
  workspaces
} from '../src/database/schema';
import { hashSessionToken } from '../src/identity/authentication/session-token';
import { calculateProjectReadiness } from '../src/projects/project-readiness.policy';
import { createApplication } from '../src/platform/create-application';
import { seedApprovedNonVisualBusinessContext } from './helpers/approved-business-context.fixture';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl === undefined ? describe.skip : describe;
const OWNER_TOKEN = 'i'.repeat(43);
const VIEWER_TOKEN = 'j'.repeat(43);

describePostgres('PostgreSQL architecture generation and exact decision', () => {
  let database: DatabaseHandle;
  let app: NestFastifyApplication | undefined;

  async function resetDatabase() {
    await database.pool.query('drop schema if exists public cascade');
    await database.pool.query('drop schema if exists axiom_internal cascade');
    await database.pool.query('create schema public');
    await migrateDatabase(database.db);
  }

  async function seed() {
    const entities = [{ id: 'REQ-ACCESS', category: 'REQUIREMENT', truthStatus: 'SOURCE_GROUNDED' }, { id: 'NFR-LATENCY', category: 'NFR', truthStatus: 'HUMAN_CONFIRMED' }, { id: 'GOAL-COST', category: 'GOAL', truthStatus: 'HUMAN_CONFIRMED' }, { id: 'DECISION-NON-VISUAL', category: 'DECISION', truthStatus: 'HUMAN_CONFIRMED' }];
    const readiness = calculateProjectReadiness({ entities, gaps: [], calculatedAt: '2026-07-24T00:00:00.000Z' });
    await database.db.insert(organizations).values([{ id: 'ORG-ALPHA', slug: 'alpha', name: 'Alpha' }, { id: 'ORG-BETA', slug: 'beta', name: 'Beta' }]);
    await database.db.insert(users).values([{ id: 'USER-OWNER', email: 'owner@example.test', displayName: 'Owner' }, { id: 'USER-VIEWER', email: 'viewer@example.test', displayName: 'Viewer' }]);
    await database.db.insert(memberships).values([{ organizationId: 'ORG-ALPHA', userId: 'USER-OWNER', role: 'OWNER' }, { organizationId: 'ORG-ALPHA', userId: 'USER-VIEWER', role: 'VIEWER' }]);
    await database.db.insert(sessions).values([{ id: 'SESSION-OWNER', userId: 'USER-OWNER', tokenHash: hashSessionToken(OWNER_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' }, { id: 'SESSION-VIEWER', userId: 'USER-VIEWER', tokenHash: hashSessionToken(VIEWER_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' }]);
    await database.db.insert(workspaces).values({ id: 'WS-ALPHA', organizationId: 'ORG-ALPHA', name: 'Alpha Workspace' });
    await database.db.insert(projects).values({ id: 'PROJ-ALPHA', organizationId: 'ORG-ALPHA', workspaceId: 'WS-ALPHA', name: 'Alpha Product', status: 'ANALYZED', graphVersion: 1 });
    await database.db.insert(projectGraphs).values({ organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, summary: 'Grounded membership product.', readiness, analyzer: 'fixture', analyzedAt: '2026-07-24T00:00:00.000Z' });
    await database.db.insert(projectSources).values({ id: 'SRC-BRIEF', organizationId: 'ORG-ALPHA', workspaceId: 'WS-ALPHA', projectId: 'PROJ-ALPHA', name: 'brief.md', kind: 'FILE', mimeType: 'text/markdown', size: 39, sha256: 'a'.repeat(64), extractedText: 'Administrators shall invite members.', rawPath: '/local/brief.md', status: 'EXTRACTED', createdAt: '2026-07-24T00:00:00.000Z' });
    await database.db.insert(knowledgeEntities).values([
      { id: 'REQ-ACCESS', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, category: 'REQUIREMENT', text: 'Administrators shall invite members.', truthStatus: 'SOURCE_GROUNDED', sourceId: 'SRC-BRIEF', quote: 'Administrators shall invite members.', startOffset: 0, endOffset: 36, position: 0 },
      { id: 'NFR-LATENCY', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, category: 'NFR', text: 'P95 latency shall remain below 500 ms.', truthStatus: 'HUMAN_CONFIRMED', position: 1 },
      { id: 'GOAL-COST', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, category: 'GOAL', text: 'The business objective is to reduce onboarding cost by 20%.', truthStatus: 'HUMAN_CONFIRMED', position: 2 },
      { id: 'DECISION-NON-VISUAL', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, category: 'DECISION', text: 'This project is API-only with no user interface.', truthStatus: 'HUMAN_CONFIRMED', position: 3 }
    ]);
    await seedApprovedNonVisualBusinessContext(database, {
      organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, userId: 'USER-OWNER', analyzedAt: '2026-07-24T00:00:00.000Z',
      entities: [
        { id: 'REQ-ACCESS', category: 'REQUIREMENT', text: 'Administrators shall invite members.', truthStatus: 'SOURCE_GROUNDED', sourceId: 'SRC-BRIEF' },
        { id: 'NFR-LATENCY', category: 'NFR', text: 'P95 latency shall remain below 500 ms.', truthStatus: 'HUMAN_CONFIRMED', sourceId: null },
        { id: 'GOAL-COST', category: 'GOAL', text: 'The business objective is to reduce onboarding cost by 20%.', truthStatus: 'HUMAN_CONFIRMED', sourceId: null },
        { id: 'DECISION-NON-VISUAL', category: 'DECISION', text: 'This project is API-only with no user interface.', truthStatus: 'HUMAN_CONFIRMED', sourceId: null }
      ]
    });
  }

  async function approveRequirements() {
    const generated = await app!.inject({ method: 'POST', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/artifacts/generations', headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'idempotency-key': 'requirements-generate-001', 'if-match': '"PROJ-ALPHA:1"' }, payload: { sourceGraphVersion: 1 } });
    const body = generated.json<{ baseline: { artifacts: Array<{ type: string; sha256: string }> } }>();
    const documentHashes = Object.fromEntries(body.baseline.artifacts.map((artifact) => [artifact.type, artifact.sha256]));
    const approved = await app!.inject({ method: 'POST', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/artifacts/approvals', headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'idempotency-key': 'requirements-approve-001', 'if-match': '"PROJ-ALPHA:2"' }, payload: { sourceGraphVersion: 1, documentHashes, comment: 'The exact current requirement baseline is approved for architecture comparison.' } });
    expect(approved.statusCode).toBe(201);
  }

  function generate(key: string, ifMatch: string, token = OWNER_TOKEN) {
    return app!.inject({ method: 'POST', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/architecture/generations', headers: { authorization: `Bearer ${token}`, 'idempotency-key': key, 'if-match': ifMatch }, payload: { sourceGraphVersion: 1 } });
  }

  beforeAll(() => {
    const parsed = new URL(testDatabaseUrl!);
    if (!parsed.pathname.startsWith('/axiom_test')) throw new Error('Architecture tests require axiom_test');
    database = createDatabaseHandle(testDatabaseUrl);
  });
  beforeEach(async () => { await resetDatabase(); await seed(); app = await createApplication({ databaseUrl: testDatabaseUrl! }); });
  afterEach(async () => { await app?.close(); app = undefined; });
  afterAll(async () => database.pool.end());

  it('generates, approves, compiles ADR/HLD, and invalidates the decision on regeneration', async () => {
    await approveRequirements();
    const generatedResponse = await generate('architecture-generate-001', '"PROJ-ALPHA:3"');
    expect(generatedResponse.statusCode).toBe(201);
    const generated = generatedResponse.json<{ project: { rowVersion: number; status: string }; baseline: { generation: { id: string; version: number; contentHash: string; recommendedOptionId: string; options: Array<{ id: string; sha256: string; estimatedCost: { range: string; truthStatus: string } }> }; decision: null } }>();
    expect(generated.project).toMatchObject({ rowVersion: 4, status: 'DESIGN_READY' });
    expect(generated.baseline.generation.options).toHaveLength(3);
    expect(generated.baseline.generation.options.every((option) => option.estimatedCost.range === 'UNKNOWN' && option.estimatedCost.truthStatus === 'UNKNOWN')).toBe(true);
    const replay = await generate('architecture-generate-001', '"PROJ-ALPHA:3"');
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toMatchObject({ replayed: true, baseline: { generation: { id: generated.baseline.generation.id } } });
    const selected = generated.baseline.generation.options.find((option) => option.id === generated.baseline.generation.recommendedOptionId)!;
    const approved = await app!.inject({
      method: 'POST', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/architecture/decisions',
      headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'idempotency-key': 'architecture-approve-001', 'if-match': '"PROJ-ALPHA:4"' },
      payload: { sourceGraphVersion: 1, generationId: generated.baseline.generation.id, generationContentHash: generated.baseline.generation.contentHash, selectedOptionId: selected.id, selectedOptionHash: selected.sha256, comment: 'The balanced option is approved because it adds durable execution without speculative domain services.' }
    });
    expect(approved.statusCode).toBe(201);
    const approvalBody = approved.json<{ project: { rowVersion: number; status: string }; baseline: { decision: { selectedOptionId: string; truthStatus: string }; artifacts: Array<{ type: string; truthStatus: string; content: string }> } }>();
    expect(approvalBody.project).toMatchObject({ rowVersion: 5, status: 'HLD_READY' });
    expect(approvalBody.baseline.decision).toMatchObject({ selectedOptionId: selected.id, truthStatus: 'HUMAN_APPROVED' });
    expect(approvalBody.baseline.artifacts.map((artifact) => artifact.type)).toEqual(['hld', 'adr']);
    expect(approvalBody.baseline.artifacts.every((artifact) => artifact.truthStatus === 'HUMAN_APPROVED' && artifact.content.includes(selected.id))).toBe(true);
    const viewerRead = await app!.inject({ method: 'GET', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/architecture/current', headers: { authorization: `Bearer ${VIEWER_TOKEN}` } });
    expect(viewerRead.statusCode).toBe(200);
    expect(viewerRead.json()).toMatchObject({ decision: { selectedOptionId: selected.id }, artifacts: [{ type: 'hld' }, { type: 'adr' }] });
    const regenerated = await generate('architecture-generate-002', '"PROJ-ALPHA:5"');
    expect(regenerated.statusCode).toBe(201);
    expect(regenerated.json()).toMatchObject({ project: { rowVersion: 6, status: 'DESIGN_READY' }, baseline: { generation: { version: 2 }, decision: null, artifacts: [] } });
    expect(await database.db.select().from(architectureGenerations)).toHaveLength(2);
    expect(await database.db.select().from(architectureOptionVersions)).toHaveLength(6);
    expect(await database.db.select().from(arbDecisions)).toHaveLength(1);
    expect((await database.db.select().from(projectDocuments)).filter((row) => row.type === 'hld' || row.type === 'adr')).toHaveLength(2);
    expect((await database.db.select().from(auditEvents)).map((row) => row.action)).toEqual(expect.arrayContaining(['ARCHITECTURE_OPTIONS_GENERATED', 'ARCHITECTURE_DECISION_APPROVED']));
  });

  it('requires exact requirement approval, rejects stale option hashes, and enforces tenant and role scope', async () => {
    expect((await generate('architecture-before-requirements', '"PROJ-ALPHA:1"')).statusCode).toBe(422);
    expect((await generate('architecture-viewer', '"PROJ-ALPHA:1"', VIEWER_TOKEN)).statusCode).toBe(403);
    await approveRequirements();
    const generated = (await generate('architecture-generate-stale', '"PROJ-ALPHA:3"')).json<{ baseline: { generation: { id: string; contentHash: string; options: Array<{ id: string; sha256: string }> } } }>();
    const selected = generated.baseline.generation.options[0]!;
    const stale = await app!.inject({ method: 'POST', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/architecture/decisions', headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'idempotency-key': 'architecture-stale-option', 'if-match': '"PROJ-ALPHA:4"' }, payload: { sourceGraphVersion: 1, generationId: generated.baseline.generation.id, generationContentHash: generated.baseline.generation.contentHash, selectedOptionId: selected.id, selectedOptionHash: 'f'.repeat(64), comment: 'This approval must fail because the selected option hash is stale.' } });
    expect(stale.statusCode).toBe(412);
    expect(await database.db.select().from(arbDecisions)).toHaveLength(0);
    const crossTenant = await app!.inject({ method: 'GET', url: '/api/v1/organizations/ORG-BETA/projects/PROJ-ALPHA/architecture/current', headers: { authorization: `Bearer ${OWNER_TOKEN}` } });
    expect(crossTenant.statusCode).toBe(403);
  });

  it('blocks architecture when the current Business Context approval is missing', async () => {
    await database.db.delete(businessContextReviews);
    await database.db.delete(businessContextVersions);
    await approveRequirements();

    const blocked = await generate('architecture-missing-business-context', '"PROJ-ALPHA:3"');

    expect(blocked.statusCode).toBe(422);
    expect(blocked.body).toContain('Generate and approve the exact current Business Context');
    expect(await database.db.select().from(architectureGenerations)).toHaveLength(0);
  });
});
