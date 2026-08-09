import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module';
import type { AxiomDatabase } from '../../database/client';
import { auditEvents, memberships, organizations, sessions, users } from '../../database/schema';
import { OrganizationRoleSchema, OrganizationStatusSchema, type Principal } from '../identity.schema';
import type {
  AuditEventInput,
  IdentityRepository,
  OrganizationRecord,
  StoredAuditEvent
} from './identity.repository';

@Injectable()
export class PostgresIdentityRepository implements IdentityRepository {
  constructor(@Inject(DATABASE) private readonly db: AxiomDatabase) {}

  async findActiveSession(tokenHash: string, now: string): Promise<Principal | null> {
    const [row] = await this.db
      .select({ sessionId: sessions.id, userId: users.id })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          eq(sessions.status, 'ACTIVE'),
          eq(users.status, 'ACTIVE'),
          gt(sessions.expiresAt, now)
        )
      )
      .limit(1);

    return row ?? null;
  }

  async findActiveMembership(userId: string, organizationId: string) {
    const [row] = await this.db
      .select({ role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, 'ACTIVE'),
          eq(organizations.status, 'ACTIVE')
        )
      )
      .limit(1);

    return row === undefined ? null : OrganizationRoleSchema.parse(row.role);
  }

  async listActiveOrganizationsForUser(userId: string) {
    const rows = await this.db
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        status: organizations.status,
        role: memberships.role
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.status, 'ACTIVE'),
          eq(organizations.status, 'ACTIVE')
        )
      )
      .orderBy(asc(organizations.name), asc(organizations.id));

    return rows.map((row) => ({
      ...row,
      status: OrganizationStatusSchema.parse(row.status),
      role: OrganizationRoleSchema.parse(row.role)
    }));
  }

  async findOrganization(organizationId: string): Promise<OrganizationRecord | null> {
    const [row] = await this.db
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        status: organizations.status
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    return row === undefined ? null : { ...row, status: OrganizationStatusSchema.parse(row.status) };
  }

  async appendAuditEvent(input: AuditEventInput): Promise<StoredAuditEvent> {
    const [stored] = await this.db
      .insert(auditEvents)
      .values({ id: `AUDIT-${randomUUID()}`, ...input })
      .returning();

    if (stored === undefined) throw new Error('Audit event was not persisted');
    if (stored.actorUserId === null) throw new Error('User audit event lost its actor');
    return { ...stored, actorUserId: stored.actorUserId };
  }
}
