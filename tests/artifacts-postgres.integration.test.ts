import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseHandle, type DatabaseHandle } from '../src/database/client';
import { migrateDatabase } from '../src/database/migrate';
import {
  auditEvents,
  documentApprovals,
  knowledgeEntities,
  memberships,
  organizations,
  projectDocuments,
  projectGaps,
  projectGraphs,
  projectSources,
  projects,
  sessions,
  users,
  workspaces
} from '../src/database/schema';
import { hashSessionToken } from '../src/identity/authentication/session-token';
import { calculateProjectReadiness } from '../src/projects/project-readiness.policy';
import { createApplication } from '../src/platform/create-application';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl === undefined ? describe.skip : describe;
const OWNER_TOKEN = 'g'.repeat(43);
const VIEWER_TOKEN = 'h'.repeat(43);

describePostgres('PostgreSQL requirement artifact regeneration and approval', () => {
  let database: DatabaseHandle;
  let app: NestFastifyApplication | undefined;

  async function resetDatabase() {
    await database.pool.query('drop schema if exists public cascade');
    await database.pool.query('drop schema if exists axiom_internal cascade');
    await database.pool.query('create schema public');
    await migrateDatabase(database.db);
  }

  async function seed() {
    const entities = [
      { id: 'REQ-ACCESS', category: 'REQUIREMENT', truthStatus: 'SOURCE_GROUNDED' },
      { id: 'NFR-LATENCY', category: 'NFR', truthStatus: 'HUMAN_CONFIRMED' }
    ];
    const gaps = [{ id: 'GAP-DELIVERY', category: 'DELIVERY', severity: 'MEDIUM', status: 'OPEN' }];
    const readiness = calculateProjectReadiness({ entities, gaps, calculatedAt: '2026-07-24T00:00:00.000Z' });
    await database.db.insert(organizations).values([{ id: 'ORG-ALPHA', slug: 'alpha', name: 'Alpha' }, { id: 'ORG-BETA', slug: 'beta', name: 'Beta' }]);
    await database.db.insert(users).values([{ id: 'USER-OWNER', email: 'owner@example.test', displayName: 'Owner' }, { id: 'USER-VIEWER', email: 'viewer@example.test', displayName: 'Viewer' }]);
    await database.db.insert(memberships).values([{ organizationId: 'ORG-ALPHA', userId: 'USER-OWNER', role: 'OWNER' }, { organizationId: 'ORG-ALPHA', userId: 'USER-VIEWER', role: 'VIEWER' }]);
    await database.db.insert(sessions).values([{ id: 'SESSION-OWNER', userId: 'USER-OWNER', tokenHash: hashSessionToken(OWNER_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' }, { id: 'SESSION-VIEWER', userId: 'USER-VIEWER', tokenHash: hashSessionToken(VIEWER_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' }]);
    await database.db.insert(workspaces).values({ id: 'WS-ALPHA', organizationId: 'ORG-ALPHA', name: 'Alpha Workspace' });
    await database.db.insert(projects).values({ id: 'PROJ-ALPHA', organizationId: 'ORG-ALPHA', workspaceId: 'WS-ALPHA', name: 'Alpha Product', status: 'ANALYZED', graphVersion: 1 });
    await database.db.insert(projectGraphs).values({ organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, summary: 'Grounded membership product.', readiness, analyzer: 'fixture', analyzedAt: '2026-07-24T00:00:00.000Z' });
    await database.db.insert(projectSources).values({ id: 'SRC-BRIEF', organizationId: 'ORG-ALPHA', workspaceId: 'WS-ALPHA', projectId: 'PROJ-ALPHA', name: 'brief.md', kind: 'FILE', mimeType: 'text/markdown', size: 39, sha256: 'a'.repeat(64), extractedText: 'Administrators shall invite members.', rawPath: '/local/brief.md', status: 'EXTRACTED', createdAt: '2026-07-24T00:00:00.000Z' });
    await database.db.insert(knowledgeEntities).values([
      { id: 'REQ-ACCESS', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, category: 'REQUIREMENT', text: 'Administrators shall invite members.', truthStatus: 'SOURCE_GROUNDED', sourceId: 'SRC-BRIEF', quote: 'Administrators shall invite members.', startOffset: 0, endOffset: 36, position: 0 },
      { id: 'NFR-LATENCY', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, category: 'NFR', text: 'P95 latency shall remain below 500 ms.', truthStatus: 'HUMAN_CONFIRMED', clarificationQuestionId: null, position: 1 }
    ]);
    await database.db.insert(projectGaps).values({ id: 'GAP-DELIVERY', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, position: 0, type: 'MISSING', category: 'DELIVERY', title: 'Release cadence is unknown', description: 'No cadence is recorded.', severity: 'MEDIUM', impactAreas: ['delivery'], affectedEntityIds: [], affectedArtifacts: ['BACKLOG'], rationale: 'Cadence affects planning.', status: 'OPEN', truthStatus: 'UNKNOWN' });
  }

  function generate(key: string, ifMatch: string, token = OWNER_TOKEN) {
    return app!.inject({ method: 'POST', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/artifacts/generations', headers: { authorization: `Bearer ${token}`, 'idempotency-key': key, 'if-match': ifMatch, 'x-request-id': key }, payload: { sourceGraphVersion: 1 } });
  }

  beforeAll(() => {
    const parsed = new URL(testDatabaseUrl!);
    if (!parsed.pathname.startsWith('/axiom_test')) throw new Error('Artifact tests require axiom_test');
    database = createDatabaseHandle(testDatabaseUrl);
  });
  beforeEach(async () => { await resetDatabase(); await seed(); app = await createApplication({ databaseUrl: testDatabaseUrl! }); });
  afterEach(async () => { await app?.close(); app = undefined; });
  afterAll(async () => database.pool.end());

  it('regenerates immutable versions, exposes exact hashes, and invalidates an earlier approval', async () => {
    const firstResponse = await generate('artifact-generate-001', '"PROJ-ALPHA:1"');
    expect(firstResponse.statusCode).toBe(201);
    const first = firstResponse.json<{ project: { rowVersion: number; status: string }; baseline: { artifacts: Array<{ type: string; version: number; sha256: string }>; approval: null }; replayed: boolean }>();
    expect(first.project).toMatchObject({ rowVersion: 2, status: 'DOCUMENTED' });
    expect(first.baseline.artifacts.map((artifact) => artifact.type)).toEqual(['requirements', 'srs', 'nfr']);
    expect(first.baseline.artifacts.every((artifact) => artifact.version === 1 && /^[a-f0-9]{64}$/u.test(artifact.sha256))).toBe(true);
    const replay = await generate('artifact-generate-001', '"PROJ-ALPHA:1"');
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toMatchObject({ replayed: true, baseline: { artifacts: first.baseline.artifacts } });
    expect(await database.db.select().from(projectDocuments)).toHaveLength(3);

    const secondResponse = await generate('artifact-generate-002', '"PROJ-ALPHA:2"');
    expect(secondResponse.statusCode).toBe(201);
    const second = secondResponse.json<{ project: { rowVersion: number }; baseline: { artifacts: Array<{ type: 'requirements' | 'srs' | 'nfr'; version: number; sha256: string }> } }>();
    expect(second.baseline.artifacts.every((artifact) => artifact.version === 2)).toBe(true);
    const documentHashes = Object.fromEntries(second.baseline.artifacts.map((artifact) => [artifact.type, artifact.sha256]));
    const approved = await app!.inject({
      method: 'POST', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/artifacts/approvals',
      headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'idempotency-key': 'artifact-approve-001', 'if-match': '"PROJ-ALPHA:3"' },
      payload: { sourceGraphVersion: 1, documentHashes, comment: 'This exact grounded requirement baseline is approved for architecture review.' }
    });
    expect(approved.statusCode).toBe(201);
    expect(approved.json()).toMatchObject({ project: { rowVersion: 4, status: 'DOCUMENTS_APPROVED' }, baseline: { approval: { documentHashes, truthStatus: 'HUMAN_APPROVED' } } });
    expect(await database.db.select().from(documentApprovals)).toHaveLength(1);

    const third = await generate('artifact-generate-003', '"PROJ-ALPHA:4"');
    expect(third.statusCode).toBe(201);
    expect(third.json()).toMatchObject({ project: { rowVersion: 5, status: 'DOCUMENTED' }, baseline: { approval: null } });
    expect(await database.db.select().from(projectDocuments)).toHaveLength(9);
    expect(await database.db.select().from(documentApprovals)).toHaveLength(1);
    const thirdBody = third.json<{ baseline: { artifacts: Array<{ type: string; sha256: string }> } }>();
    const thirdHashes = Object.fromEntries(thirdBody.baseline.artifacts.map((artifact) => [artifact.type, artifact.sha256]));
    const reapproved = await app!.inject({
      method: 'POST', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/artifacts/approvals',
      headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'idempotency-key': 'artifact-approve-002', 'if-match': '"PROJ-ALPHA:5"' },
      payload: { sourceGraphVersion: 1, documentHashes: thirdHashes, comment: 'The regenerated exact requirement baseline is approved as a new immutable decision.' }
    });
    expect(reapproved.statusCode).toBe(201);
    expect(await database.db.select().from(documentApprovals)).toHaveLength(2);
  });

  it('allows authorized read-only inspection and denies unauthorized mutation or cross-tenant reads', async () => {
    expect((await generate('artifact-generate-viewer', '"PROJ-ALPHA:1"', VIEWER_TOKEN)).statusCode).toBe(403);
    expect((await generate('artifact-generate-owner', '"PROJ-ALPHA:1"')).statusCode).toBe(201);
    const current = await app!.inject({ method: 'GET', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/artifacts/current', headers: { authorization: `Bearer ${VIEWER_TOKEN}` } });
    expect(current.statusCode).toBe(200);
    const baseline = current.json<{ projectId: string; graphVersion: number; artifacts: Array<{ sourceGraphVersion: number }> }>();
    expect(baseline).toMatchObject({ projectId: 'PROJ-ALPHA', graphVersion: 1 });
    expect(baseline.artifacts).toHaveLength(3);
    expect(baseline.artifacts.every((artifact) => artifact.sourceGraphVersion === 1)).toBe(true);
    const crossTenant = await app!.inject({ method: 'GET', url: '/api/v1/organizations/ORG-BETA/projects/PROJ-ALPHA/artifacts/current', headers: { authorization: `Bearer ${OWNER_TOKEN}` } });
    expect(crossTenant.statusCode).toBe(403);
  });

  it('rejects stale hashes and critical gaps without creating approval evidence', async () => {
    const generated = (await generate('artifact-generate-blocked', '"PROJ-ALPHA:1"')).json<{ baseline: { artifacts: Array<{ type: string; sha256: string }> } }>();
    await database.db.insert(projectGaps).values({ id: 'GAP-SECURITY', organizationId: 'ORG-ALPHA', projectId: 'PROJ-ALPHA', graphVersion: 1, position: 1, type: 'CONTRADICTION', category: 'SECURITY_PRIVACY', title: 'Authentication policy conflicts', description: 'Two policies conflict.', severity: 'HIGH', impactAreas: ['security'], affectedEntityIds: ['REQ-ACCESS'], affectedArtifacts: ['SRS'], rationale: 'Security policy requires a human decision.', status: 'OPEN', truthStatus: 'UNKNOWN' });
    const hashes = Object.fromEntries(generated.baseline.artifacts.map((artifact) => [artifact.type, artifact.sha256]));
    const blocked = await app!.inject({ method: 'POST', url: '/api/v1/organizations/ORG-ALPHA/projects/PROJ-ALPHA/artifacts/approvals', headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'idempotency-key': 'artifact-approve-blocked', 'if-match': '"PROJ-ALPHA:2"' }, payload: { sourceGraphVersion: 1, documentHashes: hashes, comment: 'Attempt to approve while a critical decision remains unresolved.' } });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.body).toContain('GAP-SECURITY');
    expect(await database.db.select().from(documentApprovals)).toHaveLength(0);
    expect(await database.db.select().from(auditEvents).where(eq(auditEvents.action, 'REQUIREMENT_BASELINE_APPROVED'))).toHaveLength(0);
  });
});
