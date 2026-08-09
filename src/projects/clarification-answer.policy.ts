import { createHash } from 'node:crypto';

const CATEGORY_BY_GAP: Readonly<Record<string, string>> = {
  FUNCTIONAL_SCOPE: 'REQUIREMENT',
  NFR: 'NFR',
  DATA: 'CONSTRAINT',
  INTEGRATION: 'REQUIREMENT',
  FAILURE_HANDLING: 'NFR',
  SECURITY_PRIVACY: 'NFR',
  TESTABILITY: 'REQUIREMENT',
  DELIVERY: 'CONSTRAINT'
};

export type ClarificationAnswerTransition = {
  questionStatus: 'ANSWERED';
  gapStatus: 'ANSWERED';
  truthStatus: 'HUMAN_CONFIRMED';
  answerEntityCategory: string;
};

export function transitionClarificationAnswer(input: {
  questionStatus: string;
  gapStatus: string;
  gapCategory: string;
}): ClarificationAnswerTransition {
  if (input.questionStatus !== 'OPEN') throw new Error('Clarification question is already answered');
  if (input.gapStatus !== 'OPEN') throw new Error('Clarification gap is already resolved');
  const answerEntityCategory = CATEGORY_BY_GAP[input.gapCategory];
  if (answerEntityCategory === undefined) throw new Error('Clarification gap category is unsupported');
  return {
    questionStatus: 'ANSWERED',
    gapStatus: 'ANSWERED',
    truthStatus: 'HUMAN_CONFIRMED',
    answerEntityCategory
  };
}

export function clarificationAnswerEntityId(projectId: string, questionId: string): string {
  const suffix = createHash('sha256').update(`${projectId}:${questionId}`, 'utf8').digest('hex').slice(0, 20).toUpperCase();
  return `KN-ANSWER-${suffix}`;
}
