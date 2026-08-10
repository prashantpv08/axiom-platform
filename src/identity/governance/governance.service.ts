import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { ApplicationError } from '../../platform/application/application-error';
import type { OrganizationAccessContext, Principal } from '../identity.schema';
import {
  AcceptInvitationRequestSchema,
  AcceptInvitationResponseSchema,
  CreateInvitationRequestSchema,
  CreateInvitationResponseSchema,
  GovernanceCursorSchema,
  GovernanceIdempotencyKeySchema,
  GovernanceListQuerySchema,
  InvitationIdSchema,
  InvitationListResponseSchema,
  MemberListResponseSchema,
  type GovernanceCursor
} from './governance.schema';
import {
  GOVERNANCE_REPOSITORY,
  GovernanceConflictError,
  GovernanceNotFoundError,
  GovernanceVersionConflictError,
  type GovernanceRepository
} from './governance.repository';
import {
  INVITATION_DELIVERY_ADAPTER,
  InvitationDeliveryUnavailableError,
  type InvitationDeliveryAdapter
} from './invitation-delivery.adapter';
import { InvitationTokenService } from './invitation-token.service';

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

function encodeCursor(cursor: GovernanceCursor): string {
  return Buffer.from(JSON.stringify(GovernanceCursorSchema.parse(cursor)), 'utf8').toString('base64url');
}

function decodeCursor(value: string): GovernanceCursor {
  try {
    return GovernanceCursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw new ApplicationError('INVALID_REQUEST', 'Governance cursor is invalid');
  }
}

@Injectable()
export class GovernanceService {
  constructor(
    @Inject(GOVERNANCE_REPOSITORY) private readonly repository: GovernanceRepository,
    @Inject(INVITATION_DELIVERY_ADAPTER) private readonly delivery: InvitationDeliveryAdapter,
    @Inject(InvitationTokenService) private readonly tokens: InvitationTokenService
  ) {}

  async listMembers(context: OrganizationAccessContext, input: unknown) {
    const query = GovernanceListQuerySchema.safeParse(input);
    if (!query.success) throw new ApplicationError('INVALID_REQUEST', 'Member list query is invalid');
    const page = await this.repository.listMembers(context.organizationId, {
      limit: query.data.limit,
      ...(query.data.cursor === undefined ? {} : { cursor: decodeCursor(query.data.cursor) })
    });
    const last = page.members.at(-1);
    return MemberListResponseSchema.parse({
      members: page.members,
      nextCursor: page.hasNextPage && last !== undefined ? encodeCursor({ id: last.userId, updatedAt: last.updatedAt }) : null
    });
  }

  async listInvitations(context: OrganizationAccessContext, input: unknown) {
    const query = GovernanceListQuerySchema.safeParse(input);
    if (!query.success) throw new ApplicationError('INVALID_REQUEST', 'Invitation list query is invalid');
    const page = await this.repository.listInvitations(context.organizationId, {
      limit: query.data.limit,
      ...(query.data.cursor === undefined ? {} : { cursor: decodeCursor(query.data.cursor) })
    });
    const last = page.invitations.at(-1);
    return InvitationListResponseSchema.parse({
      invitations: page.invitations,
      nextCursor: page.hasNextPage && last !== undefined ? encodeCursor({ id: last.id, updatedAt: last.updatedAt }) : null
    });
  }

  async createInvitation(
    context: OrganizationAccessContext,
    input: unknown,
    idempotencyKeyInput: unknown,
    requestId: string
  ) {
    const request = CreateInvitationRequestSchema.safeParse(input);
    const idempotencyKey = GovernanceIdempotencyKeySchema.safeParse(idempotencyKeyInput);
    if (!request.success || !idempotencyKey.success) {
      throw new ApplicationError('INVALID_REQUEST', 'Invitation creation request is invalid');
    }
    try {
      this.delivery.assertAvailable();
    } catch (cause) {
      if (cause instanceof InvitationDeliveryUnavailableError) throw new ApplicationError('UNAVAILABLE', cause.message);
      throw cause;
    }
    const id = `INV-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_MS).toISOString();
    const token = this.tokens.tokenFor({ id, email: request.data.email, expiresAt });
    const requestHash = createHash('sha256').update(JSON.stringify(request.data), 'utf8').digest('hex');

    try {
      const result = await this.repository.createInvitation({
        id,
        ...request.data,
        tokenHash: this.tokens.hash(token),
        expiresAt,
        idempotencyKey: idempotencyKey.data,
        requestHash,
        context,
        requestId
      });
      const acceptanceToken = this.tokens.tokenFor({
        id: result.invitation.id,
        email: result.invitation.email,
        expiresAt: result.invitation.expiresAt
      });
      return CreateInvitationResponseSchema.parse({
        invitation: result.invitation,
        delivery: this.delivery.deliverLocally(acceptanceToken),
        replayed: result.replayed
      });
    } catch (cause) {
      if (cause instanceof InvitationDeliveryUnavailableError) throw new ApplicationError('UNAVAILABLE', cause.message);
      if (cause instanceof GovernanceConflictError) throw new ApplicationError('CONFLICT', cause.message);
      throw cause;
    }
  }

  async revokeInvitation(
    context: OrganizationAccessContext,
    invitationIdInput: unknown,
    expectedRowVersion: number,
    requestId: string
  ) {
    const invitationId = InvitationIdSchema.safeParse(invitationIdInput);
    if (!invitationId.success) throw new ApplicationError('NOT_FOUND', 'Invitation was not found');
    try {
      return await this.repository.revokeInvitation({
        invitationId: invitationId.data,
        expectedRowVersion,
        context,
        requestId
      });
    } catch (cause) {
      if (cause instanceof GovernanceNotFoundError) throw new ApplicationError('NOT_FOUND', cause.message);
      if (cause instanceof GovernanceVersionConflictError) {
        throw new ApplicationError('PRECONDITION_FAILED', cause.message);
      }
      if (cause instanceof GovernanceConflictError) throw new ApplicationError('CONFLICT', cause.message);
      throw cause;
    }
  }

  async acceptInvitation(principal: Principal, input: unknown, requestId: string) {
    const request = AcceptInvitationRequestSchema.safeParse(input);
    if (!request.success) throw new ApplicationError('INVALID_REQUEST', 'Invitation acceptance request is invalid');
    try {
      return AcceptInvitationResponseSchema.parse(
        await this.repository.acceptInvitation(principal, this.tokens.hash(request.data.token), requestId)
      );
    } catch (cause) {
      if (cause instanceof GovernanceNotFoundError) throw new ApplicationError('NOT_FOUND', cause.message);
      if (cause instanceof GovernanceConflictError) throw new ApplicationError('CONFLICT', cause.message);
      throw cause;
    }
  }
}
