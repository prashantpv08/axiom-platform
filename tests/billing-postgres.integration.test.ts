import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BillingService } from '../src/billing/billing.service';
import { createDatabaseHandle, type DatabaseHandle } from '../src/database/client';
import { migrateDatabase } from '../src/database/migrate';
import {
  auditEvents,
  budgetPolicies,
  creditBalances,
  memberships,
  organizations,
  planEntitlements,
  projects,
  sessions,
  subscriptions,
  usageLedgerEntries,
  usageReservations,
  users,
  workspaces
} from '../src/database/schema';
import { hashSessionToken } from '../src/identity/authentication/session-token';
import { createApplication } from '../src/platform/create-application';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl === undefined ? describe.skip : describe;
const ALPHA_TOKEN = 'a'.repeat(43);
const BETA_TOKEN = 'b'.repeat(43);
const alphaContext = { organizationId: 'ORG-ALPHA', userId: 'USER-ALPHA', sessionId: 'SESSION-ALPHA', role: 'OWNER' as const };
const alphaSecondUserContext = { organizationId: 'ORG-ALPHA', userId: 'USER-ALPHA-TWO', sessionId: 'SESSION-ALPHA-TWO', role: 'PRODUCT_ANALYST' as const };

describePostgres('PostgreSQL cost governance', () => {
  let database: DatabaseHandle;
  let app: NestFastifyApplication | undefined;
  let billing: BillingService;

  async function resetDatabase(): Promise<void> {
    await database.pool.query('drop schema if exists public cascade');
    await database.pool.query('drop schema if exists axiom_internal cascade');
    await database.pool.query('create schema public');
    await migrateDatabase(database.db);
  }

  async function seedBilling(): Promise<void> {
    await database.db.insert(organizations).values([
      { id: 'ORG-ALPHA', slug: 'alpha', name: 'Alpha' },
      { id: 'ORG-BETA', slug: 'beta', name: 'Beta' }
    ]);
    await database.db.insert(users).values([
      { id: 'USER-ALPHA', email: 'alpha@example.test', displayName: 'Alpha Owner' },
      { id: 'USER-ALPHA-TWO', email: 'alpha-two@example.test', displayName: 'Alpha Analyst' },
      { id: 'USER-BETA', email: 'beta@example.test', displayName: 'Beta Viewer' }
    ]);
    await database.db.insert(memberships).values([
      { organizationId: 'ORG-ALPHA', userId: 'USER-ALPHA', role: 'OWNER' },
      { organizationId: 'ORG-ALPHA', userId: 'USER-ALPHA-TWO', role: 'PRODUCT_ANALYST' },
      { organizationId: 'ORG-BETA', userId: 'USER-BETA', role: 'VIEWER' }
    ]);
    await database.db.insert(sessions).values([
      { id: 'SESSION-ALPHA', userId: 'USER-ALPHA', tokenHash: hashSessionToken(ALPHA_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' },
      { id: 'SESSION-BETA', userId: 'USER-BETA', tokenHash: hashSessionToken(BETA_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' }
    ]);
    for (const [key, integerLimit] of [['MAX_CREDITS_PER_REQUEST', 70], ['MAX_DAILY_CREDITS', 100], ['MAX_USER_DAILY_CREDITS', 70], ['MAX_PROJECT_DAILY_CREDITS', 80]] as const) {
      await database.db.update(planEntitlements).set({ integerLimit })
        .where(and(eq(planEntitlements.planId, 'PLAN-LOCAL-DEVELOPMENT'), eq(planEntitlements.key, key)));
    }
    await database.db.insert(subscriptions).values([
      { id: 'SUB-ALPHA', organizationId: 'ORG-ALPHA', planId: 'PLAN-LOCAL-DEVELOPMENT', status: 'ACTIVE', billingPeriodStart: '2020-01-01T00:00:00.000Z', billingPeriodEnd: '2099-01-01T00:00:00.000Z' },
      { id: 'SUB-BETA', organizationId: 'ORG-BETA', planId: 'PLAN-LOCAL-DEVELOPMENT', status: 'ACTIVE', billingPeriodStart: '2020-01-01T00:00:00.000Z', billingPeriodEnd: '2099-01-01T00:00:00.000Z' }
    ]);
    await database.db.insert(creditBalances).values([
      { id: 'BAL-ALPHA', organizationId: 'ORG-ALPHA', subscriptionId: 'SUB-ALPHA', periodStart: '2020-01-01T00:00:00.000Z', periodEnd: '2099-01-01T00:00:00.000Z', allocatedCreditUnits: 100, alertThresholdPercent: 80 },
      { id: 'BAL-BETA', organizationId: 'ORG-BETA', subscriptionId: 'SUB-BETA', periodStart: '2020-01-01T00:00:00.000Z', periodEnd: '2099-01-01T00:00:00.000Z', allocatedCreditUnits: 100, alertThresholdPercent: 80 }
    ]);
    await database.db.insert(budgetPolicies).values([
      { id: 'BPOL-ALPHA', organizationId: 'ORG-ALPHA', dailyCreditLimit: 100, userDailyCreditLimit: 70, projectDailyCreditLimit: 80, alertThresholdPercent: 80 },
      { id: 'BPOL-BETA', organizationId: 'ORG-BETA', dailyCreditLimit: 100, userDailyCreditLimit: 70, projectDailyCreditLimit: 80, alertThresholdPercent: 80 }
    ]);
    await database.db.insert(workspaces).values({ id: 'WS-ALPHA', organizationId: 'ORG-ALPHA', name: 'Alpha Workspace' });
    await database.db.insert(projects).values([
      { id: 'PROJ-ALPHA-ONE', organizationId: 'ORG-ALPHA', workspaceId: 'WS-ALPHA', name: 'Alpha One', status: 'ANALYZED', graphVersion: 1 },
      { id: 'PROJ-ALPHA-TWO', organizationId: 'ORG-ALPHA', workspaceId: 'WS-ALPHA', name: 'Alpha Two', status: 'ANALYZED', graphVersion: 1 }
    ]);
  }

  function reservation(key: string, estimatedCreditUnits = 60) {
    return billing.reserveUsage(alphaContext, {
      projectId: null,
      workflow: 'ticket-generation',
      workflowVersion: 'v1',
      provider: 'fixture-provider',
      model: 'fixture-model',
      generationId: null,
      runId: `run-${key}`,
      estimatedCreditUnits,
      expiresInSeconds: 3600,
      idempotencyKey: key
    }, `request-${key}`);
  }

  function scopedReservation(
    context: typeof alphaContext | typeof alphaSecondUserContext,
    key: string,
    estimatedCreditUnits: number,
    projectId: 'PROJ-ALPHA-ONE' | 'PROJ-ALPHA-TWO'
  ) {
    return billing.reserveUsage(context, {
      projectId,
      workflow: 'ticket-generation',
      workflowVersion: 'v1',
      provider: 'fixture-provider',
      model: 'fixture-model',
      generationId: null,
      runId: `run-${key}`,
      estimatedCreditUnits,
      expiresInSeconds: 3600,
      idempotencyKey: key
    }, `request-${key}`);
  }

  beforeAll(() => {
    const parsed = new URL(testDatabaseUrl!);
    if (!parsed.pathname.startsWith('/axiom_test')) throw new Error('Billing integration tests require the axiom_test database');
    database = createDatabaseHandle(testDatabaseUrl);
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedBilling();
    app = await createApplication({ databaseUrl: testDatabaseUrl! });
    billing = app.get(BillingService);
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  afterAll(async () => {
    await database.pool.end();
  });

  it('returns only an owner or administrator organization billing overview', async () => {
    const allowed = await app!.inject({ method: 'GET', url: '/api/v1/organizations/ORG-ALPHA/billing/overview', headers: { authorization: `Bearer ${ALPHA_TOKEN}` } });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers['cache-control']).toBe('no-store');
    expect(allowed.json()).toMatchObject({
      plan: { code: 'LOCAL_DEVELOPMENT' },
      entitlements: {
        aiUsageEnabled: true,
        maxCreditsPerRequest: 70,
        maxDailyCredits: 100,
        maxUserDailyCredits: 70,
        maxProjectDailyCredits: 80
      },
      policy: {
        id: 'BPOL-ALPHA',
        dailyCreditLimit: 100,
        userDailyCreditLimit: 70,
        projectDailyCreditLimit: 80,
        alertThresholdPercent: 80,
        rowVersion: 1
      },
      balance: { allocatedCreditUnits: 100, remainingCreditUnits: 100, status: 'AVAILABLE' },
      dailyUsage: { committedCreditUnits: 0, remainingCreditUnits: 100 },
      expiredReservations: { count: 0, reservedCreditUnits: 0 },
      recentUsage: []
    });

    const crossTenant = await app!.inject({ method: 'GET', url: '/api/v1/organizations/ORG-BETA/billing/overview', headers: { authorization: `Bearer ${ALPHA_TOKEN}` } });
    expect(crossTenant.statusCode).toBe(403);
    expect(crossTenant.body).not.toContain('BAL-BETA');
    const viewer = await app!.inject({ method: 'GET', url: '/api/v1/organizations/ORG-BETA/billing/overview', headers: { authorization: `Bearer ${BETA_TOKEN}` } });
    expect(viewer.statusCode).toBe(403);
  });

  it('reserves before work and reconciles measured usage without changing measurements', async () => {
    const reserved = await reservation('reserve-reconcile-001');
    expect(reserved).toMatchObject({ status: 'RESERVED', estimatedCreditUnits: 60, actualCreditUnits: null, replayed: false });

    const reconciled = await billing.reconcileUsage(alphaContext, {
      reservationId: reserved.id,
      actualCreditUnits: 35,
      inputTokens: 1234,
      outputTokens: 321,
      toolChargeMicros: 17,
      providerCostMicros: 456,
      currency: 'USD',
      outcome: 'SUCCEEDED',
      retryCount: 1,
      fallbackUsed: true,
      cacheHit: false
    }, 'request-reconcile-001');
    expect(reconciled).toMatchObject({ status: 'RECONCILED', actualCreditUnits: 35, outcome: 'SUCCEEDED', replayed: false });

    const [balance] = await database.db.select().from(creditBalances).where(eq(creditBalances.id, 'BAL-ALPHA'));
    expect(balance).toMatchObject({ reservedCreditUnits: 0, consumedCreditUnits: 35, rowVersion: 3 });
    const ledger = await database.db.select().from(usageLedgerEntries).where(eq(usageLedgerEntries.reservationId, reserved.id));
    expect(ledger).toHaveLength(2);
    expect(ledger.find((entry) => entry.eventType === 'RECONCILIATION')).toMatchObject({
      chargedCreditUnits: 35,
      releasedCreditUnits: 25,
      inputTokens: 1234,
      outputTokens: 321,
      toolChargeMicros: 17,
      providerCostMicros: 456,
      outcome: 'SUCCEEDED',
      retryCount: 1,
      fallbackUsed: true,
      cacheHit: false
    });
    const audits = await database.db.select().from(auditEvents).where(eq(auditEvents.targetId, reserved.id));
    expect(audits.map((event) => event.action)).toEqual(['USAGE_RESERVED', 'USAGE_RECONCILED']);
    await expect(database.pool.query(`update usage_ledger_entries set charged_credit_units = 0 where reservation_id = '${reserved.id}'`))
      .rejects.toThrow(/usage ledger entries are immutable/u);
  });

  it('replays identical reservation and reconciliation requests but rejects changed retries', async () => {
    const first = await reservation('idempotent-usage-001', 20);
    await expect(reservation('idempotent-usage-001', 20)).resolves.toMatchObject({ id: first.id, replayed: true });
    await expect(reservation('idempotent-usage-001', 21)).rejects.toMatchObject({ status: 409 });

    const measurements = { reservationId: first.id, actualCreditUnits: 10, inputTokens: 10, outputTokens: 5, toolChargeMicros: 0, providerCostMicros: 3, currency: 'USD', outcome: 'SUCCEEDED' as const, retryCount: 0, fallbackUsed: false, cacheHit: false };
    await expect(billing.reconcileUsage(alphaContext, measurements, 'reconcile-first')).resolves.toMatchObject({ replayed: false });
    await expect(billing.reconcileUsage(alphaContext, measurements, 'reconcile-retry')).resolves.toMatchObject({ replayed: true });
    await expect(billing.reconcileUsage(alphaContext, { ...measurements, inputTokens: 11 }, 'reconcile-changed')).rejects.toMatchObject({ status: 409 });
  });

  it('enforces request, organization, and reservation hard limits transactionally', async () => {
    await expect(reservation('request-too-large', 71)).rejects.toMatchObject({ status: 402 });

    const concurrent = await Promise.allSettled([
      reservation('concurrent-one', 60),
      reservation('concurrent-two', 60)
    ]);
    expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const [balance] = await database.db.select().from(creditBalances).where(eq(creditBalances.id, 'BAL-ALPHA'));
    expect(balance?.reservedCreditUnits).toBe(60);

    const stored = await database.db.select().from(usageReservations).where(eq(usageReservations.organizationId, 'ORG-ALPHA'));
    const approved = stored[0]!;
    await expect(billing.reconcileUsage(alphaContext, {
      reservationId: approved.id,
      actualCreditUnits: 61,
      inputTokens: 0,
      outputTokens: 0,
      toolChargeMicros: 0,
      providerCostMicros: 0,
      currency: 'USD',
      outcome: 'FAILED',
      retryCount: 0,
      fallbackUsed: false,
      cacheHit: false
    }, 'over-reservation')).rejects.toMatchObject({ status: 409 });
    const [unchanged] = await database.db.select().from(creditBalances).where(eq(creditBalances.id, 'BAL-ALPHA'));
    expect(unchanged).toMatchObject({ reservedCreditUnits: 60, consumedCreditUnits: 0 });
  });

  it('enforces organization, user, and project daily limits on the serialized balance row', async () => {
    await expect(scopedReservation(alphaContext, 'scoped-owner-one', 60, 'PROJ-ALPHA-ONE'))
      .resolves.toMatchObject({ status: 'RESERVED', estimatedCreditUnits: 60 });
    await expect(scopedReservation(alphaContext, 'scoped-owner-user-limit', 11, 'PROJ-ALPHA-TWO'))
      .rejects.toMatchObject({ status: 402 });
    await expect(scopedReservation(alphaSecondUserContext, 'scoped-project-limit', 21, 'PROJ-ALPHA-ONE'))
      .rejects.toMatchObject({ status: 402 });
    await expect(scopedReservation(alphaSecondUserContext, 'scoped-second-project', 40, 'PROJ-ALPHA-TWO'))
      .resolves.toMatchObject({ status: 'RESERVED', estimatedCreditUnits: 40 });
    await expect(scopedReservation(alphaSecondUserContext, 'scoped-organization-limit', 1, 'PROJ-ALPHA-TWO'))
      .rejects.toMatchObject({ status: 402 });

    const stored = await database.db.select().from(usageReservations)
      .where(eq(usageReservations.organizationId, 'ORG-ALPHA'));
    expect(stored).toHaveLength(2);
  });

  it('updates a budget policy with optimistic concurrency, idempotency, plan ceilings, and audit evidence', async () => {
    const request = {
      dailyCreditLimit: 90,
      userDailyCreditLimit: 40,
      projectDailyCreditLimit: 50,
      alertThresholdPercent: 75
    };
    const headers = {
      authorization: `Bearer ${ALPHA_TOKEN}`,
      'if-match': '"BPOL-ALPHA:1"',
      'idempotency-key': 'policy-update-alpha-001',
      'x-request-id': 'policy-update-request-001'
    };
    const first = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/billing/policy/BPOL-ALPHA',
      headers,
      payload: request
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers.etag).toBe('"BPOL-ALPHA:2"');
    expect(first.headers['idempotency-replayed']).toBe('false');
    expect(first.json()).toMatchObject({ ...request, rowVersion: 2, replayed: false });

    const replay = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/billing/policy/BPOL-ALPHA',
      headers,
      payload: request
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.json()).toMatchObject({ ...request, rowVersion: 2, replayed: true });

    const changedRetry = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/billing/policy/BPOL-ALPHA',
      headers,
      payload: { ...request, alertThresholdPercent: 76 }
    });
    expect(changedRetry.statusCode).toBe(409);

    const stale = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/billing/policy/BPOL-ALPHA',
      headers: { ...headers, 'idempotency-key': 'policy-update-alpha-002' },
      payload: request
    });
    expect(stale.statusCode).toBe(412);

    const abovePlan = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/billing/policy/BPOL-ALPHA',
      headers: {
        ...headers,
        'if-match': '"BPOL-ALPHA:2"',
        'idempotency-key': 'policy-update-alpha-003'
      },
      payload: { ...request, dailyCreditLimit: 101 }
    });
    expect(abovePlan.statusCode).toBe(400);

    const audits = await database.db.select().from(auditEvents)
      .where(eq(auditEvents.targetId, 'BPOL-ALPHA'));
    expect(audits.map((event) => event.action)).toEqual(['BUDGET_POLICY_UPDATED']);
  });

  it('releases expired reservations with immutable evidence and rejects late reconciliation', async () => {
    const reserved = await reservation('expire-reservation-001', 60);
    await database.db.update(usageReservations)
      .set({ expiresAt: '2020-01-01T00:00:00.000Z' })
      .where(eq(usageReservations.id, reserved.id));

    await expect(billing.reconcileUsage(alphaContext, {
      reservationId: reserved.id,
      actualCreditUnits: 1,
      inputTokens: 1,
      outputTokens: 0,
      toolChargeMicros: 0,
      providerCostMicros: 0,
      currency: 'USD',
      outcome: 'SUCCEEDED',
      retryCount: 0,
      fallbackUsed: false,
      cacheHit: false
    }, 'late-before-recovery')).rejects.toMatchObject({ status: 409 });

    const before = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-ALPHA/billing/overview',
      headers: { authorization: `Bearer ${ALPHA_TOKEN}` }
    });
    expect(before.json()).toMatchObject({ expiredReservations: { count: 1, reservedCreditUnits: 60 } });

    const recovered = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/billing/reservations/recover-expired',
      headers: { authorization: `Bearer ${ALPHA_TOKEN}`, 'x-request-id': 'recover-expired-001' }
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toEqual({ releasedReservations: 1, releasedCreditUnits: 60 });

    const retried = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/billing/reservations/recover-expired',
      headers: { authorization: `Bearer ${ALPHA_TOKEN}`, 'x-request-id': 'recover-expired-002' }
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toEqual({ releasedReservations: 0, releasedCreditUnits: 0 });

    const [expired] = await database.db.select().from(usageReservations)
      .where(eq(usageReservations.id, reserved.id));
    expect(expired).toMatchObject({ status: 'EXPIRED', actualCreditUnits: 0, outcome: 'CANCELLED' });
    const [balance] = await database.db.select().from(creditBalances)
      .where(eq(creditBalances.id, 'BAL-ALPHA'));
    expect(balance).toMatchObject({ reservedCreditUnits: 0, consumedCreditUnits: 0 });
    const ledger = await database.db.select().from(usageLedgerEntries)
      .where(eq(usageLedgerEntries.reservationId, reserved.id));
    expect(ledger.map((entry) => entry.eventType)).toEqual(['RESERVATION', 'EXPIRATION']);

    await expect(billing.reconcileUsage(alphaContext, {
      reservationId: reserved.id,
      actualCreditUnits: 1,
      inputTokens: 1,
      outputTokens: 0,
      toolChargeMicros: 0,
      providerCostMicros: 0,
      currency: 'USD',
      outcome: 'SUCCEEDED',
      retryCount: 0,
      fallbackUsed: false,
      cacheHit: false
    }, 'late-reconciliation')).rejects.toMatchObject({ status: 409 });
  });

  it('provides a guarded executable rollback', async () => {
    await app!.close();
    app = undefined;
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
    const downSql = await readFile(resolve('drizzle/0009_cost_governance.down.sql'), 'utf8');
    await database.pool.query(downSql);
    const result = await database.pool.query<{ table_name: string | null }>("select to_regclass('public.usage_ledger_entries')::text as table_name");
    expect(result.rows[0]?.table_name).toBeNull();
  });
});
