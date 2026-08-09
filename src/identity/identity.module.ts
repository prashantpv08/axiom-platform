import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AccessGuard } from './access/access.guard';
import { AUTHENTICATION_ADAPTER } from './authentication/authentication-adapter';
import { DatabaseSessionAuthenticationAdapter } from './authentication/database-session-authentication.adapter';
import { GovernanceController, InvitationAcceptanceController } from './governance/governance.controller';
import { GOVERNANCE_REPOSITORY } from './governance/governance.repository';
import { GovernanceService } from './governance/governance.service';
import {
  INVITATION_DELIVERY_ADAPTER,
  LocalManualInvitationDeliveryAdapter
} from './governance/invitation-delivery.adapter';
import { InvitationTokenService } from './governance/invitation-token.service';
import { PostgresGovernanceRepository } from './governance/postgres-governance.repository';
import { OrganizationController } from './organizations/organization.controller';
import { MeController } from './organizations/me.controller';
import { OrganizationService } from './organizations/organization.service';
import { IDENTITY_REPOSITORY } from './persistence/identity.repository';
import { PostgresIdentityRepository } from './persistence/postgres-identity.repository';

@Module({
  controllers: [MeController, OrganizationController, GovernanceController, InvitationAcceptanceController],
  providers: [
    PostgresIdentityRepository,
    { provide: IDENTITY_REPOSITORY, useExisting: PostgresIdentityRepository },
    DatabaseSessionAuthenticationAdapter,
    { provide: AUTHENTICATION_ADAPTER, useExisting: DatabaseSessionAuthenticationAdapter },
    PostgresGovernanceRepository,
    { provide: GOVERNANCE_REPOSITORY, useExisting: PostgresGovernanceRepository },
    LocalManualInvitationDeliveryAdapter,
    { provide: INVITATION_DELIVERY_ADAPTER, useExisting: LocalManualInvitationDeliveryAdapter },
    InvitationTokenService,
    GovernanceService,
    OrganizationService,
    { provide: APP_GUARD, useClass: AccessGuard }
  ]
})
export class IdentityModule {}
