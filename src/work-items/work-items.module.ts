import { Module } from '@nestjs/common';

import { AgentKernelModule } from '../agent-kernel/agent-kernel.module';
import { PostgresWorkItemGenerationRepository } from './postgres-work-item-generation.repository';
import { PostgresWorkItemReviewRepository } from './postgres-work-item-review.repository';
import { WorkItemGenerationController } from './work-item-generation.controller';
import { WORK_ITEM_GENERATION_REPOSITORY } from './work-item-generation.repository';
import { WorkItemGenerationService } from './work-item-generation.service';
import { WorkItemReviewController } from './work-item-review.controller';
import { WORK_ITEM_REVIEW_REPOSITORY } from './work-item-review.repository';
import { WorkItemReviewService } from './work-item-review.service';

@Module({
  imports: [AgentKernelModule],
  controllers: [WorkItemGenerationController, WorkItemReviewController],
  providers: [
    WorkItemGenerationService,
    WorkItemReviewService,
    PostgresWorkItemGenerationRepository,
    PostgresWorkItemReviewRepository,
    { provide: WORK_ITEM_GENERATION_REPOSITORY, useExisting: PostgresWorkItemGenerationRepository },
    { provide: WORK_ITEM_REVIEW_REPOSITORY, useExisting: PostgresWorkItemReviewRepository }
  ]
})
export class WorkItemsModule {}
