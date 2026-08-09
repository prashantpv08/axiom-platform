import { WorkItemBatchSchema, type WorkItem } from './work-item.schema';
import {
  TicketQualityReportSchema,
  type TicketQualityFinding,
  type TicketQualityReport
} from './ticket-quality.schema';

const IMPLEMENTABLE_TYPES = new Set<WorkItem['type']>(['STORY', 'TASK', 'DEFECT']);
const VAGUE_LANGUAGE = /\b(?:properly|appropriately|as expected|user[- ]friendly|seamless(?:ly)?|fast|quickly|etc\.?|works?|correctly)\b/iu;
const PROHIBITED_CLAIM = /\b(?:all tests (?:have )?passed|verification (?:has )?passed|was successfully deployed|jira ticket [A-Z]+-\d+ (?:was|is) created)\b/iu;
const STOP_WORDS = new Set(['a', 'an', 'and', 'as', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

function finding(value: TicketQualityFinding): TicketQualityFinding {
  return value;
}

function tokens(item: WorkItem): Set<string> {
  const words = `${item.title} ${item.outcome} ${item.scope.join(' ')}`
    .toLowerCase()
    .match(/[a-z0-9]+/gu) ?? [];
  return new Set(words.filter((word) => word.length > 2 && !STOP_WORDS.has(word)));
}

function similarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const word of left) if (right.has(word)) intersection += 1;
  return intersection / new Set([...left, ...right]).size;
}

function hasDependencyCycle(items: WorkItem[]): Set<string> {
  const ids = new Set(items.map((item) => item.id));
  const dependencies = new Map(items.map((item) => [item.id, item.dependencyIds.filter((id) => ids.has(id))]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclic = new Set<string>();
  function visit(id: string, path: string[]) {
    if (visiting.has(id)) {
      for (const member of path.slice(path.indexOf(id))) cyclic.add(member);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) visit(dependency, [...path, dependency]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of ids) visit(id, [id]);
  return cyclic;
}

function emptyReport(findings: TicketQualityFinding[]): TicketQualityReport {
  return TicketQualityReportSchema.parse({
    evaluatorVersion: 'ticket-quality-v1',
    passed: false,
    clarificationRequired: false,
    findings,
    metrics: {
      schemaValid: false,
      workItemCount: 0,
      implementableWorkItemCount: 0,
      requiredFieldCompleteness: 0,
      validSourceReferenceRate: 0,
      approvedRequirementCoverage: 0,
      duplicatePairCount: 0,
      blockingQuestionCount: 0
    }
  });
}

export function evaluateTicketQuality(input: {
  batch: unknown;
  sourceEntities: ReadonlyArray<{ id: string }>;
  approvedRequirementIds: readonly string[];
}): TicketQualityReport {
  const parsed = WorkItemBatchSchema.safeParse(input.batch);
  if (!parsed.success) {
    return emptyReport(parsed.error.issues.map((issue) => finding({
      code: 'SCHEMA_INVALID',
      severity: 'BLOCKER',
      message: issue.message,
      path: issue.path.join('.') || 'batch'
    })));
  }

  const items = parsed.data.workItems;
  const findings: TicketQualityFinding[] = [];
  const knownSourceIds = new Set(input.sourceEntities.map((source) => source.id));
  const itemById = new Map<string, WorkItem>();
  const duplicateIds = new Set<string>();
  let totalReferences = 0;
  let validReferences = 0;
  let blockingQuestionCount = 0;

  for (const item of items) {
    if (itemById.has(item.id)) duplicateIds.add(item.id);
    else itemById.set(item.id, item);
  }
  for (const id of duplicateIds) findings.push(finding({ code: 'DUPLICATE_ID', severity: 'BLOCKER', message: `Stable work-item ID ${id} is duplicated.`, workItemId: id }));

  const allowedParents: Record<WorkItem['type'], ReadonlySet<WorkItem['type']>> = {
    INITIATIVE: new Set(),
    EPIC: new Set(['INITIATIVE']),
    STORY: new Set(['EPIC']),
    TASK: new Set(['STORY']),
    DEFECT: new Set(['EPIC', 'STORY'])
  };

  for (const item of items) {
    const implementable = IMPLEMENTABLE_TYPES.has(item.type);
    if (implementable && item.parentId === null) {
      findings.push(finding({ code: 'MISSING_PARENT', severity: 'ERROR', message: `${item.type} must belong to its Agile parent.`, workItemId: item.id, path: 'parentId' }));
    }
    if (item.parentId !== null) {
      const parent = itemById.get(item.parentId);
      if (parent === undefined || !allowedParents[item.type].has(parent.type)) {
        findings.push(finding({ code: 'INVALID_PARENT', severity: 'ERROR', message: `${item.type} has an invalid or missing parent.`, workItemId: item.id, path: 'parentId', relatedIds: [item.parentId] }));
      }
    }
    if (item.type === 'STORY' && item.userStory === undefined) {
      findings.push(finding({ code: 'MISSING_USER_STORY', severity: 'ERROR', message: 'A story requires persona, capability, and benefit.', workItemId: item.id, path: 'userStory' }));
    }
    if (item.type === 'DEFECT' && item.defect === undefined) {
      findings.push(finding({ code: 'MISSING_DEFECT_DETAILS', severity: 'ERROR', message: 'A defect requires observed behavior, expected behavior, and reproduction steps.', workItemId: item.id, path: 'defect' }));
    }
    if (implementable && (item.acceptanceCriteria.length < 2 || item.evidenceExpectations.length === 0)) {
      findings.push(finding({ code: 'INCOMPLETE_IMPLEMENTABLE_ITEM', severity: 'ERROR', message: 'Implementable work items require at least two acceptance criteria and an evidence expectation.', workItemId: item.id }));
    }

    const references = [
      ...item.sourceEntityIds,
      ...item.acceptanceCriteria.flatMap((criterion) => criterion.sourceEntityIds),
      ...item.openQuestions.flatMap((question) => question.affectedSourceEntityIds)
    ];
    for (const reference of references) {
      totalReferences += 1;
      if (knownSourceIds.has(reference)) validReferences += 1;
      else findings.push(finding({ code: 'INVALID_SOURCE_REFERENCE', severity: 'BLOCKER', message: `Source entity ${reference} does not exist in the selected graph.`, workItemId: item.id, relatedIds: [reference] }));
    }
    if (!item.sourceEntityIds.some((id) => knownSourceIds.has(id))) {
      findings.push(finding({ code: 'UNJUSTIFIED_WORK_ITEM', severity: 'BLOCKER', message: 'The work item has no valid source justification.', workItemId: item.id }));
    }

    for (const criterion of item.acceptanceCriteria) {
      if (VAGUE_LANGUAGE.test(criterion.statement)) findings.push(finding({ code: 'VAGUE_ACCEPTANCE_CRITERION', severity: 'ERROR', message: `Acceptance criterion ${criterion.id} uses subjective or ambiguous language.`, workItemId: item.id, path: `acceptanceCriteria.${criterion.id}` }));
      if (VAGUE_LANGUAGE.test(criterion.verificationMethod) || criterion.verificationMethod.split(/\s+/u).length < 3) findings.push(finding({ code: 'UNVERIFIABLE_ACCEPTANCE_CRITERION', severity: 'ERROR', message: `Acceptance criterion ${criterion.id} lacks a concrete verification method.`, workItemId: item.id, path: `acceptanceCriteria.${criterion.id}.verificationMethod` }));
    }
    for (const question of item.openQuestions) {
      if (!question.blocking) continue;
      blockingQuestionCount += 1;
      findings.push(finding({ code: 'BLOCKING_OPEN_QUESTION', severity: 'BLOCKER', message: `${question.id} must be resolved before implementation.`, workItemId: item.id, relatedIds: [question.id] }));
    }
    for (const dependencyId of item.dependencyIds) {
      if (!itemById.has(dependencyId)) findings.push(finding({ code: 'UNKNOWN_DEPENDENCY', severity: 'ERROR', message: `Dependency ${dependencyId} is not present in this backlog.`, workItemId: item.id, relatedIds: [dependencyId] }));
    }
    const claims = [item.outcome, item.context, ...item.scope, ...item.evidenceExpectations];
    if (claims.some((claim) => PROHIBITED_CLAIM.test(claim))) findings.push(finding({ code: 'PROHIBITED_EVIDENCE_CLAIM', severity: 'BLOCKER', message: 'The draft claims verification or an external side effect without immutable evidence.', workItemId: item.id }));
  }

  const cyclicIds = hasDependencyCycle(items);
  for (const id of cyclicIds) findings.push(finding({ code: 'DEPENDENCY_CYCLE', severity: 'ERROR', message: 'The work-item dependency graph contains a cycle.', workItemId: id }));

  let duplicatePairCount = 0;
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      const left = items[leftIndex]!;
      const right = items[rightIndex]!;
      if (left.parentId === right.id || right.parentId === left.id) continue;
      if (similarity(tokens(left), tokens(right)) < 0.72) continue;
      duplicatePairCount += 1;
      findings.push(finding({ code: 'OVERLAPPING_WORK_ITEM', severity: 'ERROR', message: `${left.id} and ${right.id} materially overlap.`, workItemId: right.id, relatedIds: [left.id] }));
    }
  }

  const covered = new Set(items.flatMap((item) => [
    ...item.sourceEntityIds,
    ...item.acceptanceCriteria.flatMap((criterion) => criterion.sourceEntityIds)
  ]));
  const uncovered = input.approvedRequirementIds.filter((id) => !covered.has(id));
  for (const id of uncovered) findings.push(finding({ code: 'UNCOVERED_REQUIREMENT', severity: 'ERROR', message: `Approved requirement ${id} is not covered by the backlog.`, relatedIds: [id] }));

  const implementableWorkItemCount = items.filter((item) => IMPLEMENTABLE_TYPES.has(item.type)).length;
  const validSourceReferenceRate = totalReferences === 0 ? 0 : validReferences / totalReferences;
  const approvedRequirementCoverage = input.approvedRequirementIds.length === 0 ? 1 : (input.approvedRequirementIds.length - uncovered.length) / input.approvedRequirementIds.length;
  const metrics = {
    schemaValid: true,
    workItemCount: items.length,
    implementableWorkItemCount,
    requiredFieldCompleteness: 1,
    validSourceReferenceRate,
    approvedRequirementCoverage,
    duplicatePairCount,
    blockingQuestionCount
  };
  const passed = findings.every((item) => item.severity === 'WARNING')
    && metrics.requiredFieldCompleteness >= 0.98
    && metrics.validSourceReferenceRate === 1
    && metrics.approvedRequirementCoverage >= 0.95;
  return TicketQualityReportSchema.parse({
    evaluatorVersion: 'ticket-quality-v1',
    passed,
    clarificationRequired: blockingQuestionCount > 0,
    findings,
    metrics
  });
}
