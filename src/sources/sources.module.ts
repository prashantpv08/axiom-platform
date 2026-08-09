import { Module } from '@nestjs/common';

import { PostgresSourceRepository } from './postgres-source.repository';
import { SourceController } from './source.controller';
import { SOURCE_REPOSITORY } from './source.repository';
import { SourceService } from './source.service';
import { LocalSourceStorage, SOURCE_STORAGE } from './source-storage.adapter';

@Module({
  controllers: [SourceController],
  providers: [
    SourceService,
    PostgresSourceRepository,
    { provide: SOURCE_REPOSITORY, useExisting: PostgresSourceRepository },
    { provide: SOURCE_STORAGE, useFactory: () => new LocalSourceStorage() }
  ]
})
export class SourcesModule {}
