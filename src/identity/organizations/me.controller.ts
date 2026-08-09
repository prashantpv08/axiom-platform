import { Controller, Get, Header, Inject, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { requirePrincipal, type AuthenticatedRequest } from '../access/access-context';
import { Authenticated } from '../access/authenticated.decorator';
import type { OrganizationResponse } from '../identity.schema';
import { OrganizationService } from './organization.service';

type CurrentUserOrganizationsResponse = {
  organizations: OrganizationResponse[];
};

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
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['organizations'],
      properties: {
        organizations: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'slug', 'name', 'status', 'role'],
            properties: {
              id: { type: 'string' },
              slug: { type: 'string' },
              name: { type: 'string' },
              status: { type: 'string', enum: ['ACTIVE'] },
              role: {
                type: 'string',
                enum: [
                  'OWNER',
                  'ADMINISTRATOR',
                  'PRODUCT_ANALYST',
                  'ARCHITECT',
                  'DEVELOPER',
                  'REVIEWER',
                  'VIEWER'
                ]
              }
            }
          }
        }
      }
    }
  })
  async listOrganizations(@Req() request: AuthenticatedRequest): Promise<CurrentUserOrganizationsResponse> {
    return {
      organizations: await this.organizationService.listCurrentUserOrganizations(
        requirePrincipal(request),
        request.id
      )
    };
  }
}
