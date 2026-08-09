import { z } from 'zod';

import { IdempotencyKeySchema, ProjectIdSchema, WorkspaceIdSchema } from '../projects/project.schema';

export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_EXTRACTED_CHARACTERS = 250_000;

export const SourceIdSchema = z.string().regex(/^SRC-[A-F0-9]{24}$/u);
export const SourceKindSchema = z.enum(['FILE', 'FOLDER_FILE', 'MEETING_TRANSCRIPT']);
export const SourceStatusSchema = z.enum(['EXTRACTED', 'FAILED']);

export const UploadSourceRequestSchema = z.object({
  name: z.string().trim().min(1).max(240),
  relativePath: z.string().trim().min(1).max(500).optional(),
  kind: SourceKindSchema.default('FILE'),
  mimeType: z.string().trim().min(1).max(160),
  contentBase64: z.string().min(1).max(Math.ceil(MAX_SOURCE_BYTES / 3) * 4 + 16)
}).strict();

export const SourceResponseSchema = z.object({
  id: SourceIdSchema,
  workspaceId: WorkspaceIdSchema,
  projectId: ProjectIdSchema,
  name: z.string().min(1).max(240),
  relativePath: z.string().max(500).nullable(),
  kind: SourceKindSchema,
  mimeType: z.string().min(1).max(160),
  size: z.number().int().nonnegative().max(MAX_SOURCE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  rawPath: z.string().min(1),
  status: SourceStatusSchema,
  extractionError: z.string().max(500).nullable(),
  sourceKey: z.union([z.string().regex(/^[a-f0-9]{64}$/u), z.literal('legacy')]),
  version: z.number().int().positive(),
  validationStatus: z.enum(['VALIDATED', 'LEGACY_NOT_VERIFIED']),
  validator: z.string().min(1).max(160),
  extractedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime()
}).strict();

export const SourceListResponseSchema = z.object({ sources: z.array(SourceResponseSchema).max(500) }).strict();

export const AnalysisRunStatusSchema = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']);
export const AnalysisRunIdSchema = z.string().regex(/^ANRUN-[A-F0-9]{24}$/u);
export const CreateAnalysisRunRequestSchema = z.object({ analyzer: z.literal('axiom-deterministic-grounded-v1').default('axiom-deterministic-grounded-v1') }).strict();
export const AnalysisRunResponseSchema = z.object({
  id: AnalysisRunIdSchema,
  projectId: ProjectIdSchema,
  status: AnalysisRunStatusSchema,
  analyzer: z.literal('axiom-deterministic-grounded-v1'),
  sourceSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
  attempts: z.number().int().nonnegative(),
  graphVersion: z.number().int().positive().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
}).strict();

export { IdempotencyKeySchema };
export type SourceResponse = z.infer<typeof SourceResponseSchema>;
export type AnalysisRunResponse = z.infer<typeof AnalysisRunResponseSchema>;
