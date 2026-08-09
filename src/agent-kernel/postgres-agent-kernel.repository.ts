import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import type { AxiomDatabase } from '../database/client';
import { DATABASE } from '../database/database.module';
import { agentRuns, auditEvents, modelCalls } from '../database/schema';
import type {
  AgentKernelRepository,
  BeginAgentRunInput,
  CompleteAgentRunInput,
  FailAgentRunInput,
  RecordModelCallInput
} from './agent-kernel.repository';

@Injectable()
export class PostgresAgentKernelRepository implements AgentKernelRepository {
  constructor(@Inject(DATABASE) private readonly database: AxiomDatabase) {}

  async begin(input: BeginAgentRunInput): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.insert(agentRuns).values({
        id: input.id,
        organizationId: input.organizationId,
        projectId: input.projectId,
        generationId: input.generationId,
        workflow: input.workflow,
        workflowVersion: input.workflowVersion,
        promptVersion: input.promptVersion,
        policyId: input.policyId,
        policyVersion: input.policyVersion,
        tier: input.tier,
        modelDefinitionId: input.modelDefinitionId,
        budgetStatus: 'NOT_APPLICABLE',
        budgetReason: 'NON_BILLABLE_LOCAL_FIXTURE',
        contextHash: input.contextHash,
        requestId: input.requestId,
        actorUserId: input.actorUserId
      });
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`,
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'AGENT_RUN_STARTED',
        targetType: 'AgentRun',
        targetId: input.id,
        requestId: input.requestId,
        metadata: {
          projectId: input.projectId,
          generationId: input.generationId,
          workflow: input.workflow,
          workflowVersion: input.workflowVersion,
          promptVersion: input.promptVersion,
          modelDefinitionId: input.modelDefinitionId,
          tier: input.tier,
          budgetStatus: 'NOT_APPLICABLE'
        }
      });
    });
  }

  async recordModelCall(input: RecordModelCallInput): Promise<void> {
    await this.database.insert(modelCalls).values(input);
  }

  async complete(input: CompleteAgentRunInput): Promise<void> {
    const [updated] = await this.database.update(agentRuns).set({
      status: 'SUCCEEDED',
      outputHash: input.outputHash,
      finalModelCallId: input.modelCallId,
      completedAt: input.completedAt
    }).where(and(
      eq(agentRuns.organizationId, input.organizationId),
      eq(agentRuns.id, input.runId),
      eq(agentRuns.status, 'RUNNING')
    )).returning({ id: agentRuns.id });
    if (updated === undefined) throw new Error('Agent run could not be completed from RUNNING');
  }

  async fail(input: FailAgentRunInput): Promise<void> {
    const [updated] = await this.database.update(agentRuns).set({
      status: 'FAILED',
      errorCode: input.errorCode,
      completedAt: input.completedAt
    }).where(and(
      eq(agentRuns.organizationId, input.organizationId),
      eq(agentRuns.id, input.runId),
      eq(agentRuns.status, 'RUNNING')
    )).returning({ id: agentRuns.id });
    if (updated === undefined) throw new Error('Agent run could not be failed from RUNNING');
  }
}
