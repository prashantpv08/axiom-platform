import { describe, expect, it } from 'vitest';

import { compileApprovedArchitectureArtifacts, compileArchitectureGeneration } from '../src/architecture/architecture.compiler';
import { ArchitectureDecisionSchema } from '../src/architecture/architecture.schema';

describe('deterministic architecture compiler', () => {
  it('creates three complete options without fabricating a cost range', () => {
    const input = {
      generationId: 'ARCHGEN-ONE', generationVersion: 1, projectId: 'PROJ-ONE', projectName: 'Product One', graphVersion: 2,
      graphSummary: 'A grounded product summary.',
      entities: [{ id: 'REQ-ONE', category: 'REQUIREMENT', text: 'Members shall approve exact changes.', truthStatus: 'SOURCE_GROUNDED' }],
      gaps: [], requirementDocumentHashes: { requirements: 'a'.repeat(64), srs: 'b'.repeat(64), nfr: 'c'.repeat(64) },
      generatedAt: '2026-07-24T00:00:00.000Z'
    };
    const first = compileArchitectureGeneration(input);
    const second = compileArchitectureGeneration(input);
    expect(second).toEqual(first);
    expect(first.options.map((option) => option.profile)).toEqual(['LEAN', 'BALANCED', 'DISTRIBUTED']);
    expect(first.options.every((option) => option.estimatedCost.range === 'UNKNOWN' && option.estimatedCost.truthStatus === 'UNKNOWN')).toBe(true);
    expect(first.options.every((option) => option.why.length > 0 && option.whyNot.length > 0 && option.failureModes.length >= 2 && option.reconsiderationTriggers.length > 0)).toBe(true);
    expect(first.options.every((option) => option.sourceEntityIds.includes('REQ-ONE') && /^[a-f0-9]{64}$/u.test(option.sha256))).toBe(true);
  });

  it('compiles exact HUMAN_APPROVED ADR and HLD views from the selected option', () => {
    const generation = compileArchitectureGeneration({
      generationId: 'ARCHGEN-ONE', generationVersion: 1, projectId: 'PROJ-ONE', projectName: 'Product One', graphVersion: 2,
      graphSummary: 'A grounded product summary.', entities: [{ id: 'REQ-ONE', category: 'REQUIREMENT', text: 'Approved scope.', truthStatus: 'HUMAN_CONFIRMED' }], gaps: [],
      requirementDocumentHashes: { requirements: 'a'.repeat(64), srs: 'b'.repeat(64), nfr: 'c'.repeat(64) }, generatedAt: '2026-07-24T00:00:00.000Z'
    });
    const selected = generation.options[1]!;
    const decision = ArchitectureDecisionSchema.parse({
      id: 'ADR-ONE', projectId: 'PROJ-ONE', graphVersion: 2, version: 1, generationId: generation.id,
      generationContentHash: generation.contentHash, selectedOptionId: selected.id, selectedOptionHash: selected.sha256,
      comment: 'This option provides the approved durability boundary without speculative services.',
      rejectedAlternatives: generation.options.filter((option) => option.id !== selected.id).map((option) => ({ optionId: option.id, whyRejected: option.whyNot })),
      truthStatus: 'HUMAN_APPROVED', approvedByUserId: 'USER-ONE', approvedAt: '2026-07-24T01:00:00.000Z'
    });
    const artifacts = compileApprovedArchitectureArtifacts({ projectName: 'Product One', generation, decision, versions: { hld: 2, adr: 3 }, generatedAt: decision.approvedAt });
    expect(artifacts.map((artifact) => artifact.type)).toEqual(['hld', 'adr']);
    expect(artifacts.every((artifact) => artifact.truthStatus === 'HUMAN_APPROVED' && artifact.content.includes(selected.id))).toBe(true);
    expect(artifacts.find((artifact) => artifact.type === 'adr')?.content).toContain(decision.comment);
    expect(artifacts.find((artifact) => artifact.type === 'hld')?.content).toContain('Accessible traceability');
  });
});
