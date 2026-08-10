import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { OrganizationAccessContext } from '../identity/identity.schema';
import { ApplicationError } from '../platform/application/application-error';
import { IdempotencyKeySchema, ProjectIdSchema } from '../projects/project.schema';
import { ARCHITECTURE_REPOSITORY, ArchitectureBlockedError, ArchitectureConflictError, ArchitectureNotFoundError, ArchitectureVersionConflictError, type ArchitectureRepository } from './architecture.repository';
import { ApproveArchitectureRequestSchema, ArchitectureBaselineSchema, ArchitectureMutationResponseSchema, GenerateArchitectureRequestSchema } from './architecture.schema';

@Injectable()
export class ArchitectureService {
  constructor(@Inject(ARCHITECTURE_REPOSITORY) private readonly repository: ArchitectureRepository) {}

  async current(context: OrganizationAccessContext, projectIdInput: unknown) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new ApplicationError('NOT_FOUND', 'Architecture baseline was not found');
    const baseline = await this.repository.current(context.organizationId, projectId.data);
    if (baseline === null) throw new ApplicationError('NOT_FOUND', 'Architecture baseline was not found');
    return ArchitectureBaselineSchema.parse(baseline);
  }

  async generate(context: OrganizationAccessContext, projectIdInput: unknown, body: unknown, expectedRowVersion: number, idempotencyKeyInput: unknown, requestId: string) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new ApplicationError('NOT_FOUND', 'Project was not found');
    const request = GenerateArchitectureRequestSchema.safeParse(body);
    const idempotencyKey = IdempotencyKeySchema.safeParse(idempotencyKeyInput);
    if (!request.success || !idempotencyKey.success) throw new ApplicationError('INVALID_REQUEST', 'Architecture generation request is invalid');
    const requestHash = createHash('sha256').update(JSON.stringify({ projectId: projectId.data, ...request.data, expectedRowVersion }), 'utf8').digest('hex');
    try {
      return ArchitectureMutationResponseSchema.parse(await this.repository.generate({ projectId: projectId.data, sourceGraphVersion: request.data.sourceGraphVersion, expectedRowVersion, idempotencyKey: idempotencyKey.data, requestHash, context, requestId }));
    } catch (cause) { this.rethrow(cause); }
  }

  async approve(context: OrganizationAccessContext, projectIdInput: unknown, body: unknown, expectedRowVersion: number, idempotencyKeyInput: unknown, requestId: string) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new ApplicationError('NOT_FOUND', 'Project was not found');
    const request = ApproveArchitectureRequestSchema.safeParse(body);
    const idempotencyKey = IdempotencyKeySchema.safeParse(idempotencyKeyInput);
    if (!request.success || !idempotencyKey.success) throw new ApplicationError('INVALID_REQUEST', 'Architecture approval request is invalid');
    const requestHash = createHash('sha256').update(JSON.stringify({ projectId: projectId.data, ...request.data, expectedRowVersion }), 'utf8').digest('hex');
    try {
      return ArchitectureMutationResponseSchema.parse(await this.repository.approve({ projectId: projectId.data, expectedRowVersion, idempotencyKey: idempotencyKey.data, requestHash, context, requestId, sourceGraphVersion: request.data.sourceGraphVersion, generationId: request.data.generationId, generationContentHash: request.data.generationContentHash, selectedOptionId: request.data.selectedOptionId, selectedOptionHash: request.data.selectedOptionHash, comment: request.data.comment }));
    } catch (cause) { this.rethrow(cause); }
  }

  private rethrow(cause: unknown): never {
    if (cause instanceof ArchitectureNotFoundError) throw new ApplicationError('NOT_FOUND', cause.message);
    if (cause instanceof ArchitectureVersionConflictError) throw new ApplicationError('PRECONDITION_FAILED', cause.message);
    if (cause instanceof ArchitectureBlockedError) throw new ApplicationError('UNPROCESSABLE', cause.message);
    if (cause instanceof ArchitectureConflictError) throw new ApplicationError('CONFLICT', cause.message);
    throw cause;
  }
}
