import { describe, expect, it } from 'vitest';

import { clarificationAnswerEntityId, transitionClarificationAnswer } from '../src/projects/clarification-answer.policy';
import { calculateProjectReadiness } from '../src/projects/project-readiness.policy';

describe('clarification answer transition', () => {
  it('centralizes the human-confirmed truth transition and stable answer identity', () => {
    expect(transitionClarificationAnswer({ questionStatus: 'OPEN', gapStatus: 'OPEN', gapCategory: 'SECURITY_PRIVACY' })).toEqual({
      questionStatus: 'ANSWERED',
      gapStatus: 'ANSWERED',
      truthStatus: 'HUMAN_CONFIRMED',
      answerEntityCategory: 'NFR'
    });
    expect(clarificationAnswerEntityId('PROJ-ALPHA', 'CQ-AUTH')).toBe(clarificationAnswerEntityId('PROJ-ALPHA', 'CQ-AUTH'));
    expect(clarificationAnswerEntityId('PROJ-ALPHA', 'CQ-AUTH')).toMatch(/^KN-ANSWER-[A-F0-9]{20}$/u);
  });

  it('refuses repeated, already-resolved, and unsupported transitions', () => {
    expect(() => transitionClarificationAnswer({ questionStatus: 'ANSWERED', gapStatus: 'OPEN', gapCategory: 'DATA' })).toThrow('already answered');
    expect(() => transitionClarificationAnswer({ questionStatus: 'OPEN', gapStatus: 'ANSWERED', gapCategory: 'DATA' })).toThrow('already resolved');
    expect(() => transitionClarificationAnswer({ questionStatus: 'OPEN', gapStatus: 'OPEN', gapCategory: 'UNSUPPORTED' })).toThrow('unsupported');
  });
});

describe('deterministic project readiness', () => {
  it('exposes weighted category deductions and safety caps from current graph facts', () => {
    const readiness = calculateProjectReadiness({
      entities: [
        { category: 'REQUIREMENT', truthStatus: 'SOURCE_GROUNDED' },
        { category: 'NFR', truthStatus: 'SOURCE_GROUNDED' },
      ],
      gaps: [
        { id: 'GAP-SECURITY', category: 'SECURITY_PRIVACY', severity: 'BLOCKER', status: 'OPEN' },
        { id: 'GAP-TEST', category: 'TESTABILITY', severity: 'HIGH', status: 'ANSWERED' },
      ],
      calculatedAt: '2026-07-24T00:00:00.000Z',
    });
    expect(readiness.openBlockerIds).toEqual(['GAP-SECURITY']);
    expect(readiness.caps).toEqual(['Open blocker caps readiness at 69.', 'Unknown P0 security or privacy decision caps readiness at 79.']);
    expect(readiness.score).toBe(69);
    expect(readiness.rawScore).toBe(95);
    expect(readiness.categories.find((category) => category.key === 'SECURITY_PRIVACY')).toMatchObject({ score: 5, maximum: 10, openGapIds: ['GAP-SECURITY'] });
  });

  it('returns a fully exposed calculation when all detected gaps are resolved', () => {
    const readiness = calculateProjectReadiness({
      entities: [{ category: 'REQUIREMENT', truthStatus: 'HUMAN_CONFIRMED' }],
      gaps: [{ id: 'GAP-SCOPE', category: 'FUNCTIONAL_SCOPE', severity: 'BLOCKER', status: 'ANSWERED' }],
      calculatedAt: '2026-07-24T00:00:00.000Z',
    });
    expect(readiness).toMatchObject({ score: 100, rawScore: 100, openBlockerIds: [], caps: [] });
    expect(readiness.categories).toHaveLength(8);
  });
});
