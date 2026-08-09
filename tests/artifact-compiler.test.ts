import { describe, expect, it } from 'vitest';

import { compileRequirementBaseline } from '../src/artifacts/artifact.compiler';
import { calculateProjectReadiness } from '../src/projects/project-readiness.policy';

describe('deterministic requirement baseline compiler', () => {
  it('preserves exact provenance and exposes unknowns without inventing evidence', () => {
    const entities = [
      { id: 'REQ-ACCESS', category: 'REQUIREMENT', text: 'Administrators shall invite members.', truthStatus: 'SOURCE_GROUNDED', sourceId: 'SRC-BRIEF', clarificationQuestionId: null, quote: 'Administrators shall invite members.' },
      { id: 'NFR-LATENCY', category: 'NFR', text: 'P95 latency shall remain below 500 ms.', truthStatus: 'HUMAN_CONFIRMED', sourceId: null, clarificationQuestionId: 'CQ-LATENCY', quote: null }
    ];
    const gaps = [{ id: 'GAP-DELIVERY', type: 'MISSING', category: 'DELIVERY', title: 'Release cadence is unknown', description: 'No cadence is recorded.', severity: 'MEDIUM', status: 'OPEN', truthStatus: 'UNKNOWN' }];
    const readiness = calculateProjectReadiness({ entities, gaps, calculatedAt: '2026-07-24T00:00:00.000Z' });
    const artifacts = compileRequirementBaseline({
      project: { id: 'PROJ-ALPHA', workspaceId: 'WS-ALPHA', name: 'Alpha Product' },
      graphVersion: 2,
      summary: 'A grounded membership product.',
      readiness,
      entities,
      gaps,
      questions: [{ id: 'CQ-DELIVERY', gapId: 'GAP-DELIVERY', question: 'What release cadence applies?', whyItMatters: 'It affects delivery planning.', status: 'OPEN', answer: null, truthStatus: 'UNKNOWN' }],
      sources: [{ id: 'SRC-BRIEF', name: 'brief.md', mimeType: 'text/markdown', sha256: 'a'.repeat(64), status: 'EXTRACTED' }],
      versions: { requirements: 1, srs: 1, nfr: 1 },
      generatedAt: '2026-07-24T00:01:00.000Z'
    });

    expect(artifacts.map((artifact) => artifact.type)).toEqual(['requirements', 'srs', 'nfr']);
    expect(artifacts.every((artifact) => artifact.sourceGraphVersion === 2 && artifact.truthStatus === 'AI_SUGGESTED')).toBe(true);
    expect(artifacts.every((artifact) => artifact.provenance.mode === 'DETERMINISTIC_COMPILER')).toBe(true);
    expect(artifacts.find((artifact) => artifact.type === 'requirements')?.content).toContain('SRC-BRIEF: “Administrators shall invite members.”');
    expect(artifacts.find((artifact) => artifact.type === 'srs')?.content).toContain('Answer: UNKNOWN');
    expect(artifacts.find((artifact) => artifact.type === 'nfr')?.content).toContain('Generated prose is not runtime evidence.');
    expect(artifacts.every((artifact) => /^[a-f0-9]{64}$/u.test(artifact.sha256))).toBe(true);
  });
});
