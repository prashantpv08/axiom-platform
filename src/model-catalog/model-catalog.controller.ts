import { Controller, Get, Header, Inject, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { requireAccessContext, type AuthenticatedRequest } from '../identity/access/access-context';
import { MODEL_CATALOG_READ } from '../identity/access/permissions';
import { RequirePermission } from '../identity/access/require-permission.decorator';
import { ModelCatalogService } from './model-catalog.service';

@ApiTags('model-catalog')
@ApiBearerAuth('session-bearer')
@ApiCookieAuth('session-cookie')
@RequirePermission(MODEL_CATALOG_READ)
@Controller('organizations/:organizationId/models')
export class ModelCatalogController {
  constructor(@Inject(ModelCatalogService) private readonly service: ModelCatalogService) {}

  @Get('catalog')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getModelCatalog', summary: 'Read the authorized organization model catalog and tier policy' })
  @ApiOkResponse({ description: 'Provider lifecycle, qualified model metadata, and Economy/Balanced/Best assignments' })
  getCatalog(@Req() request: AuthenticatedRequest) {
    return this.service.getCatalog(requireAccessContext(request));
  }
}
