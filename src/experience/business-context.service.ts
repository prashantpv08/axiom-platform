import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException
} from '@nestjs/common';

import type { OrganizationAccessContext } from '../identity/identity.schema';
import { IdempotencyKeySchema, ProjectIdSchema } from '../projects/project.schema';
import { expectedProjectRowVersion } from '../projects/project.service';
import { compileBusinessContext } from './business-context.compiler';
import {
  BUSINESS_CONTEXT_REPOSITORY,
  BusinessContextBlockedError,
  BusinessContextConflictError,
  BusinessContextNotFoundError,
  BusinessContextVersionConflictError,
  type BusinessContextRepository
} from './business-context.repository';
import {
  BusinessContextBaselineSchema,
  BusinessContextMutationResponseSchema,
  GenerateBusinessContextRequestSchema,
  ReviewBusinessContextRequestSchema
} from './business-context.schema';

@Injectable()
export class BusinessContextService {
  constructor(@Inject(BUSINESS_CONTEXT_REPOSITORY) private readonly repository: BusinessContextRepository) {}

  async preview(context: OrganizationAccessContext, projectIdInput: unknown) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new NotFoundException('Project was not found');
    const snapshot = await this.repository.findCurrent(context.organizationId, projectId.data);
    if (snapshot === null) throw new NotFoundException('Project was not found');
    if (snapshot.graphVersion < 1 || snapshot.analyzedAt === null) {
      throw new ConflictException('Analyze the current project sources before reviewing Business Context');
    }
    return compileBusinessContext({
      projectId: snapshot.projectId,
      graphVersion: snapshot.graphVersion,
      analyzedAt: snapshot.analyzedAt,
      entities: snapshot.entities,
      blockingGapIds: snapshot.blockingGapIds
    });
  }

  async current(context: OrganizationAccessContext, projectIdInput: unknown) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new NotFoundException('Business Context was not found');
    const baseline = await this.repository.current(context.organizationId, projectId.data);
    if (baseline === null) throw new NotFoundException('Business Context was not found');
    return BusinessContextBaselineSchema.parse(baseline);
  }

  async generate(
    context: OrganizationAccessContext,
    projectIdInput: unknown,
    body: unknown,
    ifMatchInput: unknown,
    idempotencyKeyInput: unknown,
    requestId: string
  ) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new NotFoundException('Project was not found');
    const request = GenerateBusinessContextRequestSchema.safeParse(body);
    const idempotencyKey = IdempotencyKeySchema.safeParse(idempotencyKeyInput);
    if (!request.success || !idempotencyKey.success) throw new BadRequestException('Business Context generation request is invalid');
    const expectedRowVersion = expectedProjectRowVersion(ifMatchInput, projectId.data);
    const requestHash = createHash('sha256').update(JSON.stringify({ projectId: projectId.data, ...request.data, expectedRowVersion }), 'utf8').digest('hex');
    try {
      return BusinessContextMutationResponseSchema.parse(await this.repository.generate({
        projectId: projectId.data,
        sourceGraphVersion: request.data.sourceGraphVersion,
        previewContentHash: request.data.previewContentHash,
        expectedRowVersion,
        idempotencyKey: idempotencyKey.data,
        requestHash,
        context,
        requestId
      }));
    } catch (cause) {
      this.rethrow(cause);
    }
  }

  async review(
    context: OrganizationAccessContext,
    projectIdInput: unknown,
    body: unknown,
    ifMatchInput: unknown,
    idempotencyKeyInput: unknown,
    requestId: string
  ) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new NotFoundException('Project was not found');
    const request = ReviewBusinessContextRequestSchema.safeParse(body);
    const idempotencyKey = IdempotencyKeySchema.safeParse(idempotencyKeyInput);
    if (!request.success || !idempotencyKey.success) throw new BadRequestException('Business Context review request is invalid');
    const expectedRowVersion = expectedProjectRowVersion(ifMatchInput, projectId.data);
    const requestHash = createHash('sha256').update(JSON.stringify({ projectId: projectId.data, ...request.data, expectedRowVersion }), 'utf8').digest('hex');
    try {
      return BusinessContextMutationResponseSchema.parse(await this.repository.review({
        projectId: projectId.data,
        sourceGraphVersion: request.data.sourceGraphVersion,
        contextVersionId: request.data.contextVersionId,
        contextContentHash: request.data.contextContentHash,
        decision: request.data.decision,
        feedbackCategory: request.data.feedbackCategory,
        comment: request.data.comment,
        proposedGraphChanges: request.data.proposedGraphChanges,
        expectedRowVersion,
        idempotencyKey: idempotencyKey.data,
        requestHash,
        context,
        requestId
      }));
    } catch (cause) {
      this.rethrow(cause);
    }
  }

  private rethrow(cause: unknown): never {
    if (cause instanceof BusinessContextNotFoundError) throw new NotFoundException(cause.message);
    if (cause instanceof BusinessContextVersionConflictError) throw new HttpException(cause.message, HttpStatus.PRECONDITION_FAILED);
    if (cause instanceof BusinessContextBlockedError) throw new UnprocessableEntityException(cause.message);
    if (cause instanceof BusinessContextConflictError) throw new ConflictException(cause.message);
    throw cause;
  }
}
