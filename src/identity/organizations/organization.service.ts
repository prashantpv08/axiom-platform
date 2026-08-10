import { Inject, Injectable } from '@nestjs/common';

import { ApplicationError } from '../../platform/application/application-error';
import {
  OrganizationResponseSchema,
  type OrganizationResponse,
  type Principal
} from '../identity.schema';
import {
  IDENTITY_REPOSITORY,
  type AuthorizedOrganizationRequest,
  type IdentityRepository
} from '../persistence/identity.repository';

@Injectable()
export class OrganizationService {
  constructor(@Inject(IDENTITY_REPOSITORY) private readonly repository: IdentityRepository) {}

  async getOrganization(request: AuthorizedOrganizationRequest): Promise<OrganizationResponse> {
    const organization = await this.repository.findOrganization(request.context.organizationId);
    if (organization === null || organization.status !== 'ACTIVE') {
      throw new ApplicationError('NOT_FOUND', 'Organization was not found');
    }

    await this.repository.appendAuditEvent({
      organizationId: organization.id,
      actorUserId: request.context.userId,
      action: 'ORGANIZATION_VIEWED',
      targetType: 'Organization',
      targetId: organization.id,
      requestId: request.requestId,
      metadata: { sessionId: request.context.sessionId }
    });

    return OrganizationResponseSchema.parse({ ...organization, role: request.context.role });
  }

  async listCurrentUserOrganizations(principal: Principal, requestId: string): Promise<OrganizationResponse[]> {
    const organizations = await this.repository.listActiveOrganizationsForUser(principal.userId);

    await Promise.all(
      organizations.map((organization) =>
        this.repository.appendAuditEvent({
          organizationId: organization.id,
          actorUserId: principal.userId,
          action: 'CURRENT_USER_ORGANIZATIONS_LISTED',
          targetType: 'User',
          targetId: principal.userId,
          requestId,
          metadata: { sessionId: principal.sessionId }
        })
      )
    );

    return organizations.map((organization) => OrganizationResponseSchema.parse(organization));
  }
}
