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
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['workspaces', 'nextCursor'],
      properties: {
        workspaces: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'name', 'rowVersion', 'createdAt', 'updatedAt'],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              rowVersion: { type: 'integer', minimum: 1 },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' }
            }
          }
        },
        nextCursor: { anyOf: [{ type: 'string' }, { type: 'null' }] }
      }
    }
  })
  listWorkspaces(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>
  ): Promise<WorkspaceListResponse> {
    return this.projectService.listWorkspaces(requireAccessContext(request), query);
  }
}
