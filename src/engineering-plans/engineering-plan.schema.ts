import { z } from 'zod';

import { GenerationProvenanceSchema, ModelTierSchema } from '../agent-kernel/agent-kernel.schema';
import { ProjectIdSchema } from '../projects/project.schema';
import {
  ENGINEERING_REFERENCE_CATALOG_VERSION,
  EngineeringReferenceIdSchema,
  EngineeringReferenceSchema
} from './engineering-reference.catalog';

export const ENGINEERING_PLAN_SCHEMA_VERSION = 'engineering-plan-v1' as const;
export const ENGINEERING_PLAN_EVALUATOR_VERSION = 'engineering-plan-quality-v1' as const;

export const EngineeringPlanDomainSchema = z.enum([
  'PRODUCT_SCOPE',
  'USER_EXPERIENCE_ACCESSIBILITY',
  'ARCHITECTURE_TECH_STACK',
  'DATA',
  'API_INTEGRATION',
  'TESTING_QUALITY',
  'SECURITY_PRIVACY',
  'DELIVERY_CI_CD',
  'DEPLOYMENT_CLOUD_INFRA',
  'RELIABILITY_OBSERVABILITY',
  'COST_FINOPS',
  'OPERATIONS_SUPPORT'
]);
export type EngineeringPlanDomain = z.infer<typeof EngineeringPlanDomainSchema>;
export const ENGINEERING_PLAN_DOMAINS = EngineeringPlanDomainSchema.options;

export const EngineeringPlanDispositionSchema = z.enum(['RECOMMENDED', 'CONDITIONAL', 'NOT_RECOMMENDED', 'NEEDS_DECISION']);

const EngineeringRiskSchema = z.object({
  risk: z.string().trim().min(12).max(1_000),
  impact: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  mitigation: z.string().trim().min(12).max(1_000)
}).strict();

const EngineeringAlternativeSchema = z.object({
  name: z.string().trim().min(2).max(200),
  whyNotNow: z.string().trim().min(12).max(1_000),
  reconsiderWhen: z.string().trim().min(12).max(1_000)
}).strict();

export const EngineeringRecommendationSchema = z.object({
  id: z.string().regex(/^EREC-[A-Za-z0-9_-]{1,120}$/u),
  domain: EngineeringPlanDomainSchema,
  disposition: EngineeringPlanDispositionSchema,
  title: z.string().trim().min(8).max(200),
  recommendation: z.string().trim().min(20).max(3_000),
  rationale: z.string().trim().min(20).max(3_000),
  benefits: z.array(z.string().trim().min(10).max(1_000)).min(1).max(12),
  tradeoffs: z.array(z.string().trim().min(10).max(1_000)).min(1).max(12),
  risks: z.array(EngineeringRiskSchema).min(1).max(12),
  alternatives: z.array(EngineeringAlternativeSchema).min(1).max(8),
  implementationActions: z.array(z.string().trim().min(10).max(1_000)).min(1).max(20),
  verification: z.object({
    method: z.string().trim().min(15).max(2_000),
    evidenceExpected: z.string().trim().min(15).max(2_000)
  }).strict(),
  sourceEntityIds: z.array(z.string().min(2).max(160)).min(1).max(100),
  referenceIds: z.array(EngineeringReferenceIdSchema).min(1).max(10),
  truthStatus: z.literal('AI_SUGGESTED')
}).strict();

export const EngineeringPlanSchema = z.object({
  id: z.string().regex(/^EPLAN-[A-Za-z0-9_-]{1,120}$/u),
  schemaVersion: z.literal(ENGINEERING_PLAN_SCHEMA_VERSION),
  promptVersion: z.string().min(1).max(100),
  workflowVersion: z.string().min(1).max(100),
  referenceCatalogVersion: z.literal(ENGINEERING_REFERENCE_CATALOG_VERSION),
  projectId: ProjectIdSchema,
  sourceGraphVersion: z.number().int().positive(),
  artifactApprovalId: z.string().min(2).max(160),
  architectureDecisionId: z.string().min(2).max(160),
  architectureOptionId: z.string().min(2).max(160),
  executiveSummary: z.string().trim().min(30).max(4_000),
  recommendations: z.array(EngineeringRecommendationSchema).min(ENGINEERING_PLAN_DOMAINS.length).max(48),
  unknowns: z.array(z.object({
    id: z.string().regex(/^EUNKNOWN-[A-Za-z0-9_-]{1,116}$/u),
    domain: EngineeringPlanDomainSchema,
    question: z.string().trim().min(12).max(1_000),
    whyItMatters: z.string().trim().min(12).max(1_000),
    affectedSourceEntityIds: z.array(z.string().min(2).max(160)).max(100),
    blocking: z.boolean()
  }).strict()).max(100),
  nextGates: z.array(z.object({
    sequence: z.number().int().positive(),
    title: z.string().trim().min(5).max(200),
    exitCriteria: z.array(z.string().trim().min(10).max(1_000)).min(1).max(12),
    evidenceRequired: z.array(z.string().trim().min(10).max(1_000)).min(1).max(12)
  }).strict()).min(3).max(20),
  truthStatus: z.literal('AI_SUGGESTED'),
  generatedAt: z.iso.datetime()
}).strict().superRefine((plan, context) => {
  const ids = new Set<string>();
  for (const [index, recommendation] of plan.recommendations.entries()) {
    if (ids.has(recommendation.id)) context.addIssue({ code: 'custom', message: 'Recommendation IDs must be unique', path: ['recommendations', index, 'id'] });
    ids.add(recommendation.id);
  }
  const sequences = plan.nextGates.map((gate) => gate.sequence);
  if (new Set(sequences).size !== sequences.length) context.addIssue({ code: 'custom', message: 'Gate sequences must be unique', path: ['nextGates'] });
});

export const EngineeringPlanFindingSchema = z.object({
  code: z.enum(['SCHEMA_INVALID', 'MISSING_DOMAIN', 'INVALID_SOURCE_REFERENCE', 'PROHIBITED_EVIDENCE_CLAIM']),
  severity: z.enum(['ERROR', 'WARNING']),
  message: z.string().min(1).max(1_000),
  recommendationId: z.string().nullable()
}).strict();

export const EngineeringPlanQualityReportSchema = z.object({
  evaluatorVersion: z.literal(ENGINEERING_PLAN_EVALUATOR_VERSION),
  passed: z.boolean(),
  findings: z.array(EngineeringPlanFindingSchema).max(500),
  metrics: z.object({
    schemaValid: z.boolean(),
    requiredDomainCount: z.number().int().nonnegative(),
    coveredDomainCount: z.number().int().nonnegative(),
    recommendationCount: z.number().int().nonnegative(),
    validSourceReferenceRate: z.number().min(0).max(1),
    prohibitedClaimCount: z.number().int().nonnegative()
  }).strict()
}).strict();

export const GenerateEngineeringPlanRequestSchema = z.object({
  sourceGraphVersion: z.number().int().positive(),
  tier: ModelTierSchema
}).strict();

export const EngineeringPlanPreviewSchema = z.object({
  id: EngineeringPlanSchema.shape.id,
  version: z.number().int().positive(),
  status: z.literal('DRAFT'),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  plan: EngineeringPlanSchema,
  qualityReport: EngineeringPlanQualityReportSchema,
  provenance: GenerationProvenanceSchema.nullable(),
  references: z.array(EngineeringReferenceSchema).max(20),
  replayed: z.boolean()
}).strict();

export type EngineeringPlan = z.infer<typeof EngineeringPlanSchema>;
export type EngineeringPlanQualityReport = z.infer<typeof EngineeringPlanQualityReportSchema>;
export type EngineeringPlanPreview = z.infer<typeof EngineeringPlanPreviewSchema>;
