import { describe, expect, it } from 'vitest';

import { compileGroundedAnalysis } from '../src/sources/grounded-analysis.compiler';
import { extractSourceText, UnsupportedSourceTypeError, validateSourceContent } from '../src/sources/source-extractor';

describe('grounded source analysis', () => {
  it('extracts text formats without changing the evidence text', async () => {
    const content = Buffer.from('Administrators shall invite members. P95 latency must remain below 500 ms.', 'utf8');
    await expect(extractSourceText({ name: 'brief.md', mimeType: 'text/markdown', content })).resolves.toBe(content.toString('utf8'));
  });

  it('rejects unsupported source types before persistence', () => {
    expect(() => validateSourceContent({ name: 'image.png', mimeType: 'image/png', content: Buffer.from('not-an-image') })).toThrow(UnsupportedSourceTypeError);
  });

  it('creates stable entities with exact source offsets and deterministic readiness', () => {
    const text = 'Administrators shall invite members. P95 latency must remain below 500 ms.';
    const result = compileGroundedAnalysis({
      projectId: 'PROJ-TEST', projectName: 'Membership', analyzedAt: '2026-07-24T00:00:00.000Z',
      sources: [{ id: 'SRC-TEST', name: 'brief.md', extractedText: text }]
    });
    expect(result.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'REQUIREMENT', quote: 'Administrators shall invite members.', startOffset: 0, endOffset: 36 }),
      expect.objectContaining({ category: 'NFR', quote: 'P95 latency must remain below 500 ms.', startOffset: 37, endOffset: 74 })
    ]));
    for (const entity of result.entities) {
      expect(text.slice(entity.startOffset, entity.endOffset)).toBe(entity.quote);
    }
    expect(result.readiness.categories).toHaveLength(8);
    expect(result.readiness.openBlockerIds.length).toBeGreaterThan(0);
  });
});
