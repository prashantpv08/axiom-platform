import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { AgentKernelOutputRejectedError, AgentKernelPolicyError, AgentKernelService } from '../agent-kernel/agent-kernel.service';
import { ProviderGenerationError } from '../agent-kernel/generation-provider.adapter';
import type { OrganizationAccessContext } from '../identity/identity.schema';
import { ApplicationError } from '../platform/application/application-error';
import { IdempotencyKeySchema, ProjectIdSchema } from '../projects/project.schema';
import { generateFixtureWorkItems } from './fixture-work-item.generator';
import { GenerateWorkItemsRequestSchema, WorkItemGenerationPreviewSchema } from './work-item-generation.schema';
import { WorkItemGenerationBlockedDetailsSchema } from './work-item-generation-blocker.schema';
import {
  WORK_ITEM_GENERATION_REPOSITORY,
  WorkItemGenerationBlockedError,
  WorkItemGenerationConflictError,
  type WorkItemGenerationRepository
} from './work-item-generation.repository';
import { evaluateTicketQuality } from './ticket-quality.evaluator';
import { WorkItemBatchSchema, type WorkItemBatch } from './work-item.schema';
import {
  buildTicketGenerationMessages,
  TICKET_GENERATION_MAXIMUM_ATTEMPTS,
  TICKET_GENERATION_PROMPT_VERSION,
  TICKET_GENERATION_STRUCTURED_OUTPUT,
  TICKET_GENERATION_WORKFLOW,
  TICKET_GENERATION_WORKFLOW_VERSION
} from './ticket-generation.workflow';

const allowedStatuses = new Set(['HLD_READY', 'PUBLISHED', 'BACKLOG_READY']);

@Injectable()
export class WorkItemGenerationService {
  constructor(
    @Inject(WORK_ITEM_GENERATION_REPOSITORY) private readonly repository: WorkItemGenerationRepository,
    @Inject(AgentKernelService) private readonly agentKernel: AgentKernelService
  ) {}

  async latest(context: OrganizationAccessContext, projectIdInput: unknown) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new ApplicationError('NOT_FOUND', 'Work-item preview was not found');
    const preview = await this.repository.latest(context.organizationId, projectId.data);
    if (preview === null) throw new ApplicationError('NOT_FOUND', 'Work-item preview was not found');
    return WorkItemGenerationPreviewSchema.parse(preview);
  }

  async generate(context: OrganizationAccessContext, projectIdInput: unknown, body: unknown, idempotencyKeyInput: unknown, requestId: string) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new ApplicationError('NOT_FOUND', 'Project was not found');
    const request = GenerateWorkItemsRequestSchema.safeParse(body);
    const idempotencyKey = IdempotencyKeySchema.safeParse(idempotencyKeyInput);
    if (!request.success || !idempotencyKey.success) throw new ApplicationError('INVALID_REQUEST', 'Work-item generation request is invalid');
    const graph = await this.repository.loadContext(context.organizationId, projectId.data);
    if (graph === null) throw new ApplicationError('NOT_FOUND', 'Project was not found');
    const reasons: string[] = [];
    if (!allowedStatuses.has(graph.projectStatus)) reasons.push(`Project status ${graph.projectStatus} is not ready for backlog generation.`);
    if (graph.graphVersion !== request.data.sourceGraphVersion) reasons.push('The requested graph version is no longer current.');
    if (graph.documentApprovalId === null) reasons.push('The current graph has no exact current-artifact approval.');
    if (graph.arbDecisionId === null) reasons.push('The current graph has no exact latest-generation architecture decision.');
    if (graph.businessContextBlockingReason !== null) reasons.push(graph.businessContextBlockingReason);
    if (graph.blockers.length > 0) reasons.push(`Critical unknowns or contradictions remain open: ${graph.blockers.map((blocker) => blocker.gapId).join(', ')}.`);
    const approvedEntities = graph.entities.filter((entity) => entity.kind === 'REQUIREMENT' || entity.kind === 'NFR');
    if (approvedEntities.length === 0) reasons.push('The approved graph has no grounded or human-confirmed requirement or NFR.');
    if (graph.blockers.length > 0) {
      throw new ApplicationError('UNPROCESSABLE', reasons.join(' '), {
        code: 'CLARIFICATION_REQUIRED',
        details: WorkItemGenerationBlockedDetailsSchema.parse({ blockers: graph.blockers })
      });
    }
    if (reasons.length > 0) throw new ApplicationError('UNPROCESSABLE', reasons.join(' '));

    let fixtureBatch: WorkItemBatch;
    try {
      fixtureBatch = generateFixtureWorkItems({ projectId: graph.projectId, projectName: graph.projectName, sourceGraphVersion: graph.graphVersion, entities: graph.entities, generatedAt: new Date().toISOString() });
    } catch (cause) {
      throw new ApplicationError('UNPROCESSABLE', cause instanceof Error ? cause.message : 'Fixture generation failed');
    }
    const generationId = `WIGEN-${randomUUID()}`;
    let execution;
    try {
      execution = await this.agentKernel.executeStructured({
        context,
        projectId: graph.projectId,
        generationId,
        requestId,
        tier: request.data.tier,
        workflow: TICKET_GENERATION_WORKFLOW,
        workflowVersion: TICKET_GENERATION_WORKFLOW_VERSION,
        promptVersion: TICKET_GENERATION_PROMPT_VERSION,
        messages: buildTicketGenerationMessages(graph),
        structuredOutput: TICKET_GENERATION_STRUCTURED_OUTPUT,
        maximumAttempts: TICKET_GENERATION_MAXIMUM_ATTEMPTS,
        maxOutputTokens: 20_000,
        timeoutMs: 30_000,
        localFixtureOutput: fixtureBatch,
        validateOutput: (output) => {
          const batch = WorkItemBatchSchema.parse(output);
          const qualityReport = evaluateTicketQuality({
            batch,
            sourceEntities: graph.entities,
            approvedRequirementIds: graph.entities.filter((entity) => entity.kind === 'REQUIREMENT').map((entity) => entity.id)
          });
          if (!qualityReport.passed) {
            const codes = [...new Set(qualityReport.findings.filter((finding) => finding.severity !== 'WARNING').map((finding) => finding.code))];
            throw new Error(`Generated backlog failed deterministic quality gates: ${codes.join(', ')}.`);
          }
          return { batch, qualityReport };
        }
      });
    } catch (cause) {
      if (cause instanceof AgentKernelPolicyError || cause instanceof AgentKernelOutputRejectedError) {
        throw new ApplicationError('UNPROCESSABLE', cause.message);
      }
      if (cause instanceof ProviderGenerationError) throw new ApplicationError('UPSTREAM_FAILURE', cause.message);
      throw cause;
    }
    const { batch, qualityReport } = execution.output;
    const requestHash = createHash('sha256').update(JSON.stringify({ projectId: projectId.data, ...request.data, workflowVersion: batch.workflowVersion, promptVersion: batch.promptVersion }), 'utf8').digest('hex');
    try {
      return await this.repository.persist({ id: generationId, context, batch, qualityReport, provenance: execution.provenance, idempotencyKey: idempotencyKey.data, requestHash, requestId });
    } catch (cause) {
      if (cause instanceof WorkItemGenerationConflictError) throw new ApplicationError('CONFLICT', cause.message);
      if (cause instanceof WorkItemGenerationBlockedError) throw new ApplicationError('UNPROCESSABLE', cause.reasons.join(' '));
      throw cause;
    }
  }
}
