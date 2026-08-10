import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { OrganizationAccessContext } from '../identity/identity.schema';
import { ApplicationError } from '../platform/application/application-error';
import type { StrongEntityTag } from '../platform/http/entity-tag';
import { IdempotencyKeySchema, ProjectIdSchema } from '../projects/project.schema';
import { WorkItemGenerationIdSchema, WorkItemGenerationPreviewSchema } from './work-item-generation.schema';
import { SubmitWorkItemReviewRequestSchema } from './work-item-review.schema';
import {
  WORK_ITEM_REVIEW_REPOSITORY,
  WorkItemReviewBlockedError,
  WorkItemReviewConflictError,
  type WorkItemReviewRepository
} from './work-item-review.repository';
import { evaluateTicketQuality } from './ticket-quality.evaluator';
import { WorkItemBatchSchema, WorkItemSchema, type WorkItem } from './work-item.schema';

@Injectable()
export class WorkItemReviewService {
  constructor(@Inject(WORK_ITEM_REVIEW_REPOSITORY) private readonly repository: WorkItemReviewRepository) {}

  async submit(
    access: OrganizationAccessContext,
    projectIdInput: unknown,
    generationIdInput: unknown,
    body: unknown,
    ifMatch: StrongEntityTag,
    idempotencyKeyInput: unknown,
    requestId: string
  ) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    const generationId = WorkItemGenerationIdSchema.safeParse(generationIdInput);
    const request = SubmitWorkItemReviewRequestSchema.safeParse(body);
    const idempotencyKey = IdempotencyKeySchema.safeParse(idempotencyKeyInput);
    if (!projectId.success || !generationId.success) throw new ApplicationError('NOT_FOUND', 'Work-item generation was not found');
    if (!request.success || !idempotencyKey.success) throw new ApplicationError('INVALID_REQUEST', 'Work-item review request is invalid');
    const reviewContext = await this.repository.loadContext(access.organizationId, projectId.data, generationId.data);
    if (reviewContext === null) throw new ApplicationError('NOT_FOUND', 'Work-item generation was not found');
    if (ifMatch !== `"${reviewContext.generationId}:${reviewContext.generationContentHash}"`) throw new ApplicationError('CONFLICT', 'The review preview is stale');

    let reviewedWorkItems: WorkItem[] = reviewContext.workItems;
    const editedWorkItemIds: string[] = [];
    if (request.data.decision === 'ACCEPT_WITH_EDITS') {
      const edits = new Map(request.data.edits.map((edit) => [edit.workItemId, edit]));
      for (const edit of request.data.edits) {
        const item = reviewContext.workItems.find((candidate) => candidate.id === edit.workItemId);
        if (item === undefined) throw new ApplicationError('INVALID_REQUEST', `Work item ${edit.workItemId} is not part of this generation`);
        if (item.version !== edit.expectedVersion) throw new ApplicationError('CONFLICT', `Work item ${edit.workItemId} has a stale version`);
      }
      reviewedWorkItems = reviewContext.workItems.map((item) => {
        const edit = edits.get(item.id);
        if (edit === undefined) return item;
        const patch: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(edit)) {
          if (key !== 'workItemId' && key !== 'expectedVersion') patch[key] = value;
        }
        const record = item as unknown as Record<string, unknown>;
        const materiallyChanged = Object.entries(patch).some(([key, value]) => JSON.stringify(value) !== JSON.stringify(record[key]));
        if (!materiallyChanged) return item;
        editedWorkItemIds.push(item.id);
        return WorkItemSchema.parse({ ...item, ...patch, version: item.version + 1 });
      });
      if (editedWorkItemIds.length === 0) throw new ApplicationError('INVALID_REQUEST', 'Accept with edits requires at least one material work-item change');
    }

    const batch = WorkItemBatchSchema.parse({
      schemaVersion: reviewContext.schemaVersion,
      promptVersion: reviewContext.promptVersion,
      workflowVersion: reviewContext.workflowVersion,
      projectId: reviewContext.projectId,
      sourceGraphVersion: reviewContext.sourceGraphVersion,
      generatedAt: reviewContext.generatedAt,
      workItems: reviewedWorkItems
    });
    const qualityReport = evaluateTicketQuality({
      batch,
      sourceEntities: reviewContext.entities,
      approvedRequirementIds: reviewContext.entities.filter((entity) => entity.kind === 'REQUIREMENT').map((entity) => entity.id)
    });
    if (request.data.decision !== 'REJECT' && !qualityReport.passed) {
      const codes = [...new Set(qualityReport.findings.filter((finding) => finding.severity !== 'WARNING').map((finding) => finding.code))];
      throw new ApplicationError('UNPROCESSABLE', `Reviewed backlog failed deterministic quality gates: ${codes.join(', ')}.`);
    }
    const requestHash = createHash('sha256').update(JSON.stringify({
      projectId: projectId.data,
      generationId: generationId.data,
      ifMatch,
      review: request.data
    }), 'utf8').digest('hex');
    try {
      const result = await this.repository.persist({
        id: `WIREVIEW-${randomUUID()}`,
        context: access,
        reviewContext,
        request: request.data,
        reviewedWorkItems,
        editedWorkItemIds,
        qualityReport,
        idempotencyKey: idempotencyKey.data,
        requestHash,
        requestId
      });
      return WorkItemGenerationPreviewSchema.parse(result);
    } catch (cause) {
      if (cause instanceof WorkItemReviewConflictError) throw new ApplicationError('CONFLICT', cause.message);
      if (cause instanceof WorkItemReviewBlockedError) throw new ApplicationError('UNPROCESSABLE', cause.reasons.join(' '));
      throw cause;
    }
  }
}
