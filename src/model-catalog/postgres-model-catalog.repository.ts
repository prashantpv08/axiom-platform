import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

import { DATABASE } from '../database/database.module';
import type { AxiomDatabase } from '../database/client';
import { modelDefinitions, modelPolicies, modelProviders } from '../database/schema';
import {
  ModelCatalogSchema,
  type ModelCatalog
} from './model-catalog.schema';
import type { ModelCatalogRepository, ModelCatalogScope } from './model-catalog.repository';

function iso(value: string): string {
  return new Date(value).toISOString();
}

@Injectable()
export class PostgresModelCatalogRepository implements ModelCatalogRepository {
  constructor(@Inject(DATABASE) private readonly db: AxiomDatabase) {}

  async getCatalog(scope: ModelCatalogScope): Promise<ModelCatalog | null> {
    const [policy] = await this.db.select({
      id: modelPolicies.id,
      organizationId: modelPolicies.organizationId,
      economyModelDefinitionId: modelPolicies.economyModelDefinitionId,
      balancedModelDefinitionId: modelPolicies.balancedModelDefinitionId,
      bestModelDefinitionId: modelPolicies.bestModelDefinitionId,
      rowVersion: modelPolicies.rowVersion,
      updatedAt: modelPolicies.updatedAt
    }).from(modelPolicies)
      .where(eq(modelPolicies.organizationId, scope.organizationId))
      .limit(1);
    if (policy === undefined) return null;

    const [providerRows, modelRows] = await Promise.all([
      this.db.select().from(modelProviders).orderBy(asc(modelProviders.code), asc(modelProviders.id)),
      this.db.select().from(modelDefinitions).orderBy(asc(modelDefinitions.displayName), asc(modelDefinitions.id))
    ]);

    return ModelCatalogSchema.parse({
      providers: providerRows.map((provider) => ({
        id: provider.id,
        code: provider.code,
        displayName: provider.displayName,
        lifecycleStatus: provider.lifecycleStatus,
        executionStatus: provider.executionStatus,
        dataPolicyStatus: provider.dataPolicyStatus,
        allowedRegions: provider.allowedRegions,
        updatedAt: iso(provider.updatedAt)
      })),
      models: modelRows.map((model) => ({
        id: model.id,
        providerId: model.providerId,
        immutableModelId: model.immutableModelId,
        displayName: model.displayName,
        lifecycleStatus: model.lifecycleStatus,
        executionStatus: model.executionStatus,
        capabilities: model.capabilities,
        contextWindowTokens: model.contextWindowTokens,
        maxOutputTokens: model.maxOutputTokens,
        pricing: model.pricing,
        dataPolicyStatus: model.dataPolicyStatus,
        allowedRegions: model.allowedRegions,
        evaluation: {
          status: model.evaluationStatus,
          scores: model.evaluationScores,
          evaluationRunId: model.evaluationRunId,
          evaluatedAt: model.evaluatedAt === null ? null : iso(model.evaluatedAt)
        },
        updatedAt: iso(model.updatedAt)
      })),
      policy: { ...policy, updatedAt: iso(policy.updatedAt) }
    });
  }
}
