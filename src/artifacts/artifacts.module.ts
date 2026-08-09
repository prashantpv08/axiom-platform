import { Module } from '@nestjs/common';

import { ArtifactController } from './artifact.controller';
import { ARTIFACT_REPOSITORY } from './artifact.repository';
import { ArtifactService } from './artifact.service';
import { PostgresArtifactRepository } from './postgres-artifact.repository';

@Module({
  controllers: [ArtifactController],
  providers: [
    ArtifactService,
    PostgresArtifactRepository,
    { provide: ARTIFACT_REPOSITORY, useExisting: PostgresArtifactRepository }
  ]
})
export class ArtifactsModule {}
