import { describe, expect, it } from 'vitest';

import { compileArchitectureGeneration } from '../src/architecture/architecture.compiler';
import { evaluateEngineeringPlan } from '../src/engineering-plans/engineering-plan.evaluator';
import { ENGINEERING_PLAN_DOMAINS, EngineeringPlanSchema } from '../src/engineering-plans/engineering-plan.schema';
import { generateFixtureEngineeringPlan, type EngineeringPlanContext } from '../src/engineering-plans/fixture-engineering-plan.generator';

function context(): EngineeringPlanContext {
  const entities = [
    { id: 'REQ-APPROVAL', category: 'REQUIREMENT', text: 'An authorized reviewer shall approve exact lifecycle decisions.', truthStatus: 'SOURCE_GROUNDED' as const },
    { id: 'NFR-SECURITY', category: 'NFR', text: 'Tenant access shall be denied by default and tested at API and repository boundaries.', truthStatus: 'HUMAN_CONFIRMED' as const }
  ];
  const generation = compileArchitectureGeneration({
    generationId: 'ARCHGEN-PLAN', generationVersion: 1, projectId: 'PROJ-PLAN', projectName: 'Plan Product', graphVersion: 1,
    graphSummary: 'A grounded commercial engineering product.', entities, gaps: [],
    requirementDocumentHashes: { requirements: 'a'.repeat(64), srs: 'b'.repeat(64), nfr: 'c'.repeat(64) },
    generatedAt: '2026-07-24T00:00:00.000Z'
  });
  return {
    projectId: 'PROJ-PLAN', projectName: 'Plan Product', projectStatus: 'HLD_READY', graphVersion: 1,
    artifactApprovalId: 'DOCAPP-PLAN', architectureDecisionId: 'ADR-PLAN', selectedOption: generation.options[1]!,
    alternativeOptions: [generation.options[0]!, generation.options[2]!], entities, openNonCriticalGaps: []
  };
}

function plan() {
  return generateFixtureEngineeringPlan({
    ...context(), planId: 'EPLAN-PLAN', promptVersion: 'engineering-plan-grounded-v1',
    workflowVersion: 'engineering-plan-workflow-v1', generatedAt: '2026-07-24T00:00:00.000Z'
  });
}

describe('full-lifecycle Engineering Plan', () => {
  it('covers every lifecycle domain with grounded, reviewable advice', () => {
    const generated = EngineeringPlanSchema.parse(plan());
    const report = evaluateEngineeringPlan({ plan: generated, validSourceEntityIds: context().entities.map((entity) => entity.id) });
    expect(report.passed).toBe(true);
    expect(new Set(generated.recommendations.map((recommendation) => recommendation.domain))).toEqual(new Set(ENGINEERING_PLAN_DOMAINS));
    expect(generated.recommendations.every((recommendation) => recommendation.truthStatus === 'AI_SUGGESTED')).toBe(true);
    expect(generated.recommendations.every((recommendation) => recommendation.alternatives[0]!.whyNotNow.length > 0 && recommendation.verification.evidenceExpected.length > 0)).toBe(true);
    expect(report.metrics.validSourceReferenceRate).toBe(1);
  });

  it('rejects a missing domain even when the output still has twelve recommendations', () => {
    const generated = plan();
    generated.recommendations[0] = { ...generated.recommendations[0]!, id: 'EREC-DUPLICATE', domain: 'DATA' };
    const report = evaluateEngineeringPlan({ plan: generated, validSourceEntityIds: context().entities.map((entity) => entity.id) });
    expect(report.passed).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'MISSING_DOMAIN' }));
  });

  it('rejects invented source references and unexecuted assurance claims', () => {
    const generated = plan();
    generated.recommendations[0] = {
      ...generated.recommendations[0]!,
      recommendation: 'The system is production-ready and should preserve this implementation without further evidence.',
      sourceEntityIds: ['REQ-INVENTED']
    };
    const report = evaluateEngineeringPlan({ plan: generated, validSourceEntityIds: context().entities.map((entity) => entity.id) });
    expect(report.passed).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'INVALID_SOURCE_REFERENCE' }));
    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'PROHIBITED_EVIDENCE_CLAIM' }));
  });

  it('is deterministic for the same approved baseline and timestamp', () => {
    expect(plan()).toEqual(plan());
  });
});
