import { createHash } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { OrganizationAccessContext } from '../identity/identity.schema';
import { ProjectIdSchema } from '../projects/project.schema';
import { extractSourceText, UnsupportedSourceTypeError, validateSourceContent } from './source-extractor';
import {
  AnalysisAlreadyActiveError,
  AnalysisSourcesUnavailableError,
  SOURCE_REPOSITORY,
  SourceIdempotencyConflictError,
  SourceProjectArchivedError,
  SourceProjectNotFoundError,
  type SourceRepository
} from './source.repository';
import {
  AnalysisRunIdSchema,
  AnalysisRunResponseSchema,
  CreateAnalysisRunRequestSchema,
  IdempotencyKeySchema,
  SourceListResponseSchema,
  UploadSourceRequestSchema
} from './source.schema';
import { SOURCE_STORAGE, type SourceStorage } from './source-storage.adapter';

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function deterministicId(prefix: 'SRC' | 'ANRUN', value: string): string {
  return `${prefix}-${sha256(value).slice(0, 24).toUpperCase()}`;
}

function decodeBase64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new BadRequestException('Source contentBase64 is invalid');
  }
  return Buffer.from(value, 'base64');
}

@Injectable()
export class SourceService {
  constructor(
    @Inject(SOURCE_REPOSITORY) private readonly repository: SourceRepository,
    @Inject(SOURCE_STORAGE) private readonly storage: SourceStorage
  ) {}

  async list(context: OrganizationAccessContext, projectIdInput: unknown) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new NotFoundException('Project was not found');
    const sources = await this.repository.list({ organizationId: context.organizationId }, projectId.data);
    if (sources === null) throw new NotFoundException('Project was not found');
    return SourceListResponseSchema.parse({ sources });
  }

  async upload(context: OrganizationAccessContext, projectIdInput: unknown, bodyInput: unknown, idempotencyKeyInput: unknown, requestId: string) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new NotFoundException('Project was not found');
    const body = UploadSourceRequestSchema.safeParse(bodyInput);
    if (!body.success) throw new BadRequestException('Source upload request is invalid');
    const idempotencyKey = IdempotencyKeySchema.safeParse(idempotencyKeyInput);
    if (!idempotencyKey.success) throw new BadRequestException('A valid Idempotency-Key header is required');
    const project = await this.repository.projectIdentity({ organizationId: context.organizationId }, projectId.data);
    if (project === null) throw new NotFoundException('Project was not found');
    if (project.status === 'ARCHIVED') throw new ConflictException('Archived projects cannot accept sources');

    const content = decodeBase64(body.data.contentBase64);
    try {
      validateSourceContent({ name: body.data.name, mimeType: body.data.mimeType, content });
    } catch (cause) {
      if (cause instanceof UnsupportedSourceTypeError) throw new BadRequestException(cause.message);
      throw new BadRequestException(cause instanceof Error ? cause.message : 'Source validation failed');
    }
    const contentHash = sha256(content);
    const sourceKey = sha256(JSON.stringify({
      kind: body.data.kind,
      name: body.data.name.toLocaleLowerCase('en-US'),
      relativePath: body.data.relativePath?.toLocaleLowerCase('en-US') ?? null
    }));
    const requestHash = sha256(JSON.stringify({ ...body.data, contentBase64: undefined, contentHash }));
    const sourceId = deterministicId('SRC', `${context.organizationId}:${projectId.data}:${idempotencyKey.data}`);
    let extractedText = '';
    let status: 'EXTRACTED' | 'FAILED' = 'EXTRACTED';
    let extractionError: string | null = null;
    try {
      extractedText = await extractSourceText({ name: body.data.name, mimeType: body.data.mimeType, content });
    } catch (cause) {
      status = 'FAILED';
      extractionError = (cause instanceof Error ? cause.message : 'Source extraction failed').slice(0, 500);
    }
    const rawPath = await this.storage.putImmutable({
      organizationId: context.organizationId, projectId: projectId.data, sourceId,
      name: body.data.name, content, sha256: contentHash
    });
    const now = new Date().toISOString();
    try {
      return await this.repository.create({ organizationId: context.organizationId }, {
        source: {
          id: sourceId, workspaceId: project.workspaceId, projectId: projectId.data, name: body.data.name,
          relativePath: body.data.relativePath ?? null, kind: body.data.kind, mimeType: body.data.mimeType,
          size: content.byteLength, sha256: contentHash, rawPath, status, extractionError, sourceKey,
          validationStatus: 'VALIDATED', validator: 'axiom-bounded-source-validator-v1',
          extractedAt: status === 'EXTRACTED' ? now : null, createdAt: now
        },
        extractedText, actorUserId: context.userId, idempotencyKey: idempotencyKey.data,
        requestHash, requestId
      });
    } catch (cause) {
      if (cause instanceof SourceProjectNotFoundError) throw new NotFoundException(cause.message);
      if (cause instanceof SourceProjectArchivedError || cause instanceof SourceIdempotencyConflictError) throw new ConflictException(cause.message);
      throw cause;
    }
  }

  async queueAnalysis(context: OrganizationAccessContext, projectIdInput: unknown, bodyInput: unknown, idempotencyKeyInput: unknown, requestId: string) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new NotFoundException('Project was not found');
    const body = CreateAnalysisRunRequestSchema.safeParse(bodyInput);
    if (!body.success) throw new BadRequestException('Analysis request is invalid');
    const idempotencyKey = IdempotencyKeySchema.safeParse(idempotencyKeyInput);
    if (!idempotencyKey.success) throw new BadRequestException('A valid Idempotency-Key header is required');
    const requestHash = sha256(JSON.stringify(body.data));
    try {
      return await this.repository.queueAnalysis({ organizationId: context.organizationId }, {
        projectId: projectId.data,
        runId: deterministicId('ANRUN', `${context.organizationId}:${projectId.data}:${idempotencyKey.data}`),
        actorUserId: context.userId, analyzer: body.data.analyzer,
        idempotencyKey: idempotencyKey.data, requestHash, requestId
      });
    } catch (cause) {
      if (cause instanceof SourceProjectNotFoundError) throw new NotFoundException(cause.message);
      if (cause instanceof SourceProjectArchivedError || cause instanceof SourceIdempotencyConflictError || cause instanceof AnalysisAlreadyActiveError || cause instanceof AnalysisSourcesUnavailableError) {
        throw new ConflictException(cause.message);
      }
      throw cause;
    }
  }

  async getAnalysisRun(context: OrganizationAccessContext, projectIdInput: unknown, runIdInput: unknown) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    const runId = AnalysisRunIdSchema.safeParse(runIdInput);
    if (!projectId.success || !runId.success) throw new NotFoundException('Analysis run was not found');
    const run = await this.repository.findAnalysisRun({ organizationId: context.organizationId }, projectId.data, runId.data);
    if (run === null) throw new NotFoundException('Analysis run was not found');
    return AnalysisRunResponseSchema.parse(run);
  }

  async getLatestAnalysisRun(context: OrganizationAccessContext, projectIdInput: unknown) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new NotFoundException('Project was not found');
    const project = await this.repository.projectIdentity({ organizationId: context.organizationId }, projectId.data);
    if (project === null) throw new NotFoundException('Project was not found');
    const run = await this.repository.latestAnalysisRun({ organizationId: context.organizationId }, projectId.data);
    return { run: run === null ? null : AnalysisRunResponseSchema.parse(run) };
  }

  async cancelAnalysisRun(context: OrganizationAccessContext, projectIdInput: unknown, runIdInput: unknown, requestId: string) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    const runId = AnalysisRunIdSchema.safeParse(runIdInput);
    if (!projectId.success || !runId.success) throw new NotFoundException('Analysis run was not found');
    const run = await this.repository.cancelAnalysisRun({ organizationId: context.organizationId }, projectId.data, runId.data, context.userId, requestId);
    if (run === null) throw new NotFoundException('Analysis run was not found');
    return AnalysisRunResponseSchema.parse(run);
  }
}
