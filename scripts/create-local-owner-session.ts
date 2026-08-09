import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { and, eq } from 'drizzle-orm';

import { createDatabaseHandle, databaseUrl } from '../src/database/client';
import { auditEvents, memberships, organizations, sessions, users } from '../src/database/schema';
import { hashSessionToken } from '../src/identity/authentication/session-token';
import { OrganizationIdSchema } from '../src/identity/identity.schema';

const LOCAL_USER_ID = 'USER-LOCAL-OWNER';
const LOCAL_ORGANIZATION_ID = OrganizationIdSchema.parse(
  process.env.AXIOM_LOCAL_ORGANIZATION_ID ?? 'ORG-LOCAL-DEVELOPMENT'
);
const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1_000;

function requireLocalDatabase(url: string): void {
  const parsed = new URL(url);
  const localHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  const permittedDatabase = parsed.pathname === '/axiom' || parsed.pathname.startsWith('/axiom_test');
  if (!localHost || !permittedDatabase) {
    throw new Error('Local session bootstrap is restricted to localhost axiom databases');
  }
}

async function main(): Promise<void> {
  const url = databaseUrl();
  requireLocalDatabase(url);
  const handle = createDatabaseHandle(url);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString();
  const token = randomBytes(32).toString('base64url');
  const sessionId = `SESSION-${randomUUID()}`;
  const nowIso = now.toISOString();

  try {
    await handle.db.transaction(async (tx) => {
      const [organization] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(and(eq(organizations.id, LOCAL_ORGANIZATION_ID), eq(organizations.status, 'ACTIVE')))
        .limit(1);
      if (organization === undefined) {
        throw new Error(`${LOCAL_ORGANIZATION_ID} must exist and be active before creating a local session`);
      }

      await tx
        .insert(users)
        .values({
          id: LOCAL_USER_ID,
          email: 'local-owner@axiom.local',
          displayName: 'Local Axiom Owner'
        })
        .onConflictDoUpdate({
          target: users.id,
          set: { status: 'ACTIVE', displayName: 'Local Axiom Owner', updatedAt: nowIso }
        });

      await tx
        .insert(memberships)
        .values({ organizationId: LOCAL_ORGANIZATION_ID, userId: LOCAL_USER_ID, role: 'OWNER' })
        .onConflictDoUpdate({
          target: [memberships.organizationId, memberships.userId],
          set: { role: 'OWNER', status: 'ACTIVE', updatedAt: nowIso }
        });

      await tx
        .update(sessions)
        .set({ status: 'REVOKED', revokedAt: nowIso, updatedAt: nowIso })
        .where(and(eq(sessions.userId, LOCAL_USER_ID), eq(sessions.status, 'ACTIVE')));

      await tx.insert(sessions).values({
        id: sessionId,
        userId: LOCAL_USER_ID,
        tokenHash: hashSessionToken(token),
        expiresAt
      });

      await tx.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`,
        organizationId: LOCAL_ORGANIZATION_ID,
        actorUserId: LOCAL_USER_ID,
        action: 'LOCAL_SESSION_CREATED',
        targetType: 'Session',
        targetId: sessionId,
        requestId: `local-bootstrap-${sessionId}`,
        metadata: { source: 'LOCAL_DEVELOPMENT', expiresAt }
      });
    });

    const localDirectory = resolve('.local');
    await mkdir(localDirectory, { recursive: true, mode: 0o700 });
    await writeFile(resolve(localDirectory, 'session-token'), `${token}\n`, { mode: 0o600 });
    await writeFile(
      resolve(localDirectory, 'curl-session.conf'),
      `header = "Authorization: Bearer ${token}"\n`,
      { mode: 0o600 }
    );
    process.stdout.write(`Local owner session created; token written to .local/session-token; expires ${expiresAt}\n`);
  } finally {
    await handle.pool.end();
  }
}

void main();
