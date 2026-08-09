import { randomUUID } from 'node:crypto';

import { and, eq, inArray, lte } from 'drizzle-orm';

import { createDatabaseHandle, databaseUrl } from '../src/database/client';
import { auditEvents, budgetPolicies, creditBalances, organizations, planEntitlements, plans, subscriptions } from '../src/database/schema';
import { OrganizationIdSchema } from '../src/identity/identity.schema';

const LOCAL_ORGANIZATION_ID = OrganizationIdSchema.parse(
  process.env.AXIOM_LOCAL_ORGANIZATION_ID ?? 'ORG-LOCAL-DEVELOPMENT'
);
const LOCAL_PLAN_ID = 'PLAN-LOCAL-DEVELOPMENT';
const LOCAL_PROVIDER = 'LOCAL_FIXTURE';
const LOCAL_EXTERNAL_CUSTOMER_ID = `fixture-customer-${LOCAL_ORGANIZATION_ID}`;
const LOCAL_EXTERNAL_SUBSCRIPTION_ID = `fixture-subscription-${LOCAL_ORGANIZATION_ID}`;

function requireLocalDatabase(url: string): void {
  const parsed = new URL(url);
  const localHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  const permittedDatabase = parsed.pathname === '/axiom' || parsed.pathname.startsWith('/axiom_test');
  if (!localHost || !permittedDatabase) {
    throw new Error('Local billing provisioning is restricted to localhost axiom databases');
  }
}

async function main(): Promise<void> {
  const url = databaseUrl();
  requireLocalDatabase(url);
  const handle = createDatabaseHandle(url);
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const periodKey = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  let subscriptionId = `SUB-LOCAL-${periodKey}`;
  const balanceId = `BAL-LOCAL-${periodKey}`;

  try {
    await handle.db.transaction(async (transaction) => {
      const [[organization], [plan]] = await Promise.all([
        transaction.select({ id: organizations.id }).from(organizations)
          .where(and(eq(organizations.id, LOCAL_ORGANIZATION_ID), eq(organizations.status, 'ACTIVE'))).limit(1),
        transaction.select({ id: plans.id, credits: plans.billingPeriodCreditUnits }).from(plans)
          .where(and(eq(plans.id, LOCAL_PLAN_ID), eq(plans.status, 'ACTIVE'))).limit(1)
      ]);
      if (organization === undefined) throw new Error(`${LOCAL_ORGANIZATION_ID} must exist and be active`);
      if (plan === undefined) throw new Error(`${LOCAL_PLAN_ID} is missing; run database migrations first`);
      const [entitlements, [existingPolicy]] = await Promise.all([
        transaction.select({ key: planEntitlements.key, enabled: planEntitlements.enabled, integerLimit: planEntitlements.integerLimit })
          .from(planEntitlements).where(eq(planEntitlements.planId, LOCAL_PLAN_ID)),
        transaction.select().from(budgetPolicies).where(eq(budgetPolicies.organizationId, LOCAL_ORGANIZATION_ID)).limit(1)
      ]);
      const limit = (key: string): number => {
        const entitlement = entitlements.find((item) => item.key === key);
        if (entitlement?.enabled !== true || entitlement.integerLimit === null) {
          throw new Error(`${LOCAL_PLAN_ID} is missing enabled ${key}`);
        }
        return Math.min(plan.credits, entitlement.integerLimit);
      };

      const [linkedSubscription] = await transaction.select({
        id: subscriptions.id,
        organizationId: subscriptions.organizationId
      }).from(subscriptions).where(and(
        eq(subscriptions.provider, LOCAL_PROVIDER),
        eq(subscriptions.externalSubscriptionId, LOCAL_EXTERNAL_SUBSCRIPTION_ID)
      )).limit(1);
      if (linkedSubscription !== undefined && linkedSubscription.organizationId !== LOCAL_ORGANIZATION_ID) {
        throw new Error(`${LOCAL_EXTERNAL_SUBSCRIPTION_ID} belongs to a different organization`);
      }
      subscriptionId = linkedSubscription?.id ?? subscriptionId;

      await transaction.update(subscriptions)
        .set({ status: 'EXPIRED', updatedAt: now.toISOString() })
        .where(and(
          eq(subscriptions.organizationId, LOCAL_ORGANIZATION_ID),
          inArray(subscriptions.status, ['TRIALING', 'ACTIVE', 'PAST_DUE']),
          lte(subscriptions.billingPeriodEnd, now.toISOString())
        ));

      const [otherCurrent] = await transaction.select({ id: subscriptions.id }).from(subscriptions)
        .where(and(
          eq(subscriptions.organizationId, LOCAL_ORGANIZATION_ID),
          inArray(subscriptions.status, ['TRIALING', 'ACTIVE', 'PAST_DUE'])
        )).limit(1);
      if (otherCurrent !== undefined && otherCurrent.id !== subscriptionId) {
        throw new Error(`Organization already has current subscription ${otherCurrent.id}`);
      }

      const [created] = linkedSubscription === undefined
        ? await transaction.insert(subscriptions).values({
            id: subscriptionId,
            organizationId: LOCAL_ORGANIZATION_ID,
            planId: LOCAL_PLAN_ID,
            status: 'TRIALING',
            billingPeriodStart: periodStart,
            billingPeriodEnd: periodEnd,
            provider: LOCAL_PROVIDER,
            externalCustomerId: LOCAL_EXTERNAL_CUSTOMER_ID,
            externalSubscriptionId: LOCAL_EXTERNAL_SUBSCRIPTION_ID
          }).onConflictDoNothing().returning({ id: subscriptions.id })
        : await transaction.update(subscriptions).set({
            planId: LOCAL_PLAN_ID,
            status: 'TRIALING',
            billingPeriodStart: periodStart,
            billingPeriodEnd: periodEnd,
            externalCustomerId: LOCAL_EXTERNAL_CUSTOMER_ID,
            updatedAt: now.toISOString()
          }).where(and(
            eq(subscriptions.organizationId, LOCAL_ORGANIZATION_ID),
            eq(subscriptions.id, subscriptionId)
          )).returning({ id: subscriptions.id });

      const [currentSubscription] = await transaction.select().from(subscriptions)
        .where(and(eq(subscriptions.organizationId, LOCAL_ORGANIZATION_ID), eq(subscriptions.id, subscriptionId))).limit(1);
      if (currentSubscription === undefined) throw new Error(`Subscription ${subscriptionId} is missing`);
      const providerFields = [currentSubscription.provider, currentSubscription.externalCustomerId, currentSubscription.externalSubscriptionId];
      if (providerFields.every((value) => value === null)) {
        await transaction.update(subscriptions).set({
          provider: LOCAL_PROVIDER,
          externalCustomerId: LOCAL_EXTERNAL_CUSTOMER_ID,
          externalSubscriptionId: LOCAL_EXTERNAL_SUBSCRIPTION_ID,
          updatedAt: now.toISOString()
        }).where(and(eq(subscriptions.organizationId, LOCAL_ORGANIZATION_ID), eq(subscriptions.id, subscriptionId)));
      } else if (
        currentSubscription.provider !== LOCAL_PROVIDER
        || currentSubscription.externalCustomerId !== LOCAL_EXTERNAL_CUSTOMER_ID
        || currentSubscription.externalSubscriptionId !== LOCAL_EXTERNAL_SUBSCRIPTION_ID
      ) {
        throw new Error(`Subscription ${subscriptionId} is already linked to a different provider identity`);
      }

      await transaction.insert(creditBalances).values({
        id: balanceId,
        organizationId: LOCAL_ORGANIZATION_ID,
        subscriptionId,
        periodStart,
        periodEnd,
        allocatedCreditUnits: plan.credits,
        alertThresholdPercent: existingPolicy?.alertThresholdPercent ?? 80
      }).onConflictDoNothing();

      await transaction.insert(budgetPolicies).values({
        id: `BPOL-${randomUUID()}`,
        organizationId: LOCAL_ORGANIZATION_ID,
        dailyCreditLimit: limit('MAX_DAILY_CREDITS'),
        userDailyCreditLimit: limit('MAX_USER_DAILY_CREDITS'),
        projectDailyCreditLimit: limit('MAX_PROJECT_DAILY_CREDITS'),
        alertThresholdPercent: 80
      }).onConflictDoNothing();

      if (created !== undefined) {
        await transaction.insert(auditEvents).values({
          id: `AUDIT-${randomUUID()}`,
          organizationId: LOCAL_ORGANIZATION_ID,
          actorUserId: null,
          action: 'LOCAL_BILLING_PROVISIONED',
          targetType: 'Subscription',
          targetId: subscriptionId,
          requestId: `local-billing-${subscriptionId}`,
          metadata: { planId: LOCAL_PLAN_ID, balanceId, periodStart, periodEnd, provider: LOCAL_PROVIDER }
        });
      }
    });

    process.stdout.write(`Local billing is ready for ${LOCAL_ORGANIZATION_ID} through ${periodEnd}\n`);
  } finally {
    await handle.pool.end();
  }
}

void main();
