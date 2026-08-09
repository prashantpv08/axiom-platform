import { Module, type DynamicModule } from '@nestjs/common';

import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { ProjectsModule } from './projects/projects.module';
import { WorkItemsModule } from './work-items/work-items.module';
import { BillingModule } from './billing/billing.module';
import { ModelCatalogModule } from './model-catalog/model-catalog.module';
import { ArtifactsModule } from './artifacts/artifacts.module';
import { ArchitectureModule } from './architecture/architecture.module';
import { SourcesModule } from './sources/sources.module';
import { EngineeringPlansModule } from './engineering-plans/engineering-plans.module';
import { ExperienceModule } from './experience/experience.module';

export type AppModuleOptions = {
  databaseUrl?: string;
};

@Module({})
export class AppModule {
  static register(options: AppModuleOptions = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [DatabaseModule.forRoot(options.databaseUrl), HealthModule, IdentityModule, ProjectsModule, SourcesModule, ExperienceModule, ArtifactsModule, ArchitectureModule, EngineeringPlansModule, WorkItemsModule, BillingModule, ModelCatalogModule]
    };
  }
}
