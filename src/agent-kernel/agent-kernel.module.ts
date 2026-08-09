import { Module } from '@nestjs/common';

import { ModelCatalogModule } from '../model-catalog/model-catalog.module';
import { AgentKernelService } from './agent-kernel.service';
import { AGENT_KERNEL_REPOSITORY } from './agent-kernel.repository';
import { PostgresAgentKernelRepository } from './postgres-agent-kernel.repository';

@Module({
  imports: [ModelCatalogModule],
  providers: [
    AgentKernelService,
    PostgresAgentKernelRepository,
    { provide: AGENT_KERNEL_REPOSITORY, useExisting: PostgresAgentKernelRepository }
  ],
  exports: [AgentKernelService]
})
export class AgentKernelModule {}
