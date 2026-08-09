import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDatabaseHandle, type DatabaseHandle } from '../src/database/client';
import { migrateDatabase } from '../src/database/migrate';
import {
  auditEvents,
  budgetPolicies,
  creditBalances,
  organizations,
  subscriptionWebhookEvents,
  subscriptions
} from '../src/database/schema';
import { createApplication } from '../src/platform/create-application';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl === undefined ? describe.skip : describe;
const secret = 'local-subscription-webhook-secret-at-least-32-bytes';

describePostgres('subscription webhook inbox', () => {
  let database: DatabaseHandle;
  let app: NestFastifyApplication | undefined;

  async function resetDatabase(): Promise<void> {
    await database.pool.query('drop schema if exists public cascade');
    await database.pool.query('drop schema if exists axiom_internal cascade');
    await database.pool.query('create schema public');
    await migrateDatabase(database.db);
  }

  async function seed(): Promise<void> {
    await database.db.insert(organizations).values([
      { id: 'ORG-ALPHA', slug: 'alpha', name: 'Alpha' },
      { id: 'ORG-BETA', slug: 'beta', name: 'Beta' }
    ]);
    await database.db.insert(subscriptions).values({
      id: 'SUB-ALPHA',
      organizationId: 'ORG-ALPHA',
      planId: 'PLAN-LOCAL-DEVELOPMENT',
      status: 'TRIALING',
      billingPeriodStart: '2026-06-01T00:00:00.000Z',
      billingPeriodEnd: '2026-07-01T00:00:00.000Z',
      provider: 'LOCAL_FIXTURE',
      externalCustomerId: 'fixture-customer-alpha',
      externalSubscriptionId: 'fixture-subscription-alpha'
    });
    await database.db.insert(creditBalances).values({
      id: 'BAL-ALPHA-OLD',
      organizationId: 'ORG-ALPHA',
      subscriptionId: 'SUB-ALPHA',
      periodStart: '2026-06-01T00:00:00.000Z',
      periodEnd: '2026-07-01T00:00:00.000Z',
      allocatedCreditUnits: 100_000
    });
    await database.db.insert(budgetPolicies).values({
      id: 'BPOL-ALPHA',
      organizationId: 'ORG-ALPHA',
      dailyCreditLimit: 50_000,
      userDailyCreditLimit: 25_000,
      projectDailyCreditLimit: 40_000,
      alertThresholdPercent: 80
    });
  }

  function payload(overrides: Record<string, unknown> = {}) {
    return {
      externalEventId: 'fixture-event-001',
      eventType: 'SUBSCRIPTION_SNAPSHOT',
      occurredAt: new Date(Date.now() - 1_000).toISOString(),
      organizationId: 'ORG-ALPHA',
      externalCustomerId: 'fixture-customer-alpha',
      externalSubscriptionId: 'fixture-subscription-alpha',
      planCode: 'LOCAL_DEVELOPMENT',
      status: 'ACTIVE',
      billingPeriodStart: '2026-07-01T00:00:00.000Z',
      billingPeriodEnd: '2026-08-01T00:00:00.000Z',
      ...overrides
    };
  }

  function signedRequest(body: unknown, timestamp = Math.floor(Date.now() / 1_000)) {
    const raw = JSON.stringify(body);
    const digest = createHmac('sha256', secret).update(`${timestamp}.${raw}`, 'utf8').digest('hex');
    return app!.inject({
      method: 'POST',
      url: '/api/v1/webhooks/subscriptions/local-fixture',
      headers: {
        'content-type': 'application/json',
        'x-axiom-subscription-signature': `t=${timestamp},v1=${digest}`
      },
      payload: raw
    });
  }

  beforeAll(() => {
    const parsed = new URL(testDatabaseUrl!);
    if (!parsed.pathname.startsWith('/axiom_test')) throw new Error('Webhook integration tests require the axiom_test database');
    vi.stubEnv('AXIOM_LOCAL_SUBSCRIPTION_WEBHOOK_ENABLED', 'true');
    vi.stubEnv('AXIOM_LOCAL_SUBSCRIPTION_WEBHOOK_SECRET', secret);
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

  afterAll(async () => {
    vi.unstubAllEnvs();
    await database.pool.end();
  });

  it('authenticates, applies, audits, and replays an identical provider snapshot once', async () => {
    const event = payload();
    const first = await signedRequest(event);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ externalEventId: 'fixture-event-001', outcome: 'PROCESSED', subscriptionId: 'SUB-ALPHA', subscriptionRowVersion: 2, replayed: false });

    const replay = await signedRequest(event);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ webhookEventId: first.json().webhookEventId, replayed: true });

    const [subscription] = await database.db.select().from(subscriptions).where(eq(subscriptions.id, 'SUB-ALPHA'));
    expect(subscription).toMatchObject({ status: 'ACTIVE', providerEventId: 'fixture-event-001', rowVersion: 2 });
    expect(new Date(subscription!.billingPeriodStart).toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(new Date(subscription!.billingPeriodEnd).toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(await database.db.select().from(creditBalances).where(and(eq(creditBalances.subscriptionId, 'SUB-ALPHA'), eq(creditBalances.periodStart, '2026-07-01T00:00:00.000Z')))).toHaveLength(1);
    const [stored] = await database.db.select().from(subscriptionWebhookEvents);
    expect(stored).toMatchObject({ status: 'PROCESSED', attemptCount: 1, lastErrorCode: null });
    expect(await database.db.select().from(auditEvents).where(eq(auditEvents.action, 'SUBSCRIPTION_WEBHOOK_PROCESSED'))).toHaveLength(1);
  });

  it('rejects invalid, stale, and event-ID-conflicting signatures without duplicate effects', async () => {
    const invalid = await app!.inject({ method: 'POST', url: '/api/v1/webhooks/subscriptions/local-fixture', headers: { 'content-type': 'application/json', 'x-axiom-subscription-signature': `t=${Math.floor(Date.now() / 1_000)},v1=${'0'.repeat(64)}` }, payload: JSON.stringify(payload()) });
    expect(invalid.statusCode).toBe(401);
    const stale = await signedRequest(payload(), Math.floor(Date.now() / 1_000) - 301);
    expect(stale.statusCode).toBe(401);
    expect(await database.db.select().from(subscriptionWebhookEvents)).toHaveLength(0);

    const first = await signedRequest(payload());
    expect(first.statusCode).toBe(200);
    const conflict = await signedRequest(payload({ status: 'PAST_DUE' }));
    expect(conflict.statusCode).toBe(409);
    const [subscription] = await database.db.select().from(subscriptions).where(eq(subscriptions.id, 'SUB-ALPHA'));
    expect(subscription).toMatchObject({ status: 'ACTIVE', rowVersion: 2 });
  });

  it('serializes concurrent duplicates and ignores an older provider snapshot', async () => {
    const event = payload({ externalEventId: 'fixture-event-concurrent' });
    const concurrent = await Promise.all([signedRequest(event), signedRequest(event)]);
    expect(concurrent.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(concurrent.map((response) => response.json().replayed).sort()).toEqual([false, true]);

    const [afterConcurrent] = await database.db.select().from(subscriptions).where(eq(subscriptions.id, 'SUB-ALPHA'));
    const staleEvent = payload({
      externalEventId: 'fixture-event-older',
      occurredAt: new Date(new Date(afterConcurrent!.providerUpdatedAt!).getTime() - 1_000).toISOString(),
      status: 'PAST_DUE'
    });
    const ignored = await signedRequest(staleEvent);
    expect(ignored.statusCode).toBe(200);
    expect(ignored.json()).toMatchObject({ outcome: 'IGNORED', replayed: false, subscriptionRowVersion: 2 });
    const [afterIgnored] = await database.db.select().from(subscriptions).where(eq(subscriptions.id, 'SUB-ALPHA'));
    expect(afterIgnored).toMatchObject({ status: 'ACTIVE', rowVersion: 2, providerEventId: 'fixture-event-concurrent' });
  });

  it('fails closed within tenant scope and records each safe retry without exposing another subscription', async () => {
    const crossTenant = payload({ externalEventId: 'fixture-event-cross-tenant', organizationId: 'ORG-BETA' });
    const first = await signedRequest(crossTenant);
    const retry = await signedRequest(crossTenant);
    expect(first.statusCode).toBe(422);
    expect(retry.statusCode).toBe(422);
    expect(first.body).not.toContain('SUB-ALPHA');
    const [stored] = await database.db.select().from(subscriptionWebhookEvents).where(eq(subscriptionWebhookEvents.externalEventId, 'fixture-event-cross-tenant'));
    expect(stored).toMatchObject({ organizationId: 'ORG-BETA', status: 'FAILED', attemptCount: 2, lastErrorCode: 'SUBSCRIPTION_NOT_FOUND' });
    const alpha = await database.db.select().from(subscriptions).where(eq(subscriptions.organizationId, 'ORG-ALPHA'));
    expect(alpha[0]).toMatchObject({ status: 'TRIALING', rowVersion: 1 });
    expect(await database.db.select().from(auditEvents).where(and(eq(auditEvents.organizationId, 'ORG-BETA'), eq(auditEvents.action, 'SUBSCRIPTION_WEBHOOK_FAILED')))).toHaveLength(2);
  });

  it('provides a guarded executable rollback before webhook evidence exists', async () => {
    await app!.close();
    app = undefined;
    const downSql = await readFile(resolve('drizzle/0011_subscription_webhook_inbox.down.sql'), 'utf8');
    await database.pool.query(downSql);
    const result = await database.pool.query<{ table_name: string | null }>("select to_regclass('public.subscription_webhook_events')::text as table_name");
    expect(result.rows[0]?.table_name).toBeNull();
  });
});
