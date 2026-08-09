import { describe, expect, it } from 'vitest';

import { isCriticalGenerationGap } from '../src/work-items/work-item-generation-blocker.policy';

const openUnknown = { status: 'OPEN', truthStatus: 'UNKNOWN' };

describe('critical work-item generation gap policy', () => {
  it.each([
    [{ ...openUnknown, type: 'MISSING', severity: 'BLOCKER' }, true],
    [{ ...openUnknown, type: 'CONFLICT', severity: 'MEDIUM' }, true],
    [{ ...openUnknown, type: 'CONTRADICTION', severity: 'LOW' }, true],
    [{ ...openUnknown, type: 'UNTESTABLE', severity: 'HIGH' }, true],
    [{ ...openUnknown, type: 'UNTESTABLE', severity: 'MEDIUM' }, false],
    [{ ...openUnknown, type: 'MISSING', severity: 'HIGH' }, false],
    [{ type: 'CONTRADICTION', severity: 'BLOCKER', status: 'ANSWERED', truthStatus: 'HUMAN_CONFIRMED' }, false]
  ])('classifies %o as critical=%s', (gap, expected) => {
    expect(isCriticalGenerationGap(gap)).toBe(expected);
  });
});
