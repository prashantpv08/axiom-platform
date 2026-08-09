import { Controller, Get, Header, Inject, Param, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { requireAccessContext, type AuthenticatedRequest } from '../access/access-context';
import { ORGANIZATION_READ } from '../access/permissions';
import { RequirePermission } from '../access/require-permission.decorator';
import type { OrganizationResponse } from '../identity.schema';
import { OrganizationService } from './organization.service';

@ApiTags('organizations')
@ApiBearerAuth('session-bearer')
@ApiCookieAuth('session-cookie')
@Controller('organizations')
export class OrganizationController {
  constructor(@Inject(OrganizationService) private readonly organizationService: OrganizationService) {}

  @Get(':organizationId')
  @Header('Cache-Control', 'no-store')
  @RequirePermission(ORGANIZATION_READ)
  @ApiOperation({ operationId: 'getOrganization', summary: 'Get an organization visible to the current member' })
  @ApiParam({ name: 'organizationId', example: 'ORG-LOCAL' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['id', 'slug', 'name', 'status', 'role'],
      properties: {
        id: { type: 'string' },
        slug: { type: 'string' },
        name: { type: 'string' },
        status: { type: 'string', enum: ['ACTIVE'] },
        role: {
          type: 'string',
          enum: ['OWNER', 'ADMINISTRATOR', 'PRODUCT_ANALYST', 'ARCHITECT', 'DEVELOPER', 'REVIEWER', 'VIEWER']
        }
      }
    }
  })
  getOrganization(
    @Param('organizationId') _organizationId: string,
    @Req() request: AuthenticatedRequest
  ): Promise<OrganizationResponse> {
    return this.organizationService.getOrganization({
      context: requireAccessContext(request),
      requestId: request.id
    });
  }
}
