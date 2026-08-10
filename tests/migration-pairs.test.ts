import { readdir } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const FORWARD_MIGRATION = /^\d{4}_[a-z0-9_]+\.sql$/u;
const ROLLBACK_MIGRATION = /^\d{4}_[a-z0-9_]+\.down\.sql$/u;

describe('database migration inventory', () => {
  it('requires one reviewed rollback for every forward migration', async () => {
    const files = await readdir('drizzle');
    const forward = files.filter((file) => FORWARD_MIGRATION.test(file)).sort();
    const rollbackBases = new Set(
      files
        .filter((file) => ROLLBACK_MIGRATION.test(file))
        .map((file) => file.replace(/\.down\.sql$/u, '.sql')),
    );

    expect(forward.length).toBeGreaterThan(0);
    expect(forward.filter((file) => !rollbackBases.has(file))).toEqual([]);
    expect([...rollbackBases].filter((file) => !forward.includes(file)).sort()).toEqual([]);
  });
});
