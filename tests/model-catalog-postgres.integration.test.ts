import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseHandle, type DatabaseHandle } from '../src/database/client';
import { migrateDatabase } from '../src/database/migrate';
import {
  auditEvents,
  memberships,
  modelPolicies,
  organizations,
  sessions,
  users
} from '../src/database/schema';
import { hashSessionToken } from '../src/identity/authentication/session-token';
import { LOCAL_FIXTURE_MODEL_DEFINITION_ID } from '../src/agent-kernel/local-fixture-generation.adapter';
import {
  GROQ_GPT_OSS_20B_MODEL_DEFINITION_ID,
  GROQ_GPT_OSS_120B_MODEL_DEFINITION_ID,
  OPENAI_GPT_5_6_LUNA_MODEL_DEFINITION_ID,
  OPENAI_GPT_5_6_SOL_MODEL_DEFINITION_ID,
  OPENAI_GPT_5_6_TERRA_MODEL_DEFINITION_ID
} from '../src/agent-kernel/candidate-models';
import { createApplication } from '../src/platform/create-application';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl === undefined ? describe.skip : describe;
const ALPHA_TOKEN = 'm'.repeat(43);
const BETA_TOKEN = 'n'.repeat(43);

describePostgres('PostgreSQL model catalog and organization policy', () => {
  let database: DatabaseHandle;
  let app: NestFastifyApplication | undefined;

  async function resetDatabase(): Promise<void> {
    await database.pool.query('drop schema if exists public cascade');
    await database.pool.query('drop schema if exists axiom_internal cascade');
    await database.pool.query('create schema public');
    await migrateDatabase(database.db);
  }

  async function seedOrganizations(): Promise<void> {
    await database.db.insert(organizations).values([
      { id: 'ORG-ALPHA', slug: 'alpha-models', name: 'Alpha Models' },
      { id: 'ORG-BETA', slug: 'beta-models', name: 'Beta Models' }
    ]);
    await database.db.insert(users).values([
      { id: 'USER-ALPHA', email: 'alpha-models@example.test', displayName: 'Alpha Owner' },
      { id: 'USER-BETA', email: 'beta-models@example.test', displayName: 'Beta Viewer' }
    ]);
    await database.db.insert(memberships).values([
      { organizationId: 'ORG-ALPHA', userId: 'USER-ALPHA', role: 'OWNER' },
      { organizationId: 'ORG-BETA', userId: 'USER-BETA', role: 'VIEWER' }
    ]);
    await database.db.insert(sessions).values([
      { id: 'SESSION-ALPHA-MODELS', userId: 'USER-ALPHA', tokenHash: hashSessionToken(ALPHA_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' },
      { id: 'SESSION-BETA-MODELS', userId: 'USER-BETA', tokenHash: hashSessionToken(BETA_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' }
    ]);
    await database.db.insert(modelPolicies).values([
      {
        id: 'MPOL-ALPHA',
        organizationId: 'ORG-ALPHA',
        economyModelDefinitionId: LOCAL_FIXTURE_MODEL_DEFINITION_ID,
        balancedModelDefinitionId: LOCAL_FIXTURE_MODEL_DEFINITION_ID,
        bestModelDefinitionId: LOCAL_FIXTURE_MODEL_DEFINITION_ID
      },
      {
        id: 'MPOL-BETA',
        organizationId: 'ORG-BETA',
        economyModelDefinitionId: LOCAL_FIXTURE_MODEL_DEFINITION_ID,
        balancedModelDefinitionId: LOCAL_FIXTURE_MODEL_DEFINITION_ID,
        bestModelDefinitionId: LOCAL_FIXTURE_MODEL_DEFINITION_ID
      }
    ]);
  }

  beforeAll(() => {
    const parsed = new URL(testDatabaseUrl!);
    if (!parsed.pathname.startsWith('/axiom_test')) throw new Error('Model catalog integration tests require the axiom_test database');
    database = createDatabaseHandle(testDatabaseUrl);
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedOrganizations();
    app = await createApplication({ databaseUrl: testDatabaseUrl! });
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  afterAll(async () => {
    await database.pool.end();
  });

  it('returns the explicit local fixture policy and disabled provider candidates to an authorized member', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-ALPHA/models/catalog',
      headers: { authorization: `Bearer ${ALPHA_TOKEN}` }
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const catalog = response.json();
    expect(catalog).toMatchObject({
      providers: [
        { code: 'GROQ', lifecycleStatus: 'CANDIDATE', executionStatus: 'DISABLED', dataPolicyStatus: 'REQUIRES_REVIEW' },
        { code: 'LOCAL_FIXTURE', lifecycleStatus: 'LOCAL_ONLY', executionStatus: 'ENABLED', dataPolicyStatus: 'NO_EXTERNAL_TRANSFER' },
        { code: 'OPENAI', lifecycleStatus: 'CANDIDATE', executionStatus: 'DISABLED', dataPolicyStatus: 'REQUIRES_REVIEW' }
      ],
      policy: {
        id: 'MPOL-ALPHA',
        organizationId: 'ORG-ALPHA',
        economyModelDefinitionId: LOCAL_FIXTURE_MODEL_DEFINITION_ID,
        balancedModelDefinitionId: LOCAL_FIXTURE_MODEL_DEFINITION_ID,
        bestModelDefinitionId: LOCAL_FIXTURE_MODEL_DEFINITION_ID,
        rowVersion: 1
      }
    });
    expect(catalog.models).toHaveLength(6);
    expect(catalog.models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: LOCAL_FIXTURE_MODEL_DEFINITION_ID,
        immutableModelId: 'axiom-structured-fixture-v1',
        lifecycleStatus: 'LOCAL_ONLY',
        executionStatus: 'ENABLED',
        pricing: { status: 'NOT_APPLICABLE' },
        evaluation: { status: 'LOCAL_FIXTURE_ONLY', scores: {}, evaluationRunId: null, evaluatedAt: null }
      }),
      ...[
        OPENAI_GPT_5_6_LUNA_MODEL_DEFINITION_ID,
        OPENAI_GPT_5_6_TERRA_MODEL_DEFINITION_ID,
        OPENAI_GPT_5_6_SOL_MODEL_DEFINITION_ID,
        GROQ_GPT_OSS_20B_MODEL_DEFINITION_ID,
        GROQ_GPT_OSS_120B_MODEL_DEFINITION_ID
      ].map((id) => expect.objectContaining({
        id,
        lifecycleStatus: 'CANDIDATE',
        executionStatus: 'DISABLED',
        pricing: { status: 'UNVERIFIED' },
        dataPolicyStatus: 'REQUIRES_REVIEW',
        evaluation: { status: 'NOT_EVALUATED', scores: {}, evaluationRunId: null, evaluatedAt: null }
      }))
    ]));
  });

  it('permits read-only members but denies cross-tenant catalog access', async () => {
    const viewer = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-BETA/models/catalog',
      headers: { authorization: `Bearer ${BETA_TOKEN}` }
    });
    expect(viewer.statusCode, viewer.body).toBe(200);
    expect(viewer.json()).toMatchObject({ policy: { organizationId: 'ORG-BETA' } });

    const crossTenant = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-BETA/models/catalog',
      headers: { authorization: `Bearer ${ALPHA_TOKEN}` }
    });
    expect(crossTenant.statusCode).toBe(403);
    expect(crossTenant.body).not.toContain('MPOL-BETA');
  });

  it('refuses to enable an unqualified provider candidate at the database boundary', async () => {
    await expect(database.pool.query("update model_providers set execution_status = 'ENABLED' where code = 'OPENAI'"))
      .rejects.toThrow(/model_providers_enabled_lifecycle_check/u);
  });

  it('preserves policy evidence with a guarded rollback', async () => {
    const downSql = await readFile(resolve('drizzle/0012_model_catalog.down.sql'), 'utf8');
    await expect(database.pool.query(downSql)).rejects.toThrow(/Cannot roll back model catalog after organization policies exist/u);

    await database.db.delete(modelPolicies);
    const hostedCandidatesDownSql = await readFile(resolve('drizzle/0017_hosted_model_candidates.down.sql'), 'utf8');
    await database.pool.query(hostedCandidatesDownSql);
    const engineeringPlanDownSql = await readFile(resolve('drizzle/0018_engineering_plans.down.sql'), 'utf8');
    await database.pool.query(engineeringPlanDownSql);
    const agentKernelDownSql = await readFile(resolve('drizzle/0013_agent_kernel_runs.down.sql'), 'utf8');
    await database.pool.query(agentKernelDownSql);
    await database.pool.query(downSql);
    const providers = await database.pool.query("select to_regclass('public.model_providers') as table_name");
    expect(providers.rows[0]?.table_name).toBeNull();
    expect((await database.db.select().from(auditEvents))).toEqual([]);
  });
});
