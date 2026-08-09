import { describe, expect, it } from 'vitest';

import { ProjectLifecycleConflictError, transitionProjectLifecycle } from '../src/projects/project.lifecycle';

describe('project lifecycle transitions', () => {
  it('preserves the exact active status across archive and restore', () => {
    const archived = transitionProjectLifecycle(
      { status: 'ANALYZED', archivedFromStatus: null, archivedAt: null },
      'ARCHIVE',
      '2026-07-21T00:00:00.000Z'
    );
    expect(archived).toEqual({
      status: 'ARCHIVED',
      archivedFromStatus: 'ANALYZED',
      archivedAt: '2026-07-21T00:00:00.000Z'
    });
    expect(transitionProjectLifecycle(archived, 'RESTORE', '2026-07-21T01:00:00.000Z')).toEqual({
      status: 'ANALYZED',
      archivedFromStatus: null,
      archivedAt: null
    });
  });

  it('rejects invalid lifecycle transitions', () => {
    expect(() =>
      transitionProjectLifecycle(
        { status: 'ARCHIVED', archivedFromStatus: 'DRAFT', archivedAt: '2026-07-21T00:00:00.000Z' },
        'ARCHIVE',
        '2026-07-21T01:00:00.000Z'
      )
    ).toThrow(ProjectLifecycleConflictError);
    expect(() =>
      transitionProjectLifecycle(
        { status: 'DRAFT', archivedFromStatus: null, archivedAt: null },
        'RESTORE',
        '2026-07-21T01:00:00.000Z'
      )
    ).toThrow('Project is not archived');
  });
});
