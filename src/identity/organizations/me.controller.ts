import { Controller, Get, Header, Inject, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { requirePrincipal, type AuthenticatedRequest } from '../access/access-context';
import { Authenticated } from '../access/authenticated.decorator';
import {
  CurrentUserOrganizationsResponseSchema,
  type CurrentUserOrganizationsResponse
} from '../identity.schema';
import { OrganizationService } from './organization.service';

@ApiTags('identity')
@ApiBearerAuth('session-bearer')
@ApiCookieAuth('session-cookie')
@Controller('me')
export class MeController {
  constructor(@Inject(OrganizationService) private readonly organizationService: OrganizationService) {}

  @Get('organizations')
  @Header('Cache-Control', 'no-store')
  @Authenticated()
  @ApiOperation({
    operationId: 'listCurrentUserOrganizations',
    summary: 'List active organizations for the authenticated user'
  })
  @ApiOkResponse({ description: 'Active organizations for the authenticated user' })
  async listOrganizations(@Req() request: AuthenticatedRequest): Promise<CurrentUserOrganizationsResponse> {
    return CurrentUserOrganizationsResponseSchema.parse({
      organizations: await this.organizationService.listCurrentUserOrganizations(
        requirePrincipal(request),
        request.id
      )
    });
  }
}
