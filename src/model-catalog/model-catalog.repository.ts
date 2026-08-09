import type { ModelCatalog } from './model-catalog.schema';

export const MODEL_CATALOG_REPOSITORY = Symbol('MODEL_CATALOG_REPOSITORY');

export type ModelCatalogScope = Readonly<{ organizationId: string }>;

export interface ModelCatalogRepository {
  getCatalog(scope: ModelCatalogScope): Promise<ModelCatalog | null>;
}
