import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { createDatabaseHandle, databaseUrl } from '../src/database/client';
import { auditEvents, modelDefinitions, modelPolicies, organizations } from '../src/database/schema';
import { OrganizationIdSchema } from '../src/identity/identity.schema';
import { LOCAL_FIXTURE_MODEL_DEFINITION_ID } from '../src/agent-kernel/local-fixture-generation.adapter';

const LOCAL_ORGANIZATION_ID = OrganizationIdSchema.parse(
  process.env.AXIOM_LOCAL_ORGANIZATION_ID ?? 'ORG-LOCAL-DEVELOPMENT'
);

function requireLocalDatabase(url: string): void {
  const parsed = new URL(url);
  const localHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  const permittedDatabase = parsed.pathname === '/axiom' || parsed.pathname.startsWith('/axiom_test');
  if (!localHost || !permittedDatabase) {
    throw new Error('Local model-policy provisioning is restricted to localhost axiom databases');
  }
}

async function main(): Promise<void> {
  const url = databaseUrl();
  requireLocalDatabase(url);
  const handle = createDatabaseHandle(url);
  try {
    await handle.db.transaction(async (transaction) => {
      const [[organization], [fixture], [existing]] = await Promise.all([
        transaction.select({ id: organizations.id }).from(organizations)
          .where(and(eq(organizations.id, LOCAL_ORGANIZATION_ID), eq(organizations.status, 'ACTIVE'))).limit(1),
        transaction.select({ id: modelDefinitions.id, status: modelDefinitions.executionStatus }).from(modelDefinitions)
          .where(eq(modelDefinitions.id, LOCAL_FIXTURE_MODEL_DEFINITION_ID)).limit(1),
        transaction.select().from(modelPolicies).where(eq(modelPolicies.organizationId, LOCAL_ORGANIZATION_ID)).limit(1)
      ]);
      if (organization === undefined) throw new Error(`${LOCAL_ORGANIZATION_ID} must exist and be active`);
      if (fixture === undefined || fixture.status !== 'ENABLED') throw new Error('The local fixture model is missing or disabled; run migrations first');

      if (existing !== undefined) {
        const assigned = [existing.economyModelDefinitionId, existing.balancedModelDefinitionId, existing.bestModelDefinitionId];
        if (assigned.some((modelId) => modelId !== LOCAL_FIXTURE_MODEL_DEFINITION_ID)) {
          throw new Error(`Organization already has a non-fixture model policy ${existing.id}`);
        }
        return;
      }

      const policyId = `MPOL-${randomUUID()}`;
      await transaction.insert(modelPolicies).values({
        id: policyId,
        organizationId: LOCAL_ORGANIZATION_ID,
        economyModelDefinitionId: LOCAL_FIXTURE_MODEL_DEFINITION_ID,
        balancedModelDefinitionId: LOCAL_FIXTURE_MODEL_DEFINITION_ID,
        bestModelDefinitionId: LOCAL_FIXTURE_MODEL_DEFINITION_ID,
        updatedByUserId: null
      });
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`,
        organizationId: LOCAL_ORGANIZATION_ID,
        actorUserId: null,
        action: 'LOCAL_MODEL_POLICY_PROVISIONED',
        targetType: 'ModelPolicy',
        targetId: policyId,
        requestId: `local-model-policy-${LOCAL_ORGANIZATION_ID}`,
        metadata: {
          economyModelDefinitionId: LOCAL_FIXTURE_MODEL_DEFINITION_ID,
          balancedModelDefinitionId: LOCAL_FIXTURE_MODEL_DEFINITION_ID,
          bestModelDefinitionId: LOCAL_FIXTURE_MODEL_DEFINITION_ID,
          nonBillable: true
        }
      });
    });
    process.stdout.write(`Local non-billable model policy is ready for ${LOCAL_ORGANIZATION_ID}\n`);
  } finally {
    await handle.pool.end();
  }
}

void main();
