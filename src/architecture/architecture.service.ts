import { createHash } from 'node:crypto';

import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

import type { OrganizationAccessContext } from '../identity/identity.schema';
import { IdempotencyKeySchema, ProjectIdSchema } from '../projects/project.schema';
import { expectedProjectRowVersion } from '../projects/project.service';
import { ARCHITECTURE_REPOSITORY, ArchitectureBlockedError, ArchitectureConflictError, ArchitectureNotFoundError, ArchitectureVersionConflictError, type ArchitectureRepository } from './architecture.repository';
import { ApproveArchitectureRequestSchema, ArchitectureBaselineSchema, ArchitectureMutationResponseSchema, GenerateArchitectureRequestSchema } from './architecture.schema';

@Injectable()
export class ArchitectureService {
  constructor(@Inject(ARCHITECTURE_REPOSITORY) private readonly repository: ArchitectureRepository) {}

  async current(context: OrganizationAccessContext, projectIdInput: unknown) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new NotFoundException('Architecture baseline was not found');
    const baseline = await this.repository.current(context.organizationId, projectId.data);
    if (baseline === null) throw new NotFoundException('Architecture baseline was not found');
    return ArchitectureBaselineSchema.parse(baseline);
  }

  async generate(context: OrganizationAccessContext, projectIdInput: unknown, body: unknown, ifMatchInput: unknown, idempotencyKeyInput: unknown, requestId: string) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new NotFoundException('Project was not found');
    const request = GenerateArchitectureRequestSchema.safeParse(body);
    const idempotencyKey = IdempotencyKeySchema.safeParse(idempotencyKeyInput);
    if (!request.success || !idempotencyKey.success) throw new BadRequestException('Architecture generation request is invalid');
    const expectedRowVersion = expectedProjectRowVersion(ifMatchInput, projectId.data);
    const requestHash = createHash('sha256').update(JSON.stringify({ projectId: projectId.data, ...request.data, expectedRowVersion }), 'utf8').digest('hex');
    try {
      return ArchitectureMutationResponseSchema.parse(await this.repository.generate({ projectId: projectId.data, sourceGraphVersion: request.data.sourceGraphVersion, expectedRowVersion, idempotencyKey: idempotencyKey.data, requestHash, context, requestId }));
    } catch (cause) { this.rethrow(cause); }
  }

  async approve(context: OrganizationAccessContext, projectIdInput: unknown, body: unknown, ifMatchInput: unknown, idempotencyKeyInput: unknown, requestId: string) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new NotFoundException('Project was not found');
    const request = ApproveArchitectureRequestSchema.safeParse(body);
    const idempotencyKey = IdempotencyKeySchema.safeParse(idempotencyKeyInput);
    if (!request.success || !idempotencyKey.success) throw new BadRequestException('Architecture approval request is invalid');
    const expectedRowVersion = expectedProjectRowVersion(ifMatchInput, projectId.data);
    const requestHash = createHash('sha256').update(JSON.stringify({ projectId: projectId.data, ...request.data, expectedRowVersion }), 'utf8').digest('hex');
    try {
      return ArchitectureMutationResponseSchema.parse(await this.repository.approve({ projectId: projectId.data, expectedRowVersion, idempotencyKey: idempotencyKey.data, requestHash, context, requestId, sourceGraphVersion: request.data.sourceGraphVersion, generationId: request.data.generationId, generationContentHash: request.data.generationContentHash, selectedOptionId: request.data.selectedOptionId, selectedOptionHash: request.data.selectedOptionHash, comment: request.data.comment }));
    } catch (cause) { this.rethrow(cause); }
  }

  private rethrow(cause: unknown): never {
    if (cause instanceof ArchitectureNotFoundError) throw new NotFoundException(cause.message);
    if (cause instanceof ArchitectureVersionConflictError) throw new HttpException(cause.message, HttpStatus.PRECONDITION_FAILED);
    if (cause instanceof ArchitectureBlockedError) throw new UnprocessableEntityException(cause.message);
    if (cause instanceof ArchitectureConflictError) throw new ConflictException(cause.message);
    throw cause;
  }
}
