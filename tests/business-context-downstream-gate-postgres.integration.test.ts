import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseHandle, type DatabaseHandle } from '../src/database/client';
import { businessContextReviews, businessContextVersions, organizations, projectGraphs, projects, users, workspaces } from '../src/database/schema';
import { migrateDatabase } from '../src/database/migrate';
import { compileBusinessContext } from '../src/experience/business-context.compiler';
import { businessContextDownstreamGate } from '../src/experience/postgres-business-context-gate.query';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl === undefined ? describe.skip : describe;

describePostgres('Business Context downstream gate', () => {
  let database: DatabaseHandle;

  async function resetDatabase() {
    await database.pool.query('drop schema if exists public cascade');
    await database.pool.query('drop schema if exists axiom_internal cascade');
    await database.pool.query('create schema public');
    await migrateDatabase(database.db);
    await database.db.insert(organizations).values({ id: 'ORG-ALPHA', slug: 'alpha', name: 'Alpha' });
    await database.db.insert(users).values({ id: 'USER-OWNER', email: 'owner@example.test', displayName: 'Owner' });
    await database.db.insert(workspaces).values({ id: 'WS-ALPHA', organizationId: 'ORG-ALPHA', name: 'Alpha Workspace' });
    await database.db.insert(projects).values({ id: 'PROJ-ALPHA', organizationId: 'ORG-ALPHA', workspaceId: 'WS-ALPHA', name: 'Alpha', status: 'ANALYZED', graphVersion: 1 });
    await database.db.insert(projectGraphs).values({ organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, summary: 'Business Context gate fixture.', analyzer: 'fixture', analyzedAt: '2026-08-04T00:00:00.000Z' });
  }

  async function seedApproved(applicability: 'APPLICABLE' | 'NOT_APPLICABLE') {
    const payload = compileBusinessContext({
      projectId: 'PROJ-ALPHA', graphVersion: 1, analyzedAt: '2026-08-04T00:00:00.000Z', blockingGapIds: [],
      entities: [
        { id: 'OUTCOME-1', category: 'GOAL', text: 'The objective is to improve conversion by 20%.', truthStatus: 'HUMAN_CONFIRMED', sourceId: null },
        { id: 'ACTOR-1', category: 'REQUIREMENT', text: 'Customers submit and review requests.', truthStatus: 'HUMAN_CONFIRMED', sourceId: null },
        { id: 'SCOPE-1', category: 'DECISION', text: applicability === 'APPLICABLE' ? 'Customers use a browser portal screen.' : 'This scope is API-only with no user interface.', truthStatus: 'HUMAN_CONFIRMED', sourceId: null }
      ]
    });
    expect(payload.applicability.status).toBe(applicability);
    expect(payload.unknowns).toHaveLength(0);
    await database.db.insert(businessContextVersions).values({ id: 'BCV-GATE-1', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, version: 1, contentHash: payload.contentHash, compilerVersion: payload.compilerVersion, payload, generatedByUserId: 'USER-OWNER', generatedAt: payload.compiledAt });
    await database.db.insert(businessContextReviews).values({ id: 'BCREV-GATE-1', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, contextVersionId: 'BCV-GATE-1', contextContentHash: payload.contentHash, decision: 'ACCEPT', feedbackCategory: 'MEETS_BUSINESS_INTENT', comment: 'The exact complete Business Context is approved for downstream gate verification.', proposedGraphChanges: [], truthStatus: 'HUMAN_APPROVED', reviewedByUserId: 'USER-OWNER', reviewedAt: payload.compiledAt });
  }

  beforeAll(() => {
    const parsed = new URL(testDatabaseUrl!);
    if (!parsed.pathname.startsWith('/axiom_test')) throw new Error('Business Context gate tests require axiom_test');
    database = createDatabaseHandle(testDatabaseUrl);
  });
  beforeEach(resetDatabase);
  afterAll(async () => database.pool.end());

  it('requires an exact current approval', async () => {
    await expect(businessContextDownstreamGate(database.db, 'ORG-ALPHA', 'PROJ-ALPHA', 1)).resolves.toMatchObject({ allowed: false, applicability: null, reason: expect.stringContaining('Generate and approve') });
  });

  it('allows an explicitly approved non-visual scope', async () => {
    await seedApproved('NOT_APPLICABLE');
    await expect(businessContextDownstreamGate(database.db, 'ORG-ALPHA', 'PROJ-ALPHA', 1)).resolves.toMatchObject({ allowed: true, applicability: 'NOT_APPLICABLE', reason: null });
  });

  it('fails closed for experience scope until an Experience Baseline exists', async () => {
    await seedApproved('APPLICABLE');
    await expect(businessContextDownstreamGate(database.db, 'ORG-ALPHA', 'PROJ-ALPHA', 1)).resolves.toMatchObject({ allowed: false, applicability: 'APPLICABLE', reason: expect.stringContaining('Experience Baseline') });
  });
});
