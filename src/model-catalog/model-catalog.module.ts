import { Module } from '@nestjs/common';

import { ModelCatalogController } from './model-catalog.controller';
import { MODEL_CATALOG_REPOSITORY } from './model-catalog.repository';
import { ModelCatalogService } from './model-catalog.service';
import { PostgresModelCatalogRepository } from './postgres-model-catalog.repository';

@Module({
  controllers: [ModelCatalogController],
  providers: [
    ModelCatalogService,
    PostgresModelCatalogRepository,
    { provide: MODEL_CATALOG_REPOSITORY, useExisting: PostgresModelCatalogRepository }
  ],
  exports: [ModelCatalogService]
})
export class ModelCatalogModule {}
