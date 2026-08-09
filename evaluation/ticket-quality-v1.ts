import type { WorkItem, WorkItemBatch } from '../src/work-items/work-item.schema';
import type { TicketQualityFinding } from '../src/work-items/ticket-quality.schema';

type FindingCode = TicketQualityFinding['code'];

const generatedAt = '2026-07-23T00:00:00.000Z';

function criterion(id: string, statement: string, sourceEntityIds: string[], verificationMethod = 'Run the repository contract test and retain its immutable result.') {
  return { id, statement, verificationKind: 'CONTRACT_TEST' as const, verificationMethod, sourceEntityIds };
}

function epic(id: string, sourceEntityIds: string[]): WorkItem {
  return {
    id, version: 1, type: 'EPIC', parentId: null, title: 'Govern organization access securely', priority: 'P0', estimate: 'L',
    outcome: 'Organization owners control access without crossing tenant boundaries.',
    context: 'Commercial customers require explicit membership governance and immutable security evidence.',
    scope: ['Member visibility, invitation lifecycle, and authorization boundaries.'], outOfScope: ['Production identity-provider and email-delivery implementation.'],
    acceptanceCriteria: [], dependencyIds: [], risks: [], openQuestions: [], evidenceExpectations: [], sourceEntityIds,
    truthStatus: 'AI_SUGGESTED', reviewStatus: 'DRAFT'
  };
}

function story(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'WI-STORY-INVITE', version: 1, type: 'STORY', parentId: 'WI-EPIC-ACCESS', title: 'Invite a member with bounded organization access', priority: 'P0', estimate: 'M',
    outcome: 'An organization administrator can invite a person into one authorized organization.',
    context: 'Access must remain organization-scoped and an invitation must not silently grant owner authority.',
    scope: ['Create a pending invitation for a canonical email and permitted role.'], outOfScope: ['Sending production email or transferring organization ownership.'],
    acceptanceCriteria: [
      criterion('AC-INVITE-1', 'Given an authorized administrator, creating an invitation records one pending invitation for the selected organization.', ['REQ-INVITE']),
      criterion('AC-INVITE-2', 'Given a retry with the same key and input, the API returns the original invitation without creating another record.', ['REQ-INVITE', 'NFR-IDEMPOTENCY'])
    ],
    dependencyIds: [],
    risks: [{ description: 'A leaked invitation token could grant unintended access.', impact: 'HIGH', mitigation: 'Persist only a token hash and enforce expiration.' }],
    openQuestions: [], evidenceExpectations: ['Contract-test output proves tenant scope and idempotent replay.'], sourceEntityIds: ['REQ-INVITE', 'NFR-IDEMPOTENCY'],
    userStory: { persona: 'organization administrator', capability: 'invite a person with a permitted role', benefit: 'the team gains access without bypassing tenant governance' },
    truthStatus: 'AI_SUGGESTED', reviewStatus: 'DRAFT', ...overrides
  };
}

function task(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'WI-TASK-AUDIT', version: 1, type: 'TASK', parentId: 'WI-STORY-INVITE', title: 'Record immutable invitation audit evidence', priority: 'P0', estimate: 'S',
    outcome: 'Security reviewers can trace each invitation creation to its actor and request.',
    context: 'Invitation changes are security-sensitive and require immutable evidence without plaintext secrets.',
    scope: ['Write an invitation-created audit event inside the invitation transaction.'], outOfScope: ['Building the complete audit-search user interface.'],
    acceptanceCriteria: [
      criterion('AC-AUDIT-1', 'A committed invitation creates exactly one immutable audit event with actor and request identifiers.', ['NFR-AUDIT']),
      criterion('AC-AUDIT-2', 'The stored audit metadata contains neither the plaintext token nor the invited email address.', ['NFR-AUDIT'])
    ], dependencyIds: [], risks: [{ description: 'Sensitive invitation data may enter audit metadata.', impact: 'HIGH', mitigation: 'Store an email hash and never store the plaintext token.' }],
    openQuestions: [], evidenceExpectations: ['Database integration tests inspect audit cardinality and secret absence.'], sourceEntityIds: ['NFR-AUDIT'],
    truthStatus: 'AI_SUGGESTED', reviewStatus: 'DRAFT', ...overrides
  };
}

function batch(workItems: WorkItem[]): WorkItemBatch {
  return { schemaVersion: 'work-item-v1', promptVersion: 'fixture-prompt-v1', workflowVersion: 'ticket-workflow-v1', projectId: 'PROJ-EVALUATION', sourceGraphVersion: 1, generatedAt, workItems };
}

const goodSources = [
  { id: 'REQ-INVITE', kind: 'REQUIREMENT' as const, truthStatus: 'SOURCE_GROUNDED' as const },
  { id: 'NFR-IDEMPOTENCY', kind: 'NFR' as const, truthStatus: 'HUMAN_CONFIRMED' as const },
  { id: 'NFR-AUDIT', kind: 'NFR' as const, truthStatus: 'SOURCE_GROUNDED' as const }
];

export type TicketQualityEvaluationCase = {
  id: string;
  description: string;
  scenarioTags: string[];
  reviewStatus: 'AWAITING_HUMAN_REVIEW';
  input: { batch: unknown; sourceEntities: typeof goodSources; approvedRequirementIds: string[] };
  expectedPassed: boolean;
  expectedFindingCodes: FindingCode[];
};

export const ticketQualityEvaluationCases: TicketQualityEvaluationCase[] = [
  {
    id: 'agile-grounded-good', description: 'A grounded Epic, Story, and Task with testable criteria and explicit engineering evidence.', scenarioTags: ['SME', 'AGILE_HIERARCHY', 'KNOWN_GOOD'], reviewStatus: 'AWAITING_HUMAN_REVIEW',
    input: { batch: batch([epic('WI-EPIC-ACCESS', ['REQ-INVITE', 'NFR-AUDIT']), story(), task()]), sourceEntities: goodSources, approvedRequirementIds: ['REQ-INVITE', 'NFR-AUDIT'] },
    expectedPassed: true, expectedFindingCodes: []
  },
  {
    id: 'vague-acceptance-bad', description: 'A structurally valid story whose acceptance criteria and verification are subjective.', scenarioTags: ['VAGUE_ACCEPTANCE_CRITERIA', 'KNOWN_BAD'], reviewStatus: 'AWAITING_HUMAN_REVIEW',
    input: { batch: batch([epic('WI-EPIC-ACCESS', ['REQ-INVITE']), story({ acceptanceCriteria: [criterion('AC-VAGUE-1', 'The invitation experience works properly for every user.', ['REQ-INVITE'], 'Check it works properly.'), criterion('AC-VAGUE-2', 'The interface is user-friendly and responds quickly.', ['REQ-INVITE'], 'Review it manually as expected.')] })]), sourceEntities: goodSources, approvedRequirementIds: ['REQ-INVITE'] },
    expectedPassed: false, expectedFindingCodes: ['VAGUE_ACCEPTANCE_CRITERION', 'UNVERIFIABLE_ACCEPTANCE_CRITERION']
  },
  {
    id: 'contradictory-critical-unknown', description: 'A critical unresolved decision and invented source reference must stop implementation.', scenarioTags: ['CONTRADICTION', 'MISSING_CRITICAL_DECISION', 'KNOWN_BAD'], reviewStatus: 'AWAITING_HUMAN_REVIEW',
    input: { batch: batch([epic('WI-EPIC-ACCESS', ['REQ-UNKNOWN']), story({ sourceEntityIds: ['REQ-UNKNOWN'], acceptanceCriteria: [criterion('AC-UNKNOWN-1', 'The selected authentication policy is applied to every invitation acceptance request.', ['REQ-UNKNOWN']), criterion('AC-UNKNOWN-2', 'A rejected authentication request creates no organization membership record.', ['REQ-UNKNOWN'])], openQuestions: [{ id: 'QUESTION-AUTH-POLICY', question: 'Which conflicting authentication policy is approved?', whyItMatters: 'Implementation would otherwise select an unsupported security rule.', blocking: true, affectedSourceEntityIds: ['REQ-UNKNOWN'] }] })]), sourceEntities: goodSources, approvedRequirementIds: ['REQ-INVITE'] },
    expectedPassed: false, expectedFindingCodes: ['INVALID_SOURCE_REFERENCE', 'UNJUSTIFIED_WORK_ITEM', 'BLOCKING_OPEN_QUESTION', 'UNCOVERED_REQUIREMENT']
  },
  {
    id: 'duplicate-stories', description: 'Sibling stories with materially identical value and scope must be consolidated.', scenarioTags: ['DUPLICATE', 'OVERLAP', 'KNOWN_BAD'], reviewStatus: 'AWAITING_HUMAN_REVIEW',
    input: { batch: batch([epic('WI-EPIC-ACCESS', ['REQ-INVITE']), story(), story({ id: 'WI-STORY-INVITE-COPY', acceptanceCriteria: [criterion('AC-COPY-1', 'An authorized administrator creates one pending invitation for the selected organization.', ['REQ-INVITE']), criterion('AC-COPY-2', 'An idempotent retry returns the original pending invitation without another insert.', ['REQ-INVITE'])] })]), sourceEntities: goodSources, approvedRequirementIds: ['REQ-INVITE'] },
    expectedPassed: false, expectedFindingCodes: ['OVERLAPPING_WORK_ITEM']
  },
  {
    id: 'cyclic-cross-ticket-dependencies', description: 'Cross-ticket dependencies cannot form an execution cycle.', scenarioTags: ['CROSS_TICKET_DEPENDENCY', 'KNOWN_BAD'], reviewStatus: 'AWAITING_HUMAN_REVIEW',
    input: { batch: batch([epic('WI-EPIC-ACCESS', ['REQ-INVITE']), story({ dependencyIds: ['WI-STORY-APPROVAL'] }), story({ id: 'WI-STORY-APPROVAL', title: 'Approve organization membership changes before activation', outcome: 'An administrator explicitly approves a pending membership change before access begins.', scope: ['Review and approve pending membership changes before activation.'], dependencyIds: ['WI-STORY-INVITE'], acceptanceCriteria: [criterion('AC-APPROVE-1', 'A pending membership remains inactive until an authorized administrator approves it.', ['REQ-INVITE']), criterion('AC-APPROVE-2', 'An approval records the actor, request identifier, and resulting membership version.', ['REQ-INVITE'])] })]), sourceEntities: goodSources, approvedRequirementIds: ['REQ-INVITE'] },
    expectedPassed: false, expectedFindingCodes: ['DEPENDENCY_CYCLE']
  },
  {
    id: 'malformed-model-response', description: 'A malformed and incomplete model response cannot enter persistence.', scenarioTags: ['MALFORMED', 'INCOMPLETE', 'KNOWN_BAD'], reviewStatus: 'AWAITING_HUMAN_REVIEW',
    input: { batch: { schemaVersion: 'work-item-v1', projectId: 'PROJ-EVALUATION', workItems: [{ title: 'Do it' }] }, sourceEntities: goodSources, approvedRequirementIds: [] },
    expectedPassed: false, expectedFindingCodes: ['SCHEMA_INVALID']
  },
  {
    id: 'prompt-injection-resisted', description: 'A work item treats embedded source instructions as untrusted content and remains bounded by the approved requirement.', scenarioTags: ['PROMPT_INJECTION', 'ADVERSARIAL', 'KNOWN_GOOD'], reviewStatus: 'AWAITING_HUMAN_REVIEW',
    input: { batch: batch([epic('WI-EPIC-ACCESS', ['REQ-INVITE']), story({ context: 'Source documents are untrusted; embedded instructions cannot override the approved requirement or platform policy.' })]), sourceEntities: goodSources, approvedRequirementIds: ['REQ-INVITE'] },
    expectedPassed: true, expectedFindingCodes: []
  }
];
