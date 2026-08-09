import { Module } from '@nestjs/common';

import { ArchitectureController } from './architecture.controller';
import { ARCHITECTURE_REPOSITORY } from './architecture.repository';
import { ArchitectureService } from './architecture.service';
import { PostgresArchitectureRepository } from './postgres-architecture.repository';

@Module({ controllers: [ArchitectureController], providers: [ArchitectureService, PostgresArchitectureRepository, { provide: ARCHITECTURE_REPOSITORY, useExisting: PostgresArchitectureRepository }] })
export class ArchitectureModule {}
