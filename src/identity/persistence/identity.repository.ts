import type { OrganizationAccessContext, OrganizationResponse, OrganizationRole, Principal } from '../identity.schema';

export const IDENTITY_REPOSITORY = Symbol('AXIOM_IDENTITY_REPOSITORY');

export type OrganizationRecord = Omit<OrganizationResponse, 'role'>;

export type AuditEventInput = {
  organizationId: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  requestId: string;
  metadata: Record<string, unknown>;
};

export type StoredAuditEvent = AuditEventInput & {
  id: string;
  occurredAt: string;
};

export interface IdentityRepository {
  findActiveSession(tokenHash: string, now: string): Promise<Principal | null>;
  findActiveMembership(userId: string, organizationId: string): Promise<OrganizationRole | null>;
  listActiveOrganizationsForUser(userId: string): Promise<Array<OrganizationRecord & { role: OrganizationRole }>>;
  findOrganization(organizationId: string): Promise<OrganizationRecord | null>;
  appendAuditEvent(input: AuditEventInput): Promise<StoredAuditEvent>;
}

export type AuthorizedOrganizationRequest = {
  context: OrganizationAccessContext;
  requestId: string;
};
