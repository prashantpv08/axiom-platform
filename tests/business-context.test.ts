import { describe, expect, it } from 'vitest';

import { compileBusinessContext } from '../src/experience/business-context.compiler';
import { ReviewBusinessContextRequestSchema } from '../src/experience/business-context.schema';

const analyzedAt = '2026-08-03T00:00:00.000Z';

describe('source-linked Business Context preview', () => {
  it('classifies grounded outcomes, actors, workflows, measures, and explicit experience applicability', () => {
    const preview = compileBusinessContext({
      projectId: 'PROJ-BUSINESS', graphVersion: 3, analyzedAt, blockingGapIds: [],
      entities: [
        { id: 'DEC-OUTCOME', category: 'DECISION', text: 'The product goal is to reduce invoice review time by 30%.', truthStatus: 'SOURCE_GROUNDED', sourceId: 'SRC-BRIEF' },
        { id: 'REQ-REVIEW', category: 'REQUIREMENT', text: 'Finance reviewers shall approve invoices in the browser portal.', truthStatus: 'SOURCE_GROUNDED', sourceId: 'SRC-BRIEF' },
        { id: 'NFR-LATENCY', category: 'NFR', text: 'P95 review latency shall remain below 500 ms.', truthStatus: 'HUMAN_CONFIRMED', sourceId: null }
      ]
    });
    expect(preview.applicability).toMatchObject({ status: 'APPLICABLE', decisionRequired: false, sourceEntityIds: ['REQ-REVIEW'] });
    expect(preview.outcomes).toHaveLength(1);
    expect(preview.actors).toHaveLength(1);
    expect(preview.workflows).toHaveLength(1);
    expect(preview.successMeasures).toHaveLength(2);
    expect(preview.unknowns).toEqual([]);
    expect(preview.coverage).toMatchObject({ eligibleEntityCount: 3, classifiedEntityCount: 3, unclassifiedEntityIds: [] });
    expect(preview.outcomes[0]).toMatchObject({ sourceEntityId: 'DEC-OUTCOME', truthStatus: 'SOURCE_GROUNDED', sourceId: 'SRC-BRIEF' });
  });

  it('honors an explicit non-visual scope instead of inventing screens', () => {
    const preview = compileBusinessContext({
      projectId: 'PROJ-HEADLESS', graphVersion: 1, analyzedAt, blockingGapIds: [],
      entities: [{ id: 'REQ-API', category: 'REQUIREMENT', text: 'This is an API-only integration with no user interface.', truthStatus: 'HUMAN_CONFIRMED', sourceId: null }]
    });
    expect(preview.applicability).toMatchObject({ status: 'NOT_APPLICABLE', decisionRequired: false, sourceEntityIds: ['REQ-API'] });
  });

  it('requires a human applicability decision when current evidence is silent', () => {
    const preview = compileBusinessContext({
      projectId: 'PROJ-UNKNOWN', graphVersion: 1, analyzedAt, blockingGapIds: ['GAP-ACTOR'],
      entities: [{ id: 'CON-REGION', category: 'CONSTRAINT', text: 'Processing must remain in the approved region.', truthStatus: 'SOURCE_GROUNDED', sourceId: 'SRC-POLICY' }]
    });
    expect(preview.applicability).toMatchObject({ status: 'NEEDS_DECISION', decisionRequired: true, sourceEntityIds: [] });
    expect(preview.unknowns.map((unknown) => unknown.code)).toContain('UNKNOWN_EXPERIENCE_APPLICABILITY');
    expect(preview.blockingGapIds).toEqual(['GAP-ACTOR']);
    expect(preview.coverage.unclassifiedEntityIds).toEqual(['CON-REGION']);
  });

  it('is deterministic for the same current graph', () => {
    const input = { projectId: 'PROJ-STABLE', graphVersion: 2, analyzedAt, blockingGapIds: [] as string[], entities: [{ id: 'REQ-PORTAL', category: 'REQUIREMENT', text: 'A customer shall submit a request through the web portal.', truthStatus: 'SOURCE_GROUNDED' as const, sourceId: 'SRC-STABLE' }] };
    expect(compileBusinessContext(input)).toEqual(compileBusinessContext(input));
  });

  it('keeps accept-with-edits as an explicit proposed graph mutation instead of an approval', () => {
    const common = {
      sourceGraphVersion: 1,
      contextVersionId: 'BCV-CONTEXT-ONE',
      contextContentHash: 'a'.repeat(64),
      feedbackCategory: 'WORKFLOW' as const,
      comment: 'Recovery behavior needs an exact canonical decision before approval.'
    };
    expect(ReviewBusinessContextRequestSchema.safeParse({
      ...common,
      decision: 'ACCEPT_WITH_EDITS',
      proposedGraphChanges: [{
        target: 'WORKFLOW',
        targetItemId: 'BC-FLOW-AAAAAAAAAAAAAAAA',
        proposedValue: 'Reviewers can recover a failed approval.',
        rationale: 'The current graph does not define the recovery outcome.'
      }]
    }).success).toBe(true);
    expect(ReviewBusinessContextRequestSchema.safeParse({
      ...common,
      decision: 'ACCEPT',
      proposedGraphChanges: []
    }).success).toBe(false);
    expect(ReviewBusinessContextRequestSchema.safeParse({
      ...common,
      feedbackCategory: 'APPROVAL',
      decision: 'ACCEPT_WITH_EDITS',
      proposedGraphChanges: [{
        target: 'WORKFLOW',
        targetItemId: 'BC-FLOW-AAAAAAAAAAAAAAAA',
        proposedValue: 'Reviewers can recover a failed approval.',
        rationale: 'The current graph does not define the recovery outcome.'
      }]
    }).success).toBe(false);
  });
});
