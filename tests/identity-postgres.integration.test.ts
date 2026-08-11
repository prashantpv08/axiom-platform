import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseHandle, type DatabaseHandle } from '../src/database/client';
import { migrateDatabase } from '../src/database/migrate';
import { auditEvents, memberships, organizations, sessions, users } from '../src/database/schema';
import { hashSessionToken } from '../src/identity/authentication/session-token';
import { createApplication } from '../src/platform/create-application';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl === undefined ? describe.skip : describe;
const USER_A_TOKEN = 'a'.repeat(43);
const USER_B_TOKEN = 'b'.repeat(43);

describePostgres('PostgreSQL identity and organization boundary', () => {
  let database: DatabaseHandle;
  let app: NestFastifyApplication | undefined;

  async function resetDatabase(): Promise<void> {
    await database.pool.query('drop schema if exists public cascade');
    await database.pool.query('drop schema if exists axiom_internal cascade');
    await database.pool.query('create schema public');
    await migrateDatabase(database.db);
  }

  async function seedIdentity(): Promise<void> {
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
  }

  beforeAll(() => {
    const parsed = new URL(testDatabaseUrl!);
    if (!parsed.pathname.startsWith('/axiom_test')) {
      throw new Error('Identity integration tests require a dedicated axiom_test database');
    }
    database = createDatabaseHandle(testDatabaseUrl);
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedIdentity();
    app = await createApplication({ databaseUrl: testDatabaseUrl! });
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  afterAll(async () => {
    await database.pool.end();
  });

  it('authenticates an active member, returns only their organization, and writes immutable audit evidence', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-ALPHA',
      headers: {
        authorization: `Bearer ${USER_A_TOKEN}`,
        'x-request-id': 'identity-allowed-001'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      id: 'ORG-ALPHA',
      slug: 'alpha',
      name: 'Alpha',
      status: 'ACTIVE',
      role: 'OWNER'
    });

    const [event] = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, 'identity-allowed-001'))
      .limit(1);
    expect(event).toMatchObject({
      organizationId: 'ORG-ALPHA',
      actorUserId: 'USER-ALPHA',
      action: 'ORGANIZATION_VIEWED',
      targetId: 'ORG-ALPHA',
      metadata: { sessionId: 'SESSION-ALPHA' }
    });

    await expect(
      database.pool.query("update audit_events set action = 'ALTERED' where request_id = 'identity-allowed-001'")
    ).rejects.toThrow(/audit events are immutable/u);
    await expect(
      database.pool.query("delete from audit_events where request_id = 'identity-allowed-001'")
    ).rejects.toThrow(/audit events are immutable/u);
  });

  it('fails closed when a valid user requests another organization', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-BETA',
      headers: {
        authorization: `Bearer ${USER_A_TOKEN}`,
        'x-request-id': 'identity-cross-tenant-001'
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Organization access is denied',
        requestId: 'identity-cross-tenant-001',
        retryable: false
      }
    });
    expect(response.body).not.toContain('Beta');
  });

  it('lists only the current user organizations and audits the bootstrap', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/me/organizations',
      headers: {
        cookie: `__Host-axiom=${USER_A_TOKEN}`,
        'x-request-id': 'identity-bootstrap-001'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      organizations: [
        {
          id: 'ORG-ALPHA',
          slug: 'alpha',
          name: 'Alpha',
          status: 'ACTIVE',
          role: 'OWNER'
        }
      ]
    });
    expect(response.body).not.toContain('Beta');

    const [event] = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, 'identity-bootstrap-001'))
      .limit(1);
    expect(event).toMatchObject({
      organizationId: 'ORG-ALPHA',
      actorUserId: 'USER-ALPHA',
      action: 'CURRENT_USER_ORGANIZATIONS_LISTED',
      targetType: 'User',
      targetId: 'USER-ALPHA'
    });
  });

  it('rejects missing, expired, and revoked sessions', async () => {
    const missing = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-ALPHA',
      headers: { 'x-request-id': 'identity-missing-001' }
    });
    expect(missing.statusCode).toBe(401);

    await database.db
      .update(sessions)
      .set({ status: 'REVOKED', revokedAt: new Date().toISOString() })
      .where(eq(sessions.id, 'SESSION-ALPHA'));
    const revoked = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-ALPHA',
      headers: { authorization: `Bearer ${USER_A_TOKEN}`, 'x-request-id': 'identity-revoked-001' }
    });
    expect(revoked.statusCode).toBe(401);

    await database.db
      .update(sessions)
      .set({ status: 'ACTIVE', revokedAt: null, expiresAt: '2020-01-01T00:00:00.000Z' })
      .where(eq(sessions.id, 'SESSION-ALPHA'));
    const expired = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-ALPHA',
      headers: { cookie: `__Host-axiom=${USER_A_TOKEN}`, 'x-request-id': 'identity-expired-001' }
    });
    expect(expired.statusCode).toBe(401);
  });

  it('provides an executable rollback for the identity tables', async () => {
    await app!.close();
    app = undefined;
    const applicabilityDecisionDownSql = await readFile(resolve('drizzle/0020_experience_applicability_decisions.down.sql'), 'utf8');
    await database.pool.query(applicabilityDecisionDownSql);
    const businessContextDownSql = await readFile(resolve('drizzle/0019_business_context_versions.down.sql'), 'utf8');
    await database.pool.query(businessContextDownSql);
    const sourceAnalysisDownSql = await readFile(resolve('drizzle/0016_source_analysis_runs.down.sql'), 'utf8');
    await database.pool.query(sourceAnalysisDownSql);
    const architectureDownSql = await readFile(resolve('drizzle/0015_architecture_generations.down.sql'), 'utf8');
    await database.pool.query(architectureDownSql);
    const hostedCandidatesDownSql = await readFile(resolve('drizzle/0017_hosted_model_candidates.down.sql'), 'utf8');
    await database.pool.query(hostedCandidatesDownSql);
    const engineeringPlanDownSql = await readFile(resolve('drizzle/0018_engineering_plans.down.sql'), 'utf8');
    await database.pool.query(engineeringPlanDownSql);
    const agentKernelDownSql = await readFile(resolve('drizzle/0013_agent_kernel_runs.down.sql'), 'utf8');
    await database.pool.query(agentKernelDownSql);
    const modelCatalogDownSql = await readFile(resolve('drizzle/0012_model_catalog.down.sql'), 'utf8');
    await database.pool.query(modelCatalogDownSql);
    const subscriptionWebhookDownSql = await readFile(resolve('drizzle/0011_subscription_webhook_inbox.down.sql'), 'utf8');
    await database.pool.query(subscriptionWebhookDownSql);
    const scopedBudgetDownSql = await readFile(resolve('drizzle/0010_scoped_budget_controls.down.sql'), 'utf8');
    await database.pool.query(scopedBudgetDownSql);
    const billingDownSql = await readFile(resolve('drizzle/0009_cost_governance.down.sql'), 'utf8');
    await database.pool.query(billingDownSql);
    const workItemReviewScopeDownSql = await readFile(resolve('drizzle/0008_work_item_review_tenant_scope.down.sql'), 'utf8');
    await database.pool.query(workItemReviewScopeDownSql);
    const workItemReviewsDownSql = await readFile(resolve('drizzle/0007_work_item_human_review.down.sql'), 'utf8');
    await database.pool.query(workItemReviewsDownSql);
    const workItemsDownSql = await readFile(resolve('drizzle/0006_work_item_versions.down.sql'), 'utf8');
    await database.pool.query(workItemsDownSql);
    const governanceDownSql = await readFile(resolve('drizzle/0005_organization_invitations.down.sql'), 'utf8');
    await database.pool.query(governanceDownSql);
    const downSql = await readFile(resolve('drizzle/0003_identity_guardian.down.sql'), 'utf8');
    await database.pool.query(downSql);

    const result = await database.pool.query<{ table_name: string | null }>(
      "select to_regclass('public.audit_events')::text as table_name"
    );
    expect(result.rows[0]?.table_name).toBeNull();
  });
});
