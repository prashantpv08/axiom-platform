import { Module } from '@nestjs/common';

import { ClarificationController } from './clarification.controller';
import { CLARIFICATION_REPOSITORY } from './clarification.repository';
import { ClarificationService } from './clarification.service';
import { PostgresClarificationRepository } from './postgres-clarification.repository';
import { PostgresProjectRepository } from './postgres-project.repository';
import { ProjectController } from './project.controller';
import { PROJECT_REPOSITORY } from './project.repository';
import { ProjectService } from './project.service';
import { WorkspaceController } from './workspace.controller';

@Module({
  controllers: [ProjectController, WorkspaceController, ClarificationController],
  providers: [
    ProjectService,
    ClarificationService,
    PostgresProjectRepository,
    PostgresClarificationRepository,
    { provide: PROJECT_REPOSITORY, useExisting: PostgresProjectRepository },
    { provide: CLARIFICATION_REPOSITORY, useExisting: PostgresClarificationRepository }
  ]
})
export class ProjectsModule {}
