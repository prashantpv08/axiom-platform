import { z } from 'zod';

import { ProjectIdSchema, ProjectResponseSchema } from '../projects/project.schema';
import { ArtifactHashSchema } from '../artifacts/artifact.schema';

export const ARCHITECTURE_COMPILER_VERSION = 'architecture-comparison-compiler-v1' as const;
export const ArchitectureGenerationIdSchema = z.string().regex(/^ARCHGEN-[A-Za-z0-9_-]{1,120}$/u);
export const ArchitectureOptionIdSchema = z.string().regex(/^ARCHOPT-[A-Za-z0-9_-]{1,120}$/u);
export const ArchitectureProfileSchema = z.enum(['LEAN', 'BALANCED', 'DISTRIBUTED']);

const ArchitectureScoreSchema = z.object({
  score: z.number().int().min(1).max(5),
  rationale: z.string().min(10).max(1_000)
}).strict();

export const ArchitectureOptionSchema = z.object({
  id: ArchitectureOptionIdSchema,
  generationId: ArchitectureGenerationIdSchema,
  projectId: ProjectIdSchema,
  graphVersion: z.number().int().positive(),
  generationVersion: z.number().int().positive(),
  profile: ArchitectureProfileSchema,
  name: z.string().min(5).max(200),
  summary: z.string().min(20).max(2_000),
  deploymentModel: z.string().min(10).max(1_000),
  components: z.array(z.object({ name: z.string().min(2).max(160), responsibility: z.string().min(10).max(1_000) }).strict()).min(2).max(20),
  dataFlows: z.array(z.string().min(10).max(1_000)).min(1).max(20),
  technologies: z.array(z.string().min(2).max(300)).min(1).max(20),
  why: z.array(z.string().min(10).max(1_000)).min(1).max(20),
  whyNot: z.array(z.string().min(10).max(1_000)).min(1).max(20),
  assumptions: z.array(z.string().min(10).max(1_000)).min(1).max(20),
  risks: z.array(z.string().min(10).max(1_000)).min(1).max(20),
  failureModes: z.array(z.object({ failure: z.string().min(10).max(1_000), mitigation: z.string().min(10).max(1_000) }).strict()).min(2).max(20),
  estimatedCost: z.object({
    range: z.literal('UNKNOWN'),
    basis: z.string().min(10).max(1_000),
    truthStatus: z.literal('UNKNOWN')
  }).strict(),
  reconsiderationTriggers: z.array(z.object({ metric: z.string().min(2).max(200), condition: z.string().min(10).max(1_000) }).strict()).min(1).max(20),
  scoreBreakdown: z.object({
    deliverySpeed: ArchitectureScoreSchema,
    operationalSimplicity: ArchitectureScoreSchema,
    scalability: ArchitectureScoreSchema,
    reliability: ArchitectureScoreSchema,
    costPredictability: ArchitectureScoreSchema
  }).strict(),
  sourceEntityIds: z.array(z.string().min(1)).max(1_000),
  truthStatus: z.literal('AI_SUGGESTED'),
  sha256: ArtifactHashSchema
}).strict();

export const ArchitectureGenerationSchema = z.object({
  id: ArchitectureGenerationIdSchema,
  projectId: ProjectIdSchema,
  graphVersion: z.number().int().positive(),
  version: z.number().int().positive(),
  contentHash: ArtifactHashSchema,
  compilerVersion: z.literal(ARCHITECTURE_COMPILER_VERSION),
  recommendedOptionId: ArchitectureOptionIdSchema,
  recommendationBasis: z.string().min(20).max(2_000),
  requirementDocumentHashes: z.object({ requirements: ArtifactHashSchema, srs: ArtifactHashSchema, nfr: ArtifactHashSchema }).strict(),
  options: z.array(ArchitectureOptionSchema).length(3),
  generatedAt: z.iso.datetime()
}).strict();

export const ArchitectureArtifactSchema = z.object({
  id: z.string().min(1).max(240),
  projectId: ProjectIdSchema,
  type: z.enum(['hld', 'adr']),
  version: z.number().int().positive(),
  sourceGraphVersion: z.number().int().positive(),
  title: z.string().min(1).max(240),
  content: z.string().min(1).max(200_000),
  sha256: ArtifactHashSchema,
  truthStatus: z.literal('HUMAN_APPROVED'),
  provenance: z.object({
    mode: z.literal('DETERMINISTIC_COMPILER'),
    compilerVersion: z.literal(ARCHITECTURE_COMPILER_VERSION),
    generationId: ArchitectureGenerationIdSchema,
    decisionId: z.string().regex(/^ADR-[A-Za-z0-9_-]{1,124}$/u),
    selectedOptionId: ArchitectureOptionIdSchema
  }).strict(),
  generatedAt: z.iso.datetime()
}).strict();

export const ArchitectureDecisionSchema = z.object({
  id: z.string().regex(/^ADR-[A-Za-z0-9_-]{1,124}$/u),
  projectId: ProjectIdSchema,
  graphVersion: z.number().int().positive(),
  version: z.number().int().positive(),
  generationId: ArchitectureGenerationIdSchema,
  generationContentHash: ArtifactHashSchema,
  selectedOptionId: ArchitectureOptionIdSchema,
  selectedOptionHash: ArtifactHashSchema,
  comment: z.string().min(10).max(2_000),
  rejectedAlternatives: z.array(z.object({ optionId: ArchitectureOptionIdSchema, whyRejected: z.array(z.string().min(1)).min(1) }).strict()).length(2),
  truthStatus: z.literal('HUMAN_APPROVED'),
  approvedByUserId: z.string().min(1).max(160),
  approvedAt: z.iso.datetime()
}).strict();

export const ArchitectureBaselineSchema = z.object({
  projectId: ProjectIdSchema,
  graphVersion: z.number().int().nonnegative(),
  generation: ArchitectureGenerationSchema.nullable(),
  decision: ArchitectureDecisionSchema.nullable(),
  artifacts: z.array(ArchitectureArtifactSchema).max(2)
}).strict();

export const GenerateArchitectureRequestSchema = z.object({ sourceGraphVersion: z.number().int().positive() }).strict();
export const ApproveArchitectureRequestSchema = z.object({
  sourceGraphVersion: z.number().int().positive(),
  generationId: ArchitectureGenerationIdSchema,
  generationContentHash: ArtifactHashSchema,
  selectedOptionId: ArchitectureOptionIdSchema,
  selectedOptionHash: ArtifactHashSchema,
  comment: z.string().trim().min(10).max(2_000)
}).strict();

export const ArchitectureMutationResponseSchema = z.object({
  project: ProjectResponseSchema,
  baseline: ArchitectureBaselineSchema,
  replayed: z.boolean()
}).strict();

export type ArchitectureOption = z.infer<typeof ArchitectureOptionSchema>;
export type ArchitectureGeneration = z.infer<typeof ArchitectureGenerationSchema>;
export type ArchitectureDecision = z.infer<typeof ArchitectureDecisionSchema>;
export type ArchitectureArtifact = z.infer<typeof ArchitectureArtifactSchema>;
export type ArchitectureBaseline = z.infer<typeof ArchitectureBaselineSchema>;
