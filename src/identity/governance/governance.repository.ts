import type { OrganizationAccessContext, Principal } from '../identity.schema';
import type {
  GovernanceCursor,
  InvitationResponse,
  MemberResponse
} from './governance.schema';

export const GOVERNANCE_REPOSITORY = Symbol('AXIOM_GOVERNANCE_REPOSITORY');

export type GovernancePageRequest = { cursor?: GovernanceCursor; limit: number };
export type MemberPage = { members: MemberResponse[]; hasNextPage: boolean };
export type InvitationPage = { invitations: InvitationResponse[]; hasNextPage: boolean };

export type CreateInvitationInput = {
  id: string;
  email: string;
  role: InvitationResponse['role'];
  tokenHash: string;
  expiresAt: string;
  idempotencyKey: string;
  requestHash: string;
  context: OrganizationAccessContext;
  requestId: string;
};

export type LifecycleInvitationInput = {
  invitationId: string;
  expectedRowVersion: number;
  context: OrganizationAccessContext;
  requestId: string;
};

export class GovernanceConflictError extends Error {}
export class GovernanceNotFoundError extends Error {}
export class GovernanceVersionConflictError extends Error {}

export interface GovernanceRepository {
  listMembers(organizationId: string, request: GovernancePageRequest): Promise<MemberPage>;
  listInvitations(organizationId: string, request: GovernancePageRequest): Promise<InvitationPage>;
  createInvitation(input: CreateInvitationInput): Promise<{ invitation: InvitationResponse; replayed: boolean }>;
  revokeInvitation(input: LifecycleInvitationInput): Promise<InvitationResponse>;
  acceptInvitation(principal: Principal, tokenHash: string, requestId: string): Promise<{ membership: MemberResponse; replayed: boolean }>;
}
