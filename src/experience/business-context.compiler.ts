import { createHash } from 'node:crypto';

import {
  BUSINESS_CONTEXT_COMPILER_VERSION,
  BusinessContextPreviewSchema,
  type BusinessContextTruthStatus
} from './business-context.schema';

export type BusinessContextEntity = Readonly<{
  id: string;
  category: string;
  text: string;
  truthStatus: BusinessContextTruthStatus;
  sourceId: string | null;
}>;

export type CompileBusinessContextInput = Readonly<{
  projectId: string;
  graphVersion: number;
  analyzedAt: string;
  entities: ReadonlyArray<BusinessContextEntity>;
  blockingGapIds: ReadonlyArray<string>;
}>;

const OUTCOME_PATTERN = /\b(goal|outcome|objective|increase|decrease|reduce|improve|revenue|conversion|retention|adoption|satisfaction|success)\b/iu;
const ACTOR_PATTERN = /\b(users?|customers?|administrators?|admins?|members?|operators?|reviewers?|developers?|managers?|owners?|analysts?|patients?|clinicians?|buyers?|sellers?|agents?|teams?)\b/iu;
const WORKFLOW_PATTERN = /\b(shall|must|needs? to|submit|review|approve|create|update|delete|publish|upload|download|invite|manage|complete|process|notify|search|filter|export)\b/iu;
const MEASURE_PATTERN = /\b(metric|measure|target|kpi|p\d{2}|latency|throughput|availability|conversion|retention|adoption|cost|revenue|percent|percentage|milliseconds?|seconds?|minutes?|hours?)\b|\d+(?:\.\d+)?\s*(?:%|ms|s|min|hours?)(?=\s|[.,;:]|$)/iu;
const EXPLICIT_NON_VISUAL_PATTERN = /\b(api[- ]only|headless|infrastructure[- ]only|backend[- ]only|no (?:user interface|ui|screen|web interface)|without a (?:user interface|ui|screen|web interface))\b/iu;
const EXPERIENCE_PATTERN = /\b(user interface|ui|screen|page|dashboard|form|browser portal|web portal|mobile app|website|checkout|onboarding|editor|canvas)\b/iu;

function stableId(prefix: 'OUT' | 'ACT' | 'FLOW' | 'MEASURE', projectId: string, entityId: string) {
  return `BC-${prefix}-${createHash('sha256').update(`${projectId}:${prefix}:${entityId}`, 'utf8').digest('hex').slice(0, 16).toUpperCase()}`;
}

function item(prefix: 'OUT' | 'ACT' | 'FLOW' | 'MEASURE', kind: 'OUTCOME' | 'ACTOR' | 'WORKFLOW' | 'SUCCESS_MEASURE', projectId: string, entity: BusinessContextEntity) {
  return {
    id: stableId(prefix, projectId, entity.id),
    kind,
    statement: entity.text,
    truthStatus: entity.truthStatus,
    sourceEntityId: entity.id,
    sourceId: entity.sourceId
  } as const;
}

function applicability(entities: ReadonlyArray<BusinessContextEntity>) {
  const explicitNonVisual = entities.filter((entity) => EXPLICIT_NON_VISUAL_PATTERN.test(entity.text));
  if (explicitNonVisual.length > 0) {
    return {
      status: 'NOT_APPLICABLE' as const,
      rationale: 'The approved current graph explicitly describes the scope as non-visual. A human must change that canonical statement before Axiom proposes screens.',
      sourceEntityIds: explicitNonVisual.map((entity) => entity.id),
      decisionRequired: false
    };
  }
  const experienceSignals = entities.filter((entity) => EXPERIENCE_PATTERN.test(entity.text));
  if (experienceSignals.length > 0) {
    return {
      status: 'APPLICABLE' as const,
      rationale: 'The approved current graph explicitly references a user-facing experience. An Experience Baseline is required before downstream experience-relevant scope is finalized.',
      sourceEntityIds: experienceSignals.map((entity) => entity.id),
      decisionRequired: false
    };
  }
  return {
    status: 'NEEDS_DECISION' as const,
    rationale: 'The current graph neither requires a user-facing experience nor explicitly excludes one. Axiom will not invent screens or silently skip experience design.',
    sourceEntityIds: [],
    decisionRequired: true
  };
}

export function compileBusinessContext(input: CompileBusinessContextInput) {
  const outcomes = input.entities.filter((entity) => OUTCOME_PATTERN.test(entity.text)).map((entity) => item('OUT', 'OUTCOME', input.projectId, entity));
  const actors = input.entities.filter((entity) => ACTOR_PATTERN.test(entity.text)).map((entity) => item('ACT', 'ACTOR', input.projectId, entity));
  const workflows = input.entities.filter((entity) => entity.category === 'REQUIREMENT' && WORKFLOW_PATTERN.test(entity.text)).map((entity) => item('FLOW', 'WORKFLOW', input.projectId, entity));
  const successMeasures = input.entities.filter((entity) => entity.category === 'NFR' || MEASURE_PATTERN.test(entity.text)).map((entity) => item('MEASURE', 'SUCCESS_MEASURE', input.projectId, entity));
  const experienceApplicability = applicability(input.entities);
  const classifiedIds = new Set([...outcomes, ...actors, ...workflows, ...successMeasures].map((entry) => entry.sourceEntityId));
  const unknowns = [
    ...(outcomes.length === 0 ? [{ code: 'UNKNOWN_BUSINESS_OUTCOME' as const, question: 'Which measurable business outcome should this product change?', whyItMatters: 'Delivery scope cannot be evaluated against business value until an authorized stakeholder confirms the intended outcome.' }] : []),
    ...(actors.length === 0 ? [{ code: 'UNKNOWN_ACTOR' as const, question: 'Which actors perform or receive the affected workflow?', whyItMatters: 'User journeys, permissions, and acceptance evidence depend on explicit actors.' }] : []),
    ...(workflows.length === 0 ? [{ code: 'UNKNOWN_OPERATING_WORKFLOW' as const, question: 'Which end-to-end operating workflow is in scope?', whyItMatters: 'Axiom cannot propose a coherent experience or delivery plan from isolated features.' }] : []),
    ...(successMeasures.length === 0 ? [{ code: 'UNKNOWN_SUCCESS_MEASURE' as const, question: 'How will the business know this product outcome succeeded?', whyItMatters: 'An observable success measure is required to verify impact instead of merely shipping output.' }] : []),
    ...(experienceApplicability.status === 'NEEDS_DECISION' ? [{ code: 'UNKNOWN_EXPERIENCE_APPLICABILITY' as const, question: 'Does this scope require a user-facing experience?', whyItMatters: 'The answer determines whether an approved Experience Baseline is required before architecture and delivery scope.' }] : [])
  ];
  const core = {
    schemaVersion: 'business-context-preview-v1' as const,
    compilerVersion: BUSINESS_CONTEXT_COMPILER_VERSION,
    projectId: input.projectId,
    sourceGraphVersion: input.graphVersion,
    compiledAt: input.analyzedAt,
    applicability: experienceApplicability,
    outcomes,
    actors,
    workflows,
    successMeasures,
    unknowns,
    blockingGapIds: [...input.blockingGapIds],
    coverage: {
      eligibleEntityCount: input.entities.length,
      classifiedEntityCount: classifiedIds.size,
      unclassifiedEntityIds: input.entities.filter((entity) => !classifiedIds.has(entity.id)).map((entity) => entity.id)
    }
  };
  const contentHash = createHash('sha256').update(JSON.stringify(core), 'utf8').digest('hex');
  return BusinessContextPreviewSchema.parse({ ...core, contentHash });
}
