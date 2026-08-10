import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm';

import type { AxiomDatabase } from '../../database/client';
import { DATABASE } from '../../database/database.module';
import {
  claimPostgresIdempotency,
  completePostgresIdempotency
} from '../../database/idempotency/postgres-idempotency';
import {
  auditEvents,
  memberships,
  organizationInvitations,
  organizations,
  users
} from '../../database/schema';
import { InvitationResponseSchema, MemberResponseSchema } from './governance.schema';
import {
  GovernanceConflictError,
  GovernanceNotFoundError,
  GovernanceVersionConflictError,
  type CreateInvitationInput,
  type GovernancePageRequest,
  type GovernanceRepository,
  type LifecycleInvitationInput
} from './governance.repository';

function invitationFromRow(row: typeof organizationInvitations.$inferSelect) {
  const status = row.status === 'PENDING' && new Date(row.expiresAt).getTime() <= Date.now() ? 'EXPIRED' : row.status;
  return InvitationResponseSchema.parse({
    id: row.id,
    email: row.email,
    role: row.role,
    status,
    expiresAt: new Date(row.expiresAt).toISOString(),
    rowVersion: row.rowVersion,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString()
  });
}

type MemberRow = {
  userId: string;
  email: string;
  displayName: string;
  role: typeof memberships.$inferSelect.role;
  status: string;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
};

function memberFromRow(row: MemberRow) {
  return MemberResponseSchema.parse({
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString()
  });
}

@Injectable()
export class PostgresGovernanceRepository implements GovernanceRepository {
  constructor(@Inject(DATABASE) private readonly database: AxiomDatabase) {}

  async listMembers(organizationId: string, request: GovernancePageRequest) {
    const filters: SQL[] = [
      eq(memberships.organizationId, organizationId),
      inArray(memberships.status, ['ACTIVE', 'REVOKED'])
    ];
    if (request.cursor !== undefined) {
      filters.push(
        or(
          lt(memberships.updatedAt, request.cursor.updatedAt),
          and(eq(memberships.updatedAt, request.cursor.updatedAt), lt(memberships.userId, request.cursor.id))
        )!
      );
    }
    const rows = await this.database
      .select({
        userId: memberships.userId,
        email: users.email,
        displayName: users.displayName,
        role: memberships.role,
        status: memberships.status,
        rowVersion: memberships.rowVersion,
        createdAt: memberships.createdAt,
        updatedAt: memberships.updatedAt
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(...filters))
      .orderBy(desc(memberships.updatedAt), desc(memberships.userId))
      .limit(request.limit + 1);
    return { members: rows.slice(0, request.limit).map(memberFromRow), hasNextPage: rows.length > request.limit };
  }

  async listInvitations(organizationId: string, request: GovernancePageRequest) {
    const filters: SQL[] = [eq(organizationInvitations.organizationId, organizationId)];
    if (request.cursor !== undefined) {
      filters.push(
        or(
          lt(organizationInvitations.updatedAt, request.cursor.updatedAt),
          and(
            eq(organizationInvitations.updatedAt, request.cursor.updatedAt),
            lt(organizationInvitations.id, request.cursor.id)
          )
        )!
      );
    }
    const rows = await this.database
      .select()
      .from(organizationInvitations)
      .where(and(...filters))
      .orderBy(desc(organizationInvitations.updatedAt), desc(organizationInvitations.id))
      .limit(request.limit + 1);
    return {
      invitations: rows.slice(0, request.limit).map(invitationFromRow),
      hasNextPage: rows.length > request.limit
    };
  }

  async createInvitation(input: CreateInvitationInput) {
    return this.database.transaction(async (transaction) => {
      const now = new Date().toISOString();
      const reservation = await claimPostgresIdempotency(transaction, {
        organizationId: input.context.organizationId,
        scope: 'INVITATION_CREATE',
        key: input.idempotencyKey,
        requestHash: input.requestHash
      });
      if (reservation.kind === 'HASH_CONFLICT') {
        throw new GovernanceConflictError('Idempotency key was already used for a different request');
      }
      if (reservation.kind === 'REPLAY') {
        return { invitation: InvitationResponseSchema.parse(reservation.responsePayload), replayed: true };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        throw new GovernanceConflictError('Invitation creation is still processing');
      }

      const [activeMember] = await transaction
        .select({ userId: users.id })
        .from(users)
        .innerJoin(
          memberships,
          and(eq(memberships.userId, users.id), eq(memberships.organizationId, input.context.organizationId))
        )
        .where(and(eq(users.email, input.email), eq(memberships.status, 'ACTIVE')))
        .limit(1);
      if (activeMember !== undefined) throw new GovernanceConflictError('This email already belongs to an active member');

      const [pending] = await transaction
        .select()
        .from(organizationInvitations)
        .where(
          and(
            eq(organizationInvitations.organizationId, input.context.organizationId),
            eq(organizationInvitations.email, input.email),
            eq(organizationInvitations.status, 'PENDING')
          )
        )
        .limit(1)
        .for('update');

      let invitation;
      let replayed = false;
      if (pending !== undefined && new Date(pending.expiresAt).getTime() > Date.now()) {
        if (pending.role !== input.role) {
          throw new GovernanceConflictError('A pending invitation already exists with a different role');
        }
        invitation = invitationFromRow(pending);
        replayed = true;
      } else {
        if (pending !== undefined) {
          await transaction
            .update(organizationInvitations)
            .set({ status: 'EXPIRED', rowVersion: sql`${organizationInvitations.rowVersion} + 1`, updatedAt: now })
            .where(eq(organizationInvitations.id, pending.id));
        }
        const [created] = await transaction
          .insert(organizationInvitations)
          .values({
            id: input.id,
            organizationId: input.context.organizationId,
            email: input.email,
            role: input.role,
            tokenHash: input.tokenHash,
            invitedByUserId: input.context.userId,
            expiresAt: input.expiresAt
          })
          .returning();
        if (created === undefined) throw new Error('Invitation insert did not return a row');
        invitation = invitationFromRow(created);
        await transaction.insert(auditEvents).values({
          id: `AUDIT-${randomUUID()}`,
          organizationId: input.context.organizationId,
          actorUserId: input.context.userId,
          action: 'INVITATION_CREATED',
          targetType: 'OrganizationInvitation',
          targetId: invitation.id,
          requestId: input.requestId,
          metadata: {
            emailHash: createHash('sha256').update(input.email, 'utf8').digest('hex'),
            role: invitation.role,
            expiresAt: invitation.expiresAt,
            sessionId: input.context.sessionId
          }
        });
      }

      await completePostgresIdempotency(transaction, {
        recordId: reservation.recordId,
        responseStatus: 201,
        responsePayload: invitation,
        completedAt: now
      });
      return { invitation, replayed };
    });
  }

  async revokeInvitation(input: LifecycleInvitationInput) {
    return this.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(organizationInvitations)
        .where(
          and(
            eq(organizationInvitations.organizationId, input.context.organizationId),
            eq(organizationInvitations.id, input.invitationId)
          )
        )
        .limit(1)
        .for('update');
      if (current === undefined) throw new GovernanceNotFoundError('Invitation was not found');
      if (current.rowVersion !== input.expectedRowVersion) {
        throw new GovernanceVersionConflictError('Invitation has changed since it was loaded');
      }
      if (current.status !== 'PENDING' || new Date(current.expiresAt).getTime() <= Date.now()) {
        throw new GovernanceConflictError('Invitation is not pending');
      }

      const now = new Date().toISOString();
      const [updated] = await transaction
        .update(organizationInvitations)
        .set({ status: 'REVOKED', revokedAt: now, rowVersion: sql`${organizationInvitations.rowVersion} + 1`, updatedAt: now })
        .where(
          and(
            eq(organizationInvitations.id, current.id),
            eq(organizationInvitations.rowVersion, input.expectedRowVersion)
          )
        )
        .returning();
      if (updated === undefined) throw new GovernanceVersionConflictError('Invitation has changed since it was loaded');
      const invitation = invitationFromRow(updated);
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`,
        organizationId: input.context.organizationId,
        actorUserId: input.context.userId,
        action: 'INVITATION_REVOKED',
        targetType: 'OrganizationInvitation',
        targetId: invitation.id,
        requestId: input.requestId,
        metadata: { previousRowVersion: current.rowVersion, rowVersion: invitation.rowVersion, sessionId: input.context.sessionId }
      });
      return invitation;
    });
  }

  async acceptInvitation(principal: { sessionId: string; userId: string }, tokenHash: string, requestId: string) {
    return this.database.transaction(async (transaction) => {
      const [invitation] = await transaction
        .select()
        .from(organizationInvitations)
        .innerJoin(organizations, eq(organizations.id, organizationInvitations.organizationId))
        .where(and(eq(organizationInvitations.tokenHash, tokenHash), eq(organizations.status, 'ACTIVE')))
        .limit(1)
        .for('update', { of: organizationInvitations });
      if (invitation === undefined) throw new GovernanceNotFoundError('Invitation is not available');
      const current = invitation.organization_invitations;
      const [user] = await transaction
        .select()
        .from(users)
        .where(and(eq(users.id, principal.userId), eq(users.status, 'ACTIVE')))
        .limit(1);
      if (user === undefined || user.email !== current.email) {
        throw new GovernanceNotFoundError('Invitation is not available');
      }

      const [existingMembership] = await transaction
        .select()
        .from(memberships)
        .where(and(eq(memberships.organizationId, current.organizationId), eq(memberships.userId, principal.userId)))
        .limit(1)
        .for('update');
      if (current.status === 'ACCEPTED' && current.acceptedByUserId === principal.userId && existingMembership !== undefined) {
        return {
          membership: memberFromRow({ ...existingMembership, email: user.email, displayName: user.displayName }),
          replayed: true
        };
      }
      if (current.status !== 'PENDING' || new Date(current.expiresAt).getTime() <= Date.now()) {
        throw new GovernanceConflictError('Invitation is not available');
      }
      if (existingMembership?.status === 'ACTIVE') {
        throw new GovernanceConflictError('This user is already an active member');
      }

      const now = new Date().toISOString();
      const [membership] = await transaction
        .insert(memberships)
        .values({ organizationId: current.organizationId, userId: principal.userId, role: current.role })
        .onConflictDoUpdate({
          target: [memberships.organizationId, memberships.userId],
          set: { role: current.role, status: 'ACTIVE', rowVersion: sql`${memberships.rowVersion} + 1`, updatedAt: now }
        })
        .returning();
      if (membership === undefined) throw new Error('Membership acceptance did not return a row');
      await transaction
        .update(organizationInvitations)
        .set({
          status: 'ACCEPTED',
          acceptedByUserId: principal.userId,
          acceptedAt: now,
          rowVersion: sql`${organizationInvitations.rowVersion} + 1`,
          updatedAt: now
        })
        .where(eq(organizationInvitations.id, current.id));
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`,
        organizationId: current.organizationId,
        actorUserId: principal.userId,
        action: 'INVITATION_ACCEPTED',
        targetType: 'OrganizationInvitation',
        targetId: current.id,
        requestId,
        metadata: { role: current.role, sessionId: principal.sessionId }
      });
      return { membership: memberFromRow({ ...membership, email: user.email, displayName: user.displayName }), replayed: false };
    });
  }
}
