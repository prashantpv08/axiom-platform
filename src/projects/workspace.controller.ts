import { Controller, Get, Header, Inject, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';

import { requireAccessContext, type AuthenticatedRequest } from '../identity/access/access-context';
import { WORKSPACE_READ } from '../identity/access/permissions';
import { RequirePermission } from '../identity/access/require-permission.decorator';
import type { WorkspaceListResponse } from './project.schema';
import { ProjectService } from './project.service';

@ApiTags('workspaces')
@ApiBearerAuth('session-bearer')
@ApiCookieAuth('session-cookie')
@RequirePermission(WORKSPACE_READ)
@Controller('organizations/:organizationId/workspaces')
export class WorkspaceController {
  constructor(@Inject(ProjectService) private readonly projectService: ProjectService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'listWorkspaces', summary: 'List workspaces in an authorized organization' })
  @ApiParam({ name: 'organizationId', example: 'ORG-LOCAL-DEVELOPMENT' })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 100 })
  @ApiOkResponse({ description: 'Authorized organization workspaces' })
  listWorkspaces(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>
  ): Promise<WorkspaceListResponse> {
    return this.projectService.listWorkspaces(requireAccessContext(request), query);
  }
}
