import { Inject, Injectable } from '@nestjs/common';

import type { OrganizationAccessContext } from '../identity/identity.schema';
import { ApplicationError } from '../platform/application/application-error';
import { ModelCatalogSchema, type ModelCatalog } from './model-catalog.schema';
import { MODEL_CATALOG_REPOSITORY, type ModelCatalogRepository } from './model-catalog.repository';

@Injectable()
export class ModelCatalogService {
  constructor(@Inject(MODEL_CATALOG_REPOSITORY) private readonly repository: ModelCatalogRepository) {}

  async getCatalog(context: OrganizationAccessContext): Promise<ModelCatalog> {
    const catalog = await this.repository.getCatalog({ organizationId: context.organizationId });
    if (catalog === null) throw new ApplicationError('NOT_FOUND', 'Model policy is not provisioned for this organization');
    return ModelCatalogSchema.parse(catalog);
  }
}
