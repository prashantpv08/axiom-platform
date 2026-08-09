import { createHash } from 'node:crypto';

import { WorkItemBatchSchema, type EvaluationSourceEntity, type WorkItemBatch } from './work-item.schema';

type GraphEntity = EvaluationSourceEntity & { text: string };

function stableId(kind: 'EPIC' | 'STORY', projectId: string, sourceId: string): string {
  const suffix = createHash('sha256').update(`${projectId}:${kind}:${sourceId}`, 'utf8').digest('hex').slice(0, 20).toUpperCase();
  return `WI-${kind}-${suffix}`;
}

function compact(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1).trimEnd()}…`;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function decomposeApprovedStatement(text: string): { statement: string; subject: string | null; action: string } {
  const statement = compact(text, 850);
  const withoutTerminalPunctuation = statement.replace(/[.!?]+$/u, '');
  const directive = /^(?:the\s+)?(.+?)\s+(?:shall|must|should)\s+(.+)$/iu.exec(withoutTerminalPunctuation);
  if (directive === null) return { statement, subject: null, action: withoutTerminalPunctuation };
  return { statement, subject: directive[1]!.trim(), action: directive[2]!.trim() };
}

export function generateFixtureWorkItems(input: {
  projectId: string;
  projectName: string;
  sourceGraphVersion: number;
  entities: GraphEntity[];
  generatedAt: string;
}): WorkItemBatch {
  const implementableEntities = input.entities.filter((entity) => entity.kind === 'REQUIREMENT' || entity.kind === 'NFR');
  if (implementableEntities.length === 0) throw new Error('At least one approved requirement or NFR is required');
  if (implementableEntities.length > 100) throw new Error('Fixture generation is bounded to 100 approved requirements and NFRs');
  const epicId = stableId('EPIC', input.projectId, 'APPROVED-BACKLOG');
  const epicSources = implementableEntities.slice(0, 50).map((entity) => entity.id);
  const epic = {
    id: epicId,
    version: 1,
    type: 'EPIC' as const,
    parentId: null,
    title: compact(`${input.projectName} approved delivery`, 180),
    priority: 'P0' as const,
    estimate: 'L' as const,
    outcome: `Deliver the approved product outcomes for ${input.projectName} without adding unsupported scope.`,
    context: `This Epic is compiled from approved canonical graph version ${input.sourceGraphVersion} and remains a draft until human review.`,
    scope: ['Implement the approved functional and non-functional graph entities represented by the child stories.'],
    outOfScope: ['Publishing externally, changing approved architecture, or inferring requirements absent from the canonical graph.'],
    acceptanceCriteria: [],
    dependencyIds: [],
    risks: [],
    openQuestions: [],
    evidenceExpectations: [],
    sourceEntityIds: epicSources,
    truthStatus: 'AI_SUGGESTED' as const,
    reviewStatus: 'DRAFT' as const
  };
  const stories = implementableEntities.map((entity, index) => {
    const decomposition = decomposeApprovedStatement(entity.text);
    const sourceLabel = `${entity.id} (${entity.truthStatus})`;
    return {
      id: stableId('STORY', input.projectId, entity.id),
      version: 1,
      type: 'STORY' as const,
      parentId: epicId,
      title: compact(decomposition.subject === null
        ? `Deliver ${decomposition.action}`
        : `${capitalize(decomposition.action)} — ${decomposition.subject}`, 180),
      priority: entity.kind === 'NFR' ? 'P0' as const : index < 5 ? 'P0' as const : 'P1' as const,
      estimate: 'UNKNOWN' as const,
      outcome: `Deliver the source-approved behavior in ${entity.id}: ${decomposition.statement}`,
      context: `Canonical graph version ${input.sourceGraphVersion} records ${sourceLabel}. This ticket must remain bounded to that approved statement.`,
      scope: [`Implement and verify the exact approved statement: ${decomposition.statement}`],
      outOfScope: ['Behavior not linked to this source entity and changes to approved architectural boundaries.'],
      acceptanceCriteria: [
        {
          id: `AC-${index + 1}-BEHAVIOR`,
          statement: `The delivered behavior conforms to ${entity.id}: ${decomposition.statement}`,
          verificationKind: entity.kind === 'NFR' ? 'AUTOMATED_TEST' as const : 'INTEGRATION_TEST' as const,
          verificationMethod: `Execute the repository-defined assertion for ${entity.id} and retain its actual result and exit status.`,
          sourceEntityIds: [entity.id]
        },
        {
          id: `AC-${index + 1}-EVIDENCE`,
          statement: `A failure to meet ${entity.id} is recorded as a failed result and is not presented as successful behavior.`,
          verificationKind: 'AUTOMATED_TEST' as const,
          verificationMethod: `Execute the allowlisted negative assertion for ${entity.id} and retain the unmodified output.`,
          sourceEntityIds: [entity.id]
        }
      ],
      dependencyIds: [],
      risks: [{
        description: `Implementation may drift beyond the approved statement in ${entity.id}.`,
        impact: 'HIGH' as const,
        mitigation: `Review the exact diff and verification evidence against ${entity.id} before approval.`
      }],
      openQuestions: [],
      evidenceExpectations: [`Repository-defined verification output is linked to ${entity.id} without modifying measured values.`],
      sourceEntityIds: [entity.id],
      userStory: {
        persona: entity.kind === 'NFR' ? 'service owner' : compact(decomposition.subject ?? 'product user', 200),
        capability: compact(decomposition.action.length >= 10 ? decomposition.action : `perform ${decomposition.action}`, 500),
        benefit: 'the delivered product remains aligned with reviewed business intent'
      },
      truthStatus: 'AI_SUGGESTED' as const,
      reviewStatus: 'DRAFT' as const
    };
  });
  return WorkItemBatchSchema.parse({
    schemaVersion: 'work-item-v1',
    promptVersion: 'fixture-grounded-agile-v1',
    workflowVersion: 'ticket-workflow-v1',
    projectId: input.projectId,
    sourceGraphVersion: input.sourceGraphVersion,
    generatedAt: input.generatedAt,
    workItems: [epic, ...stories]
  });
}
