import { Module } from '@nestjs/common';

import { AgentKernelModule } from '../agent-kernel/agent-kernel.module';
import { EngineeringPlanController } from './engineering-plan.controller';
import { ENGINEERING_PLAN_REPOSITORY } from './engineering-plan.repository';
import { EngineeringPlanService } from './engineering-plan.service';
import { PostgresEngineeringPlanRepository } from './postgres-engineering-plan.repository';

@Module({
  imports: [AgentKernelModule],
  controllers: [EngineeringPlanController],
  providers: [
    EngineeringPlanService,
    PostgresEngineeringPlanRepository,
    { provide: ENGINEERING_PLAN_REPOSITORY, useExisting: PostgresEngineeringPlanRepository }
  ]
})
export class EngineeringPlansModule {}
