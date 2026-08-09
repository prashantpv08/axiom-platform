import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDatabaseHandle, type DatabaseHandle } from '../src/database/client';
import { migrateDatabase } from '../src/database/migrate';
import {
  auditEvents,
  idempotencyRecords,
  memberships,
  organizationInvitations,
  organizations,
  sessions,
  users
} from '../src/database/schema';
import { hashSessionToken } from '../src/identity/authentication/session-token';
import { createApplication } from '../src/platform/create-application';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = testDatabaseUrl === undefined ? describe.skip : describe;
const OWNER_TOKEN = 'a'.repeat(43);
const INVITEE_TOKEN = 'c'.repeat(43);
const VIEWER_TOKEN = 'b'.repeat(43);

describePostgres('PostgreSQL organization invitation governance', () => {
  let database: DatabaseHandle;
  let app: NestFastifyApplication | undefined;

  async function resetDatabase() {
    await database.pool.query('drop schema if exists public cascade');
    await database.pool.query('drop schema if exists axiom_internal cascade');
    await database.pool.query('create schema public');
    await migrateDatabase(database.db);
  }

  async function seed() {
    await database.db.insert(organizations).values([
      { id: 'ORG-ALPHA', slug: 'alpha', name: 'Alpha' },
      { id: 'ORG-BETA', slug: 'beta', name: 'Beta' }
    ]);
    await database.db.insert(users).values([
      { id: 'USER-OWNER', email: 'owner@example.test', displayName: 'Owner' },
      { id: 'USER-INVITEE', email: 'invitee@example.test', displayName: 'Invitee' },
      { id: 'USER-VIEWER', email: 'viewer@example.test', displayName: 'Viewer' }
    ]);
    await database.db.insert(memberships).values([
      { organizationId: 'ORG-ALPHA', userId: 'USER-OWNER', role: 'OWNER' },
      { organizationId: 'ORG-BETA', userId: 'USER-VIEWER', role: 'VIEWER' }
    ]);
    await database.db.insert(sessions).values([
      { id: 'SESSION-OWNER', userId: 'USER-OWNER', tokenHash: hashSessionToken(OWNER_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' },
      { id: 'SESSION-INVITEE', userId: 'USER-INVITEE', tokenHash: hashSessionToken(INVITEE_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' },
      { id: 'SESSION-VIEWER', userId: 'USER-VIEWER', tokenHash: hashSessionToken(VIEWER_TOKEN), expiresAt: '2099-01-01T00:00:00.000Z' }
    ]);
  }

  async function createInvitation(key = 'invite-create-001') {
    return app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/invitations',
      headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'idempotency-key': key, 'x-request-id': key },
      payload: { email: 'Invitee@Example.Test', role: 'DEVELOPER' }
    });
  }

  beforeAll(() => {
    const parsed = new URL(testDatabaseUrl!);
    if (!parsed.pathname.startsWith('/axiom_test')) throw new Error('Governance tests require axiom_test');
    database = createDatabaseHandle(testDatabaseUrl);
  });

  beforeEach(async () => {
    vi.stubEnv('AXIOM_INVITATION_SECRET', 'test-invitation-secret-32-bytes-minimum-value');
    vi.stubEnv('AXIOM_LOCAL_INVITATION_DELIVERY_ENABLED', 'true');
    await resetDatabase();
    await seed();
    app = await createApplication({ databaseUrl: testDatabaseUrl! });
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.unstubAllEnvs();
  });

  afterAll(async () => database.pool.end());

  it('creates and replays one hash-only invitation and lists scoped governance data', async () => {
    const first = await createInvitation();
    const replay = await createInvitation();
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    const created = first.json<{ invitation: { id: string; email: string }; delivery: { acceptanceToken: string } }>();
    expect(created.invitation.email).toBe('invitee@example.test');
    expect(replay.json()).toEqual({ ...first.json(), replayed: true });

    const stored = await database.db.select().from(organizationInvitations);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(stored[0])).not.toContain(created.delivery.acceptanceToken);
    expect(await database.db.select().from(idempotencyRecords).where(eq(idempotencyRecords.scope, 'INVITATION_CREATE'))).toHaveLength(1);
    const events = await database.db.select().from(auditEvents).where(eq(auditEvents.action, 'INVITATION_CREATED'));
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0])).not.toContain('invitee@example.test');

    const members = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-ALPHA/members',
      headers: { authorization: `Bearer ${OWNER_TOKEN}` }
    });
    expect(members.statusCode).toBe(200);
    expect(members.json()).toMatchObject({ members: [{ userId: 'USER-OWNER', role: 'OWNER' }], nextCursor: null });
    const invitations = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-ALPHA/invitations',
      headers: { authorization: `Bearer ${OWNER_TOKEN}` }
    });
    expect(invitations.body).not.toContain(created.delivery.acceptanceToken);
    expect(invitations.json()).toMatchObject({ invitations: [{ id: created.invitation.id, status: 'PENDING' }] });
  });

  it('accepts only for the authenticated matching email and replays without duplicate audit', async () => {
    const created = (await createInvitation('invite-accept-001')).json<{ delivery: { acceptanceToken: string } }>();
    const wrongUser = await app!.inject({
      method: 'POST',
      url: '/api/v1/invitations/accept',
      headers: { authorization: `Bearer ${VIEWER_TOKEN}`, 'x-request-id': 'invite-wrong-user' },
      payload: { token: created.delivery.acceptanceToken }
    });
    expect(wrongUser.statusCode).toBe(404);

    const request = {
      method: 'POST' as const,
      url: '/api/v1/invitations/accept',
      headers: { authorization: `Bearer ${INVITEE_TOKEN}`, 'x-request-id': 'invite-accept' },
      payload: { token: created.delivery.acceptanceToken }
    };
    const accepted = await app!.inject(request);
    const replay = await app!.inject({ ...request, headers: { ...request.headers, 'x-request-id': 'invite-accept-replay' } });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ membership: { userId: 'USER-INVITEE', role: 'DEVELOPER', status: 'ACTIVE' }, replayed: false });
    expect(replay.json()).toMatchObject({ replayed: true });
    expect(await database.db.select().from(auditEvents).where(eq(auditEvents.action, 'INVITATION_ACCEPTED'))).toHaveLength(1);
  });

  it('enforces ETags and serializes concurrent invitation revocation', async () => {
    const created = (await createInvitation('invite-revoke-001')).json<{ invitation: { id: string }; delivery: { acceptanceToken: string } }>();
    const url = `/api/v1/organizations/ORG-ALPHA/invitations/${created.invitation.id}/revoke`;
    const missing = await app!.inject({ method: 'POST', url, headers: { authorization: `Bearer ${OWNER_TOKEN}` } });
    expect(missing.statusCode).toBe(428);

    const request = { method: 'POST' as const, url, headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'if-match': `"${created.invitation.id}:1"` } };
    const responses = await Promise.all([
      app!.inject({ ...request, headers: { ...request.headers, 'x-request-id': 'invite-revoke-a' } }),
      app!.inject({ ...request, headers: { ...request.headers, 'x-request-id': 'invite-revoke-b' } })
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 412]);
    expect(await database.db.select().from(auditEvents).where(eq(auditEvents.action, 'INVITATION_REVOKED'))).toHaveLength(1);

    const acceptRevoked = await app!.inject({
      method: 'POST',
      url: '/api/v1/invitations/accept',
      headers: { authorization: `Bearer ${INVITEE_TOKEN}` },
      payload: { token: created.delivery.acceptanceToken }
    });
    expect(acceptRevoked.statusCode).toBe(409);
  });

  it('denies viewer, cross-tenant, owner-role, existing-member, and disabled-delivery creation', async () => {
    const viewer = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-BETA/invitations',
      headers: { authorization: `Bearer ${VIEWER_TOKEN}`, 'idempotency-key': 'viewer-invite-001' },
      payload: { email: 'new@example.test', role: 'DEVELOPER' }
    });
    expect(viewer.statusCode).toBe(403);
    const crossTenant = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-BETA/invitations',
      headers: { authorization: `Bearer ${OWNER_TOKEN}` }
    });
    expect(crossTenant.statusCode).toBe(403);
    const ownerRole = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/invitations',
      headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'idempotency-key': 'owner-role-001' },
      payload: { email: 'new@example.test', role: 'OWNER' }
    });
    expect(ownerRole.statusCode).toBe(400);
    const existing = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/invitations',
      headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'idempotency-key': 'existing-member-001' },
      payload: { email: 'owner@example.test', role: 'VIEWER' }
    });
    expect(existing.statusCode).toBe(409);

    vi.stubEnv('AXIOM_LOCAL_INVITATION_DELIVERY_ENABLED', 'false');
    const disabled = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/invitations',
      headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'idempotency-key': 'delivery-disabled-001' },
      payload: { email: 'new@example.test', role: 'VIEWER' }
    });
    expect(disabled.statusCode).toBe(503);
    expect(await database.db.select().from(organizationInvitations)).toHaveLength(0);
  });

  it('reports elapsed invitations as expired and refuses to revoke them as pending', async () => {
    await database.db.insert(organizationInvitations).values({
      id: 'INV-EXPIRED',
      organizationId: 'ORG-ALPHA',
      email: 'expired@example.test',
      role: 'VIEWER',
      tokenHash: 'd'.repeat(64),
      invitedByUserId: 'USER-OWNER',
      expiresAt: '2020-01-01T00:00:00.000Z'
    });
    const listed = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations/ORG-ALPHA/invitations',
      headers: { authorization: `Bearer ${OWNER_TOKEN}` }
    });
    expect(listed.json()).toMatchObject({ invitations: [{ id: 'INV-EXPIRED', status: 'EXPIRED' }] });
    const revoke = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations/ORG-ALPHA/invitations/INV-EXPIRED/revoke',
      headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'if-match': '"INV-EXPIRED:1"' }
    });
    expect(revoke.statusCode).toBe(409);
  });

  it('guards and executes invitation migration rollback', async () => {
    await createInvitation('invite-rollback-001');
    const downSql = await readFile(resolve('drizzle/0005_organization_invitations.down.sql'), 'utf8');
    await expect(database.pool.query(downSql)).rejects.toThrow(/remove organization invitations/u);
    await database.db.delete(organizationInvitations);
    await app!.close();
    app = undefined;
    await database.pool.query(downSql);
    const result = await database.pool.query<{ table_name: string | null }>(
      "select to_regclass('public.organization_invitations')::text as table_name"
    );
    expect(result.rows[0]?.table_name).toBeNull();
  });
});
