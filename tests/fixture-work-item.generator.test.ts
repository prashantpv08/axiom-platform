import { describe, expect, it } from 'vitest';

import { generateFixtureWorkItems } from '../src/work-items/fixture-work-item.generator';
import { evaluateTicketQuality } from '../src/work-items/ticket-quality.evaluator';

describe('grounded fixture work-item decomposition', () => {
  it('turns each approved statement into a specific Agile story and verifiable criteria', () => {
    const entities = [
      { id: 'REQ-ACCESS', kind: 'REQUIREMENT' as const, truthStatus: 'HUMAN_CONFIRMED' as const, text: 'Administrators shall invite organization members with an approved role.' },
      { id: 'NFR-AUDIT', kind: 'NFR' as const, truthStatus: 'SOURCE_GROUNDED' as const, text: 'Invitation changes shall create immutable audit evidence.' }
    ];
    const batch = generateFixtureWorkItems({
      projectId: 'PROJ-ALPHA',
      projectName: 'Alpha Product',
      sourceGraphVersion: 1,
      entities,
      generatedAt: '2026-07-24T00:00:00.000Z'
    });
    const stories = batch.workItems.filter((item) => item.type === 'STORY');

    expect(stories).toHaveLength(2);
    expect(stories[0]).toMatchObject({
      title: 'Invite organization members with an approved role — Administrators',
      userStory: { persona: 'Administrators', capability: 'invite organization members with an approved role' }
    });
    for (const [index, story] of stories.entries()) {
      expect(story.outcome).toContain(entities[index]!.text);
      expect(story.acceptanceCriteria[0]!.statement).toContain(entities[index]!.text);
      expect(story.acceptanceCriteria[0]!.statement).not.toContain('satisfies the approved intent');
    }

    const report = evaluateTicketQuality({ batch, sourceEntities: entities, approvedRequirementIds: ['REQ-ACCESS'] });
    expect(report.passed, JSON.stringify(report.findings)).toBe(true);
  });
});
