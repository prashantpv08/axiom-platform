import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseHandle, type DatabaseHandle } from '../src/database/client';
import { migrateDatabase } from '../src/database/migrate';
import {
  arbDecisions,
  auditEvents,
  clarificationQuestions,
  documentApprovals,
  knowledgeEntities,
  memberships,
  organizations,
  projectGaps,
  projectGraphs,
  projects,
  sessions,
  users,
  workspaces
} from '../src/database/schema';
import { hashSessionToken } from '../src/identity/authentication/session-token';
import { createApplication } from '../src/platform/create-application';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl === undefined ? describe.skip : describe;
const OWNER_TOKEN = 'c'.repeat(43);
const VIEWER_TOKEN = 'd'.repeat(43);

describePostgres('PostgreSQL commercial clarification answers', () => {
  let database: DatabaseHandle;
  let app: NestFastifyApplication | undefined;

  async function resetDatabase() {
    await database.pool.query('drop schema if exists public cascade');
    await database.pool.query('drop schema if exists axiom_internal cascade');
    await database.pool.query('create schema public');
    await migrateDatabase(database.db);
  }

  async function seed() {
    await database.db.insert(organizations).values({ id: 'ORG-ALPHA', slug: 'alpha', name: 'Alpha' });
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
    await database.db.insert(projects).values({ id: 'PROJ-ALPHA', organizationId: 'ORG-ALPHA', workspaceId: 'WS-ALPHA', name: 'Alpha Product', status: 'BACKLOG_READY', graphVersion: 1 });
    await database.db.insert(projectGraphs).values({ organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, summary: 'Approved graph', readiness: { score: 80 }, analyzer: 'fixture', analyzedAt: '2026-07-24T00:00:00.000Z' });
    await database.db.insert(projectGaps).values([
      {
        id: 'GAP-SCALE', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, position: 0,
        type: 'UNTESTABLE', category: 'TESTABILITY', title: 'Scale target is untestable',
        description: 'The response-time boundary is missing.', severity: 'HIGH', impactAreas: ['performance'],
        affectedEntityIds: ['REQ-ACCESS'], affectedArtifacts: ['SRS', 'HLD', 'BACKLOG'],
        rationale: 'A measurable boundary is required before implementation.', status: 'OPEN', truthStatus: 'UNKNOWN'
      },
      {
        id: 'GAP-DELIVERY', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, position: 1,
        type: 'MISSING', category: 'DELIVERY', title: 'Delivery preference is unknown',
        description: 'The preferred release cadence is not recorded.', severity: 'MEDIUM', impactAreas: ['delivery'],
        affectedEntityIds: [], affectedArtifacts: ['BACKLOG'], rationale: 'Cadence can improve planning but does not block grounded tickets.',
        status: 'OPEN', truthStatus: 'UNKNOWN'
      }
    ]);
    await database.db.insert(clarificationQuestions).values({
      id: 'CQ-SCALE', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, position: 0,
      gapId: 'GAP-SCALE', question: 'What response-time target must the product meet?',
      whyItMatters: 'The answer defines a measurable verification boundary.', affectedEntityIds: ['REQ-ACCESS'],
      options: [], status: 'OPEN', answer: null, answeredAt: null, truthStatus: 'UNKNOWN'
    });
    await database.db.insert(knowledgeEntities).values({
      id: 'REQ-ACCESS', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, position: 0,
      category: 'REQUIREMENT', text: 'Administrators shall invite organization members.', truthStatus: 'SOURCE_GROUNDED'
    });
    await database.db.insert(documentApprovals).values({ id: 'DOCAPP-ALPHA', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, payload: {}, approvedAt: '2026-07-24T00:00:00.000Z' });
    await database.db.insert(arbDecisions).values({ id: 'ARB-ALPHA', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, version: 1, payload: {}, approvedAt: '2026-07-24T00:00:00.000Z' });
  }

  function answer(answerValue = 'P95 responses must remain below 500 milliseconds.', key = 'clarification-answer-001', ifMatch = '"PROJ-ALPHA:1"', token = OWNER_TOKEN) {
    return app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/clarifications/CQ-SCALE/answer',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key, 'if-match': ifMatch, 'x-request-id': key },
      payload: { answer: answerValue }
    });
  }

  beforeAll(() => {
    const parsed = new URL(testDatabaseUrl!);
    if (!parsed.pathname.startsWith('/axiom_test')) throw new Error('Clarification tests require axiom_test');
    database = createDatabaseHandle(testDatabaseUrl);
  });
  beforeEach(async () => { await resetDatabase(); await seed(); app = await createApplication({ databaseUrl: testDatabaseUrl! }); });
  afterEach(async () => { await app?.close(); app = undefined; });
  afterAll(async () => database.pool.end());

  it('creates one human-confirmed graph version and invalidates downstream eligibility without mutating history', async () => {
    const response = await answer();
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"PROJ-ALPHA:2"');
    expect(response.headers['idempotency-replayed']).toBe('false');
    expect(response.json()).toMatchObject({
      project: { id: 'PROJ-ALPHA', graphVersion: 2, rowVersion: 2, status: 'ANALYZED' },
      clarification: { id: 'CQ-SCALE', gapId: 'GAP-SCALE', status: 'ANSWERED', truthStatus: 'HUMAN_CONFIRMED' },
      previousGraphVersion: 1,
      graphVersion: 2,
      readiness: { score: 92, rawScore: 92, openBlockerIds: [], caps: [] },
      replayed: false
    });
    expect(response.body).not.toContain('P95 responses');

    const oldQuestion = await database.db.select().from(clarificationQuestions).where(and(eq(clarificationQuestions.id, 'CQ-SCALE'), eq(clarificationQuestions.graphVersion, 1)));
    const newQuestion = await database.db.select().from(clarificationQuestions).where(and(eq(clarificationQuestions.id, 'CQ-SCALE'), eq(clarificationQuestions.graphVersion, 2)));
    expect(oldQuestion).toEqual([expect.objectContaining({ status: 'OPEN', answer: null, truthStatus: 'UNKNOWN' })]);
    expect(newQuestion).toEqual([expect.objectContaining({ status: 'ANSWERED', answer: 'P95 responses must remain below 500 milliseconds.', truthStatus: 'HUMAN_CONFIRMED' })]);
    expect(await database.db.select().from(projectGaps).where(and(eq(projectGaps.id, 'GAP-SCALE'), eq(projectGaps.graphVersion, 1)))).toEqual([expect.objectContaining({ status: 'OPEN', truthStatus: 'UNKNOWN' })]);
    expect(await database.db.select().from(projectGaps).where(and(eq(projectGaps.id, 'GAP-SCALE'), eq(projectGaps.graphVersion, 2)))).toEqual([expect.objectContaining({ status: 'ANSWERED', truthStatus: 'HUMAN_CONFIRMED' })]);
    expect(await database.db.select().from(knowledgeEntities).where(and(eq(knowledgeEntities.graphVersion, 2), eq(knowledgeEntities.clarificationQuestionId, 'CQ-SCALE')))).toEqual([
      expect.objectContaining({ category: 'REQUIREMENT', truthStatus: 'HUMAN_CONFIRMED', text: expect.stringContaining('P95 responses must remain below 500 milliseconds.') })
    ]);
    expect(await database.db.select().from(projectGraphs).where(and(eq(projectGraphs.projectId, 'PROJ-ALPHA'), eq(projectGraphs.graphVersion, 2)))).toEqual([
      expect.objectContaining({ readiness: expect.objectContaining({ score: 92, rawScore: 92, categories: expect.any(Array), calculatedAt: expect.any(String) }) })
    ]);
    expect(await database.db.select().from(documentApprovals)).toEqual([expect.objectContaining({ graphVersion: 1 })]);
    expect(await database.db.select().from(arbDecisions)).toEqual([expect.objectContaining({ graphVersion: 1 })]);
    const answerAudit = await database.db.select().from(auditEvents).where(eq(auditEvents.action, 'CLARIFICATION_ANSWERED'));
    expect(answerAudit).toHaveLength(1);
    expect(answerAudit[0]?.metadata).toMatchObject({ previousGraphVersion: 1, graphVersion: 2, answerHash: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    expect(JSON.stringify(answerAudit)).not.toContain('P95 responses');
  });

  it('exposes the persisted current-graph readiness calculation to authorized readers', async () => {
    expect((await answer()).statusCode).toBe(200);
    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/readiness',
      headers: { authorization: `Bearer ${VIEWER_TOKEN}` }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ projectId: 'PROJ-ALPHA', graphVersion: 2, readiness: { score: 92, rawScore: 92, categories: expect.any(Array) } });
    expect(response.json().readiness.categories).toHaveLength(8);
  });

  it('replays an identical answer exactly once and rejects stale or changed requests', async () => {
    expect((await answer()).statusCode).toBe(200);
    const replay = await answer();
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.json()).toMatchObject({ graphVersion: 2, replayed: true });
    expect((await answer('P95 responses must remain below 250 milliseconds.')).statusCode).toBe(409);
    expect((await answer('A different answer.', 'clarification-answer-stale', '"PROJ-ALPHA:1"')).statusCode).toBe(412);
    expect(await database.db.select().from(projectGraphs)).toHaveLength(2);
    expect(await database.db.select().from(auditEvents).where(eq(auditEvents.action, 'CLARIFICATION_ANSWERED'))).toHaveLength(1);
  });

  it('denies viewers and invalid input before mutating the graph', async () => {
    expect((await answer('A valid but unauthorized answer.', 'clarification-answer-viewer', '"PROJ-ALPHA:1"', VIEWER_TOKEN)).statusCode).toBe(403);
    expect((await answer('', 'clarification-answer-empty')).statusCode).toBe(400);
    expect(await database.db.select().from(projectGraphs)).toHaveLength(1);
    expect(await database.db.select().from(auditEvents).where(eq(auditEvents.action, 'CLARIFICATION_ANSWERED'))).toHaveLength(0);
  });
});
