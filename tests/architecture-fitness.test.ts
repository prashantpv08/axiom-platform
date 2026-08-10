import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  APPROVED_CROSS_CONTEXT_POSTGRES_QUERIES,
  checkArchitecture,
  type ArchitectureRule
} from '../scripts/check-architecture';

const fixtureRoot = resolve('tests/fixtures/architecture');
const temporaryDirectories: string[] = [];

async function fixtureFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await fixtureFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.fixture')) files.push(path);
  }
  return files;
}

async function materializeFixture(name: string): Promise<string> {
  const fixture = join(fixtureRoot, name);
  const directory = await mkdtemp(join(tmpdir(), `axiom-architecture-${name}-`));
  temporaryDirectories.push(directory);
  for (const source of await fixtureFiles(fixture)) {
    const target = join(directory, relative(fixture, source).replace(/\.fixture$/u, ''));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(source, 'utf8'), 'utf8');
  }
  return join(directory, 'src');
}

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('architecture fitness checker', () => {
  it('accepts the current platform dependency direction', async () => {
    await expect(checkArchitecture()).resolves.toEqual([]);
  });

  it.each([
    ['cross-context-repository', 'CROSS_CONTEXT_POSTGRES_REPOSITORY', 1],
    ['unapproved-query', 'CROSS_CONTEXT_POSTGRES_QUERY', 1],
    ['schema-barrel', 'SCHEMA_LEAF_BARREL_IMPORT', 1],
    ['domain-dependencies', 'APPLICATION_DOMAIN_DEPENDENCY', 3],
    ['direct-idempotency', 'DIRECT_IDEMPOTENCY_TABLE_IMPORT', 1],
    ['service-http-exception', 'SERVICE_HTTP_EXCEPTION_IMPORT', 1]
  ] satisfies ReadonlyArray<readonly [string, ArchitectureRule, number]>) (
    'rejects the %s fixture with %s',
    async (fixture, rule, expectedCount) => {
      const violations = await checkArchitecture({ sourceRoot: await materializeFixture(fixture) });
      expect(violations).toHaveLength(expectedCount);
      expect(violations.every((item) => item.rule === rule)).toBe(true);
      expect(violations.every((item) => item.file.length > 0 && item.line > 0)).toBe(true);
    }
  );

  it('allows only the documented owner-owned cross-context query seams', async () => {
    expect(APPROVED_CROSS_CONTEXT_POSTGRES_QUERIES).toEqual([
      'architecture/postgres-architecture-decision.query.ts',
      'artifacts/postgres-artifact-approval.query.ts',
      'experience/postgres-business-context-gate.query.ts'
    ]);
    await expect(checkArchitecture({ sourceRoot: await materializeFixture('approved-queries') }))
      .resolves.toEqual([]);
  });
});
