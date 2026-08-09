import { createHash } from 'node:crypto';

import { calculateProjectReadiness } from '../projects/project-readiness.policy';

type SourceInput = Readonly<{ id: string; name: string; extractedText: string }>;
type EntityCategory = 'REQUIREMENT' | 'NFR' | 'DECISION' | 'CONSTRAINT' | 'RISK' | 'OPEN_QUESTION';

const CATEGORY_MATCHERS: ReadonlyArray<Readonly<{ category: EntityCategory; pattern: RegExp }>> = [
  { category: 'OPEN_QUESTION', pattern: /\?\s*$/u },
  { category: 'DECISION', pattern: /\b(decided|agreed|approved|selected|chosen|we will|decision:)\b/iu },
  { category: 'RISK', pattern: /\b(risk|threat|may fail|could fail|dependency|blocked by|concern)\b/iu },
  { category: 'CONSTRAINT', pattern: /\b(budget|deadline|timeline|region|residency|constraint|limited to|must use|cannot use|no more than)\b/iu },
  { category: 'NFR', pattern: /\b(latency|throughput|availability|reliability|security|privacy|scalab|performance|audit|compliance|retention|rto|rpo|p95|p99|accessible|accessibility|cost)\b/iu },
  { category: 'REQUIREMENT', pattern: /\b(must|shall|should|needs? to|required to|support|allow|provide|enable)\b/iu }
];

function stableId(prefix: string, projectId: string, key: string): string {
  return `${prefix}-${createHash('sha256').update(`${projectId}:${key}`, 'utf8').digest('hex').slice(0, 16).toUpperCase()}`;
}

function segments(content: string) {
  return Array.from(content.matchAll(/[^\n.!?]+(?:[.!?]+|$)/gu), (match) => {
    const raw = match[0];
    const leading = raw.length - raw.trimStart().length;
    return { text: raw.trim(), startOffset: (match.index ?? 0) + leading };
  }).filter((segment) => segment.text.length >= 12 && segment.text.length <= 1_500);
}

const GAP_DRAFTS = [
  { category: 'FUNCTIONAL_SCOPE', type: 'MISSING', severity: 'BLOCKER', title: 'Primary user journeys and boundaries', signal: /\b(actor|user|administrator|customer|workflow|shall|must)\b/iu, affectedArtifacts: ['SRS', 'BACKLOG'], question: 'Which actors perform the primary end-to-end journeys, and what is explicitly out of scope?', why: 'This establishes testable delivery boundaries and prevents stories from being invented.', options: ['Define the launch journeys now', 'Provide an approved process map', 'Defer the unclear journey from launch'] },
  { category: 'NFR', type: 'UNTESTABLE', severity: 'HIGH', title: 'Measurable service objectives', signal: /\b(p95|p99|latency|availability|throughput|rto|rpo|concurrent)\b/iu, affectedArtifacts: ['NFR', 'TEST_STRATEGY'], question: 'What measurable latency, availability, capacity, recovery, and retention targets apply?', why: 'Architecture and verification cannot be evaluated without measurable operating targets.', options: ['Provide measured targets', 'Approve conservative initial targets', 'Record the targets as unknown and block release'] },
  { category: 'DATA', type: 'MISSING', severity: 'HIGH', title: 'Data ownership and lifecycle', signal: /\b(data|record|retention|delete|schema|source of truth|ownership)\b/iu, affectedArtifacts: ['SRS', 'HLD'], question: 'Which records are authoritative, who owns them, and what retention and deletion rules apply?', why: 'This controls integrity, privacy, storage, and deletion design.', options: ['Define record ownership now', 'Provide a data classification', 'Limit launch data until ownership is approved'] },
  { category: 'INTEGRATION', type: 'MISSING', severity: 'HIGH', title: 'Integration contracts and failure behavior', signal: /\b(api|webhook|integration|jira|trello|provider|connector)\b/iu, affectedArtifacts: ['SRS', 'HLD', 'BACKLOG'], question: 'Which external systems are required, and what timeout, retry, idempotency, and degraded behavior applies?', why: 'External side effects need explicit contracts and recoverable failure behavior.', options: ['Define launch connectors and contracts', 'Use a reviewed adapter contract', 'Remove the unresolved connector from launch'] },
  { category: 'FAILURE_HANDLING', type: 'UNTESTABLE', severity: 'HIGH', title: 'Failure, retry, and recovery outcomes', signal: /\b(error|failure|retry|timeout|cancel|rollback|recover|partial)\b/iu, affectedArtifacts: ['SRS', 'TEST_STRATEGY', 'BACKLOG'], question: 'What should users see and what must the system preserve for validation failures, timeouts, partial failure, cancellation, and retry?', why: 'These outcomes are required for safe retry and acceptance tests.', options: ['Specify failure outcomes per journey', 'Adopt a reviewed default failure policy', 'Block the affected journey'] },
  { category: 'SECURITY_PRIVACY', type: 'MISSING', severity: 'BLOCKER', title: 'Authorization and privacy boundaries', signal: /\b(authentication|authorization|permission|role|tenant|organization|privacy|pii|secret|encrypt)\b/iu, affectedArtifacts: ['NFR', 'HLD', 'TEST_STRATEGY'], question: 'Which roles may access each operation and data class, and what tenant, privacy, and secret-handling rules apply?', why: 'Unknown authorization or privacy boundaries are release-blocking security risks.', options: ['Provide an approved role matrix', 'Use deny-by-default launch roles', 'Remove sensitive data from launch scope'] },
  { category: 'TESTABILITY', type: 'UNTESTABLE', severity: 'HIGH', title: 'Acceptance criteria and evidence', signal: /\b(acceptance criteria|definition of done|verify|test|evidence|sign[- ]off)\b/iu, affectedArtifacts: ['SRS', 'TEST_STRATEGY', 'BACKLOG'], question: 'Who accepts the launch workflows, and which observable success, authorization, validation, and failure outcomes must be demonstrated?', why: 'A requirement is not implementation-ready until its outcomes and owner are verifiable.', options: ['Product owner accepts business flows', 'Product and architecture jointly approve', 'Add specialist security or compliance review'] },
  { category: 'DELIVERY', type: 'MISSING', severity: 'MEDIUM', title: 'Delivery constraints and operating ownership', signal: /\b(deadline|timeline|budget|team|hosting|cloud|on-prem|operations|support model)\b/iu, affectedArtifacts: ['HLD', 'ADR', 'BACKLOG'], question: 'What deadline, budget, team skills, hosting constraints, and operational ownership apply?', why: 'These constraints change architecture fit, cost, and delivery risk.', options: ['Small team and rapid initial release', 'Established platform team and managed cloud', 'Strict portability or self-hosting requirement'] }
] as const;

export function compileGroundedAnalysis(input: { projectId: string; projectName: string; sources: ReadonlyArray<SourceInput>; analyzedAt: string }) {
  const entities = input.sources.flatMap((source) => segments(source.extractedText).flatMap((segment) => {
    const match = CATEGORY_MATCHERS.find((candidate) => candidate.pattern.test(segment.text));
    if (match === undefined) return [];
    return [{
      id: stableId('KN', input.projectId, `${source.id}:${match.category}:${segment.startOffset}:${segment.text}`),
      category: match.category, text: segment.text, truthStatus: 'SOURCE_GROUNDED' as const,
      sourceId: source.id, quote: segment.text, startOffset: segment.startOffset,
      endOffset: segment.startOffset + segment.text.length
    }];
  }));
  const sourceText = input.sources.map((source) => source.extractedText).join('\n');
  const gaps = GAP_DRAFTS.filter((draft) => !draft.signal.test(sourceText)).map((draft) => ({
    id: stableId('GAP', input.projectId, draft.category), type: draft.type, category: draft.category,
    title: draft.title, description: `The supplied sources do not establish ${draft.title.toLocaleLowerCase('en-US')}.`,
    severity: draft.severity, impactAreas: [draft.category.toLocaleLowerCase('en-US')],
    affectedEntityIds: entities.filter((entity) => entity.category === (draft.category === 'NFR' || draft.category === 'SECURITY_PRIVACY' ? 'NFR' : 'REQUIREMENT')).slice(0, 8).map((entity) => entity.id),
    affectedArtifacts: [...draft.affectedArtifacts], rationale: draft.why, status: 'OPEN' as const, truthStatus: 'UNKNOWN' as const
  }));
  const clarificationQuestions = gaps.slice(0, 5).map((gap) => {
    const draft = GAP_DRAFTS.find((candidate) => candidate.category === gap.category)!;
    const id = stableId('CQ', input.projectId, gap.category);
    return { id, gapId: gap.id, question: draft.question, whyItMatters: draft.why,
      affectedEntityIds: gap.affectedEntityIds,
      options: draft.options.map((option, index) => ({ id: `${id}-OPT-${index + 1}`, label: option, value: option })),
      status: 'OPEN' as const, truthStatus: 'UNKNOWN' as const };
  });
  const summary = input.sources.flatMap((source) => segments(source.extractedText)).slice(0, 3).map((segment) => segment.text).join(' ').slice(0, 1_200)
    || `No readable grounded summary is available for ${input.projectName}.`;
  const readiness = calculateProjectReadiness({ entities, gaps, calculatedAt: input.analyzedAt });
  return { summary, entities, gaps, clarificationQuestions, readiness };
}
