import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { OrganizationAccessContext } from '../identity/identity.schema';
import { ApplicationError } from '../platform/application/application-error';
import { IdempotencyKeySchema, ProjectIdSchema } from '../projects/project.schema';
import {
  ARTIFACT_REPOSITORY,
  ArtifactBlockedError,
  ArtifactConflictError,
  ArtifactNotFoundError,
  ArtifactVersionConflictError,
  type ArtifactRepository
} from './artifact.repository';
import {
  ApproveArtifactsRequestSchema,
  ArtifactApprovalResponseSchema,
  ArtifactBaselineSchema,
  ArtifactGenerationResponseSchema,
  GenerateArtifactsRequestSchema
} from './artifact.schema';

@Injectable()
export class ArtifactService {
  constructor(@Inject(ARTIFACT_REPOSITORY) private readonly repository: ArtifactRepository) {}

  async current(context: OrganizationAccessContext, projectIdInput: unknown) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new ApplicationError('NOT_FOUND', 'Artifact baseline was not found');
    const baseline = await this.repository.current(context.organizationId, projectId.data);
    if (baseline === null) throw new ApplicationError('NOT_FOUND', 'Artifact baseline was not found');
    return ArtifactBaselineSchema.parse(baseline);
  }

  async generate(context: OrganizationAccessContext, projectIdInput: unknown, body: unknown, expectedRowVersion: number, idempotencyKeyInput: unknown, requestId: string) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new ApplicationError('NOT_FOUND', 'Project was not found');
    const request = GenerateArtifactsRequestSchema.safeParse(body);
    const idempotencyKey = IdempotencyKeySchema.safeParse(idempotencyKeyInput);
    if (!request.success || !idempotencyKey.success) throw new ApplicationError('INVALID_REQUEST', 'Artifact generation request is invalid');
    const requestHash = createHash('sha256').update(JSON.stringify({ projectId: projectId.data, ...request.data, expectedRowVersion }), 'utf8').digest('hex');
    try {
      return ArtifactGenerationResponseSchema.parse(await this.repository.generate({
        projectId: projectId.data, sourceGraphVersion: request.data.sourceGraphVersion, expectedRowVersion,
        idempotencyKey: idempotencyKey.data, requestHash, context, requestId
      }));
    } catch (cause) {
      this.rethrow(cause);
    }
  }

  async approve(context: OrganizationAccessContext, projectIdInput: unknown, body: unknown, expectedRowVersion: number, idempotencyKeyInput: unknown, requestId: string) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new ApplicationError('NOT_FOUND', 'Project was not found');
    const request = ApproveArtifactsRequestSchema.safeParse(body);
    const idempotencyKey = IdempotencyKeySchema.safeParse(idempotencyKeyInput);
    if (!request.success || !idempotencyKey.success) throw new ApplicationError('INVALID_REQUEST', 'Artifact approval request is invalid');
    const requestHash = createHash('sha256').update(JSON.stringify({ projectId: projectId.data, ...request.data, expectedRowVersion }), 'utf8').digest('hex');
    try {
      return ArtifactApprovalResponseSchema.parse(await this.repository.approve({
        projectId: projectId.data, sourceGraphVersion: request.data.sourceGraphVersion,
        documentHashes: request.data.documentHashes, comment: request.data.comment, expectedRowVersion,
        idempotencyKey: idempotencyKey.data, requestHash, context, requestId
      }));
    } catch (cause) {
      this.rethrow(cause);
    }
  }

  private rethrow(cause: unknown): never {
    if (cause instanceof ArtifactNotFoundError) throw new ApplicationError('NOT_FOUND', cause.message);
    if (cause instanceof ArtifactVersionConflictError) throw new ApplicationError('PRECONDITION_FAILED', cause.message);
    if (cause instanceof ArtifactBlockedError) throw new ApplicationError('UNPROCESSABLE', cause.message);
    if (cause instanceof ArtifactConflictError) throw new ApplicationError('CONFLICT', cause.message);
    throw cause;
  }
}
