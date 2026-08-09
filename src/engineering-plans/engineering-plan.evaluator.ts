import {
  ENGINEERING_PLAN_DOMAINS,
  ENGINEERING_PLAN_EVALUATOR_VERSION,
  EngineeringPlanQualityReportSchema,
  EngineeringPlanSchema,
  type EngineeringPlanQualityReport
} from './engineering-plan.schema';

const PROHIBITED_EVIDENCE_CLAIMS = [
  /\bcertified compliant\b/iu,
  /\bproduction[- ]ready\b/iu,
  /\ball tests (?:pass|passed)\b/iu,
  /\bzero vulnerabilities\b/iu,
  /\bdeployed successfully\b/iu,
  /\bmeasured p(?:50|90|95|99)\b/iu,
  /\bguaranteed availability\b/iu
];

export function evaluateEngineeringPlan(input: { plan: unknown; validSourceEntityIds: readonly string[] }): EngineeringPlanQualityReport {
  const parsed = EngineeringPlanSchema.safeParse(input.plan);
  if (!parsed.success) {
    return EngineeringPlanQualityReportSchema.parse({
      evaluatorVersion: ENGINEERING_PLAN_EVALUATOR_VERSION,
      passed: false,
      findings: [{ code: 'SCHEMA_INVALID', severity: 'ERROR', message: 'Engineering Plan output does not match Engineering Plan v1.', recommendationId: null }],
      metrics: { schemaValid: false, requiredDomainCount: ENGINEERING_PLAN_DOMAINS.length, coveredDomainCount: 0, recommendationCount: 0, validSourceReferenceRate: 0, prohibitedClaimCount: 0 }
    });
  }

  const plan = parsed.data;
  const findings: Array<{ code: 'MISSING_DOMAIN' | 'INVALID_SOURCE_REFERENCE' | 'PROHIBITED_EVIDENCE_CLAIM'; severity: 'ERROR'; message: string; recommendationId: string | null }> = [];
  const coveredDomains = new Set(plan.recommendations.map((recommendation) => recommendation.domain));
  for (const domain of ENGINEERING_PLAN_DOMAINS) {
    if (!coveredDomains.has(domain)) findings.push({ code: 'MISSING_DOMAIN', severity: 'ERROR', message: `Required lifecycle domain ${domain} is missing.`, recommendationId: null });
  }
  const validSourceIds = new Set(input.validSourceEntityIds);
  let referenced = 0;
  let validReferences = 0;
  let prohibitedClaimCount = 0;
  for (const recommendation of plan.recommendations) {
    for (const sourceEntityId of recommendation.sourceEntityIds) {
      referenced += 1;
      if (validSourceIds.has(sourceEntityId)) validReferences += 1;
      else findings.push({ code: 'INVALID_SOURCE_REFERENCE', severity: 'ERROR', message: `Source entity ${sourceEntityId} is not part of the approved graph context.`, recommendationId: recommendation.id });
    }
    const prose = [recommendation.title, recommendation.recommendation, recommendation.rationale, ...recommendation.benefits, ...recommendation.tradeoffs, recommendation.verification.method, recommendation.verification.evidenceExpected].join(' ');
    if (PROHIBITED_EVIDENCE_CLAIMS.some((pattern) => pattern.test(prose))) {
      prohibitedClaimCount += 1;
      findings.push({ code: 'PROHIBITED_EVIDENCE_CLAIM', severity: 'ERROR', message: 'Recommendation asserts certification, execution, measurement, or production readiness without immutable evidence.', recommendationId: recommendation.id });
    }
  }
  return EngineeringPlanQualityReportSchema.parse({
    evaluatorVersion: ENGINEERING_PLAN_EVALUATOR_VERSION,
    passed: findings.length === 0,
    findings,
    metrics: {
      schemaValid: true,
      requiredDomainCount: ENGINEERING_PLAN_DOMAINS.length,
      coveredDomainCount: coveredDomains.size,
      recommendationCount: plan.recommendations.length,
      validSourceReferenceRate: referenced === 0 ? 0 : validReferences / referenced,
      prohibitedClaimCount
    }
  });
}
