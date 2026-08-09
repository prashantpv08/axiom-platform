import { describe, expect, it } from 'vitest';

import { ticketQualityEvaluationCases } from '../evaluation/ticket-quality-v1';
import { evaluateTicketQuality } from '../src/work-items/ticket-quality.evaluator';
import { WorkItemBatchSchema, WorkItemSchema } from '../src/work-items/work-item.schema';

function findingCodes(input: Parameters<typeof evaluateTicketQuality>[0]) {
  return [...new Set(evaluateTicketQuality(input).findings.map((finding) => finding.code))].sort();
}

describe('ticket quality foundation', () => {
  it('matches every curated evaluation expectation without claiming human review', () => {
    for (const evaluationCase of ticketQualityEvaluationCases) {
      const report = evaluateTicketQuality(evaluationCase.input);
      expect(report.passed, evaluationCase.id).toBe(evaluationCase.expectedPassed);
      expect(findingCodes(evaluationCase.input), evaluationCase.id).toEqual([...evaluationCase.expectedFindingCodes].sort());
      expect(evaluationCase.reviewStatus).toBe('AWAITING_HUMAN_REVIEW');
    }
  });

  it('produces a deterministic report for identical graph and backlog input', () => {
    const evaluationCase = ticketQualityEvaluationCases[0]!;
    expect(evaluateTicketQuality(evaluationCase.input)).toEqual(evaluateTicketQuality(evaluationCase.input));
  });

  it('keeps stable Axiom IDs independent from Jira keys and rejects unknown fields', () => {
    const batch = WorkItemBatchSchema.parse(ticketQualityEvaluationCases[0]!.input.batch);
    const item = batch.workItems[1]!;
    expect(WorkItemSchema.safeParse({ ...item, id: 'KAN-123' }).success).toBe(false);
    expect(WorkItemSchema.safeParse({ ...item, jiraKey: 'KAN-123' }).success).toBe(false);
  });

  it('blocks fabricated verification claims even when the ticket is otherwise complete', () => {
    const evaluationCase = ticketQualityEvaluationCases[0]!;
    const batch = WorkItemBatchSchema.parse(evaluationCase.input.batch);
    const workItems = batch.workItems.map((item) => item.id === 'WI-STORY-INVITE'
      ? { ...item, outcome: 'All tests passed and the invitation workflow is ready for customers.' }
      : item);
    const report = evaluateTicketQuality({ ...evaluationCase.input, batch: { ...batch, workItems } });
    expect(report.passed).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'PROHIBITED_EVIDENCE_CLAIM', workItemId: 'WI-STORY-INVITE' }));
  });

  it('requires defect-specific observed, expected, and reproduction details', () => {
    const evaluationCase = ticketQualityEvaluationCases[0]!;
    const batch = WorkItemBatchSchema.parse(evaluationCase.input.batch);
    const workItems = batch.workItems.map((item) => item.id === 'WI-STORY-INVITE' ? { ...item, type: 'DEFECT' as const } : item);
    const report = evaluateTicketQuality({ ...evaluationCase.input, batch: { ...batch, workItems } });
    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'MISSING_DEFECT_DETAILS', workItemId: 'WI-STORY-INVITE' }));
  });
});
