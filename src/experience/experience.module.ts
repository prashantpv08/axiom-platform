import { Module } from '@nestjs/common';

import { BusinessContextController } from './business-context.controller';
import { BUSINESS_CONTEXT_REPOSITORY } from './business-context.repository';
import { BusinessContextService } from './business-context.service';
import { PostgresBusinessContextRepository } from './postgres-business-context.repository';

@Module({
  controllers: [BusinessContextController],
  providers: [
    BusinessContextService,
    PostgresBusinessContextRepository,
    { provide: BUSINESS_CONTEXT_REPOSITORY, useExisting: PostgresBusinessContextRepository }
  ]
})
export class ExperienceModule {}
