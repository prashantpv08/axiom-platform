import { z } from 'zod';

import { ProjectIdSchema, ProjectResponseSchema } from '../projects/project.schema';

export const ARTIFACT_COMPILER_VERSION = 'requirement-baseline-compiler-v1' as const;
export const ArtifactTypeSchema = z.enum(['requirements', 'srs', 'nfr']);
export const ArtifactHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const ArtifactHashesSchema = z.object({
  requirements: ArtifactHashSchema,
  srs: ArtifactHashSchema,
  nfr: ArtifactHashSchema
}).strict();

export const ProjectArtifactSchema = z.object({
  id: z.string().min(1).max(240),
  projectId: ProjectIdSchema,
  type: ArtifactTypeSchema,
  version: z.number().int().positive(),
  sourceGraphVersion: z.number().int().positive(),
  title: z.string().min(1).max(240),
  content: z.string().min(1).max(200_000),
  sha256: ArtifactHashSchema,
  truthStatus: z.literal('AI_SUGGESTED'),
  provenance: z.object({
    mode: z.literal('DETERMINISTIC_COMPILER'),
    compilerVersion: z.literal(ARTIFACT_COMPILER_VERSION),
    sourceEntityIds: z.array(z.string().min(1)).max(1_000),
    sourceIds: z.array(z.string().min(1)).max(1_000)
  }).strict(),
  generatedAt: z.iso.datetime()
}).strict();

export const ArtifactApprovalSchema = z.object({
  id: z.string().regex(/^DOCAPP-[A-Za-z0-9_-]{1,123}$/u),
  projectId: ProjectIdSchema,
  graphVersion: z.number().int().positive(),
  documentHashes: ArtifactHashesSchema,
  comment: z.string().min(10).max(2_000),
  truthStatus: z.literal('HUMAN_APPROVED'),
  approvedByUserId: z.string().min(1).max(160),
  approvedAt: z.iso.datetime()
}).strict();

export const ArtifactBaselineSchema = z.object({
  projectId: ProjectIdSchema,
  graphVersion: z.number().int().nonnegative(),
  artifacts: z.array(ProjectArtifactSchema).max(3),
  approval: ArtifactApprovalSchema.nullable()
}).strict();

export const GenerateArtifactsRequestSchema = z.object({
  sourceGraphVersion: z.number().int().positive()
}).strict();

export const ApproveArtifactsRequestSchema = z.object({
  sourceGraphVersion: z.number().int().positive(),
  documentHashes: ArtifactHashesSchema,
  comment: z.string().trim().min(10).max(2_000)
}).strict();

export const ArtifactGenerationResponseSchema = z.object({
  project: ProjectResponseSchema,
  baseline: ArtifactBaselineSchema,
  replayed: z.boolean()
}).strict();

export const ArtifactApprovalResponseSchema = z.object({
  project: ProjectResponseSchema,
  baseline: ArtifactBaselineSchema,
  replayed: z.boolean()
}).strict();

export type ArtifactHashes = z.infer<typeof ArtifactHashesSchema>;
export type ProjectArtifact = z.infer<typeof ProjectArtifactSchema>;
export type ArtifactApproval = z.infer<typeof ArtifactApprovalSchema>;
export type ArtifactBaseline = z.infer<typeof ArtifactBaselineSchema>;
