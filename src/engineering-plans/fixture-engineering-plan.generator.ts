import type { ArchitectureOption } from '../architecture/architecture.schema';
import {
  ENGINEERING_PLAN_SCHEMA_VERSION,
  type EngineeringPlan,
  type EngineeringPlanDomain
} from './engineering-plan.schema';
import { ENGINEERING_REFERENCE_CATALOG_VERSION, type EngineeringReferenceId } from './engineering-reference.catalog';

export type EngineeringPlanEntity = {
  id: string;
  category: string;
  text: string;
  truthStatus: 'SOURCE_GROUNDED' | 'HUMAN_CONFIRMED';
};

export type EngineeringPlanGap = {
  id: string;
  title: string;
  description: string;
  affectedEntityIds: string[];
  severity: string;
};

export type EngineeringPlanContext = {
  projectId: string;
  projectName: string;
  projectStatus: string;
  graphVersion: number;
  artifactApprovalId: string;
  architectureDecisionId: string;
  selectedOption: ArchitectureOption;
  alternativeOptions: ArchitectureOption[];
  entities: EngineeringPlanEntity[];
  openNonCriticalGaps: EngineeringPlanGap[];
};

type RecommendationSeed = {
  domain: EngineeringPlanDomain;
  title: string;
  recommendation: (context: EngineeringPlanContext) => string;
  rationale: string;
  benefit: string;
  tradeoff: string;
  risk: string;
  mitigation: string;
  alternative: string;
  whyNotNow: string;
  reconsiderWhen: string;
  action: string;
  verificationMethod: string;
  evidenceExpected: string;
  referenceIds: EngineeringReferenceId[];
};

const SEEDS: RecommendationSeed[] = [
  {
    domain: 'PRODUCT_SCOPE', title: 'Keep product scope bound to approved outcomes',
    recommendation: () => 'Use the approved requirement graph as the release-scope authority and require an explicit graph change for new behavior.',
    rationale: 'A stable approved baseline prevents implementation work from silently expanding beyond supported business intent.',
    benefit: 'Teams can trace delivered behavior to approved business outcomes and identify uncovered intent.',
    tradeoff: 'Material discoveries require a deliberate clarification and approval cycle before downstream work continues.',
    risk: 'Teams may bypass the graph when delivery pressure increases.', mitigation: 'Block downstream generation when the current graph and approvals no longer match.',
    alternative: 'Allow teams to add scope directly in delivery tools', whyNotNow: 'Direct scope additions would weaken canonical traceability and approval evidence.', reconsiderWhen: 'Reconsider only if a governed connector can create the same graph mutation and approval evidence.',
    action: 'Review goals, actors, business rules, constraints, and open noncritical gaps before implementation planning.',
    verificationMethod: 'Compare approved requirement IDs with the resulting plan, backlog, and release evidence.', evidenceExpected: 'A traceability report identifies coverage and every intentionally deferred requirement.',
    referenceIds: ['NIST_AI_RMF_1_0']
  },
  {
    domain: 'USER_EXPERIENCE_ACCESSIBILITY', title: 'Design complete accessible user journeys',
    recommendation: () => 'Define primary journeys, failure recovery, keyboard operation, semantic structure, and non-color status communication before interface implementation.',
    rationale: 'Accessibility and honest asynchronous states are design inputs rather than a final automated scan.',
    benefit: 'Users receive clearer workflows and fewer inaccessible or misleading status transitions.', tradeoff: 'Journey review adds design work before feature completion.',
    risk: 'Automated checks may be mistaken for accessibility conformance.', mitigation: 'Require automated, keyboard, and human review evidence separately.',
    alternative: 'Run only an automated accessibility scanner after development', whyNotNow: 'Automated scanning cannot establish complete journey usability or conformance.', reconsiderWhen: 'Do not replace human review; reconsider tooling only when it improves evidence coverage.',
    action: 'Document idle, loading, empty, partial failure, failure, cancellation, retry, and success states for each asynchronous journey.',
    verificationMethod: 'Execute automated accessibility checks plus keyboard and human journey reviews.', evidenceExpected: 'Separate immutable scan output, keyboard review notes, and human findings linked to the affected requirements.',
    referenceIds: ['WCAG_2_2']
  },
  {
    domain: 'ARCHITECTURE_TECH_STACK', title: 'Implement the approved architecture profile',
    recommendation: (context) => `Use the approved ${context.selectedOption.name} profile with its selected technologies: ${context.selectedOption.technologies.join(', ')}.`,
    rationale: 'Technology choices should follow the approved architecture trade-offs rather than popularity or an unconstrained model preference.',
    benefit: 'Implementation, operations, and cost discussions share one approved technical baseline.', tradeoff: 'The approved option may optimize near-term simplicity over maximum theoretical scale.',
    risk: 'Technology choices may outlive the assumptions that justified them.', mitigation: 'Track the architecture option reconsideration triggers and measured workload evidence.',
    alternative: 'Adopt another generated architecture profile', whyNotNow: 'The authorized architecture decision selected a different balance of delivery, operations, reliability, scale, and cost.', reconsiderWhen: 'Reconsider when an approved architecture trigger is met by measured evidence.',
    action: 'Translate each approved component and data flow into module boundaries, explicit interface contracts, and a versioned coding profile for generated patches.',
    verificationMethod: 'Review the implementation topology against the approved ADR, HLD, component responsibilities, and data flows.', evidenceExpected: 'Architecture conformance review findings cite component and interface evidence without asserting unexecuted runtime behavior.',
    referenceIds: ['AWS_WELL_ARCHITECTED', 'AWS_SAAS_LENS']
  },
  {
    domain: 'DATA', title: 'Treat PostgreSQL-backed structured data as authoritative',
    recommendation: () => 'Design tenant-scoped schemas, constraints, migrations, retention, backup, restore, and deletion behavior before data-dependent features are considered complete.',
    rationale: 'Data integrity and lifecycle behavior are product requirements, not infrastructure implementation details.',
    benefit: 'Stable identities, tenant isolation, rollback safety, and traceability remain enforceable at persistence boundaries.', tradeoff: 'Schema evolution requires reviewed migrations and rollback exercises.',
    risk: 'Application-only validation may permit cross-tenant or inconsistent rows.', mitigation: 'Combine repository scoping, database constraints, transaction boundaries, and integration tests.',
    alternative: 'Use provider-specific database features as the primary domain contract', whyNotNow: 'That would reduce portability and make application semantics depend on one managed service.', reconsiderWhen: 'Reconsider a proprietary feature only through an ADR with portability and recovery evidence.',
    action: 'Define entity ownership, keys, constraints, retention classes, migration order, and restoration checks.',
    verificationMethod: 'Run repository integration, migration, rollback, tenant-isolation, backup, and restore exercises.', evidenceExpected: 'Database command output and restoration checks are stored as immutable executed evidence.',
    referenceIds: ['POSTGRESQL']
  },
  {
    domain: 'API_INTEGRATION', title: 'Use explicit versioned API and connector contracts',
    recommendation: () => 'Define versioned OpenAPI and provider-neutral connector contracts with server-side authorization, validation, idempotency, and failure semantics.',
    rationale: 'Explicit contracts prevent UI, provider, and domain assumptions from becoming hidden coupling.',
    benefit: 'Clients and external integrations can be tested independently against stable request and response behavior.', tradeoff: 'Contract changes require compatibility and migration management.',
    risk: 'Retries may duplicate external side effects.', mitigation: 'Require immutable previews, explicit approval, idempotency records, provider request IDs, and reconciliation.',
    alternative: 'Let the web application call provider APIs directly', whyNotNow: 'Browser-owned provider logic would expose secrets and bypass shared authorization, budget, and audit controls.', reconsiderWhen: 'Do not reconsider unless the operation is demonstrably public, read-only, and outside customer authorization boundaries.',
    action: 'Specify API schemas, authorization rules, error states, rate-limit behavior, and idempotency semantics before connector implementation.',
    verificationMethod: 'Run OpenAPI validation, provider contract tests, tenant tests, and idempotent retry scenarios.', evidenceExpected: 'Contract results include exact request IDs, outcomes, and duplicate-creation counts.',
    referenceIds: ['OPENAPI_3_1', 'OWASP_API_SECURITY_2023']
  },
  {
    domain: 'TESTING_QUALITY', title: 'Build risk-based verification at every delivery layer',
    recommendation: () => 'Map requirements and risks to domain, repository, API contract, integration, security, accessibility, end-to-end, migration, recovery, and load checks as applicable.',
    rationale: 'A single test layer cannot verify business behavior, persistence integrity, integration contracts, and operational readiness.',
    benefit: 'Failures are detected at the narrowest useful layer while release evidence remains traceable.', tradeoff: 'Broader verification increases build time and test-data maintenance.',
    risk: 'Teams may report test success without executing the complete required set.', mitigation: 'Store execution status and raw output, and keep unexecuted checks UNKNOWN.',
    alternative: 'Rely mainly on end-to-end tests', whyNotNow: 'End-to-end tests are slower, harder to diagnose, and do not replace domain or contract verification.', reconsiderWhen: 'Adjust the layer mix when measured defect escape and build-duration evidence supports a change.',
    action: 'Create a requirement-to-verification matrix and repository-owned allowlisted commands.',
    verificationMethod: 'Execute the approved commands in bounded runners and compare evidence with the verification matrix.', evidenceExpected: 'Each required check records command identity, timing, exit status, parsed metrics, and immutable raw output.',
    referenceIds: ['NIST_SSDF_1_1', 'OWASP_ASVS_5_0_0']
  },
  {
    domain: 'SECURITY_PRIVACY', title: 'Integrate threat-driven security and privacy controls',
    recommendation: () => 'Define trust boundaries, tenant threats, authorization rules, secret handling, data flows, provider disclosure, secure development checks, and incident responsibilities before release.',
    rationale: 'Security and privacy require design, implementation, verification, and operational controls across the lifecycle.',
    benefit: 'High-risk assumptions become explicit controls and testable requirements.', tradeoff: 'Security review can block release until material risks have owned treatment.',
    risk: 'AI output or automated scans may be presented as a security assurance claim.', mitigation: 'Keep recommendations AI_SUGGESTED and require executed evidence plus qualified human review.',
    alternative: 'Perform security review only before production launch', whyNotNow: 'Late review makes architectural and data-flow issues costly to correct.', reconsiderWhen: 'Do not remove continuous review; tune depth according to risk and change scope.',
    action: 'Create a versioned threat model and map applicable controls to owned verification activities.',
    verificationMethod: 'Run secret, dependency, static, container, authorization, tenant-isolation, and targeted manual security checks.', evidenceExpected: 'Findings preserve tool identity, scope, severity policy, raw evidence, disposition, and retest status.',
    referenceIds: ['OWASP_ASVS_5_0_0', 'OWASP_API_SECURITY_2023', 'OWASP_AISVS_1_0', 'NIST_SSDF_1_1']
  },
  {
    domain: 'DELIVERY_CI_CD', title: 'Use staged, policy-gated delivery automation',
    recommendation: () => 'Build reproducible CI/CD stages for linting, type checks, tests, security checks, artifacts, migrations, deployment approval, health checks, and rollback.',
    rationale: 'Delivery automation should enforce the same evidence and approval boundaries as the product workflow.',
    benefit: 'Changes progress through repeatable gates with attributable evidence.', tradeoff: 'Strict gates require ownership for flaky checks and emergency procedures.',
    risk: 'A pipeline may promote an artifact after partial or stale verification.', mitigation: 'Bind promotion to immutable artifact hashes and current required check results.',
    alternative: 'Use manual production builds and deployments', whyNotNow: 'Manual packaging weakens reproducibility, provenance, and rollback confidence.', reconsiderWhen: 'Manual intervention should remain an audited emergency path, not the normal release mechanism.',
    action: 'Define branch, artifact, environment, approval, migration, health, and rollback policies as code.',
    verificationMethod: 'Exercise success, failed gate, cancelled run, migration failure, health-check failure, and rollback scenarios.', evidenceExpected: 'Pipeline evidence links the exact source revision, artifact digest, environment, approvals, and terminal outcomes.',
    referenceIds: ['NIST_SSDF_1_1']
  },
  {
    domain: 'DEPLOYMENT_CLOUD_INFRA', title: 'Provision reviewed AWS infrastructure through Terraform',
    recommendation: (context) => `Translate the approved deployment model into reviewed Terraform for the authorized AWS environment; current deployment intent is: ${context.selectedOption.deploymentModel}`,
    rationale: 'Infrastructure changes need reproducibility, review, cost boundaries, and rollback rather than model-generated direct provisioning.',
    benefit: 'Environment differences, access controls, network boundaries, encryption, scaling, and recovery settings remain reviewable.', tradeoff: 'Infrastructure-as-code adds planning and state-management responsibilities.',
    risk: 'A plan or model response may be mistaken for an executed cloud deployment.', mitigation: 'Require explicit authorization and real Terraform, platform, and health evidence before changing truth status.',
    alternative: 'Let an agent create cloud resources directly from recommendations', whyNotNow: 'That could create cost, security, and data-residency impact without reviewed infrastructure or approval.', reconsiderWhen: 'Only consider bounded automation after policy, preview, budget, approval, and reconciliation controls are proven.',
    action: 'Define environment composition, network boundaries, compute, database, object storage, queueing, secrets, telemetry, backups, budgets, and rollback.',
    verificationMethod: 'Validate Terraform, inspect the exact plan, run security and policy checks, and execute authorized staging deployment and rollback exercises.', evidenceExpected: 'Reviewed plan, apply result, resource identifiers, health checks, rollback result, and cost-budget configuration are stored separately.',
    referenceIds: ['AWS_WELL_ARCHITECTED', 'AWS_SAAS_LENS']
  },
  {
    domain: 'RELIABILITY_OBSERVABILITY', title: 'Define reliability targets and correlated telemetry before launch',
    recommendation: () => 'Specify service indicators, objectives, failure states, retry limits, backup and recovery goals, dashboards, alerts, and trace correlation without inventing target achievements.',
    rationale: 'Reliable operation requires measurable expectations and evidence from the deployed environment.',
    benefit: 'Teams can detect failures, diagnose impact, and prioritize reliability work using shared signals.', tradeoff: 'Telemetry volume and retention create operational cost and privacy considerations.',
    risk: 'Logs or traces may leak customer content or cross-tenant identifiers.', mitigation: 'Use structured redacted attributes, access controls, retention limits, and tenant-safe correlation.',
    alternative: 'Add logs only after incidents occur', whyNotNow: 'Missing baseline telemetry makes incident diagnosis and reliability measurement unreliable.', reconsiderWhen: 'Tune signal detail and retention using measured diagnostic value, privacy risk, and cost.',
    action: 'Define logs, metrics, traces, dashboards, alerts, SLO candidates, backup schedules, and restore exercises.',
    verificationMethod: 'Run failure injection, alert routing, trace correlation, backup, and restore checks in a non-production environment.', evidenceExpected: 'Observed telemetry, alert delivery, recovery timing, and restoration assertions remain immutable environment-specific evidence.',
    referenceIds: ['OPENTELEMETRY', 'AWS_WELL_ARCHITECTED']
  },
  {
    domain: 'COST_FINOPS', title: 'Use measured budgets and cost attribution instead of guessed totals',
    recommendation: () => 'Define request, user, project, organization, provider, and AWS budgets with reservation, reconciliation, alerts, and dated pricing evidence.',
    rationale: 'Model and cloud costs vary with workload and provider terms, so unsupported monetary estimates should remain UNKNOWN.',
    benefit: 'Teams can compare quality and operating cost without permitting uncontrolled spend.', tradeoff: 'Accurate attribution requires usage instrumentation and pricing maintenance.',
    risk: 'Stale pricing or missing reconciliation may understate actual cost.', mitigation: 'Version price metadata, retain raw usage, reconcile provider measurements, and alert on anomalies.',
    alternative: 'Choose the cheapest model or service by listed unit price', whyNotNow: 'Unit price alone ignores task quality, retries, latency, context size, operational work, and failure cost.', reconsiderWhen: 'Change routing only after current workload evaluations show the quality, latency, and total-cost trade-off.',
    action: 'Define product-credit conversion, provider pricing verification, cloud budgets, attribution tags, alerts, and cost-review cadence.',
    verificationMethod: 'Reconcile representative provider and infrastructure usage against ledger and billing exports.', evidenceExpected: 'Dated price metadata, raw usage, reconciliation differences, alerts, and approved budget changes are retained.',
    referenceIds: ['AWS_WELL_ARCHITECTED', 'NIST_AI_RMF_1_0']
  },
  {
    domain: 'OPERATIONS_SUPPORT', title: 'Prepare ownership, incident, support, and lifecycle runbooks',
    recommendation: () => 'Assign service ownership and document deployment, rollback, incident response, customer support, access, retention, deletion, dependency update, and provider outage procedures.',
    rationale: 'Commercial readiness includes repeatable human and technical operating procedures after deployment.',
    benefit: 'Incidents and customer-impacting changes have clear decision owners and recovery paths.', tradeoff: 'Runbooks require regular exercises and maintenance as architecture changes.',
    risk: 'Documentation may appear complete but fail during a real incident.', mitigation: 'Exercise runbooks and record gaps, owners, remediation, and follow-up evidence.',
    alternative: 'Rely on team knowledge and informal escalation', whyNotNow: 'Informal knowledge is difficult to audit, scale, transfer, or execute reliably under pressure.', reconsiderWhen: 'Simplify individual procedures only after exercises show the reduced process preserves outcomes.',
    action: 'Create an operational responsibility matrix and schedule recovery, incident, access, and deletion exercises.',
    verificationMethod: 'Run tabletop and technical exercises with explicit success criteria and follow-up ownership.', evidenceExpected: 'Exercise timeline, participants, observations, failed steps, remediation owners, and retest results are retained.',
    referenceIds: ['AWS_WELL_ARCHITECTED', 'NIST_SSDF_1_1']
  }
];

function sourceIds(context: EngineeringPlanContext, domain: EngineeringPlanDomain): string[] {
  const candidates = context.entities.filter((entity) => {
    if (domain === 'SECURITY_PRIVACY' || domain === 'TESTING_QUALITY' || domain === 'RELIABILITY_OBSERVABILITY') return entity.category === 'NFR' || entity.category === 'CONSTRAINT' || entity.category === 'RISK';
    return entity.category === 'REQUIREMENT' || entity.category === 'DECISION' || entity.category === 'CONSTRAINT';
  });
  const selected = candidates.length > 0 ? candidates : context.entities;
  return selected.slice(0, 5).map((entity) => entity.id);
}

export function generateFixtureEngineeringPlan(input: EngineeringPlanContext & { planId: string; promptVersion: string; workflowVersion: string; generatedAt: string }): EngineeringPlan {
  const alternativeNames = input.alternativeOptions.map((option) => option.name).join(' and ');
  return {
    id: input.planId,
    schemaVersion: ENGINEERING_PLAN_SCHEMA_VERSION,
    promptVersion: input.promptVersion,
    workflowVersion: input.workflowVersion,
    referenceCatalogVersion: ENGINEERING_REFERENCE_CATALOG_VERSION,
    projectId: input.projectId,
    sourceGraphVersion: input.graphVersion,
    artifactApprovalId: input.artifactApprovalId,
    architectureDecisionId: input.architectureDecisionId,
    architectureOptionId: input.selectedOption.id,
    executiveSummary: `${input.projectName} should progress through a governed engineering lifecycle using the approved ${input.selectedOption.name} architecture. Recommendations remain reviewable suggestions; unknowns and executed evidence determine whether each delivery gate can close.`,
    recommendations: SEEDS.map((seed) => ({
      id: `EREC-${seed.domain}`,
      domain: seed.domain,
      disposition: 'RECOMMENDED' as const,
      title: seed.title,
      recommendation: seed.recommendation(input),
      rationale: seed.rationale,
      benefits: [seed.benefit],
      tradeoffs: [seed.tradeoff],
      risks: [{ risk: seed.risk, impact: seed.domain === 'SECURITY_PRIVACY' || seed.domain === 'DEPLOYMENT_CLOUD_INFRA' ? 'HIGH' as const : 'MEDIUM' as const, mitigation: seed.mitigation }],
      alternatives: [{ name: seed.domain === 'ARCHITECTURE_TECH_STACK' && alternativeNames.length > 0 ? alternativeNames : seed.alternative, whyNotNow: seed.whyNotNow, reconsiderWhen: seed.reconsiderWhen }],
      implementationActions: [seed.action],
      verification: { method: seed.verificationMethod, evidenceExpected: seed.evidenceExpected },
      sourceEntityIds: sourceIds(input, seed.domain),
      referenceIds: seed.referenceIds,
      truthStatus: 'AI_SUGGESTED' as const
    })),
    unknowns: input.openNonCriticalGaps.map((gap) => ({
      id: `EUNKNOWN-${gap.id.replace(/[^A-Za-z0-9_-]/gu, '-')}`,
      domain: 'PRODUCT_SCOPE' as const,
      question: gap.title,
      whyItMatters: gap.description,
      affectedSourceEntityIds: gap.affectedEntityIds.filter((id) => input.entities.some((entity) => entity.id === id)),
      blocking: false
    })),
    nextGates: [
      { sequence: 1, title: 'Engineering plan review', exitCriteria: ['Authorized reviewers accept or revise every material recommendation and unknown.'], evidenceRequired: ['The exact plan hash and reviewer decision are retained.'] },
      { sequence: 2, title: 'Implementation planning', exitCriteria: ['Approved outcomes and engineering decisions are decomposed into grounded implementable work.'], evidenceRequired: ['Coverage and ticket-quality reports pass for the current graph.'] },
      { sequence: 3, title: 'Controlled code generation and implementation', exitCriteria: ['Generated patches and infrastructure changes use the approved architecture, coding profile, task, repository revision, and path boundaries.'], evidenceRequired: ['Patch, branch, commit, or pull-request references are linked but remain unverified until allowlisted checks and human review run.'] },
      { sequence: 4, title: 'Verification and release readiness', exitCriteria: ['Required functional, data, security, accessibility, recovery, and operational checks have terminal outcomes.'], evidenceRequired: ['Executed outputs preserve successes, failures, and unknown checks honestly.'] },
      { sequence: 5, title: 'Authorized deployment and operations', exitCriteria: ['Deployment has explicit approval, health criteria, rollback readiness, budgets, and service ownership.'], evidenceRequired: ['Environment-specific deployment, health, cost, and operational evidence is recorded.'] }
    ],
    truthStatus: 'AI_SUGGESTED',
    generatedAt: input.generatedAt
  };
}
