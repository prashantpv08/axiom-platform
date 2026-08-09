import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';

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
    throw new BadRequestException('Governance cursor is invalid');
  }
}

function expectedInvitationRowVersion(value: unknown, invitationId: string): number {
  if (value === undefined) throw new HttpException('If-Match header is required', 428);
  if (typeof value !== 'string') throw new BadRequestException('If-Match header is invalid for this invitation');
  const match = /^"(INV-[A-Za-z0-9_-]{1,124}):([1-9][0-9]*)"$/u.exec(value);
  const version = match === null ? Number.NaN : Number(match[2]);
  if (match === null || match[1] !== invitationId || !Number.isSafeInteger(version)) {
    throw new BadRequestException('If-Match header is invalid for this invitation');
  }
  return version;
}

export function invitationEtag(invitation: { id: string; rowVersion: number }): string {
  return `"${invitation.id}:${invitation.rowVersion}"`;
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
    if (!query.success) throw new BadRequestException('Member list query is invalid');
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
    if (!query.success) throw new BadRequestException('Invitation list query is invalid');
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
      throw new BadRequestException('Invitation creation request is invalid');
    }
    this.delivery.assertAvailable();
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
      if (cause instanceof GovernanceConflictError) throw new ConflictException(cause.message);
      throw cause;
    }
  }

  async revokeInvitation(
    context: OrganizationAccessContext,
    invitationIdInput: unknown,
    ifMatchInput: unknown,
    requestId: string
  ) {
    const invitationId = InvitationIdSchema.safeParse(invitationIdInput);
    if (!invitationId.success) throw new NotFoundException('Invitation was not found');
    const expectedRowVersion = expectedInvitationRowVersion(ifMatchInput, invitationId.data);
    try {
      return await this.repository.revokeInvitation({
        invitationId: invitationId.data,
        expectedRowVersion,
        context,
        requestId
      });
    } catch (cause) {
      if (cause instanceof GovernanceNotFoundError) throw new NotFoundException(cause.message);
      if (cause instanceof GovernanceVersionConflictError) {
        throw new HttpException(cause.message, HttpStatus.PRECONDITION_FAILED);
      }
      if (cause instanceof GovernanceConflictError) throw new ConflictException(cause.message);
      throw cause;
    }
  }

  async acceptInvitation(principal: Principal, input: unknown, requestId: string) {
    const request = AcceptInvitationRequestSchema.safeParse(input);
    if (!request.success) throw new BadRequestException('Invitation acceptance request is invalid');
    try {
      return AcceptInvitationResponseSchema.parse(
        await this.repository.acceptInvitation(principal, this.tokens.hash(request.data.token), requestId)
      );
    } catch (cause) {
      if (cause instanceof GovernanceNotFoundError) throw new NotFoundException(cause.message);
      if (cause instanceof GovernanceConflictError) throw new ConflictException(cause.message);
      throw cause;
    }
  }
}
