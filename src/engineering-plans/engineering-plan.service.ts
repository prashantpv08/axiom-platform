import { createHash, randomUUID } from 'node:crypto';

import { BadGatewayException, BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { AgentKernelOutputRejectedError, AgentKernelPolicyError, AgentKernelService } from '../agent-kernel/agent-kernel.service';
import { ProviderGenerationError } from '../agent-kernel/generation-provider.adapter';
import type { OrganizationAccessContext } from '../identity/identity.schema';
import { IdempotencyKeySchema, ProjectIdSchema } from '../projects/project.schema';
import { evaluateEngineeringPlan } from './engineering-plan.evaluator';
import {
  ENGINEERING_PLAN_REPOSITORY,
  EngineeringPlanBlockedError,
  EngineeringPlanConflictError,
  type EngineeringPlanRepository
} from './engineering-plan.repository';
import { EngineeringPlanPreviewSchema, EngineeringPlanSchema, GenerateEngineeringPlanRequestSchema } from './engineering-plan.schema';
import {
  buildEngineeringPlanMessages,
  ENGINEERING_PLAN_MAXIMUM_ATTEMPTS,
  ENGINEERING_PLAN_PROMPT_VERSION,
  ENGINEERING_PLAN_STRUCTURED_OUTPUT,
  ENGINEERING_PLAN_WORKFLOW,
  ENGINEERING_PLAN_WORKFLOW_VERSION
} from './engineering-plan.workflow';
import { generateFixtureEngineeringPlan, type EngineeringPlanContext } from './fixture-engineering-plan.generator';

const allowedStatuses = new Set(['HLD_READY', 'BACKLOG_READY', 'PUBLISHED']);

@Injectable()
export class EngineeringPlanService {
  constructor(
    @Inject(ENGINEERING_PLAN_REPOSITORY) private readonly repository: EngineeringPlanRepository,
    @Inject(AgentKernelService) private readonly agentKernel: AgentKernelService
  ) {}

  async latest(context: OrganizationAccessContext, projectIdInput: unknown) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new NotFoundException('Engineering Plan was not found');
    const preview = await this.repository.latest(context.organizationId, projectId.data);
    if (preview === null) throw new NotFoundException('Engineering Plan was not found');
    return EngineeringPlanPreviewSchema.parse(preview);
  }

  async generate(context: OrganizationAccessContext, projectIdInput: unknown, body: unknown, idempotencyKeyInput: unknown, requestId: string) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new NotFoundException('Project was not found');
    const request = GenerateEngineeringPlanRequestSchema.safeParse(body);
    const idempotencyKey = IdempotencyKeySchema.safeParse(idempotencyKeyInput);
    if (!request.success || !idempotencyKey.success) throw new BadRequestException('Engineering Plan request is invalid');
    const source = await this.repository.loadContext(context.organizationId, projectId.data);
    if (source === null) throw new NotFoundException('Project was not found');
    const reasons = [...source.blockingReasons];
    if (!allowedStatuses.has(source.projectStatus)) reasons.push(`Project status ${source.projectStatus} is not ready for Engineering Plan generation.`);
    if (source.graphVersion !== request.data.sourceGraphVersion) reasons.push('The requested graph version is no longer current.');
    if (source.entities.length === 0) reasons.push('The approved graph has no grounded or human-confirmed engineering context.');
    if (source.artifactApprovalId === null) reasons.push('The current graph has no exact current-artifact approval.');
    if (source.architectureDecisionId === null || source.selectedOption === null) reasons.push('The current graph has no exact latest-generation architecture decision.');
    if (reasons.length > 0) throw new HttpException({ code: 'ENGINEERING_PLAN_BLOCKED', message: reasons.join(' '), details: { reasons } }, 422);

    if (source.artifactApprovalId === null || source.architectureDecisionId === null || source.selectedOption === null) {
      throw new HttpException({ code: 'ENGINEERING_PLAN_BLOCKED', message: 'The approved engineering baseline is incomplete.' }, 422);
    }
    const planContext: EngineeringPlanContext = {
      projectId: source.projectId,
      projectName: source.projectName,
      projectStatus: source.projectStatus,
      graphVersion: source.graphVersion,
      artifactApprovalId: source.artifactApprovalId,
      architectureDecisionId: source.architectureDecisionId,
      selectedOption: source.selectedOption,
      alternativeOptions: source.alternativeOptions,
      entities: source.entities,
      openNonCriticalGaps: source.openNonCriticalGaps
    };

    const requestHash = createHash('sha256').update(JSON.stringify({
      projectId: source.projectId,
      sourceGraphVersion: source.graphVersion,
      tier: request.data.tier,
      artifactApprovalId: source.artifactApprovalId,
      architectureDecisionId: source.architectureDecisionId,
      architectureOptionId: planContext.selectedOption.id,
      workflowVersion: ENGINEERING_PLAN_WORKFLOW_VERSION,
      promptVersion: ENGINEERING_PLAN_PROMPT_VERSION
    }), 'utf8').digest('hex');
    try {
      const replay = await this.repository.reserve(context.organizationId, idempotencyKey.data, requestHash);
      if (replay !== null) return replay;
    } catch (cause) {
      if (cause instanceof EngineeringPlanConflictError) throw new ConflictException(cause.message);
      throw cause;
    }

    const generationId = `EPLAN-${randomUUID()}`;
    const generatedAt = new Date().toISOString();
    const fixturePlan = generateFixtureEngineeringPlan({
      ...planContext,
      planId: generationId,
      promptVersion: ENGINEERING_PLAN_PROMPT_VERSION,
      workflowVersion: ENGINEERING_PLAN_WORKFLOW_VERSION,
      generatedAt
    });
    let execution;
    try {
      execution = await this.agentKernel.executeStructured({
        context,
        projectId: source.projectId,
        generationId,
        requestId,
        tier: request.data.tier,
        workflow: ENGINEERING_PLAN_WORKFLOW,
        workflowVersion: ENGINEERING_PLAN_WORKFLOW_VERSION,
        promptVersion: ENGINEERING_PLAN_PROMPT_VERSION,
        messages: buildEngineeringPlanMessages(planContext),
        structuredOutput: ENGINEERING_PLAN_STRUCTURED_OUTPUT,
        maximumAttempts: ENGINEERING_PLAN_MAXIMUM_ATTEMPTS,
        maxOutputTokens: 40_000,
        timeoutMs: 60_000,
        localFixtureOutput: fixturePlan,
        validateOutput: (output) => {
          const plan = EngineeringPlanSchema.parse(output);
          if (
            plan.id !== generationId || plan.projectId !== source.projectId || plan.sourceGraphVersion !== source.graphVersion ||
            plan.artifactApprovalId !== source.artifactApprovalId || plan.architectureDecisionId !== source.architectureDecisionId ||
            plan.architectureOptionId !== planContext.selectedOption.id
          ) throw new Error('Engineering Plan output is not bound to the approved input baseline.');
          const qualityReport = evaluateEngineeringPlan({ plan, validSourceEntityIds: source.entities.map((entity) => entity.id) });
          if (!qualityReport.passed) {
            const codes = [...new Set(qualityReport.findings.map((finding) => finding.code))];
            throw new Error(`Engineering Plan failed deterministic quality gates: ${codes.join(', ')}.`);
          }
          return { plan, qualityReport };
        }
      });
    } catch (cause) {
      await this.repository.release(context.organizationId, idempotencyKey.data, requestHash);
      if (cause instanceof AgentKernelPolicyError || cause instanceof AgentKernelOutputRejectedError) throw new HttpException({ code: 'ENGINEERING_PLAN_REJECTED', message: cause.message }, 422);
      if (cause instanceof ProviderGenerationError) throw new BadGatewayException(cause.message);
      throw cause;
    }
    try {
      return await this.repository.persist({
        id: generationId,
        context,
        plan: execution.output.plan,
        qualityReport: execution.output.qualityReport,
        provenance: execution.provenance,
        idempotencyKey: idempotencyKey.data,
        requestHash,
        requestId
      });
    } catch (cause) {
      if (cause instanceof EngineeringPlanConflictError) throw new ConflictException(cause.message);
      await this.repository.release(context.organizationId, idempotencyKey.data, requestHash);
      if (cause instanceof EngineeringPlanBlockedError) throw new HttpException({ code: 'ENGINEERING_PLAN_BLOCKED', message: cause.reasons.join(' '), details: { reasons: cause.reasons } }, 422);
      throw cause;
    }
  }
}
